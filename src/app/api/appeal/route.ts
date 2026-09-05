import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/appeal — l'équipe soumet une réclamation (appel) sur une question
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const token = body?.token
    const questionId = body?.questionId
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    if (typeof token !== 'string' || typeof questionId !== 'string') {
      return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })
    }
    if (text.length < 10 || text.length > 2000) {
      return NextResponse.json(
        { error: 'La justification doit contenir entre 10 et 2000 caractères.' },
        { status: 400 }
      )
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
    if (student.session.status !== 'appeal') {
      return NextResponse.json(
        { error: 'La phase de réclamations n\u2019est pas ouverte.' },
        { status: 409 }
      )
    }
    if (!student.teamId) {
      return NextResponse.json(
        { error: 'Vous n\u2019êtes pas dans une équipe.' },
        { status: 403 }
      )
    }

    const question = await db.question.findFirst({
      where: { id: questionId, sessionId: student.sessionId, phase: 'rat' },
    })
    if (!question) {
      return NextResponse.json({ error: 'Question introuvable.' }, { status: 404 })
    }

    const existing = await db.appeal.findFirst({
      where: { teamId: student.teamId, questionId },
    })
    if (existing) {
      await db.appeal.update({
        where: { id: existing.id },
        data: { text, status: 'pending' },
      })
    } else {
      await db.appeal.create({
        data: {
          sessionId: student.sessionId,
          teamId: student.teamId,
          questionId,
          text,
        },
      })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('POST /api/appeal', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}
