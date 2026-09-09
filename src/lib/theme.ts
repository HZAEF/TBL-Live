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
  // v3.1.0 — icônes TÉLÉVERSÉES par l'administrateur (demande de
  // l'enseignante : ses propres logos/images en plus des icônes
  // proposées). Valeur = data URL (data:image/png|svg+xml|webp;base64,
  // …) STRICTEMENT validée côté serveur (format, taille, contenu).
  // Une icône téléversée PRIME sur l'icône lucide choisie pour le même
  // emplacement ; retirer le data URL retombe sur l'icône lucide.
  customIcons?: Partial<Record<ThemeIconKind, string>>
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

/** v3.1.0 — Taille maximale d'une icône téléversée, en caractères de
 *  data URL base64 (≈ 90 Ko binaires). Suffisant pour un logo propre,
 *  assez petit pour rester léger sur /api/config (150 étudiants).
 *  L'administrateur est guidé vers des images REDIMENSIONNÉES côté
 *  client (128×128) : la limite est rarement atteinte. */
export const THEME_ICON_MAX_DATAURL = 120_000

/** v3.1.0 — Dimensions maximales admises pour une image raster
 *  téléversée AVANT réduction (le navigateur de l'admin la réduit à
 *  128×128 ; les images plus grandes que 4096 px sont refusées,
 *  elles proviennent probablement d'une erreur de fichier). */
export const THEME_ICON_MAX_DIMENSION = 4096

const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/

/** v3.1.0 — Valide une icône téléversée reçue du client (ou lue en
 *  base) : format data URL, taille, MAGIC BYTES du contenu réel
 *  (PNG / WebP / SVG) et, pour le SVG, absence de scripts ou
 *  d'événements inline. Retourne la valeur nettoyée ou null.
 *  SÉCURITÉ : les images <img> n'exécutent pas les scripts d'un SVG,
 *  mais le contenu est quand même nettoyé (défense en profondeur,
 *  et le data URL peut finir dans d'autres contextes). */
export function sanitizeIconDataUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  if (value.length > THEME_ICON_MAX_DATAURL) return null
  const m = value.match(/^data:(image\/(png|svg\+xml|webp));base64,(.*)$/)
  if (!m) return null
  const mime = m[1]
  const b64 = m[3]
  if (!B64_RE.test(b64)) return null
  let buf: Buffer
  try {
    buf = Buffer.from(b64, 'base64')
  } catch {
    return null
  }
  if (buf.length === 0 || buf.length > 96_000) return null
  if (mime === 'image/png') {
    // Signature PNG : 89 50 4E 47 0D 1A 0A
    if (!(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)) return null
  } else if (mime === 'image/webp') {
    // Signature RIFF….WEBP
    if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
      return null
    }
  } else {
    // SVG : texte contenant <svg, sans script ni attribut d'événement,
    // sans référence externe (pas de fuite de requête au chargement).
    const text = buf.toString('utf8').trim()
    if (!text.includes('<svg') || text.length < 10) return null
    const lowered = text.toLowerCase()
    if (
      lowered.includes('<script') ||
      lowered.includes('javascript:') ||
      /\son[a-z]+\s*=/.test(lowered) ||
      lowered.includes('href="http') ||
      lowered.includes("href='http") ||
      lowered.includes('xlink:href="http')
    ) {
      return null
    }
  }
  return `data:${mime};base64,${b64}`
}

/** Extrait les icônes personnalisées valides d'un objet brut (partagé
 *  entre sanitizeTheme et parseStoredTheme — mêmes règles partout). */
function sanitizeCustomIcons(raw: unknown): Partial<Record<ThemeIconKind, string>> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const i = raw as Record<string, unknown>
  const cleaned: Partial<Record<ThemeIconKind, string>> = {}
  for (const kind of ['logo', 'teacher', 'student'] as ThemeIconKind[]) {
    const v = sanitizeIconDataUrl(i[kind])
    if (v) cleaned[kind] = v
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined
}

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
  // v3.1.0 — icônes téléversées (data URL validées : format, taille,
  // magic bytes, SVG sans script).
  const customIcons = sanitizeCustomIcons(raw.customIcons)
  if (customIcons) out.customIcons = customIcons
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
    // v3.1.0 — icônes téléversées : revalidées à la lecture (une valeur
    // invalide/altérée en base est ignorée silencieusement).
    const customIcons = sanitizeCustomIcons(raw2.customIcons)
    if (customIcons) out.customIcons = customIcons
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
