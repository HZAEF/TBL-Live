/* eslint-disable no-console -- script de build : son rôle est d'afficher sa progression */
// Étape finale du « npm run build » : copie des fichiers statiques dans le
// dossier autonome (.next/standalone) — nécessaire uniquement pour démarrer
// l'application en LOCAL avec « node .next/standalone/server.js ».
//
// Ce script remplace les anciennes commandes « cp -r » :
// - sur Vercel (VERCEL=1), le mode standalone est désactivé → il ne fait
//   rien (Vercel gère lui-même la mise en production) ;
// - sur Windows, il fonctionne nativement (les commandes « cp » n'existaient
//   pas dans l'invite de commandes Windows).
import { cpSync, existsSync, mkdirSync } from "node:fs";

if (process.env.VERCEL) {
  console.log("Vercel détecté : pas de copie standalone (géré par Vercel).");
  process.exit(0);
}

if (!existsSync(".next/standalone")) {
  console.log("Pas de dossier .next/standalone : rien à copier.");
  process.exit(0);
}

mkdirSync(".next/standalone/.next", { recursive: true });
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
cpSync("public", ".next/standalone/public", { recursive: true });
console.log("Mode local : fichiers statiques copiés dans .next/standalone ✔");
