import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionByCode, parseChoices, extractToken, safeEqualStrings } from '@/lib/tbl'
import { applyLifecycle } from '@/lib/session-lifecycle'

// GET /api/sessions/[code]/dashboard — données complètes du tableau de bord
// enseignant. Jeton transmis par l'en-tête « Authorization: Bearer … » (les
// URL des appels API ne contiennent plus le jeton → il n'apparaît pas dans
// les journaux serveur) ; le repli ?token= reste accepté (onglets ouverts
// avant une mise à jour de l'application).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params
    const token = extractToken(req)
    const session = await getSessionByCode(code)
    if (!session) {
      return NextResponse.json({ error: 'Séance introuvable.' }, { status: 404 })
    }
    if (!token || !safeEqualStrings(token, session.teacherToken)) {
      return NextResponse.json({ error: 'Accès refusé. Reconnectez-vous.' }, { status: 401 })
    }

    // Cycle de vie (à chaque ouverture enseignant) : corbeille expirée →
    // suppression définitive ; données étudiantes de plus de 4 mois → purge
    // automatique (la séance et ses QCM sont conservés).
    const live = await applyLifecycle(session)
    if (!live) {
      return NextResponse.json(
        { error: 'Cette séance a été supprimée définitivement (corbeille vidée).' },
        { status: 404 }
      )
    }

    const [questions, cases, teams, students, iratAnswers, tratAnswers, appeals, appAnswers, peerEvals, alertEvents] =
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
          // recoveryCode : visible par l'enseignant uniquement — permet de
          // redonner son code à un étudiant qui l'a perdu (porte de secours).
          select: { id: true, name: true, teamId: true, recoveryCode: true },
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
        // v2.5.0 : signalements anti-capture (capture suspectée / sortie
        // d'application) — les plus récents d'abord, volume borné.
        db.alertEvent.findMany({
          where: { student: { sessionId: session.id } },
          orderBy: { createdAt: 'desc' },
          take: 200,
          select: {
            id: true,
            studentId: true,
            kind: true,
            createdAt: true,
            student: { select: { name: true } },
          },
        }),
      ])

    // Questions RAT (iRAT + tRAT) en premier, exercices d'application ensuite —
    // la numérotation affichée correspond ainsi à l'ordre réel du déroulé TBL.
    const phaseRank = (p: string) => (p === 'application' ? 1 : 0)
    questions.sort((a, b) => phaseRank(a.phase) - phaseRank(b.phase) || a.order - b.order)

    return NextResponse.json({
      session: {
        id: live.id,
        code: live.code,
        title: live.title,
        status: live.status,
        iratMinutes: live.iratMinutes,
        phaseStartedAt: live.phaseStartedAt,
        revealed: live.revealed,
        createdAt: live.createdAt,
        // Corbeille (null = séance active) et purge des données étudiantes
        deletedAt: live.deletedAt,
        dataPurgedAt: live.dataPurgedAt,
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
      alerts: alertEvents.map((a) => ({
        id: a.id,
        studentId: a.studentId,
        studentName: a.student.name,
        kind: a.kind as 'screenshot' | 'tab_hidden',
        createdAt: a.createdAt,
      })),
    })
  } catch (e) {
    console.error('GET /api/sessions/[code]/dashboard', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}
