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
  }
  questions: QuestionDTO[]
  teams: { id: string; name: string; number: number }[]
  students: { id: string; name: string; teamId: string | null }[]
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
  me: { id: string; name: string; team: { id: string; name: string } | null }
  teamMembers: { id: string; name: string }[]
  questions: QuestionDTO[]
  applicationQuestions: QuestionDTO[]
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
}

export interface DraftQuestion {
  text: string
  choices: string[]
  correct: number
  phase: QuestionPhase
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
      'Les équipes peuvent contester une réponse avec une justification. Examinez chaque réclamation puis acceptez ou refusez.',
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
    label: 'Exercices d\u2019application',
    short: 'Application',
    teacherHint:
      'Toutes les équipes travaillent le même problème et choisissent une réponse. Révélez les réponses simultanément pour lancer le débat.',
    studentHint: 'Travaillez le problème en équipe et choisissez une réponse.',
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
