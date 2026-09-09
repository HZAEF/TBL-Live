'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Loader2, RefreshCw, Wifi, WifiOff, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LETTERS, PHASE_INFO, type Phase } from '@/lib/tbl-types'
import { useI18n } from '@/lib/i18n'
import { serverNowMs } from '@/lib/server-clock'
import type { NetworkQuality, SubmitPhase } from '@/lib/tbl-client'

// ---------- Minute / compte à rebours ----------

// v2.9.0 : tous les minuteurs interrogent l'horloge du SERVEUR
// reconstituée (server-clock.ts) — enseignant et étudiants voient
// exactement le même chronomètre, même si l'horloge de l'appareil
// est fausse. L'iRAT descend jusqu'à 00:00 puis affiche
// « Temps écoulé » (fin nette, pas de compteur qui remonte).

export function Countdown({ startedAt, minutes }: { startedAt: string; minutes: number }) {
  const [now, setNow] = useState(() => serverNowMs())
  useEffect(() => {
    const id = setInterval(() => setNow(serverNowMs()), 1000)
    return () => clearInterval(id)
  }, [])
  const elapsed = Math.floor((now - new Date(startedAt).getTime()) / 1000)
  const remaining = minutes * 60 - elapsed
  const over = remaining < 0
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
  const ss = String(remaining % 60).padStart(2, '0')
  const { t } = useI18n()
  if (over) {
    return (
      <span className="font-mono font-semibold tabular-nums text-red-600">
        {t('Temps écoulé')}
      </span>
    )
  }
  return (
    <span
      className={cn(
        'font-mono font-semibold tabular-nums',
        remaining < 60 ? 'text-amber-600' : 'text-emerald-700'
      )}
    >
      {mm}:{ss}
    </span>
  )
}

export function ElapsedSince({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => serverNowMs())
  useEffect(() => {
    const id = setInterval(() => setNow(serverNowMs()), 1000)
    return () => clearInterval(id)
  }, [])
  const elapsed = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
  const hh = Math.floor(elapsed / 3600)
  const mm = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')
  return (
    <span className="font-mono tabular-nums text-stone-600">
      {hh > 0 ? `${hh}:` : ''}
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
  const { t } = useI18n()
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold',
        PHASE_BADGE_COLORS[phase],
        className
      )}
    >
      {t(PHASE_INFO[phase].short)}
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
        'flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3.5 text-start text-[15px] leading-snug transition-all',
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

// ============================================================
// v3.1.0 — États de SOUMISSION et INDICATEUR RÉSEAU (UX, problème
// n°12 + demande de l'enseignante : « envoyer en cours, réessayer… »)
//
// Une mutation ne doit JAMAIS laisser l'étudiant dans le flou :
//  - envoi : « Envoi en cours… » (+ « Connexion lente… » après 3 s) ;
//  - succès : « Enregistré ✓ » (jamais avant la confirmation serveur) ;
//  - échec : « Échec — non enregistré » + bouton RÉESSAYER (l'idempo-
//    tence serveur garantit qu'un renvoi ne crée pas de doublon).
// ============================================================

/** Affiche l'état d'une soumission (sous le bouton d'envoi). */
export function SubmitStatus({
  phase,
  onRetry,
}: {
  phase: SubmitPhase
  onRetry?: () => void
}) {
  const { t } = useI18n()
  if (phase.state === 'idle') return null
  if (phase.state === 'sending') {
    return (
      <div
        className={cn(
          'mt-2 flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium',
          phase.slow ? 'bg-amber-50 text-amber-800' : 'bg-stone-50 text-stone-500'
        )}
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        {phase.slow ? t('Connexion lente — envoi toujours en cours…') : t('Envoi en cours…')}
      </div>
    )
  }
  if (phase.state === 'saved') {
    return (
      <div className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
        <Check className="h-4 w-4" />
        {phase.duplicate
          ? t('Déjà enregistré — votre réponse était bien reçue.')
          : t('Réponse enregistrée ✓')}
      </div>
    )
  }
  // Échec : message explicite + RÉESSAI (idempotent — sans risque).
  return (
    <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {phase.kind === 'server'
              ? t('Envoi refusé')
              : t('Échec de l’envoi — réponse non enregistrée')}
          </p>
          <p className="mt-0.5 leading-snug break-words">{phase.message}</p>
          <p className="mt-1 text-xs font-medium text-red-600">
            {phase.kind === 'timeout'
              ? t('Votre réponse est peut-être déjà enregistrée : réessayez pour vérifier (aucun risque de doublon).')
              : phase.kind === 'network'
                ? t('Réessayez dès que le réseau revient — aucun risque de doublon.')
                : ''}
          </p>
        </div>
      </div>
      {onRetry && phase.retryable && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-xl bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700"
        >
          <RefreshCw className="h-4 w-4" />
          {t('Réessayer')}
        </button>
      )}
    </div>
  )
}

/** Pastille d'état réseau (en-tête étudiant / enseignant). Discret
 *  mais clair : n'apparaît QUE quand quelque chose ne va pas. */
export function NetworkPill({ quality }: { quality: NetworkQuality }) {
  const { t } = useI18n()
  if (quality === 'online') return null
  const conf = {
    offline: {
      icon: WifiOff,
      label: t('Hors ligne'),
      cls: 'bg-red-100 text-red-800 border-red-200',
    },
    reconnecting: {
      icon: RefreshCw,
      label: t('Reconnexion…'),
      cls: 'bg-amber-100 text-amber-800 border-amber-200',
    },
    slow: {
      icon: Wifi,
      label: t('Connexion lente'),
      cls: 'bg-amber-100 text-amber-800 border-amber-200',
    },
  }[quality]
  const Icon = conf.icon
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold',
        conf.cls
      )}
    >
      <Icon className={cn('h-3.5 w-3.5', quality === 'reconnecting' && 'animate-spin')} />
      {conf.label}
    </span>
  )
}
