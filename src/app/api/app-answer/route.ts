import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { computeRevealedAppQuestionIds } from '@/lib/tbl-types'

// POST /api/app-answer — réponse d'équipe à une question d'application.
// La réponse est enregistrée dès le choix (envoi automatique) ; elle peut
// être modifiée jusqu'à ce que la question soit révélée — c'est-à-dire
// dès que TOUTES les équipes actives y ont répondu, ou si l'enseignant
// force la révélation.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const token = body?.token
    const questionId = body?.questionId
    const choice = Number(body?.choice)
    const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 2000) : ''
    if (typeof token !== 'string' || typeof questionId !== 'string' || !Number.isInteger(choice)) {
      return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })
    }

    const student = await db.student.findUnique({
      where: { token },
      include: { session: true },
    })
    if (!student) {
      return NextResponse.json({ error: 'Connexion perdue.' }, { status: 404 })
    }
    // Séance mise à la corbeille par l'enseignant : l'étudiant est bloqué.
    if (student.session.deletedAt) {
      return NextResponse.json(
        { error: 'Cette séance a été supprimée par l\u2019enseignant.' },
        { status: 410 }
      )
    }
    if (student.session.status !== 'application') {
      return NextResponse.json(
        { error: 'La phase d\u2019application n\u2019est pas ouverte.' },
        { status: 409 }
      )
    }
    if (!student.teamId) {
      return NextResponse.json({ error: 'Vous n\u2019êtes pas dans une équipe.' }, { status: 403 })
    }

    const question = await db.question.findFirst({
      where: { id: questionId, sessionId: student.sessionId, phase: 'application' },
    })
    if (!question) {
      return NextResponse.json({ error: 'Question introuvable.' }, { status: 404 })
    }
    const choices = JSON.parse(question.choices) as string[]
    if (choice < 0 || choice >= choices.length) {
      return NextResponse.json({ error: 'Choix invalide.' }, { status: 400 })
    }

    // Révélation par question : une question dont toutes les équipes actives
    // ont répondu (ou que l'enseignant a forcée) est verrouillée.
    const [allAppQuestions, students, appAnswers] = await Promise.all([
      db.question.findMany({
        where: { sessionId: student.sessionId, phase: 'application' },
        select: { id: true },
      }),
      db.student.findMany({
        where: { sessionId: student.sessionId },
        select: { teamId: true },
      }),
      db.appAnswer.findMany({
        where: { question: { sessionId: student.sessionId } },
        select: { teamId: true, questionId: true },
      }),
    ])
    const activeTeamIds = [
      ...new Set(students.filter((s) => s.teamId).map((s) => s.teamId as string)),
    ]
    const revealed = computeRevealedAppQuestionIds({
      appQuestionIds: allAppQuestions.map((q) => q.id),
      activeTeamIds,
      appAnswers,
      forcedReveal: student.session.revealed,
    })
    if (revealed.includes(questionId)) {
      return NextResponse.json(
        {
          error:
            'Les réponses à cette question sont déjà révélées (toutes les équipes ont répondu) — plus de modification possible.',
        },
        { status: 409 }
      )
    }

    const existing = await db.appAnswer.findUnique({
      where: { teamId_questionId: { teamId: student.teamId, questionId } },
    })
    if (existing) {
      await db.appAnswer.update({
        where: { id: existing.id },
        data: { choice, text },
      })
    } else {
      await db.appAnswer.create({
        data: { teamId: student.teamId!, questionId, choice, text },
      })
    }

    // La réponse qui vient d'être enregistrée peut déclencher la révélation
    // de la question (si c'était la dernière équipe) : on le signale au client.
    const revealedNow = computeRevealedAppQuestionIds({
      appQuestionIds: [questionId],
      activeTeamIds,
      appAnswers: [...appAnswers, { teamId: student.teamId!, questionId }],
      forcedReveal: student.session.revealed,
    })

    return NextResponse.json({ ok: true, revealedNow: revealedNow.length > 0 })
  } catch (e) {
    console.error('POST /api/app-answer', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}
