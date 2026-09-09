import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { perfSnapshot } from '@/lib/metrics'
import { parseStoredTheme } from '@/lib/theme'

// ============================================================
// GET /api/config — configuration publique de l'application
// (v2.9.0 espace administrateur, étendue en v3.0.0).
//
// Réponse minuscule, lisible par n'importe qui (aucun secret) :
//  - syncIntervalMs : délai du cycle de synchronisation
//    Internet ↔ réseau local, réglé dans /admin (défaut 5000 ms) ;
//  - texts : personnalisations de texte { origine: remplacement } ;
//  - theme : couleurs + icônes choisies dans /admin → Apparence
//    (appliquées au démarrage, variables CSS Tailwind) ;
//  - ?live=1 : instrumentation en direct (étudiants actifs,
//    requêtes/minute) — quelques octets, pour le tableau de bord
//    enseignant et l'espace administrateur.
//
// Tolère une base pas encore initialisée (premier déploiement,
// table absente) : réglages par défaut.
// ============================================================

export async function GET(req: Request) {
  try {
    const wantLive = new URL(req.url).searchParams.get('live') === '1'
    const row = await db.adminSetting.findUnique({ where: { id: 'singleton' } })
    if (!row) {
      return NextResponse.json({
        syncIntervalMs: 5000,
        texts: {},
        theme: {},
        ...(wantLive ? { live: liveStats() } : {}),
      })
    }
    let texts: Record<string, string> = {}
    try {
      const parsed = JSON.parse(row.textOverrides) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        texts = parsed as Record<string, string>
      }
    } catch {
      texts = {}
    }
    const ms = row.syncIntervalMs
    return NextResponse.json({
      syncIntervalMs: Number.isInteger(ms) && ms >= 2000 && ms <= 60_000 ? ms : 5000,
      texts,
      theme: parseStoredTheme(row.theme),
      ...(wantLive ? { live: liveStats() } : {}),
    })
  } catch {
    // table absente ou base indisponible : réglages d'origine
    return NextResponse.json({ syncIntervalMs: 5000, texts: {}, theme: {} })
  }
}

function liveStats() {
  const snap = perfSnapshot()
  return {
    activeStudents: snap.activeStudents,
    requestsPerMinute: snap.requestsPerMinute,
  }
}
