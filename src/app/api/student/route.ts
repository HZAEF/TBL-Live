import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseChoices, extractToken } from '@/lib/tbl'
import { computeRevealedAppQuestionIds } from '@/lib/tbl-types'
import { computeRankFor } from '@/lib/grades'
import { computeAllFinalGrades } from '@/lib/final-results'
import { readRevParam } from '@/lib/revision'

// GET /api/student — état complet de l'étudiant selon la phase en cours.
// Jeton transmis par l'en-tête « Authorization: Bearer … » (repli ?token=
// accepté pour les onglets ouverts avant une mise à jour).
//
// v2.9.0 — SONDAGE ALLÉGÉ : le client transmet ?rev=N (son dernier
// numéro de révision). Si la séance porte ENCORE ce numéro, la réponse
// se limite à { unchanged: true, serverNow } : une requête en base au
// lieu d'une dizaine, quelques octets au lieu de l'état complet —
// c'est ce qui rend l'application fluide avec 65 étudiants en ligne.
// Le premier changement (phase, réponse, révélation…) incrémente le
// compteur côté serveur : l'étudiant reçoit alors l'état complet neuf.
export async function GET(req: NextRequest) {
  try {
    const token = extractToken(req)
    if (!token) {
      return NextResponse.json({ error: 'Jeton manquant.' }, { status: 400 })
    }
    const student = await db.student.findUnique({
      where: { token },
      include: { session: true, team: true },
    })
    if (!student) {
      return NextResponse.json(
        { error: 'Connexion perdue. Rejoignez à nouveau la séance.' },
        { status: 404 }
      )
    }
    // Séance mise à la corbeille par l'enseignant : l'étudiant est bloqué.
    if (student.session.deletedAt) {
      return NextResponse.json(
        { error: 'Cette séance a été supprimée par l\u2019enseignant.' },
        { status: 410 }
      )
    }

    const session = student.session
    const status = session.status

    // v2.9.0 — rien n'a changé pour les étudiants depuis le dernier
    // sondage : réponse minuscule, immédiate, sans toucher la base.
    const clientRev = readRevParam(req.nextUrl)
    if (clientRev !== null && clientRev === session.revision) {
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
      const teamMembersWaiting = student.teamId
        ? await db.student.findMany({
            where: { teamId: student.teamId },
            orderBy: { createdAt: 'asc' },
            select: { id: true, name: true },
          })
        : []
      return NextResponse.json({
        // v2.9.0 : numéro de révision + heure serveur (sondage allégé
        // et minuteurs synchronisés, même sur l'écran d'attente).
        revision: session.revision,
        serverNow: new Date().toISOString(),
        session: {
          code: session.code,
          title: session.title,
          status,
          phaseStartedAt: session.phaseStartedAt,
          iratMinutes: session.iratMinutes,
          revealed: session.revealed,
          feedbackReady: false,
        },
        me: {
          id: student.id,
          name: student.name,
          recoveryCode: student.recoveryCode,
          saiCompletedAt: student.saiCompletedAt ? student.saiCompletedAt.toISOString() : null,
          team: student.team ? { id: student.team.id, name: student.team.name } : null,
        },
        teamMembers: teamMembersWaiting,
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

    const [teamMembers, ratQuestions, appQuestions, cases, myIratAnswers, teamTratAnswers, myAppeals, teamAppAnswers, allStudents, allAppAnswersRaw] =
      await Promise.all([
        student.teamId
          ? db.student.findMany({
              where: { teamId: student.teamId },
              orderBy: { createdAt: 'asc' },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
        db.question.findMany({
          where: { sessionId: session.id, phase: 'rat' },
          orderBy: [{ order: 'asc' }],
        }),
        db.question.findMany({
          where: { sessionId: session.id, phase: 'application' },
          orderBy: [{ order: 'asc' }],
        }),
        db.case.findMany({
          where: { sessionId: session.id },
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
        }),
        db.answer.findMany({
          where: { studentId: student.id, kind: 'irat', question: { phase: 'rat' } },
          // v2.4.0 : champs strictement nécessaires (allège le sondage)
          select: { questionId: true, choice: true, isCorrect: true, score: true },
        }),
        student.teamId
          ? db.answer.findMany({
              where: { teamId: student.teamId, kind: 'trat', question: { phase: 'rat' } },
              orderBy: { attempt: 'asc' },
              select: { questionId: true, choice: true, attempt: true, isCorrect: true, score: true },
            })
          : Promise.resolve([]),
        student.teamId
          ? db.appeal.findMany({ where: { teamId: student.teamId } })
          : Promise.resolve([]),
        student.teamId
          ? db.appAnswer.findMany({ where: { teamId: student.teamId } })
          : Promise.resolve([]),
        db.student.findMany({
          where: { sessionId: session.id },
          select: { teamId: true },
        }),
        // Réponses d'application de toutes les équipes — ne seront renvoyées
        // que pour les questions déjà révélées (voir plus bas).
        db.appAnswer.findMany({
          where: { question: { sessionId: session.id, phase: 'application' } },
          include: { team: { select: { name: true, number: true } } },
        }),
      ])

    // v2.7.0 — Cas cliniques lancés : seuls les cas OUVERTS par
    // l'enseignant (bouton « Lancer le cas clinique N ») sont envoyés
    // aux étudiants — énoncé, questions et réponses des autres équipes
    // des cas non lancés ne quittent jamais le serveur. Les étudiants
    // voient une page d'attente neutre entre chaque cas, pour que
    // l'enseignant puisse expliquer chaque cas séparément.
    const openedCaseIds = new Set(cases.filter((c) => c.opened).map((c) => c.id))
    const accessibleAppQuestions = appQuestions.filter(
      (q) => !q.caseId || openedCaseIds.has(q.caseId)
    )

    const mapQuestion = (
      q: (typeof ratQuestions)[number] | (typeof appQuestions)[number],
      withCorrect: boolean
    ) => ({
      id: q.id,
      text: q.text,
      choices: parseChoices(q.choices),
      correct: withCorrect ? q.correct : undefined,
      phase: q.phase,
      caseId: q.caseId,
    })

    // Les bonnes réponses ne sont divulguées qu'après les tests (iRAT + tRAT).
    // v2.6.0 : PLUS JAMAIS en fin de séance (statut « finished ») : la page
    // de fin n'affiche plus les corrections (risque de capture d'écran et
    // de divulgation hors classe) et la note finale est calculée côté
    // serveur — le « corrigé » ne transite plus du tout vers l'étudiant.
    const revealCorrect = ['appeal', 'feedback'].includes(status)

    // ----- Révélation automatique par question d'application -----
    // Une question est révélée dès que toutes les équipes actives (au moins
    // un étudiant) y ont répondu, ou si l'enseignant force la révélation.
    // v2.7.0 : calcul limité aux questions accessibles (cas lancés) — les
    // questions d'un cas non lancé ne peuvent pas recevoir de réponses.
    const activeTeamIds = [
      ...new Set(allStudents.filter((s) => s.teamId).map((s) => s.teamId as string)),
    ]
    const revealedAppQuestionIds = computeRevealedAppQuestionIds({
      appQuestionIds: accessibleAppQuestions.map((q) => q.id),
      activeTeamIds,
      appAnswers: allAppAnswersRaw.map((a) => ({ teamId: a.teamId, questionId: a.questionId })),
      forcedReveal: session.revealed,
    })

    // Pour l'application : bonne réponse divulguée question par question,
    // seulement une fois révélée pendant la phase d'application — jamais
    // après la fin de la séance (v2.6.0, cf. revealCorrect ci-dessus).
    const revealAppCorrect = (questionId: string) =>
      status !== 'finished' && revealedAppQuestionIds.includes(questionId)

    const response: Record<string, unknown> = {
      // v2.9.0 : numéro de révision + heure serveur (minuteurs
      // synchronisés sur tous les appareils, sondage allégé).
      revision: session.revision,
      serverNow: new Date().toISOString(),
      session: {
        code: session.code,
        title: session.title,
        status,
        phaseStartedAt: session.phaseStartedAt,
        iratMinutes: session.iratMinutes,
        revealed: session.revealed,
        feedbackReady: session.feedbackReady,
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
      questions: ratQuestions.map((q) => mapQuestion(q, revealCorrect)),
      // v2.7.0 : seules les questions des cas LANCÉS sont envoyées.
      applicationQuestions: accessibleAppQuestions.map((q) => mapQuestion(q, revealAppCorrect(q.id))),
      // v2.7.0 : tous les cas sont listés (sélecteur + page d'attente)
      // mais le titre et l'énoncé d'un cas non lancé ne sont PAS envoyés.
      appCases: cases.map((c) => ({
        id: c.id,
        title: c.opened ? c.title : null,
        intro: c.opened ? c.intro : null,
        order: c.order,
        opened: c.opened,
      })),
      revealedAppQuestionIds,
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
      // v2.7.0 : réponses de mon équipe limitées aux questions accessibles.
      teamAppAnswers: (() => {
        const accessibleQIds = new Set(accessibleAppQuestions.map((q) => q.id))
        return teamAppAnswers
          .filter((a) => accessibleQIds.has(a.questionId))
          .map((a) => ({
            questionId: a.questionId,
            choice: a.choice,
            text: a.text,
          }))
      })(),
    }

    // ----- Phase réclamations : bouton « pas de réclamation » + progression -----
    if (status === 'appeal') {
      const teams = await db.team.findMany({ where: { sessionId: session.id } })
      const activeIds = new Set(activeTeamIds)
      const doneCount = teams.filter((t) => activeIds.has(t.id) && t.appealsDone).length
      response.myTeamAppealsDone = student.team ? student.team.appealsDone : false
      response.appealsProgress = { done: doneCount, total: activeTeamIds.length }
    }

    // ----- Phase application : progression des équipes par question -----
    // v2.7.0 : limitée aux questions accessibles (cas lancés).
    if (status === 'application') {
      response.appAnswerProgress = accessibleAppQuestions.map((q) => ({
        questionId: q.id,
        answered: allAppAnswersRaw.filter((a) => a.questionId === q.id).length,
        total: activeTeamIds.length,
      }))
    }

    // Statistiques de classe pour la phase de feedback (v2.6.0 : plus en
    // fin de séance — la page de fin n'affiche plus de statistiques).
    if (status === 'feedback') {
      const allIrat = await db.answer.findMany({
        where: { kind: 'irat', question: { sessionId: session.id, phase: 'rat' } },
        select: { questionId: true, isCorrect: true },
      })
      const perQuestion = new Map<string, { total: number; correct: number }>()
      for (const a of allIrat) {
        const stat = perQuestion.get(a.questionId) || { total: 0, correct: 0 }
        stat.total += 1
        if (a.isCorrect) stat.correct += 1
        perQuestion.set(a.questionId, stat)
      }
      response.iratStats = Array.from(perQuestion.entries()).map(([questionId, s]) => ({
        questionId,
        percent: s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0,
      }))
    }

    // Réponses de toutes les équipes — uniquement pour les questions
    // révélées PENDANT la phase d'application (jamais en fin de séance).
    if (status !== 'finished' && revealedAppQuestionIds.length > 0) {
      const revealed = new Set(revealedAppQuestionIds)
      response.allTeamAppAnswers = allAppAnswersRaw
        .filter((a) => revealed.has(a.questionId))
        .map((a) => ({
          teamName: a.team.name,
          questionId: a.questionId,
          choice: a.choice,
          text: a.text,
        }))
    }

    // Évaluation par les pairs
    if (status === 'peer' || status === 'finished') {
      const myPeerEvals = await db.peerEval.findMany({
        where: { evaluatorId: student.id },
        select: { evaluatedId: true, score: true, comment: true },
      })
      response.myPeerEvals = myPeerEvals
      // Moyenne des notes reçues (utile à l'écran de fin pour la note finale)
      const receivedEvals = await db.peerEval.findMany({
        where: { evaluatedId: student.id },
        select: { score: true },
      })
      response.myPeerReceived =
        receivedEvals.length > 0
          ? {
              avg: receivedEvals.reduce((s, e) => s + e.score, 0) / receivedEvals.length,
              count: receivedEvals.length,
            }
          : null
    }

    // v2.6.0 — Fin de séance : questionnaire TBL-SAI puis note + rang.
    // Le questionnaire (items de la séance) n'est envoyé qu'AVANT la
    // soumission ; la note finale et le rang ne sont envoyés qu'APRÈS —
    // l'étudiant doit répondre pour y accéder (verrou serveur : impossible
    // de contourner en lisant les données de l'API).
    if (status === 'finished') {
      if (!student.saiCompletedAt) {
        const saiItems = await db.saiItem.findMany({
          where: { sessionId: session.id },
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
          select: { id: true, subscale: true, textKey: true, text: true, reversed: true },
        })
        response.saiItems = saiItems.map((it) => ({
          id: it.id,
          subscale: it.subscale as 'accountability' | 'preference' | 'satisfaction',
          textKey: it.textKey,
          text: it.text,
          reversed: it.reversed,
        }))
      } else {
        // Questionnaire déjà soumis : note finale (calcul serveur, cf.
        // final-results.ts) + rang parmi les étudiants notés de la séance.
        const finals = await computeAllFinalGrades(session.id)
        const mine = finals.find((f) => f.studentId === student.id)
        response.finalNote = mine ? mine.grade.final : null
        response.myRank = computeRankFor(
          finals.map((f) => ({ studentId: f.studentId, final: f.grade.final })),
          student.id
        )
      }
    }

    return NextResponse.json(response)
  } catch (e) {
    console.error('GET /api/student', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}
