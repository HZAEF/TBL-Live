import { db } from '@/lib/db'
import type { Session } from '@prisma/client'

// ============================================================
// Cycle de vie d'une séance TBL
//
// 1. CORBEILLE (48 h) : la « suppression » demandée par l'enseignant
//    est d'abord douce — les étudiants perdent immédiatement l'accès,
//    mais la séance reste restaurable pendant 48 h. Au-delà, elle est
//    supprimée définitivement (questions, cas, réponses, notes…).
//
// 2. RÉTENTION DES DONNÉES ÉTUDIANTES (4 mois) : 4 mois après la
//    création, les données produites par les étudiants (noms, réponses,
//    réclamations, évaluations par les pairs) sont purgées automatique-
//    ment. La séance elle-même (QCM, cas cliniques, réglages, équipes)
//    est conservée et peut être dupliquée pour être réutilisée.
//
// Vercel étant serverless (pas de tâche planifiée fiable sur le plan
// gratuit), ces opérations sont appliquées « paresseusement » à chaque
// ouverture de la séance par l'enseignant (tableau de bord / connexion
// PIN) : le résultat est identique à un nettoyage planifié.
// ============================================================

/** Durée de restauration possible après une mise à la corbeille. */
export const TRASH_HOURS = 48

/** Rétention des données étudiantes avant purge automatique (en mois). */
export const DATA_RETENTION_MONTHS = 4

const TRASH_MS = TRASH_HOURS * 3_600_000

/** Date limite de restauration d'une séance mise à la corbeille. */
export function trashDeadline(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + TRASH_MS)
}

/** La corbeille est-elle expirée (suppression définitive due) ? */
export function isTrashExpired(deletedAt: Date): boolean {
  return deletedAt.getTime() + TRASH_MS < Date.now()
}

/** Date d'il y a 4 mois calendaires (même jour, même heure). */
export function retentionCutoff(): Date {
  const now = new Date()
  return new Date(
    now.getFullYear(),
    now.getMonth() - DATA_RETENTION_MONTHS,
    now.getDate(),
    now.getHours(),
    now.getMinutes()
  )
}

/**
 * Applique le cycle de vie à une séance, à chaque ouverture enseignant :
 *  - corbeille expirée  → suppression DÉFINITIVE (renvoie null) ;
 *  - données de plus de 4 mois non purgées → purge (renvoie la séance
 *    mise à jour avec dataPurgedAt) ;
 *  - sinon → séance inchangée.
 */
export async function applyLifecycle(session: Session): Promise<Session | null> {
  // 1. Corbeille expirée → suppression définitive (tout est en cascade :
  //    questions, cas, équipes, étudiants, réponses, réclamations, pairs).
  if (session.deletedAt && isTrashExpired(session.deletedAt)) {
    await db.session.delete({ where: { id: session.id } })
    return null
  }
  // 2. Purge des données étudiantes 4 mois après la création.
  if (!session.dataPurgedAt && session.createdAt < retentionCutoff()) {
    return purgeStudentData(session)
  }
  return session
}

/**
 * Purge des données produites par les étudiants :
 *  - SUPPRIMÉ : étudiants (noms + jetons + codes de reprise), réponses
 *    iRAT et tRAT, réponses d'application, réclamations, évaluations
 *    par les pairs ;
 *  - CONSERVÉ : la séance, ses QCM, ses cas cliniques, ses réglages et
 *    ses équipes (structure), pour consultation et duplication.
 */
export async function purgeStudentData(session: Session): Promise<Session> {
  // Les réponses iRAT et les évaluations par les pairs sont supprimées en
  // cascade avec les étudiants (onDelete: Cascade dans le schéma).
  await db.student.deleteMany({ where: { sessionId: session.id } })
  // Les réponses tRAT restantes (par équipe) et les réponses d'application.
  await db.answer.deleteMany({ where: { question: { sessionId: session.id } } })
  await db.appAnswer.deleteMany({ where: { question: { sessionId: session.id } } })
  await db.appeal.deleteMany({ where: { sessionId: session.id } })
  // Les équipes sont conservées (structure de la séance) mais remises à
  // zéro pour le suivi des réclamations.
  await db.team.updateMany({
    where: { sessionId: session.id },
    data: { appealsDone: false },
  })
  return db.session.update({
    where: { id: session.id },
    data: { dataPurgedAt: new Date() },
  })
}
