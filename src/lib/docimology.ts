// ============================================================
// TBL Live — Statistiques docimologiques (théorie classique des
// tests) : indice de difficulté (p), indice de discrimination (D,
// groupes extrêmes 27 %), corrélation point-bisériale corrigée
// (item-reste), fidélité KR-20 / alpha de Cronbach, erreur
// standard de mesure (SEM), analyse des distracteurs, répartition
// des scores IF-AT (4/2/1/0).
//
// Module PUR (aucune dépendance React) — testable isolément.
// Références : Ebel & Frisbie (1986), Nunnally (1978), Haladyna
// (2004) pour les seuils d'interprétation usuels.
// ============================================================

import { LETTERS, type DashboardDTO } from './tbl-types'

export type SectionKind = 'irat' | 'trat' | 'application'
export type Tone = 'good' | 'ok' | 'warn' | 'bad' | 'neutral'

// ---------------------------------------------------------------
// Primitives statistiques
// ---------------------------------------------------------------

export function mean(xs: number[]): number {
  return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

/** Variance d'échantillon (n−1) — null si moins de 2 valeurs. */
export function sampleVariance(xs: number[]): number | null {
  if (xs.length < 2) return null
  const m = mean(xs)
  return xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1)
}

export function sampleSd(xs: number[]): number | null {
  const v = sampleVariance(xs)
  return v === null ? null : Math.sqrt(v)
}

export function median(xs: number[]): number | null {
  return quantile(xs, 0.5)
}

/** Quantile par interpolation linéaire (méthode « inclusive »). */
export function quantile(xs: number[], q: number): number | null {
  if (xs.length === 0) return null
  const sorted = [...xs].sort((a, b) => a - b)
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo])
}

// ---------------------------------------------------------------
// Interprétations (seuils classiques de la docimologie)
// ---------------------------------------------------------------

export interface Interp {
  label: string
  tone: Tone
}

/** Indice de difficulté p : proportion de bonnes réponses. */
export function difficultyInterp(p: number): Interp {
  if (p >= 0.9) return { label: 'Très facile', tone: 'neutral' }
  if (p >= 0.75) return { label: 'Facile', tone: 'ok' }
  if (p >= 0.5) return { label: 'Moyen', tone: 'good' }
  if (p >= 0.25) return { label: 'Difficile', tone: 'warn' }
  return { label: 'Très difficile', tone: 'bad' }
}

/** Indice de discrimination D (groupes extrêmes 27 %). */
export function discriminationInterp(d: number): Interp {
  if (d >= 0.4) return { label: 'Excellente', tone: 'good' }
  if (d >= 0.3) return { label: 'Bonne', tone: 'good' }
  if (d >= 0.2) return { label: 'Limite', tone: 'warn' }
  if (d >= 0) return { label: 'Insuffisante', tone: 'bad' }
  return { label: 'Négative', tone: 'bad' }
}

/** Corrélation point-bisériale corrigée (item / reste du test). */
export function rpbsInterp(r: number): Interp {
  if (r >= 0.4) return { label: 'Très bonne', tone: 'good' }
  if (r >= 0.3) return { label: 'Bonne', tone: 'good' }
  if (r >= 0.2) return { label: 'Limite', tone: 'warn' }
  if (r >= 0) return { label: 'Faible', tone: 'bad' }
  return { label: 'Négative', tone: 'bad' }
}

/** Fidélité du test (KR-20 / alpha de Cronbach). */
export function alphaInterp(a: number): Interp {
  if (a >= 0.9) return { label: 'Excellente', tone: 'good' }
  if (a >= 0.8) return { label: 'Très bonne', tone: 'good' }
  if (a >= 0.7) return { label: 'Acceptable', tone: 'ok' }
  if (a >= 0.6) return { label: 'Limite', tone: 'warn' }
  return { label: 'Faible', tone: 'bad' }
}

// ---------------------------------------------------------------
// Données d'entrée d'une section (iRAT, tRAT ou application)
// ---------------------------------------------------------------

export interface DocQuestion {
  id: string
  /** Libellé court : « Q1 », « Application 2 Q3 »… */
  label: string
  text: string
  choices: string[]
  correct: number
  /** Titre du cas clinique (questions d'application) */
  caseLabel?: string
}

export interface DocRespondent {
  id: string
  /** Nom de l'étudiant ou de l'équipe */
  label: string
}

