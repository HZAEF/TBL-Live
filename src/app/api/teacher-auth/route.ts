import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPin, verifyPin } from '@/lib/pin'
import {
  TEACHER_COOKIE,
  TEACHER_LOCK_MINUTES,
  TEACHER_MAX_ATTEMPTS,
  issueTeacherSession,
  normalizeTeacherEmail,
  requireTeacher,
} from '@/lib/teacher-auth'

// ============================================================
// TBL Live v3.0.0 — /api/teacher-auth : comptes enseignants
//
// GET  : suis-je connecté ? (→ prénom, nom, email du compte)
// POST : login | logout | change_password | forgot_password
//
// Les comptes sont créés par l'administrateur dans /admin
// (espace « Comptes »). Le mot de passe oublié ne se réinitialise
// PAS tout seul : l'enseignant prévient l'administrateur (badge
// dans /admin), qui génère un nouveau mot de passe et le lui
// envoie par email — l'application prépare même le message.
// ============================================================

interface AuthAction {
  action?: unknown
  email?: unknown
  password?: unknown
  current?: unknown
  next?: unknown
}

// Délai minimum entre deux demandes « mot de passe oublié » du
// même compte (sinon la file de badges de l'administrateur serait
// spammable sans intérêt).
const FORGOT_THROTTLE_MS = 15 * 60_000

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTeacher(req)
    if (!auth.ok) {
      return NextResponse.json({ authenticated: false, teacher: null })
    }
    return NextResponse.json({ authenticated: true, teacher: auth.teacher })
  } catch {
    // base pas encore initialisée (premier déploiement)
    return NextResponse.json({ authenticated: false, teacher: null })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as AuthAction | null
    const action = typeof body?.action === 'string' ? body.action : ''

    // ---------- Connexion ----------
    if (action === 'login') {
      const email = normalizeTeacherEmail(body?.email)
      const password = typeof body?.password === 'string' ? body.password : ''
      if (!email || !password) {
        return NextResponse.json({ error: 'Email et mot de passe requis.' }, { status: 400 })
      }
      const account = await db.teacherAccount.findUnique({ where: { email } })
      // Message identique que le compte existe ou non : aucune
      // information sur la liste des comptes enseignants.
      const generic = 'Email ou mot de passe incorrect.'
      if (!account) {
        return NextResponse.json({ error: generic }, { status: 401 })
      }
      if (account.lockedUntil && account.lockedUntil.getTime() > Date.now()) {
        return NextResponse.json(
          { error: `Trop de tentatives incorrectes. Réessayez dans quelques minutes.` },
          { status: 429 }
        )
      }
      const verdict = await verifyPin(account.passwordHash, password)
      if (!verdict.ok) {
        const attempts = account.loginAttempts + 1
        const locked = attempts >= TEACHER_MAX_ATTEMPTS
        await db.teacherAccount.update({
          where: { id: account.id },
          data: {
            loginAttempts: locked ? 0 : attempts,
            lockedUntil: locked
              ? new Date(Date.now() + TEACHER_LOCK_MINUTES * 60_000)
              : account.lockedUntil,
          },
        })
        return NextResponse.json({ error: generic }, { status: 401 })
      }
      // Connexion réussie : le badge « mot de passe oublié »
      // devient inutile (l'enseignant s'est souvenu / a reçu le nouveau).
      await db.teacherAccount.update({
        where: { id: account.id },
        data: {
          loginAttempts: 0,
          lockedUntil: null,
          forgotPasswordSeenAt: account.forgotPasswordAt,
        },
      })
      return issueTeacherSession(req, account.id)
    }

    // ---------- Mot de passe oublié ----------
    if (action === 'forgot_password') {
      const email = normalizeTeacherEmail(body?.email)
      if (email) {
        const account = await db.teacherAccount.findUnique({ where: { email } })
        if (account) {
          const last = account.forgotPasswordAt?.getTime() ?? 0
          if (Date.now() - last > FORGOT_THROTTLE_MS) {
            await db.teacherAccount.update({
              where: { id: account.id },
              data: { forgotPasswordAt: new Date(), forgotPasswordSeenAt: null },
            })
          }
        }
      }
      // Toujours la même réponse : personne ne peut sonder les
      // adresses qui ont un compte.
      return NextResponse.json({
        ok: true,
        message:
          'Demande envoyée. Prévenez votre administrateur : il vous enverra un nouveau mot de passe par email.',
      })
    }

    // ---------- Actions nécessitant d'être connecté ----------
    const auth = await requireTeacher(req)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    if (action === 'logout') {
      await db.teacherAccount.update({
        where: { id: auth.teacher.id },
        data: { tokenHash: null, tokenExpiresAt: null },
      })
      const res = NextResponse.json({ ok: true })
      res.cookies.delete(TEACHER_COOKIE)
      return res
    }

    if (action === 'change_password') {
      const current = typeof body?.current === 'string' ? body.current : ''
      const next = typeof body?.next === 'string' ? body.next : ''
      if (next.length < 8 || next.length > 64) {
        return NextResponse.json(
          { error: 'Le nouveau mot de passe doit contenir entre 8 et 64 caractères.' },
          { status: 400 }
        )
      }
      const account = await db.teacherAccount.findUnique({ where: { id: auth.teacher.id } })
      if (!account) {
        return NextResponse.json({ error: 'Compte introuvable.' }, { status: 404 })
      }
      const verdict = await verifyPin(account.passwordHash, current)
      if (!verdict.ok) {
        return NextResponse.json({ error: 'Mot de passe actuel incorrect.' }, { status: 401 })
      }
      await db.teacherAccount.update({
        where: { id: account.id },
        data: { passwordHash: await hashPin(next) },
      })
      // Reconnexion immédiate avec le nouveau mot de passe.
      return issueTeacherSession(req, account.id)
    }

    return NextResponse.json({ error: 'Action inconnue.' }, { status: 400 })
  } catch (e) {
    console.error('POST /api/teacher-auth', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}
