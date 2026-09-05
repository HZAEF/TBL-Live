// Types partagés entre le client et le serveur pour TBL Live

export type Phase =
  | 'lobby'
  | 'irat'
  | 'trat'
  | 'appeal'
  | 'feedback'
  | 'application'
  | 'peer'
  | 'finished'

export type QuestionPhase = 'rat' | 'application'

export interface QuestionDTO {
  id: string
  text: string
  choices: string[]
  correct?: number
  phase: QuestionPhase
  order?: number
  /** Cas clinique d'application (null = question RAT ou ancien format) */
  caseId?: string | null
}

export interface CaseDTO {
  id: string
  title: string
  intro: string | null
  order: number
}

export interface PublicSessionDTO {
  code: string
  title: string
  status: Phase
  teams: { id: string; name: string }[]
  studentCount: number
}

export interface DashboardDTO {
  session: {
    id: string
    code: string
    title: string
    status: Phase
    iratMinutes: number
    phaseStartedAt: string
    revealed: boolean
    createdAt: string
    /** Corbeille : date de mise à la corbeille (null = séance active).
     * Restaurable pendant 48 h, suppression définitive au-delà. */
    deletedAt: string | null
    /** Date de purge automatique des données étudiantes (rétention 4 mois,
     * null = données encore présentes). QCM et cas cliniques conservés. */
    dataPurgedAt: string | null
  }
  questions: QuestionDTO[]
  cases: CaseDTO[]
  teams: { id: string; name: string; number: number; appealsDone: boolean }[]
  students: {
    id: string
    name: string
    teamId: string | null
    /** Code de reprise personnel — l'enseignant peut le redonner à un étudiant qui l'a perdu */
    recoveryCode: string
  }[]
  iratAnswers: {
    questionId: string
    studentId: string
    choice: number
    isCorrect: boolean
    score: number
  }[]
  tratAnswers: {
    questionId: string
    teamId: string
    choice: number
    attempt: number
    isCorrect: boolean
    score: number
  }[]
  appeals: {
    id: string
    teamId: string
    questionId: string
    text: string
    status: string
    createdAt: string
  }[]
  appAnswers: { teamId: string; questionId: string; choice: number; text: string | null }[]
  peerEvals: { evaluatorId: string; evaluatedId: string; score: number; comment: string | null }[]
}

export interface StudentStateDTO {
  session: {
    code: string
    title: string
    status: Phase
    phaseStartedAt: string
    iratMinutes: number
    revealed: boolean
  }
  me: {
    id: string
    name: string
    /** Code de reprise personnel (pour retrouver sa séance sur un autre appareil) */
    recoveryCode: string
    team: { id: string; name: string } | null
  }
  teamMembers: { id: string; name: string }[]
  questions: QuestionDTO[]
  applicationQuestions: QuestionDTO[]
  /** Cas cliniques d'application (phase application et fin de séance) */
  appCases?: CaseDTO[]
  /** Questions d'application dont les réponses sont révélées (auto ou forcée) */
  revealedAppQuestionIds?: string[]
  /** Phase application : progression des équipes par question (x/y ont répondu) */
  appAnswerProgress?: { questionId: string; answered: number; total: number }[]
  /** Phase réclamations : mon équipe a-t-elle signalé qu'elle n'a (plus) de réclamation ? */
  myTeamAppealsDone?: boolean
  /** Phase réclamations : progression des équipes (bouton « pas de réclamation ») */
  appealsProgress?: { done: number; total: number }
  myIratAnswers: { questionId: string; choice: number; isCorrect?: boolean; score?: number }[]
  teamTratAnswers: {
    questionId: string
    choice: number
    attempt: number
    isCorrect: boolean
    score: number
  }[]
  myAppeals: { questionId: string; text: string; status: string }[]
  teamAppAnswers: { questionId: string; choice: number; text: string | null }[]
  iratStats?: { questionId: string; percent: number }[]
  allTeamAppAnswers?: { teamName: string; questionId: string; choice: number; text: string | null }[]
  myPeerEvals?: { evaluatedId: string; score: number; comment: string | null }[]
  /** Moyenne des évaluations reçues de mes coéquipiers (sur 5) — en fin de séance */
  myPeerReceived?: { avg: number; count: number } | null
}

export interface DraftQuestion {
  text: string
  choices: string[]
  correct: number
  phase: QuestionPhase
}

/** Brouillon d'un cas clinique d'application (formulaire de création) */
export interface DraftCase {
  title: string
  intro: string
  questions: DraftQuestion[]
}

