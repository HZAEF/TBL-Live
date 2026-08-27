import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionByCode, parseChoices } from '@/lib/tbl'

// GET /api/sessions/[code]/dashboard?token= — données complètes du tableau de bord enseignant
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params
    const token = req.nextUrl.searchParams.get('token') || ''
    const session = await getSessionByCode(code)
    if (!session) {
      return NextResponse.json({ error: 'Séance introuvable.' }, { status: 404 })
    }
    if (!token || token !== session.teacherToken) {
      return NextResponse.json({ error: 'Accès refusé. Reconnectez-vous.' }, { status: 401 })
    }

    const [questions, cases, teams, students, iratAnswers, tratAnswers, appeals, appAnswers, peerEvals] =
      await Promise.all([
        db.question.findMany({
          where: { sessionId: session.id },
          // Tri : questions iRAT/tRAT d'abord, puis exercices d'application,
          // chacun dans l'ordre défini par l'enseignant (champ order).
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
        }),
        db.case.findMany({
          where: { sessionId: session.id },
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
        }),
        db.team.findMany({ where: { sessionId: session.id }, orderBy: { number: 'asc' } }),
        db.student.findMany({
          where: { sessionId: session.id },
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true, teamId: true },
        }),
        db.answer.findMany({
          where: { question: { sessionId: session.id }, kind: 'irat' },
          select: {
            questionId: true,
            studentId: true,
            choice: true,
            isCorrect: true,
            score: true,
          },
        }),
        db.answer.findMany({
          where: { question: { sessionId: session.id }, kind: 'trat' },
          orderBy: { attempt: 'asc' },
          select: {
            questionId: true,
            teamId: true,
            choice: true,
            attempt: true,
            isCorrect: true,
            score: true,
          },
        }),
        db.appeal.findMany({
          where: { sessionId: session.id },
          orderBy: { createdAt: 'asc' },
        }),
        db.appAnswer.findMany({
          where: { team: { sessionId: session.id } },
        }),
        db.peerEval.findMany({
          where: { sessionId: session.id },
          select: {
            evaluatorId: true,
            evaluatedId: true,
            score: true,
            comment: true,
          },
        }),
      ])

    // Questions RAT (iRAT + tRAT) en premier, exercices d'application ensuite —
    // la numérotation affichée correspond ainsi à l'ordre réel du déroulé TBL.
    const phaseRank = (p: string) => (p === 'application' ? 1 : 0)
    questions.sort((a, b) => phaseRank(a.phase) - phaseRank(b.phase) || a.order - b.order)

    return NextResponse.json({
      session: {
        id: session.id,
        code: session.code,
        title: session.title,
        status: session.status,
        iratMinutes: session.iratMinutes,
        phaseStartedAt: session.phaseStartedAt,
        revealed: session.revealed,
        createdAt: session.createdAt,
      },
      questions: questions.map((q) => ({
        id: q.id,
        text: q.text,
        choices: parseChoices(q.choices),
        correct: q.correct,
        phase: q.phase,
        order: q.order,
        caseId: q.caseId,
      })),
      cases: cases.map((c) => ({
        id: c.id,
        title: c.title,
        intro: c.intro,
        order: c.order,
      })),
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        number: t.number,
        appealsDone: t.appealsDone,
      })),
      students,
      iratAnswers,
      tratAnswers,
      appeals,
      appAnswers: appAnswers.map((a) => ({
        teamId: a.teamId,
        questionId: a.questionId,
        choice: a.choice,
        text: a.text,
      })),
      peerEvals,
    })
  } catch (e) {
    console.error('GET /api/sessions/[code]/dashboard', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}
