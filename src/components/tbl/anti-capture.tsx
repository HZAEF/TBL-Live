'use client'

// ============================================================
// TBL Live v2.5.0 — Protection anti-capture (vue étudiant).
//
// Vérité technique à lire AVANT toute modification : AUCUN
// navigateur (Android/Chrome, iPhone/Safari…) ne permet
// d'empêcher une capture d'écran. Le fameux « FLAG_SECURE »
// d'Android n'existe que pour les applications natives, et Apple
// ne le propose même pas aux applis. Ce composant applique donc
// la stratégie réaliste, celle des applications bancaires :
//
// 1. FILIGRANE (watermark) : nom de l'étudiant · code de la
//    séance · date et heure, répété en diagonale sur tout
//    l'écran. Discret pour lire, mais présent dans CHAQUE
//    capture : une image qui circule indique QUI et QUAND.
//    L'horodatage est remis à jour toutes les 30 s.
// 2. FLOU EN ARRIÈRE-PLAN : dès que l'onglet n'est plus visible
//    (visibilitychange — application mise de côté, écran
//    verrouillé), tout devient flou : l'aperçu des applications
//    récentes d'Android et les enregistrements d'écran ne
//    montrent plus le contenu.
// 3. ANTI-COPIE : sélection de texte et menu contextuel (clic
//    droit / appui long) désactivés sur le contenu de la séance ;
//    impression et « imprimer en PDF » remplacés par un message.
//
// Ce qui reste impossible (assumé) : une capture ou une photo
// prise écran allumé, application au premier plan. Seule la
// traçabilité du filigrane joue alors.
// ============================================================

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Types de signalement envoyés à l'enseignant (voir /api/alert). */
type AlertKind = 'screenshot' | 'tab_hidden'

/** Horodatage compact, indépendant de la langue : « 6/9 14:05 ». */
function stamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getDate()}/${d.getMonth() + 1} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;')
    .replace(/"/g, '&quot;')
}

/** Motif du filigrane : image SVG répétée.
 *  Compatible avec la CSP v2.4.0 (img-src autorise data:). */
function watermarkUrl(text: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='170'>` +
    `<text x='-20' y='90' transform='rotate(-22)' ` +
    `font-family='Arial, sans-serif' font-size='12' ` +
    `fill='rgba(110,110,120,0.16)'>${escapeXml(text)}</text></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

/** Envoi silencieux d'un signalement à l'enseignant (jamais de message
 *  ni d'erreur affichés à l'étudiant). La phase est envoyée avec le
 *  signalement (v2.5.1) pour que l'enseignant sache pendant QUELLE épreuve
 *  (iRAT, tRAT, application…) l'événement a eu lieu. Référence stable :
 *  ne change que si le jeton ou la phase change. */
function useReport(
  token: string | undefined,
  phase: string | undefined
): (kind: AlertKind) => void {
  // Anti-rafales : au plus un envoi par type toutes les 5 s côté client
  // (le serveur re-déduplique à la minute).
  const lastSent = useRef<Record<string, number>>({})
  return useCallback(
    (kind: AlertKind) => {
      if (!token) return
      const now = Date.now()
      if (now - (lastSent.current[kind] ?? 0) < 5_000) return
      lastSent.current[kind] = now
      fetch('/api/alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ kind, phase: phase ?? null }),
      }).catch(() => {})
    },
    [token, phase]
  )
}

export function AntiCapture({
  label,
  printMessage,
  reportToken,
  watchTab,
  phase,
  children,
}: {
  /** Ce qui identifie l'écran dans le filigrane (nom · code). */
  label: string
  /** Message affiché à la place du contenu lors d'une impression. */
  printMessage?: string
  /** Jeton étudiant : si fourni, les suspicions de capture d'écran (PC)
   *  sont signalées silencieusement à l'enseignant. */
  reportToken?: string
  /** true pendant les phases de test (iRAT/tRAT/application) : une sortie
   *  de l'application (changement d'onglet/app, verrouillage) est signalée. */
  watchTab?: boolean
  /** v2.5.1 : phase en cours (statut de la séance) envoyée avec chaque
   *  signalement — permet à l'enseignant de savoir pendant quelle épreuve
   *  (iRAT, tRAT, application…) l'événement a eu lieu. */
  phase?: string
  children: ReactNode
}) {
  // Initialisation paresseuse : ce composant n'est monté QU'EN CLIENT
  // (StudentSession ne s'affiche qu'une fois le jeton étudiant obtenu,
  // via localStorage/fetch) — aucun rendu serveur, donc pas de risque
  // d'écart d'hydratation sur l'horodatage.
  const [time, setTime] = useState(stamp)
  const [hidden, setHidden] = useState(false)

  // Horodatage du filigrane rafraîchi toutes les 30 s : chaque
  // capture est ainsi datée à la demi-minute près.
  useEffect(() => {
    const id = setInterval(() => setTime(stamp()), 30_000)
    return () => clearInterval(id)
  }, [])

  // Flou dès que l'onglet n'est plus visible (aperçu des
  // applications récentes, enregistrement d'écran, écran
  // verrouillé) ; l'écran redevient net dès le retour.
  // Pendant les tests (watchTab), chaque passage en arrière-plan
  // est de plus signalé à l'enseignant — signal FIABLE sur tous les
  // appareils (téléphones inclus), contrairement aux captures.
  const report = useReport(reportToken, phase)
  useEffect(() => {
    const onVis = () => {
      setHidden(document.hidden)
      if (document.hidden && watchTab) report('tab_hidden')
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [watchTab, report])

  // ---- Détection des suspicions de capture (PC uniquement) ----
  // Aucune API web n'existe pour les téléphones ; sur PC, on détecte les
  // combinaisons de touches classiques : Impr. écran (relâchement),
  // Cmd+Shift+3/4/5 (macOS), Win+Shift+S (outil capture de Windows).
  // On NE BLOQUE RIEN (impossible de toute façon) : on observe et on
  // signale — le filigrane reste la vraie protection.
  useEffect(() => {
    const isApple = /Mac|iPhone|iPad/.test(navigator.platform || '')
    const onKey = (e: KeyboardEvent) => {
      // macOS : Cmd+Shift+3/4/5 = capture plein écran / zone / fenêtre
      if (e.metaKey && e.shiftKey && (e.key === '3' || e.key === '4' || e.key === '5')) {
        report('screenshot')
        return
      }
      // Windows/Linux : Win+Shift+S = outil « Capture d'écran »
      if (!isApple && e.metaKey && e.shiftKey && (e.key === 's' || e.key === 'S')) {
        report('screenshot')
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      // Windows/Linux : la touche « Impr. écran » (l'événement arrive
      // au relâchement de la touche dans Chrome).
      if (e.key === 'PrintScreen') report('screenshot')
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [report])

  // Menu contextuel (clic droit / appui long) bloqué pendant la
  // séance — complément de user-select:none, voir globals.css.
  useEffect(() => {
    const onCtx = (e: MouseEvent) => e.preventDefault()
    document.addEventListener('contextmenu', onCtx)
    return () => document.removeEventListener('contextmenu', onCtx)
  }, [])

  return (
    <>
      <div className={cn('tbl-protect', hidden && 'tbl-protect-hidden')}>
        {children}
        <div
          aria-hidden="true"
          className="tbl-watermark"
          style={{ backgroundImage: watermarkUrl(`${label} · ${time}`) }}
        />
      </div>
      {printMessage ? <div className="tbl-print-msg">{printMessage}</div> : null}
    </>
  )
}
