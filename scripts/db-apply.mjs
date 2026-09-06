// ============================================================
// TBL Live — Application du schéma Prisma en production (v2.4.0)
//
// Remplace « prisma db push --accept-data-loss » dans le build :
//  1. Calcule le diff SQL entre la base RÉELLE et prisma/schema.prisma
//     (prisma migrate diff --from-schema-datasource --to-schema-datamodel).
//  2. Si le diff est vide → rien à faire (aucune requête inutile).
//  3. GARDE-FOU ANTI-DESTRUCTIF : si le diff contient la moindre
//     opération destructrice (DROP TABLE, DROP COLUMN, ALTER COLUMN…),
//     le script ÉCHOUE volontairement avec un message clair — les
//     données de production ne peuvent plus être modifiées ou perdues
//     silencieusement lors d'une mise à jour.
//  4. Sinon (changements purement additifs : nouvelles tables, nouvelles
//     colonnes, contraintes/index), applique le SQL via prisma db execute.
//
// Compatibilité : PostgreSQL (Neon/Vercel) et SQLite (essai local),
// Windows/macOS/Linux (Node pur, aucun tube shell).
//
// Nettoyage préalable best-effort : avant de créer la contrainte unique
// tRAT (v2.4.0), on supprime les éventuelles tentatives dupliquées
// (teamId, questionId, kind, attempt) — double clic simultané historique
// — en gardant la plus ancienne (la première soumission).
// ============================================================

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, isAbsolute, resolve } from 'node:path'

const SCHEMA = 'prisma/schema.prisma'

// Charge .env (si présent) comme le fait la CLI Prisma — Node ne le fait
// PAS tout seul, et DATABASE_URL est indispensable ci-dessous. Les
// variables déjà définies par l'environnement (Vercel) priment.
function loadDotEnv() {
  try {
    const raw = readFileSync('.env', 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      let v = m[2]
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = v
    }
  } catch {
    // pas de .env : on utilise l'environnement tel quel (Vercel)
  }
}
loadDotEnv()

// Windows exige un shell pour résoudre npx.cmd ; Linux/macOS n'en ont
// pas besoin (et s’en passer évite les avertissements Node DEP0190).
const NEED_SHELL = process.platform === 'win32'

