import { db } from '@/lib/db'
import { recordWrite, recordWriteQueueDelta } from '@/lib/metrics'

// ============================================================
// TBL Live v3.1.0 — FILE D'ÉCRITURE COURTE (verrou par séance)
//
// PROBLÈME (rapport d'audit, problème n°1). En mode local (SQLite
// sur le PC de l'enseignant + Wi-Fi), 150 étudiants produisent ~75
// sondages/s ET des rafales d'écritures simultanées (iRAT, tRAT,
// application, appels). Chaque écriture verrouille brièvement le
// fichier SQLite ; sous WAL les lectures cohabitent, mais les
// ÉCRITURES concurrentes se sérialisent sauvagement au niveau du
// moteur : SQLITE_BUSY, attentes, et le retour des P1008 (délai
// de transaction dépassé) qui avaient rendu les séances instables.
//
// SOLUTION — un « single writer » APPLICATIF, sans réécrire la
// couche données : toute mutation d'une séance passe par
// withSessionWrite(sessionId, route, fn) :
//  - les mutations d'une MÊME séance s'exécutent UNE PAR UNE, dans
//    l'ordre d'arrivée (une chaîne de promesses par séance) ;
//  - chaque travail reste COURT et déterministe (quelques ms) —
//    aucune transaction interactive de longue durée ne revient ;
//  - les LECTURES (sondages, états) ne passent PAS par la file :
//    elles restent 100 % concurrentes (avantage du WAL) ;
//  - les séances DIFFÉRENTES ont des files séparées : deux classes
//    en parallèle ne se ralentissent pas.
//
// PORTÉE réelle du verrou (honnêteté technique) :
//  - SERVEUR LOCAL : le processus standalone est unique → la file
//    est EXACTE, la contention SQLite interne disparaît ;
//  - VERCEL (serverless) : chaque instance a sa file en mémoire —
//    les requêtes d'une même rafale atterrissent le plus souvent sur
//    la même instance chaude ; les écritures restent de toute façon
//    protégées par les contraintes uniques PostgreSQL (P2002) et par
//    l'idempotence v3.1.0 des réponses. La file réduit la contention
//    intra-instance, la base garantit l'intégrité inter-instances.
//
// En bonus, la file rend ATOMIQUES les enchaînements « lire les
// compteurs → choisir l'équipe la moins remplie → insérer » du
// /api/join (problème n°2 : 150 joins simultanés ne choisissent
// plus tous la même équipe).
// ============================================================

/** Chaînes par séance : la promesse de fin du dernier travail. */
const chains = new Map<string, Promise<void>>()

/** Statistiques de maintenance (tests unitaires / /admin). */
export function writeQueueStats(): { sessions: number } {
  return { sessions: chains.size }
}

/**
 * Exécute `fn` en EXCLUSIVITÉ pour la séance (écritures sérialisées,
 * lectures hors file). Retourne le résultat de fn tel quel — les
 * erreurs traversent la file sans casser la chaîne des suivantes.
 */
export async function withSessionWrite<T>(
  sessionId: string,
  route: string,
  fn: () => Promise<T>
): Promise<T> {
  const prev = chains.get(sessionId) ?? Promise.resolve()
  const enqueuedAt = Date.now()
  recordWriteQueueDelta(1)
  let startedAt = 0
  const job = prev.then(() => {
    startedAt = Date.now()
    return fn()
  })
  // La suite de la chaîne attend la FIN de job (réussite OU échec) :
  const tail = job.then(
    () => undefined,
    () => undefined
  )
  chains.set(sessionId, tail)
  tail.then(() => {
    // Nettoyage : si aucune nouvelle mutation n'est arrivée entre-
    // temps, l'entrée de la carte disparaît (pas de fuite mémoire
    // après la séance). Le compteur de profondeur suit.
    if (chains.get(sessionId) === tail) chains.delete(sessionId)
    recordWriteQueueDelta(-1)
  })
  try {
    return await job
  } finally {
    const now = Date.now()
    recordWrite(
      route,
      startedAt > 0 ? startedAt - enqueuedAt : 0,
      startedAt > 0 ? now - startedAt : 0
    )
  }
}

// ============================================================
// v3.1.0 — Journal d'événements (préparation sync delta, problème
// n°8) : consigne UN événement numéroté pour la séance. Doit être
// appelé SOUS le verrou d'écriture (le numéro est attribué en
// incrémentant Session.eventSeq, donc sérialisé) — c'est le cas
// puisque les routes l'appellent depuis withSessionWrite.
//
// AUCUN SECRET dans le payload (jamais jeton, PIN, code de reprise,
// mot de passe) : uniquement identifiants techniques et valeurs de
// réponse — audit du problème n°9 respecté.
// ============================================================

