// ============================================================
// TBL Live — Calcul de la note finale sur 20
// Répartition : iRAT 25 % · tRAT 25 % · Application 35 % · Pairs 15 %
// Si une composante est indisponible (aucune question de ce type,
// étudiant sans équipe, aucune évaluation reçue…), son poids est
// redistribué proportionnellement sur les autres composantes.
// ============================================================

import type { DashboardDTO, StudentStateDTO } from './tbl-types'

export const GRADE_WEIGHTS = { irat: 0.25, trat: 0.25, application: 0.35, peer: 0.15 }

export interface ComponentNote {
  /** Note ramenée sur 20 (null = composante indisponible) */
  note: number | null
  /** Affichage du score brut, ex. « 7/8 », « 22/32 », « 2/3 », « 4,2/5 » */
  detail: string
}

export interface FinalGrade {
  irat: ComponentNote
  trat: ComponentNote
  application: ComponentNote
  peer: ComponentNote
  /** Note finale sur 20 (null = aucune composante disponible) */
  final: number | null
  /** Poids effectivement utilisés, ex. « 25 % · 25 % · 35 % · 15 % » */
  weightsLabel: string
}

function pct(score: number, max: number): number {
  return max > 0 ? (score / max) * 20 : 0
}

/** Format français : 14,5 (1 décimale) */
export function fmtNote(n: number | null, decimals = 1): string {
  if (n === null || !Number.isFinite(n)) return '—'
  return n.toFixed(decimals).replace('.', ',')
}

export function computeFinalGrade(input: {
  iratScore: number | null
  iratMax: number
  tratScore: number | null
  tratMax: number
  appScore: number | null
  appMax: number
  peerAvg: number | null
}): FinalGrade {
  const irat: ComponentNote = {
    note: input.iratScore !== null && input.iratMax > 0 ? pct(input.iratScore, input.iratMax) : null,
    detail: input.iratMax > 0 ? `${input.iratScore ?? 0}/${input.iratMax}` : '—',
  }
  const trat: ComponentNote = {
    note: input.tratScore !== null && input.tratMax > 0 ? pct(input.tratScore, input.tratMax) : null,
    detail: input.tratMax > 0 ? `${input.tratScore ?? 0}/${input.tratMax}` : '—',
  }
  const application: ComponentNote = {
    note:
      input.appScore !== null && input.appMax > 0 ? pct(input.appScore, input.appMax) : null,
    detail: input.appMax > 0 ? `${input.appScore ?? 0}/${input.appMax}` : '—',
  }
  const peer: ComponentNote = {
    note: input.peerAvg !== null ? pct(input.peerAvg, 5) : null,
    detail: input.peerAvg !== null ? `${fmtNote(input.peerAvg)}/5` : '—',
  }

  const parts: { w: number; note: number; label: string }[] = []
  if (irat.note !== null) parts.push({ w: GRADE_WEIGHTS.irat, note: irat.note, label: '25' })
  if (trat.note !== null) parts.push({ w: GRADE_WEIGHTS.trat, note: trat.note, label: '25' })
  if (application.note !== null)
    parts.push({ w: GRADE_WEIGHTS.application, note: application.note, label: '35' })
  if (peer.note !== null) parts.push({ w: GRADE_WEIGHTS.peer, note: peer.note, label: '15' })

  const totalW = parts.reduce((s, p) => s + p.w, 0)
  const final = totalW > 0 ? parts.reduce((s, p) => s + p.w * p.note, 0) / totalW : null

  const all = ['25', '25', '35', '15']
  const labels = [
    irat.note !== null ? '25' : '0',
    trat.note !== null ? '25' : '0',
    application.note !== null ? '35' : '0',
    peer.note !== null ? '15' : '0',
  ]
  const weightsLabel =
    labels.join('/') === all.join('/') ? '25 % · 25 % · 35 % · 15 %' : labels.join('/') + ' (renormalisé)'

  return { irat, trat, application, peer, final, weightsLabel }
}

// ---------- Côté enseignant : à partir des données du tableau de bord ----------

export function gradeForStudent(
  data: DashboardDTO,
  studentId: string
): FinalGrade {
  const ratQs = data.questions.filter((q) => q.phase === 'rat')
  const appQs = data.questions.filter((q) => q.phase === 'application')
  const student = data.students.find((s) => s.id === studentId)
  const team = student?.teamId ? data.teams.find((t) => t.id === student.teamId) : undefined

  const iratScore = data.iratAnswers
    .filter((a) => a.studentId === studentId)
    .reduce((s, a) => s + a.score, 0)

  const tratScore = team
    ? data.tratAnswers.filter((a) => a.teamId === team.id).reduce((s, a) => s + a.score, 0)
    : null

  const appScore = team
    ? appQs.filter((q) => {
        const ans = data.appAnswers.find((x) => x.questionId === q.id && x.teamId === team.id)
        return ans !== undefined && ans.choice === q.correct
      }).length
    : null

  const received = data.peerEvals.filter((e) => e.evaluatedId === studentId)
  const peerAvg =
    received.length > 0 ? received.reduce((s, e) => s + e.score, 0) / received.length : null

  return computeFinalGrade({
    iratScore,
    iratMax: ratQs.length,
    tratScore,
    tratMax: ratQs.length * 4,
    appScore,
    appMax: appQs.length,
    peerAvg,
  })
}

// ---------- Côté étudiant : à partir de son état personnel ----------

export function gradeForStudentSelf(data: StudentStateDTO): FinalGrade {
  const ratQs = data.questions
  const appQs = data.applicationQuestions

  const iratScore = data.myIratAnswers.reduce((s, a) => s + (a.score ?? 0), 0)
  const hasTeam = data.me.team !== null
  const tratScore = hasTeam
    ? data.teamTratAnswers.reduce((s, a) => s + a.score, 0)
    : null
  const appScore = hasTeam
    ? appQs.filter((q) => {
        const ans = data.teamAppAnswers.find((x) => x.questionId === q.id)
        return ans !== undefined && q.correct !== undefined && ans.choice === q.correct
      }).length
    : null
  const peerAvg = data.myPeerReceived && data.myPeerReceived.count > 0 ? data.myPeerReceived.avg : null

  return computeFinalGrade({
    iratScore,
    iratMax: ratQs.length,
    tratScore,
    tratMax: ratQs.length * 4,
    appScore,
    appMax: appQs.length,
    peerAvg,
  })
}
