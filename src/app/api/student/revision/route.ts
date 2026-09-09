import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { extractToken } from '@/lib/tbl'
import { recordRequest } from '@/lib/metrics'
import { rateLimit, RATE_REVISION } from '@/lib/rate-limit'

// ============================================================
// TBL Live v3.0.0 — GET /api/student/revision : sondage ALLÉGÉ
//
// Le client étudiant sonde CETTE route (2 s en phase active,
// 5 s en attente) : UNE requête en base (l'étudiant par son jeton,
// avec sa séance et son équipe) → une réponse de quelques octets :
//   { revision, teamRevision, serverNow }
//
// Tant que les deux numéros correspondent à ceux de l'étudiant, il
// ne se passe RIEN (pas d'état complet, pas de re-rendu React) ;
// dès qu'un numéro change (phase tournée, réponse de SON équipe,
// révélation…), le client demande l'état complet — avec un léger
// décalage aléatoire qui étale la classe dans le temps.
//
// Deux numéros :
//  - revision      : changements visibles par TOUS les étudiants ;
//  - teamRevision  : changements visibles par les membres de SON
//    ÉQUIPE seulement (tentatives tRAT, carte à gratter) — c'est ce
//    qui évite à 150 étudiants de se recharger pour une réponse
//    d'UNE seule équipe.
// ============================================================

export async function GET(req: NextRequest) {
  const started = Date.now()
  try {
    const token = extractToken(req)
    if (!token) {
      return NextResponse.json({ error: 'Jeton manquant.' }, { status: 400 })
    }
    // v3.2.0 — garde-fou de débit (audit point n°5) : un client
    // défaillant qui bouclerait trop vite est ralenti par 429 +
    // Retry-After ; le client sain (sondage 2 s + rafraîchissements
    // forcés) reste à mi-seau. Le backoff existant fait le reste.
    const verdict = rateLimit(`rev:${token}`, RATE_REVISION)
    if (!verdict.ok) {
      recordRequest('revision', Date.now() - started, false)
      const res = NextResponse.json(
        { error: 'Trop de requêtes — ralentissez, la séance continue.' },
        { status: 429 }
      )
      res.headers.set('Retry-After', String(verdict.retryAfterSec))
      return res
    }
    const student = await db.student.findUnique({
      where: { token },
      include: {
        session: { select: { revision: true, deletedAt: true } },
        team: { select: { revisionTeam: true } },
      },
    })
    if (!student) {
      recordRequest('revision', Date.now() - started, false)
      return NextResponse.json(
        { error: 'Connexion perdue. Rejoignez à nouveau la séance.' },
        { status: 404 }
      )
    }
    if (student.session.deletedAt) {
      recordRequest('revision', Date.now() - started, false)
      return NextResponse.json(
        { error: 'Cette séance a été supprimée par l\u2019enseignant.' },
        { status: 410 }
      )
    }
    recordRequest('revision', Date.now() - started, true, token)
    return NextResponse.json({
      revision: student.session.revision,
      teamRevision: student.team ? student.team.revisionTeam : null,
      serverNow: new Date().toISOString(),
    })
  } catch (e) {
    recordRequest('revision', Date.now() - started, false)
    console.error('GET /api/student/revision', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}
