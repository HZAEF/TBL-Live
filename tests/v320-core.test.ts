// ============================================================
// TBL Live v3.2.0 — Tests unitaires des nouveaux mécanismes :
//  1. LIMITEUR DE DÉBIT (rate-limit) : seau de jetons — burst,
//     remplissage continu, 429 + Retry-After, clés isolées,
//     calibration NE gênant JAMAIS un client sain ;
//  2. PARTAGE (sharing) : validation des emails d'invitation —
//     format, domaine institutionnel, normalisation ;
//  3. STOCKAGE (storage) : formatage des volumes, coupure de
//     période (mois calendaires), garde-fou « séance vivante ».
// ============================================================

import { describe, expect, it, vi, beforeEach } from 'vitest'

// Les modules testés importent @/lib/db (Prisma) : mocké — ces tests
// ne touchent JAMAIS la base (aucune des fonctions testées ne l'utilise).
vi.mock('@/lib/db', () => ({ db: {} }))

import {
  rateLimit,
  resetRateLimits,
  rateLimitKeyCount,
  RATE_REVISION,
  RATE_STUDENT,
  RATE_JOIN,
} from '@/lib/rate-limit'
import { checkShareEmail, MAX_COLLABORATORS } from '@/lib/sharing'
import { monthsAgo, isRecentlyActive, formatBytes, LIVE_GUARD_HOURS } from '@/lib/storage'

// ============================================================
// 1. LIMITEUR DE DÉBIT (token bucket)
// ============================================================

describe('rateLimit — seau de jetons', () => {
  beforeEach(() => {
    resetRateLimits()
  })

  it('laisse passer le BURST initial puis refuse (429 + Retry-After)', () => {
    const cfg = { capacity: 3, refillPerMinute: 60 }
    const t0 = 1_000_000
    expect(rateLimit('k', cfg, t0).ok).toBe(true)
    expect(rateLimit('k', cfg, t0).ok).toBe(true)
    expect(rateLimit('k', cfg, t0).ok).toBe(true)
    const refused = rateLimit('k', cfg, t0)
    expect(refused.ok).toBe(false)
    // 60 jetons/min = 1/s → 1 jeton reconstitué en ~1 s.
    expect(refused.retryAfterSec).toBeGreaterThanOrEqual(1)
    expect(refused.retryAfterSec).toBeLessThanOrEqual(2)
  })

  it('se remplit CONTINUEMENT : la capacité n’est pas un quota horaire', () => {
    const cfg = { capacity: 2, refillPerMinute: 120 } // 2 jetons/s
    let now = 0
    // épuise le burst
    rateLimit('k', cfg, now)
    rateLimit('k', cfg, now)
    expect(rateLimit('k', cfg, now).ok).toBe(false)
    // 1 seconde plus tard : ~2 jetons reconstitués
    now += 1000
    expect(rateLimit('k', cfg, now).ok).toBe(true)
    expect(rateLimit('k', cfg, now).ok).toBe(true)
    expect(rateLimit('k', cfg, now).ok).toBe(false)
  })

  it('ISOLE les clés : un étudiant défaillant ne freine pas les autres', () => {
    const cfg = { capacity: 2, refillPerMinute: 0 }
    const now = 5_000_000
    rateLimit('runaway', cfg, now)
    rateLimit('runaway', cfg, now)
    expect(rateLimit('runaway', cfg, now).ok).toBe(false)
    // l'autre étudiant a son PROPRE seau, plein
    expect(rateLimit('healthy', cfg, now).ok).toBe(true)
  })

  it('plafonne le remplissage à la capacité (pas de crédit accumulé)', () => {
    const cfg = { capacity: 3, refillPerMinute: 6000 }
    const now = 10_000_000
    // 10 minutes d’inactivité → toujours 3 jetons au maximum.
    expect(rateLimit('k', cfg, now + 600_000).ok).toBe(true)
    expect(rateLimit('k', cfg, now + 600_000).ok).toBe(true)
    expect(rateLimit('k', cfg, now + 600_000).ok).toBe(true)
    expect(rateLimit('k', cfg, now + 600_000).ok).toBe(false)
  })

  it('CALIBRATION : un client sain (sondage 2 s + rafraîchissements forcés) ne touche jamais le plafond', () => {
    // Simulation de 60 s de sondage NORMAL : 1 requête / 2 s = 30
    // requêtes + 10 rafraîchissements forcés (réponses envoyées) = 40.
    let now = 0
    let refused = 0
    for (let i = 0; i < 30; i++) {
      if (!rateLimit(`stu:${i % 1}`, RATE_REVISION, now).ok) refused++
      now += 2000
    }
    for (let i = 0; i < 10; i++) {
      if (!rateLimit('stu:0', RATE_STUDENT, now).ok) refused++
    }
    expect(refused).toBe(0)
  })

  it('CALIBRATION : la rafale de 150 joins simultanés (début de séance) passe', () => {
    // 150 requêtes en 10 s depuis des IP distinctes (salle réelle)…
    let now = 0
    let refused = 0
    for (let i = 0; i < 150; i++) {
      if (!rateLimit(`join:192.168.1.${i}`, RATE_JOIN, now).ok) refused++
    }
    expect(refused).toBe(0)
    // …et même depuis UNE seule IP (test de charge, NAT de salle) :
    resetRateLimits()
    refused = 0
    for (let i = 0; i < 150; i++) {
      if (!rateLimit('join:10.0.0.5', RATE_JOIN, now).ok) refused++
    }
    // capacité 250 : la rafale de test de charge (150) passe ENTÈREMENT.
    expect(refused).toBe(0)
    // au-delà (client en boucle) : freiné.
    for (let i = 0; i < 350; i++) {
      if (!rateLimit('join:10.0.0.6', RATE_JOIN, now).ok) refused++
    }
    expect(refused).toBeGreaterThan(0)
  })

  it('compte les clés sans fuite (purge des seaux dormants)', () => {
    const cfg = { capacity: 1, refillPerMinute: 1 }
    const now = Date.now()
    for (let i = 0; i < 100; i++) rateLimit(`x${i}`, cfg, now)
    expect(rateLimitKeyCount()).toBe(100)
    // 11 minutes plus tard, 100 nouvelles clés → purge opportuniste.
    const later = now + 11 * 60_000
    for (let i = 0; i < 100; i++) rateLimit(`y${i}`, cfg, later)
    expect(rateLimitKeyCount()).toBeLessThanOrEqual(200)
  })
})