export interface SectionData {
  kind: SectionKind
  /** « étudiants » ou « équipes » (pour les libellés) */
  unitLabel: string
  respondents: DocRespondent[]
  questions: DocQuestion[]
  /** choix[r][c] = index choisi ou null (tRAT : choix du 1ᵉʳ essai) */
  choices: (number | null)[][]
  /** score[r][c] : iRAT/application 0-1 ; tRAT 4/2/1/0 ; null = pas répondu */
  scores: (number | null)[][]
  /** points max par question : 1 (iRAT, application) ou 4 (tRAT) */
  itemMax: number
}

// ---------------------------------------------------------------
// Construction des sections à partir du tableau de bord
// ---------------------------------------------------------------

export function buildIratSection(data: DashboardDTO): SectionData {
  const qs = data.questions.filter((q) => q.phase === 'rat')
  const students = data.students.filter((s) =>
    data.iratAnswers.some((a) => a.studentId === s.id)
  )
  const choices: (number | null)[][] = students.map((s) =>
    qs.map((q) => {
      const a = data.iratAnswers.find((x) => x.questionId === q.id && x.studentId === s.id)
      return a ? a.choice : null
    })
  )
  const scores: (number | null)[][] = students.map((s) =>
    qs.map((q) => {
      const a = data.iratAnswers.find((x) => x.questionId === q.id && x.studentId === s.id)
      return a ? (a.isCorrect ? 1 : 0) : null
    })
  )
  return {
    kind: 'irat',
    unitLabel: 'étudiants',
    respondents: students.map((s) => ({ id: s.id, label: s.name })),
    questions: qs.map((q, i) => ({
      id: q.id,
      label: `Q${i + 1}`,
      text: q.text,
      choices: q.choices,
      correct: q.correct ?? 0,
    })),
    choices,
    scores,
    itemMax: 1,
  }
}

export function buildTratSection(data: DashboardDTO): SectionData {
  const qs = data.questions.filter((q) => q.phase === 'rat')
  const teams = data.teams.filter((t) => data.tratAnswers.some((a) => a.teamId === t.id))
  // Une matrice de tentatives triées par numéro d'essai :
  // [équipe][question] → tentatives dans l'ordre 1, 2, 3…
  const attempts: { choice: number; score: number; isCorrect: boolean }[][][] = teams.map((t) =>
    qs.map((q) =>
      data.tratAnswers
        .filter((x) => x.questionId === q.id && x.teamId === t.id)
        .sort((a, b) => a.attempt - b.attempt)
        .map((x) => ({ choice: x.choice, score: x.score, isCorrect: x.isCorrect }))
    )
  )
  const choices: (number | null)[][] = attempts.map((row) =>
    row.map((atts) => (atts.length > 0 ? atts[0].choice : null))
  )
  // Score final IF-AT = somme des points des tentatives (4/2/1/0) :
  // seule la tentative gagnante rapporte des points.
  const scores: (number | null)[][] = attempts.map((row) =>
    row.map((atts) => (atts.length > 0 ? atts.reduce((s, x) => s + x.score, 0) : null))
  )
  return {
    kind: 'trat',
    unitLabel: 'équipes',
    respondents: teams.map((t) => ({ id: t.id, label: t.name })),
    questions: qs.map((q, i) => ({
      id: q.id,
      label: `Q${i + 1}`,
      text: q.text,
      choices: q.choices,
      correct: q.correct ?? 0,
    })),
    choices,
    scores,
    itemMax: 4,
  }
}

