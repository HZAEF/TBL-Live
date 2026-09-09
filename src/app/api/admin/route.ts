import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/db'
import { hashPin, verifyPin } from '@/lib/pin'
import { isValidPin, normalizePin, generateUniqueCode, randomToken } from '@/lib/tbl'
import { isTrashExpired } from '@/lib/session-lifecycle'
import { FR_KEYS } from '@/lib/i18n/fr-keys'
import { bumpRevisions } from '@/lib/revision'
import { generateTeacherPassword, normalizeTeacherEmail, isPlausibleEmail, checkEmailDomain } from '@/lib/teacher-auth'
import { sanitizeTheme, parseStoredTheme } from '@/lib/theme'
import { parseAccountsFile, TableReadError } from '@/lib/xlsx-reader'
import { perfSnapshot } from '@/lib/metrics'
import { purgeStudentData } from '@/lib/session-lifecycle'
import { storageOverview, purgeSelectedSessions, purgeOlderThan } from '@/lib/storage'

// ============================================================
// TBL Live v2.9.0 — Espace administrateur (/admin)
//
// ACCÈS. Mot de passe administrateur choisi lors de la PREMIÈRE
// visite (aucun mot de passe par défaut : personne d'autre que la
// propriétaire ne peut s'approprier l'espace). Connexion → cookie
// HttpOnly d'une durée de 12 h, contenant un jeton aléatoire dont
// SEUL le hash SHA-256 est stocké en base. Verrouillage anti
// force-brute : 5 tentatives → 15 minutes (comme le PIN enseignant).
//
// POUVOIRS (tout est réversible ou confirmé explicitement) :
//  - lister toutes les séances TBL de la base (code, titre, phase,
//    effectifs, dates, état corbeille/purge) ;
//  - renommer une séance, régénérer son code d'accès, réinitialiser
//    son code PIN enseignant ;
//  - mettre une séance à la corbeille, la restaurer, la supprimer
//    DÉFINITIVEMENT — individuellement ou EN BLOC (v3.0.0 : sélection multiple, boutons en haut) ;
//  - régler le délai du cycle de synchronisation Internet ↔ réseau
//    local (2 s à 60 s) ;
//  - personnaliser N'IMPORTE QUEL texte de l'application (clé = le
//    texte français d'origine) : la personnalisation s'affiche dans
//    toutes les langues, reste modifiable et réinitialisable.
//
// L'administrateur ne peut NI lire les réponses des étudiants, NI
// les jetons/PIN : seule la structure des séances est exposée.
// ============================================================

const COOKIE_NAME = 'tbl_admin'
const SESSION_HOURS = 12
const MAX_TEXT_OVERRIDES = 300
const ADMIN_KEYS = { MAX_ATTEMPTS: 5, LOCK_MINUTES: 15 }

function sha256hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
  } catch {
    return false
  }
}

/** Lit la ligne unique des réglages administrateur (créée au besoin). */
async function getSettings() {
  const row = await db.adminSetting.findUnique({ where: { id: 'singleton' } })
  if (row) return row
  try {
    return await db.adminSetting.create({ data: { id: 'singleton' } })
  } catch {
    // créée simultanément par une autre requête : on relit
    return (await db.adminSetting.findUnique({ where: { id: 'singleton' } }))!
  }
}

function parseTextOverrides(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof k === 'string' && typeof v === 'string' && k.length > 0 && v.length > 0) {
          out[k] = v
        }
      }
      return out
    }
  } catch {
    // JSON illisible : repart à vide
  }
  return {}
}

// ---------------- GET : état de session + outils ----------------

