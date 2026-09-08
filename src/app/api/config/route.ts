import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// ============================================================
// GET /api/config — configuration publique de l'application
// (v2.9.0, espace administrateur).
//
// Réponse minuscule, lisible par n'importe qui (aucun secret) :
//  - syncIntervalMs : délai du cycle de synchronisation
//    Internet ↔ réseau local, réglé dans /admin (défaut 5000 ms) ;
//  - texts : personnalisations de texte { origine: remplacement }.
//
// Tolère une base pas encore initialisée (premier déploiement,
// table absente) : réglages par défaut.
// ============================================================

export async function GET() {
  try {
    const row = await db.adminSetting.findUnique({ where: { id: 'singleton' } })
    if (!row) return NextResponse.json({ syncIntervalMs: 5000, texts: {} })
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
    })
  } catch {
    // table absente ou base indisponible : réglages d'origine
    return NextResponse.json({ syncIntervalMs: 5000, texts: {} })
  }
}
