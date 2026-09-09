import { db } from '@/lib/db'
import { isPlausibleEmail, normalizeTeacherEmail } from '@/lib/teacher-auth'

// ============================================================
// TBL Live v3.2.0 — Partage d'une séance entre enseignants
//
// Le propriétaire d'une séance peut inviter des collègues par leur
// email institutionnel (onglet Configurations → « Partage de la
// séance ») : la séance apparaît dans « Mes séances » du compte de
// chaque collègue, qui peut l'ouvrir SANS PIN et co-piloter le
// déroulé. Conçu pour deux enseignants qui animent la même séance
// TBL, ou un titulaire + un superviseur.
//
// GARDE-FOUS :
//  - email normalisé (minuscules) + domaine institutionnel vérifié
//    (même règle que la création des comptes par l'administrateur) ;
//  - le propriétaire ne peut pas s'inviter lui-même (inutile) ;
//  - limite de MAX_COLLABORATORS invitations par séance (anti-
//    bourrage involontaire — une séance se partage entre 2-4
//    collègues, pas avec une faculté entière) ;
//  - le partage n'expose AUCUN secret : le jeton enseignant n'est
//    JAMAIS transmis à l'invité par l'application. C'est le COMPTE
//    de l'invité qui prouve son identité (email + mot de passe) ;
//    le serveur lui livre alors le jeton via open_session.
// ============================================================

/** Maximum d'enseignants invités par séance (hors propriétaire). */
export const MAX_COLLABORATORS = 10

/** Résultat de la validation d'un email d'invitation. */
export type ShareEmailCheck =
  | { ok: true; email: string }
  | { ok: false; error: string }

/**
 * Valide un email d'invitation : format plausible, domaine
 * institutionnel (réglé dans /admin), longueur. Retourne l'email
 * normalisé ou un message d'erreur clair destiné à l'enseignant.
 * Ne regarde PAS la base (le compte peut ne pas exister encore).
 */
export function checkShareEmail(raw: unknown, domain: string): ShareEmailCheck {
  const email = normalizeTeacherEmail(raw)
  if (!email) {
    return { ok: false, error: 'Saisissez l’email institutionnel de l’enseignant à inviter.' }
  }
  if (!isPlausibleEmail(email)) {
    return { ok: false, error: 'Email invalide (attendu : prenom.nom@etablissement).' }
  }
  const d = domain.trim().toLowerCase()
  if (d.startsWith('@') && !email.endsWith(d)) {
    return { ok: false, error: `L’email doit se terminer par ${d} (email institutionnel).` }
  }
  return { ok: true, email }
}

/**
 * Le compte identifié par cet email peut-il voir la séance dans
 * « Mes séances » ? (propriétaire OU invité). Ne lève jamais
 * d'exception — réponse booléenne.
 */
export async function isSessionVisibleTo(session: { id: string; teacherId: string | null }, email: string): Promise<boolean> {
  if (email.length === 0) return false
  const share = await db.sessionCollaborator.findUnique({
    where: { sessionId_email: { sessionId: session.id, email } },
    select: { id: true },
  })
  return share !== null
}

/** Liste des emails invités d'une séance (avec date d'ajout). */
export async function listCollaborators(sessionId: string): Promise<{ email: string; addedAt: Date }[]> {
  return db.sessionCollaborator.findMany({
    where: { sessionId },
    orderBy: { addedAt: 'asc' },
    select: { email: true, addedAt: true },
  })
}

/**
 * Emails invités + statut des comptes correspondants (existe /
 * n'existe pas encore) + nom complet si le compte existe — pour
 * l'affichage du tableau de bord enseignant et la liste admin.
 */
export async function listCollaboratorsDetailed(sessionId: string): Promise<
  { email: string; addedAt: string; hasAccount: boolean; name: string | null }[]
> {
  const [shares, accounts] = await Promise.all([
    listCollaborators(sessionId),
    db.teacherAccount.findMany({
      select: { email: true, firstName: true, lastName: true },
    }),
  ])
  const byEmail = new Map(accounts.map((a) => [a.email, a]))
  return shares.map((s) => {
    const acc = byEmail.get(s.email)
    return {
      email: s.email,
      addedAt: s.addedAt.toISOString(),
      hasAccount: !!acc,
      name: acc ? `${acc.firstName} ${acc.lastName}` : null,
    }
  })
}
