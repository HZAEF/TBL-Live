import { db } from '@/lib/db'

// ============================================================
// TBL Live v2.9.0 — Compteurs de révision (sondage allégé)
//
// Chaque écriture qui change l'état visible d'une séance
// incrémente UN OU DEUX compteurs :
//  - revision        → ce que voient les ÉTUDIANTS (/api/student) ;
//  - revisionTeacher → ce que voit le tableau de bord ENSEIGNANT
//    (/api/sessions/[code]/dashboard) — inclut les signalements.
//
// Principe du sondage allégé : le client envoie ?rev=N (son dernier
// numéro). Si le serveur a le MÊME numéro, il répond une ligne
// minuscule { unchanged: true } : une seule requête en base au lieu
// d'une dizaine, et un octet de réseau au lieu de l'état complet.
// Avec 65 étudiants, la charge devient négligeable tant que rien ne
// change — et le premier changement déclenche UN seul renouvellement
// complet par étudiant, pas une tempête de rechargements.
// ============================================================

export interface RevisionBumpOptions {
  /** Incrémenter le compteur étudiant (défaut : true). */
  student?: boolean
  /** Incrémenter le compteur enseignant (défaut : true). */
  teacher?: boolean
}

/**
 * Incrémente les compteurs de révision d'une séance.
 * Tolère une séance supprimée entre-temps (suppression définitive
 * simultanée) : sans conséquence, personne ne la sonde plus.
 */
export async function bumpRevisions(
  sessionId: string,
  opts: RevisionBumpOptions = {}
): Promise<void> {
  const student = opts.student !== false
  const teacher = opts.teacher !== false
  if (!student && !teacher) return
  const data: Record<string, unknown> = {}
  if (student) data.revision = { increment: 1 }
  if (teacher) data.revisionTeacher = { increment: 1 }
  try {
    await db.session.update({ where: { id: sessionId }, data })
  } catch {
    // séance supprimée définitivement entre-temps : rien à faire
  }
}

/** Lit le paramètre ?rev= d'une requête (null si absent/invalide). */
export function readRevParam(url: URL): number | null {
  const raw = url.searchParams.get('rev')
  if (raw === null) return null
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0 || n > 2_000_000_000) return null
  return n
}

/**
 * v3.0.0 — Incrémente le compteur de révision d'UNE ÉQUIPE (+ le
 * compteur enseignant). Utilisé par les réponses tRAT : seuls les
 * membres de l'équipe voient la carte à gratter progresser — les
 * autres étudiants n'ont rien à renouveler, la classe ne déclenche
 * plus une tempête de rechargements à chaque réponse d'une équipe.
 */
export async function bumpTeamRevision(sessionId: string, teamId: string): Promise<void> {
  try {
    await db.session.update({
      where: { id: sessionId },
      data: { revisionTeacher: { increment: 1 } },
    })
  } catch {
    // séance supprimée entre-temps : rien à faire
  }
  try {
    await db.team.update({
      where: { id: teamId },
      data: { revisionTeam: { increment: 1 } },
    })
  } catch {
    // équipe supprimée entre-temps (changement d'effectif) : rien à faire
  }
}
