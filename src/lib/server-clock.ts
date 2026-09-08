'use client'

// ============================================================
// TBL Live v2.9.0 — Horloge synchronisée sur le serveur
//
// PROBLÈME. Les minuteurs (iRAT descendant, durée de phase
// ascendante) comparaient l'horloge de l'APPAREIL à la date de
// début de phase enregistrée par le SERVEUR. Or l'horloge d'un
// téléphone peut être en avance ou en retard de plusieurs minutes
// (heure manuelle, fuseau mal réglé…) : le compte à rebours
// affichait alors un temps faux, différent d'un étudiant à
// l'autre, et « temps écoulé » arrivait trop tôt ou trop tard.
//
// SOLUTION. Chaque réponse de l'API embarque « serverNow »
// (l'heure exacte du serveur au moment de la réponse). Le client
// en déduit l'écart entre son horloge et celle du serveur, puis
// toutes les secondes les minuteurs interrogent l'heure serveur
// reconstituée : enseignant et étudiants voient donc EXACTEMENT
// le même chronomètre, quelle que soit l'horloge de l'appareil.
// L'écart est recalculé à chaque sondage (toutes les 2,5 s) et
// n'est réappliqué que s'il dépasse 750 ms — pas de tremblement
// d'affichage à cause de la latence réseau.
// ============================================================

let offsetMs = 0

/** Enregistre l'heure serveur reçue dans une réponse API. */
export function noteServerNow(iso?: string | null): void {
  if (typeof iso !== 'string' || iso.length === 0) return
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return
  // serverNow a été émise juste AVANT l'envoi de la réponse : la
  // traversée réseau (quelques dizaines de ms) est volontairement
  // ignorée — l'erreur résiduelle est bien inférieure à une seconde.
  const delta = t - Date.now()
  if (Math.abs(delta - offsetMs) > 750) offsetMs = delta
}

/** Heure serveur reconstituée, en millisecondes. */
export function serverNowMs(): number {
  return Date.now() + offsetMs
}