/** Types acceptés par le journal (garde de saisie). */
export type SessionEventType =
  | 'join'
  | 'answer'
  | 'team_answer'
  | 'app_answer'
  | 'appeal'
  | 'appeal_done'
  | 'peer'
  | 'sai'
  | 'phase'
  | 'case_open'
  | 'reveal'
  | 'appeal_decision'
  // v3.3.0 — journal des modifications ENSEIGNANTES (rubrique
  // « Journal » du tableau de bord : qui a changé quoi, quand — pour
  // la collaboration entre propriétaire et invités d'une séance
  // partagée). Le payload porte { action, detail?, actor?,
  // actorEmail? } — jamais de secret.
  | 'question_edit'
  | 'team_edit'
  | 'session_edit'
  | 'share'
  | 'restart'

const EVENT_TYPES: ReadonlySet<string> = new Set<SessionEventType>([
  'join',
  'answer',
  'team_answer',
  'app_answer',
  'appeal',
  'appeal_done',
  'peer',
  'sai',
  'phase',
  'case_open',
  'reveal',
  'appeal_decision',
  'question_edit',
  'team_edit',
  'session_edit',
  'share',
  'restart',
])

/** v3.3.0 — Types d'événements de type « ACTION ENSEIGNANTE » : la
 * rubrique Journal du tableau de bord ne liste QUE ces entrées (les
 * événements étudiants — réponses, inscriptions… — restent dans le
 * journal complet, via export_events). */
export const TEACHER_EVENT_TYPES: readonly string[] = [
  'phase',
  'case_open',
  'reveal',
  'appeal_decision',
  'question_edit',
  'team_edit',
  'session_edit',
  'share',
  'restart',
]

/** v3.3.0 — Valide le JSON stocké d'un payload d'événement (jamais
 * de secret dedans par construction) ; '{}' si illisible. Partagé
 * par les routes manage (export_events) et dashboard (rubrique
 * Journal). */
export function safeEventPayload(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // JSON illisible : payload vide
  }
  return {}
}

// v3.2.0 — ROTATION DU JOURNAL (audit point n°6) : une séance TBL très
// active (150 étudiants, réponses + retries + événements de phase)
// produit quelques milliers d'événements (~100 octets chacun). Pour
// éviter qu'une séance à très longue vie ne fasse grossir la table
// sans fin, le journal garde au plus EVENT_KEEP événements PAR SÉANCE :
// tous les TRIM_EVERY insertions, les plus anciens sont supprimés.
// Le compteur eventSeq N'EST JAMAIS remis à zéro (numéros strictement
// croissants → les consommateurs delta ne se trompent jamais de curseur) ;
// les événements supprimés sont les plus anciens, déjà consommés de
// longtemps. 5000 événements couvrent plusieurs heures de séance.
const EVENT_KEEP = 5000
const TRIM_EVERY = 500

/** Lit l'origine déclarée d'une requête (en-tête x-tbl-origin ;
 *  'local' par défaut — le serveur qui traite est l'origine).
 *  Utilisé par les routes : const origin = eventOriginFromHeader(
 *  req.headers.get('x-tbl-origin')). */
export function eventOriginFromHeader(value: string | null | undefined): string {
  return value === 'online' ? 'online' : 'local'
}

/**
 * Consigne un événement dans le journal de la séance.
 * Tolère un échec d'insertion (séance supprimée entre-temps) sans
 * faire échouer la mutation : le journal est un observateur, jamais
 * un point de blocage de la séance.
 * @param origin instance émettrice ('local' | 'online'), lue par la
 *  route dans l'en-tête x-tbl-origin.
 */
export async function recordSessionEvent(
  sessionId: string,
  type: SessionEventType,
  entityId: string | null,
  payload: Record<string, unknown>,
  origin: string = 'local'
): Promise<void> {
  if (!EVENT_TYPES.has(type)) return
  let json = '{}'
  try {
    json = JSON.stringify(payload)
  } catch {
    json = '{}'
  }
  try {
    const updated = await db.session.update({
      where: { id: sessionId },
      data: { eventSeq: { increment: 1 } },
      select: { eventSeq: true },
    })
    await db.sessionEvent.create({
      data: {
        sessionId,
        sequence: updated.eventSeq,
        type,
        entityId,
        payload: json.length <= 4000 ? json : '{}',
        origin: origin === 'online' ? 'online' : 'local',
      },
    })
    // v3.2.0 — rotation (audit n°6) : tous les TRIM_EVERY événements,
    // on supprime les plus anciens au-delà de EVENT_KEEP. Appelé sous
    // le verrou d'écriture, index (sessionId, sequence) → rapide ;
    // best-effort : un échec de nettoyage ne bloque JAMAIS la séance.
    if (updated.eventSeq % TRIM_EVERY === 0) {
      try {
        await db.sessionEvent.deleteMany({
          where: { sessionId, sequence: { lt: updated.eventSeq - EVENT_KEEP } },
        })
      } catch {
        // nettoyage best-effort
      }
    }
  } catch {
    // journal best-effort : jamais un blocage pour l'étudiant
  }
}
