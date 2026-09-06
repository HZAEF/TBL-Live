import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Barème IF-AT : tentative 1 = 4 pts, tentative 2 = 2 pts, tentative 3 = 1 pt, ensuite 0
const TRAT_POINTS = [4, 2, 1, 0]

// POST /api/team-answer — réponse d'équipe (tRAT) avec feedback immédiat
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
    if (student.session.status !== 'trat') {
      return NextResponse.json(
        { error: 'Le test en équipe n\u2019est pas ouvert en ce moment.' },
        { status: 409 }
      )
    }
    if (!student.teamId) {
      return NextResponse.json(
        { error: 'Vous n\u2019êtes pas dans une équipe. Prévenez votre professeur.' },
        { status: 403 }
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

    // Transaction : évite deux clics simultanés dans l'équipe.
    // v2.4.0 : la contrainte unique @@unique([teamId, questionId, kind,
    // attempt]) en base est le verrou DÉFINITIF — même sous l'isolation
    // « read committed » (défaut PostgreSQL/Neon), deux requêtes vraiment
    // simultanées dans la même équipe ne peuvent plus créer deux tentatives
    // portant le même numéro : la seconde est rejetée par la base (erreur
    // Prisma P2002) et reçoit un message clair.
    const result = await db
      .$transaction(async (tx) => {
        const previous = await tx.answer.findMany({
          where: { questionId, teamId: student.teamId!, kind: 'trat' },
          orderBy: { attempt: 'asc' },
        })
        if (previous.some((a) => a.isCorrect)) {
          return { error: 'Votre équipe a déjà trouvé la bonne réponse à cette question.' }
        }
        if (previous.length >= 4) {
          return { error: 'Les 4 tentatives sont épuisées pour cette question.' }
        }
        const attempt = previous.length + 1
        const isCorrect = choice === question.correct
        const score = isCorrect ? TRAT_POINTS[attempt - 1] : 0
        await tx.answer.create({
          data: {
            questionId,
            teamId: student.teamId!,
            kind: 'trat',
            choice,
            attempt,
            isCorrect,
            score,
          },
        })
        return { attempt, isCorrect, score, pointsIfCorrect: TRAT_POINTS[attempt] ?? 0 }
      })
      .catch((e: unknown) => {
        if (
          e &&
          typeof e === 'object' &&
          'code' in e &&
          (e as { code?: string }).code === 'P2002'
        ) {
          // Double envoi simultané (même numéro de tentative) : l'autre
          // requête a déjà enregistré cette tentative.
          return {
            error: 'Double envoi détecté : votre équipe a déjà répondu à cette question.',
          }
        }
        throw e
      })

    if ('error' in result && result.error) {
      return NextResponse.json({ error: result.error }, { status: 409 })
    }

    return NextResponse.json(result)
  } catch (e) {
    console.error('POST /api/team-answer', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}
