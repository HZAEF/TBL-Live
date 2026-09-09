import { db } from '@/lib/db'
import type { Session } from '@prisma/client'
import { PHASE_ORDER } from './tbl-types'
import { randomToken } from './tbl'

// ============================================================
// TBL Live v2.7.0 — Synchronisation Internet ↔ réseau local
//
// PRINCIPE. Une même séance peut être servie par DEUX instances :
//  - la version EN LIGNE (GitHub → Vercel + base Neon), accessible
//    depuis n'importe quel réseau ;
//  - la version LOCALE (ordinateur de l'enseignant, mode réseau
//    local, base SQLite) accessible depuis le Wi-Fi de la salle,
//    sans Internet.
// Les étudiants rejoignent l'une ou l'autre avec le même code de
// séance. L'ORDINATEUR QUI GÈRE LA SÉANCE (celui du tableau de
// bord enseignant) est le « maître » : il tire les contributions
// des étudiants connectés à l'autre instance (fusion), puis pousse
// l'état complet (miroir exact). Comme TOUTES les lignes gardent
// leurs identifiants d'origine (cuid), il ne peut PAS y avoir de
// doublons ; comme le push remplace intégralement la copie
// distante par l'état fusionné, il ne peut PAS y avoir de conflit.
//
// RÈGLES DE FUSION (pull → local) :
//  - réponses/évaluations/signalements : union par identifiant ;
//    conflit sur une même ligne → la plus récente gagne
//    (updatedAt, à défaut createdAt) ;
//  - booléens « ouvertures » (cas lancé, feedback lancé, révélation
//    forcée) : OU logique (une fois lancé, lancé) ;
//  - statut de la séance : uniquement en AVANT dans le déroulé
//    (l'avance automatique ne va jamais en arrière) et si le
//    changement distant est plus récent ;
//  - structure (questions, cas, items du questionnaire) : insérée
//    si elle manque, jamais écrasée — les modifications de
//    structure se font sur l'ordinateur maître puis se propagent
//    par le push.
//
// FORMAT v1 = sauvegarde téléchargeable (bouton « Sauvegarder ») :
//  SANS secrets (pas de jetons, pas de PIN). Permet de recréer la
//  séance sur un appareil neuf : l'enseignant choisit un nouveau
//  PIN, les étudiants retrouvent leurs comptes par nom + code
//  personnel.
// FORMAT v2 = synchronisation serveur ↔ serveur : contient les
//  jetons (enseignant + étudiants) et le haché du PIN pour que les
//  deux copies de la séance soient INTERCHANGEABLES. Ce format ne
//  transite JAMAIS par le navigateur de l'enseignant : il est
//  construit et envoyé par le serveur local, en HTTPS.
// ============================================================

// ---------------- Types du format de sauvegarde ----------------

export interface BackupSessionCore {
  code: string
  title: string
  status: string
  iratMinutes: number
  createdAt: string
  deletedAt: string | null
  dataPurgedAt: string | null
  /** v2.7.0 : horodatages utilisés par la fusion (absents du format v1
   *  téléchargeable, toujours présents dans le format v2 de sync). */
  phaseStartedAt?: string | null
  feedbackReady?: boolean
  /** v2.9.0 : compteurs du sondage allégé (absents des sauvegardes
   *  antérieures → traités comme 0). */
  revision?: number
  revisionTeacher?: number
  /** v3.0.0 : signalements anti-capture activés pour cette séance
   *  (absent des sauvegardes antérieures → non modifié à l'import,
   *  la valeur par défaut « désactivé » s'applique aux séances neuves). */
  reportsEnabled?: boolean
  /** v3.2.0 : email institutionnel du propriétaire (absent des
   *  sauvegardes antérieures → null). Les ids de comptes DIFFÈRENT
   *  entre l'instance locale et l'instance en ligne ; l'email est
   *  l'identifiant stable — le miroir distant résout cet email en
   * compte LOCAL pour que « Mes séances » fonctionne des deux côtés. */
  ownerEmail?: string | null
}

export interface SyncBackup {
  format: 'tbl-live-sauvegarde' | 'tbl-live-sync'
  version: number
  exportedAt: string
  session: BackupSessionCore
  teams: unknown[]
  students: unknown[]
  questions: unknown[]
  cases: unknown[]
  answers: unknown[]
  appeals: unknown[]
  appAnswers: unknown[]
  peerEvals: unknown[]
  saiItems: unknown[]
  saiResponses: unknown[]
  alerts?: unknown[]
  /** v3.2.0 : partage de la séance — [{ email, addedAt }]. La liste
   *  des enseignants invités suit la séance d'une instance à l'autre
   *  (et dans les sauvegardes .json) : l'invitation survit au miroir. */
  collaborators?: unknown[]
  /** v2 uniquement — jamais exposé au navigateur. */
  secrets?: {
    sessionId: string
    teacherToken: string
    teacherPin: string
  }
}

// ---------------- Garde-fous de validation ----------------

const MAX = {
  students: 600,
  teams: 120,
  questions: 400,
  cases: 60,
  answers: 30000,
  appeals: 3000,
  appAnswers: 8000,
  peerEvals: 30000,
  saiItems: 120,
  saiResponses: 30000,
  alerts: 8000,
  collaborators: 40,
}

class BackupError extends Error {}

function arr(b: unknown, max: number): unknown[] {
  if (b === undefined || b === null) return []
  if (!Array.isArray(b)) throw new BackupError('Format de fichier invalide.')
  if (b.length > max)
    throw new BackupError('Fichier trop volumineux (trop de données pour une séance).')
  return b
}

function str(v: unknown, max: number, label: string): string {
  if (typeof v !== 'string') throw new BackupError(`Donnée invalide : ${label}.`)
  if (v.length > max) throw new BackupError(`Donnée trop longue : ${label}.`)
  return v
}

function strOrNull(v: unknown, max: number, label: string): string | null {
  if (v === null || v === undefined) return null
  return str(v, max, label)
}

function int(v: unknown, min: number, max: number, label: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
    throw new BackupError(`Valeur invalide : ${label}.`)
  return v
}

function date(v: unknown): Date {
  const d = typeof v === 'string' || typeof v === 'number' ? new Date(v) : new Date()
  return Number.isNaN(d.getTime()) ? new Date(0) : d
}

function dateOrNull(v: unknown): Date | null {
  if (v === null || v === undefined) return null
  const d = new Date(v as string)
  return Number.isNaN(d.getTime()) ? null : d
}

// ---------------- Construction de la sauvegarde ----------------

