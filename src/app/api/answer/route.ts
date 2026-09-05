import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/answer — réponse individuelle (iRAT)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const token = body?.token
    const questionId = body?.questionId
    const choice = Number(body?.choice)
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
    if (student.session.status !== 'irat') {
      return NextResponse.json(
        { error: 'Le test individuel n\u2019est pas ouvert en ce moment.' },
        { status: 409 }
      )
    }

    const question = await db.question.findFirst({
      where: { id: questionId, sessionId: student.sessionId, phase: 'rat' },
    })
    if (!question) {
      return NextResponse.json({ error: 'Question introuvable.' }, { status: 404 })
    }
    const choices = JSON.parse(question.choices) as string[]
    if (choice < 0 || choice >= choices.length) {
      return NextResponse.json({ error: 'Choix invalide.' }, { status: 400 })
    }

    const existing = await db.answer.findFirst({
      where: { questionId, studentId: student.id, kind: 'irat' },
    })
    if (existing) {
      return NextResponse.json(
        { error: 'Vous avez déjà répondu à cette question.' },
        { status: 409 }
      )
    }

    const isCorrect = choice === question.correct
    try {
      await db.answer.create({
        data: {
          questionId,
          studentId: student.id,
          kind: 'irat',
          choice,
          attempt: 1,
          isCorrect,
          score: isCorrect ? 1 : 0,
        },
      })
    } catch (e) {
      // Course entre deux requêtes simultanées (double clic, réseau mobile) :
      // la contrainte unique @@unique([studentId, questionId, kind]) garantit
      // qu'une seule réponse iRAT est enregistrée — jamais de double comptage.
      if (
        e &&
        typeof e === 'object' &&
        'code' in e &&
        (e as { code?: string }).code === 'P2002'
      ) {
        return NextResponse.json(
          { error: 'Vous avez déjà répondu à cette question.' },
          { status: 409 }
        )
      }
      throw e
    }

    // Pas de divulgation de la bonne réponse pendant l'iRAT
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('POST /api/answer', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}