// ---------------------------------------------------------------
// Révélation automatique des réponses d'application :
// une question est révélée dès que TOUTES les équipes actives
// (équipes comptant au moins un étudiant) y ont répondu,
// ou immédiatement si l'enseignant force la révélation.
// ---------------------------------------------------------------
export function computeRevealedAppQuestionIds(input: {
  appQuestionIds: string[]
  /** ids des équipes actives (au moins 1 étudiant) */
  activeTeamIds: string[]
  appAnswers: { teamId: string; questionId: string }[]
  forcedReveal: boolean
}): string[] {
  if (input.forcedReveal) return [...input.appQuestionIds]
  if (input.activeTeamIds.length === 0) return []
  const answered = new Map<string, Set<string>>()
  for (const a of input.appAnswers) {
    if (!answered.has(a.questionId)) answered.set(a.questionId, new Set())
    answered.get(a.questionId)!.add(a.teamId)
  }
  return input.appQuestionIds.filter((qid) => {
    const teams = answered.get(qid)
    return !!teams && input.activeTeamIds.every((tid) => teams.has(tid))
  })
}

export const PHASE_ORDER: Phase[] = [
  'lobby',
  'irat',
  'trat',
  'appeal',
  'feedback',
  'application',
  'peer',
  'finished',
]

export const PHASE_INFO: Record<
  Phase,
  { label: string; short: string; teacherHint: string; studentHint: string }
> = {
  lobby: {
    label: 'Accueil — inscription des étudiants',
    short: 'Accueil',
    teacherHint:
      'Affichez le code de la séance : les étudiants le saisissent sur leur téléphone et rejoignent leur équipe.',
    studentHint: 'Bienvenue ! Attendez les instructions de votre professeur.',
  },
  irat: {
    label: 'Test individuel (iRAT)',
    short: 'iRAT',
    teacherHint:
      'Chaque étudiant répond seul·e aux questions de préparation. Surveillez la progression en direct.',
    studentHint: 'Répondez individuellement, sans aide extérieure.',
  },
  trat: {
    label: 'Test en équipe (tRAT)',
    short: 'tRAT',
    teacherHint:
      'Une seule réponse par équipe : les membres discutent puis valident ensemble. Feedback immédiat comme sur une carte à gratter (4 / 2 / 1 / 0 point).',
    studentHint: 'Discutez en équipe puis validez une réponse commune.',
  },
  appeal: {
    label: 'Réclamations (appels)',
    short: 'Réclamations',
    teacherHint:
      'Les équipes peuvent contester une réponse avec une justification. La phase passe automatiquement au feedback dès que toutes les équipes ont cliqué sur « Nous n\u2019avons pas de réclamation » (ou envoyé leurs réclamations puis clôturé). Vous pouvez aussi avancer manuellement.',
    studentHint: 'Votre équipe peut contester une réponse jugée ambiguë.',
  },
  feedback: {
    label: 'Feedback du professeur',
    short: 'Feedback',
    teacherHint:
      'Commentez les résultats avec la classe : concentrez votre mini-cours sur les questions les moins réussies.',
    studentHint: 'Écoutez les explications de votre professeur.',
  },
  application: {
    label: 'Cas cliniques d\u2019application',
    short: 'Application',
    teacherHint:
      'Les équipes travaillent les cas cliniques un par un (3 à 5 QCU par cas). Les réponses de chaque question sont révélées automatiquement dès que toutes les équipes y ont répondu — vous pouvez aussi forcer la révélation.',
    studentHint: 'Travaillez chaque cas clinique en équipe et choisissez vos réponses.',
  },
  peer: {
    label: 'Évaluation par les pairs',
    short: 'Pairs',
    teacherHint:
      'Chaque étudiant note la contribution de ses coéquipiers. Vous verrez les moyennes et les commentaires.',
    studentHint: 'Notez la contribution de chacun de vos coéquipiers.',
  },
  finished: {
    label: 'Séance terminée',
    short: 'Terminé',
    teacherHint: 'La séance est terminée. Exportez les résultats en CSV si besoin.',
    studentHint: 'La séance est terminée. Merci pour votre participation !',
  },
}

export function nextPhase(p: Phase): Phase | null {
  const i = PHASE_ORDER.indexOf(p)
  if (i < 0 || i >= PHASE_ORDER.length - 1) return null
  return PHASE_ORDER[i + 1]
}

export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

/** Suggestion de PIN robuste (côté navigateur, alphabet sans caractères
 * ambigus : pas de O/0 ni I/1) — l'enseignant peut la garder ou la modifier.
 * Utilisée à la création d'une séance et à la duplication. */
export function suggestPin(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}
