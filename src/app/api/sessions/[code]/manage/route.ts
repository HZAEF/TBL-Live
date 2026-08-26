import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionByCode, PHASES, sanitizeQuestionInput } from '@/lib/tbl'

// POST /api/sessions/[code]/manage — actions de l'enseignant
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params
    const body = await req.json().catch(() => null)
    const token = body?.token
    const action = body?.action
    if (typeof token !== 'string' || typeof action !== 'string') {
      return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })
    }
    const session = await getSessionByCode(code)
    if (!session) {
      return NextResponse.json({ error: 'Séance introuvable.' }, { status: 404 })
    }
    if (token !== session.teacherToken) {
      return NextResponse.json({ error: 'Accès refusé. Reconnectez-vous.' }, { status: 401 })
    }

    switch (action) {
      case 'set_phase': {
        const phase = body.phase as string
        if (!PHASES.includes(phase as (typeof PHASES)[number])) {
          return NextResponse.json({ error: 'Phase inconnue.' }, { status: 400 })
        }
        await db.session.update({
          where: { id: session.id },
          data: {
            status: phase,
            phaseStartedAt: new Date(),
            // On repart d'une révélation cachée à chaque nouvelle phase d'application
            revealed: phase === 'application' ? false : session.revealed,
          },
        })
        return NextResponse.json({ ok: true })
      }

      case 'set_irat_minutes': {
        const minutes = Number(body.minutes)
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 90) {
          return NextResponse.json({ error: 'Durée invalide (1 à 90 minutes).' }, { status: 400 })
        }
        await db.session.update({ where: { id: session.id }, data: { iratMinutes: minutes } })
        return NextResponse.json({ ok: true })
      }

      case 'add_question': {
        const q = sanitizeQuestionInput(body.question)
        if (!q) {
          return NextResponse.json(
            {
              error:
                'Question invalide : il faut un énoncé, entre 2 et 6 choix, et une bonne réponse cochée.',
            },
            { status: 400 }
          )
        }
        const count = await db.question.count({ where: { sessionId: session.id } })
        if (count >= 60) {
          return NextResponse.json({ error: 'Maximum de 60 questions par séance.' }, { status: 400 })
        }
        await db.question.create({
          data: {
            sessionId: session.id,
            text: q.text,
            choices: JSON.stringify(q.choices),
            correct: q.correct,
            phase: q.phase,
            order: count,
          },
        })
        return NextResponse.json({ ok: true })
      }

      case 'update_question': {
        const id = body.id
        const q = sanitizeQuestionInput(body.question)
        if (typeof id !== 'string' || !q) {
          return NextResponse.json({ error: 'Question invalide.' }, { status: 400 })
        }
        const existing = await db.question.findFirst({
          where: { id, sessionId: session.id },
        })
        if (!existing) {
          return NextResponse.json({ error: 'Question introuvable.' }, { status: 404 })
        }
        await db.question.update({
          where: { id },
          data: { text: q.text, choices: JSON.stringify(q.choices), correct: q.correct },
        })
        return NextResponse.json({ ok: true })
      }

      case 'delete_question': {
        const id = body.id
        if (typeof id !== 'string') {
          return NextResponse.json({ error: 'Identifiant manquant.' }, { status: 400 })
        }
        const existing = await db.question.findFirst({ where: { id, sessionId: session.id } })
        if (!existing) {
          return NextResponse.json({ error: 'Question introuvable.' }, { status: 404 })
        }
        await db.question.delete({ where: { id } })
        return NextResponse.json({ ok: true })
      }

      case 'set_team_count': {
        const count = Number(body.count)
        if (!Number.isInteger(count) || count < 1 || count > 12) {
          return NextResponse.json({ error: 'Nombre d\u2019équipes invalide (1 à 12).' }, { status: 400 })
        }
        const teams = await db.team.findMany({
          where: { sessionId: session.id },
          orderBy: { number: 'asc' },
        })
        if (count > teams.length) {
          await db.team.createMany({
            data: Array.from({ length: count - teams.length }, (_, i) => ({
              sessionId: session.id,
              name: `Équipe ${teams.length + i + 1}`,
              number: teams.length + i + 1,
            })),
          })
        } else if (count < teams.length) {
          // On ne supprime que les équipes vides (aucun membre, aucune réponse)
          const toRemove = teams.filter((t) => t.number > count)
          for (const t of toRemove) {
            const [members, answers, appAnswers, appeals] = await Promise.all([
              db.student.count({ where: { teamId: t.id } }),
              db.answer.count({ where: { teamId: t.id } }),
              db.appAnswer.count({ where: { teamId: t.id } }),
              db.appeal.count({ where: { teamId: t.id } }),
            ])
            if (members === 0 && answers === 0 && appAnswers === 0 && appeals === 0) {
              await db.team.delete({ where: { id: t.id } })
            }
          }
        }
        return NextResponse.json({ ok: true })
      }

      case 'rename_team': {
        const id = body.id
        const name = typeof body.name === 'string' ? body.name.trim() : ''
        if (typeof id !== 'string' || name.length < 1 || name.length > 40) {
          return NextResponse.json({ error: 'Nom d\u2019équipe invalide.' }, { status: 400 })
        }
        const team = await db.team.findFirst({ where: { id, sessionId: session.id } })
        if (!team) {
          return NextResponse.json({ error: 'Équipe introuvable.' }, { status: 404 })
        }
        await db.team.update({ where: { id }, data: { name } })
        return NextResponse.json({ ok: true })
      }

      case 'move_student': {
        const studentId = body.studentId
        const teamId = body.teamId // null ou "" pour désassigner
        if (typeof studentId !== 'string') {
          return NextResponse.json({ error: 'Étudiant manquant.' }, { status: 400 })
        }
        const student = await db.student.findFirst({
          where: { id: studentId, sessionId: session.id },
        })
        if (!student) {
          return NextResponse.json({ error: 'Étudiant introuvable.' }, { status: 404 })
        }
        if (teamId) {
          const team = await db.team.findFirst({ where: { id: teamId, sessionId: session.id } })
          if (!team) {
            return NextResponse.json({ error: 'Équipe introuvable.' }, { status: 404 })
          }
        }
        await db.student.update({
          where: { id: studentId },
          data: { teamId: teamId || null },
        })
        return NextResponse.json({ ok: true })
      }

      case 'auto_assign': {
        // Répartition équilibrée : les étudiants rejoignent les équipes les moins remplies
        const [students, teams] = await Promise.all([
          db.student.findMany({
            where: { sessionId: session.id },
            orderBy: { createdAt: 'asc' },
          }),
          db.team.findMany({ where: { sessionId: session.id }, orderBy: { number: 'asc' } }),
        ])
        if (teams.length === 0) {
          return NextResponse.json({ error: 'Aucune équipe.' }, { status: 400 })
        }
        const counts = new Map<string, number>(teams.map((t) => [t.id, 0]))
        for (const s of students) {
          if (s.teamId && counts.has(s.teamId)) counts.set(s.teamId, (counts.get(s.teamId) || 0) + 1)
        }
        for (const s of students) {
          if (s.teamId) continue
          let best = teams[0]
          let bestCount = Infinity
          for (const t of teams) {
            const c = counts.get(t.id) || 0
            if (c < bestCount) {
              best = t
              bestCount = c
            }
          }
          await db.student.update({ where: { id: s.id }, data: { teamId: best.id } })
          counts.set(best.id, bestCount + 1)
        }
        return NextResponse.json({ ok: true })
      }

      case 'remove_student': {
        const studentId = body.studentId
        if (typeof studentId !== 'string') {
          return NextResponse.json({ error: 'Étudiant manquant.' }, { status: 400 })
        }
        const student = await db.student.findFirst({
          where: { id: studentId, sessionId: session.id },
        })
        if (!student) {
          return NextResponse.json({ error: 'Étudiant introuvable.' }, { status: 404 })
        }
        await db.student.delete({ where: { id: studentId } })
        return NextResponse.json({ ok: true })
      }

      case 'resolve_appeal': {
        const id = body.id
        const status = body.status // accepted | rejected
        if (typeof id !== 'string' || (status !== 'accepted' && status !== 'rejected')) {
          return NextResponse.json({ error: 'Paramètres invalides.' }, { status: 400 })
        }
        const appeal = await db.appeal.findFirst({
          where: { id, sessionId: session.id },
        })
        if (!appeal) {
          return NextResponse.json({ error: 'Réclamation introuvable.' }, { status: 404 })
        }
        await db.appeal.update({ where: { id }, data: { status } })
        if (status === 'accepted') {
          // L'équipe reçoit les points complets (4 pts) pour cette question
          const existing = await db.answer.findFirst({
            where: { questionId: appeal.questionId, teamId: appeal.teamId, kind: 'trat' },
            orderBy: { attempt: 'desc' },
          })
          if (existing) {
            await db.answer.update({
              where: { id: existing.id },
              data: { isCorrect: true, score: 4 },
            })
          } else {
            const question = await db.question.findUnique({ where: { id: appeal.questionId } })
            await db.answer.create({
              data: {
                questionId: appeal.questionId,
                teamId: appeal.teamId,
                kind: 'trat',
                choice: question?.correct ?? 0,
                attempt: 1,
                isCorrect: true,
                score: 4,
              },
            })
          }
        }
        return NextResponse.json({ ok: true })
      }

      case 'toggle_reveal': {
        const revealed = Boolean(body.revealed)
        await db.session.update({ where: { id: session.id }, data: { revealed } })
        return NextResponse.json({ ok: true })
      }

      default:
        return NextResponse.json({ error: 'Action inconnue.' }, { status: 400 })
    }
  } catch (e) {
    console.error('POST /api/sessions/[code]/manage', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}
