import { db } from '@/lib/db'
import { parseChoices } from '@/lib/tbl'
import { computeAllFinalGrades, type StudentFinalResult } from '@/lib/final-results'

// ============================================================
// TBL Live v3.0.0 — Cache d'état partagé par séance
//
// PROBLÈME (150 étudiants) : quand un changement survient (changement
// de phase, révélation, réponse d'équipe…), TOUS les étudiants
// renouvellent leur état complet. Sans cache, chacun déclenche ~10
// requêtes SQL et reconstruit le même état : 150 étudiants = 1500
// requêtes et 150 reconstructions IDENTIQUES en quelques secondes.
//
// SOLUTION : l'état PARTAGÉ de la séance est construit UNE SEULE
// fois par numéro de révision, en mémoire, et servi à tous. Chaque
// étudiant ne paie plus que ses données personnelles (ses propres
// réponses : 1-2 petites requêtes indexées).
//
// MORCEAUX paresseux (built on demand, jamais pour rien) :
//  - base   : questions, cas, équipes, étudiants, réponses d'appli-
//             cation, réclamations ;
//  - iratStats : statistiques iRAT (phase feedback seulement) ;
//  - saiItems  : questionnaire de fin (phase finished seulement) ;
//  - finals    : notes finales (finished + questionnaire soumis).
//
// v3.3.0 — CORRECTIF CRITIQUE (grattage tRAT bloqué) : les tentatives
// tRAT ne vivent PLUS dans ce cache. Elles changent sous le compteur
// de révision D'ÉQUIPE (bumpTeamRevision n'incrémente PAS la révision
// globale — c'est le principe même du sondage allégé par équipe) ;
// servies depuis l'entrée « révision globale », elles étaient PÉRIMÉES :
// après un grattage, le rafraîchissement de l'étudiant renvoyait la
// carte AVANT le grattage → son prochain envoi partait avec
// expectedAttempt décalé → 409 « votre équipe vient de gratter une
// autre tentative » → « Réessayer » rafraîchissait… la même entrée
// périmée : boucle infinie, l'équipe ne pouvait plus gratter la 2ᵉ
// case. Désormais /api/student relit les tentatives de SON équipe à
// CHAQUE demande (une petite requête indexée, comme ses réponses
// iRAT personnelles) : l'état est toujours exact.
//
// CLÉ = (sessionId, révision) : chaque écriture pertinente incrémente
// la révision → l'entrée suivante est reconstruite automatiquement,
// aucune invalidation manuelle. Les écritures « invisibles » pour les
// étudiants (réponses iRAT, évaluations par les pairs) n'incrémentent
// QUE le compteur enseignant → le cache étudiant reste valable.
//
// Garde-fous : déduplication des constructions simultanées (la
// tempête de 150 requêtes déclenche UNE construction — les autres
// attendent le même résultat), capacité limitée (LRU 24 séances),
// effacement de l'entrée si la construction échoue.
//
// VERCEL : la mémoire est propre à chaque instance de fonction — le
// cache profite au regroupement naturel des requêtes (une instance
// sert plusieurs étudiants) ; un échec retombe simplement sur le
// calcul direct, AUCUNE donnée n'est perdue. En local (un seul
// serveur), le cache est exact et systématique.
// ============================================================

interface CacheEntry<T> {
  key: string
  promise: Promise<T>
}

class RevisionCache<T> {
  private map = new Map<string, CacheEntry<T>>()
  constructor(private max = 24) {}

  async get(key: string, build: () => Promise<T>): Promise<T> {
    const cur = this.map.get(key)
    if (cur) {
      // LRU : rafraîchit la position (Map = ordre d'insertion).
      this.map.delete(key)
      this.map.set(key, cur)
      return cur.promise
    }
    const entry: CacheEntry<T> = {
      key,
      // En cas d'échec, l'entrée est retirée : le prochain appel
      // reconstruira (jamais d'erreur mise en cache).
      promise: build().catch((e) => {
        this.map.delete(key)
        throw e
      }),
    }
    this.map.set(key, entry)
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
    return entry.promise
  }
}

// ---------------- Types de l'état partagé ----------------

export interface MappedQuestion {
  id: string
  text: string
  choices: string[]
  correct?: number
  phase: 'rat' | 'application'
  caseId: string | null
}

export interface AppealLite {
  questionId: string
  text: string
  status: string
}

