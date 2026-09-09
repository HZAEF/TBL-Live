import { db } from '@/lib/db'
import type { Session } from '@prisma/client'
import { statSync } from 'node:fs'
import { isAbsolute, resolve, dirname } from 'node:path'

// ============================================================
// TBL Live v3.2.0 — Volume de stockage & purge (espace admin)
//
// DEMANDE de l'enseignante : « l'administrateur doit avoir une idée
// du volume généré et stocké dans chaque séance TBL, et disposer
// d'un mécanisme de purge complète par période (données anciennes
// de plus de 1, 2, 3… mois) et de purge PAR SÉANCE (sélections
// multiples), sans affecter les séances (questions) qui restent
// sur le compte des enseignants — on purge les données volumineuses,
// pas le contenu pédagogique ».
//
// MESURE (volume par séance) : comptages ET octets. Les octets sont
// mesurés par SUM(LENGTH(colonne)) en SQL brut — identique sur
// SQLite (mode local) et PostgreSQL/Neon (en ligne), les identifiants
// sont quotés comme Prisma les a créés. L'espace admin s'ouvre rare-
// ment : ~12 requêtes groupées (GROUP BY sessionId) suffisent, aucune
// boucle par séance.
//
// PURGE : supprime les données produites par les ÉTUDIANTS (étudiants,
// réponses, réclamations, évaluations, questionnaire, signalements,
// journal d'événements) et CONSERVE la séance avec ses QCM, cas
// cliniques, équipes, réglages et partage — l'enseignant peut toujours
// consulter et dupliquer. Deux modes :
//  - PAR PÉRIODE : toutes les séances dont les données sont plus
//    anciennes que N mois (garde-fou : jamais une séance active) ;
//  - PAR SÉLECTION : une ou plusieurs séances choisies.
//
// GARDE-FOUS de sécurité :
//  - une séance dont la phase a démarré il y a moins de
//    LIVE_GUARD_HOURS est considérée ACTIVE et jamais purgée ;
//  - une séance déjà purgée (dataPurgedAt) est sautée (idempotence) ;
//  - la purge par sélection REFUSE une séance active (message clair).
// ============================================================

/** Fenêtre « séance vivante » : démarrage de phase récent → jamais purger. */
export const LIVE_GUARD_HOURS = 48

export interface SessionVolume {
  code: string
  title: string
  status: string
  createdAt: string
  deletedAt: string | null
  dataPurgedAt: string | null
  phaseStartedAt: string
  teacher: { firstName: string; lastName: string; email: string } | null
  /** Lignes par table (données étudiants + structure). */
  students: number
  teams: number
  questions: number
  cases: number
  answers: number
  appeals: number
  appAnswers: number
  peerEvals: number
  saiItems: number
  saiResponses: number
  alerts: number
  events: number
  /** Octets mesurés (colonnes textuelles) — estimation prudente
   *  excluant les octets de structure des lignes. */
  bytes: number
}

export interface StorageOverview {
  engine: 'sqlite' | 'postgres' | 'inconnu'
  /** v3.2.0 (audit point n°2) : la connexion PostgreSQL passe-t-elle
   *  par le pooler (PgBouncer/Neon -pooler) ? En SQLite : true (aucun
   *  pool réseau). Seul le VERDICT est renvoyé, JAMAIS l'URL ni le
   *  mot de passe qu'elle contient. */
  pooled: boolean
  /** Une DIRECT_URL séparée (migrations Prisma) est-elle définie ? */
  hasDirectUrl: boolean
  /** Taille du fichier SQLite (local) ou de la base PostgreSQL (en
   *  ligne, pg_database_size) ; null si non mesurable. */
  dbBytes: number | null
  sessions: SessionVolume[]
  totalBytes: number
  totalCount: number
}

/** Lignes groupées par séance : { sid, n, b } — utilitaire interne. */
interface GroupRow {
  sid: string
  n: bigint | number
  b: bigint | number
}

function toCount(v: bigint | number | null | undefined): number {
  return Number(v ?? 0)
}

