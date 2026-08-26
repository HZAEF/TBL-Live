import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionByCode, randomToken } from '@/lib/tbl'

// POST /api/join — l'étudiant rejoint une séance
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const code = typeof body?.code === 'string' ? body.code : ''
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const teamId = typeof body?.teamId === 'string' ? body.teamId : null

    if (name.length < 2 || name.length > 40) {
      return NextResponse.json(
        { error: 'Votre nom doit contenir entre 2 et 40 caractères.' },
        { status: 400 }
      )
    }

    const session = await getSessionByCode(code)
    if (!session) {
      return NextResponse.json({ error: 'Séance introuvable. Vérifiez le code.' }, { status: 404 })
    }

    // Reprise de session : même nom déjà utilisé dans cette séance
    const existing = await db.student.findFirst({
      where: { sessionId: session.id, name: { equals: name } },
    })

    let student
    if (existing) {
      if (teamId && existing.teamId && teamId !== existing.teamId) {
        return NextResponse.json(
          {
            error:
              'Ce nom est déjà utilisé dans une autre équipe. Utilisez un nom légèrement différent (ex. nom + initiale) ou choisissez la même équipe.',
          },
          { status: 409 }
        )
      }
      // Même nom (et même équipe ou pas de choix) : on rend son compte
      student = await db.student.update({
        where: { id: existing.id },
        data: { token: randomToken(), teamId: teamId || existing.teamId },
      })
    } else {
      // Vérifie que l'équipe demandée appartient bien à la séance
      let targetTeamId = teamId
      if (targetTeamId) {
        const team = await db.team.findFirst({
          where: { id: targetTeamId, sessionId: session.id },
        })
        if (!team) targetTeamId = null
      }
      if (!targetTeamId) {
        // Affectation automatique : l'équipe la moins remplie
        const teams = await db.team.findMany({
          where: { sessionId: session.id },
          orderBy: { number: 'asc' },
        })
        if (teams.length > 0) {
          const counts = await db.student.groupBy({
            by: ['teamId'],
            where: { sessionId: session.id },
            _count: { _all: true },
          })
          const countMap = new Map(counts.map((c) => [c.teamId, c._count._all]))
          let best = teams[0]
          let bestCount = Infinity
          for (const t of teams) {
            const c = countMap.get(t.id) || 0
            if (c < bestCount) {
              best = t
              bestCount = c
            }
          }
          targetTeamId = best.id
        }
      }
      student = await db.student.create({
        data: {
          sessionId: session.id,
          name,
          token: randomToken(),
          teamId: targetTeamId,
        },
      })
    }

    return NextResponse.json({
      token: student.token,
      studentId: student.id,
      name: student.name,
      teamId: student.teamId,
      code: session.code,
      title: session.title,
    })
  } catch (e) {
    console.error('POST /api/join', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}