export interface AppAnswerLite {
  teamId: string
  teamName: string
  teamNumber: number
  questionId: string
  choice: number
  text: string | null
}

export interface StudentLite {
  id: string
  name: string
  teamId: string | null
}

export interface TeamLite {
  id: string
  name: string
  number: number
  appealsDone: boolean
  revisionTeam: number
}

export interface BaseState {
  ratQuestions: { id: string; text: string; choices: string[]; correct: number; caseId: string | null }[]
  appQuestions: { id: string; text: string; choices: string[]; correct: number; caseId: string | null }[]
  cases: { id: string; title: string; intro: string | null; order: number; opened: boolean }[]
  students: StudentLite[]
  teams: TeamLite[]
  activeTeamIds: string[]
  appAnswers: AppAnswerLite[]
  appealsByTeam: Map<string, AppealLite[]>
  openedCaseIds: Set<string>
  accessibleAppQuestionIds: string[]
  revealedAppQuestionIds: string[]
  allTeamAppAnswers: AppAnswerLite[]
  appAnswerProgress: { questionId: string; answered: number; total: number }[]
}

export interface IratStatsState {
  perQuestion: { questionId: string; percent: number }[]
}

export interface SaiItemsState {
  items: {
    id: string
    subscale: 'accountability' | 'preference' | 'satisfaction'
    textKey: string | null
    text: string | null
    reversed: boolean
  }[]
}

const baseCache = new RevisionCache<BaseState>()
const iratStatsCache = new RevisionCache<IratStatsState>()
const saiItemsCache = new RevisionCache<SaiItemsState>()
const finalsCache = new RevisionCache<StudentFinalResult[]>()

export function baseKey(sessionId: string, revision: number): string {
  return `${sessionId}:r${revision}`
}

/** Clé des notes finales : le compteur enseignant compte AUSSI —
 *  les évaluations par les pairs et réponses iRAT tardives (fin de
 *  séance) changent les notes sans toucher la révision étudiante. */
export function finalsKey(sessionId: string, revision: number, revisionTeacher: number): string {
  return `${sessionId}:r${revision}:t${revisionTeacher}`
}

// ---------------- Construction des morceaux ----------------

async function buildBase(sessionId: string, revealed: boolean): Promise<BaseState> {
  const [ratQuestions, appQuestions, cases, students, teams, appAnswers, appeals] =
    await Promise.all([
      db.question.findMany({
        where: { sessionId, phase: 'rat' },
        orderBy: [{ order: 'asc' }],
        select: { id: true, text: true, choices: true, correct: true, caseId: true },
      }),
      db.question.findMany({
        where: { sessionId, phase: 'application' },
        orderBy: [{ order: 'asc' }],
        select: { id: true, text: true, choices: true, correct: true, caseId: true },
      }),
      db.case.findMany({
        where: { sessionId },
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
        select: { id: true, title: true, intro: true, order: true, opened: true },
      }),
      db.student.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, teamId: true },
      }),
      db.team.findMany({
        where: { sessionId },
        orderBy: { number: 'asc' },
        select: { id: true, name: true, number: true, appealsDone: true, revisionTeam: true },
      }),
      db.appAnswer.findMany({
        where: { question: { sessionId, phase: 'application' } },
        select: {
          teamId: true,
          questionId: true,
          choice: true,
          text: true,
          team: { select: { name: true, number: true } },
        },
      }),
      db.appeal.findMany({
        where: { sessionId },
        select: { teamId: true, questionId: true, text: true, status: true },
      }),
    ])

  const openedCaseIds = new Set(cases.filter((c) => c.opened).map((c) => c.id))
  const accessibleAppQuestions = appQuestions.filter(
    (q) => !q.caseId || openedCaseIds.has(q.caseId)
  )
  const accessibleAppQuestionIds = accessibleAppQuestions.map((q) => q.id)
  const activeTeamIds = [
    ...new Set(students.filter((s) => s.teamId).map((s) => s.teamId as string)),
  ]

  // Révélation automatique : une question est révélée dès que toutes
  // les équipes actives y ont répondu (ou révélation forcée).
  const answersByQuestion = new Map<string, Set<string>>()
  for (const a of appAnswers) {
    const teams = answersByQuestion.get(a.questionId) ?? new Set<string>()
    teams.add(a.teamId)
    answersByQuestion.set(a.questionId, teams)
  }
  const revealedIds = revealed
    ? accessibleAppQuestionIds
    : accessibleAppQuestionIds.filter((qid) => {
        const answered = answersByQuestion.get(qid)
        return !!answered && activeTeamIds.length > 0 && answered.size >= activeTeamIds.length
      })

  // Regroupements par équipe (une seule passe, complexité linéaire).
  // (v3.3.0 : les tentatives tRAT ne sont plus ici — voir l'en-tête
  // du fichier : elles appartiennent au compteur d'équipe, /api/student
  // les relit à chaque demande.)
  const appealsByTeam = new Map<string, AppealLite[]>()
  for (const a of appeals) {
    const list = appealsByTeam.get(a.teamId) ?? []
    list.push({ questionId: a.questionId, text: a.text, status: a.status })
    appealsByTeam.set(a.teamId, list)
  }

  const revealedSet = new Set(revealedIds)
  const appAnswerProgress = accessibleAppQuestionIds.map((qid) => ({
    questionId: qid,
    answered: answersByQuestion.get(qid)?.size ?? 0,
    total: activeTeamIds.length,
  }))

  const mappedAppAnswers: AppAnswerLite[] = appAnswers.map((a) => ({
    teamId: a.teamId,
    teamName: a.team.name,
    teamNumber: a.team.number,
    questionId: a.questionId,
    choice: a.choice,
    text: a.text,
  }))
  return {
    ratQuestions: ratQuestions.map((q) => ({
      id: q.id,
      text: q.text,
      choices: parseChoices(q.choices),
      correct: q.correct,
      caseId: q.caseId,
    })),
    appQuestions: appQuestions.map((q) => ({
      id: q.id,
      text: q.text,
      choices: parseChoices(q.choices),
      correct: q.correct,
      caseId: q.caseId,
    })),
    cases: cases.map((c) => ({
      id: c.id,
      title: c.title,
      intro: c.intro,
      order: c.order,
      opened: c.opened,
    })),
    students,
    teams,
    activeTeamIds,
    appAnswers: mappedAppAnswers,
    appealsByTeam,
    openedCaseIds,
    accessibleAppQuestionIds,
    revealedAppQuestionIds: revealedIds,
    allTeamAppAnswers: mappedAppAnswers.filter((a) => revealedSet.has(a.questionId)),
    appAnswerProgress,
  }
}

