import { NextRequest, NextResponse } from 'next/server'
import { withMetrics } from '@/lib/metrics'
import { db } from '@/lib/db'
import { bumpRevisions } from '@/lib/revision'
import { computeRevealedAppQuestionIds } from '@/lib/tbl-types'
import { withSessionWrite, recordSessionEvent, eventOriginFromHeader } from '@/lib/write-queue'

// POST /api/app-answer — réponse d'équipe à une question d'application.
// La réponse est enregistrée dès le choix (envoi automatique) ; elle peut
// être modifiée jusqu'à ce que la question soit révélée — c'est-à-dire
// dès que TOUTES les équipes actives y ont répondu, ou si l'enseignant
// force la révélation.
async function doPOST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const token = body?.token
    const questionId = body?.questionId
    const choice = Number(body?.choice)
    const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 2000) : ''
    if (typeof token !== 'string' || typeof questionId !== 'string' || !Number.isInteger(choice)) {
      return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })
    }

    const student = await db.student.findUnique({
      where: { token },
      include: { session: true },
    })
    if (!student) {
      return NextResponse.json({ error: 'Connexion perdue.' }, { status: 404 })
    }
    // Séance mise à la corbeille par l'enseignant : l'étudiant est bloqué.
    if (student.session.deletedAt) {
      return NextResponse.json(
        { error: 'Cette séance a été supprimée par l\u2019enseignant.' },
        { status: 410 }
      )
    }
    if (student.session.status !== 'application') {
      return NextResponse.json(
        { error: 'La phase d\u2019application n\u2019est pas ouverte.' },
        { status: 409 }
      )
    }
    if (!student.teamId) {
      return NextResponse.json({ error: 'Vous n\u2019êtes pas dans une équipe.' }, { status: 403 })
    }

    const question = await db.question.findFirst({
      where: { id: questionId, sessionId: student.sessionId, phase: 'application' },
    })
    if (!question) {
      return NextResponse.json({ error: 'Question introuvable.' }, { status: 404 })
    }
    const choices = JSON.parse(question.choices) as string[]
    if (choice < 0 || choice >= choices.length) {
      return NextResponse.json({ error: 'Choix invalide.' }, { status: 400 })
    }

    // v2.7.0 : un cas clinique non lancé par l'enseignant est INACCESSIBLE
    // — l'énoncé et les questions ne sont même pas envoyés aux étudiants,
    // et toute réponse directe (requête fabriquée) est refusée ici.
    if (question.caseId) {
      const c = await db.case.findUnique({ where: { id: question.caseId } })
      if (c && !c.opened) {
        return NextResponse.json(
          {
            error:
              'Ce cas clinique n’a pas encore été lancé par votre professeur — patientez, l’écran se mettra à jour tout seul.',
          },
          { status: 409 }
        )
      }
    }

    // v3.1.0 — FILE D'ÉCRITURE : tout le bloc « calculer l'état de
    // révélation → enregistrer la réponse » est atomique pour la
    // séance. Le réessai d'un envoi identique (timeout réseau) est
    // naturellement idempotent : la réponse d'application est un
    // UPSERT (création OU mise à jour de la même ligne) — le même
    // choix aboutit toujours au même état, aucune double effet.
    const origin = eventOriginFromHeader(req.headers.get('x-tbl-origin'))
    const teamId = student.teamId as string
    const outcome = await withSessionWrite(
      student.sessionId,
      'app-answer',
      async (): Promise<
        | { ok: true; revealedNow: boolean; duplicate: boolean }
        | { error: string; status: 409 }
      > => {
        // Révélation par question : une question dont toutes les équipes
        // actives ont répondu (ou que l'enseignant a forcée) est verrouillée.
        const [allAppQuestions, students, appAnswers] = await Promise.all([
          db.question.findMany({
            where: { sessionId: student.sessionId, phase: 'application' },
            select: { id: true },
          }),
          db.student.findMany({
            where: { sessionId: student.sessionId },
            select: { teamId: true },
          }),
          db.appAnswer.findMany({
            where: { question: { sessionId: student.sessionId } },
            select: { teamId: true, questionId: true, choice: true, text: true },
          }),
        ])
        const activeTeamIds = [
          ...new Set(students.filter((s) => s.teamId).map((s) => s.teamId as string)),
        ]
        // L'appAnswers SELECTé porte choice/text pour la détection de
        // doublon idempotent — la révélation n'utilise que team/question.
        const revealed = computeRevealedAppQuestionIds({
          appQuestionIds: allAppQuestions.map((q) => q.id),
          activeTeamIds,
          appAnswers: appAnswers.map((a) => ({ teamId: a.teamId, questionId: a.questionId })),
          forcedReveal: student.session.revealed,
        })
        if (revealed.includes(questionId)) {
          return {
            error:
              'Les réponses à cette question sont déjà révélées (toutes les équipes ont répondu) — plus de modification possible.',
            status: 409 as const,
          }
        }

        const existing = await db.appAnswer.findUnique({
          where: { teamId_questionId: { teamId, questionId } },
        })
        const duplicate = existing?.choice === choice && existing?.text === text
        if (existing) {
          await db.appAnswer.update({
            where: { id: existing.id },
            data: { choice, text },
          })
        } else {
          await db.appAnswer.create({
            data: { teamId, questionId, choice, text },
          })
        }

        // La réponse qui vient d'être enregistrée peut déclencher la révélation
        // de la question (si c'était la dernière équipe) : on le signale au client.
        const revealedNow = computeRevealedAppQuestionIds({
          appQuestionIds: [questionId],
          activeTeamIds,
          appAnswers: [
            ...appAnswers.map((a) => ({ teamId: a.teamId, questionId: a.questionId })),
            { teamId, questionId },
          ],
          forcedReveal: student.session.revealed,
        })
        return { ok: true as const, revealedNow: revealedNow.length > 0, duplicate }
      }
    )

    if ('error' in outcome) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status })
    }

    // v2.9.0 : réponse d'application enregistrée (et révélation
    // possible) → compteurs + 1.
    if (!outcome.duplicate) {
      await bumpRevisions(student.sessionId)
      await recordSessionEvent(
        student.sessionId,
        'app_answer',
        questionId,
        { teamId, choice },
        origin
      )
    }

    return NextResponse.json(outcome)
  } catch (e) {
    console.error('POST /api/app-answer', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}

export const POST = withMetrics<unknown>(
  'app-answer',
  doPOST
)
