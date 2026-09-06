// ============================================================
// TBL Live — service worker minimal (v2.4.0)
//
// Rôle UNIQUE : rendre l'application réellement installable sur
// Android/Chrome (l'écran d'accueil, mode fenêtre autonome).
// Chrome exige un service worker actif avec un gestionnaire
// « fetch » pour proposer l'installation — c'est ce que fait ce
// fichier.
//
// Volontairement SANS mise en cache : chaque requête passe
// directement au réseau. On ne veut JAMAIS servir une version
// périmée de l'application (l'iRAT en cours doit toujours
// interroger le serveur). Aucun contenu hors ligne, aucun risque
// de « vieille version coincée » après une mise à jour.
// ============================================================

self.addEventListener('install', () => {
  // Prise de contrôle immédiate, sans attendre le rechargement
  // des onglets déjà ouverts.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  // Uniquement les requêtes GET, en transparence totale vers le
  // réseau (jamais de cache, jamais de réponse fabriquée).
  if (event.request.method !== 'GET') return
  event.respondWith(fetch(event.request))
})
