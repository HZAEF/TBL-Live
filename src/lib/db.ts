import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: ['error'],
  })
  // v3.0.0 — SQLite local (mode réseau / hybride) : passage en WAL
  // (Write-Ahead Logging). Par défaut, SQLite verrouille TOUTE la base
  // pendant chaque écriture — avec 150 étudiants qui lisent leur état
  // pendant qu'une réponse s'écrit, les lectures s'empilent. En WAL,
  // lectures et écritures cohabitent : les sondages restent fluides
  // pendant les soumissions. Sans effet sur PostgreSQL/Neon (la
  // commande ne s'exécute qu'en base de fichier local).
  const url = process.env.DATABASE_URL ?? ''
  if (url.startsWith('file:')) {
    // NB : chez Prisma/SQLite, les PRAGMA RETOURNENT une ligne de
    // résultat (mode courant, valeur) → $queryRawUnsafe obligatoire
    // (executeRaw refuse toute requête qui renvoie des lignes).
    void client
      .$queryRawUnsafe('PRAGMA journal_mode=WAL;')
      .then(() => client.$queryRawUnsafe('PRAGMA busy_timeout=5000;'))
      .catch(() => {
        // fichier en lecture seule / déjà en WAL : sans conséquence
      })
  }
  return client
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