export async function GET(req: NextRequest) {
  try {
    const row = await db.adminSetting.findUnique({ where: { id: 'singleton' } })
    const needsSetup = !row || !row.passwordHash
    // Jeton de session valide ?
    let authenticated = false
    if (row && row.tokenHash && row.tokenExpiresAt && row.tokenExpiresAt.getTime() > Date.now()) {
      const cookie = req.cookies.get(COOKIE_NAME)?.value ?? ''
      authenticated = cookie.length > 0 && safeEqualHex(sha256hex(cookie), row.tokenHash)
    }
    // Liste des textes personnalisables (toutes les clés françaises de
    // l'application) : demandée uniquement par la page administrateur
    // (clé `keys`), jamais téléchargée par les étudiants.
    const withKeys = authenticated && req.nextUrl.searchParams.get('keys') === '1'
    return NextResponse.json({
      authenticated,
      needsSetup,
      syncIntervalMs: row ? row.syncIntervalMs : 5000,
      textsCount: row ? Object.keys(parseTextOverrides(row.textOverrides)).length : 0,
      // v3.0.0 — domaine des emails institutionnels + thème réglés.
      teacherEmailDomain: row ? row.teacherEmailDomain : '@famso.u-sousse.tn',
      theme: row ? parseStoredTheme(row.theme) : {},
      ...(withKeys ? { keys: FR_KEYS } : {}),
    })
  } catch {
    // base pas encore initialisée (premier build) : écran de mise en place
    return NextResponse.json({ authenticated: false, needsSetup: true, syncIntervalMs: 5000, textsCount: 0 })
  }
}

// ---------------- POST : actions ----------------

interface AdminAction {
  action?: unknown
  password?: unknown
  current?: unknown
  next?: unknown
  code?: unknown
  title?: unknown
  pin?: unknown
  newCode?: unknown
  codes?: unknown
  ms?: unknown
  key?: unknown
  value?: unknown
  // v3.0.0 — comptes enseignants
  id?: unknown
  firstName?: unknown
  lastName?: unknown
  email?: unknown
  domain?: unknown
  fileBase64?: unknown
  filename?: unknown
  // v3.0.0 — apparence
  theme?: unknown
  // v3.0.0 — signalements par TBL
  enabled?: unknown
  // v3.2.0 — purge par période (mois)
  months?: unknown
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as AdminAction | null
    const action = typeof body?.action === 'string' ? body.action : ''

    // ---------- Actions accessibles SANS connexion ----------
    if (action === 'setup') {
      const row = await getSettings()
      if (row.passwordHash) {
        return NextResponse.json(
          { error: 'Un mot de passe administrateur existe déjà — connectez-vous.' },
          { status: 409 }
        )
      }
      const password = typeof body?.password === 'string' ? body.password : ''
      if (password.length < 8 || password.length > 64) {
        return NextResponse.json(
          { error: 'Le mot de passe doit contenir entre 8 et 64 caractères.' },
          { status: 400 }
        )
      }
      await db.adminSetting.update({
        where: { id: 'singleton' },
        data: { passwordHash: await hashPin(password), loginAttempts: 0, lockedUntil: null },
      })
      return issueSessionCookie(req)
    }

