'use client'

// ============================================================
// Sélecteur de langue : bouton compact avec drapeau, menu
// déroulant listant les 7 langues (drapeau + nom natif).
// Drapeaux = petits SVG inline (aucune image à télécharger,
// rendu identique sur tous les appareils, y compris Windows
// où les drapeaux emoji ne s'affichent pas).
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { LANGS, useI18n, type Lang } from '@/lib/i18n'
import { cn } from '@/lib/utils'

// ---------- Drapeaux (SVG simplifiés 20 × 15) ----------

function starPath(cx: number, cy: number, r: number): string {
  // Étoile à 5 branches : rayon externe r, rayon interne 0.382 r
  const inner = r * 0.382
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : inner
    const a = (Math.PI / 5) * i - Math.PI / 2
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`)
  }
  return `M${pts.join('L')}Z`
}

const FLAG_FILLERS: Record<Lang, React.ReactNode> = {
  // France : trois bandes verticales
  fr: (
    <>
      <rect width="6.67" height="15" fill="#0055A4" />
      <rect x="6.67" width="6.67" height="15" fill="#FFFFFF" />
      <rect x="13.33" width="6.67" height="15" fill="#EF4135" />
    </>
  ),
  // Royaume-Uni (anglais) : Union Jack simplifié
  en: (
    <>
      <rect width="20" height="15" fill="#012169" />
      <path d="M0,0 L20,15 M20,0 L0,15" stroke="#FFFFFF" strokeWidth="3" />
      <path d="M0,0 L20,15 M20,0 L0,15" stroke="#C8102E" strokeWidth="1" />
      <rect x="8" width="4" height="15" fill="#FFFFFF" />
      <rect y="5.5" width="20" height="4" fill="#FFFFFF" />
      <rect x="9" width="2" height="15" fill="#C8102E" />
      <rect y="6.5" width="20" height="2" fill="#C8102E" />
    </>
  ),
  // Espagne : rouge / jaune / rouge (1:2:1)
  es: (
    <>
      <rect width="20" height="15" fill="#AA151B" />
      <rect y="3.75" width="20" height="7.5" fill="#F1BF00" />
    </>
  ),
  // Allemagne : noir / rouge / or
  de: (
    <>
      <rect width="20" height="5" fill="#000000" />
      <rect y="5" width="20" height="5" fill="#DD0000" />
      <rect y="10" width="20" height="5" fill="#FFCE00" />
    </>
  ),
  // Chine : rouge + étoile jaune
  zh: (
    <>
      <rect width="20" height="15" fill="#DE2910" />
      <path d={starPath(3.4, 4.2, 2.4)} fill="#FFDE00" />
      <path d={starPath(7.2, 1.6, 0.8)} fill="#FFDE00" />
      <path d={starPath(8.6, 3.1, 0.8)} fill="#FFDE00" />
      <path d={starPath(8.6, 5.1, 0.8)} fill="#FFDE00" />
      <path d={starPath(7.2, 6.5, 0.8)} fill="#FFDE00" />
    </>
  ),
  // Russie : blanc / bleu / rouge
  ru: (
    <>
      <rect width="20" height="5" fill="#FFFFFF" />
      <rect y="5" width="20" height="5" fill="#0039A6" />
      <rect y="10" width="20" height="5" fill="#D52B1E" />
    </>
  ),
  // Arabe : drapeau vert + croissant et étoile (choix demandé :
  // « arabe vert », distinct de tous les autres drapeaux)
  ar: (
    <>
      <rect width="20" height="15" fill="#007A3D" />
      <circle cx="9.6" cy="7.5" r="3.6" fill="#FFFFFF" />
      <circle cx="10.9" cy="7.5" r="3.2" fill="#007A3D" />
      <path d={starPath(14.6, 7.5, 1.5)} fill="#FFFFFF" />
    </>
  ),
}

export function Flag({ code, className }: { code: Lang; className?: string }) {
  return (
    <svg
      viewBox="0 0 20 15"
      role="img"
      aria-hidden="true"
      className={cn('h-[15px] w-[20px] shrink-0 overflow-hidden rounded-[2px]', className)}
    >
      {FLAG_FILLERS[code]}
    </svg>
  )
}

// ---------- Sélecteur ----------

export function LangPicker({ className }: { className?: string }) {
  const { lang, setLang } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const currentName = LANGS.find((l) => l.code === lang)?.name ?? 'Français'

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={currentName}
        title={currentName}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2 text-sm font-medium text-stone-700 shadow-sm transition-colors hover:border-emerald-400 hover:bg-emerald-50"
      >
        <Flag code={lang} />
        <ChevronDown
          className={cn('h-3.5 w-3.5 text-stone-400 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Langue / Language"
          className="absolute end-0 z-50 mt-1.5 min-w-[10rem] overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-lg"
        >
          {LANGS.map((l) => (
            <li key={l.code} role="option" aria-selected={l.code === lang}>
              <button
                type="button"
                onClick={() => {
                  setLang(l.code)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-start text-sm transition-colors',
                  l.code === lang
                    ? 'bg-emerald-50 font-semibold text-emerald-800'
                    : 'text-stone-700 hover:bg-stone-50'
                )}
              >
                <Flag code={l.code} />
                <span className="flex-1">{l.name}</span>
                {l.code === lang && <Check className="h-4 w-4 text-emerald-600" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
