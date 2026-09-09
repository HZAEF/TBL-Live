import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { randomInt } from 'node:crypto'
import { db } from '@/lib/db'
import { randomToken } from '@/lib/tbl'

// ============================================================
// TBL Live v3.0.0 — Comptes enseignants (connexion obligatoire)
//
// Un compte enseignant est créé par l'ADMINISTRATEUR (espace
// « Comptes » de /admin : saisie manuelle ou fichier Excel) :
//  - Prénom, Nom, email institutionnel (unique, domaine vérifié
//    @famso.u-sousse.tn par défaut — modifiable dans /admin) ;
//  - mot de passe généré par l'administrateur, communiqué à
//    l'enseignant, modifiable par l'enseignant lui-même.
//
// La connexion OUVRE l'accès enseignant de l'application :
// créer, reprendre ou téléverser une séance exige ce compte
// (plus de séance ouverte par n'importe qui). Les étudiants,
// eux, rejoignent toujours librement avec le code de la séance.
//
// Sécurité (identique à l'espace administrateur v2.9.0) :
//  - mot de passe : bcrypt (jamais en clair) ;
//  - session : cookie HttpOnly de 12 h contenant un jeton
//    aléatoire — SEUL son hash SHA-256 est stocké en base ;
//  - verrouillage anti force-brute : 5 essais → 15 minutes ;
//  - mot de passe oublié : l'enseignant prévient l'administrateur
//    (badge dans /admin → Comptes), qui génère un nouveau mot de
//    passe et le lui envoie par email.
// ============================================================

export const TEACHER_COOKIE = 'tbl_teacher'
export const TEACHER_SESSION_HOURS = 12
export const TEACHER_MAX_ATTEMPTS = 5
export const TEACHER_LOCK_MINUTES = 15

/** Caractères SANS ambiguïté (pas de 0/O/1/l/I) pour les mots de
 *  passe générés : lisibles à l'écran, dictables au téléphone. */
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'

/** Mot de passe aléatoire lisible (10 caractères, majuscules +
 *  minuscules + chiffres garantis). */
export function generateTeacherPassword(length = 10): string {
  const n = Math.max(8, Math.min(16, length))
  let out = ''
  for (let i = 0; i < n; i++) out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]
  return out
}

export function sha256hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

export function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
  } catch {
    return false
  }
}

export interface TeacherIdentity {
  id: string
  firstName: string
  lastName: string
  email: string
}

/** Normalise un email : minuscules, espaces retirés. */
export function normalizeTeacherEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

/** Vérifie le domaine institutionnel d'un email (paramétrable dans
 *  /admin). Retourne null si OK, sinon un message d'erreur clair. */
export function checkEmailDomain(email: string, domain: string): string | null {
  const d = domain.trim().toLowerCase()
  if (!d.startsWith('@')) return null // réglage inattendu : on ne bloque pas
  if (!email.endsWith(d)) {
    return `L’email doit se terminer par ${d} (email institutionnel).`
  }
  return null
}

/** Valide un email de compte (format minimal + longueur). */
export function isPlausibleEmail(email: string): boolean {
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email) && email.length <= 120
}

/** Pose le cookie de session enseignant et enregistre le hash du
 *  jeton sur le compte (12 h). Retourne la réponse HTTP à envoyer. */
export async function issueTeacherSession(
  req: NextRequest,
  accountId: string
): Promise<NextResponse> {
  const token = randomToken()
  const expires = new Date(Date.now() + TEACHER_SESSION_HOURS * 3600_000)
  await db.teacherAccount.update({
    where: { id: accountId },
    data: { tokenHash: sha256hex(token), tokenExpiresAt: expires, loginAttempts: 0, lockedUntil: null },
  })
  const res = NextResponse.json({ ok: true })
  // Secure UNIQUEMENT en https (Vercel) : en réseau local http://192.168.x.x,
  // un cookie Secure serait silencieusement refusé par le navigateur.
  const isHttps =
    req.nextUrl.protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https'
  res.cookies.set(TEACHER_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    path: '/',
    maxAge: TEACHER_SESSION_HOURS * 3600,
  })
  return res
}

/** Valide le cookie de session enseignant de la requête.
 *  Retourne l'identité du compte, ou une erreur à renvoyer au client. */
export async function requireTeacher(
  req: NextRequest
): Promise<{ ok: true; teacher: TeacherIdentity } | { ok: false; error: string; status: number }> {
  const cookie = req.cookies.get(TEACHER_COOKIE)?.value ?? ''
  if (cookie.length === 0) {
    return { ok: false, error: 'Connexion enseignant requise.', status: 401 }
  }
  const account = await db.teacherAccount.findFirst({
    where: { tokenHash: sha256hex(cookie) },
    select: { id: true, firstName: true, lastName: true, email: true, tokenExpiresAt: true },
  })
  if (!account || !account.tokenExpiresAt || account.tokenExpiresAt.getTime() <= Date.now()) {
    return { ok: false, error: 'Connexion enseignant requise (session expirée).', status: 401 }
  }
  return {
    ok: true,
    teacher: {
      id: account.id,
      firstName: account.firstName,
      lastName: account.lastName,
      email: account.email,
    },
  }
}
