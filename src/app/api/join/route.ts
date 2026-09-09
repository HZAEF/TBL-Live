import { NextRequest, NextResponse } from 'next/server'
import { withMetrics } from '@/lib/metrics'
import { db } from '@/lib/db'
import { getSessionByCode, randomToken, randomRecoveryCode, normalizeName } from '@/lib/tbl'
import { bumpRevisions } from '@/lib/revision'
import { withSessionWrite, recordSessionEvent, eventOriginFromHeader } from '@/lib/write-queue'

// POST /api/join — l'étudiant rejoint une séance
//
// v2.6.0 : chaque étudiant CHOISIT lui-même son code personnel (4 à 12
// caractères, chiffres et lettres) au moment de saisir son nom — il est
// OBLIGATOIRE. Ce code permet de reprendre sa séance (autre appareil,
// navigateur vidé) : pour récupérer son compte, il saisit son nom ET son
// code personnel. Conséquences :
//  - impossible d'usurper le compte d'un camarade en connaissant juste son
//    prénom ;
//  - deux homonymes ne « s'éjectent » plus mutuellement : le second est
//    invité à se différencier (nom de famille) au lieu de voler le compte.
// Les comptes créés avant la v2.6.0 gardent leur code généré (6 caractères)
// — parfaitement compatible avec la reprise par nom + code.
async function doPOST(req: NextRequest) {
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

    // v3.1.0 — VERROU D'ÉCRITURE POUR LE JOIN (problème n°2 de l'audit) :
    // l'ancienne séquence « lire les équipes → compter les membres →
    // choisir la moins remplie → insérer » n'était PAS atomique : avec
    // 50 à 150 joins simultanés, des dizaines de requêtes lisaient les
    // MÊMES compteurs et choisissaient la MÊME équipe (déséquilibre
    // massif). Tout le bloc est désormais sérialisé par séance :
    // chaque insertion est suivie du recalcul — la répartition reste
    // équilibrée MÊME sous une rafale de 150 inscriptions en même
    // temps (vérifié par le test de charge : écart max ≤ 1). La
    // contrainte unique du jeton étudiant reste la protection finale
    // inter-instances (serverless).
    const origin = eventOriginFromHeader(req.headers.get('x-tbl-origin'))
    const result = await withSessionWrite(
      session.id,
      'join',
      async (): Promise<
        | { kind: 'student'; student: { token: string; id: string; name: string; teamId: string | null; recoveryCode: string }; isNew: boolean }
        | { kind: 'error'; error: string; status: 409 | 400 }
      > => {
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
        return {
          kind: 'error',
          error:
            'Ce nom est déjà utilisé dans cette séance. S\u2019il s\u2019agit de vous, saisissez votre code personnel (choisi lors de votre première connexion, visible aussi auprès de votre professeur). Sinon, précisez votre nom (ex. prénom + nom de famille) pour créer votre propre compte.',
          status: 409 as const,
        }
      }
      if (teamId && match.teamId && teamId !== match.teamId) {
        return {
          kind: 'error',
          error:
            'Votre compte est rattaché à une autre équipe. Choisissez votre équipe habituelle, ou demandez au professeur de vous déplacer depuis son tableau de bord.',
          status: 409 as const,
        }
      }
      // Code correct (ou compte antérieur à la mise à jour) : on rend son
      // compte avec un nouveau jeton — l'ancien appareil est déconnecté
      // (comportement inchangé). Au passage, un compte sans code de reprise
      // en reçoit un, affiché à l'écran.
      const newCode = match.recoveryCode || randomRecoveryCode()
      const student = await db.student.update({
        where: { id: match.id },
        data: {
          token: randomToken(),
          teamId: teamId || match.teamId,
          recoveryCode: newCode,
        },
      })
      // v2.9.0 : retour d'un étudiant (changement d'équipe possible) →
      // compteurs + 1.
      await bumpRevisions(session.id)
      return { kind: 'student', student, isNew: !match.recoveryCode }
    }
      // v2.6.0 : premier compte pour ce nom — le code personnel choisi par
      // l'étudiant est OBLIGATOIRE (4 à 12 caractères, chiffres et lettres).
      // Un compte existant ne passe jamais ici (branche « matches »).
      if (!/^[A-Z0-9]{4,12}$/.test(recoveryCode)) {
        return {
          kind: 'error',
          error:
            'Le code personnel doit contenir entre 4 et 12 caractères (chiffres et lettres, sans accents ni symboles).',
          status: 400 as const,
        }
      }
      // Vérifie que l'équipe demandée appartient bien à la séance
      let targetTeamId = teamId
      if (targetTeamId) {
        const team = await db.team.findFirst({
          where: { id: targetTeamId, sessionId: session.id },
        })
        if (!team) targetTeamId = null
      }
      if (!targetTeamId) {
        // Affectation automatique : l'équipe la moins remplie (recalculée
        // SOUS le verrou → équilibrée même sous rafale de 150 joins).
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
      const student = await db.student.create({
        data: {
          sessionId: session.id,
          name,
          token: randomToken(),
          // v2.6.0 : code CHOISI par l'étudiant (validé ci-dessus)
          recoveryCode,
          teamId: targetTeamId,
        },
      })
      // v2.9.0 : nouvel étudiant → compteurs + 1.
      await bumpRevisions(session.id)
      await recordSessionEvent(
        session.id,
        'join',
        student.id,
        { teamId: student.teamId },
        origin
      )
      return { kind: 'student', student, isNew: true }
      }
    )

    if (result.kind === 'error') {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({
      token: result.student.token,
      studentId: result.student.id,
      name: result.student.name,
      teamId: result.student.teamId,
      code: session.code,
      title: session.title,
      recoveryCode: result.student.recoveryCode,
      isNew: result.isNew,
    })
  } catch (e) {
    console.error('POST /api/join', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}

export const POST = withMetrics<unknown>(
  'join',
  doPOST
)
