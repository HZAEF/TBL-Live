'use client'

import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LETTERS, PHASE_INFO, type Phase } from '@/lib/tbl-types'

// ---------- Minute / compte à rebours ----------

export function Countdown({ startedAt, minutes }: { startedAt: string; minutes: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const elapsed = Math.floor((now - new Date(startedAt).getTime()) / 1000)
  const remaining = minutes * 60 - elapsed
  const over = remaining < 0
  const abs = Math.abs(remaining)
  const mm = String(Math.floor(abs / 60)).padStart(2, '0')
  const ss = String(abs % 60).padStart(2, '0')
  return (
    <span
      className={cn(
        'font-mono font-semibold tabular-nums',
        over ? 'text-red-600' : remaining < 60 ? 'text-amber-600' : 'text-emerald-700'
      )}
    >
      {over ? 'Temps écoulé (+' : ''}
      {mm}:{ss}
      {over ? ')' : ''}
    </span>
  )
}

export function ElapsedSince({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const elapsed = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')
  return (
    <span className="font-mono tabular-nums text-stone-600">
      {mm}:{ss}
    </span>
  )
}

// ---------- Badge de phase ----------

const PHASE_BADGE_COLORS: Record<Phase, string> = {
  lobby: 'bg-stone-100 text-stone-700 border-stone-300',
  irat: 'bg-amber-100 text-amber-800 border-amber-300',
  trat: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  appeal: 'bg-orange-100 text-orange-800 border-orange-300',
  feedback: 'bg-teal-100 text-teal-800 border-teal-300',
  application: 'bg-lime-100 text-lime-800 border-lime-300',
  peer: 'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300',
  finished: 'bg-stone-200 text-stone-700 border-stone-400',
}

export function PhaseBadge({ phase, className }: { phase: Phase; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold',
        PHASE_BADGE_COLORS[phase],
        className
      )}
    >
      {PHASE_INFO[phase].short}
    </span>
  )
}

// ---------- Boutons de choix de réponse ----------

export type ChoiceState = 'default' | 'selected' | 'correct' | 'wrong' | 'rejected'

const CHOICE_STYLES: Record<ChoiceState, string> = {
  default:
    'border-stone-300 bg-white hover:border-emerald-500 hover:bg-emerald-50 active:scale-[0.99]',
  selected: 'border-emerald-600 bg-emerald-600 text-white shadow-md',
  correct: 'border-emerald-600 bg-emerald-50 text-emerald-900',
  wrong: 'border-red-400 bg-red-50 text-red-800',
  rejected: 'border-stone-200 bg-stone-100 text-stone-400',
}

export function ChoiceButton({
  letter,
  text,
  state = 'default',
  disabled = false,
  onClick,
  showIcon = false,
}: {
  letter: string
  text: string
  state?: ChoiceState
  disabled?: boolean
  onClick?: () => void
  showIcon?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={state === 'selected'}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3.5 text-left text-[15px] leading-snug transition-all',
        'min-h-[56px] touch-manipulation',
        CHOICE_STYLES[state],
        disabled && 'cursor-not-allowed opacity-90'
      )}
    >
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-bold',
          state === 'selected'
            ? 'border-white/40 bg-white/20 text-white'
            : state === 'correct'
              ? 'border-emerald-500 bg-emerald-600 text-white'
              : state === 'rejected'
                ? 'border-stone-300 bg-stone-200 text-stone-500'
                : state === 'wrong'
                  ? 'border-red-400 bg-red-500 text-white'
                  : 'border-stone-300 bg-stone-50 text-stone-600'
        )}
      >
        {letter}
      </span>
      <span className="flex-1">{text}</span>
      {showIcon && state === 'correct' && <Check className="h-5 w-5 shrink-0 text-emerald-600" />}
      {showIcon && state === 'wrong' && <X className="h-5 w-5 shrink-0 text-red-500" />}
      {showIcon && state === 'rejected' && <X className="h-5 w-5 shrink-0 text-stone-400" />}
    </button>
  )
}

export function choiceLetter(index: number): string {
  return LETTERS[index] ?? '?'
}

// ---------- Petit bloc d'aide ----------

export function InfoCard({
  title,
  children,
  tone = 'stone',
}: {
  title?: string
  children: React.ReactNode
  tone?: 'stone' | 'emerald' | 'amber'
}) {
  const tones = {
    stone: 'border-stone-200 bg-stone-50 text-stone-700',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
  }
  return (
    <div className={cn('rounded-xl border p-4 text-sm leading-relaxed', tones[tone])}>
      {title && <p className="mb-1 font-semibold">{title}</p>}
      {children}
    </div>
  )
}
