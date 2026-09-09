// ============================================================
// TBL Live v3.0.0 — Instrumentation en mémoire
//
// Compteurs légers pour l'espace administrateur et le tableau de
// bord : requêtes par route, latence (moyenne + p95), erreurs,
// étudiants actifs (jetons distincts vus dans la dernière minute).
//
// PRINCIPE : tout vit en mémoire de l'instance, zéro écriture en
// base, coût négligeable par requête (quelques additions).
//  - SERVEUR LOCAL (le PC de l'enseignante) : chiffres EXACTS,
//    toutes les requêtes passent par la même instance ;
//  - VERCEL (en ligne) : les fonctions se répartissent en
//    instances — les chiffres sont une estimation (ce que CETTE
//    instance a vu). Suffisant pour repérer un problème pendant
//    un cours (l'enseignante regarde surtout le mode local).
// ============================================================

interface RouteStats {
  count: number
  errors: number
  totalMs: number
  lastMs: number
  /** 200 dernières durées (fenêtre glissante pour le p95/p99). */
  recent: number[]
}

interface WriteStats {
  count: number
  totalWorkMs: number
  totalWaitMs: number
  recent: number[]
}

const routes = new Map<string, RouteStats>()
const MAX_RECENT = 200

// v3.1.0 — Statistiques de la FILE D'ÉCRITURE (verrou par séance) :
// attente avant le verrou + durée réelle du travail d'écriture.
const writes = new Map<string, WriteStats>()

// v3.1.0 — Codes d'erreur Prisma vus (P2002 double envoi idempotent,
// P1008 délai de transaction dépassé, P2024 timeout connexion, P2033…).
// P1008 et P2024 en croissance = contention SQLite/connexion à
// diagnostiquer immédiatement ; P2002 est NORMAL (idempotence).
const dbErrors = new Map<string, number>()

/** v3.1.0 — File d'écriture : travaux en attente + en cours (toutes
 *  séances confondues) — un pic passager est normal (rafale de
 *  réponses), une valeur qui grimpe sans redescendre = blocage. */
let writeQueueDepth = 0

/** Jetons étudiants vus récemment → estimation « étudiants actifs ». */
const activeTokens = new Map<string, number>()
const MAX_TOKENS = 2000
const ACTIVE_WINDOW_MS = 60_000

const startedAt = Date.now()

function statsFor(route: string): RouteStats {
  let s = routes.get(route)
  if (!s) {
    s = { count: 0, errors: 0, totalMs: 0, lastMs: 0, recent: [] }
    routes.set(route, s)
  }
  return s
}

/**
 * v3.1.0 — Enregistre une ÉCRITURE passée par la file (verrou par
 * séance) : attente dans la file + durée du travail lui-même.
 */
export function recordWrite(route: string, waitMs: number, workMs: number): void {
  let s = writes.get(route)
  if (!s) {
    s = { count: 0, totalWorkMs: 0, totalWaitMs: 0, recent: [] }
    writes.set(route, s)
  }
  s.count += 1
  s.totalWorkMs += workMs
  s.totalWaitMs += waitMs
  s.recent.push(workMs)
  if (s.recent.length > MAX_RECENT) s.recent.shift()
}

/** v3.1.0 — Enregistre un code d'erreur de base de données (P1008,
 * P2024, P2002…). Les exceptions Prisma portent un champ « code ».
 */
export function recordDbError(code: string): void {
  if (!/^P[0-9]{3,4}$/.test(code)) return
  dbErrors.set(code, (dbErrors.get(code) ?? 0) + 1)
}

/** v3.1.0 — Compteur global de la file d'écriture (attente + en cours). */
export function recordWriteQueueDelta(delta: number): void {
  writeQueueDepth = Math.max(0, writeQueueDepth + delta)
}

/**
 * Enregistre une requête traitée.
 * @param route nom court (ex. « student », « revision », « answer »)
 * @param ms durée de traitement en millisecondes
 * @param ok false = réponse d'erreur (4xx/5xx)
 * @param token jeton étudiant (optionnel — alimente « actifs »)
 */
