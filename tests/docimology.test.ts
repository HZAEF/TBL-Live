// ============================================================
// TBL Live — Tests unitaires des statistiques docimologiques
// (src/lib/docimology.ts). Exécution : npm test (vitest).
//
// Jeu de données entièrement calculé à la main :
//  - iRAT : 8 étudiants × 4 questions (bonne réponse = B)
//  - tRAT : 4 équipes × 4 questions (IF-AT 4/2/1/0)
//  - Application : 2 cas cliniques × 3 questions, 4 équipes
// Les valeurs attendues (p, D, r pbs, alpha, SEM…) sont vérifiées
// par assertions numériques. Une erreur silencieuse dans ces
// calculs serait invisible à l'écran : ces tests la rendent
// impossible à manquer.
// ============================================================

import { describe, expect, it } from 'vitest'
import {
  buildIratSection,
  buildTratSection,
  buildApplicationSection,
  analyzeSection,
  buildComparison,
  flagQuestions,
} from '../src/lib/docimology'
import type { DashboardDTO } from '../src/lib/tbl-types'

// ---------- Construction du jeu de données ----------
// Q1-Q3 : 4 choix (A-D) ; Q4 : 3 choix (A-C) pour que les mauvaises
// réponses couvrent tous les distracteurs (sinon « jamais choisi »)
const RQ = (i: number, correct = 1, nChoices = 4) => ({
  id: `rat${i}`,
  text: `Question RAT ${i}`,
  choices: ['Choix A', 'Choix B', 'Choix C', 'Choix D'].slice(0, nChoices),
  correct,
  phase: 'rat' as const,
  order: i,
  caseId: null,
})

const questions = [
  RQ(1), RQ(2), RQ(3), RQ(4, 1, 3),
  // application — cas 1 (correct = A)
  { id: 'a1c1', text: 'App 1 Q1', choices: ['A', 'B', 'C'], correct: 0, phase: 'application' as const, order: 0, caseId: 'case1' },
  { id: 'a1c2', text: 'App 1 Q2', choices: ['A', 'B', 'C'], correct: 0, phase: 'application' as const, order: 1, caseId: 'case1' },
  { id: 'a1c3', text: 'App 1 Q3', choices: ['A', 'B', 'C'], correct: 0, phase: 'application' as const, order: 2, caseId: 'case1' },
  // application — cas 2 (correct = A)
  { id: 'a2c1', text: 'App 2 Q1', choices: ['A', 'B', 'C'], correct: 0, phase: 'application' as const, order: 0, caseId: 'case2' },
  { id: 'a2c2', text: 'App 2 Q2', choices: ['A', 'B', 'C'], correct: 0, phase: 'application' as const, order: 1, caseId: 'case2' },
  { id: 'a2c3', text: 'App 2 Q3', choices: ['A', 'B', 'C'], correct: 0, phase: 'application' as const, order: 2, caseId: 'case2' },
]

const students = [
  { id: 's1', name: 'Alice', teamId: 't1', recoveryCode: '' },
  { id: 's2', name: 'Bob', teamId: 't1', recoveryCode: '' },
  { id: 's3', name: 'Chloé', teamId: 't2', recoveryCode: '' },
  { id: 's4', name: 'David', teamId: 't2', recoveryCode: '' },
  { id: 's5', name: 'Emma', teamId: 't3', recoveryCode: '' },
  { id: 's6', name: 'Farid', teamId: 't3', recoveryCode: '' },
  { id: 's7', name: 'Grace', teamId: 't4', recoveryCode: '' },
  { id: 's8', name: 'Hugo', teamId: 't4', recoveryCode: '' },
]

const teams = [
  { id: 't1', name: 'Équipe 1', number: 1, appealsDone: true },
  { id: 't2', name: 'Équipe 2', number: 2, appealsDone: true },
  { id: 't3', name: 'Équipe 3', number: 3, appealsDone: true },
  { id: 't4', name: 'Équipe 4', number: 4, appealsDone: true },
]

// iRAT : bonne réponse = B (index 1). Mauvaises réponses réparties
// sur A, C, D pour couvrir tous les distracteurs.
//        Q1    Q2    Q3    Q4      total
// Alice  B     B     B     B        4
// Bob    B     B     B     B        4
// Chloé  B     B     A     B        3
// David  B     A     B     B        3
// Emma   C     B     B     B        3
// Farid  B     C     C     B        2
// Grace  D     D     B     A        1
// Hugo   A     A     D     C        0
const iratGrid: [string, number[]][] = [
  ['s1', [1, 1, 1, 1]],
  ['s2', [1, 1, 1, 1]],
  ['s3', [1, 1, 0, 1]],
  ['s4', [1, 0, 1, 1]],
  ['s5', [2, 1, 1, 1]],
  ['s6', [1, 2, 2, 1]],
  ['s7', [3, 3, 1, 0]],
  ['s8', [0, 0, 3, 2]],
]
const iratAnswers = iratGrid.flatMap(([studentId, choices]) =>
  choices.map((choice, qi) => ({
    questionId: `rat${qi + 1}`,
    studentId,
    choice,
    isCorrect: choice === 1,
    score: choice === 1 ? 1 : 0,
  }))
)