/** Sauvegarde complète AVEC secrets (format v2, serveur ↔ serveur). */
export async function buildSyncBackup(session: Session): Promise<SyncBackup> {
  const sid = session.id
  const [teams, students, questions, cases, answers, appeals, appAnswers, peerEvals, saiItems, saiResponses, alerts, collaborators, owner] =
    await Promise.all([
      db.team.findMany({ where: { sessionId: sid }, orderBy: { number: 'asc' } }),
      db.student.findMany({ where: { sessionId: sid }, orderBy: { createdAt: 'asc' } }),
      db.question.findMany({
        where: { sessionId: sid },
        orderBy: [{ phase: 'asc' }, { order: 'asc' }, { id: 'asc' }],
      }),
      db.case.findMany({ where: { sessionId: sid }, orderBy: [{ order: 'asc' }, { id: 'asc' }] }),
      db.answer.findMany({ where: { question: { sessionId: sid } }, orderBy: { createdAt: 'asc' } }),
      db.appeal.findMany({ where: { sessionId: sid }, orderBy: { createdAt: 'asc' } }),
      db.appAnswer.findMany({ where: { team: { sessionId: sid } } }),
      db.peerEval.findMany({ where: { sessionId: sid }, orderBy: { createdAt: 'asc' } }),
      db.saiItem.findMany({
        where: { sessionId: sid },
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
      }),
      db.saiResponse.findMany({ where: { student: { sessionId: sid } }, orderBy: { createdAt: 'asc' } }),
      db.alertEvent.findMany({ where: { student: { sessionId: sid } }, orderBy: { createdAt: 'asc' } }),
      // v3.2.0 : partage — invitations par email (identifiant stable
      // inter-instances) + propriétaire (résolu en email).
      db.sessionCollaborator.findMany({ where: { sessionId: sid }, orderBy: { addedAt: 'asc' } }),
      session.teacherId
        ? db.teacherAccount.findUnique({ where: { id: session.teacherId }, select: { email: true } })
        : Promise.resolve(null),
    ])
  return {
    format: 'tbl-live-sync',
    version: 2,
    exportedAt: new Date().toISOString(),
    session: {
      code: session.code,
      title: session.title,
      status: session.status,
      iratMinutes: session.iratMinutes,
      createdAt: session.createdAt.toISOString(),
      deletedAt: session.deletedAt ? session.deletedAt.toISOString() : null,
      dataPurgedAt: session.dataPurgedAt ? session.dataPurgedAt.toISOString() : null,
      // v2.7.0 : horodatages de la fusion (statut en avant uniquement).
      phaseStartedAt: session.phaseStartedAt.toISOString(),
      feedbackReady: session.feedbackReady,
      // v2.9.0 : compteurs du sondage allégé — transportés pour que le
      // miroir distant garde des numéros qui AUGMENTENT toujours (les
      // étudiants de l'autre version détectent chaque changement).
      revision: session.revision,
      revisionTeacher: session.revisionTeacher,
      // v3.0.0 : signalements anti-capture activés pour cette séance
      // (l'administrateur peut les réactiver TBL par TBL — le réglage
      // suit la séance sur les deux versions).
      reportsEnabled: session.reportsEnabled,
      // v3.2.0 : email du propriétaire — l'identifiant stable entre
      // instances. Le miroir distant le résout en compte LOCAL à
      // l'arrivée : « Mes séances » du propriétaire fonctionne ainsi
      // sur la version en ligne ET sur la version locale.
      ownerEmail: owner?.email ?? null,
    },
    secrets: {
      sessionId: session.id,
      teacherToken: session.teacherToken,
      teacherPin: session.teacherPin,
    },
    teams: teams.map((t) => ({
      id: t.id,
      sessionId: sid,
      name: t.name,
      number: t.number,
      appealsDone: t.appealsDone,
      updatedAt: t.updatedAt ? t.updatedAt.toISOString() : null,
    })),
    students: students.map((s) => ({
      id: s.id,
      sessionId: sid,
      teamId: s.teamId,
      name: s.name,
      token: s.token,
      recoveryCode: s.recoveryCode,
      saiCompletedAt: s.saiCompletedAt ? s.saiCompletedAt.toISOString() : null,
      saiComment: s.saiComment,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt ? s.updatedAt.toISOString() : null,
    })),
    questions: questions.map((q) => ({
      id: q.id,
      sessionId: sid,
      text: q.text,
      choices: q.choices,
      correct: q.correct,
      phase: q.phase,
      order: q.order,
      caseId: q.caseId,
      updatedAt: q.updatedAt ? q.updatedAt.toISOString() : null,
    })),
    cases: cases.map((c) => ({
      id: c.id,
      sessionId: sid,
      title: c.title,
      intro: c.intro,
      order: c.order,
      opened: c.opened,
      updatedAt: c.updatedAt ? c.updatedAt.toISOString() : null,
    })),
    answers: answers.map((a) => ({
      id: a.id,
      questionId: a.questionId,
      studentId: a.studentId,
      teamId: a.teamId,
      kind: a.kind,
      choice: a.choice,
      attempt: a.attempt,
      isCorrect: a.isCorrect,
      score: a.score,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt ? a.updatedAt.toISOString() : null,
    })),
    appeals: appeals.map((a) => ({
      id: a.id,
      sessionId: sid,
      teamId: a.teamId,
      questionId: a.questionId,
      text: a.text,
      status: a.status,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt ? a.updatedAt.toISOString() : null,
    })),
    appAnswers: appAnswers.map((a) => ({
      id: a.id,
      teamId: a.teamId,
      questionId: a.questionId,
      choice: a.choice,
      text: a.text,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    })),
    peerEvals: peerEvals.map((e) => ({
      id: e.id,
      sessionId: sid,
      evaluatorId: e.evaluatorId,
      evaluatedId: e.evaluatedId,
      score: e.score,
      comment: e.comment,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    })),
    saiItems: saiItems.map((it) => ({
      id: it.id,
      sessionId: sid,
      subscale: it.subscale,
      textKey: it.textKey,
      text: it.text,
      reversed: it.reversed,
      order: it.order,
      createdAt: it.createdAt.toISOString(),
      updatedAt: it.updatedAt ? it.updatedAt.toISOString() : null,
    })),
    saiResponses: saiResponses.map((r) => ({
      id: r.id,
      studentId: r.studentId,
      itemId: r.itemId,
      value: r.value,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    alerts: alerts.map((a) => ({
      id: a.id,
      studentId: a.studentId,
      kind: a.kind,
      phase: a.phase,
      createdAt: a.createdAt.toISOString(),
    })),
    // v3.2.0 : invitations de partage (emails institutionnels) — la
    // liste suit la séance partout : miroir en ligne, sauvegarde .json,
    // restauration. Aucun secret : les emails ne suffisent pas à
    // ouvrir la séance (le compte + mot de passe restent exigés).
    collaborators: collaborators.map((c) => ({
      email: c.email,
      addedAt: c.addedAt.toISOString(),
    })),
  }
}

// ---------------- Import (remplacement complet) ----------------

/**
 * Recrée intégralement une séance à partir d'une sauvegarde (v1
 * téléchargée ou v2 synchronisée), en conservant TOUS les
 * identifiants : jetons étudiants, équipes, réponses… Le remplacement
 * est atomique (transaction) : en cas d'échec, l'existant reste
 * intact.
 *
 * @param pin nouveau PIN (format v1, séance recréée sur un appareil
 *            neuf — déjà haché par l'appelant) ; absent en v2.
 * @param teacherId v3.0.0 : compte enseignant propriétaire (télé-
 *            versement depuis le navigateur) ; null pour la synchro
 *            machine ↔ machine (le miroir n'appartient à personne).
 */
export async function replaceSessionFromBackup(
  backupRaw: unknown,
  hashedPin?: string,
  teacherId?: string | null
): Promise<{ session: Session; restored: boolean }> {
  const b = backupRaw as Partial<SyncBackup>
  if (!b || typeof b !== 'object') throw new BackupError('Fichier invalide.')
  if (b.format !== 'tbl-live-sauvegarde' && b.format !== 'tbl-live-sync')
    throw new BackupError('Ce fichier n’est pas une sauvegarde de séance TBL Live.')
  if (!b.session || typeof b.session.code !== 'string' || b.session.code.length !== 6)
    throw new BackupError('Code de séance manquant dans le fichier.')

  const sid = b.secrets?.sessionId
  const teacherToken = b.secrets?.teacherToken
  const teacherPin = b.secrets?.teacherPin
  const isV2 = b.format === 'tbl-live-sync' && typeof sid === 'string' && typeof teacherToken === 'string' && teacherToken.length >= 32 && typeof teacherPin === 'string'
  if (b.format === 'tbl-live-sync' && !isV2)
    throw new BackupError('Sauvegarde de synchronisation incomplète (secrets absents).')
  if (!isV2 && !hashedPin) throw new BackupError('Un nouveau code PIN est nécessaire.')

  const sessionCode = b.session.code.toUpperCase()
  const title = str(b.session.title, 120, 'titre')
  const status = PHASE_ORDER.includes(b.session.status as never)
    ? (b.session.status as string)
    : 'lobby'
  const iratMinutes = int(b.session.iratMinutes ?? 10, 1, 90, 'durée iRAT')
  const createdAt = date(b.session.createdAt)
  // v2.9.0 — CORRECTIF MINUTEUR : la date de début de PHASE doit venir de
  // la sauvegarde, pas de la date de CRÉATION de la séance. Avant ce
  // correctif, le miroir en ligne recevait phaseStartedAt = createdAt :
  // les étudiants connectés à la version en ligne voyaient un temps
  // écoulé énorme pendant l'iRAT (« Temps écoulé (+42:17) » qui montait
  // sans fin) alors que les étudiants du serveur local voyaient le vrai
  // compte à rebours. La vraie date est transportée ; à défaut, la date
  // de création reste le repli historique (statut lobby).
  const phaseStartedAt = dateOrNull(b.session?.phaseStartedAt) ?? createdAt
  // v2.9.0 : compteurs du sondage allégé, transportés (+1 à l'arrivée
  // pour forcer UN renouvellement complet chez les clients distants).
  const incomingRevision = Math.max(
    0,
    Math.min(2_000_000_000, int(b.session?.revision ?? 0, 0, 2_000_000_000, 'révision'))
  )
  const incomingRevisionTeacher = Math.max(
    0,
    Math.min(2_000_000_000, int(b.session?.revisionTeacher ?? 0, 0, 2_000_000_000, 'révision'))
  )

  // --- Validation complète AVANT toute écriture ---
  const teams = arr(b.teams, MAX.teams).map((t) => {
    const o = t as Record<string, unknown>
    return {
      id: str(o.id, 40, 'identifiant équipe'),
      name: str(o.name, 60, 'nom d’équipe'),
      number: int(o.number, 1, 999, 'numéro d’équipe'),
      appealsDone: o.appealsDone === true,
      updatedAt: dateOrNull(o.updatedAt),
    }
  })
  const students = arr(b.students, MAX.students).map((s) => {
    const o = s as Record<string, unknown>
    return {
      id: str(o.id, 40, 'identifiant étudiant'),
      teamId: strOrNull(o.teamId, 40, 'équipe'),
      name: str(o.name, 40, 'nom d’étudiant'),
      token: isV2 && typeof o.token === 'string' && o.token.length >= 32 ? o.token : randomToken(),
      recoveryCode: typeof o.recoveryCode === 'string' ? o.recoveryCode : '',
      saiCompletedAt: dateOrNull(o.saiCompletedAt),
      saiComment: strOrNull(o.saiComment, 1000, 'commentaire'),
      createdAt: date(o.createdAt),
      updatedAt: dateOrNull(o.updatedAt),
    }
  })
  const cases = arr(b.cases, MAX.cases).map((c) => {
    const o = c as Record<string, unknown>
    return {
      id: str(o.id, 40, 'identifiant de cas'),
      title: str(o.title, 160, 'titre de cas'),
      intro: strOrNull(o.intro, 4000, 'énoncé de cas'),
      order: int(o.order ?? 0, 0, 999, 'ordre de cas'),
      opened: o.opened === true,
      updatedAt: dateOrNull(o.updatedAt),
    }
  })
  const questions = arr(b.questions, MAX.questions).map((q) => {
    const o = q as Record<string, unknown>
    const text = str(o.text, 2000, 'question')
    let choices: string[]
    try {
      choices = typeof o.choices === 'string' ? (JSON.parse(o.choices) as string[]) : (o.choices as string[])
    } catch {
      throw new BackupError('Choix de question illisibles dans le fichier.')
    }
    if (!Array.isArray(choices) || choices.length < 2 || choices.length > 6)
      throw new BackupError('Question avec un nombre de choix invalide.')
    const caseId = strOrNull(o.caseId, 40, 'cas')
    return {
      id: str(o.id, 40, 'identifiant de question'),
      text,
      choices: JSON.stringify(choices.map((c) => String(c).slice(0, 500))),
      correct: int(o.correct, 0, choices.length - 1, 'bonne réponse'),
      phase: o.phase === 'application' ? 'application' : 'rat',
      order: int(o.order ?? 0, 0, 999, 'ordre de question'),
      caseId,
      updatedAt: dateOrNull(o.updatedAt),
    }
  })
  const questionIds = new Set(questions.map((q) => q.id))
  const teamIds = new Set(teams.map((t) => t.id))
  const studentIds = new Set(students.map((s) => s.id))
  const caseIds = new Set(cases.map((c) => c.id))

  const answers = arr(b.answers, MAX.answers).map((a) => {
    const o = a as Record<string, unknown>
    const questionId = str(o.questionId, 40, 'question')
    const kind = o.kind === 'trat' ? 'trat' : 'irat'
    return {
      id: str(o.id, 40, 'identifiant de réponse'),
      questionId,
      studentId: kind === 'irat' ? str(o.studentId, 40, 'étudiant') : strOrNull(o.studentId, 40, 'étudiant'),
      teamId: kind === 'trat' ? str(o.teamId, 40, 'équipe') : strOrNull(o.teamId, 40, 'équipe'),
      kind,
      choice: int(o.choice, 0, 5, 'choix'),
      attempt: int(o.attempt ?? 1, 1, 4, 'tentative'),
      isCorrect: o.isCorrect === true,
      score: Math.max(0, Math.min(4, Number(o.score) || 0)),
      createdAt: date(o.createdAt),
      updatedAt: dateOrNull(o.updatedAt),
    }
  })
  const appeals = arr(b.appeals, MAX.appeals).map((a) => {
    const o = a as Record<string, unknown>
    return {
      id: str(o.id, 40, 'identifiant de réclamation'),
      teamId: str(o.teamId, 40, 'équipe'),
      questionId: str(o.questionId, 40, 'question'),
      text: str(o.text, 2000, 'justification'),
      status: o.status === 'accepted' ? 'accepted' : o.status === 'rejected' ? 'rejected' : 'pending',
      createdAt: date(o.createdAt),
      updatedAt: dateOrNull(o.updatedAt),
    }
  })
  const appAnswers = arr(b.appAnswers, MAX.appAnswers).map((a) => {
    const o = a as Record<string, unknown>
    return {
      id: str(o.id, 40, 'identifiant de réponse d’application'),
      teamId: str(o.teamId, 40, 'équipe'),
      questionId: str(o.questionId, 40, 'question'),
      choice: int(o.choice, 0, 5, 'choix'),
      text: strOrNull(o.text, 2000, 'justification'),
      createdAt: date(o.createdAt),
      updatedAt: date(o.updatedAt),
    }
  })
  const peerEvals = arr(b.peerEvals, MAX.peerEvals).map((e) => {
    const o = e as Record<string, unknown>
    return {
      id: str(o.id, 40, 'identifiant d’évaluation'),
      evaluatorId: str(o.evaluatorId, 40, 'évaluateur'),
      evaluatedId: str(o.evaluatedId, 40, 'évalué'),
      score: int(o.score, 1, 5, 'note'),
      comment: strOrNull(o.comment, 1000, 'commentaire'),
      createdAt: date(o.createdAt),
      updatedAt: date(o.updatedAt),
    }
  })
  const saiItems = arr(b.saiItems, MAX.saiItems).map((it) => {
    const o = it as Record<string, unknown>
    const subscale =
      o.subscale === 'accountability' || o.subscale === 'preference' || o.subscale === 'satisfaction'
        ? (o.subscale as string)
        : 'satisfaction'
    return {
      id: str(o.id, 40, 'identifiant d’item'),
      subscale,
      textKey: strOrNull(o.textKey, 200, 'clé de libellé'),
      text: strOrNull(o.text, 500, 'libellé'),
      reversed: o.reversed === true,
      order: int(o.order ?? 0, 0, 999, 'ordre d’item'),
      createdAt: date(o.createdAt),
      updatedAt: dateOrNull(o.updatedAt),
    }
  })
  const saiItemIds = new Set(saiItems.map((i) => i.id))
  const saiResponses = arr(b.saiResponses, MAX.saiResponses).map((r) => {
    const o = r as Record<string, unknown>
    return {
      id: str(o.id, 40, 'identifiant de réponse au questionnaire'),
      studentId: str(o.studentId, 40, 'étudiant'),
      itemId: str(o.itemId, 40, 'item'),
      value: int(o.value, 1, 5, 'valeur'),
      createdAt: date(o.createdAt),
      updatedAt: date(r && (r as Record<string, unknown>).updatedAt),
    }
  })
  const alerts = arr(b.alerts, MAX.alerts).map((a) => {
    const o = a as Record<string, unknown>
    return {
      id: str(o.id, 40, 'identifiant de signalement'),
      studentId: str(o.studentId, 40, 'étudiant'),
      kind: o.kind === 'screenshot' ? 'screenshot' : 'tab_hidden',
      phase: strOrNull(o.phase, 20, 'épreuve'),
      createdAt: date(o.createdAt),
    }
  })
  // v3.2.0 — Partage : invitations par email. Tolérant par construction
  // (un email invalide dans une sauvegarde ancienne est ignoré, jamais
  // un échec d'import), dédupliqué (la contrainte unique exigerait de
  // toute façon l'unicité).
  const seenCollab = new Set<string>()
  const collaborators = arr(b.collaborators, MAX.collaborators)
    .map((c) => {
      const o = c as Record<string, unknown>
      const email = typeof o.email === 'string' ? o.email.trim().toLowerCase() : ''
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email) || email.length > 120) return null
      return { email, addedAt: date(o.addedAt) }
    })
    .filter((c): c is { email: string; addedAt: Date } => {
      if (c === null) return false
      if (seenCollab.has(c.email)) return false
      seenCollab.add(c.email)
      return true
    })

  // Cohérence des références (une sauvegarde produite par l'application
  // est toujours cohérente ; un fichier altéré, lui, est refusé ici).
  for (const a of answers)
    if (!questionIds.has(a.questionId)) throw new BackupError('Réponse orpheline (question inconnue) dans le fichier.')
  for (const a of appeals)
    if (!questionIds.has(a.questionId) || !teamIds.has(a.teamId))
      throw new BackupError('Réclamation orpheline dans le fichier.')
  for (const a of appAnswers)
    if (!questionIds.has(a.questionId) || !teamIds.has(a.teamId))
      throw new BackupError('Réponse d’application orpheline dans le fichier.')
  for (const e of peerEvals)
    if (!studentIds.has(e.evaluatorId) || !studentIds.has(e.evaluatedId))
      throw new BackupError('Évaluation orpheline dans le fichier.')
  for (const r of saiResponses)
    if (!saiItemIds.has(r.itemId) || !studentIds.has(r.studentId))
      throw new BackupError('Réponse de questionnaire orpheline dans le fichier.')
  for (const s of students)
    if (s.teamId && !teamIds.has(s.teamId)) s.teamId = null
  for (const q of questions)
    if (q.caseId && !caseIds.has(q.caseId)) q.caseId = null

  // --- Écriture atomique ---
  const existing = await db.session.findUnique({ where: { code: sessionCode } })
  const sessionId = isV2 ? (sid as string) : existing ? existing.id : randomToken()
  const finalToken = isV2 ? (teacherToken as string) : existing ? existing.teacherToken : randomToken()
  const finalPin = isV2 ? (teacherPin as string) : (hashedPin as string)

  // v3.2.0 — RÉSOLUTION DU PROPRIÉTAIRE : les ids de comptes DIFFÈRENT
  // d'une instance à l'autre (locale / en ligne), l'email est l'identi-
  // fiant stable transporté par la sauvegarde.
  //  - teacherId explicite (téléversement navigateur) → il prime ;
  //  - sinon (sync machine ↔ machine) : ownerEmail du fichier résolu
  //    contre les comptes de CETTE instance → le miroir appartient au
  //    même enseignant (même email) → « Mes séances » fonctionne des
  //    deux côtés ; aucun compte correspondant → miroir sans proprié-
  //    taire (comportement antérieur : réclamation par PIN possible).
  let finalTeacherId: string | null = null
  if (typeof teacherId === 'string' && teacherId.length > 0) {
    finalTeacherId = teacherId
  } else {
    const ownerEmail =
      typeof b.session?.ownerEmail === 'string' ? b.session.ownerEmail.trim().toLowerCase() : ''
    if (ownerEmail) {
      const owner = await db.teacherAccount.findUnique({
        where: { email: ownerEmail },
        select: { id: true },
      })
      finalTeacherId = owner?.id ?? null
    }
  }

  return db.$transaction(async (tx) => {
    if (existing) {
      // Le remplacement efface tout (cascade) puis recrée avec les MÊMES
      // identifiants : jetons et réponses restent valids.
      await tx.session.delete({ where: { id: existing.id } })
    }
    const sessionRow = await tx.session.create({
      data: {
        id: sessionId,
        code: sessionCode,
        title,
        teacherPin: finalPin,
        teacherToken: finalToken,
        status,
        iratMinutes,
        // v2.9.0 : vraie date de début de phase (correctif minuteur).
        phaseStartedAt,
        revealed: false,
        feedbackReady: false,
        deletedAt: dateOrNull(b.session?.deletedAt),
        dataPurgedAt: dateOrNull(b.session?.dataPurgedAt),
        createdAt,
        pinAttempts: 0,
        // v2.9.0 : compteurs reçus + 1 → numéros strictement croissants
        // pour les clients de CETTE version (renouvellement immédiat).
        revision: incomingRevision + 1,
        revisionTeacher: incomingRevisionTeacher + 1,
        // v3.0.0 : compte propriétaire (téléversement navigateur) et
        // signalements (transportés par la synchronisation, l'adminis-
        // trateur peut les activer TBL par TBL sur l'une ou l'autre
        // version). Absent du fichier → désactivés (défaut v3.0).
        // v3.2.0 : résolution par EMAIL (voir plus haut).
        teacherId: finalTeacherId,
        reportsEnabled: b.session?.reportsEnabled === true,
      },
    })
    if (teams.length > 0)
      await tx.team.createMany({
        data: teams.map((t) => ({
          id: t.id,
          sessionId,
          name: t.name,
          number: t.number,
          appealsDone: t.appealsDone,
          updatedAt: t.updatedAt,
        })),
      })
    if (students.length > 0)
      await tx.student.createMany({
        data: students.map((s) => ({
          id: s.id,
          sessionId,
          teamId: s.teamId,
          name: s.name,
          token: s.token,
          recoveryCode: s.recoveryCode,
          saiCompletedAt: s.saiCompletedAt,
          saiComment: s.saiComment,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
      })
    if (cases.length > 0)
      await tx.case.createMany({
        data: cases.map((c) => ({
          id: c.id,
          sessionId,
          title: c.title,
          intro: c.intro,
          order: c.order,
          opened: c.opened,
          updatedAt: c.updatedAt,
        })),
      })
    if (questions.length > 0)
      await tx.question.createMany({
        data: questions.map((q) => ({
          id: q.id,
          sessionId,
          text: q.text,
          choices: q.choices,
          correct: q.correct,
          phase: q.phase,
          order: q.order,
          caseId: q.caseId,
          updatedAt: q.updatedAt,
        })),
      })
    if (answers.length > 0)
      await tx.answer.createMany({
        data: answers.map((a) => ({
          id: a.id,
          questionId: a.questionId,
          studentId: a.studentId,
          teamId: a.teamId,
          kind: a.kind,
          choice: a.choice,
          attempt: a.attempt,
          isCorrect: a.isCorrect,
          score: a.score,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
        })),
      })
    if (appeals.length > 0)
      await tx.appeal.createMany({
        data: appeals.map((a) => ({
          id: a.id,
          sessionId,
          teamId: a.teamId,
          questionId: a.questionId,
          text: a.text,
          status: a.status,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
        })),
      })
    if (appAnswers.length > 0)
      await tx.appAnswer.createMany({
        data: appAnswers.map((a) => ({
          id: a.id,
          teamId: a.teamId,
          questionId: a.questionId,
          choice: a.choice,
          text: a.text,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
        })),
      })
    if (peerEvals.length > 0)
      await tx.peerEval.createMany({
        data: peerEvals.map((e) => ({
          id: e.id,
          sessionId,
          evaluatorId: e.evaluatorId,
          evaluatedId: e.evaluatedId,
          score: e.score,
          comment: e.comment,
          createdAt: e.createdAt,
          updatedAt: e.updatedAt,
        })),
      })
    if (saiItems.length > 0)
      await tx.saiItem.createMany({
        data: saiItems.map((it) => ({
          id: it.id,
          sessionId,
          subscale: it.subscale,
          textKey: it.textKey,
          text: it.text,
          reversed: it.reversed,
          order: it.order,
          createdAt: it.createdAt,
          updatedAt: it.updatedAt,
        })),
      })
    if (saiResponses.length > 0)
      await tx.saiResponse.createMany({
        data: saiResponses.map((r) => ({
          id: r.id,
          studentId: r.studentId,
          itemId: r.itemId,
          value: r.value,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
      })
    if (alerts.length > 0)
      await tx.alertEvent.createMany({
        data: alerts.map((a) => ({
          id: a.id,
          studentId: a.studentId,
          kind: a.kind,
          phase: a.phase,
          createdAt: a.createdAt,
        })),
      })
    // v3.2.0 — invitations de partage : recréées à l'identique (email,
    // date d'ajout) — le miroir/la restauration porte le même partage.
    if (collaborators.length > 0)
      await tx.sessionCollaborator.createMany({
        data: collaborators.map((c) => ({
          sessionId,
          email: c.email,
          addedAt: c.addedAt,
        })),
      })
    return { session: sessionRow, restored: !!existing }
  })
}

// ---------------- Fusion (pull → base locale) ----------------

export interface MergeSummary {
  studentsInserted: number
  studentsUpdated: number
  answersInserted: number
  answersUpdated: number
  appealsInserted: number
  appealsUpdated: number
  appAnswersUpserted: number
  peerEvalsUpserted: number
  saiResponsesUpserted: number
  alertsInserted: number
  casesOpened: number
  teamsInserted: number
  // v3.2.0 : invitations de partage distantes ajoutées localement
  // (union par email — un retrait de partage ne se propage QUE par le
  // push miroir qui suit, jamais par le pull).
  collaboratorsInserted: number
  sessionUpdated: boolean
}

/** Horodatage effectif d'une ligne : updatedAt, à défaut createdAt. */
function eff(updatedAt: Date | null, createdAt?: Date | null): number {
  const u = updatedAt ? updatedAt.getTime() : 0
  const c = createdAt ? createdAt.getTime() : 0
  return u > 0 ? u : c
}

/**
 * Fusionne une sauvegarde v2 distante dans la base LOCALE (règles en
 * tête de fichier). Ne supprime JAMAIS de données locales : la
 * suppression éventuelle se propage uniquement par le push (miroir)
 * qui suit toujours le pull.
 */
export async function mergePullIntoLocal(session: Session, backupRaw: unknown): Promise<MergeSummary> {
  const b = backupRaw as SyncBackup
  const summary: MergeSummary = {
    studentsInserted: 0,
    studentsUpdated: 0,
    answersInserted: 0,
    answersUpdated: 0,
    appealsInserted: 0,
    appealsUpdated: 0,
    appAnswersUpserted: 0,
    peerEvalsUpserted: 0,
    saiResponsesUpserted: 0,
    alertsInserted: 0,
    casesOpened: 0,
    teamsInserted: 0,
    collaboratorsInserted: 0,
    sessionUpdated: false,
  }
  const sid = session.id

  // ---- Équipes : insertion des manquantes + OU sur appealsDone ----
  const remoteTeams = arr(b.teams, MAX.teams)
  const localTeams = await db.team.findMany({ where: { sessionId: sid } })
  const localTeamIds = new Set(localTeams.map((t) => t.id))
  for (const raw of remoteTeams) {
    const o = raw as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : ''
    if (!id || localTeamIds.has(id)) continue
    await db.team.create({
      data: {
        id,
        sessionId: sid,
        name: typeof o.name === 'string' ? o.name.slice(0, 60) : 'Équipe',
        number: typeof o.number === 'number' && o.number >= 1 ? o.number : 99,
        appealsDone: o.appealsDone === true,
      },
    })
    summary.teamsInserted += 1
    localTeamIds.add(id)
  }

  // ---- Étudiants : insertion + dernier-écrit-gagne ----
  const remoteStudents = arr(b.students, MAX.students)
  const localStudents = await db.student.findMany({ where: { sessionId: sid } })
  const byId = new Map(localStudents.map((s) => [s.id, s]))
  for (const raw of remoteStudents) {
    const o = raw as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : ''
    if (!id) continue
    const remoteUpd = dateOrNull(o.updatedAt) ?? dateOrNull(o.createdAt)
    const local = byId.get(id)
    if (!local) {
      await db.student.create({
        data: {
          id,
          sessionId: sid,
          teamId: typeof o.teamId === 'string' && localTeamIds.has(o.teamId) ? o.teamId : null,
          name: typeof o.name === 'string' ? o.name.slice(0, 40) : 'Étudiant',
          // v2 : le jeton distant est adopté (l'étudiant a basculé sur
          // l'autre instance ; l'ancien jeton local est remplacé).
          token: typeof o.token === 'string' && o.token.length >= 32 ? o.token : randomToken(),
          recoveryCode: typeof o.recoveryCode === 'string' ? o.recoveryCode : '',
          saiCompletedAt: dateOrNull(o.saiCompletedAt),
          saiComment: typeof o.saiComment === 'string' ? o.saiComment.slice(0, 1000) : null,
          createdAt: dateOrNull(o.createdAt) ?? new Date(),
        },
      })
      summary.studentsInserted += 1
    } else if (remoteUpd && remoteUpd.getTime() > eff(local.updatedAt, local.createdAt)) {
      await db.student.update({
        where: { id },
        data: {
          teamId: typeof o.teamId === 'string' && localTeamIds.has(o.teamId) ? o.teamId : local.teamId,
          name: typeof o.name === 'string' ? o.name.slice(0, 40) : local.name,
          saiCompletedAt: dateOrNull(o.saiCompletedAt) ?? local.saiCompletedAt,
          saiComment: typeof o.saiComment === 'string' ? o.saiComment.slice(0, 1000) : local.saiComment,
        },
      })
      summary.studentsUpdated += 1
    }
  }

  // ---- Réponses iRAT/tRAT : union par identifiant + LWW ----
  const remoteAnswers = arr(b.answers, MAX.answers)
  const localAnswers = await db.answer.findMany({ where: { question: { sessionId: sid } } })
  const answerById = new Map(localAnswers.map((a) => [a.id, a]))
  for (const raw of remoteAnswers) {
    const o = raw as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : ''
    const questionId = typeof o.questionId === 'string' ? o.questionId : ''
    if (!id || !questionId) continue
    const local = answerById.get(id)
    const kind = o.kind === 'trat' ? 'trat' : 'irat'
    if (!local) {
      // L'identifiant de question doit exister localement (même séance).
      const q = await db.question.findFirst({ where: { id: questionId, sessionId: sid }, select: { id: true } })
      if (!q) continue
      try {
        await db.answer.create({
          data: {
            id,
            questionId,
            studentId: kind === 'irat' && typeof o.studentId === 'string' ? o.studentId : null,
            teamId: kind === 'trat' && typeof o.teamId === 'string' ? o.teamId : null,
            kind,
            choice: Math.max(0, Math.min(5, Number(o.choice) || 0)),
            attempt: Math.max(1, Math.min(4, Number(o.attempt) || 1)),
            isCorrect: o.isCorrect === true,
            score: Math.max(0, Math.min(4, Number(o.score) || 0)),
            createdAt: dateOrNull(o.createdAt) ?? new Date(),
          },
        })
        summary.answersInserted += 1
      } catch {
        // Ligne déjà présente (course avec le sondage) : ignorée, aucun doublon.
      }
    } else {
      const remoteUpd = dateOrNull(o.updatedAt) ?? dateOrNull(o.createdAt)
      if (remoteUpd && remoteUpd.getTime() > eff(local.updatedAt, local.createdAt)) {
        await db.answer.update({
          where: { id },
          data: {
            isCorrect: o.isCorrect === true,
            score: Math.max(0, Math.min(4, Number(o.score) || 0)),
          },
        })
        summary.answersUpdated += 1
      }
    }
  }

  // ---- Réclamations : insertion + LWW (décision enseignant) ----
  const remoteAppeals = arr(b.appeals, MAX.appeals)
  const localAppeals = await db.appeal.findMany({ where: { sessionId: sid } })
  const appealById = new Map(localAppeals.map((a) => [a.id, a]))
  for (const raw of remoteAppeals) {
    const o = raw as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : ''
    if (!id) continue
    const local = appealById.get(id)
    if (!local) {
      try {
        await db.appeal.create({
          data: {
            id,
            sessionId: sid,
            teamId: typeof o.teamId === 'string' ? o.teamId : '',
            questionId: typeof o.questionId === 'string' ? o.questionId : '',
            text: typeof o.text === 'string' ? o.text.slice(0, 2000) : '',
            status: o.status === 'accepted' ? 'accepted' : o.status === 'rejected' ? 'rejected' : 'pending',
            createdAt: dateOrNull(o.createdAt) ?? new Date(),
          },
        })
        summary.appealsInserted += 1
      } catch {
        // déjà présente : ignorée
      }
    } else {
      const remoteUpd = dateOrNull(o.updatedAt) ?? dateOrNull(o.createdAt)
      if (remoteUpd && remoteUpd.getTime() > eff(local.updatedAt, local.createdAt)) {
        await db.appeal.update({
          where: { id },
          data: {
            status: o.status === 'accepted' ? 'accepted' : o.status === 'rejected' ? 'rejected' : local.status,
          },
        })
        summary.appealsUpdated += 1
      }
    }
  }

  // ---- Réponses d'application / pairs / questionnaire : LWW ----
  const upsertLww = async (
    remote: unknown[],
    table: 'appAnswer' | 'peerEval' | 'saiResponse',
    countKey: 'appAnswersUpserted' | 'peerEvalsUpserted' | 'saiResponsesUpserted'
  ) => {
    for (const raw of remote) {
      const o = raw as Record<string, unknown>
      const id = typeof o.id === 'string' ? o.id : ''
      if (!id) continue
      const remoteUpd = dateOrNull(o.updatedAt)
      try {
        if (table === 'appAnswer') {
          const existing = await db.appAnswer.findUnique({ where: { id } })
          if (!existing) {
            await db.appAnswer.create({
              data: {
                id,
                teamId: typeof o.teamId === 'string' ? o.teamId : '',
                questionId: typeof o.questionId === 'string' ? o.questionId : '',
                choice: Math.max(0, Math.min(5, Number(o.choice) || 0)),
                text: typeof o.text === 'string' ? o.text.slice(0, 2000) : null,
                createdAt: dateOrNull(o.createdAt) ?? new Date(),
              },
            })
            summary[countKey] = (summary[countKey] as number) + 1
          } else if (remoteUpd && remoteUpd.getTime() > eff(existing.updatedAt, existing.createdAt)) {
            await db.appAnswer.update({
              where: { id },
              data: {
                choice: Math.max(0, Math.min(5, Number(o.choice) || 0)),
                text: typeof o.text === 'string' ? o.text.slice(0, 2000) : existing.text,
              },
            })
            summary[countKey] = (summary[countKey] as number) + 1
          }
        } else if (table === 'peerEval') {
          const existing = await db.peerEval.findUnique({ where: { id } })
          const data = {
            score: Math.max(1, Math.min(5, Number(o.score) || 1)),
            comment: typeof o.comment === 'string' ? o.comment.slice(0, 1000) : null,
          }
          if (!existing) {
            await db.peerEval.create({
              data: {
                id,
                sessionId: sid,
                evaluatorId: typeof o.evaluatorId === 'string' ? o.evaluatorId : '',
                evaluatedId: typeof o.evaluatedId === 'string' ? o.evaluatedId : '',
                score: data.score,
                comment: data.comment,
                createdAt: dateOrNull(o.createdAt) ?? new Date(),
              },
            })
            summary[countKey] = (summary[countKey] as number) + 1
          } else if (remoteUpd && remoteUpd.getTime() > eff(existing.updatedAt, existing.createdAt)) {
            await db.peerEval.update({ where: { id }, data })
            summary[countKey] = (summary[countKey] as number) + 1
          }
        } else {
          const existing = await db.saiResponse.findUnique({ where: { id } })
          const value = Math.max(1, Math.min(5, Number(o.value) || 1))
          if (!existing) {
            await db.saiResponse.create({
              data: {
                id,
                studentId: typeof o.studentId === 'string' ? o.studentId : '',
                itemId: typeof o.itemId === 'string' ? o.itemId : '',
                value,
                createdAt: dateOrNull(o.createdAt) ?? new Date(),
              },
            })
            summary[countKey] = (summary[countKey] as number) + 1
          } else if (remoteUpd && remoteUpd.getTime() > eff(existing.updatedAt, existing.createdAt)) {
            await db.saiResponse.update({ where: { id }, data: { value } })
            summary[countKey] = (summary[countKey] as number) + 1
          }
        }
      } catch {
        // ligne déjà présente (concurrence) : ignorée, aucun doublon
      }
    }
  }
  await upsertLww(arr(b.appAnswers, MAX.appAnswers), 'appAnswer', 'appAnswersUpserted')
  await upsertLww(arr(b.peerEvals, MAX.peerEvals), 'peerEval', 'peerEvalsUpserted')
  await upsertLww(arr(b.saiResponses, MAX.saiResponses), 'saiResponse', 'saiResponsesUpserted')

  // ---- Signalements : union (insert-only) ----
  // v2.8.2 : existence vérifiée AVANT l'insertion. Le miroir distant
  // renvoie les signalements déjà fusionnés aux cycles suivants : on
  // les ignore SANS déclencher d'erreur Prisma (avant, chaque cycle
  // de synchronisation imprimait « Unique constraint failed (id) /
  // prisma:error … alertEvent.create() » dans la console locale —
  // inquiétant pour l'enseignante alors que les données étaient
  // correctes : aucun signalement n'a jamais été dupliqué ni perdu).
  for (const raw of arr(b.alerts, MAX.alerts)) {
    const o = raw as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : ''
    if (!id || typeof o.studentId !== 'string') continue
    const existing = await db.alertEvent.findUnique({ where: { id }, select: { id: true } })
    if (existing) continue
    try {
      await db.alertEvent.create({
        data: {
          id,
          studentId: o.studentId,
          kind: o.kind === 'screenshot' ? 'screenshot' : 'tab_hidden',
          phase: typeof o.phase === 'string' ? o.phase.slice(0, 20) : null,
          createdAt: dateOrNull(o.createdAt) ?? new Date(),
        },
      })
      summary.alertsInserted += 1
    } catch {
      // concurrence résiduelle : ignorée (aucun doublon)
    }
  }

  // ---- Partage (v3.2.0) : union par email, INSERT-ONLY ----
  // Une invitation distante qui n'existe pas localement est ajoutée
  // (le collègue invité sur l'autre instance voit la séance ici aussi).
  // Un RETRAIT de partage ne se propage PAS par le pull (la fusion ne
  // supprime jamais) : il se propage par le push miroir qui suit le
  // pull — comportement identique aux autres données.
  for (const raw of arr(b.collaborators, MAX.collaborators)) {
    const o = raw as Record<string, unknown>
    const email = typeof o.email === 'string' ? o.email.trim().toLowerCase() : ''
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email) || email.length > 120) continue
    const existing = await db.sessionCollaborator.findUnique({
      where: { sessionId_email: { sessionId: sid, email } },
      select: { id: true },
    })
    if (existing) continue
    try {
      await db.sessionCollaborator.create({
        data: { sessionId: sid, email, addedAt: dateOrNull(o.addedAt) ?? new Date() },
      })
      summary.collaboratorsInserted += 1
    } catch {
      // concurrence résiduelle : ignorée (aucun doublon)
    }
  }

  // ---- Cas cliniques (v2.8.2) : UN seul cas ouvert à la fois ----
  // L'enseignant est seul pilote : l'état d'ouverture vit sur
  // l'ordinateur maître. La fusion adopte l'état d'ouverture DISTANT
  // uniquement s'il est PLUS RÉCENT (dernier updatedAt touché) que le
  // dernier changement local — sinon elle ne touche à rien : le miroir
  // renvoyé par un cycle précédent ne rouvre pas un cas refermé
  // localement (l'ancienne « OU logique » rouvrait le cas N-1 au
  // cycle suivant). Dans le sens maître → miroir, l'état poussé est
  // toujours le plus récent : rien ne change.
  const localCases = await db.case.findMany({ where: { sessionId: sid } })
  const localCaseIds = new Set(localCases.map((c) => c.id))
  const localNewest = localCases.reduce(
    (m, c) => Math.max(m, c.updatedAt ? c.updatedAt.getTime() : 0),
    0
  )
  const remoteCases: { id: string; opened: boolean; at: number }[] = []
  for (const raw of arr(b.cases, MAX.cases)) {
    const o = raw as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : ''
    if (!id || !localCaseIds.has(id)) continue
    const u = dateOrNull(o.updatedAt)
    remoteCases.push({ id, opened: o.opened === true, at: u ? u.getTime() : 0 })
  }
  const remoteNewest = remoteCases.reduce((m, c) => Math.max(m, c.at), 0)
  if (remoteNewest > localNewest) {
    for (const rc of remoteCases) {
      const local = localCases.find((c) => c.id === rc.id)
      if (local && local.opened !== rc.opened) {
        await db.case.update({
          where: { id: rc.id },
          data: { opened: rc.opened, updatedAt: new Date(rc.at) },
        })
        if (rc.opened) summary.casesOpened += 1
      }
    }
  }

  // ---- Paramètres de la séance ----
  const s = b.session
  const data: Record<string, unknown> = {}
  // Statut : uniquement en AVANT dans le déroulé et changement plus récent.
  const remoteStatus =
    typeof s?.status === 'string' && (PHASE_ORDER as string[]).includes(s.status) ? s.status : null
  if (remoteStatus) {
    const localIdx = (PHASE_ORDER as string[]).indexOf(session.status)
    const remoteIdx = (PHASE_ORDER as string[]).indexOf(remoteStatus)
    const remoteStarted = dateOrNull(s.phaseStartedAt)
    if (
      remoteIdx > localIdx &&
      remoteStarted &&
      remoteStarted.getTime() > session.phaseStartedAt.getTime()
    ) {
      data.status = remoteStatus
      data.phaseStartedAt = remoteStarted
    }
  }
  // Ouvertures : OU logique.
  if (session.feedbackReady === false && s?.feedbackReady === true) data.feedbackReady = true
  // Titre / durée : dernier écrit gagne (enseignant, des deux côtés).
  const remoteUpdated = dateOrNull(b.exportedAt)
  const localSessionEff = eff(session.updatedAt, session.createdAt)
  // v3.0.0 — Signalements par TBL : dernier écrit gagne (comme le titre
  // et la durée). Uniquement si le fichier DISTANT transporte explicitement
  // le réglage (les versions antérieures à la v3.0 ne le transportent pas :
  // leur fusion ne doit jamais désactiver ce qu'on a activé ici).
  if (
    typeof s?.reportsEnabled === 'boolean' &&
    s.reportsEnabled !== session.reportsEnabled &&
    remoteUpdated &&
    remoteUpdated.getTime() > localSessionEff
  ) {
    data.reportsEnabled = s.reportsEnabled
  }
  if (remoteUpdated && remoteUpdated.getTime() > localSessionEff) {
    if (typeof s?.title === 'string' && s.title.length >= 1 && s.title.length <= 120 && s.title !== session.title)
      data.title = s.title
    if (typeof s?.iratMinutes === 'number' && Number.isInteger(s.iratMinutes) && s.iratMinutes >= 1 && s.iratMinutes <= 90 && s.iratMinutes !== session.iratMinutes)
      data.iratMinutes = s.iratMinutes
  }
  if (Object.keys(data).length > 0) {
    await db.session.update({ where: { id: sid }, data })
    summary.sessionUpdated = true
  }
  // v2.9.0 : la fusion a écrit (ou non) dans la base locale — les
  // compteurs du sondage allégé suivent. Une contribution distante
  // doit être vue par le tableau de bord local ET par les étudiants
  // locaux (réponses d'équipes connectées à l'autre version).
  const wroteSomething =
    summary.teamsInserted > 0 ||
    summary.studentsInserted > 0 ||
    summary.studentsUpdated > 0 ||
    summary.answersInserted > 0 ||
    summary.answersUpdated > 0 ||
    summary.appealsInserted > 0 ||
    summary.appealsUpdated > 0 ||
    summary.appAnswersUpserted > 0 ||
    summary.peerEvalsUpserted > 0 ||
    summary.saiResponsesUpserted > 0 ||
    summary.alertsInserted > 0 ||
    summary.casesOpened > 0 ||
    summary.sessionUpdated
  if (wroteSomething) {
    await db.session.update({
      where: { id: sid },
      data: { revision: { increment: 1 }, revisionTeacher: { increment: 1 } },
    })
  }
  return summary
}

// ---------------- Orchestration (tirer → fusionner → pousser) ----------------

/** Normalise l'adresse de la version en ligne saisie par l'enseignant. */
export function normalizeRemoteUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null
  let url = input.trim()
  if (!url) return null
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  try {
    const u = new URL(url)
    u.hash = ''
    u.search = ''
    u.pathname = u.pathname.replace(/\/+$/, '')
    return u.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

export interface SyncResult {
  ok: true
  pulled: MergeSummary | null
  pushed: true
  /** v2.9.0 : true si l'état local n'avait pas changé depuis le
   *  précédent push — le miroir a été laissé tel quel (aucun envoi
   *  inutile, la charge de la version en ligne reste minuscule). */
  skipped?: boolean
  /** v3.0.0 : true si la version en ligne n'avait RIEN changé depuis
   *  le précédent tirage — la réponse « rien n'a changé » minuscule a
   *  remplacé le snapshot complet (tirage delta). */
  pullSkipped?: boolean
  at: string
}

export class SyncError extends Error {
  constructor(message: string) {
    super(message)
  }
}

const FETCH_TIMEOUT_MS = 60_000

// v2.9.0 — Mémoire du dernier push réussi (par code de séance) : le
// miroir distant n'est réenvoyé QUE si l'état local a changé depuis
// (nouvelle réponse, phase tournée, question modifiée…) ou si le
// tirage a fusionné des contributions distantes. Entre deux actions,
// le cycle se limite au tirage (une requête légère) : la version en
// ligne ne reçoit plus un miroir complet toutes les 5 secondes pour
// rien — sa charge et celle de sa base restent minuscules, même avec
// une synchronisation très fréquente.
const lastPushState = new Map<string, { rev: number; revT: number }>()

// v3.0.0 — Mémoire du dernier TIRAGE réussi (par code de séance) : le
// cycle envoie au serveur distant les numéros qu'il connaît déjà ; si
// rien n'a changé de l'autre côté, la réponse est une ligne minuscule
// « rien n'a changé » (aucune construction de sauvegarde, aucun merge,
// quelques octets au lieu du snapshot complet). C'est le mode hybride
// DELTA : le snapshot complet ne circule que lorsqu'une donnée a
// réellement changé (réponse, phase, équipe…).
const lastPullState = new Map<string, { rev: number; revT: number }>()

/**
 * Synchronisation complète d'une séance avec la version en ligne :
 *  1. TIRER l'état distant (échec propre si la séance n'existe pas
 *     encore en ligne : on la créera par le push) ;
 *  2. FUSIONNER les contributions distantes dans la base locale ;
 *  3. POUSSER l'état local complet (miroir exact, mêmes identifiants)
 *     — uniquement s'il a changé depuis le précédent push.
 * Aucune donnée n'est jamais perdue localement : une panne de réseau
 * interrompt la synchronisation, jamais la séance.
 */
export async function syncNow(session: Session, remoteUrl: string): Promise<SyncResult> {
  const base = normalizeRemoteUrl(remoteUrl)
  if (!base) throw new SyncError('Adresse de la version en ligne invalide.')
  const url = (p: string) => `${base}${p}`

  // 1. Tirer — v3.0.0 TIRAGE DELTA : on transmet les numéros de révision
  // déjà connus ; si la version en ligne porte ENCORE ces numéros, elle
  // répond « rien n'a changé » (quelques octets, aucune construction de
  // sauvegarde) : le merge est intégralement sauté. Au moindre changement
  // distant (réponse d'un étudiant en ligne, phase tournée là-bas…), le
  // snapshot complet arrive et la fusion s'exécute comme avant.
  let pulled: MergeSummary | null = null
  let pullSkipped = false
  const lastPull = lastPullState.get(session.code)
  try {
    const res = await fetch(url(`/api/sessions/${session.code}/manage`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: session.teacherToken,
        action: 'export_sync',
        ...(lastPull ? { rev: lastPull.rev, revT: lastPull.revT } : {}),
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (res.status === 404) {
      // La séance n'existe pas encore en ligne : elle sera créée par le push.
      pulled = null
    } else if (res.ok) {
      const data = (await res.json()) as
        | { unchanged?: boolean; revision?: number; revisionTeacher?: number }
        | SyncBackup
      if (
        data &&
        (data as { unchanged?: boolean }).unchanged === true &&
        typeof (data as { revision?: number }).revision === 'number'
      ) {
        // Rien n'a changé en ligne : numéros confirmés, aucun merge.
        pullSkipped = true
        lastPullState.set(session.code, {
          rev: (data as { revision: number }).revision,
          revT: (data as { revisionTeacher: number }).revisionTeacher,
        })
      } else {
        const backup = data as SyncBackup
        pulled = await mergePullIntoLocal(session, backup)
        const after = await db.session.findUnique({
          where: { id: session.id },
          select: { revision: true, revisionTeacher: true },
        })
        if (after) {
          lastPullState.set(session.code, { rev: after.revision, revT: after.revisionTeacher })
        }
      }
    } else if (res.status === 401) {
      throw new SyncError(
        'La séance en ligne existe mais ne correspond pas à cette séance (jetons différents). Utilisez plutôt « Téléverser la séance » pour la recréer.'
      )
    } else {
      throw new SyncError(`La version en ligne a répondu par une erreur (${res.status}).`)
    }
  } catch (e) {
    if (e instanceof SyncError) throw e
    throw new SyncError(
      'Impossible de joindre la version en ligne. Vérifiez l’adresse et la connexion Internet, puis réessayez.'
    )
  }

  // v2.9.0 — État local (re)lu APRÈS la fusion : les compteurs de
  // révision résument tout ce qui a changé localement.
  const fresh = await db.session.findUnique({
    where: { id: session.id },
    select: { revision: true, revisionTeacher: true },
  })
  if (!fresh) throw new SyncError('La séance locale a disparu (suppression définitive ?).')
  const last = lastPushState.get(session.code)
  const localChanged = !last || last.rev !== fresh.revision || last.revT !== fresh.revisionTeacher
  const pulledSomething =
    !!pulled &&
    (pulled.answersInserted + pulled.answersUpdated + pulled.appealsInserted +
      pulled.appealsUpdated + pulled.appAnswersUpserted + pulled.peerEvalsUpserted +
      pulled.saiResponsesUpserted + pulled.studentsInserted + pulled.studentsUpdated +
      pulled.alertsInserted + pulled.casesOpened + pulled.teamsInserted) > 0

  // 2+3. Pousser l'état local complet (fusionné) — miroir exact.
  // Rien n'a bougé nulle part depuis le précédent push : on s'abstient
  // (le tirage suffit, le miroir distant est déjà exact).
  if (!localChanged && !pulledSomething && last) {
    return {
      ok: true,
      pulled,
      pushed: true,
      skipped: true,
      pullSkipped,
      at: new Date().toISOString(),
    }
  }
  const backup = await buildSyncBackup(session)
  try {
    const res = await fetch(url('/api/sessions/import'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backup }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      throw new SyncError(body?.error ?? `La synchronisation a été refusée par la version en ligne (${res.status}).`)
    }
    // v3.0.0 — le miroir renvoie ses nouveaux compteurs : on les
    // mémorise comme « déjà tirés » → le prochain cycle ne re-tirera
    // PAS le snapshot qu'on vient de pousser (tirage delta).
    const imported = (await res.json().catch(() => null)) as {
      revision?: number
      revisionTeacher?: number
    } | null
    if (imported && typeof imported.revision === 'number') {
      lastPullState.set(session.code, {
        rev: imported.revision,
        revT: typeof imported.revisionTeacher === 'number' ? imported.revisionTeacher : 0,
      })
    }
  } catch (e) {
    if (e instanceof SyncError) throw e
    throw new SyncError(
      'L’envoi vers la version en ligne a échoué. La séance locale est intacte — réessayez plus tard (ou à la fin de la séance).'
    )
  }
  lastPushState.set(session.code, { rev: fresh.revision, revT: fresh.revisionTeacher })

  const now = new Date()
  await db.session.update({ where: { id: session.id }, data: { syncedAt: now } })
  return { ok: true, pulled, pushed: true, at: now.toISOString() }
}
