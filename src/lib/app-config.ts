'use client'

// ============================================================
// TBL Live v2.9.0 — Configuration publique de l'application
//
// Petite configuration lue au démarrage (une requête, une ligne
// de base) : délai de synchronisation Internet ↔ réseau local et
// personnalisations de texte, tous deux réglables dans l'espace
// administrateur (/admin). Valeurs par défaut si la requête
// échoue (base pas encore prête, mode hors ligne…) : réglages
// d'origine — l'application fonctionne toujours.
// ============================================================

import { setTextOverrides } from '@/lib/i18n'

export interface AppConfig {
  /** Délai du cycle de synchronisation Internet ↔ local (ms). */
  syncIntervalMs: number
}

const DEFAULT_CONFIG: AppConfig = { syncIntervalMs: 5000 }

let config: AppConfig = { ...DEFAULT_CONFIG }
let loading: Promise<AppConfig> | null = null

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
        }
        const ms = Number(d.syncIntervalMs)
        config = {
          syncIntervalMs:
            Number.isInteger(ms) && ms >= 2000 && ms <= 60_000 ? ms : DEFAULT_CONFIG.syncIntervalMs,
        }
        if (d.texts && typeof d.texts === 'object') {
          setTextOverrides(d.texts as Record<string, string>)
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
  return loadAppConfig()
}