/** Verdict du pool de connexions (audit n°2) — sans jamais exposer l'URL. */
export function dbEngineInfo(): { engine: 'sqlite' | 'postgres' | 'inconnu'; pooled: boolean; hasDirectUrl: boolean } {
  const url = process.env.DATABASE_URL ?? ''
  if (url.startsWith('file:')) return { engine: 'sqlite', pooled: true, hasDirectUrl: false }
  if (url.startsWith('postgres') || url.startsWith('postgresql')) {
    const pooled = url.includes('-pooler') || /[?&]pgbouncer=true/i.test(url)
    return { engine: 'postgres', pooled, hasDirectUrl: !!process.env.DIRECT_URL }
  }
  return { engine: 'inconnu', pooled: false, hasDirectUrl: !!process.env.DIRECT_URL }
}

/** Taille réelle de la base : fichier SQLite (stat) ou PostgreSQL
 *  (pg_database_size — privilège ordinaire de connexion suffit ;
 *  échec silencieux → null). */
export async function dbTotalBytes(): Promise<number | null> {
  const url = process.env.DATABASE_URL ?? ''
  try {
    if (url.startsWith('file:')) {
      let p = url.slice('file:'.length).split('?')[0]
      if (p !== '' && !isAbsolute(p)) p = resolve(dirname('prisma'), p.replace(/^\.\//, ''))
      if (p === '') p = resolve('prisma', 'dev.db')
      return statSync(p).size
    }
    if (url.startsWith('postgres') || url.startsWith('postgresql')) {
      const rows =
        await db.$queryRaw<{ size: bigint | number }[]>`SELECT pg_database_size(current_database()) AS size`
      return toCount(rows[0]?.size)
    }
  } catch {
    // mesure impossible (base distante restreinte, fichier absent…) : null
  }
  return null
}

/**
 * Photographie du stockage : volume par séance + total + moteur.
 * ~12 requêtes GROUP BY au total, aucune boucle par séance.
 */
export async function storageOverview(): Promise<StorageOverview> {
  const sessions = await db.session.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      code: true,
      title: true,
      status: true,
      createdAt: true,
      deletedAt: true,
      dataPurgedAt: true,
      phaseStartedAt: true,
      teacherId: true,
    },
  })
  const teacherIds = [...new Set(sessions.map((s) => s.teacherId).filter((x): x is string => !!x))]
  const teachers = teacherIds.length
    ? await db.teacherAccount.findMany({
        where: { id: { in: teacherIds } },
        select: { id: true, firstName: true, lastName: true, email: true },
      })
    : []
  const teacherById = new Map(teachers.map((t) => [t.id, t]))

  // ---- Comptages + octets : 12 requêtes groupées, identifiants
  // quotés identiques sur SQLite et PostgreSQL (Prisma crée les
  // tables avec ces noms exacts). Les réponses (Answer) et les
  // données filles sans sessionId propre rejoignent leur parent.
  const [
    studentRows,
    teamRows,
    questionRows,
    caseRows,
    appealRows,
    peerRows,
    saiItemRows,
    eventRows,
    answerRows,
    appAnswerRows,
    saiRespRows,
    alertRows,
  ] = await Promise.all([
    db.$queryRaw<GroupRow[]>`SELECT "sessionId" AS sid, COUNT(*) AS n, COALESCE(SUM(LENGTH("name")),0) + COALESCE(SUM(LENGTH("token")),0) + COALESCE(SUM(LENGTH("recoveryCode")),0) AS b FROM "Student" GROUP BY "sessionId"`,
    db.$queryRaw<GroupRow[]>`SELECT "sessionId" AS sid, COUNT(*) AS n, COALESCE(SUM(LENGTH("name")),0) AS b FROM "Team" GROUP BY "sessionId"`,
    db.$queryRaw<GroupRow[]>`SELECT "sessionId" AS sid, COUNT(*) AS n, COALESCE(SUM(LENGTH("text")),0) + COALESCE(SUM(LENGTH("choices")),0) AS b FROM "Question" GROUP BY "sessionId"`,
    db.$queryRaw<GroupRow[]>`SELECT "sessionId" AS sid, COUNT(*) AS n, COALESCE(SUM(LENGTH("title")),0) + COALESCE(SUM(LENGTH("intro")),0) AS b FROM "Case" GROUP BY "sessionId"`,
    db.$queryRaw<GroupRow[]>`SELECT "sessionId" AS sid, COUNT(*) AS n, COALESCE(SUM(LENGTH("text")),0) AS b FROM "Appeal" GROUP BY "sessionId"`,
    db.$queryRaw<GroupRow[]>`SELECT "sessionId" AS sid, COUNT(*) AS n, COALESCE(SUM(LENGTH("comment")),0) AS b FROM "PeerEval" GROUP BY "sessionId"`,
    db.$queryRaw<GroupRow[]>`SELECT "sessionId" AS sid, COUNT(*) AS n, COALESCE(SUM(LENGTH("text")),0) AS b FROM "SaiItem" GROUP BY "sessionId"`,
    db.$queryRaw<GroupRow[]>`SELECT "sessionId" AS sid, COUNT(*) AS n, COALESCE(SUM(LENGTH("payload")),0) + COALESCE(SUM(LENGTH("type")),0) AS b FROM "SessionEvent" GROUP BY "sessionId"`,
    db.$queryRaw<GroupRow[]>`SELECT q."sessionId" AS sid, COUNT(*) AS n, 0 AS b FROM "Answer" a JOIN "Question" q ON a."questionId" = q."id" GROUP BY q."sessionId"`,
    db.$queryRaw<GroupRow[]>`SELECT t."sessionId" AS sid, COUNT(*) AS n, COALESCE(SUM(LENGTH(a."text")),0) AS b FROM "AppAnswer" a JOIN "Team" t ON a."teamId" = t."id" GROUP BY t."sessionId"`,
    db.$queryRaw<GroupRow[]>`SELECT s."sessionId" AS sid, COUNT(*) AS n, 0 AS b FROM "SaiResponse" r JOIN "Student" s ON r."studentId" = s."id" GROUP BY s."sessionId"`,
    db.$queryRaw<GroupRow[]>`SELECT s."sessionId" AS sid, COUNT(*) AS n, 0 AS b FROM "AlertEvent" al JOIN "Student" s ON al."studentId" = s."id" GROUP BY s."sessionId"`,
  ])

  const counts = (rows: GroupRow[]) => {
    const map = new Map<string, { n: number; b: number }>()
    for (const r of rows) map.set(r.sid, { n: toCount(r.n), b: toCount(r.b) })
    return map
  }
  const [mStudents, mTeams, mQuestions, mCases, mAppeals, mPeers, mSaiItems, mEvents, mAnswers, mAppAnswers, mSaiResp, mAlerts] = [
    counts(studentRows),
    counts(teamRows),
    counts(questionRows),
    counts(caseRows),
    counts(appealRows),
    counts(peerRows),
    counts(saiItemRows),
    counts(eventRows),
    counts(answerRows),
    counts(appAnswerRows),
    counts(saiRespRows),
    counts(alertRows),
  ]
  const get = (m: Map<string, { n: number; b: number }>, sid: string) => m.get(sid) ?? { n: 0, b: 0 }

  const engine = dbEngineInfo()
  const dbBytes = await dbTotalBytes()

  const volumes: SessionVolume[] = sessions.map((s) => {
    // ~110 octets de structure par ligne (index, identifiants cuid,
    // horodatages) : estimation basse, cohérente SQLite et PostgreSQL.
    const lineOverhead = 110
    const rows = [
      get(mStudents, s.id),
      get(mTeams, s.id),
      get(mQuestions, s.id),
      get(mCases, s.id),
      get(mAppeals, s.id),
      get(mPeers, s.id),
      get(mSaiItems, s.id),
      get(mEvents, s.id),
      get(mAnswers, s.id),
      get(mAppAnswers, s.id),
      get(mSaiResp, s.id),
      get(mAlerts, s.id),
    ]
    const bytes =
      rows.reduce((sum, r) => sum + r.b + r.n * lineOverhead, 0) + s.title.length * 2 + 128
    const owner = s.teacherId ? teacherById.get(s.teacherId) : undefined
    return {
      code: s.code,
      title: s.title,
      status: s.status,
      createdAt: s.createdAt.toISOString(),
      deletedAt: s.deletedAt ? s.deletedAt.toISOString() : null,
      dataPurgedAt: s.dataPurgedAt ? s.dataPurgedAt.toISOString() : null,
      phaseStartedAt: s.phaseStartedAt.toISOString(),
      teacher: owner
        ? { firstName: owner.firstName, lastName: owner.lastName, email: owner.email }
        : null,
      students: get(mStudents, s.id).n,
      teams: get(mTeams, s.id).n,
      questions: get(mQuestions, s.id).n,
      cases: get(mCases, s.id).n,
      answers: get(mAnswers, s.id).n,
      appeals: get(mAppeals, s.id).n,
      appAnswers: get(mAppAnswers, s.id).n,
      peerEvals: get(mPeers, s.id).n,
      saiItems: get(mSaiItems, s.id).n,
      saiResponses: get(mSaiResp, s.id).n,
      alerts: get(mAlerts, s.id).n,
      events: get(mEvents, s.id).n,
      bytes,
    }
  })

  return {
    engine: engine.engine,
    pooled: engine.pooled,
    hasDirectUrl: engine.hasDirectUrl,
    dbBytes,
    sessions: volumes,
    totalBytes: volumes.reduce((sum, v) => sum + v.bytes, 0),
    totalCount: volumes.length,
  }
}

