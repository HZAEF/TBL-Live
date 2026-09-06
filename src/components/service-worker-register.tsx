'use client'

import { useEffect } from 'react'

/**
 * Enregistrement du service worker minimal (public/sw.js) — v2.4.0.
 *
 * Rend l'application réellement installable sur Android/Chrome (bouton
 * « Installer l'application », fenêtre autonome sans barre du navigateur).
 * iOS/Safari ne l'exige pas mais le supporte sans souci.
 *
 * Conditions d'enregistrement :
 *  - build de production uniquement (jamais en développement, sinon le SW
 *    perturbe le rechargement à chaud) ;
 *  - contexte sécurisé (HTTPS — Vercel — ou localhost) ;
 *  - navigateur compatible (sinon silencieusement ignoré).
 *
 * Le SW ne met RIEN en cache : en cas d'échec d'enregistrement, tout
 * continue de fonctionner exactement comme avant (best effort pur).
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    if (typeof window !== 'undefined' && !window.isSecureContext) return
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Échec sans conséquence : l'application fonctionne sans SW.
    })
  }, [])
  return null
}