export function buildApplicationSection(data: DashboardDTO): SectionData {
  const qs = data.questions.filter((q) => q.phase === 'application')
  const caseById = new Map(data.cases.map((c) => [c.id, c]))
  // Regroupement par cas clinique (comme l'onglet Résultats) :
  // libellés « Application n Qm », puis exercices libres « ex. n ».
  const questions: DocQuestion[] = []
  for (const c of data.cases) {
    const caseQs = qs.filter((q) => q.caseId === c.id)
    caseQs.forEach((q, i) =>
      questions.push({
        id: q.id,
        label: `Application ${c.order + 1} Q${i + 1}`,
        text: q.text,
        choices: q.choices,
        correct: q.correct ?? 0,
        caseLabel: c.title,
      })
    )
  }
  const free = qs.filter((q) => !q.caseId || !caseById.has(q.caseId))
  free.forEach((q, i) =>
    questions.push({
      id: q.id,
      label: `Application ex.${i + 1}`,
      text: q.text,
      choices: q.choices,
      correct: q.correct ?? 0,
    })
  )
  const teams = data.teams.filter((t) => data.appAnswers.some((a) => a.teamId === t.id))
  const choices: (number | null)[][] = teams.map((t) =>
    questions.map((q) => {
      const a = data.appAnswers.find((x) => x.questionId === q.id && x.teamId === t.id)
      return a ? a.choice : null
    })
  )
  const scores: (number | null)[][] = teams.map((t) =>
    questions.map((q) => {
      const a = data.appAnswers.find((x) => x.questionId === q.id && x.teamId === t.id)
      return a ? (a.choice === (q.correct ?? 0) ? 1 : 0) : null
    })
  )
  return {
    kind: 'application',
    unitLabel: 'équipes',
    respondents: teams.map((t) => ({ id: t.id, label: t.name })),
    questions,
    choices,
    scores,
    itemMax: 1,
  }
}

// ---------------------------------------------------------------
// Analyse d'une section
// ---------------------------------------------------------------

export interface OptionStat {
  index: number
  label: string
  count: number
  /** proportion parmi les répondants de l'item (null si aucune réponse) */
  pct: number | null
  isCorrect: boolean
}

export interface ItemAnalysis {
  question: DocQuestion
  /** répondants ayant répondu à cette question */
  n: number
  nCorrect: number
  /** indice de difficulté p (réussite ; tRAT : réussite finale) */
  p: number | null
  /** tRAT : réussite au 1ᵉʳ essai (choix initial = bonne réponse) */
  pFirst: number | null
  /** score moyen à la question (iRAT/app : = p ; tRAT : points /4) */
  avgScore: number | null
  /** tRAT : nombre d'équipes à 4 / 2 / 1 / 0 point */
  ifat: { c4: number; c2: number; c1: number; c0: number } | null
  /** indice de discrimination (groupes extrêmes 27 %) */
  d: number | null
  /** corrélation point-bisériale corrigée (item / reste du test) */
  rpbs: number | null
  /** répartition des choix (tRAT : choix du 1ᵉʳ essai) */
  options: OptionStat[]
  /** répondants de la section n'ayant pas répondu à cette question */
  nMissing: number
}

export interface TestAnalysis {
  n: number
  k: number
  maxScore: number
  /** moyenne (points bruts) */
  mean: number | null
  sd: number | null
  median: number | null
  q1: number | null
  q3: number | null
  min: number | null
  max: number | null
  /** moyenne des scores ramenés sur 20 */
  mean20: number | null
  /** KR-20 / alpha de Cronbach (cas complets) */
  alpha: number | null
  /** erreur standard de mesure (points bruts) */
  sem: number | null
  /** répondants ayant répondu à toutes les questions */
  nComplete: number
  /** histogramme des scores ramenés sur 20 */
  distribution: { label: string; count: number }[]
}

export interface SectionAnalysis {
  data: SectionData
  items: ItemAnalysis[]
  test: TestAnalysis
}

const DIST_LABELS = ['0 à 4,99', '5 à 9,99', '10 à 14,99', '15 à 20']