/** État partagé de la séance (construit une fois par révision). */
export function getBaseState(
  sessionId: string,
  revision: number,
  revealed: boolean
): Promise<BaseState> {
  return baseCache.get(baseKey(sessionId, revision), () => buildBase(sessionId, revealed))
}

/** Statistiques iRAT par question (phase de feedback). */
export function getIratStats(sessionId: string, revision: number): Promise<IratStatsState> {
  return iratStatsCache.get(`${sessionId}:r${revision}`, async () => {
    const allIrat = await db.answer.findMany({
      where: { kind: 'irat', question: { sessionId, phase: 'rat' } },
      select: { questionId: true, isCorrect: true },
    })
    const perQuestion = new Map<string, { total: number; correct: number }>()
    for (const a of allIrat) {
      const stat = perQuestion.get(a.questionId) || { total: 0, correct: 0 }
      stat.total += 1
      if (a.isCorrect) stat.correct += 1
      perQuestion.set(a.questionId, stat)
    }
    return {
      perQuestion: Array.from(perQuestion.entries()).map(([questionId, s]) => ({
        questionId,
        percent: s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0,
      })),
    }
  })
}

/** Items du questionnaire TBL-SAI (fin de séance). */
export function getSaiItems(sessionId: string, revision: number): Promise<SaiItemsState> {
  return saiItemsCache.get(`${sessionId}:r${revision}`, async () => {
    const saiItems = await db.saiItem.findMany({
      where: { sessionId },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      select: { id: true, subscale: true, textKey: true, text: true, reversed: true },
    })
    return {
      items: saiItems.map((it) => ({
        id: it.id,
        subscale: it.subscale as 'accountability' | 'preference' | 'satisfaction',
        textKey: it.textKey,
        text: it.text,
        reversed: it.reversed,
      })),
    }
  })
}

/** Notes finales de TOUS les étudiants (une fois, partagées). */
export function getFinals(
  sessionId: string,
  revision: number,
  revisionTeacher: number
): Promise<StudentFinalResult[]> {
  return finalsCache.get(finalsKey(sessionId, revision, revisionTeacher), () =>
    computeAllFinalGrades(sessionId)
  )
}
