// ============================================================
// TBL Live v3.1.0 — Tests unitaires des nouveaux mécanismes :
//  1. FILE D'ÉCRITURE (write-queue) : sérialisation stricte par
//     séance, propagation des erreurs sans casser la chaîne,
//     nettoyage de la file (pas de fuite mémoire) ;
//  2. HORLOGE SERVEUR (server-clock) : l'écart appareil ↔ serveur
//     est appliqué puis STABILISÉ (pas de tremblement à 500 ms de
//     latence réseau près) ;
//  3. ICÔNES TÉLÉVERSÉES (theme) : validation des data URL —
//     magic bytes PNG/WebP, SVG sans script, tailles limites,
//     refus des formats inconnus ;
//  4. MÉTRIQUES (metrics) : p95/p99 des requêtes, statistiques
//     d'écriture, compteurs d'erreurs de base de données, file.
// ============================================================

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// La file d'écriture importe @/lib/db (Prisma) : mocké — les tests
// ne touchent JAMAIS la base (withSessionWrite n'y va pas non plus,
// seul recordSessionEvent l'utilise, hors périmètre ici).
vi.mock('@/lib/db', () => ({ db: {} }))

import { withSessionWrite, writeQueueStats } from '@/lib/write-queue'
import { noteServerNow, serverNowMs } from '@/lib/server-clock'
import {
  sanitizeIconDataUrl,
  sanitizeTheme,
  parseStoredTheme,
  THEME_ICON_MAX_DIMENSION,
} from '@/lib/theme'
import { recordRequest, recordWrite, recordDbError, perfSnapshot } from '@/lib/metrics'

// ---------- helpers ----------

