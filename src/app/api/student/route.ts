import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseChoices } from '@/lib/tbl'

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

    const session = student.session
    const status = session.status

    const [teamMembers, ratQuestions, appQuestions, myIratAnswers, teamTratAnswers, myAppeals, teamAppAnswers, allAppAnswers] =
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
        session.revealed && student.teamId
          ? db.appAnswer.findMany({
              where: { question: { sessionId: session.id, phase: 'application' } },
              include: { team: { select: { name: true, number: true } } },
            })
          : Promise.resolve([]),
      ])

    const mapQuestion = (q: (typeof ratQuestions)[number], withCorrect: boolean) => ({
      id: q.id,
      text: q.text,
      choices: parseChoices(q.choices),
      correct: withCorrect ? q.correct : undefined,
      phase: q.phase,
    })

    // Les bonnes réponses ne sont divulguées qu'après les tests (iRAT + tRAT)
    const revealCorrect = ['appeal', 'feedback', 'finished'].includes(status)
    // Pour l'application : seulement après révélation simultanée
    const revealAppCorrect = status === 'application' && session.revealed

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
        team: student.team ? { id: student.team.id, name: student.team.name } : null,
      },
      teamMembers,
      questions: ratQuestions.map((q) => mapQuestion(q, revealCorrect)),
      applicationQuestions: appQuestions.map((q) =>
        mapQuestion(q, revealAppCorrect || status === 'finished')
      ),
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

    // Réponses de toutes les équipes après la révélation simultanée
    if (session.revealed) {
      response.allTeamAppAnswers = allAppAnswers.map((a) => ({
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
    }

    return NextResponse.json(response)
  } catch (e) {
    console.error('GET /api/student', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}