// tRAT (IF-AT) : [tentatives] par question — bonne réponse = B
// T1 : tout juste au 1er essai → 16 pts
// T2 : Q1 2 essais (2 pts), Q2 1er (4), Q3 3 essais (1), Q4 1er (4) → 11
// T3 : Q1 1er (4), Q2 2 essais (2), Q3 échec après 3 essais (0), Q4 1er (4) → 10
// T4 : Q1 2 essais (2), Q2 échec 3 essais (0), Q3 échec (0), Q4 2 essais (2) → 4
const tratGrid: [string, number[][]][] = [
  ['t1', [[1], [1], [1], [1]]],
  ['t2', [[0, 1], [1], [0, 2, 1], [1]]],
  ['t3', [[1], [0, 1], [0, 2, 3], [1]]],
  ['t4', [[0, 1], [0, 2, 3], [0, 2, 3], [0, 1]]],
]
const IFAT_POINTS = [4, 2, 1, 0] // index = tentative − 1 (1ᵉʳ essai 4 pts, 2ᵉ 2 pts, 3ᵉ 1 pt)
const tratAnswers = tratGrid.flatMap(([teamId, perQ]) =>
  perQ.flatMap((atts, qi) =>
    atts.map((choice, ai) => {
      const attempt = ai + 1
      const isCorrect = choice === 1
      const score = isCorrect ? IFAT_POINTS[attempt - 1] : 0
      return { questionId: `rat${qi + 1}`, teamId, choice, attempt, isCorrect, score }
    })
  )
)

// Application : bonne réponse = A (index 0)
//        C1Q1 C1Q2 C1Q3 | C2Q1 C2Q2 C2Q3
// T1      A    A    A   |  A    A    B    → 5
// T2      A    A    B   |  B    B    B    → 2
// T3      A    B    A   |  A    B    B    → 3
// T4      B    A    A   |  A    A    A    → 5
const appGrid: [string, number[]][] = [
  ['t1', [0, 0, 0, 0, 0, 1]],
  ['t2', [0, 0, 1, 1, 1, 1]],
  ['t3', [0, 1, 0, 0, 1, 1]],
  ['t4', [1, 0, 0, 0, 0, 0]],
]
const appQuestionIds = ['a1c1', 'a1c2', 'a1c3', 'a2c1', 'a2c2', 'a2c3']
const appAnswers = appGrid.flatMap(([teamId, choices]) =>
  choices.map((choice, qi) => ({
    teamId,
    questionId: appQuestionIds[qi],
    choice,
    text: null,
  }))
)

const dto: DashboardDTO = {
  session: {
    id: 'sess', code: 'ABC123', title: 'Test docimologie', status: 'finished',
    iratMinutes: 10, phaseStartedAt: new Date().toISOString(), revealed: true,
    createdAt: new Date().toISOString(), deletedAt: null, dataPurgedAt: null,
  },
  questions,
  cases: [
    { id: 'case1', title: 'Cas clinique 1', intro: null, order: 0 },
    { id: 'case2', title: 'Cas clinique 2', intro: null, order: 1 },
  ],
  teams,
  students,
  iratAnswers,
  tratAnswers,
  appeals: [],
  appAnswers,
  peerEvals: [],
}

