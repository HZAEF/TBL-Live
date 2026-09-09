// ============================================================
// TBL Live v3.0.0 — Thème de l'application (couleurs + icônes)
//
// L'administrateur personnalise l'apparence depuis /admin
// (espace « Apparence ») : couleur principale (boutons, liens,
// en-têtes), couleur d'accent (rubrique étudiante), fond de page
// et trois icônes (logo, carte enseignant, carte étudiant).
//
// STOCKAGE : AdminSetting.theme (JSON, "{}" = thème d'origine).
// DIFFUSION : /api/config (public) → appliqué au démarrage par
// app-config.ts via des VARIABLES CSS — les classes Tailwind
// (bg-emerald-600, text-amber-700…) deviennent pilotables sans
// toucher au moindre composant : la couleur choisie apparaît
// partout instantanément, sur tous les appareils, à la prochaine
// ouverture de page.
//
// Ce module est PUR (aucun accès DOM) : il sert aussi bien à la
// validation côté serveur (route admin) qu'à l'application côté
// navigateur (theme-client.ts).
// ============================================================

export interface ThemeIcons {
  logo?: string
  teacher?: string
  student?: string
}

export interface ThemeConfig {
  primary?: string
  accent?: string
  background?: string
  icons?: ThemeIcons
}

/** Icônes proposées pour chaque emplacement (noms lucide-react). */
export const THEME_ICON_CHOICES = {
  logo: [
    'GraduationCap',
    'BookOpen',
    'HeartPulse',
    'Stethoscope',
    'FlaskConical',
    'University',
    'Lightbulb',
    'Sparkles',
  ],
  teacher: ['GraduationCap', 'Presentation', 'UserRound', 'ClipboardCheck', 'PenLine', 'BookOpen'],
  student: ['Users', 'UsersRound', 'UserRound', 'GraduationCap', 'BookOpen', 'Smile'],
} as const

export type ThemeIconKind = keyof typeof THEME_ICON_CHOICES

/** Palettes prêtes à l'emploi (point de départ personnalisable). */
export const THEME_PRESETS: { name: string; theme: ThemeConfig }[] = [
  { name: 'Émeraude (origine)', theme: {} },
  { name: 'Bleu médical', theme: { primary: '#0e7490', accent: '#b45309', background: '#f0f9fa' } },
  { name: 'Violet', theme: { primary: '#7c3aed', accent: '#b45309', background: '#f6f3fb' } },
  { name: 'Vert forêt', theme: { primary: '#3f6212', accent: '#9a3412', background: '#f4f7ec' } },
  { name: 'Bordeaux', theme: { primary: '#9f1239', accent: '#92400e', background: '#fbf3f5' } },
  { name: 'Océan', theme: { primary: '#0369a1', accent: '#ca8a04', background: '#f0f6fb' } },
]

// ---------------- Validation ----------------

const HEX_RE = /^#[0-9a-fA-F]{6}$/

export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && HEX_RE.test(v)
}

/** Conversion #rrggbb → { h, s, l } (0-360, 0-100, 0-100). */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
    else if (max === g) h = ((b - r) / d + 2) * 60
    else h = ((r - g) / d + 4) * 60
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
}

/** Un fond de page doit rester LISIBLE (texte gris foncé dessus). */
export function isLightEnoughForBackground(hex: string): boolean {
  return hexToHsl(hex).l >= 85
}

/** Valide/nettoie une valeur de thème reçue du client. Retourne
 *  null si la valeur est inutilisable (rien à enregistrer). */
export function sanitizeTheme(value: unknown): ThemeConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const out: ThemeConfig = {}
  if (isHexColor(raw.primary)) out.primary = raw.primary.toLowerCase()
  if (isHexColor(raw.accent)) out.accent = raw.accent.toLowerCase()
  if (isHexColor(raw.background) && isLightEnoughForBackground(raw.background)) {
    out.background = raw.background.toLowerCase()
  }
  const icons = raw.icons
  if (icons && typeof icons === 'object' && !Array.isArray(icons)) {
    const i = icons as Record<string, unknown>
    const cleaned: ThemeIcons = {}
    for (const kind of ['logo', 'teacher', 'student'] as ThemeIconKind[]) {
      const choice = i[kind]
      if (
        typeof choice === 'string' &&
        (THEME_ICON_CHOICES[kind] as readonly string[]).includes(choice)
      ) {
        cleaned[kind] = choice
      }
    }
    if (Object.keys(cleaned).length > 0) out.icons = cleaned
  }
  if (Object.keys(out).length === 0) return null
  return out
}

