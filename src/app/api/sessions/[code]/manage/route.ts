import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  getSessionByCode,
  PHASES,
  sanitizeQuestionInput,
  generateUniqueCode,
  randomToken,
  randomCode,
  isValidPin,
  normalizePin,
} from '@/lib/tbl'
import { isTrashExpired } from '@/lib/session-lifecycle'
// Renumérote les questions « libres » d'une phase (rat ou application,
// sans cas associé) : 0, 1, 2, … Garantit un ordre stable et sans doublons
// après une suppression ou un changement de phase.
async function renumberPhase(sessionId: string, phase: string) {
  const list = await db.question.findMany({
    where: { sessionId, phase, caseId: null },
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
  })
  for (let i = 0; i < list.length; i++) {
    if (list[i].order !== i) {
      await db.question.update({ where: { id: list[i].id }, data: { order: i } })
    }
  }
}

// Renumérote les QCU d'un cas clinique : 0, 1, 2, …
async function renumberCase(caseId: string) {
  const list = await db.question.findMany({
    where: { caseId },
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
  })
  for (let i = 0; i < list.length; i++) {
    if (list[i].order !== i) {
      await db.question.update({ where: { id: list[i].id }, data: { order: i } })
    }
  }
}

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

    // Séance en corbeille : les étudiants n'ont plus accès, le déroulé est
    // figé. Seules la restauration et la suppression définitive sont admises.
    if (
      session.deletedAt &&
      action !== 'restore_session' &&
      action !== 'delete_forever'
    ) {
      return NextResponse.json(
        {
          error:
            'Cette séance est dans la corbeille. Restaurez-la d\u2019abord (bouton « Restaurer ») pour pouvoir la modifier.',
        },
        { status: 409 }
      )
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
        // En entrant (ou revenant) dans la phase réclamations, on repart de
        // zéro : chaque équipe doit re-confirmer « pas de réclamation » avant
        // le passage automatique au feedback.
        if (phase === 'appeal') {
          await db.team.updateMany({
            where: { sessionId: session.id },
            data: { appealsDone: false },
          })
        }
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
        // Cas clinique ciblé (pour les QCU d'application) : doit appartenir
        // à la séance et la question doit être de phase application.
        let caseId: string | null = null
        if (typeof body.caseId === 'string' && body.caseId) {
          if (q.phase !== 'application') {
            return NextResponse.json(
              { error: 'Seules les questions d\u2019application peuvent être ajoutées à un cas.' },
              { status: 400 }
            )
          }
          const kase = await db.case.findFirst({
            where: { id: body.caseId, sessionId: session.id },
          })
          if (!kase) {
            return NextResponse.json({ error: 'Cas clinique introuvable.' }, { status: 404 })
          }
          caseId = kase.id
        }
        // Numérotation : dans le cas si lié, sinon en fin de liste de la phase
        let order: number
        if (caseId) {
          order = await db.question.count({ where: { caseId } })
        } else {
          order = await db.question.count({
            where: { sessionId: session.id, phase: q.phase, caseId: null },
          })
        }
        const totalCount = await db.question.count({ where: { sessionId: session.id } })
        if (totalCount >= 120) {
          return NextResponse.json(
            { error: 'Maximum de 120 questions par séance (tous types confondus).' },
            { status: 400 }
          )
        }
        await db.question.create({
          data: {
            sessionId: session.id,
            text: q.text,
            choices: JSON.stringify(q.choices),
            correct: q.correct,
            phase: q.phase,
            caseId,
            // Ordre compté DANS la phase (ou dans le cas) : les questions
            // iRAT/tRAT, les QCU d'un cas et les exercices libres sont
            // numérotés indépendamment.
            order,
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
          data: {
            text: q.text,
            choices: JSON.stringify(q.choices),
            correct: q.correct,
            phase: q.phase,
            // Une question qui quitte la phase application perd son cas
            caseId: q.phase === 'application' ? existing.caseId : null,
          },
        })
        // Si la question change de phase (rat ↔ application), on renumérote
        // les deux listes pour garder des ordres consécutifs sans doublons.
        if (q.phase !== existing.phase) {
          if (existing.caseId) await renumberCase(existing.caseId)
          await renumberPhase(session.id, existing.phase)
          await renumberPhase(session.id, q.phase)
        }
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
        // Renumérotation : dans le cas si la question appartenait à un cas,
        // sinon dans la liste libre de la phase (ordres consécutifs 0,1,2…)
        if (existing.caseId) {
          await renumberCase(existing.caseId)
        } else {
          await renumberPhase(session.id, existing.phase)
        }
        return NextResponse.json({ ok: true })
      }

      // ----- Cas cliniques d'application -----

      case 'add_case': {
        const title = typeof body.title === 'string' ? body.title.trim() : ''
        const intro = typeof body.intro === 'string' ? body.intro.trim().slice(0, 4000) : ''
        if (title.length < 1 || title.length > 200) {
          return NextResponse.json(
            { error: 'Le titre du cas doit contenir entre 1 et 200 caractères.' },
            { status: 400 }
          )
        }
        const count = await db.case.count({ where: { sessionId: session.id } })
        if (count >= 20) {
          return NextResponse.json({ error: 'Maximum de 20 cas cliniques par séance.' }, { status: 400 })
        }
        await db.case.create({
          data: { sessionId: session.id, title, intro: intro || null, order: count },
        })
        return NextResponse.json({ ok: true })
      }

      case 'update_case': {
        const id = body.id
        const title = typeof body.title === 'string' ? body.title.trim() : ''
        const intro = typeof body.intro === 'string' ? body.intro.trim().slice(0, 4000) : ''
        if (typeof id !== 'string' || title.length < 1 || title.length > 200) {
          return NextResponse.json({ error: 'Cas clinique invalide.' }, { status: 400 })
        }
        const existing = await db.case.findFirst({ where: { id, sessionId: session.id } })
        if (!existing) {
          return NextResponse.json({ error: 'Cas clinique introuvable.' }, { status: 404 })
        }
        await db.case.update({
          where: { id },
          data: { title, intro: intro || null },
        })
        return NextResponse.json({ ok: true })
      }

      case 'delete_case': {
        const id = body.id
        if (typeof id !== 'string') {
          return NextResponse.json({ error: 'Identifiant manquant.' }, { status: 400 })
        }
        const existing = await db.case.findFirst({ where: { id, sessionId: session.id } })
        if (!existing) {
          return NextResponse.json({ error: 'Cas clinique introuvable.' }, { status: 404 })
        }
        // La suppression du cas supprime aussi ses QCU (et leurs réponses,
        // par cascade) après confirmation côté client.
        await db.case.delete({ where: { id } })
        // Renumérotation des cas restants : 0, 1, 2…
        const remaining = await db.case.findMany({
          where: { sessionId: session.id },
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
        })
        for (let i = 0; i < remaining.length; i++) {
          if (remaining[i].order !== i) {
            await db.case.update({ where: { id: remaining[i].id }, data: { order: i } })
          }
        }
        return NextResponse.json({ ok: true })
      }

      case 'set_team_count': {
        const count = Number(body.count)
        if (!Number.isInteger(count) || count < 2 || count > 50) {
          return NextResponse.json({ error: 'Nombre d\u2019équipes invalide (2 à 50).' }, { status: 400 })
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

      // ----- Cycle de vie : corbeille, restauration, suppression, copie -----

      case 'delete_session': {
        // Mise à la corbeille (suppression douce) : les étudiants perdent
        // immédiatement l'accès ; l'enseignant peut restaurer pendant 48 h.
        if (!session.deletedAt) {
          await db.session.update({
            where: { id: session.id },
            data: { deletedAt: new Date() },
          })
        }
        return NextResponse.json({ ok: true })
      }

      case 'restore_session': {
        if (!session.deletedAt) {
          return NextResponse.json({ ok: true }) // rien à restaurer
        }
        if (isTrashExpired(session.deletedAt)) {
          return NextResponse.json(
            {
              error:
                'Le délai de restauration de 48 heures est dépassé : la séance va être supprimée définitivement.',
            },
            { status: 410 }
          )
        }
        await db.session.update({
          where: { id: session.id },
          data: { deletedAt: null },
        })
        return NextResponse.json({ ok: true })
      }

      case 'delete_forever': {
        // Suppression DÉFINITIVE et immédiate (tout est en cascade).
        await db.session.delete({ where: { id: session.id } })
        return NextResponse.json({ ok: true })
      }

      case 'duplicate_session': {
        // Copie PEDAGOGIQUE de la séance : questions iRAT/tRAT, cas
        // cliniques, nombre d'équipes et durée — SANS les données des
        // étudiants (noms, réponses, notes, réclamations, évaluations).
        // La copie repart de la phase d'accueil (lobby) avec un nouveau
        // code et un nouveau PIN.
        const pin = isValidPin(body.pin) ? normalizePin(body.pin) : randomCode(6)
        const [teams, freeQuestions, cases] = await Promise.all([
          db.team.findMany({
            where: { sessionId: session.id },
            orderBy: { number: 'asc' },
          }),
          db.question.findMany({
            where: { sessionId: session.id, caseId: null },
            orderBy: [{ phase: 'asc' }, { order: 'asc' }, { id: 'asc' }],
          }),
          db.case.findMany({
            where: { sessionId: session.id },
            orderBy: [{ order: 'asc' }, { id: 'asc' }],
          }),
        ])
        const newCode = await generateUniqueCode()
        const teacherToken = randomToken()
        const baseTitle = session.title.replace(/ \(copie( \d+)?\)$/, '')
        // Évite les « (copie) », « (copie) (copie) »… si on duplique une copie.
        let title = `${baseTitle} (copie)`
        for (let i = 2; ; i++) {
          const clash = await db.session.findFirst({
            where: { title, NOT: { id: session.id } },
            select: { id: true },
          })
          if (!clash) break
          title = `${baseTitle} (copie ${i})`
        }
        const copy = await db.session.create({
          data: {
            code: newCode,
            title,
            teacherPin: pin,
            teacherToken,
            iratMinutes: session.iratMinutes,
            status: 'lobby',
            teams: {
              create: teams.map((t) => ({ name: t.name, number: t.number })),
            },
            questions: {
              create: freeQuestions.map((q) => ({
                text: q.text,
                choices: q.choices,
                correct: q.correct,
                phase: q.phase,
                order: q.order,
              })),
            },
          },
        })
        // Cas cliniques : créés après la séance (chaque QCU référence
        // explicitement la nouvelle séance, cf. création de séance).
        for (const c of cases) {
          const caseQuestions = await db.question.findMany({
            where: { caseId: c.id },
            orderBy: [{ order: 'asc' }, { id: 'asc' }],
          })
          await db.case.create({
            data: {
              sessionId: copy.id,
              title: c.title,
              intro: c.intro,
              order: c.order,
              questions: {
                create: caseQuestions.map((q) => ({
                  sessionId: copy.id,
                  text: q.text,
                  choices: q.choices,
                  correct: q.correct,
                  phase: 'application' as const,
                  order: q.order,
                })),
              },
            },
          })
        }
        return NextResponse.json({
          ok: true,
          code: copy.code,
          teacherToken,
          title,
          pin,
        })
      }

      default:
        return NextResponse.json({ error: 'Action inconnue.' }, { status: 400 })
    }
  } catch (e) {
    console.error('POST /api/sessions/[code]/manage', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}
