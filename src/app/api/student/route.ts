import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseChoices } from '@/lib/tbl'
import { computeRevealedAppQuestionIds } from '@/lib/tbl-types'

// GET /api/student?token= — état complet de l'étudiant selon la phase en cours
export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token') || ''
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
        }),
        student.teamId
          ? db.answer.findMany({
              where: { teamId: student.teamId, kind: 'trat', question: { phase: 'rat' } },
              orderBy: { attempt: 'asc' },
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

    // Les bonnes réponses ne sont divulguées qu'après les tests (iRAT + tRAT)
    const revealCorrect = ['appeal', 'feedback', 'finished'].includes(status)

    // ----- Révélation automatique par question d'application -----
    // Une question est révélée dès que toutes les équipes actives (au moins
    // un étudiant) y ont répondu, ou si l'enseignant force la révélation.
    const activeTeamIds = [
      ...new Set(allStudents.filter((s) => s.teamId).map((s) => s.teamId as string)),
    ]
    const revealedAppQuestionIds = computeRevealedAppQuestionIds({
      appQuestionIds: appQuestions.map((q) => q.id),
      activeTeamIds,
      appAnswers: allAppAnswersRaw.map((a) => ({ teamId: a.teamId, questionId: a.questionId })),
      forcedReveal: session.revealed,
    })

    // Pour l'application : bonne réponse divulguée question par question,
    // seulement une fois révélée (ou à la fin de la séance).
    const revealAppCorrect = (questionId: string) =>
      status === 'finished' || revealedAppQuestionIds.includes(questionId)

    const response: Record<string, unknown> = {
      session: {
        code: session.code,
        title: session.title,
        status,
        phaseStartedAt: session.phaseStartedAt,
        iratMinutes: session.iratMinutes,
        revealed: session.revealed,
      },
      me: {
        id: student.id,
        name: student.name,
        recoveryCode: student.recoveryCode,
        team: student.team ? { id: student.team.id, name: student.team.name } : null,
      },
      teamMembers,
      questions: ratQuestions.map((q) => mapQuestion(q, revealCorrect)),
      applicationQuestions: appQuestions.map((q) => mapQuestion(q, revealAppCorrect(q.id))),
      appCases: cases.map((c) => ({ id: c.id, title: c.title, intro: c.intro, order: c.order })),
      revealedAppQuestionIds,
      myIratAnswers: myIratAnswers.map((a) => ({
        questionId: a.questionId,
        choice: a.choice,
        isCorrect: status === 'irat' ? undefined : a.isCorrect,
        score: status === 'irat' ? undefined : a.score,
      })),
      teamTratAnswers: teamTratAnswers.map((a) => ({
        questionId: a.questionId,
        choice: a.choice,
        attempt: a.attempt,
        isCorrect: a.isCorrect,
        score: a.score,
      })),
      myAppeals: myAppeals.map((a) => ({
        questionId: a.questionId,
        text: a.text,
        status: a.status,
      })),
      teamAppAnswers: teamAppAnswers.map((a) => ({
        questionId: a.questionId,
        choice: a.choice,
        text: a.text,
      })),
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
    if (status === 'application') {
      response.appAnswerProgress = appQuestions.map((q) => ({
        questionId: q.id,
        answered: allAppAnswersRaw.filter((a) => a.questionId === q.id).length,
        total: activeTeamIds.length,
      }))
    }

    // Statistiques de classe pour la phase de feedback
    if (status === 'feedback' || status === 'finished') {
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

    // Réponses de toutes les équipes — uniquement pour les questions révélées
    if (revealedAppQuestionIds.length > 0) {
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

    return NextResponse.json(response)
  } catch (e) {
    console.error('GET /api/student', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}