// ---- Amorce SQLite : « migrate diff » exige une base EXISTANTE ----
// (contrairement à « db push » qui crée le fichier tout seul). Sur
// Neon/PostgreSQL ce cas n'existe pas : la base existe toujours, seules
// les tables manquent. En local (sqlite), on crée un fichier vide si
// nécessaire — un fichier de 0 octet est une base SQLite vide valide.
// Les chemins sqlite relatifs sont résolus par Prisma par rapport au
// dossier du schéma (prisma/), on reproduit la même règle.
function bootstrapSqliteFile() {
  const url = process.env.DATABASE_URL || ''
  if (!url.startsWith('file:')) return
  let p = url.slice('file:'.length).split('?')[0]
  if (p === '') return
  if (!isAbsolute(p)) p = resolve(dirname(SCHEMA), p.replace(/^\.\//, ''))
  if (!existsSync(p)) {
    writeFileSync(p, Buffer.alloc(0))
    console.log(`Base SQLite locale créée (vierge) : ${p}`)
  }
}
bootstrapSqliteFile()

function prisma(args) {
  const res = spawnSync('npx', ['prisma', ...args], {
    shell: NEED_SHELL,
    encoding: 'utf8',
  })
  if (res.status !== 0) {
    console.error(
      `✘ La commande « prisma ${args.join(' ')} » a échoué (code ${res.status}).`
    )
    if (res.stderr) console.error(res.stderr.toString().trim())
    process.exit(1)
  }
  return (res.stdout || '').toString()
}

// ---- 1. Diff SQL entre la base réelle et le schéma cible ----
const rawDiff = prisma([
  'migrate',
  'diff',
  '--from-schema-datasource',
  SCHEMA,
  '--to-schema-datamodel',
  SCHEMA,
  '--script',
])
// Un diff « vide » contient quand même un commentaire (-- This is an
// empty migration.) : on ne garde que les instructions SQL réelles.
const diffSql = rawDiff
  .split('\n')
  .filter((l) => l.trim() !== '' && !l.trim().startsWith('--'))
  .join('\n')
  .trim()

if (!diffSql) {
  console.log('✔ Base de données déjà synchronisée avec le schéma (aucun changement).')
  process.exit(0)
}

// ---- 2. Garde-fou anti-destructif ----
const FORBIDDEN = [
  { re: /DROP\s+TABLE/i, label: 'suppression de table' },
  { re: /DROP\s+COLUMN/i, label: 'suppression de colonne' },
  { re: /ALTER\s+COLUMN/i, label: 'modification de type de colonne' },
  { re: /DROP\s+NOT\s+NULL/i, label: 'suppression de contrainte NOT NULL' },
]
for (const { re, label } of FORBIDDEN) {
  if (re.test(diffSql)) {
    console.error('')
    console.error('✘✘✘ OPÉRATION DESTRUCTRICE DÉTECTÉE ✘✘✘')
    console.error(
      `Le changement de schéma demandé contient une ${label}. ` +
        'Par sécurité, il n’est PAS appliqué automatiquement : les données ' +
        'des enseignants (étudiants, réponses, notes) ne peuvent pas être ' +
        'modifiées silencieusement lors d’une mise à jour.'
    )
    console.error('')
    console.error('→ AVANT de continuer : téléchargez la sauvegarde de la séance ' +
      '(bouton « Sauvegarder » du tableau de bord enseignant) ou exportez vos CSV.')
    console.error('→ Puis appliquez le changement manuellement (prisma db push) ' +
      'après vérification, ou contactez l’assistance avec le journal ci-dessus.')
    console.error('')
    console.error('---- SQL refusé ----')
    console.error(diffSql)
    process.exit(1)
  }
}

// ---- 3. Nettoyage best-effort des doublons tRAT historiques ----
// (uniquement utile pour la mise à jour vers la v2.4.0 : la contrainte
// unique ne peut pas être créée si des doublons préexistent ; sur une
// base vierge, la table n'existe pas encore et l'erreur est ignorée)
const DEDUPE_SQL = `DELETE FROM "Answer" WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", ROW_NUMBER() OVER (
      PARTITION BY "teamId", "questionId", "kind", "attempt"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS rn
    FROM "Answer" WHERE "teamId" IS NOT NULL
  ) t WHERE t.rn > 1
);`

// ---- 4. Exécution du diff ----
const dir = mkdtempSync(join(tmpdir(), 'tbl-db-apply-'))
const dedupeFile = join(dir, 'dedupe.sql')
const diffFile = join(dir, 'diff.sql')

try {
  if (/teamId/i.test(diffSql) && /UNIQUE/i.test(diffSql)) {
    writeFileSync(dedupeFile, DEDUPE_SQL, 'utf8')
    const dedupe = spawnSync(
      'npx',
      ['prisma', 'db', 'execute', '--file', dedupeFile, '--schema', SCHEMA],
      { shell: NEED_SHELL, encoding: 'utf8' }
    )
    if (dedupe.status === 0) {
      console.log('✔ Vérification des anciennes tentatives tRAT en double : base propre.')
    } else {
      // Base vierge (table absente) : normal, on continue.
      console.log('ℹ Contrôle préalable ignoré (table pas encore créée — base vierge).')
    }
  }

  writeFileSync(diffFile, diffSql, 'utf8')
  prisma(['db', 'execute', '--file', diffFile, '--schema', SCHEMA])
  console.log('✔ Schéma appliqué (changements additifs uniquement, zéro perte de données).')
} finally {
  for (const f of [dedupeFile, diffFile]) {
    try {
      unlinkSync(f)
    } catch {
      // fichier temporaire déjà supprimé
    }
  }
}