export function analyzeSection(data: SectionData): SectionAnalysis {
  const { respondents, questions, choices, scores, itemMax } = data
  const R = respondents.length
  const K = questions.length

  // Totaux et pourcentages par répondant (pour trier et classer).
  // Le pourcentage neutralise les questions non répondues.
  const totals: number[] = []
  const pcts: number[] = []
  for (let r = 0; r < R; r++) {
    let tot = 0
    let maxAns = 0
    for (let c = 0; c < K; c++) {
      const s = scores[r][c]
      if (s !== null) {
        tot += s
        maxAns += itemMax
      }
    }
    totals.push(tot)
    pcts.push(maxAns > 0 ? tot / maxAns : 0)
  }

  // Groupes extrêmes (méthode des 27 %) — au moins 1 par groupe.
  const order = respondents.map((_, r) => r).sort((a, b) => pcts[b] - pcts[a])
  const g = Math.max(1, Math.round(0.27 * R))
  const upper = new Set(order.slice(0, g))
  const lower = new Set(order.slice(Math.max(0, R - g)))
  const canD = R >= 4

  const items: ItemAnalysis[] = questions.map((q, c) => {
    const answered: number[] = []
    for (let r = 0; r < R; r++) if (scores[r][c] !== null) answered.push(r)
    const n = answered.length
    const nCorrect = answered.filter((r) => (scores[r][c] ?? 0) > 0).length
    const p = n > 0 ? nCorrect / n : null
    const avgScore = n > 0 ? mean(answered.map((r) => scores[r][c] ?? 0)) : null

    // tRAT : réussite au 1ᵉʳ essai + répartition IF-AT 4/2/1/0
    let pFirst: number | null = null
    let ifat: { c4: number; c2: number; c1: number; c0: number } | null = null
    if (data.kind === 'trat') {
      const nFirst = answered.filter((r) => choices[r][c] === q.correct).length
      pFirst = n > 0 ? nFirst / n : null
      ifat = {
        c4: answered.filter((r) => (scores[r][c] ?? 0) === 4).length,
        c2: answered.filter((r) => (scores[r][c] ?? 0) === 2).length,
        c1: answered.filter((r) => (scores[r][c] ?? 0) === 1).length,
        c0: answered.filter((r) => (scores[r][c] ?? 0) === 0).length,
      }
    }

    // Indice de discrimination D = p(supérieurs) − p(inférieurs)
    let d: number | null = null
    if (canD) {
      const upAns = answered.filter((r) => upper.has(r))
      const loAns = answered.filter((r) => lower.has(r))
      if (upAns.length > 0 && loAns.length > 0) {
        const pU = upAns.filter((r) => (scores[r][c] ?? 0) > 0).length / upAns.length
        const pL = loAns.filter((r) => (scores[r][c] ?? 0) > 0).length / loAns.length
        d = pU - pL
      }
    }

    // Corrélation point-bisériale corrigée : corrélation de Pearson
    // exacte entre la réussite de l'item (0/1) et le « reste du test »
    // (total − points de l'item). Calcul direct — insensible à la
    // convention de variance (n ou n−1).
    let rpbs: number | null = null
    if (n >= 2 && nCorrect >= 1 && n - nCorrect >= 1) {
      const xs = answered.map((r) => ((scores[r][c] ?? 0) > 0 ? 1 : 0))
      const ys = answered.map((r) => totals[r] - (scores[r][c] ?? 0))
      const mx = mean(xs)
      const my = mean(ys)
      let num = 0
      let dx = 0
      let dy = 0
      for (let i = 0; i < xs.length; i++) {
        num += (xs[i] - mx) * (ys[i] - my)
        dx += (xs[i] - mx) * (xs[i] - mx)
        dy += (ys[i] - my) * (ys[i] - my)
      }
      if (dx > 0 && dy > 0) {
        rpbs = num / Math.sqrt(dx * dy)
      }
    }

    // Répartition des choix (tRAT : choix du 1ᵉʳ essai)
    const options: OptionStat[] = q.choices.map((_, i) => {
      const count = answered.filter((r) => choices[r][c] === i).length
      return {
        index: i,
        label: LETTERS[i] ?? String(i + 1),
        count,
        pct: n > 0 ? count / n : null,
        isCorrect: i === q.correct,
      }
    })

    return {
      question: q,
      n,
      nCorrect,
      p,
      pFirst,
      avgScore,
      ifat,
      d,
      rpbs,
      options,
      nMissing: R - n,
    }
  })

  // ---- Synthèse du test ----
  const meanT = R > 0 ? mean(totals) : null
  const sdT = sampleSd(totals)
  const scores20 = pcts.map((x) => x * 20)

  // Fidélité KR-20 / alpha : uniquement sur les répondants « complets »
  // (ayant répondu à toutes les questions de la section).
  const complete: number[] = []
  for (let r = 0; r < R; r++) {
    if (questions.every((_, c) => scores[r][c] !== null)) complete.push(r)
  }
  let alpha: number | null = null
  if (K >= 2 && complete.length >= 2) {
    const compTotals = complete.map((r) => totals[r])
    const varTotal = sampleVariance(compTotals)
    if (varTotal !== null && varTotal > 0) {
      let sumVarItems = 0
      for (let c = 0; c < K; c++) {
        const v = sampleVariance(complete.map((r) => scores[r][c] ?? 0))
        if (v === null) {
          sumVarItems = -1
          break
        }
        sumVarItems += v
      }
      if (sumVarItems >= 0) {
        alpha = (K / (K - 1)) * (1 - sumVarItems / varTotal)
      }
    }
  }

  const sem = sdT !== null && alpha !== null ? sdT * Math.sqrt(1 - alpha) : null

  const distribution = DIST_LABELS.map((label, i) => ({
    label,
    count: scores20.filter((x) =>
      i < DIST_LABELS.length - 1 ? x >= i * 5 && x < (i + 1) * 5 : x >= i * 5 && x <= 20
    ).length,
  }))

  return {
    data,
    items,
    test: {
      n: R,
      k: K,
      maxScore: K * itemMax,
      mean: meanT,
      sd: sdT,
      median: median(totals),
      q1: quantile(totals, 0.25),
      q3: quantile(totals, 0.75),
      min: R > 0 ? Math.min(...totals) : null,
      max: R > 0 ? Math.max(...totals) : null,
      mean20: R > 0 ? mean(scores20) : null,
      alpha,
      sem,
      nComplete: complete.length,
      distribution,
    },
  }
}

