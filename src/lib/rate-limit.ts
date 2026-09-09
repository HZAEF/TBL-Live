// ============================================================
// TBL Live v3.2.0 — Limiteur de débit en mémoire (token bucket)
//
// PROBLÈME (rapport d'audit, point n°5) : en mode local (processus
// Node unique sur le PC de l'enseignant), AUCUNE limite n'empêchait
// un client défaillant (bug navigateur, onglet zombie, extension,
// boucle de rafraîchissement) de bombarder les routes de sondage à
// un rythme déraisonnable — le polling en boucle trop rapide d'UN
// seul étudiant pouvait consommer le serveur pendant que les 149
// autres subissaient la latence.
//
// SOLUTION — un seau de jetons PAR CLÉ (jeton étudiant, ou IP pour
// /api/join), en mémoire du processus :
//  - capacité « burst » (crédit initial, dépensable d'un coup) ;
//  - remplissage continu « refillPerMinute » jetons/minute ;
//  - réponse 429 avec Retry-After dès le seau vide → le client
//    repart avec son backoff réseau existant (doublement du délai
//    à chaque échec, plafond 30 s) : la limitation est auto-repair,
//    sans intervention de l'enseignant.
//
// CALIBRAGE (ne jamais gêner une séance réelle — voir tests) :
//  - /api/student/revision : le sondage le plus fréquent sonde
//    toutes les 2 s en phase active = 30 requêtes/min ; un étudiant
//    « normal » consomme AUSSI des rafraîchissements forcés après
//    chaque réponse (refresh(force)) → burst 15, 75/min. Un client
//    sain reste à ~moitié du plafond ;
//  - /api/student : l'état complet n'est tiré qu'au changement de
//    numéro → burst 12, 60/min ;
//  - /api/join : 150 étudiants rejoignent EN RAFALE au début de la
//    séance (c'est le comportement NORMAL, testé par le test de
//    charge v3.1 : 150 joins simultanés p95 ~1 s) → la limite est
//    par IP et TRÈS haute (burst 120, 300/min) : elle n'attrape
//    que les vraies boucles défaillantes.
//
// PORTÉE (honnêteté technique, comme la file d'écriture) :
//  - SERVEUR LOCAL : exact — un seul processus, tous les clients
//    passent par ce seau ;
//  - VERCEL (serverless) : chaque instance a ses seaux en mémoire —
//    best-effort seulement. C'est ACCEPTÉ : la vocation de cette
//    protection est le mode local (un seul serveur, une seule
//    salle), où le risque est réel ; en ligne, l'auto-scale et les
//    contraintes de base couvrent déjà le reste.
// ============================================================

/** Un seau par clé : jetons disponibles + date du dernier remplissage. */
interface Bucket {
  tokens: number
  last: number
}

const buckets = new Map<string, Bucket>()

/** Plafond mémoire : nettoie les seaux inactifs (> 1000 clés). */
const MAX_BUCKETS = 5000
const IDLE_MS = 10 * 60_000

export interface RateLimitConfig {
  /** Crédit initial / taille du burst. */
  capacity: number
  /** Jetons ajoutés par minute (remplissage continu). */
  refillPerMinute: number
}

export interface RateLimitVerdict {
  ok: boolean
  /** Secondes à attendre avant de réessayer (pour Retry-After). */
  retryAfterSec: number
  /** Jetons restants (diagnostic, jamais renvoyé au client). */
  tokensLeft: number
}

/** Purge opportuniste des seaux dormants (pas de fuite mémoire). */
function prune(now: number): void {
  if (buckets.size <= MAX_BUCKETS) return
  for (const [k, b] of buckets) {
    if (now - b.last > IDLE_MS) buckets.delete(k)
    if (buckets.size <= MAX_BUCKETS) break
  }
}

/**
 * Consomme un jeton pour la clé, si le seau le permet.
 * Testable de façon déterministe (horloge injectable).
 */
export function rateLimit(
  key: string,
  cfg: RateLimitConfig,
  nowMs: number = Date.now()
): RateLimitVerdict {
  const cap = Math.max(1, cfg.capacity)
  const refillPerMs = Math.max(0.000001, cfg.refillPerMinute) / 60_000
  let b = buckets.get(key)
  if (!b) {
    b = { tokens: cap, last: nowMs }
    buckets.set(key, b)
  }
  // Remplissage continu depuis le dernier passage (capped à capacité).
  const elapsed = Math.max(0, nowMs - b.last)
  b.tokens = Math.min(cap, b.tokens + elapsed * refillPerMs)
  b.last = nowMs
  prune(nowMs)
  if (b.tokens >= 1) {
    b.tokens -= 1
    return { ok: true, retryAfterSec: 0, tokensLeft: b.tokens }
  }
  // Seau vide : délai pour reconstituer UN jeton.
  const ms = (1 - b.tokens) / refillPerMs
  return {
    ok: false,
    retryAfterSec: Math.max(1, Math.ceil(ms / 1000)),
    tokensLeft: 0,
  }
}

/** Remise à zéro (tests uniquement). */
export function resetRateLimits(): void {
  buckets.clear()
}

/** Nombre de clés suivies (diagnostic / tests). */
export function rateLimitKeyCount(): number {
  return buckets.size
}

/** Limite pour le sondage allégé étudiant (par JETON étudiant). */
export const RATE_REVISION: RateLimitConfig = { capacity: 15, refillPerMinute: 75 }

/** Limite pour l'état complet étudiant (par JETON étudiant). */
export const RATE_STUDENT: RateLimitConfig = { capacity: 12, refillPerMinute: 60 }

/** Limite pour l'inscription (par IP — la rafale de début de séance est
 *  NORMALE : 150-200 étudiants d'un coup, comme le teste le test de
 *  charge v3.1/v3.2 → capacité ≥ taille maximale d'une classe ; ne
 *  freine que les vraies boucles défaillantes). */
export const RATE_JOIN: RateLimitConfig = { capacity: 250, refillPerMinute: 600 }
