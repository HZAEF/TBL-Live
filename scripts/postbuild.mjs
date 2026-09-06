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
// - v2.4.0 : si Next.js émet le serveur autonome dans un sous-dossier
//   (arrive quand le projet est construit À L'INTÉRIEUR d'un espace de
//   travail Next existant), les fichiers statiques sont copiés AUSSI à
//   côté de ce serveur imbriqué — les deux emplacements sont couverts.
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

if (process.env.VERCEL) {
  console.log("Vercel détecté : pas de copie standalone (géré par Vercel).");
  process.exit(0);
}

if (!existsSync(".next/standalone")) {
  console.log("Pas de dossier .next/standalone : rien à copier.");
  process.exit(0);
}

function copyStaticAssets(targetDir) {
  mkdirSync(join(targetDir, ".next"), { recursive: true });
  cpSync(".next/static", join(targetDir, ".next", "static"), { recursive: true });
  cpSync("public", join(targetDir, "public"), { recursive: true });
}

copyStaticAssets(".next/standalone");
console.log("Mode local : fichiers statiques copiés dans .next/standalone ✔");

// Recherche d'un serveur autonome imbriqué (.next/standalone/<sous-chemin>/server.js,
// hors node_modules) — layout émis quand le build tourne dans un dossier
// contenu par un autre projet Next (espace de travail / monorepo).
function findNestedServerDirs(dir, depth = 0, acc = []) {
  if (depth > 6) return acc;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      findNestedServerDirs(p, depth + 1, acc);
    } else if (name === "server.js") {
      acc.push(dir);
    }
  }
  return acc;
}

const nestedDirs = findNestedServerDirs(".next/standalone").filter(
  (d) => d !== ".next/standalone"
);
for (const d of nestedDirs) {
  copyStaticAssets(d);
  console.log(`Serveur autonome imbriqué détecté : statiques copiés aussi dans ${d} ✔`);
}
