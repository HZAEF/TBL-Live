'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { t, translateApiError } from '@/lib/i18n'

export class ApiError extends Error {
  status: number
  /** v3.1.0 — NATURE de l'échec, pour un message adapté :
   *  - 'network' : requête jamais partie / réseau coupé → la réponse
   *    n'est probablement PAS enregistrée, réessayer est sûr (et
   *    idempotent côté serveur) ;
   *  - 'timeout' : le serveur n'a pas répondu à temps → la réponse
   *    est PEUT-ÊTRE enregistrée — le réessai renverra « déjà
   *    enregistré » (succès), jamais un doublon ;
   *  - 'server' : le serveur a répondu par une erreur. */
  kind: 'network' | 'timeout' | 'server'
  /** v3.1.0 — corps JSON de la réponse d'erreur (peut porter des
   *  champs comme syncNeeded / currentPhase) — jamais loggé, jamais
   *  affiché tel quel. */
  body: Record<string, unknown> | null
  constructor(
    message: string,
    status: number,
    kind: 'network' | 'timeout' | 'server' = 'server',
    body: Record<string, unknown> | null = null
  ) {
    super(message)
    this.status = status
    this.kind = kind
    this.body = body
  }
  /** Champ présent dans le corps d'erreur (ex. syncNeeded). */
  has(field: string): boolean {
    return this.body?.[field] === true
  }
}

/** v3.1.0 — Délai d'annulation des REQUÊTES D'ÉTAT (sondage, état
 *  complet) : généreux (réseau mobile, Wi-Fi de salle chargé) ; au-delà,
 *  la requête est abandonnée et RETENTÉE au prochain cycle. */
const FETCH_TIMEOUT_MS = 25_000

export interface ApiOptions extends RequestInit {
  /** v3.1.0 — Timeout de la requête (ms). Défaut : 25 s. Les MUTATIONS
   *  l'allongent peu : un POST qui traîne est converti en échec clair
   *  « réessayer », et le réessai est idempotent côté serveur. */
  timeoutMs?: number
  /** v3.1.0 — Annulation externe (changement d'écran). */
  signal?: AbortSignal | undefined
}

export async function api<T>(path: string, init?: ApiOptions): Promise<T> {
  const { timeoutMs = FETCH_TIMEOUT_MS, signal, ...rest } = init ?? {}
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onExternalAbort = () => controller.abort()
  signal?.addEventListener('abort', onExternalAbort)
  let res: Response
  try {
    res = await fetch(path, {
      ...rest,
      headers: { 'Content-Type': 'application/json', ...(rest?.headers || {}) },
      signal: controller.signal,
    })
  } catch {
    // v3.1.0 — deux causes bien distinctes, deux messages différents :
    // l'étudiant saut TOUJOURS si sa réponse est enregistrée ou pas.
    if (timedOut) {
      throw new ApiError(
        t('Le serveur met trop de temps à répondre. Votre réponse est peut-être enregistrée — réessayez pour vérifier.'),
        0,
        'timeout'
      )
    }
    throw new ApiError(
      t('Connexion perdue — votre réponse n’est pas enregistrée. Réessayez dès que le réseau revient.'),
      0,
      'network'
    )
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onExternalAbort)
  }
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    // réponse non JSON
  }
  if (!res.ok) {
    const errObj = data as { error?: unknown } | null
    const message =
      errObj && typeof errObj.error === 'string'
        ? translateApiError(errObj.error)
        : t('Une erreur est survenue.')
    const body =
      data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : null
    throw new ApiError(message, res.status, 'server', body)
  }
  return data as T
}