// ---------------------------------------------------------------
// Comparaison iRAT → tRAT (par question RAT)
// ---------------------------------------------------------------

export interface ComparisonRow {
  question: DocQuestion
  /** % de réussite individuelle (iRAT) */
  pIrat: number | null
  /** % d'équipes ayant la bonne réponse au 1ᵉʳ essai */
  pTratFirst: number | null
  /** % d'équipes ayant trouvé la bonne réponse (au final) */
  pTratFinal: number | null
  /** gain = réussite finale équipe − réussite individuelle (points de %) */
  gain: number | null
}

export function buildComparison(
  irat: SectionAnalysis,
  trat: SectionAnalysis
): ComparisonRow[] {
  return irat.items.map((it) => {
    const t = trat.items.find((x) => x.question.id === it.question.id)
    return {
      question: it.question,
      pIrat: it.p,
      pTratFirst: t ? t.pFirst : null,
      pTratFinal: t ? t.p : null,
      gain:
        it.p !== null && t && t.p !== null ? t.p - it.p : null,
    }
  })
}

// ---------------------------------------------------------------
// Questions à revoir (signalement automatique)
// ---------------------------------------------------------------

export interface FlaggedQuestion {
  kind: SectionKind
  label: string
  text: string
  problems: string[]
}

export function flagQuestions(
  sections: { kind: SectionKind; analysis: SectionAnalysis }[]
): FlaggedQuestion[] {
  const out: FlaggedQuestion[] = []
  for (const { kind, analysis } of sections) {
    for (const it of analysis.items) {
      const problems: string[] = []
      if (it.p !== null && it.p < 0.25)
        problems.push(`très difficile (p = ${fmt2(it.p)})`)
      if (it.p !== null && it.p > 0.95)
        problems.push('très facile — peu informative (p > 0,95)')
      if (it.d !== null && it.d < 0.2)
        problems.push(`discrimination ${discriminationInterp(it.d).label.toLowerCase()} (D = ${fmt2(it.d)})`)
      if (it.rpbs !== null && it.rpbs < 0.2)
        problems.push(`corrélation au reste du test faible (r = ${fmt2(it.rpbs)})`)
      // Distracteur jamais choisi (question trop facile à éliminer)
      if (it.n >= 8) {
        const dead = it.options.filter((o) => !o.isCorrect && o.count === 0)
        if (dead.length > 0)
          problems.push(`distracteur jamais choisi : ${dead.map((o) => o.label).join(', ')}`)
      }
      if (problems.length > 0) {
        out.push({
          kind,
          label: it.question.label,
          text: it.question.text,
          problems,
        })
      }
    }
  }
  return out.sort((a, b) => b.problems.length - a.problems.length)
}

// ---------------------------------------------------------------
// Formatage (français, virgule décimale)
// ---------------------------------------------------------------

/** 0,63 — deux décimales, virgule. */
export function fmt2(x: number | null): string {
  if (x === null || !Number.isFinite(x)) return '—'
  return x.toFixed(2).replace('.', ',')
}

/** 62,5 % — pourcentage avec 1 décimale. */
export function fmtPct(x: number | null): string {
  if (x === null || !Number.isFinite(x)) return '—'
  return (x * 100).toFixed(1).replace('.', ',') + ' %'
}

/** 12,5 — nombre « simple » (moyennes, notes). */
export function fmtNum(x: number | null, decimals = 1): string {
  if (x === null || !Number.isFinite(x)) return '—'
  return x.toFixed(decimals).replace('.', ',')
}
