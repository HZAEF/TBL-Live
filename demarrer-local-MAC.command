#!/bin/bash
# ============================================================
#   TBL LIVE — MODE RÉSEAU LOCAL (sans Internet) — macOS / Linux
#   Double-cliquez ce fichier. Première fois : installation
#   (2-4 min). Ensuite : démarrage direct du serveur local.
# ============================================================
cd "$(dirname "$0")"

echo ""
echo "============================================================"
echo "  TBL LIVE — MODE RÉSEAU LOCAL (sans Internet)"
echo "============================================================"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js est introuvable sur cet ordinateur."
  echo "Installez la version LTS depuis https://nodejs.org puis relancez ce fichier."
  exit 1
fi

# --- Première préparation (fichier .env avec la base locale) ---
if [ ! -f ".env" ]; then
  echo "Préparation de la base de données locale..."
  node scripts/build-local.mjs --ensure-env || exit 1
fi

# --- Installation des composants (première fois seulement) ---
if [ ! -d "node_modules/next" ]; then
  echo "Première installation des composants (2 à 4 minutes, une seule fois)..."
  npm install || exit 1
fi

# --- Compilation (première fois seulement ou après une mise à jour) ---
if [ ! -f ".next/standalone/server.js" ]; then
  echo "Compilation pour le réseau local (1 à 2 minutes)..."
  node scripts/build-local.mjs || exit 1
fi

echo ""
echo "============================================================"
echo "  LE SERVEUR LOCAL VA DÉMARRER."
echo ""
echo "  Adresses à donner aux étudiants (sur le Wi-Fi de la salle) :"
echo "============================================================"
node -e "const os=require('os');const n=os.networkInterfaces();let f=0;for(const k of Object.keys(n)){for(const a of n[k]){if(a.family==='IPv4'&&!a.internal){f++;console.log('     http://'+a.address+':3000     ('+k+')')}}}if(!f)console.log('     Aucune adresse réseau trouvée — connectez le Wi-Fi')"
echo ""
echo "  - Gardez cette fenêtre OUVERTE pendant toute la séance."
echo "  - Si macOS demande l'autorisation réseau : cliquez AUTORISER."
echo "  - Ctrl+C pour arrêter le serveur à la fin."
echo "============================================================"
echo ""

HOSTNAME=0.0.0.0 node --env-file=.env .next/standalone/server.js

echo ""
echo "Serveur arrêté."