// Sondage régulier : données quasi temps réel sans configuration complexe.
// Le délai peut être un nombre fixe, ou une FONCTION de la dernière donnée
// reçue (délai adaptatif — v2.4.0 : l'écran étudiant sonde à 2,5 s pendant
// les tests et 5 s pendant les phases d'attente, pour alléger la base).
// v2.9.0 : un petit décalage aléatoire (0 à 500 ms) est ajouté à CHAQUE
// cycle — avec 65 étudiants, les sondages ne partent plus tous exactement
// au même moment (pics de charge) mais s'étalent naturellement dans le
// temps : le serveur et la base restent fluides.
export type PollInterval<T> = number | ((data: T | null) => number)

const POLL_JITTER_MS = 500
const BACKOFF_MAX_MS = 30_000

export function usePoll<T>(fn: (force?: boolean) => Promise<T>, intervalMs: PollInterval<T> = 2500) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(true)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const intervalRef = useRef(intervalMs)
  intervalRef.current = intervalMs
  const dataRef = useRef<T | null>(null)
  dataRef.current = data
  // v3.0.0 — page cachée : sondage en pause (téléphone dans la poche).
  const pausedRef = useRef(false)
  // v3.0.0 — un rafraîchissement complet a été demandé entre deux cycles.
  const forceRef = useRef(false)

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    const run = async () => {
      if (pausedRef.current) return // page cachée : on attend le retour
      try {
        const d = await fnRef.current(forceRef.current)
        forceRef.current = false
        if (alive) {
          setData(d)
          dataRef.current = d
          setError(null)
          failures = 0
        }
      } catch (e) {
        if (alive) setError(e as ApiError)
        failures += 1
      } finally {
        if (alive) {
          setLoading(false)
          const iv = intervalRef.current
          const base = typeof iv === 'function' ? iv(dataRef.current) : iv
          // v3.0.0 — backoff réseau : chaque échec consécutif double le
          // délai (plafond 30 s) ; une coupure réseau ne transforme pas
          // l'application en machine à requêtes. Le moindre succès
          // ramène le rythme normal.
          const delay =
            failures > 0 ? Math.min(base * Math.pow(2, failures), BACKOFF_MAX_MS) : base
          timer = setTimeout(run, delay + Math.random() * POLL_JITTER_MS)
        }
      }
    }
    run()

    // v3.0.0 — Page cachée → pause TOTALE du sondage ; visible →
    // reprise immédiate avec rafraîchissement complet. Un téléphone
    // écran éteint ou un onglet en arrière-plan ne consomme plus rien
    // du serveur ; dès le retour, l'état est rechargé à l'instant.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        pausedRef.current = true
        if (timer) clearTimeout(timer)
      } else if (alive && pausedRef.current) {
        pausedRef.current = false
        if (timer) clearTimeout(timer)
        forceRef.current = true
        run()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisibility)
      if (timer) clearTimeout(timer)
    }
    // Montage unique : fn, interval et data sont suivis par refs — le
    // comportement est identique à l'ancienne implémentation (deps
    // [intervalMs] avec un nombre qui ne changeait jamais).
  }, [])

  // v3.0.0 — refresh(force) : force l'état complet NEUF (utilisé après
  // qu'un étudiant a soumis une réponse : sa propre vue change SANS
  // toucher les compteurs des autres étudiants — pas de tempête).
  const refresh = useCallback(async (force = true) => {
    try {
      const d = await fnRef.current(force)
      setData(d)
      dataRef.current = d
      setError(null)
      return d
    } catch (e) {
      setError(e as ApiError)
      return null
    }
  }, [])

  return { data, error, loading, setData, refresh }
}

// ---------- Persistance locale (appareil de l'enseignant / de l'étudiant) ----------

const TEACHER_KEY = 'tbl_teacher_sessions'
const STUDENT_KEY = 'tbl_student_sessions'
const LAST_STUDENT_KEY = 'tbl_last_student_code'

export interface StoredTeacherSession {
  code: string
  title: string
  token: string
  savedAt: number
}

export interface StoredStudentSession {
  code: string
  token: string
  name: string
  teamName?: string
  savedAt: number
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // stockage plein / navigation privée : on ignore
  }
}

