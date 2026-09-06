// ============================================================
// TBL Live — Internationalisation (i18n)
// 7 langues : français (défaut, = clé), anglais, espagnol,
// allemand, chinois, russe, arabe (droite-à-gauche).
// Principe : la clé du dictionnaire EST le texte français ;
// en français la clé est renvoyée telle quelle (identité).
// Une traduction manquante retombe proprement sur le français.
// Les variables s'écrivent {nom} dans les clés et les valeurs.
// ============================================================

import { useSyncExternalStore } from 'react'
import { ar } from './dicts/ar'
import { de } from './dicts/de'
import { en } from './dicts/en'
import { es } from './dicts/es'
import { ru } from './dicts/ru'
import { zh } from './dicts/zh'

export type Lang = 'fr' | 'en' | 'es' | 'de' | 'zh' | 'ru' | 'ar'

export interface LangMeta {
  code: Lang
  /** Nom natif affiché dans le sélecteur (toujours dans sa langue) */
  name: string
  dir: 'ltr' | 'rtl'
  /** Locale Intl pour les dates */
  locale: string
}

export const LANGS: LangMeta[] = [
  { code: 'fr', name: 'Français', dir: 'ltr', locale: 'fr-FR' },
  { code: 'en', name: 'English', dir: 'ltr', locale: 'en-GB' },
  { code: 'es', name: 'Español', dir: 'ltr', locale: 'es-ES' },
  { code: 'de', name: 'Deutsch', dir: 'ltr', locale: 'de-DE' },
  { code: 'zh', name: '中文', dir: 'ltr', locale: 'zh-CN' },
  { code: 'ru', name: 'Русский', dir: 'ltr', locale: 'ru-RU' },
  { code: 'ar', name: 'العربية', dir: 'rtl', locale: 'ar' },
]

const STORAGE_KEY = 'tbl_lang'

const DICTS: Partial<Record<Lang, Record<string, string>>> = { en, es, de, zh, ru, ar }

// ---------- Store externe (re-rendu global au changement) ----------

let current: Lang = 'fr'
const listeners = new Set<() => void>()

function applyDocument(lang: Lang): void {
  if (typeof document === 'undefined') return
  const meta = LANGS.find((l) => l.code === lang)
  document.documentElement.lang = lang
  document.documentElement.dir = meta ? meta.dir : 'ltr'
}

export function getLang(): Lang {
  return current
}

export function setLang(lang: Lang): void {
  current = lang
  try {
    window.localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // stockage indisponible : on continue en mémoire
  }
  applyDocument(lang)
  listeners.forEach((fn) => fn())
}

export function subscribeLang(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Restaurer la langue mémorisée (appelé une fois au montage du client,
 *  après l'hydratation — évite tout décalage serveur/client). */
export function initLangFromStorage(): Lang {
  if (typeof window === 'undefined') return current
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved && LANGS.some((l) => l.code === saved)) setLang(saved as Lang)
    else applyDocument(current)
  } catch {
    applyDocument(current)
  }
  return current
}

// ---------- Traduction ----------

/** Traduit `key` (texte français) dans la langue courante.
 *  Variables : t("Question {i} sur {n}", { i, n }). */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = key
  const dict = DICTS[current]
  if (dict) {
    const v = dict[key]
    if (typeof v === 'string' && v.length > 0) s = v
  }
  if (vars) {
    for (const [k, val] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(val))
    }
  }
  return s
}

/** Hook React : s'abonne au changement de langue (re-rendu). */
export function useI18n(): { lang: Lang; setLang: (l: Lang) => void; t: typeof t } {
  const lang = useSyncExternalStore(subscribeLang, getLang, () => 'fr' as Lang)
  return { lang, setLang, t }
}

// ---------- Dates / locale ----------

export function currentLocale(): string {
  return LANGS.find((l) => l.code === current)?.locale ?? 'fr-FR'
}

export function formatDate(d: Date, opts?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(currentLocale(), opts).format(d)
}

// ---------- Messages d'erreur du serveur (toujours renvoyés en
// français par l'API) → traduits côté client ---------------

/** Règles dynamiques : messages API contenant un compteur variable.
 *  {n} reçoit le nombre extrait par la regex. */
const DYNAMIC_ERROR_RULES: { re: RegExp; key: string }[] = [
  {
    re: /^Code PIN incorrect\. Attention : il vous reste (\d+) tentative/,
    key: 'ERR:PIN_LEFT',
  },
  {
    re: /^Trop de tentatives incorrectes\. La connexion est verrouillée pendant \d+ minutes — patientez encore environ (\d+) minute/,
    key: 'ERR:PIN_LOCK_WAIT',
  },
  {
    re: /^Trop de tentatives incorrectes\. La connexion est verrouillée pendant \d+ minutes\./,
    key: 'ERR:PIN_LOCK',
  },
]

/** Traduit un message d'erreur renvoyé par l'API (texte français).
 *  Message inconnu → renvoyé tel quel (repli sûr). */
export function translateApiError(msg: string): string {
  if (!msg) return msg
  for (const rule of DYNAMIC_ERROR_RULES) {
    const m = msg.match(rule.re)
    if (m) return t(rule.key, { n: m[1] })
  }
  const dict = DICTS[current]
  const v = dict ? dict[msg] : undefined
  return typeof v === 'string' && v.length > 0 ? v : msg
}
