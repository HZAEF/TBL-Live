import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/db'
import { hashPin, verifyPin } from '@/lib/pin'
import { isValidPin, normalizePin, generateUniqueCode, randomToken } from '@/lib/tbl'
import { isTrashExpired } from '@/lib/session-lifecycle'
import { FR_KEYS } from '@/lib/i18n/fr-keys'

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
//    DÉFINITIVEMENT — individuellement ou EN BLOC ;
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
        return NextResponse.json({
          sessions: sessions.map((s, i) => ({
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
          })),
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
