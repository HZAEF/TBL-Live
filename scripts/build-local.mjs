#!/usr/bin/env node
/* eslint-disable no-console -- script d'installation locale : progress à afficher */
// ============================================================
// TBL Live v2.7.0 — Compilation pour le mode RÉSEAU LOCAL
//
// Prépare l'application à tourner sur l'ordinateur de l'enseignant
// (base SQLite locale, serveur autonome) SANS toucher au fichier
// prisma/schema.prisma « production » : le basculement
// postgresql → sqlite est temporaire et restauré automatiquement,
// même en cas d'échec. Le dossier reste donc utilisable pour GitHub.
//
// Usage : node scripts/build-local.mjs [--ensure-env]
//   --ensure-env : ne fait que créer/mettre à jour le fichier .env
//                  local (sans compiler) — utilisé au premier
//                  lancement par les scripts de démarrage.
// ============================================================

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCHEMA = join(ROOT, 'prisma', 'schema.prisma')
const SCHEMA_BACKUP = SCHEMA + '.local.bak'
const ENV_PATH = join(ROOT, '.env')
const DB_FILE = join(ROOT, 'tbl-local.db')

const onlyEnv = process.argv.includes('--ensure-env')

// ---- 1. Fichier .env : base SQLite locale (chemin ABSOLU — aucune
//         ambiguïté de dossier selon la machine) ----
function ensureEnv() {
  const dbUrl = `file:${DB_FILE.split('\\').join('/')}`
  let lines = []
  if (existsSync(ENV_PATH)) {
    lines = readFileSync(ENV_PATH, 'utf8').split('\n')
  }
  const filtered = lines.filter((l) => !/^\s*DATABASE_URL\s*=/.test(l) && l.trim() !== '')
  filtered.push(`DATABASE_URL="${dbUrl}"`)
  writeFileSync(ENV_PATH, filtered.join('\n') + '\n', 'utf8')
  console.log(`✔ Base de données locale : ${DB_FILE}`)
  console.log('✔ Fichier .env prêt (DATABASE_URL locale).')
}
ensureEnv()
if (onlyEnv) process.exit(0)

// ---- 2. Bascule temporaire postgresql → sqlite ----
const schema = readFileSync(SCHEMA, 'utf8')
if (schema.includes('provider = "sqlite"')) {
  console.log('ℹ Schéma déjà en mode local (sqlite) — probable compilation interrompue : schéma restauré à la fin.')
} else if (!schema.includes('provider = "postgresql"')) {
  console.error('✘ provider inattendu dans prisma/schema.prisma — fichier non modifié.')
  process.exit(1)
}
if (existsSync(SCHEMA_BACKUP)) unlinkSync(SCHEMA_BACKUP)
copyFileSync(SCHEMA, SCHEMA_BACKUP)
const localSchema = schema.replace('provider = "postgresql"', 'provider = "sqlite"')
writeFileSync(SCHEMA, localSchema, 'utf8')
console.log('✔ Schéma basculé en mode local (sqlite) — restauration automatique ensuite.')

function restoreSchema() {
  if (!existsSync(SCHEMA_BACKUP)) return
  copyFileSync(SCHEMA_BACKUP, SCHEMA)
  unlinkSync(SCHEMA_BACKUP)
  console.log('✔ Schéma « production » (postgresql) restauré — le dossier reste conforme à GitHub.')
}

// ---- 3. Compilation complète (prisma generate + db-apply + next build) ----
const NEED_SHELL = process.platform === 'win32'
try {
  const res = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: NEED_SHELL, cwd: ROOT })
  if (res.status !== 0) {
    console.error('✘ La compilation a échoué (code ' + res.status + ').')
    process.exit(1)
  }
} finally {
  restoreSchema()
}

if (!existsSync(join(ROOT, '.next', 'standalone', 'server.js'))) {
  console.error('✘ Le serveur autonome n’a pas été produit — voir le journal ci-dessus.')
  process.exit(1)
}
console.log('')
console.log('✔ Compilation locale terminée.')
console.log('  Lancez maintenant :  node --env-file=.env .next/standalone/server.js')
console.log('  (ou simplement le script « demarrer-local-WINDOWS.bat » / « demarrer-local-MAC.command »)')
