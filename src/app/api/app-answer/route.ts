import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/app-answer — réponse d'équipe à un exercice d'application
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
    if (student.session.status !== 'application') {
      return NextResponse.json(
        { error: 'La phase d\u2019application n\u2019est pas ouverte.' },
        { status: 409 }
      )
    }
    if (student.session.revealed) {
      return NextResponse.json(
        { error: 'Les réponses sont déjà révélées, plus de modification possible.' },
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

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('POST /api/app-answer', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}
