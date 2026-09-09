'use client'

// ============================================================
// TBL Live v3.0.0 — Application du thème dans le navigateur
//
// Le thème (couleurs + icônes, choisi dans /admin → Apparence)
// arrive par /api/config. Les couleurs remplacent les VARIABLES
// CSS de Tailwind (--color-emerald-*, --color-amber-*, fond) :
// toutes les classes de l'application (bg-emerald-600,
// text-amber-700, border-emerald-200…) suivent instantanément,
// survols compris, sans retoucher un seul composant.
// ============================================================

import {
  GraduationCap,
  BookOpen,
  HeartPulse,
  Stethoscope,
  FlaskConical,
  University,
  Lightbulb,
  Sparkles,
  Presentation,
  UserRound,
  ClipboardCheck,
  PenLine,
  Users,
  UsersRound,
  Smile,
  type LucideIcon,
} from 'lucide-react'
import { accentShades, backgroundTints, primaryShades, type ThemeConfig, type ThemeIconKind } from '@/lib/theme'

/** Toutes les icônes proposées (nom lucide → composant, références
 *  de niveau module : identités stables, aucun composant créé au
 *  rendu — même motif que TBL_STEPS de l'accueil). */
export const ICONS: Record<string, LucideIcon> = {
  GraduationCap,
  BookOpen,
  HeartPulse,
  Stethoscope,
  FlaskConical,
  University,
  Lightbulb,
  Sparkles,
  Presentation,
  UserRound,
  ClipboardCheck,
  PenLine,
  Users,
  UsersRound,
  Smile,
}

/** Icône d'un emplacement du thème (repli : icône d'origine). */
export function themeIcon(kind: ThemeIconKind, name?: string): LucideIcon {
  const fallback = kind === 'logo' ? GraduationCap : kind === 'teacher' ? GraduationCap : Users
  if (name && ICONS[name]) return ICONS[name]
  return fallback
}

/** v3.1.0 — Data URL de l'icône TÉLÉVERSÉE pour un emplacement (null =
 *  aucune → utiliser l'icône lucide du thème ou celle d'origine). */
export function customIconUrl(
  kind: ThemeIconKind,
  theme?: { customIcons?: Partial<Record<ThemeIconKind, string>> }
): string | null {
  const url = theme?.customIcons?.[kind]
  if (typeof url === 'string' && url.startsWith('data:image/')) return url
  return null
}

let applied = false

/** Applique (ou retire) le thème sur la page courante. */
export function applyTheme(theme: ThemeConfig): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const set = (name: string, value: string | undefined) => {
    if (value === undefined) root.style.removeProperty(name)
    else root.style.setProperty(name, value)
  }
  if (theme.primary) {
    const shades = primaryShades(theme.primary)
    for (const [k, v] of Object.entries(shades)) set(`--color-emerald-${k}`, v)
  } else {
    for (const k of ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900']) {
      set(`--color-emerald-${k}`, undefined)
    }
  }
  if (theme.accent) {
    const shades = accentShades(theme.accent)
    for (const [k, v] of Object.entries(shades)) set(`--color-amber-${k}`, v)
  } else {
    for (const k of ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900']) {
      set(`--color-amber-${k}`, undefined)
    }
  }
  if (theme.background) {
    const tints = backgroundTints(theme.background)
    set('--color-stone-50', tints['50'])
    set('--color-stone-100', tints['100'])
  } else {
    set('--color-stone-50', undefined)
    set('--color-stone-100', undefined)
  }
  applied = true
}

/** Le thème a-t-il déjà été appliqué ? (évite le double travail) */
export function themeApplied(): boolean {
  return applied
}

/** Lève le marqueur « appliqué » (rechargement après modification). */
export function resetThemeAppliedFlag(): void {
  applied = false
}