// ---------------- Purge ----------------

/** Date d'il y a N mois calendaires (même jour, même heure). */
export function monthsAgo(months: number): Date {
  const now = new Date()
  return new Date(
    now.getFullYear(),
    now.getMonth() - months,
    now.getDate(),
    now.getHours(),
    now.getMinutes()
  )
}

/** La séance est-elle « vivante » (phase démarrée récemment) ?
 *  Ces séances ne sont JAMAIS purgées par l'administrateur. */
export function isRecentlyActive(session: { phaseStartedAt: Date }): boolean {
  return Date.now() - session.phaseStartedAt.getTime() < LIVE_GUARD_HOURS * 3_600_000
}

export interface PurgeOutcome {
  purged: string[]
  skipped: { code: string; reason: string }[]
}

/**
 * Purge les données d'étudiants des séances SÉLECTIONNÉES (codes).
 * La purge par sélection REFUSE une séance active (message clair) ;
 * une séance déjà purgée est sautée sans erreur (idempotence).
 */
export async function purgeSelectedSessions(
  codes: string[],
  purgeFn: (session: Session) => Promise<Session>
): Promise<PurgeOutcome> {
  const outcome: PurgeOutcome = { purged: [], skipped: [] }
  for (const code of codes) {
    const session = await db.session.findUnique({ where: { code } })
    if (!session) {
      outcome.skipped.push({ code, reason: 'Séance introuvable.' })
      continue
    }
    if (isRecentlyActive(session)) {
      outcome.skipped.push({
        code,
        reason: `Séance active (phase démarrée récemment) : purge refusée pour protéger le déroulé en cours.`,
      })
      continue
    }
    if (session.dataPurgedAt) {
      outcome.skipped.push({ code, reason: 'Données déjà purgées.' })
      continue
    }
    await purgeFn(session)
    outcome.purged.push(code)
  }
  return outcome
}

/**
 * Purge les données d'étudiants de TOUTES les séances dont la
 * CRÉATION est plus ancienne que `months` mois (hors séances actives
 * et déjà purgées — rapport détaillé de ce qui a été sauté et pourquoi).
 */
export async function purgeOlderThan(
  months: number,
  purgeFn: (session: Session) => Promise<Session>
): Promise<PurgeOutcome> {
  const cutoff = monthsAgo(months)
  const candidates = await db.session.findMany({
    where: { createdAt: { lt: cutoff } },
    select: { code: true },
  })
  return purgeSelectedSessions(
    candidates.map((c) => c.code),
    purgeFn
  )
}

/** Formate des octets en unités lisibles (Ko/Mo/Go, virgule FR). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} Ko`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2).replace('.', ',')} Go`
}
