'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { t, translateApiError } from '@/lib/i18n'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    })
  } catch {
    throw new ApiError(t('Connexion impossible. Vérifiez votre réseau.'), 0)
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
    throw new ApiError(message, res.status)
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

export function usePoll<T>(fn: () => Promise<T>, intervalMs: PollInterval<T> = 2500) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(true)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const intervalRef = useRef(intervalMs)
  intervalRef.current = intervalMs
  const dataRef = useRef<T | null>(null)
  dataRef.current = data

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = async () => {
      try {
        const d = await fnRef.current()
        if (alive) {
          setData(d)
          dataRef.current = d
          setError(null)
        }
      } catch (e) {
        if (alive) setError(e as ApiError)
      } finally {
        if (alive) {
          setLoading(false)
          const iv = intervalRef.current
          const delay = typeof iv === 'function' ? iv(dataRef.current) : iv
          timer = setTimeout(run, delay + Math.random() * POLL_JITTER_MS)
        }
      }
    }
    run()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
    // Montage unique : fn, interval et data sont suivis par refs — le
    // comportement est identique à l'ancienne implémentation (deps
    // [intervalMs] avec un nombre qui ne changeait jamais).
  }, [])

  const refresh = useCallback(async () => {
    try {
      const d = await fnRef.current()
      setData(d)
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