    if (action === 'login') {
      const row = await getSettings()
      if (!row.passwordHash) {
        return NextResponse.json(
          { error: 'Aucun mot de passe administrateur n’est défini : utilisez la première installation.' },
          { status: 409 }
        )
      }
      if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) {
        return NextResponse.json(
          { error: `Trop de tentatives incorrectes. Réessayez dans quelques minutes.` },
          { status: 429 }
        )
      }
      const password = typeof body?.password === 'string' ? body.password : ''
      const verdict = await verifyPin(row.passwordHash, password)
      if (!verdict.ok) {
        const attempts = row.loginAttempts + 1
        const locked = attempts >= ADMIN_KEYS.MAX_ATTEMPTS
        await db.adminSetting.update({
          where: { id: 'singleton' },
          data: {
            loginAttempts: locked ? 0 : attempts,
            lockedUntil: locked
              ? new Date(Date.now() + ADMIN_KEYS.LOCK_MINUTES * 60_000)
              : row.lockedUntil,
          },
        })
        return NextResponse.json(
          { error: 'Mot de passe incorrect.' },
          { status: 401 }
        )
      }
      await db.adminSetting.update({
        where: { id: 'singleton' },
        data: { loginAttempts: 0, lockedUntil: null },
      })
      return issueSessionCookie(req)
    }

    // ---------- Toutes les autres actions : connexion exigée ----------
    const auth = await requireAdmin(req)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: 401 })
    }

    switch (action) {
      case 'logout': {
        await db.adminSetting.update({
          where: { id: 'singleton' },
          data: { tokenHash: null, tokenExpiresAt: null },
        })
        const res = NextResponse.json({ ok: true })
        res.cookies.delete(COOKIE_NAME)
        return res
      }

      case 'change_password': {
        const row = await getSettings()
        const current = typeof body?.current === 'string' ? body.current : ''
        const next = typeof body?.next === 'string' ? body.next : ''
        if (next.length < 8 || next.length > 64) {
          return NextResponse.json(
            { error: 'Le nouveau mot de passe doit contenir entre 8 et 64 caractères.' },
            { status: 400 }
          )
        }
        const verdict = await verifyPin(row.passwordHash, current)
        if (!verdict.ok) {
          return NextResponse.json({ error: 'Mot de passe actuel incorrect.' }, { status: 401 })
        }
        await db.adminSetting.update({
          where: { id: 'singleton' },
          data: { passwordHash: await hashPin(next), tokenHash: null, tokenExpiresAt: null },
        })
        // Reconnexion immédiate avec le nouveau mot de passe.
        return issueSessionCookie(req)
      }

      // ----- Liste des séances (structure seulement) -----
      case 'list': {
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
            syncedAt: true,
            teacherId: true,
            reportsEnabled: true,
            _count: { select: { students: true, teams: true, questions: true, cases: true } },
          },
        })
        // Nombre de réponses par séance (une requête par séance :
        // l'espace administrateur s'ouvre rarement, l'effectif est petit).
        const counts = await Promise.all(
          sessions.map((s) =>
            db.answer.count({ where: { question: { sessionId: s.id } } })
          )
        )
        // v3.0.0 — propriétaires (comptes enseignants) des séances :
        // une seule requête, jointe côté serveur.
        const teacherIds = [
          ...new Set(sessions.map((s) => s.teacherId).filter((x): x is string => !!x)),
        ]
        const teachers = teacherIds.length
          ? await db.teacherAccount.findMany({
              where: { id: { in: teacherIds } },
              select: { id: true, firstName: true, lastName: true, email: true },
            })
          : []
        const teacherById = new Map(teachers.map((t) => [t.id, t]))
        return NextResponse.json({
          sessions: sessions.map((s, i) => {
            const owner = s.teacherId ? teacherById.get(s.teacherId) : undefined
            return {
              id: s.id,
              code: s.code,
              title: s.title,
              status: s.status,
              createdAt: s.createdAt.toISOString(),
              deletedAt: s.deletedAt ? s.deletedAt.toISOString() : null,
              dataPurgedAt: s.dataPurgedAt ? s.dataPurgedAt.toISOString() : null,
              syncedAt: s.syncedAt ? s.syncedAt.toISOString() : null,
              students: s._count.students,
              teams: s._count.teams,
              questions: s._count.questions,
              cases: s._count.cases,
              answers: counts[i],
              // v3.0.0 : signalements anti-capture (désactivés par défaut)
              reportsEnabled: s.reportsEnabled,
              // v3.0.0 : compte propriétaire (null = séance importée
              // par la synchronisation ou créée avant la v3.0).
              teacher: owner
                ? { firstName: owner.firstName, lastName: owner.lastName, email: owner.email }
                : null,
            }
          }),
        })
      }

      // ----- Renommer une séance -----
      case 'rename': {
        const session = await findSession(body?.code)
        if (!session) return notFound()
        const title = typeof body?.title === 'string' ? body.title.trim() : ''
        if (title.length < 2 || title.length > 120) {
          return NextResponse.json(
            { error: 'Le titre doit contenir entre 2 et 120 caractères.' },
            { status: 400 }
          )
        }
        await db.session.update({ where: { id: session.id }, data: { title, updatedAt: new Date() } })
        return NextResponse.json({ ok: true })
      }

      // ----- Régénérer le code d'accès d'une séance -----
      case 'set_code': {
        const session = await findSession(body?.code)
        if (!session) return notFound()
        const wanted =
          typeof body?.newCode === 'string' ? body.newCode.trim().toUpperCase() : ''
        let newCode: string
        if (wanted.length === 0) {
          newCode = await generateUniqueCode()
        } else {
          if (!/^[A-Z0-9]{6}$/.test(wanted)) {
            return NextResponse.json(
              { error: 'Le code doit contenir exactement 6 caractères (chiffres et lettres).' },
              { status: 400 }
            )
          }
          if (wanted === session.code) {
            return NextResponse.json({ error: 'La séance porte déjà ce code.' }, { status: 400 })
          }
          const clash = await db.session.findUnique({ where: { code: wanted } })
          if (clash) {
            return NextResponse.json(
              { error: 'Ce code est déjà utilisé par une autre séance.' },
              { status: 409 }
            )
          }
          newCode = wanted
        }
        await db.session.update({
          where: { id: session.id },
          data: { code: newCode, updatedAt: new Date() },
        })
        return NextResponse.json({ ok: true, code: newCode })
      }

      // ----- Réinitialiser le code PIN enseignant d'une séance -----
      case 'reset_pin': {
        const session = await findSession(body?.code)
        if (!session) return notFound()
        const pin = typeof body?.pin === 'string' ? body.pin : ''
        if (!isValidPin(pin)) {
          return NextResponse.json(
            {
              error:
                'Le code PIN doit contenir 6 à 12 caractères, chiffres et lettres (sans accents ni symboles).',
            },
            { status: 400 }
          )
        }
        await db.session.update({
          where: { id: session.id },
          data: {
            teacherPin: await hashPin(normalizePin(pin)),
            pinAttempts: 0,
            pinLockedUntil: null,
            updatedAt: new Date(),
          },
        })
        return NextResponse.json({ ok: true })
      }

      // ----- Corbeille / restauration / suppression définitive -----
      case 'delete': {
        const session = await findSession(body?.code)
        if (!session) return notFound()
        if (!session.deletedAt) {
          await db.session.update({
            where: { id: session.id },
            data: { deletedAt: new Date(), updatedAt: new Date() },
          })
        }
        return NextResponse.json({ ok: true })
      }

      case 'restore': {
        const session = await findSession(body?.code)
        if (!session) return notFound()
        if (session.deletedAt && isTrashExpired(session.deletedAt)) {
          return NextResponse.json(
            { error: 'Le délai de restauration de 48 heures est dépassé.' },
            { status: 410 }
          )
        }
        await db.session.update({
          where: { id: session.id },
          data: { deletedAt: null, updatedAt: new Date() },
        })
        return NextResponse.json({ ok: true })
      }

      case 'delete_forever': {
        const session = await findSession(body?.code)
        if (!session) return notFound()
        await db.session.delete({ where: { id: session.id } })
        return NextResponse.json({ ok: true })
      }

      case 'bulk_delete_forever': {
        const codes = Array.isArray(body?.codes)
          ? (body?.codes as unknown[]).filter((c): c is string => typeof c === 'string' && c.length === 6)
          : []
        if (codes.length === 0) {
          return NextResponse.json({ error: 'Aucune séance sélectionnée.' }, { status: 400 })
        }
        const result = await db.session.deleteMany({ where: { code: { in: codes } } })
        return NextResponse.json({ ok: true, deleted: result.count })
      }

      // ----- Délai du cycle de synchronisation -----
      case 'set_sync_interval': {
        const ms = Number(body?.ms)
        if (!Number.isInteger(ms) || ms < 2000 || ms > 60_000) {
          return NextResponse.json(
            { error: 'Délai invalide : entre 2 et 60 secondes.' },
            { status: 400 }
          )
        }
        await db.adminSetting.update({ where: { id: 'singleton' }, data: { syncIntervalMs: ms } })
        return NextResponse.json({ ok: true })
      }

      // ----- Textes personnalisés de l'application -----
      case 'save_text': {
        const key = typeof body?.key === 'string' ? body.key : ''
        const value = typeof body?.value === 'string' ? body.value : ''
        if (key.length < 1 || key.length > 2000) {
          return NextResponse.json({ error: 'Texte d’origine invalide.' }, { status: 400 })
        }
        if (value.trim().length < 1 || value.length > 1000) {
          return NextResponse.json(
            { error: 'Le texte de remplacement doit contenir entre 1 et 1000 caractères.' },
            { status: 400 }
          )
        }
        const row = await getSettings()
        const overrides = parseTextOverrides(row.textOverrides)
        if (!(key in overrides) && Object.keys(overrides).length >= MAX_TEXT_OVERRIDES) {
          return NextResponse.json(
            { error: `Maximum de ${MAX_TEXT_OVERRIDES} textes personnalisés atteint.` },
            { status: 409 }
          )
        }
        overrides[key] = value
        await db.adminSetting.update({
          where: { id: 'singleton' },
          data: { textOverrides: JSON.stringify(overrides) },
        })
        return NextResponse.json({ ok: true })
      }

      case 'reset_text': {
        const key = typeof body?.key === 'string' ? body.key : ''
        const row = await getSettings()
        const overrides = parseTextOverrides(row.textOverrides)
        if (key in overrides) {
          delete overrides[key]
          await db.adminSetting.update({
            where: { id: 'singleton' },
            data: { textOverrides: JSON.stringify(overrides) },
          })
        }
        return NextResponse.json({ ok: true })
      }

      case 'reset_texts': {
        await db.adminSetting.update({
          where: { id: 'singleton' },
          data: { textOverrides: '{}' },
        })
        return NextResponse.json({ ok: true })
      }

      // ----- v3.0.0 : corbeille EN BLOC (sélection multiple) -----
      case 'bulk_trash': {
        const codes = readCodes(body?.codes)
        if (codes.length === 0) {
          return NextResponse.json({ error: 'Aucune séance sélectionnée.' }, { status: 400 })
        }
        const now = new Date()
        const result = await db.session.updateMany({
          where: { code: { in: codes }, deletedAt: null },
          data: { deletedAt: now, updatedAt: now },
        })
        return NextResponse.json({ ok: true, trashed: result.count })
      }

      // ----- v3.0.0 : signalements anti-capture par TBL -----
      case 'set_reports': {
        const session = await findSession(body?.code)
        if (!session) return notFound()
        const enabled = body?.enabled === true
        await db.session.update({
          where: { id: session.id },
          data: { reportsEnabled: enabled, updatedAt: new Date() },
        })
        // Les étudiants cessent/reprennent l'envoi et l'onglet du
        // tableau de bord apparaît/disparaît → renouvellement immédiat.
        await bumpRevisions(session.id)
        return NextResponse.json({ ok: true, enabled })
      }

      // ----- v3.0.0 : instrumentation en direct -----
      case 'perf': {
        return NextResponse.json({ ok: true, perf: perfSnapshot() })
      }

      // ===== v3.2.0 : ESPACE STOCKAGE & PURGE =====
      //
      // « L'administrateur doit avoir une idée du volume généré et
      // stocké dans chaque séance TBL, et un mécanisme de purge par
      // période (données de plus de N mois) et par séance (sélection
      // multiple) — sans toucher aux séances (questions) qui restent
      // sur le compte des enseignants. »
      //
      // storage       : photographie du volume (par séance + total +
      //                 moteur + pool de connexions — audit point n°2) ;
      // purge_period  : purge des données d'étudiants de toutes les
      //                 séances de plus de N mois (garde-fou : jamais
      //                 une séance active, jamais une séance déjà
      //                 purgée — idempotent) ;
      // purge_sessions: purge des séances SÉLECTIONNÉES (mêmes
      //                 garde-fous, refus explicite des séances actives).
      case 'storage': {
        const overview = await storageOverview()
        return NextResponse.json({ ok: true, ...overview })
      }

      case 'purge_period': {
        const months = Number(body?.months)
        if (!Number.isInteger(months) || months < 1 || months > 60) {
          return NextResponse.json(
            { error: 'Période invalide : entre 1 et 60 mois.' },
            { status: 400 }
          )
        }
        const outcome = await purgeOlderThan(months, purgeStudentData)
        return NextResponse.json({ ok: true, months, ...outcome })
      }

      case 'purge_sessions': {
        const codes = readCodes(body?.codes)
        if (codes.length === 0) {
          return NextResponse.json({ error: 'Aucune séance sélectionnée.' }, { status: 400 })
        }
        const outcome = await purgeSelectedSessions(codes, purgeStudentData)
        return NextResponse.json({ ok: true, ...outcome })
      }

      // ===== ESPACE COMPTES ENSEIGNANTS (v3.0.0) =====

      case 'list_accounts': {
        const accounts = await db.teacherAccount.findMany({
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            forgotPasswordAt: true,
            forgotPasswordSeenAt: true,
            lockedUntil: true,
            createdAt: true,
            _count: { select: { sessions: true } },
          },
        })
        const row = await getSettings()
        return NextResponse.json({
          domain: row.teacherEmailDomain,
          accounts: accounts.map((a) => ({
            id: a.id,
            firstName: a.firstName,
            lastName: a.lastName,
            email: a.email,
            sessions: a._count.sessions,
            lockedUntil: a.lockedUntil ? a.lockedUntil.toISOString() : null,
            // Demande de mot de passe oublié EN ATTENTE (badge ambre).
            forgotPending:
              !!a.forgotPasswordAt && (!a.forgotPasswordSeenAt || a.forgotPasswordSeenAt < a.forgotPasswordAt),
            forgotPasswordAt: a.forgotPasswordAt ? a.forgotPasswordAt.toISOString() : null,
            createdAt: a.createdAt.toISOString(),
          })),
        })
      }

      case 'create_account': {
        const row = await getSettings()
        const { firstName, lastName, email } = readAccountNames(body as AdminAction)
        const password = typeof body?.password === 'string' ? body.password : ''
        const err = validateNewAccount(firstName, lastName, email, password, row.teacherEmailDomain)
        if (err) return NextResponse.json({ error: err }, { status: 400 })
        const clash = await db.teacherAccount.findUnique({ where: { email } })
        if (clash) {
          return NextResponse.json(
            { error: 'Un compte existe déjà avec cet email institutionnel (un seul compte par enseignant).' },
            { status: 409 }
          )
        }
        const finalPassword = password || generateTeacherPassword()
        await db.teacherAccount.create({
          data: { firstName, lastName, email, passwordHash: await hashPin(finalPassword) },
        })
        // Le mot de passe en clair n'est JAMAIS stocké : il n'est
        // montré qu'ICI, une seule fois, à l'administrateur.
        return NextResponse.json({ ok: true, password: finalPassword })
      }

      case 'update_account': {
        const id = typeof body?.id === 'string' ? body.id : ''
        const account = id ? await db.teacherAccount.findUnique({ where: { id } }) : null
        if (!account) return NextResponse.json({ error: 'Compte introuvable.' }, { status: 404 })
        const { firstName, lastName, email } = readAccountNames(body as AdminAction)
        const data: Record<string, string> = {}
        if (firstName && firstName !== account.firstName) data.firstName = firstName
        if (lastName && lastName !== account.lastName) data.lastName = lastName
        if (email && email !== account.email) {
          const clash = await db.teacherAccount.findUnique({ where: { email } })
          if (clash) {
            return NextResponse.json(
              { error: 'Un autre compte utilise déjà cet email institutionnel.' },
              { status: 409 }
            )
          }
          data.email = email
        }
        if (Object.keys(data).length > 0) {
          await db.teacherAccount.update({ where: { id }, data })
        }
        return NextResponse.json({ ok: true })
      }

      case 'reset_account_password': {
        const id = typeof body?.id === 'string' ? body.id : ''
        const account = id ? await db.teacherAccount.findUnique({ where: { id } }) : null
        if (!account) return NextResponse.json({ error: 'Compte introuvable.' }, { status: 404 })
        const password = typeof body?.password === 'string' ? body.password : ''
        if (password && (password.length < 8 || password.length > 64)) {
          return NextResponse.json(
            { error: 'Le mot de passe doit contenir entre 8 et 64 caractères.' },
            { status: 400 }
          )
        }
        const finalPassword = password || generateTeacherPassword()
        await db.teacherAccount.update({
          where: { id },
          data: {
            passwordHash: await hashPin(finalPassword),
            // Nouveau mot de passe → session existante invalidée,
            // verrouillage et demande « oublié » effacés.
            tokenHash: null,
            tokenExpiresAt: null,
            loginAttempts: 0,
            lockedUntil: null,
            forgotPasswordAt: null,
            forgotPasswordSeenAt: new Date(),
          },
        })
        return NextResponse.json({ ok: true, password: finalPassword })
      }

      case 'delete_account': {
        const id = typeof body?.id === 'string' ? body.id : ''
        const account = id ? await db.teacherAccount.findUnique({ where: { id } }) : null
        if (!account) return NextResponse.json({ error: 'Compte introuvable.' }, { status: 404 })
        // Les séances créées par ce compte RESTENT intactes et
        // pilotables (code + PIN) : seule la propriété est retirée.
        await db.teacherAccount.delete({ where: { id } })
        return NextResponse.json({ ok: true })
      }

      case 'clear_forgot': {
        const id = typeof body?.id === 'string' ? body.id : ''
        const account = id ? await db.teacherAccount.findUnique({ where: { id } }) : null
        if (!account) return NextResponse.json({ error: 'Compte introuvable.' }, { status: 404 })
        if (account.forgotPasswordAt) {
          await db.teacherAccount.update({
            where: { id },
            data: { forgotPasswordSeenAt: new Date() },
          })
        }
        return NextResponse.json({ ok: true })
      }

      // ----- Import de comptes : fichier Excel (.xlsx) ou CSV -----
      case 'import_accounts': {
        const row = await getSettings()
        const fileBase64 = typeof body?.fileBase64 === 'string' ? body.fileBase64 : ''
        const filename = typeof body?.filename === 'string' ? body.filename.slice(0, 200) : 'comptes.xlsx'
        if (!fileBase64) {
          return NextResponse.json({ error: 'Fichier manquant.' }, { status: 400 })
        }
        if (fileBase64.length > 3_000_000) {
          return NextResponse.json(
            { error: 'Fichier trop volumineux (maximum 2 Mo).' },
            { status: 400 }
          )
        }
        let bytes: Uint8Array
        try {
          bytes = base64ToBytes(fileBase64)
        } catch {
          return NextResponse.json({ error: 'Fichier illisible.' }, { status: 400 })
        }
        let parsed: { rows: { firstName: string; lastName: string; email: string; password: string }[]; skippedHeader: boolean }
        try {
          parsed = parseAccountsFile(bytes, filename)
        } catch (e) {
          if (e instanceof TableReadError) {
            return NextResponse.json({ error: e.message }, { status: 400 })
          }
          throw e
        }
        if (parsed.rows.length === 0) {
          return NextResponse.json(
            { error: 'Aucune ligne d’enseignant trouvée dans le fichier (colonnes : Prénom, Nom, Email institutionnel, Mot de passe).' },
            { status: 400 }
          )
        }
        // Création ligne par ligne : doublons ignorés avec le motif
        // (l'administrateur voit exactement ce qui a été sauté).
        let created = 0
        const problems: { line: number; email: string; reason: string }[] = []
        const createdPasswords: { line: number; firstName: string; lastName: string; email: string; password: string }[] = []
        const seenEmails = new Set<string>()
        for (let i = 0; i < parsed.rows.length; i++) {
          const r = parsed.rows[i]
          const lineNo = (parsed.skippedHeader ? 2 : 1) + i
          const email = r.email
          const err = validateNewAccount(r.firstName, r.lastName, email, r.password, row.teacherEmailDomain)
          if (err) {
            problems.push({ line: lineNo, email, reason: err })
            continue
          }
          if (seenEmails.has(email)) {
            problems.push({ line: lineNo, email, reason: 'Doublon dans le fichier (email déjà traité).' })
            continue
          }
          const clash = await db.teacherAccount.findUnique({ where: { email } })
          if (clash) {
            problems.push({ line: lineNo, email, reason: 'Un compte existe déjà avec cet email (ignoré, rien n’est modifié).' })
            continue
          }
          seenEmails.add(email)
          const finalPassword = r.password || generateTeacherPassword()
          await db.teacherAccount.create({
            data: {
              firstName: r.firstName,
              lastName: r.lastName,
              email,
              passwordHash: await hashPin(finalPassword),
            },
          })
          created += 1
          createdPasswords.push({
            line: lineNo,
            firstName: r.firstName,
            lastName: r.lastName,
            email,
            password: finalPassword,
          })
        }
        return NextResponse.json({ ok: true, created, total: parsed.rows.length, problems, accounts: createdPasswords })
      }

      case 'set_email_domain': {
        const domain = typeof body?.domain === 'string' ? body.domain.trim().toLowerCase() : ''
        if (!/^@[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || domain.length > 120) {
          return NextResponse.json(
            { error: 'Domaine invalide — attendu : @etablissement.tn (commence par @, nom de domaine complet).' },
            { status: 400 }
          )
        }
        await db.adminSetting.update({ where: { id: 'singleton' }, data: { teacherEmailDomain: domain } })
        return NextResponse.json({ ok: true, domain })
      }

      // ===== ESPACE APPARENCE (v3.0.0) =====

      case 'set_theme': {
        const theme = sanitizeTheme(body?.theme)
        if (!theme) {
          return NextResponse.json(
            { error: 'Thème invalide : couleurs au format #rrvvbb (le fond doit rester clair).' },
            { status: 400 }
          )
        }
        await db.adminSetting.update({
          where: { id: 'singleton' },
          data: { theme: JSON.stringify(theme) },
        })
        return NextResponse.json({ ok: true, theme })
      }

      case 'reset_theme': {
        await db.adminSetting.update({ where: { id: 'singleton' }, data: { theme: '{}' } })
        return NextResponse.json({ ok: true })
      }

      default:
        return NextResponse.json({ error: 'Action inconnue.' }, { status: 400 })
    }
  } catch (e) {
    console.error('POST /api/admin', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}

// ---------------- Helpers ----------------

async function findSession(codeRaw: unknown) {
  const code = typeof codeRaw === 'string' ? codeRaw.trim().toUpperCase() : ''
  if (code.length !== 6) return null
  return db.session.findUnique({ where: { code } })
}

function notFound() {
  return NextResponse.json({ error: 'Séance introuvable.' }, { status: 404 })
}

// ---------------- Helpers v3.0.0 ----------------

/** Liste de codes de séances valides (6 caractères). */
function readCodes(raw: unknown): string[] {
  return Array.isArray(raw)
    ? (raw as unknown[]).filter((c): c is string => typeof c === 'string' && c.length === 6)
    : []
}

/** Noms + email d'un compte (normalisés). */
function readAccountNames(body: AdminAction): { firstName: string; lastName: string; email: string } {
  return {
    firstName: typeof body?.firstName === 'string' ? body.firstName.trim() : '',
    lastName: typeof body?.lastName === 'string' ? body.lastName.trim() : '',
    email: normalizeTeacherEmail(body?.email),
  }
}

/** Validation d'un compte avant création. Retourne null si OK. */
function validateNewAccount(
  firstName: string,
  lastName: string,
  email: string,
  password: string,
  domain: string
): string | null {
  if (firstName.length < 2 || firstName.length > 60) {
    return 'Le prénom doit contenir entre 2 et 60 caractères.'
  }
  if (lastName.length < 2 || lastName.length > 60) {
    return 'Le nom doit contenir entre 2 et 60 caractères.'
  }
  if (!isPlausibleEmail(email)) {
    return 'Email invalide (attendu : prenom.nom@etablissement).'
  }
  const domainErr = checkEmailDomain(email, domain)
  if (domainErr) return domainErr
  if (password && (password.length < 8 || password.length > 64)) {
    return 'Le mot de passe doit contenir entre 8 et 64 caractères (ou laisser vide pour en générer un).'
  }
  return null
}

/** Décode une chaîne base64 en octets (repli latin1 sur caractères étrangers). */
function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '')
  const buf = Buffer.from(clean, 'base64')
  if (buf.length === 0) throw new Error('empty')
  return new Uint8Array(buf)
}

