'use client'

// ============================================================
// TBL Live v3.0.0 — Configuration publique de l'application
//
// Petite configuration lue au démarrage (une requête, une ligne
// de base) : délai de synchronisation Internet ↔ réseau local,
// personnalisations de texte, thème (couleurs + icônes) — tous
// réglables dans l'espace administrateur (/admin). Valeurs par
// défaut si la requête échoue (base pas encore prête, mode hors
// ligne…) : réglages d'origine — l'application fonctionne toujours.
// ============================================================

import { setTextOverrides } from '@/lib/i18n'
import { applyTheme } from '@/lib/theme-client'
import { resetThemeAppliedFlag } from '@/lib/theme-client'
import type { ThemeConfig } from '@/lib/theme'

export interface AppConfig {
  /** Délai du cycle de synchronisation Internet ↔ local (ms). */
  syncIntervalMs: number
}

const DEFAULT_CONFIG: AppConfig = { syncIntervalMs: 5000 }

let config: AppConfig = { ...DEFAULT_CONFIG }
let loading: Promise<AppConfig> | null = null
/** v3.0.0 — thème chargé (couleurs + icônes), pour l'accueil. */
let currentTheme: ThemeConfig = {}

/** Configuration actuelle (valeur par défaut avant chargement). */
export function getAppConfig(): AppConfig {
  return config
}

/** Charge (une seule fois par instance) la configuration du serveur. */
export function loadAppConfig(): Promise<AppConfig> {
  if (loading) return loading
  loading = (async () => {
    try {
      const res = await fetch('/api/config', { cache: 'no-store' })
      if (res.ok) {
        const d = (await res.json()) as {
          syncIntervalMs?: unknown
          texts?: unknown
          theme?: unknown
        }
        const ms = Number(d.syncIntervalMs)
        config = {
          syncIntervalMs:
            Number.isInteger(ms) && ms >= 2000 && ms <= 60_000 ? ms : DEFAULT_CONFIG.syncIntervalMs,
        }
        if (d.texts && typeof d.texts === 'object') {
          setTextOverrides(d.texts as Record<string, string>)
        }
        // v3.0.0 — thème (couleurs + icônes) de l'administrateur :
        // variables CSS Tailwind — toutes les teintes de l'applica-
        // tion suivent, sans retoucher un seul composant.
        if (d.theme && typeof d.theme === 'object') {
          currentTheme = d.theme as ThemeConfig
          applyTheme(currentTheme)
        }
      }
    } catch {
      // pas de connexion / base indisponible : valeurs par défaut
    }
    return config
  })()
  return loading
}

/** Force le rechargement (après une modification côté administrateur). */
export function reloadAppConfig(): Promise<AppConfig> {
  loading = null
  currentTheme = {}
  resetThemeAppliedFlag()
  return loadAppConfig()
}

/** v3.0.0 — thème public courant (icônes de l'accueil). */
export function getTheme(): ThemeConfig {
  return currentTheme
}
