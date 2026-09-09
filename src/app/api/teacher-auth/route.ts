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
// POST : login | logout | change_password | forgot_password |
//        list_sessions | open_session   (v3.1.0 : « Mes séances »
//        du COMPTE, visibles sur n'importe quel appareil)
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
  code?: unknown
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

    // ------------------------------------------------------------
    // v3.1.0 — « MES SÉANCES » DU COMPTE (demande de l'enseignante :
    // toutes les séances ACTIVES de l'enseignant, visibles sur N'IM-
    // PORTE QUEL appareil où il se connecte — plus de « Mes séances
    // sur cet appareil » lié au stockage local du navigateur).
    //
    // list_sessions : les séances APPARTENANT au compte (teacherId),
    //  hors corbeille — actives d'abord (phase en cours), terminées
    //  ensuite, triées par activité de phase la plus récente. Comprend
    //  le nombre d'étudiants inscrits (une seule requête groupBy).
    //  v3.2.0 : PLUS les séances PARTAGÉES avec ce compte (invitations
    //  par email — « role: collaborator ») : la co-animation d'une
    //  séance TBL à plusieurs devient naturelle.
    //
    // open_session : le PROPRIÉTAIRE du compte (ou un INVITÉ de la
    //  séance) récupère le jeton d'accès du tableau de bord sans
    //  ressaisir le PIN — l'identité est déjà prouvée par le cookie
    //  de session du COMPTE (12 h). SÉCURITÉ : le jeton n'est renvoyé
    //  QUE si la séance appartient à ce compte ou lui est partagée ;
    //  sinon 404/403. On ne fait PAS tourner le jeton : la synchroni-
    //  sation Internet ↔ local s'appuie sur sa stabilité (les deux
    //  instances partagent la même valeur), et le rehausser à chaque
    //  changement d'appareil invaliderait l'autre instance.
    // ------------------------------------------------------------
    if (action === 'list_sessions') {
      // v3.2.0 — séances partagées avec ce compte (par email), hors
      // corbeille. Une seule requête : l'index [email] fait le travail.
      const shared = await db.sessionCollaborator.findMany({
        where: { email: auth.teacher.email },
        select: { sessionId: true },
        take: 200,
      })
      const sharedIds = shared.map((s) => s.sessionId)
      const sessions = await db.session.findMany({
        where: {
          deletedAt: null,
          OR: [
            { teacherId: auth.teacher.id },
            // v3.2.0 : invitations reçues (la séance apparaît dans les
            // « Mes séances » de l'invité — même ouverture sans PIN).
            ...(sharedIds.length > 0 ? [{ id: { in: sharedIds } }] : []),
          ],
        },
        select: {
          id: true,
          code: true,
          title: true,
          status: true,
          phaseStartedAt: true,
          createdAt: true,
          syncedAt: true,
          teacherId: true,
        },
        orderBy: { phaseStartedAt: 'desc' },
        take: 100,
      })
      // Nombre d'étudiants par séance (une seule requête groupée —
      // le groupBy se fait par id technique, jamais par code).
      const counts = await db.student.groupBy({
        by: ['sessionId'],
        _count: { _all: true },
      })
      const countMap = new Map(counts.map((c) => [c.sessionId, c._count._all]))
      // Tri : séances ACTIVES (non terminées) d'abord, par activité
      // de phase la plus récente ; les terminées ensuite.
      const withStudents = sessions.map((s) => ({
        code: s.code,
        title: s.title,
        status: s.status,
        students: countMap.get(s.id) ?? 0,
        phaseStartedAt: s.phaseStartedAt.toISOString(),
        createdAt: s.createdAt.toISOString(),
        syncedAt: s.syncedAt ? s.syncedAt.toISOString() : null,
        // v3.2.0 : « owner » (ma séance) ou « collaborator » (partagée
        // avec moi par un collègue) — le badge s'affiche côté client.
        role: (s.teacherId === auth.teacher.id ? 'owner' : 'collaborator') as
          | 'owner'
          | 'collaborator',
      }))
      withStudents.sort((a, b) => {
        const aDone = a.status === 'finished'
        const bDone = b.status === 'finished'
        if (aDone !== bDone) return aDone ? 1 : -1
        return b.phaseStartedAt.localeCompare(a.phaseStartedAt)
      })
      return NextResponse.json({ sessions: withStudents })
    }

    if (action === 'open_session') {
      const code =
        typeof body?.code === 'string' ? body.code.trim().toUpperCase() : ''
      if (code.length !== 6) {
        return NextResponse.json({ error: 'Code de séance invalide.' }, { status: 400 })
      }
      const session = await db.session.findUnique({ where: { code } })
      if (!session || session.deletedAt) {
        return NextResponse.json({ error: 'Séance introuvable.' }, { status: 404 })
      }
      // v3.2.0 — accès SANS PIN pour le propriétaire OU un invité de
      // la séance (partage par email). La vérification d'invitation
      // se fait par EMAIL : c'est l'identifiant stable du compte.
      let allowed = session.teacherId === auth.teacher.id
      if (!allowed && auth.teacher.email) {
        const share = await db.sessionCollaborator.findUnique({
          where: { sessionId_email: { sessionId: session.id, email: auth.teacher.email } },
          select: { id: true },
        })
        allowed = share !== null
      }
      if (!allowed) {
        // La séance existe mais n'appartient pas à ce compte (importée
        // par synchronisation, créée avant les comptes, ou créée par un
        // autre enseignant) : même réponse que si elle n'existait pas —
        // aucun renseignement sur les séances d'autrui.
        return NextResponse.json({ error: 'Séance introuvable.' }, { status: 404 })
      }
      return NextResponse.json({
        code: session.code,
        title: session.title,
        token: session.teacherToken,
      })
    }

    return NextResponse.json({ error: 'Action inconnue.' }, { status: 400 })
  } catch (e) {
    console.error('POST /api/teacher-auth', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}