export function recordRequest(route: string, ms: number, ok: boolean, token?: string): void {
  const s = statsFor(route)
  s.count += 1
  if (!ok) s.errors += 1
  s.totalMs += ms
  s.lastMs = ms
  s.recent.push(ms)
  if (s.recent.length > MAX_RECENT) s.recent.shift()
  if (token) {
    if (activeTokens.size >= MAX_TOKENS) {
      // Nettoyage opportuniste : retire les jetons expirés.
      const cutoff = Date.now() - ACTIVE_WINDOW_MS
      for (const [t, at] of activeTokens) {
        if (at < cutoff) activeTokens.delete(t)
        if (activeTokens.size < MAX_TOKENS) break
      }
    }
    if (activeTokens.size < MAX_TOKENS) activeTokens.set(token, Date.now())
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[idx]
}

// ---------------- Enveloppe d'instrumentation ----------------

import type { NextRequest, NextResponse } from 'next/server'

/** Enveloppe une route API : mesure la durée, compte les erreurs. */
export function withMetrics<C>(
  route: string,
  handler: (req: NextRequest, ctx: C) => Promise<NextResponse>
): (req: NextRequest, ctx: C) => Promise<NextResponse> {
  return async (req: NextRequest, ctx: C): Promise<NextResponse> => {
    const started = Date.now()
    try {
      const res = await handler(req, ctx)
      recordRequest(route, Date.now() - started, res.status < 400)
      return res
    } catch (e) {
      recordRequest(route, Date.now() - started, false)
      // v3.1.0 — capture AUTOMATIQUE des codes Prisma (P1008 contention,
      // P2024 timeout, P2002 double envoi idempotent…) sans rien logger :
      // l'erreur elle-même n'est jamais sérialisée (aucun secret, aucun
      // body de requête n'entre dans les compteurs).
      const code = (e as { code?: unknown } | null)?.code
      if (typeof code === 'string') recordDbError(code)
      throw e
    }
  }
}

export interface PerfSnapshot {
  uptimeSec: number
  activeStudents: number
  requestsPerMinute: number
  routes: {
    route: string
    count: number
    errors: number
    avgMs: number
    p95Ms: number
    p99Ms: number
    lastMs: number
  }[]
  // v3.1.0
  writes: { route: string; count: number; avgWorkMs: number; p95WorkMs: number; avgWaitMs: number }[]
  dbErrors: Record<string, number>
  writeQueueDepth: number
}

/** Photographie des compteurs (affichée dans /admin et /api/config?live=1). */
export function perfSnapshot(): PerfSnapshot {
  const now = Date.now()
  const cutoff = now - ACTIVE_WINDOW_MS
  for (const [t, at] of activeTokens) {
    if (at < cutoff) activeTokens.delete(t)
  }
  const windowSec = Math.max(5, Math.min(300, (now - startedAt) / 1000))
  const totalRequests = [...routes.values()].reduce((n, s) => n + s.count, 0)
  return {
    uptimeSec: Math.round((now - startedAt) / 1000),
    activeStudents: activeTokens.size,
    requestsPerMinute: Math.round((totalRequests / windowSec) * 60),
    routes: [...routes.entries()]
      .map(([route, s]) => ({
        route,
        count: s.count,
        errors: s.errors,
        avgMs: s.count > 0 ? Math.round(s.totalMs / s.count) : 0,
        p95Ms: percentile([...s.recent].sort((a, b) => a - b), 95),
        p99Ms: percentile([...s.recent].sort((a, b) => a - b), 99),
        lastMs: s.lastMs,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
    writes: [...writes.entries()]
      .map(([route, s]) => ({
        route,
        count: s.count,
        avgWorkMs: s.count > 0 ? Math.round(s.totalWorkMs / s.count) : 0,
        p95WorkMs: percentile([...s.recent].sort((a, b) => a - b), 95),
        avgWaitMs: s.count > 0 ? Math.round(s.totalWaitMs / s.count) : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
    dbErrors: Object.fromEntries(dbErrors),
    writeQueueDepth,
  }
}
