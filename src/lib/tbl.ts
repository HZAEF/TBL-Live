import { db } from '@/lib/db'
import { randomBytes } from 'crypto'

// Alphabet sans caractères ambigus (pas de O/0, I/1)
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export const PHASES = [
  'lobby',
  'irat',
  'trat',
  'appeal',
  'feedback',
  'application',
  'peer',
  'finished',
] as const

export type Phase = (typeof PHASES)[number]

export function randomCode(len = 6): string {
  const bytes = randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  }
  return out
}
export function randomToken(): string {
  return randomBytes(24).toString('hex')
}

export function normalizeCode(code: string): string {
  return (code || '').toUpperCase().trim()
}

export async function getSessionByCode(code: string) {
  return db.session.findUnique({
    where: { code: normalizeCode(code) },
  })
}

export function parseChoices(raw: string): string[] {
  try {
    const arr = JSON.parse(raw)
    if (Array.isArray(arr)) return arr.map((c) => String(c))
  } catch {
    // ignore
  }
  return []
}

export async function generateUniqueCode(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = randomCode()
    const existing = await db.session.findUnique({ where: { code } })
    if (!existing) return code
  }
  throw new Error('Impossible de générer un code unique')
}

// ---- PIN enseignant ----
// 6 à 12 caractères, lettres et chiffres (pas d'accents ni de symboles).
// Combiné au verrouillage après 5 tentatives (voir teacher/route.ts),
// le PIN devient incassable par force brute pendant une séance.
export const PIN_MAX_ATTEMPTS = 5
export const PIN_LOCK_MINUTES = 15

export function normalizePin(pin: string): string {
  return pin.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
}

export function isValidPin(pin: unknown): pin is string {
  return (
    typeof pin === 'string' &&
    /^[A-Z0-9]{6,12}$/.test(normalizePin(pin))
  )
}

// Code de reprise personnel de l'étudiant (même alphabet sans ambiguïté).
export function randomRecoveryCode(): string {
  return randomCode(6)
}

// Nom normalisé pour la comparaison insensible à la casse et aux accents
// (Léa vs lea, Éloi vs Eloi) lors de la reprise de séance.
export function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export function sanitizeQuestionInput(q: unknown): {
  text: string
  choices: string[]
  correct: number
  phase: 'rat' | 'application'
} | null {
  if (!q || typeof q !== 'object') return null
  const obj = q as Record<string, unknown>
  const text = typeof obj.text === 'string' ? obj.text.trim() : ''
  const rawChoices = Array.isArray(obj.choices) ? obj.choices : []
  const choices = rawChoices
    .map((c) => (typeof c === 'string' ? c.trim() : ''))
    .filter((c) => c.length > 0)
  const correct = Number(obj.correct)
  const phase = obj.phase === 'application' ? 'application' : 'rat'
  if (!text || text.length > 1000) return null
  if (choices.length < 2 || choices.length > 6) return null
  if (!Number.isInteger(correct) || correct < 0 || correct >= choices.length) return null
  return { text, choices, correct, phase }
}

// Validation d'un cas clinique d'application (titre + énoncé + QCU).
// Les questions sont forcées en phase « application ». Le titre est
// obligatoire (repli : « Application N » si absent côté client).
export function sanitizeCaseInput(
  c: unknown
): {
  title: string
  intro: string | null
  questions: { text: string; choices: string[]; correct: number; phase: 'application' }[]
} | null {
  if (!c || typeof c !== 'object') return null
  const obj = c as Record<string, unknown>
  const title = typeof obj.title === 'string' ? obj.title.trim() : ''
  const intro = typeof obj.intro === 'string' ? obj.intro.trim() : ''
  const rawQuestions = Array.isArray(obj.questions) ? obj.questions : []
  const questions: { text: string; choices: string[]; correct: number; phase: 'application' }[] = []
  for (const rq of rawQuestions) {
    const q = sanitizeQuestionInput(rq)
    if (!q) return null // une seule QCU invalide invalide tout le cas
    questions.push({ text: q.text, choices: q.choices, correct: q.correct, phase: 'application' })
  }
  if (!title || title.length > 200) return null
  if (intro.length > 4000) return null
  if (questions.length < 1 || questions.length > 10) return null
  return {
    title,
    intro: intro.length > 0 ? intro : null,
    questions,
  }
}
