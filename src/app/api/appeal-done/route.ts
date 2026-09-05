import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

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

    await db.team.update({
      where: { id: student.teamId },
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
        data: { status: 'feedback', phaseStartedAt: new Date() },
      })
    }

    return NextResponse.json({ ok: true, advanced: allDone, doneCount, total })
  } catch (e) {
    console.error('POST /api/appeal-done', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}