// ============================================================
// 2. PARTAGE — validation des emails d'invitation
// ============================================================

describe('checkShareEmail — invitations de co-animation', () => {
  const domain = '@famso.u-sousse.tn'

  it('accepte un email institutionnel et le NORMALISE (espaces, casse)', () => {
    const check = checkShareEmail('  Sophie.Martin@FAMSO.U-Sousse.TN ', domain)
    expect(check.ok).toBe(true)
    if (check.ok) expect(check.email).toBe('sophie.martin@famso.u-sousse.tn')
  })

  it('refuse un email hors domaine institutionnel (message clair)', () => {
    const check = checkShareEmail('prof@gmail.com', domain)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.error).toContain('@famso.u-sousse.tn')
  })

  it('refuse les formats invalides et l’absence d’email', () => {
    expect(checkShareEmail('', domain).ok).toBe(false)
    expect(checkShareEmail('pasunemail', domain).ok).toBe(false)
    expect(checkShareEmail('a@b', domain).ok).toBe(false)
    expect(checkShareEmail(null, domain).ok).toBe(false)
  })

  it('ne bloque pas si le domaine réglé est malformé (réglage inattendu)', () => {
    // le domaine ne commence pas par @ → la vérification est neutre
    expect(checkShareEmail('prof@example.edu', 'example.edu').ok).toBe(true)
  })

  it('limite le nombre d’invitations par séance', () => {
    expect(MAX_COLLABORATORS).toBeGreaterThanOrEqual(5)
    expect(MAX_COLLABORATORS).toBeLessThanOrEqual(20)
  })
})

// ============================================================
// 3. STOCKAGE — coupures, garde-fous, formatage
// ============================================================

describe('monthsAgo / isRecentlyActive — garde-fous de purge', () => {
  it('coupe à N mois calendaires (même jour, même heure)', () => {
    const cut = monthsAgo(3)
    const expected = new Date()
    expected.setMonth(expected.getMonth() - 3)
    expect(Math.abs(cut.getTime() - expected.getTime())).toBeLessThan(60000)
  })

  it('protège une séance dont la phase a démarré récemment', () => {
    const justStarted = { phaseStartedAt: new Date(Date.now() - 60_000) }
    const yesterday = { phaseStartedAt: new Date(Date.now() - 26 * 3600_000) }
    const lastWeek = { phaseStartedAt: new Date(Date.now() - 8 * 24 * 3600_000) }
    expect(isRecentlyActive(justStarted)).toBe(true)
    expect(isRecentlyActive(yesterday)).toBe(true)
    expect(isRecentlyActive(lastWeek)).toBe(false)
    // le garde-fou est bien de 48 h
    const justPast = { phaseStartedAt: new Date(Date.now() - (LIVE_GUARD_HOURS * 3600_000 + 60_000)) }
    expect(isRecentlyActive(justPast)).toBe(false)
  })
})

describe('formatBytes — volumes lisibles', () => {
  it('formate octets, Ko, Mo, Go (virgule française)', () => {
    expect(formatBytes(500)).toBe('500 o')
    expect(formatBytes(2048)).toBe('2,0 Ko')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5,0 Mo')
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3,00 Go')
  })
  it('dégrade proprement les valeurs impossibles', () => {
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(Number.NaN)).toBe('—')
  })
})