function b64(buf: Buffer): string {
  return buf.toString('base64')
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

function pngDataUrl(extra: Buffer = Buffer.alloc(0)): string {
  return `data:image/png;base64,${b64(Buffer.concat([PNG_MAGIC, extra]))}`
}

// ============================================================
// 1. FILE D'ÉCRITURE
// ============================================================

describe('withSessionWrite — sérialisation par séance', () => {
  it('exécute les travaux d’une MÊME séance UN PAR UN, dans l’ordre', async () => {
    const order: number[] = []
    const jobs = Array.from({ length: 10 }, (_, i) =>
      withSessionWrite('session-A', 'test', async () => {
        // chaque travail dure un temps différent (le plus long en
        // premier) : sans file, l'ordre d'arrivée serait bouleversé.
        await new Promise((r) => setTimeout(r, (10 - i) * 5))
        order.push(i)
        return i
      })
    )
    const results = await Promise.all(jobs)
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('les séances DIFFÉRENTES ne se bloquent pas mutuellement', async () => {
    const events: string[] = []
    const slow = withSessionWrite('session-B', 'test', async () => {
      await new Promise((r) => setTimeout(r, 150))
      events.push('B-done')
    })
    await new Promise((r) => setTimeout(r, 20))
    const fast = withSessionWrite('session-C', 'test', async () => {
      events.push('C-done')
    })
    await Promise.all([slow, fast])
    // C a terminé AVANT B (pas de verrou global) — c'est le comportement
    // voulu : deux classes en parallèle ne se ralentissent pas.
    expect(events).toEqual(['C-done', 'B-done'])
  })

  it('une erreur traverse la file SANS casser la chaîne des suivantes', async () => {
    const results: (number | null)[] = []
    const failing = withSessionWrite('session-D', 'test', async () => {
      throw new Error('boom')
    }).catch(() => 'failed')
    const next = withSessionWrite('session-D', 'test', async () => 42)
    expect(await failing).toBe('failed')
    expect(await next).toBe(42)
    void results
  })

  it('la file se VIDE après exécution (pas de fuite mémoire)', async () => {
    await withSessionWrite('session-E', 'test', async () => 1)
    await new Promise((r) => setTimeout(r, 10))
    expect(writeQueueStats().sessions).toBe(0)
  })

  it('retourne le résultat et rejette l’erreur du travail tel quel', async () => {
    const value = await withSessionWrite('session-F', 'test', async () => 'résultat')
    expect(value).toBe('résultat')
    await expect(
      withSessionWrite('session-F', 'test', async () => {
        throw new Error('erreur-métier')
      })
    ).rejects.toThrow('erreur-métier')
  })
})

// ============================================================
// 2. HORLOGE SERVEUR (problème n°11 de l'audit)
// ============================================================

describe('server-clock — horloge corrigée par le serveur', () => {
  it('applique un décalage téléphone ↔ serveur (horloge +5 min)', () => {
    const realNow = Date.now()
    // Le serveur prétend qu'il est 5 minutes PLUS TARD que le téléphone.
    noteServerNow(new Date(realNow + 5 * 60_000).toISOString())
    expect(serverNowMs() - realNow).toBeGreaterThan(4.5 * 60_000)
    expect(serverNowMs() - realNow).toBeLessThan(5.5 * 60_000)
  })

  it('un léger écart de latence réseau ne TREMBLE pas l’horloge (< 750 ms)', () => {
    const realNow = Date.now()
    noteServerNow(new Date(realNow + 10_000).toISOString())
    const first = serverNowMs() - realNow
    // 400 ms de latence réseau en plus : l'écart mesuré bouge de 400 ms,
    // la correction ne doit PAS être réappliquée (stabilité d'affichage).
    noteServerNow(new Date(realNow + 10_000 + 400).toISOString())
    const second = serverNowMs() - realNow
    expect(Math.abs(second - first)).toBeLessThan(50)
  })

  it('un VRAI changement de serveur (reconnexion) réapplique la correction', () => {
    const realNow = Date.now()
    noteServerNow(new Date(realNow).toISOString())
    const offset = serverNowMs() - realNow
    expect(Math.abs(offset)).toBeLessThan(1000)
    // 2 secondes de décalage = changement réel → correction appliquée.
    noteServerNow(new Date(realNow + 2000).toISOString())
    expect(serverNowMs() - realNow).toBeGreaterThan(1500)
  })
})

// ============================================================
// 3. ICÔNES TÉLÉVERSÉES (validation serveur)
// ============================================================

describe('sanitizeIconDataUrl — validation stricte', () => {
  it('accepte un PNG authentique (magic bytes)', () => {
    const url = pngDataUrl()
    expect(sanitizeIconDataUrl(url)).toBe(url)
  })

  it('accepte un WebP authentique (RIFF…WEBP)', () => {
    const webp = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from('WEBP', 'ascii'),
    ])
    const url = `data:image/webp;base64,${b64(webp)}`
    expect(sanitizeIconDataUrl(url)).toBe(url)
  })

  it('REFUSE un PNG contrefait (mauvais magic bytes)', () => {
    const fake = Buffer.from('ceci-nest-pas-un-png-super-long', 'utf8')
    expect(sanitizeIconDataUrl(`data:image/png;base64,${b64(fake)}`)).toBeNull()
  })

  it('REFUSE un WebP contrefait', () => {
    const fake = Buffer.from('RIFF____NOTP', 'ascii')
    expect(sanitizeIconDataUrl(`data:image/webp;base64,${b64(fake)}`)).toBeNull()
  })

  it('accepte un SVG propre (vectoriel)', () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>',
      'utf8'
    )
    const url = `data:image/svg+xml;base64,${b64(svg)}`
    expect(sanitizeIconDataUrl(url)).toBe(url)
  })

  it('REFUSE un SVG contenant un script (défense en profondeur)', () => {
    const evil = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      'utf8'
    )
    expect(sanitizeIconDataUrl(`data:image/svg+xml;base64,${b64(evil)}`)).toBeNull()
  })

  it('REFUSE un SVG avec attribut d’événement inline', () => {
    const evil = Buffer.from('<svg onload="alert(1)"><circle r="1"/></svg>', 'utf8')
    expect(sanitizeIconDataUrl(`data:image/svg+xml;base64,${b64(evil)}`)).toBeNull()
  })

  it('REFUSE un SVG avec référence externe', () => {
    const evil = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="http://pirate.example"><rect/></a></svg>',
      'utf8'
    )
    expect(sanitizeIconDataUrl(`data:image/svg+xml;base64,${b64(evil)}`)).toBeNull()
  })

  it('REFUSE les formats non listés (jpeg, gif, url http…)', () => {
    expect(sanitizeIconDataUrl('data:image/jpeg;base64,AAAA')).toBeNull()
    expect(sanitizeIconDataUrl('data:image/gif;base64,AAAA')).toBeNull()
    expect(sanitizeIconDataUrl('http://pirate.example/logo.png')).toBeNull()
    expect(sanitizeIconDataUrl('javascript:alert(1)')).toBeNull()
    expect(sanitizeIconDataUrl(null)).toBeNull()
    expect(sanitizeIconDataUrl(42)).toBeNull()
  })

  it('REFUSE un base64 invalide et les data URL trop longues', () => {
    expect(sanitizeIconDataUrl('data:image/png;base64,!!!non-base64!!!')).toBeNull()
    const huge = pngDataUrl(Buffer.alloc(200_000))
    expect(sanitizeIconDataUrl(huge)).toBeNull()
  })

  it('sanitizeTheme + parseStoredTheme transportent les icônes valides, ignorent les invalides', () => {
    const good = pngDataUrl()
    const theme = sanitizeTheme({
      primary: '#0e7490',
      customIcons: { logo: good, teacher: 'data:image/png;base64,Zm9v' },
    })
    expect(theme).not.toBeNull()
    expect(theme?.customIcons?.logo).toBe(good)
    // teacher contrefait → absent ; teacher n'existe pas dans le résultat
    expect(theme?.customIcons?.teacher).toBeUndefined()

    // Tour complet base → JSON → parse : la valeur survit.
    const parsed = parseStoredTheme(JSON.stringify(theme))
    expect(parsed.customIcons?.logo).toBe(good)
    // Une valeur altérée en base est ignorée silencieusement.
    const corrupted = parseStoredTheme(
      JSON.stringify({ customIcons: { logo: 'data:image/png;base64,' + 'A'.repeat(100) } })
    )
    expect(corrupted.customIcons).toBeUndefined()
  })

  it('les constantes de limites sont cohérentes avec la documentation', () => {
    expect(THEME_ICON_MAX_DIMENSION).toBe(4096)
  })
})