async function issueSessionCookie(req: NextRequest) {
  const token = randomToken()
  const expires = new Date(Date.now() + SESSION_HOURS * 3600_000)
  // Le hash du jeton est stocké en base : le cookie ne contient QUE le
  // jeton aléatoire — une fuite de la base ne permet aucune reconnexion.
  await db.adminSetting.update({
    where: { id: 'singleton' },
    data: { tokenHash: sha256hex(token), tokenExpiresAt: expires },
  })
  const res = NextResponse.json({ ok: true })
  // Attribut Secure UNIQUEMENT en https (Vercel) : en mode réseau local
  // (http://192.168.x.x), un cookie Secure serait silencieusement refusé
  // par le navigateur — la connexion administrateur ne tiendrait pas.
  const isHttps =
    req.nextUrl.protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https'
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    path: '/',
    maxAge: SESSION_HOURS * 3600,
  })
  return res
}

async function requireAdmin(req: NextRequest): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await db.adminSetting.findUnique({ where: { id: 'singleton' } })
  if (!row || !row.tokenHash || !row.tokenExpiresAt) {
    return { ok: false, error: 'Connexion administrateur requise.' }
  }
  if (row.tokenExpiresAt.getTime() <= Date.now()) {
    return { ok: false, error: 'Session expirée — reconnectez-vous.' }
  }
  const cookie = req.cookies.get(COOKIE_NAME)?.value ?? ''
  if (cookie.length === 0 || !safeEqualHex(sha256hex(cookie), row.tokenHash)) {
    return { ok: false, error: 'Connexion administrateur requise.' }
  }
  return { ok: true }
}
