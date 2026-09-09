import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { extractToken } from '@/lib/tbl'
import { computeRankFor } from '@/lib/grades'
import { readRevParam } from '@/lib/revision'
import { recordRequest } from '@/lib/metrics'
import { rateLimit, RATE_STUDENT } from '@/lib/rate-limit'
import {
  getBaseState,
  getFinals,
  getIratStats,
  getSaiItems,
} from '@/lib/student-state-cache'

// ============================================================
// GET /api/student — état complet de l'étudiant selon la phase en cours.
// Jeton transmis par l'en-tête « Authorization: Bearer … » (repli ?token=
// accepté pour les onglets ouverts avant une mise à jour).
//
// v2.9.0 — SONDAGE ALLÉGÉ : ?rev=N → { unchanged: true } si rien
// n'a changé (une requête, quelques octets).
//
// v3.0.0 — TROIS accélérations décisives pour les grandes classes :
//  1. ?rev=N&trev=M : la réponse « rien n'a changé » tient compte
//     AUSSI de la révision de l'ÉQUIPE de l'étudiant (tentatives
//     tRAT) — les membres d'une équipe seuls renouvellent ;
//  2. L'ÉTAT PARTAGÉ de la séance (questions, cas, équipes, réponses
//     d'application, réclamations, statistiques, notes finales) est
//     construit UNE SEULE fois par révision et servi à tous : 150
//     étudiants qui arrivent en même temps = 1 construction + 150
//     petites requêtes personnelles, plus 1500 requêtes identiques ;
//  3. Seules les données PROPRE à l'étudiant sont relues à chaque
//     demande (ses réponses iRAT, ses évaluations par les pairs).
// ============================================================
export async function GET(req: NextRequest) {
  const started = Date.now()
  let tokenForMetrics: string | undefined
  try {
    const token = extractToken(req)
    if (!token) {
      return NextResponse.json({ error: 'Jeton manquant.' }, { status: 400 })
    }
    // v3.2.0 — garde-fou de débit (audit point n°5) : l'état complet
    // n'est tiré qu'aux changements de numéro — un client sain reste
    // loin du plafond ; un client défaillant reçoit 429 + Retry-After
    // et son backoff double son délai tout seul.
    const verdict = rateLimit(`stu:${token}`, RATE_STUDENT)
    if (!verdict.ok) {
      recordRequest('student', Date.now() - started, false)
      const res = NextResponse.json(
        { error: 'Trop de requêtes — ralentissez, la séance continue.' },
        { status: 429 }
      )
      res.headers.set('Retry-After', String(verdict.retryAfterSec))
      return res
    }
    tokenForMetrics = token
    const student = await db.student.findUnique({
      where: { token },
      include: { session: true, team: true },
    })
    if (!student) {
      recordRequest('student', Date.now() - started, false)
      return NextResponse.json(
        { error: 'Connexion perdue. Rejoignez à nouveau la séance.' },
        { status: 404 }
      )
    }
    // Séance mise à la corbeille par l'enseignant : l'étudiant est bloqué.
    if (student.session.deletedAt) {
      recordRequest('student', Date.now() - started, false)
      return NextResponse.json(
        { error: 'Cette séance a été supprimée par l\u2019enseignant.' },
        { status: 410 }
      )
    }

    const session = student.session
    const status = session.status
    const teamRevision = student.team ? student.team.revisionTeam : null

    // v3.0.0 — rien n'a changé pour les étudiants depuis le dernier
    // sondage : réponse minuscule, immédiate. Deux numéros :
    //  - ?rev=  : révision GLOBALE (toujours vérifiée) ;
    //  - ?trev= : révision de l'ÉQUIPE de l'étudiant (vérifiée
    //    UNIQUEMENT si le client l'envoie — les onglets ouverts sur
    //    la v2.9 au moment de la mise à jour ne l'envoient pas : ils
    //    gardent exactement le comportement d'avant, sans casse).
    const clientRev = readRevParam(req.nextUrl)
    const trevRaw = req.nextUrl.searchParams.get('trev')
    const clientTeamRev = (() => {
      if (trevRaw === null) return null
      if (trevRaw === 'null') return null
      const n = Number(trevRaw)
      return Number.isInteger(n) && n >= 0 && n <= 2_000_000_000 ? n : null
    })()
    if (
      clientRev !== null &&
      clientRev === session.revision &&
      (trevRaw === null || clientTeamRev === teamRevision)
    ) {
      recordRequest('student', Date.now() - started, true, token)
      return NextResponse.json({
        unchanged: true,
        revision: session.revision,
        serverNow: new Date().toISOString(),
      })
    }

    // v2.7.0 — Écran d'attente AVANT le feedback : tant que l'enseignant
    // n'a pas cliqué « Lancer le feedback », AUCUNE donnée de résultats
    // n'est envoyée à l'étudiant (ni questions, ni réponses, ni
    // statistiques) : rien à capturer d'écran, l'attention reste sur le
    // tableau. Le payload minimal ne contient que l'en-tête habituel.
    if (status === 'feedback' && !session.feedbackReady) {
      recordRequest('student', Date.now() - started, true, token)
      return NextResponse.json({
        revision: session.revision,
        teamRevision,
        serverNow: new Date().toISOString(),
        session: {
          code: session.code,
          title: session.title,
          status,
          phaseStartedAt: session.phaseStartedAt,
          iratMinutes: session.iratMinutes,
          revealed: session.revealed,
          feedbackReady: false,
          // v3.0.0 : signalements anti-capture activés ou non.
          reportsEnabled: session.reportsEnabled,
        },
        me: {
          id: student.id,
          name: student.name,
          recoveryCode: student.recoveryCode,
          saiCompletedAt: student.saiCompletedAt ? student.saiCompletedAt.toISOString() : null,
          team: student.team ? { id: student.team.id, name: student.team.name } : null,
        },
        teamMembers: student.teamId
          ? (await getBaseState(session.id, session.revision, session.revealed)).students
              .filter((s) => s.teamId === student.teamId)
              .map((s) => ({ id: s.id, name: s.name }))
          : [],
        questions: [],
        applicationQuestions: [],
        appCases: [],
        revealedAppQuestionIds: [],
        myIratAnswers: [],
        teamTratAnswers: [],
        myAppeals: [],
        teamAppAnswers: [],
      })
    }

    // v3.0.0 — ÉTAT PARTAGÉ : une construction par révision, servie
    // à toute la classe (voir student-state-cache.ts).
    const base = await getBaseState(session.id, session.revision, session.revealed)

    // Les bonnes réponses ne sont divulguées qu'après les tests (iRAT + tRAT).
    // v2.6.0 : PLUS JAMAIS en fin de séance (statut « finished »).
    const revealCorrect = ['appeal', 'feedback'].includes(status)
    const revealedSet = new Set(base.revealedAppQuestionIds)

    const mapQuestion = (
      q: (typeof base.ratQuestions)[number] | (typeof base.appQuestions)[number],
      withCorrect: boolean,
      phase: 'rat' | 'application'
    ) => ({
      id: q.id,
      text: q.text,
      choices: q.choices,
      correct: withCorrect ? q.correct : undefined,
      phase,
      caseId: q.caseId,
    })

    // ----- Données propres à l'étudiant (relues à chaque demande) -----
    // v3.0.0 : parallélisées avec la construction éventuelle du cache.
    const needPeer = status === 'peer' || status === 'finished'
    const [myIratAnswers, myPeerEvals, receivedEvals] = await Promise.all([
      db.answer.findMany({
        where: { studentId: student.id, kind: 'irat', question: { phase: 'rat' } },
        select: { questionId: true, choice: true, isCorrect: true, score: true },
      }),
      needPeer
        ? db.peerEval.findMany({
            where: { evaluatorId: student.id },
            select: { evaluatedId: true, score: true, comment: true },
          })
        : Promise.resolve([]),
      needPeer
        ? db.peerEval.findMany({
            where: { evaluatedId: student.id },
            select: { score: true },
          })
        : Promise.resolve([]),
    ])

    const teamId = student.teamId
    const teamTratAnswers = teamId ? (base.tratByTeam.get(teamId) ?? []) : []
    const myAppeals = teamId ? (base.appealsByTeam.get(teamId) ?? []) : []
    const accessibleQIds = new Set(base.accessibleAppQuestionIds)
    const teamAppAnswers = teamId
      ? base.appAnswers
          .filter((a) => a.teamId === teamId && accessibleQIds.has(a.questionId))
          .map((a) => ({ questionId: a.questionId, choice: a.choice, text: a.text }))
      : []
    const teamMembers = teamId
      ? base.students.filter((s) => s.teamId === teamId).map((s) => ({ id: s.id, name: s.name }))
      : []

    const response: Record<string, unknown> = {
      revision: session.revision,
      teamRevision,
      serverNow: new Date().toISOString(),
      session: {
        code: session.code,
        title: session.title,
        status,
        phaseStartedAt: session.phaseStartedAt,
        iratMinutes: session.iratMinutes,
        revealed: session.revealed,
        feedbackReady: session.feedbackReady,
        // v3.0.0 : signalements anti-capture activés ou non (l'app
        // étudiante cesse de les envoyer quand c'est désactivé).
        reportsEnabled: session.reportsEnabled,
      },
      me: {
        id: student.id,
        name: student.name,
        recoveryCode: student.recoveryCode,
        // v2.6.0 : date de soumission du questionnaire TBL-SAI
        // (null = questionnaire non rempli → note et rang masqués).
        saiCompletedAt: student.saiCompletedAt ? student.saiCompletedAt.toISOString() : null,
        team: student.team ? { id: student.team.id, name: student.team.name } : null,
      },
      teamMembers,
      questions: base.ratQuestions.map((q) => mapQuestion(q, revealCorrect, 'rat')),
      // v2.7.0 : seules les questions des cas LANCÉS sont envoyées.
      applicationQuestions: base.appQuestions
        .filter((q) => !q.caseId || base.openedCaseIds.has(q.caseId))
        .map((q) => mapQuestion(q, status !== 'finished' && revealedSet.has(q.id), 'application')),
      // v2.7.0 : tous les cas sont listés mais le titre et l'énoncé
      // d'un cas non lancé ne sont PAS envoyés.
      appCases: base.cases.map((c) => ({
        id: c.id,
        title: c.opened ? c.title : null,
        intro: c.opened ? c.intro : null,
        order: c.order,
        opened: c.opened,
      })),
      revealedAppQuestionIds: base.revealedAppQuestionIds,
      myIratAnswers: myIratAnswers.map((a) => ({
        questionId: a.questionId,
        choice: a.choice,
        // v2.6.0 : plus de divulgation de correction/score en fin de séance
        isCorrect: status === 'irat' || status === 'finished' ? undefined : a.isCorrect,
        score: status === 'irat' || status === 'finished' ? undefined : a.score,
      })),
      teamTratAnswers: teamTratAnswers.map((a) => ({
        questionId: a.questionId,
        choice: a.choice,
        attempt: a.attempt,
        isCorrect: status === 'finished' ? undefined : a.isCorrect,
        score: status === 'finished' ? undefined : a.score,
      })),
      myAppeals: myAppeals.map((a) => ({
        questionId: a.questionId,
        text: a.text,
        status: a.status,
      })),
      teamAppAnswers,
    }

    // ----- Phase réclamations : bouton « pas de réclamation » + progression -----
    if (status === 'appeal') {
      const activeIds = new Set(base.activeTeamIds)
      const doneCount = base.teams.filter((t) => activeIds.has(t.id) && t.appealsDone).length
      response.myTeamAppealsDone = student.team ? student.team.appealsDone : false
      response.appealsProgress = { done: doneCount, total: base.activeTeamIds.length }
    }

    // ----- Phase application : progression des équipes par question -----
    if (status === 'application') {
      response.appAnswerProgress = base.appAnswerProgress
    }

    // Statistiques de classe pour la phase de feedback (v3.0.0 :
    // partagées par toute la classe — un seul calcul par révision).
    if (status === 'feedback') {
      const stats = await getIratStats(session.id, session.revision)
      response.iratStats = stats.perQuestion
    }

    // Réponses de toutes les équipes — uniquement pour les questions
    // révélées PENDANT la phase d'application (jamais en fin de séance).
    if (status !== 'finished' && base.revealedAppQuestionIds.length > 0) {
      response.allTeamAppAnswers = base.allTeamAppAnswers.map((a) => ({
        teamName: a.teamName,
        questionId: a.questionId,
        choice: a.choice,
        text: a.text,
      }))
    }

    // Évaluation par les pairs
    if (needPeer) {
      response.myPeerEvals = myPeerEvals
      response.myPeerReceived =
        receivedEvals.length > 0
          ? {
              avg: receivedEvals.reduce((s, e) => s + e.score, 0) / receivedEvals.length,
              count: receivedEvals.length,
            }
          : null
    }

    // v2.6.0 — Fin de séance : questionnaire TBL-SAI puis note + rang.
    if (status === 'finished') {
      if (!student.saiCompletedAt) {
        const sai = await getSaiItems(session.id, session.revision)
        response.saiItems = sai.items
      } else {
        // Notes finales : UN calcul pour toute la classe (clé =
        // révision + révision enseignant : les évaluations par les
        // pairs arrivant en fin de séance sont prises en compte).
        const finals = await getFinals(session.id, session.revision, session.revisionTeacher)
        const mine = finals.find((f) => f.studentId === student.id)
        response.finalNote = mine ? mine.grade.final : null
        response.myRank = computeRankFor(
          finals.map((f) => ({ studentId: f.studentId, final: f.grade.final })),
          student.id
        )
      }
    }

    recordRequest('student', Date.now() - started, true, token)
    return NextResponse.json(response)
  } catch (e) {
    recordRequest('student', Date.now() - started, false, tokenForMetrics)
    console.error('GET /api/student', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}