describe('docimologie — iRAT (8 étudiants × 4 questions)', () => {
  const irat = analyzeSection(buildIratSection(dto))

  it('calcule l’indice de difficulté p', () => {
    expect(irat.items[0].p).toBeCloseTo(0.625, 4)
    expect(irat.items[1].p).toBeCloseTo(0.5, 4)
    expect(irat.items[2].p).toBeCloseTo(0.625, 4)
    expect(irat.items[3].p).toBeCloseTo(0.75, 4)
  })

  it('calcule la discrimination D (groupes extrêmes 27 %)', () => {
    // sup = S1/S2 (4/4), inf = S7/S8 (1 et 0) — Grace a bon à Q3
    expect(irat.items[0].d).toBeCloseTo(1.0, 4)
    expect(irat.items[2].d).toBeCloseTo(0.5, 4)
  })

  it('calcule la corrélation point-bisériale corrigée (item×reste)', () => {
    // Pearson exact : 1,625/√(1,875×8,875) = 0,398342
    expect(irat.items[0].rpbs).toBeCloseTo(0.398342, 4)
    expect(irat.items[3].rpbs).toBeCloseTo(0.745356, 4)
  })

  it('calcule moyenne, écart-type, médiane, quartiles, étendue', () => {
    expect(irat.test.n).toBe(8)
    expect(irat.test.k).toBe(4)
    expect(irat.test.mean).toBeCloseTo(2.5, 4)
    expect(irat.test.sd).toBeCloseTo(Math.sqrt(2), 4)
    expect(irat.test.median).toBeCloseTo(3, 4)
    expect(irat.test.q1).toBeCloseTo(1.75, 4)
    expect(irat.test.q3).toBeCloseTo(3.25, 4)
    expect(irat.test.min).toBe(0)
    expect(irat.test.max).toBe(4)
    expect(irat.test.mean20).toBeCloseTo(12.5, 4)
  })

  it('calcule alpha (KR-20/Cronbach, variances n−1) et SEM', () => {
    // (4/3)(1 − (8/7 × 0,90625)/2) = 0,642857
    expect(irat.test.alpha).toBeCloseTo(0.642857, 4)
    // SEM = √2 × √(1−α) = 0,845154
    expect(irat.test.sem).toBeCloseTo(0.845154, 4)
    expect(irat.test.nComplete).toBe(8)
  })

  it('construit la distribution /20 (4 classes)', () => {
    // 0→bin1, 5→bin2, 10→bin3, 15 et 20→bin4
    expect(irat.test.distribution.map((b) => b.count)).toEqual([1, 1, 1, 5])
  })

  it('analyse les distracteurs (choix par option)', () => {
    expect(irat.items[0].options[0].pct).toBeCloseTo(0.125, 4)
    expect(irat.items[0].options[1].pct).toBeCloseTo(0.625, 4)
    expect(irat.items[0].nMissing).toBe(0)
    expect(irat.items[0].n).toBe(8)
  })
})

describe('docimologie — tRAT (IF-AT 4/2/1/0, 4 équipes)', () => {
  const trat = analyzeSection(buildTratSection(dto))

  it('calcule p final et p au 1er essai', () => {
    expect(trat.items[0].p).toBeCloseTo(1.0, 4)
    expect(trat.items[1].p).toBeCloseTo(0.75, 4)
    expect(trat.items[2].p).toBeCloseTo(0.5, 4)
    expect(trat.items[0].pFirst).toBeCloseTo(0.5, 4)
    expect(trat.items[2].pFirst).toBeCloseTo(0.25, 4)
  })

  it('calcule les points moyens et la répartition IF-AT', () => {
    expect(trat.items[2].avgScore).toBeCloseTo(1.25, 4)
    expect([trat.items[0].ifat?.c4, trat.items[0].ifat?.c2, trat.items[0].ifat?.c1, trat.items[0].ifat?.c0])
      .toEqual([2, 2, 0, 0])
    expect([trat.items[1].ifat?.c4, trat.items[1].ifat?.c2, trat.items[1].ifat?.c1, trat.items[1].ifat?.c0])
      .toEqual([2, 1, 0, 1])
    expect([trat.items[2].ifat?.c4, trat.items[2].ifat?.c2, trat.items[2].ifat?.c1, trat.items[2].ifat?.c0])
      .toEqual([1, 0, 1, 2])
  })

  it('calcule D sur les groupes extrêmes (sup = T1, inf = T4)', () => {
    expect(trat.items[2].d).toBeCloseTo(1.0, 4)
    expect(trat.items[0].d).toBeCloseTo(0.0, 4)
  })

  it('calcule moyenne, écart-type, alpha sur les scores IF-AT', () => {
    expect(trat.test.mean).toBeCloseTo(10.25, 4)
    expect(trat.test.sd).toBeCloseTo(Math.sqrt(24.25), 4)
    expect(trat.test.mean20).toBeCloseTo(12.8125, 4)
    // (4/3)(1 − 9,5833/24,25) = 0,806413
    expect(trat.test.alpha).toBeCloseTo(0.806413, 4)
    expect(trat.test.distribution.map((b) => b.count)).toEqual([0, 1, 2, 1])
  })

  it('analyse les choix initiaux (1ᵉʳ essai par équipe)', () => {
    // Q3 : B, A, A, A → A 75 %, B 25 %
    expect(trat.items[2].options[0].pct).toBeCloseTo(0.75, 4)
    expect(trat.items[2].options[1].pct).toBeCloseTo(0.25, 4)
  })
})

