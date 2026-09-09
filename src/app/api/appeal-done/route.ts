import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { bumpRevisions } from '@/lib/revision'
import { withSessionWrite, recordSessionEvent, eventOriginFromHeader } from '@/lib/write-queue'

// POST /api/appeal-done — l'équipe signale qu'elle n'a (plus) de réclamation.
// Quand toutes les équipes actives (au moins un étudiant) ont répondu,
// la phase passe AUTOMATIQUEMENT au feedback.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const token = body?.token
    const done = body?.done !== false // true par défaut, false = annuler
    if (typeof token !== 'string') {
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
    if (student.session.status !== 'appeal') {
      return NextResponse.json(
        { error: 'La phase de réclamations n\u2019est pas ouverte.' },
        { status: 409 }
      )
    }
    if (!student.teamId) {
      return NextResponse.json({ error: 'Vous n\u2019êtes pas dans une équipe.' }, { status: 403 })
    }

    // v3.1.0 — VERROU D'ÉCRITURE + IDEMPOTENCE : la mise à jour de
    // appealsDone et le ÉVENTUEL passage automatique au feedback
    // forment une séquence atomique (plusieurs équipes cliquant
    // « terminé » en même temps ne peuvent pas rater le passage).
    // Un réessai après timeout recalcule le même état → même réponse.
    const origin = eventOriginFromHeader(req.headers.get('x-tbl-origin'))
    const teamId = student.teamId as string
    const outcome = await withSessionWrite(
      student.sessionId,
      'appeal-done',
      async (): Promise<{ advanced: boolean; doneCount: number; total: number }> => {
        await db.team.update({
          where: { id: teamId },
          data: { appealsDone: done === true },
        })

        // Progression et passage automatique : équipes actives = au moins 1 étudiant
        const [teams, students] = await Promise.all([
          db.team.findMany({ where: { sessionId: student.sessionId } }),
          db.student.findMany({
            where: { sessionId: student.sessionId },
            select: { teamId: true },
          }),
        ])
        const activeTeamIds = new Set(
          students.filter((s) => s.teamId).map((s) => s.teamId as string)
        )
        const doneCount = teams.filter((t) => activeTeamIds.has(t.id) && t.appealsDone).length
        const total = activeTeamIds.size
        const allDone = total > 0 && doneCount === total

        if (allDone) {
          await db.session.update({
            where: { id: student.sessionId },
            data: {
              status: 'feedback',
              phaseStartedAt: new Date(),
              // v2.7.0 : passage automatique → les étudiants voient d'abord
              // l'écran d'attente ; l'enseignant lance l'affichage des
              // résultats avec « Lancer le feedback ».
              feedbackReady: false,
            },
          })
        }
        return { advanced: allDone, doneCount, total }
      }
    )

    // v2.9.0 : progression des réclamations (voire passage au feedback)
    // → compteurs + 1.
    await bumpRevisions(student.sessionId)
    await recordSessionEvent(
      student.sessionId,
      'appeal_done',
      teamId,
      { done: done === true, advanced: outcome.advanced },
      origin
    )

    return NextResponse.json({ ok: true, ...outcome })
  } catch (e) {
    console.error('POST /api/appeal-done', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}