export function getTeacherSessions(): Record<string, StoredTeacherSession> {
  return readJson(TEACHER_KEY, {})
}

export function saveTeacherSession(s: StoredTeacherSession) {
  const all = getTeacherSessions()
  all[s.code] = s
  writeJson(TEACHER_KEY, all)
}

// v2.8.2 : met à jour le TITRE mémorisé d'une séance de « Mes séances
// sur cet appareil » (renommage via l'onglet Configurations). Ne crée
// JAMAIS d'entrée (la séance doit déjà être mémorisée sur cet appareil)
// et ne touche ni au jeton ni à la date de sauvegarde — l'ordre de la
// liste reste stable. Corrige le bug : le titre de création restait
// affiché après un changement de titre.
export function refreshTeacherSessionMeta(code: string, title: string) {
  const all = getTeacherSessions()
  const cur = all[code]
  if (!cur || cur.title === title) return
  all[code] = { ...cur, title }
  writeJson(TEACHER_KEY, all)
}

export function removeTeacherSession(code: string) {
  const all = getTeacherSessions()
  delete all[code]
  writeJson(TEACHER_KEY, all)
}

export function getStudentSessions(): Record<string, StoredStudentSession> {
  return readJson(STUDENT_KEY, {})
}

export function saveStudentSession(s: StoredStudentSession) {
  const all = getStudentSessions()
  all[s.code] = s
  writeJson(STUDENT_KEY, all)
  writeJson(LAST_STUDENT_KEY, s.code)
}

export function removeStudentSession(code: string) {
  const all = getStudentSessions()
  delete all[code]
  writeJson(STUDENT_KEY, all)
}

export function getLastStudentSession(): StoredStudentSession | null {
  const code = readJson<string>(LAST_STUDENT_KEY, '')
  if (!code) return null
  const all = getStudentSessions()
  return all[code] || null
}

// ============================================================
// v3.1.0 — ÉTAT RÉSEAU + ÉTATS DE SOUMISSION (UX, problème n°12)
//
// Une mutation doit TOUJOURS dire où elle en est :
//   « Envoi en cours… » → « Enregistré ✓ »
//   ou « Connexion lente… » → « Échec — non enregistré. Réessayer »
// Jamais une réponse présentée comme définitivement enregistrée
// AVANT la confirmation du serveur ; jamais un échec muet.
// ============================================================

export type NetworkQuality = 'online' | 'offline' | 'reconnecting' | 'slow'

/**
 * État réseau global, partagé par tous les écrans qui le demandent :
 *  - offline : navigator.onLine = false (pas de réseau du tout) ;
 *  - reconnecting : le réseau est revenu / les sondages échouent
 *    encore → reconnexion en cours ;
 *  - slow : le dernier sondage a pris plus de 3 s ;
 *  - online : tout va bien.
 * Notifie aussi la dernière fois où le serveur a répondu (pour
 * « dernière connexion réussie »).
 */