describe('docimologie — application (2 cas cliniques × 3 QCU)', () => {
  const app = analyzeSection(buildApplicationSection(dto))

  it('regroupe les questions par cas avec libellés « Cas N Qi »', () => {
    expect(app.test.k).toBe(6)
    expect(app.test.n).toBe(4)
    expect(app.data.questions.map((q) => q.label)).toEqual([
      'Application 1 Q1', 'Application 1 Q2', 'Application 1 Q3',
      'Application 2 Q1', 'Application 2 Q2', 'Application 2 Q3',
    ])
    expect(app.data.questions[0].caseLabel).toBe('Cas clinique 1')
  })

  it('calcule p, D et r pbs par QCU d’application', () => {
    expect(app.items[0].p).toBeCloseTo(0.75, 4)
    expect(app.items[4].p).toBeCloseTo(0.5, 4)
    expect(app.items[5].p).toBeCloseTo(0.25, 4)
    expect(app.items[5].d).toBeCloseTo(0.0, 4)
    // 0,5/√(0,75×5) = 0,258199
    expect(app.items[5].rpbs).toBeCloseTo(0.258199, 4)
  })

  it('calcule alpha et la moyenne /20 de la section', () => {
    expect(app.test.alpha).toBeCloseTo(0.355556, 4)
    expect(app.test.mean20).toBeCloseTo(12.5, 4)
  })
})

describe('docimologie — comparaison iRAT → tRAT (effet équipe)', () => {
  const irat = analyzeSection(buildIratSection(dto))
  const trat = analyzeSection(buildTratSection(dto))
  const comp = buildComparison(irat, trat)

  it('compare p iRAT, p tRAT 1er essai, p tRAT final et le gain', () => {
    expect(comp[0].pIrat).toBeCloseTo(0.625, 4)
    expect(comp[0].pTratFirst).toBeCloseTo(0.5, 4)
    expect(comp[0].pTratFinal).toBeCloseTo(1.0, 4)
    expect(comp[0].gain).toBeCloseTo(0.375, 4)
  })
})

describe('docimologie — signalements automatiques (questions à revoir)', () => {
  const irat = analyzeSection(buildIratSection(dto))
  const trat = analyzeSection(buildTratSection(dto))
  const app = analyzeSection(buildApplicationSection(dto))
  const flagged = flagQuestions([
    { kind: 'irat', analysis: irat },
    { kind: 'trat', analysis: trat },
    { kind: 'application', analysis: app },
  ])
  const flaggedLabels = flagged.map((f) => `${f.kind}:${f.label}`)

  it('signale App 2 Q3 (très difficile + D insuffisante)', () => {
    expect(flaggedLabels.includes('application:Application 2 Q3')).toBe(true)
    const appQ6 = flagged.find((f) => f.label === 'Application 2 Q3')
    // p = 0,25 exactement : « difficile » (pas très difficile) ; D = 0
    // → un seul signalement (discrimination insuffisante)
    expect(appQ6 ? appQ6.problems.length : -1).toBe(1)
  })

  it('signale Q3 iRAT uniquement (r pbs faible : Grace a bon, les moyens non)', () => {
    const iratFlagged = flagged.filter((f) => f.kind === 'irat').map((f) => f.label)
    expect(iratFlagged).toEqual(['Q3'])
  })
})

describe('docimologie — robustesse (données manquantes, silence)', () => {
  const dto2: DashboardDTO = {
    ...dto,
    students: students.slice(0, 3),
    iratAnswers: [
      { questionId: 'rat1', studentId: 's1', choice: 1, isCorrect: true, score: 1 },
      { questionId: 'rat2', studentId: 's1', choice: 1, isCorrect: true, score: 1 },
      { questionId: 'rat1', studentId: 's2', choice: 0, isCorrect: false, score: 0 },
      // s3 ne répond qu'à Q2
      { questionId: 'rat2', studentId: 's3', choice: 0, isCorrect: false, score: 0 },
    ],
    tratAnswers: [],
    appAnswers: [],
    questions: [RQ(1), RQ(2)],
  }

  it('exclut les non-répondants des indices par question', () => {
    const irat2 = analyzeSection(buildIratSection(dto2))
    expect(irat2.items[0].p).toBeCloseTo(0.5, 4)
    expect(irat2.items[1].p).toBeCloseTo(0.5, 4)
    expect(irat2.items[0].n).toBe(2)
    expect(irat2.test.nComplete).toBe(1)
    expect(irat2.test.alpha).toBeNull() // 1 cas complet seulement
    expect(irat2.items[0].d).toBeNull() // n < 4
    // Q1 : s1 correct (reste 1), s2 incorrect (reste 0) → r = 1
    expect(irat2.items[0].rpbs).toBe(1)
  })

  it('exclut un étudiant silencieux (aucune réponse) des statistiques', () => {
    const empty2 = analyzeSection(
      buildIratSection({
        ...dto2,
        students: [...students.slice(0, 3), { id: 's4', name: 'Zoé', teamId: null, recoveryCode: '' }],
      })
    )
    expect(empty2.test.n).toBe(3)
  })
})