// ============================================================
// 4. MÉTRIQUES v3.1.0 (problème n°14 de l'audit)
// ============================================================

describe('metrics — p99, écritures, erreurs de base', () => {
  it('calcule p95 et p99 sur la fenêtre glissante des requêtes', () => {
    // 100 requêtes à 10 ms, 5 à 500 ms, 2 à 2000 ms → p95 ≈ 500,
    // p99 ≈ 2000 (les requêtes les plus lentes sont bien vues au p99).
    for (let i = 0; i < 100; i++) recordRequest('route-test', 10, true)
    for (let i = 0; i < 5; i++) recordRequest('route-test', 500, true)
    recordRequest('route-test', 2000, true)
    recordRequest('route-test', 2000, true)
    const snap = perfSnapshot()
    const route = snap.routes.find((r) => r.route === 'route-test')
    expect(route).toBeDefined()
    expect(route!.p95Ms).toBe(500)
    expect(route!.p99Ms).toBe(2000)
    expect(route!.count).toBe(107)
  })

  it('enregistre les écritures (attente + travail) séparément', () => {
    recordWrite('write-test', 12, 34)
    recordWrite('write-test', 8, 26)
    const snap = perfSnapshot()
    const w = snap.writes.find((x) => x.route === 'write-test')
    expect(w).toBeDefined()
    expect(w!.count).toBe(2)
    expect(w!.avgWaitMs).toBe(10)
    expect(w!.avgWorkMs).toBe(30)
    expect(w!.p95WorkMs).toBe(34)
  })

  it('compte les codes d’erreur Prisma et IGNORE les codes farfelus', () => {
    recordDbError('P2002')
    recordDbError('P2002')
    recordDbError('P1008')
    recordDbError('INJECTION-TEST') // ignoré : pas un code P\d+
    const snap = perfSnapshot()
    expect(snap.dbErrors['P2002']).toBe(2)
    expect(snap.dbErrors['P1008']).toBe(1)
    expect(snap.dbErrors['INJECTION-TEST']).toBeUndefined()
  })
})

// Petit garde-fou de non-régression : les métriques du snapshot
// exposent bien la profondeur de file (champ nouveau v3.1.0).
describe('metrics — structure du snapshot', () => {
  it('expose writeQueueDepth ≥ 0', () => {
    expect(perfSnapshot().writeQueueDepth).toBeGreaterThanOrEqual(0)
  })
})

beforeEach(() => {
  vi.restoreAllMocks?.()
})
afterEach(() => {
  // rien à nettoyer : les modules testés n'ont pas d'état persistant
  // gênant entre les tests (les compteurs cumulent, c'est voulu).
})
