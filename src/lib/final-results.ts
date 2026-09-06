import { db } from '@/lib/db'
import { computeFinalGrade, type FinalGrade } from './grades'

// ============================================================
// TBL Live — v2.6.0 : notes finales côté serveur
//
// Au moment de la clôture de la séance (statut « finished »), la note
// finale de chaque étudiant et son rang sont calculés CÔTÉ SERVEUR :
//  - l'étudiant ne peut pas les reconstituer depuis les données de son
//    écran (les réponses correctes ne sont plus transmises en fin de
//    séance — protection contre la capture et la divulgation) ;
//  - la note et le rang ne sont transmis qu'APRÈS la soumission du
//    questionnaire de fin de séance (TBL-SAI).
//
// Le calcul reprend exactement la pondération de src/lib/grades.ts :
// iRAT 25 % · tRAT 25 % · Application 35 % · Pairs 15 %, avec
// redistribution des poids des composantes indisponibles.
// ============================================================

export interface StudentFinalResult {
  studentId: string
  grade: FinalGrade
}

/**
 * Notes finales de TOUS les étudiants d'une séance (une requête par type
 * de donnée, tout en base — aucune boucle de requêtes par étudiant).
 */
export async function computeAllFinalGrades(sessionId: string): Promise<StudentFinalResult[]> {
  const [students, ratQuestions, appQuestions, iratAnswers, tratAnswers, appAnswers, peerEvals] =
    await Promise.all([
      db.student.findMany({
        where: { sessionId },
        select: { id: true, teamId: true },
      }),
      db.question.findMany({
        where: { sessionId, phase: 'rat' },
        select: { id: true },
      }),
      db.question.findMany({
        where: { sessionId, phase: 'application' },
        select: { id: true, correct: true },
      }),
      db.answer.findMany({
        where: { kind: 'irat', question: { sessionId, phase: 'rat' } },
        select: { studentId: true, score: true },
      }),
      db.answer.findMany({
        where: { kind: 'trat', question: { sessionId, phase: 'rat' } },
        select: { teamId: true, score: true },
      }),
      db.appAnswer.findMany({
        where: { question: { sessionId, phase: 'application' } },
        select: { teamId: true, questionId: true, choice: true },
      }),
      db.peerEval.findMany({
        where: { sessionId },
        select: { evaluatedId: true, score: true },
      }),
    ])

  // Scores iRAT par étudiant (studentId est non-null sur les réponses iRAT,
  // le type Prisma reste large : on saute proprement les valeurs null)
  const iratByStudent = new Map<string, number>()
  for (const a of iratAnswers) {
    if (a.studentId === null) continue
    iratByStudent.set(a.studentId, (iratByStudent.get(a.studentId) ?? 0) + a.score)
  }

  // Scores tRAT et application par équipe (teamId non-null sur les tRAT)
  const tratByTeam = new Map<string, number>()
  for (const a of tratAnswers) {
    if (a.teamId === null) continue
    tratByTeam.set(a.teamId, (tratByTeam.get(a.teamId) ?? 0) + a.score)
  }
  const appCorrectByTeam = new Map<string, number>()
  for (const q of appQuestions) {
    const teamsHavingCorrect = new Set(
      appAnswers.filter((a) => a.questionId === q.id && a.choice === q.correct).map((a) => a.teamId)
    )
    for (const tid of teamsHavingCorrect) appCorrectByTeam.set(tid, (appCorrectByTeam.get(tid) ?? 0) + 1)
  }

  // Moyenne des évaluations reçues par étudiant
  const peerByStudent = new Map<string, { sum: number; n: number }>()
  for (const e of peerEvals) {
    const cur = peerByStudent.get(e.evaluatedId) ?? { sum: 0, n: 0 }
    cur.sum += e.score
    cur.n += 1
    peerByStudent.set(e.evaluatedId, cur)
  }

  return students.map((s) => {
    const peer = peerByStudent.get(s.id)
    const grade = computeFinalGrade({
      // Convention identique à l'affichage enseignant (gradeForStudent) :
      // iRAT/tRAT/application non renseignés = 0 point (test « non répondu »),
      // null uniquement si la composante est structurellement absente
      // (pas de questions, étudiant sans équipe) → redistribution du poids.
      iratScore: iratByStudent.get(s.id) ?? 0,
      iratMax: ratQuestions.length,
      tratScore: s.teamId ? (tratByTeam.get(s.teamId) ?? 0) : null,
      tratMax: ratQuestions.length * 4,
      appScore: s.teamId ? (appCorrectByTeam.get(s.teamId) ?? 0) : null,
      appMax: appQuestions.length,
      peerAvg: peer && peer.n > 0 ? peer.sum / peer.n : null,
    })
    return { studentId: s.id, grade }
  })
}
