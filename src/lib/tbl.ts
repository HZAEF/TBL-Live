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

export function isValidPin(pin: unknown): pin is string {
  return typeof pin === 'string' && /^\d{4}$/.test(pin)
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