export function useNetworkStatus(pollError: unknown): {
  quality: NetworkQuality
  online: boolean
} {
  // État du NAVIGATEUR (événements online/offline) — setState dans des
  // CALLBACKS d'événements : autorisé (jamais dans le corps de l'effet).
  const [navOnline, setNavOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  )
  // Mémoire « on est passé par un vrai coupure réseau » : distingue
  // « Reconnexion… » (le réseau est revenu, le serveur répond encore
  // mal) de « Connexion lente » (jamais coupé, juste lent).
  const [wasOffline, setWasOffline] = useState(false)
  useEffect(() => {
    const onOnline = () => setNavOnline(true)
    const onOffline = () => {
      setNavOnline(false)
      setWasOffline(true)
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  // Qualité DÉRIVÉE à chaque rendu (le résultat du sondage arrive en
  // prop/argument → tout changement re-rend automatiquement) : zéro
  // setState dans un effet, zéro minuterie de contrôle.
  const failing = pollError !== null
  if (!failing && navOnline && wasOffline) {
    // Le réseau est remis ET le serveur répond : la reconnexion est
    // terminée (pattern React documenté « ajuster l'état au rendu »).
    setWasOffline(false)
  }
  const quality: NetworkQuality = !navOnline
    ? 'offline'
    : failing
      ? wasOffline
        ? 'reconnecting'
        : 'slow'
      : 'online'
  return { quality, online: navOnline }
}

/** État d'une soumission (mutation) pour l'interface étudiante. */
export type SubmitPhase =
  | { state: 'idle' }
  | { state: 'sending'; slow: boolean }
  | { state: 'saved'; duplicate?: boolean }
  | {
      state: 'failed'
      message: string
      retryable: boolean
      kind: 'network' | 'timeout' | 'server'
      /** Le serveur signale que l'état a avancé sans l'envoi (tRAT) :
       * le « réessai » devient un rafraîchissement de l'écran. */
      syncNeeded?: boolean
    }

/**
 * v3.1.0 — Enveloppe une mutation étudiante : suit l'état d'envoi,
 * détecte la « connexion lente » (au-delà de 3 s sans réponse), et
 * propose le RÉESSAI (l'idempotence serveur le rend sûr : un envoi
 * répété renvoie le même résultat, jamais un doublon).
 */
export function useSubmitState() {
  const [phase, setPhase] = useState<SubmitPhase>({ state: 'idle' })
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sendingRef = useRef(false)

  const clearSlowTimer = () => {
    if (slowTimerRef.current !== null) {
      clearTimeout(slowTimerRef.current)
      slowTimerRef.current = null
    }
  }

  const run = useCallback(async <T,>(
    fn: () => Promise<T>,
    opts: { onSaved?: (result: T, duplicate: boolean) => void } = {}
  ): Promise<T | null> => {
    if (sendingRef.current) return null
    sendingRef.current = true
    setPhase({ state: 'sending', slow: false })
    // « Connexion lente… » après 3 s : l'étudiant voit que ça travaille,
    // il ne re-clique pas dix fois (le double-clic est de toute façon
    // neutralisé par sendingRef).
    clearSlowTimer()
    slowTimerRef.current = setTimeout(() => {
      setPhase((p) => (p.state === 'sending' ? { state: 'sending', slow: true } : p))
    }, 3000)
    try {
      const result = await fn()
      clearSlowTimer()
      sendingRef.current = false
      const duplicate =
        (result as { duplicate?: boolean } | null)?.duplicate === true
      setPhase({ state: 'saved', duplicate })
      opts.onSaved?.(result, duplicate)
      return result
    } catch (e) {
      clearSlowTimer()
      sendingRef.current = false
      const apiErr = e instanceof ApiError ? e : null
      const message = e instanceof Error ? e.message : ''
      const kind = apiErr ? apiErr.kind : 'server'
      // Réessayable sauf erreur serveur « logique » franche (400/403/404,
      // l'envoi ne passera pas mieux en le répétant). 409 portant
      // syncNeeded (tRAT) → le réessai rafraîchit ; 409 simple → éventuel
      // état transitoire, réessayable aussi.
      const retryable =
        apiErr === null ||
        apiErr.kind !== 'server' ||
        apiErr.status >= 500 ||
        apiErr.status === 0 ||
        apiErr.status === 429 ||
        apiErr.status === 409
      setPhase({
        state: 'failed',
        message,
        retryable,
        kind,
        // tRAT : le serveur signale que l'état de l'équipe a AVANCÉ
        // (coéquipier plus rapide / envoi déjà enregistré) — le
        // « réessai » devient un simple rafraîchissement.
        syncNeeded: apiErr?.has('syncNeeded') === true,
      })
      return null
    }
  }, [])

  const reset = useCallback(() => {
    clearSlowTimer()
    sendingRef.current = false
    setPhase({ state: 'idle' })
  }, [])

  useEffect(() => clearSlowTimer, [])

  return { phase, run, reset, setPhase }
}
