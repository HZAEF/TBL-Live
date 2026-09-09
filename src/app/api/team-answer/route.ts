import { NextRequest, NextResponse } from 'next/server'
import { withMetrics } from '@/lib/metrics'
import { db } from '@/lib/db'
import { bumpTeamRevision } from '@/lib/revision'

// Barème IF-AT : tentative 1 = 4 pts, tentative 2 = 2 pts, tentative 3 = 1 pt, ensuite 0
const TRAT_POINTS = [4, 2, 1, 0]

// POST /api/team-answer — réponse d'équipe (tRAT) avec feedback immédiat
async function doPOST(req: NextRequest) {
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

    // v3.0.0 — ÉCRITURE SANS TRANSACTION INTERACTIVE : les lectures
    // (tentatives précédentes) se font HORS transaction — elles ne
    // posent AUCUN verrou en écriture — et l'insertion reste protégée
    // par la contrainte unique @@unique([teamId, questionId, kind,
    // attempt]) : deux clics vraiment simultanés dans la même équipe
    // produisent UNE tentative (la seconde reçoit P2002 → message
    // clair « double envoi »). Pourquoi c'est plus fluide : une
    // transaction interactive garde une connexion ET un verrou
    // d'écriture SQLite pendant TOUTE sa durée ; avec 150 étudiants
    // cliquant en même temps, elles s'empilaient (P1008 « 20 s
    // depuis le début de la transaction »). Sans transaction, chaque
    // insertion ne verrouille que quelques millisecondes — la file
    // d'attente s'écoule instantanément, même en rafale.
    const previous = await db.answer.findMany({
      where: { questionId, teamId: student.teamId!, kind: 'trat' },
      orderBy: { attempt: 'asc' },
    })
    if (previous.some((a) => a.isCorrect)) {
      return NextResponse.json(
        { error: 'Votre équipe a déjà trouvé la bonne réponse à cette question.' },
        { status: 409 }
      )
    }
    if (previous.length >= 4) {
      return NextResponse.json(
        { error: 'Les 4 tentatives sont épuisées pour cette question.' },
        { status: 409 }
      )
    }
    const attempt = previous.length + 1
    const isCorrect = choice === question.correct
    const score = isCorrect ? TRAT_POINTS[attempt - 1] : 0
    let result: { attempt: number; isCorrect: boolean; score: number; pointsIfCorrect: number } | { error: string }
    try {
      await db.answer.create({
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
      result = { attempt, isCorrect, score, pointsIfCorrect: TRAT_POINTS[attempt] ?? 0 }
    } catch (e) {
      if (
        e &&
        typeof e === 'object' &&
        'code' in e &&
        (e as { code?: string }).code === 'P2002'
      ) {
        // Double envoi simultané (même numéro de tentative) : l'autre
        // requête a déjà enregistré cette tentative.
        result = { error: 'Double envoi détecté : votre équipe a déjà répondu à cette question.' }
      } else {
        throw e
      }
    }

    if ('error' in result && result.error) {
      return NextResponse.json({ error: result.error }, { status: 409 })
    }

    // v2.9.0 : tentative tRAT enregistrée → compteurs + 1.
    // v3.0.0 — La tentative tRAT est visible par les MEMBRES DE
    // L'ÉQUIPE uniquement (carte à gratter) + le tableau de bord :
    // compteur d'équipe, PAS la révision globale. Les autres équipes
    // n'ont rien à renouveler — chacune progresse à son rythme sans
    // déclencher de tempête de rechargements chez toute la classe.
    await bumpTeamRevision(student.sessionId, student.teamId!)

    return NextResponse.json(result)
  } catch (e) {
    console.error('POST /api/team-answer', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}

export const POST = withMetrics<unknown>(
  'team-answer',
  doPOST
)
