import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionByCode, randomToken, randomRecoveryCode, normalizeName } from '@/lib/tbl'

// POST /api/join — l'étudiant rejoint une séance
//
// Reprise de séance sécurisée : un nom seul ne suffit plus. Chaque étudiant
// reçoit, à sa PREMIÈRE connexion, un code de reprise personnel (6 caractères)
// affiché à l'écran. Pour reprendre sa séance (autre appareil, navigateur
// vidé), il saisit son nom ET son code de reprise. Conséquences :
//  - impossible d'usurper le compte d'un camarade en connaissant juste son
//    prénom ;
//  - deux homonymes ne « s'éjectent » plus mutuellement : le second est
//    invité à se différencier (nom de famille) au lieu de voler le compte.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const code = typeof body?.code === 'string' ? body.code : ''
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const teamId = typeof body?.teamId === 'string' ? body.teamId : null
    const recoveryCode =
      typeof body?.recoveryCode === 'string'
        ? body.recoveryCode.toUpperCase().replace(/[^A-Z0-9]/g, '').trim()
        : ''

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
    // Séance mise à la corbeille par l'enseignant : plus personne ne peut
    // la rejoindre (l'enseignant peut encore la restaurer pendant 48 h).
    if (session.deletedAt) {
      return NextResponse.json(
        { error: 'Cette séance a été supprimée par l\u2019enseignant.' },
        { status: 404 }
      )
    }

    // Recherche d'un compte existant : comparaison insensible à la casse et
    // aux accents (« Léa » = « lea »), pour rattraper une faute de frappe
    // sans créer un doublon.
    const sessionStudents = await db.student.findMany({
      where: { sessionId: session.id },
      select: { id: true, name: true, token: true, teamId: true, recoveryCode: true },
    })
    const matches = sessionStudents.filter(
      (s) => normalizeName(s.name) === normalizeName(name)
    )

    let student
    let isNew = false

    if (matches.length > 0) {
      // Un compte porte déjà ce nom : il faut le code de reprise pour le
      // récupérer — le prénom seul ne donne plus accès au compte.
      let match: (typeof matches)[number] | undefined
      if (recoveryCode.length > 0) {
        match = matches.find((s) => s.recoveryCode === recoveryCode)
      } else {
        // Compte créé avant la mise à jour (code encore vide) : on l'autorise
        // une dernière fois par le nom seul et on lui attribue un code, qui
        // sera affiché immédiatement. Dans une base neuve, ce cas n'arrive jamais.
        const legacy = matches.find((s) => !s.recoveryCode)
        if (legacy) match = legacy
      }
      if (!match) {
        return NextResponse.json(
          {
            error:
              'Ce nom est déjà utilisé dans cette séance. S\u2019il s\u2019agit de vous, saisissez votre code de reprise (affiché lors de votre première connexion, visible aussi auprès de votre professeur). Sinon, précisez votre nom (ex. prénom + nom de famille) pour créer votre propre compte.',
          },
          { status: 409 }
        )
      }
      if (teamId && match.teamId && teamId !== match.teamId) {
        return NextResponse.json(
          {
            error:
              'Votre compte est rattaché à une autre équipe. Choisissez votre équipe habituelle, ou demandez au professeur de vous déplacer depuis son tableau de bord.',
          },
          { status: 409 }
        )
      }
      // Code correct (ou compte antérieur à la mise à jour) : on rend son
      // compte avec un nouveau jeton — l'ancien appareil est déconnecté
      // (comportement inchangé). Au passage, un compte sans code de reprise
      // en reçoit un, affiché à l'écran.
      const newCode = match.recoveryCode || randomRecoveryCode()
      student = await db.student.update({
        where: { id: match.id },
        data: {
          token: randomToken(),
          teamId: teamId || match.teamId,
          recoveryCode: newCode,
        },
      })
      if (!match.recoveryCode) isNew = true // montre le nouveau code à l'écran
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
          recoveryCode: randomRecoveryCode(),
          teamId: targetTeamId,
        },
      })
      isNew = true
    }

    return NextResponse.json({
      token: student.token,
      studentId: student.id,
      name: student.name,
      teamId: student.teamId,
      code: session.code,
      title: session.title,
      recoveryCode: student.recoveryCode,
      isNew,
    })
  } catch (e) {
    console.error('POST /api/join', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}