/** Parse le JSON stocké en base (repli : thème d'origine). */
export function parseStoredTheme(raw: string): ThemeConfig {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const raw2 = parsed as Record<string, unknown>
    const out: ThemeConfig = {}
    if (isHexColor(raw2.primary)) out.primary = raw2.primary
    if (isHexColor(raw2.accent)) out.accent = raw2.accent
    if (isHexColor(raw2.background)) out.background = raw2.background
    if (raw2.icons && typeof raw2.icons === 'object' && !Array.isArray(raw2.icons)) {
      const i = raw2.icons as Record<string, unknown>
      const icons: ThemeIcons = {}
      for (const kind of ['logo', 'teacher', 'student'] as ThemeIconKind[]) {
        const c = i[kind]
        if (
          typeof c === 'string' &&
          (THEME_ICON_CHOICES[kind] as readonly string[]).includes(c)
        ) {
          icons[kind] = c
        }
      }
      if (Object.keys(icons).length > 0) out.icons = icons
    }
    return out
  } catch {
    return {}
  }
}

// ---------------- Application (variables CSS) ----------------

/** Nuances dérivées d'une couleur de base, ancrée sur la nuance 600
 *  (boutons principaux) — formule HSL simple, aucun calcul lourd. */
export function primaryShades(hex: string): Record<string, string> {
  const { h, s, l } = hexToHsl(hex)
  const S = Math.max(18, Math.min(100, s))
  const mix = (f: number, sm = 1): string => {
    const nl = l + (100 - l) * f
    const ns = Math.min(100, S * sm)
    return `hsl(${h} ${Math.round(ns)}% ${Math.round(Math.max(0, Math.min(100, nl)))}%)`
  }
  return {
    '50': mix(0.95, 0.4),
    '100': mix(0.88, 0.55),
    '200': mix(0.75, 0.7),
    '300': mix(0.55, 0.85),
    '400': mix(0.35, 0.95),
    '500': mix(0.15),
    // 600 = la couleur EXACTE choisie par l'administrateur.
    '600': `hsl(${h} ${S}% ${l}%)`,
    '700': `hsl(${h} ${S}% ${Math.round(Math.max(0, l * 0.8))}%)`,
    '800': `hsl(${h} ${S}% ${Math.round(Math.max(0, l * 0.66))}%)`,
    '900': `hsl(${h} ${Math.min(100, S * 1.05)}% ${Math.round(Math.max(0, l * 0.5))}%)`,
  }
}

/** Nuances d'accent, ancrées sur la nuance 500 (badges, ambre). */
export function accentShades(hex: string): Record<string, string> {
  const { h, s, l } = hexToHsl(hex)
  const S = Math.max(18, Math.min(100, s))
  const mix = (f: number, sm = 1): string => {
    const nl = l + (100 - l) * f
    const ns = Math.min(100, S * sm)
    return `hsl(${h} ${Math.round(ns)}% ${Math.round(Math.max(0, Math.min(100, nl)))}%)`
  }
  return {
    '50': mix(0.95, 0.4),
    '100': mix(0.88, 0.55),
    '200': mix(0.75, 0.7),
    '300': mix(0.55, 0.85),
    '400': mix(0.35, 0.95),
    // 500 = la couleur EXACTE choisie.
    '500': `hsl(${h} ${S}% ${l}%)`,
    '600': `hsl(${h} ${S}% ${Math.round(Math.max(0, l * 0.88))}%)`,
    '700': `hsl(${h} ${S}% ${Math.round(Math.max(0, l * 0.76))}%)`,
    '800': `hsl(${h} ${S}% ${Math.round(Math.max(0, l * 0.64))}%)`,
    '900': `hsl(${h} ${S}% ${Math.round(Math.max(0, l * 0.52))}%)`,
  }
}

/** Teinte de fond dérivée (page + survol des cartes). */
export function backgroundTints(hex: string): { 50: string; 100: string } {
  const { h, s, l } = hexToHsl(hex)
  const S = Math.max(8, Math.min(35, s))
  return {
    '50': `hsl(${h} ${S}% ${Math.max(94, l)}%)`,
    '100': `hsl(${h} ${S}% ${Math.max(90, Math.min(99, l - 3))}%)`,
  }
}
