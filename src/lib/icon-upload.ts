'use client'

// ============================================================
// TBL Live v3.1.0 — Téléversement d'icônes personnalisées
// (traitement CÔTÉ CLIENT, avant l'envoi au serveur)
//
// L'administrateur peut téléverser ses propres images pour les trois
// emplacements du thème (logo, carte enseignant, carte étudiant),
// en plus des icônes proposées. Contraintes (demande : « vous pouvez
// exiger des dimensions à ne pas dépasser si nécessaire ») :
//
//  - PNG, JPEG, WebP ou SVG ;
//  - dimensions d'origine ≤ 4096×4096 (au-delà : refus net — c'est
//    probablement une erreur de fichier) ;
//  - TOUTE image raster est REDIMENSIONNÉE à 128×128 (max) par un
//    canvas : les icônes s'affichent à 20-24 px, 128 px garantit la
//    netteté sur écran Retina pour quelques Ko ;
//  - le résultat doit rester ≤ 90 Ko en data URL, sinon refus avec
//    un message clair (réduisez la complexité de l'image) ;
//  - SVG vectoriel : transmis tel quel (qualité parfaite à toute
//    taille) mais NETTOYÉ : pas de script, pas d'attribut d'événement,
//    pas de référence externe — et ≤ 64 Ko.
//
// Le serveur revalide TOUT (format, magic bytes, taille, contenu) :
// la validation client est une aide ergonomique, jamais la sécurité.
// ============================================================

import { THEME_ICON_MAX_DIMENSION } from '@/lib/theme'

/** Taille max d'un SVG source (avant nettoyage), en octets. */
const SVG_MAX_BYTES = 64 * 1024
/** Taille max du fichier source accepté (les photos de 5 Mo sont
 *  redimensionnées de toute façon — au-delà de 20 Mo, refus). */
const FILE_MAX_BYTES = 20 * 1024 * 1024
/** Dimension cible du rendu raster (canvas). */
const TARGET_PX = 128
/** Taille max du data URL produit. */
const OUTPUT_MAX_CHARS = 120_000

export interface IconProcessResult {
  ok: true
  dataUrl: string
  note: string
}

export interface IconProcessError {
  ok: false
  error: string
}

/** Traite un fichier image choisi par l'administrateur → data URL
 *  prêt à enregistrer dans le thème. */
export async function processIconFile(file: File): Promise<IconProcessResult | IconProcessError> {
  if (file.size > FILE_MAX_BYTES) {
    return { ok: false, error: 'Fichier trop volumineux (20 Mo maximum).' }
  }
  const name = file.name.toLowerCase()
  const type = file.type

  // ---------- SVG : vectoriel, transmis nettoyé ----------
  if (name.endsWith('.svg') || type === 'image/svg+xml') {
    const text = await file.text()
    return processSvgText(text)
  }

  // ---------- Raster (PNG/JPEG/WebP) : redimensionné ----------
  if (!/^image\/(png|jpeg|jpg|webp)$/.test(type)) {
    return {
      ok: false,
      error: 'Format non pris en charge — utilisez PNG, JPEG, WebP ou SVG.',
    }
  }
  const bitmap = await loadImage(file)
  if (!bitmap.ok) return { ok: false, error: bitmap.error }
  const { width, height } = bitmap
  if (width > THEME_ICON_MAX_DIMENSION || height > THEME_ICON_MAX_DIMENSION) {
    return {
      ok: false,
      error: `Image trop grande (${width}×${height} px) — 4096×4096 px maximum.`,
    }
  }
  // Réduction en conservant les proportions (max 128 px sur le côté
  // le plus grand) ; jamais d'agrandissement.
  const scale = Math.min(1, TARGET_PX / Math.max(width, height))
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return { ok: false, error: 'Impossible de traiter l’image (canvas indisponible).' }
  ctx.drawImage(bitmap.img, 0, 0, w, h)
  let dataUrl: string
  try {
    dataUrl = canvas.toDataURL('image/png')
  } catch {
    return { ok: false, error: 'Impossible de convertir l’image.' }
  }
  if (dataUrl.length > OUTPUT_MAX_CHARS) {
    return {
      ok: false,
      error: 'Image trop lourde après réduction (90 Ko maximum) — simplifiez-la.',
    }
  }
  return {
    ok: true,
    dataUrl,
    note: `${width}×${height} → ${w}×${h} px`,
  }
}

/** Valide et nettoie un SVG source → data URL. */
export async function processSvgText(text: string): Promise<IconProcessResult | IconProcessError> {
  const trimmed = text.trim()
  if (trimmed.length === 0) return { ok: false, error: 'Fichier SVG vide.' }
  if (trimmed.length > SVG_MAX_BYTES) {
    return { ok: false, error: 'SVG trop volumineux (64 Ko maximum).' }
  }
  if (!trimmed.includes('<svg')) {
    return { ok: false, error: 'Ce fichier n’est pas un SVG valide.' }
  }
  const lowered = trimmed.toLowerCase()
  if (
    lowered.includes('<script') ||
    lowered.includes('javascript:') ||
    /\son[a-z]+\s*=/.test(lowered) ||
    lowered.includes('href="http') ||
    lowered.includes("href='http") ||
    lowered.includes('xlink:href="http')
  ) {
    return {
      ok: false,
      error: 'SVG refusé : scripts, événements ou références externes interdits.',
    }
  }
  const b64 = btoa(unescape(encodeURIComponent(trimmed)))
  const dataUrl = `data:image/svg+xml;base64,${b64}`
  if (dataUrl.length > OUTPUT_MAX_CHARS) {
    return { ok: false, error: 'SVG trop volumineux (64 Ko maximum).' }
  }
  return { ok: true, dataUrl, note: 'SVG vectoriel (net à toute taille)' }
}

function loadImage(
  file: File
): Promise<{ ok: true; img: HTMLImageElement; width: number; height: number } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const width = img.naturalWidth
      const height = img.naturalHeight
      URL.revokeObjectURL(url)
      if (width < 1 || height < 1) {
        resolve({ ok: false, error: 'Image illisible.' })
        return
      }
      resolve({ ok: true, img, width, height })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve({ ok: false, error: 'Impossible de lire cette image.' })
    }
    img.src = url
  })
}
