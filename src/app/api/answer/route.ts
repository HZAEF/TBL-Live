import { NextRequest, NextResponse } from 'next/server'
import { withMetrics } from '@/lib/metrics'
import { db } from '@/lib/db'
import { bumpRevisions } from '@/lib/revision'
import { withSessionWrite, recordSessionEvent, eventOriginFromHeader } from '@/lib/write-queue'

// POST /api/answer — réponse individuelle (iRAT)
//
// v3.1.0 — IDEMPOTENCE (problème n°3 de l'audit) : le protocole
// « POST → timeout réseau → réessai » doit renvoyer le MÊME résultat,
// jamais une erreur. La réponse iRAT est identifiée par son unicité
// en base (@@unique([studentId, questionId, kind])) : la ligne ENREGI-
// STRÉE est elle-même la clé d'idempotence — inutile d'ajouter une
// table de clientMutationId qui doublerait les écritures du chemin
// chaud. Un réessai de la MÊME réponse renvoie donc { ok, duplicate }
// (traité comme un succès par l'étudiant) ; seule une réponse DIFFÉ-
// RENTE après enregistrement reste refusée (409).
async function doPOST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const token = body?.token
    const questionId = body?.questionId
    const choice = Number(body?.choice)
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
    if (student.session.status !== 'irat') {
      return NextResponse.json(
        { error: 'Le test individuel n\u2019est pas ouvert en ce moment.' },
        { status: 409 }
      )
    }

    const question = await db.question.findFirst({
      where: { id: questionId, sessionId: student.sessionId, phase: 'rat' },
    })
    if (!question) {
      return NextResponse.json({ error: 'Question introuvable.' }, { status: 404 })
    }
    const choices = JSON.parse(question.choices) as string[]
    if (choice < 0 || choice >= choices.length) {
      return NextResponse.json({ error: 'Choix invalide.' }, { status: 400 })
    }

    // v3.1.0 — FILE D'ÉCRITURE : la séquence « vérifier l'existence →
    // insérer » devient atomique pour la séance (verrou applicatif).
    // La contrainte unique @@unique([studentId, questionId, kind])
    // reste la protection ABSOLUE (elle seule rattrape les courses
    // inter-instances serverless) — la file élimine la contention
    // SQLite en local et rend le check-then-create fiable.
    const isCorrect = choice === question.correct
    const outcome = await withSessionWrite(student.sessionId, 'answer', async () => {
      const existing = await db.answer.findFirst({
        where: { questionId, studentId: student.id, kind: 'irat' },
        select: { choice: true },
      })
      if (existing) {
        // Réessai après timeout : la réponse est DÉJÀ enregistrée.
        // Même choix → succès idempotent (l'étudiant avance normalement,
        // aucun doute, aucune perte) ; autre choix → refus explicite.
        if (existing.choice === choice) return { duplicate: true } as const
        return { conflict: true } as const
      }
      try {
        await db.answer.create({
          data: {
            questionId,
            studentId: student.id,
            kind: 'irat',
            choice,
            attempt: 1,
            isCorrect,
            score: isCorrect ? 1 : 0,
          },
        })
      } catch (e) {
        // Course entre deux requêtes simultanées (double clic, réseau
        // mobile, réessai) : la contrainte unique garantit qu'une seule
        // réponse iRAT est enregistrée — jamais de double comptage. On
        // relit la ligne pour répondre de façon idempotente.
        if (
          e &&
          typeof e === 'object' &&
          'code' in e &&
          (e as { code?: string }).code === 'P2002'
        ) {
          const winner = await db.answer.findFirst({
            where: { questionId, studentId: student.id, kind: 'irat' },
            select: { choice: true },
          })
          if (winner && winner.choice === choice) return { duplicate: true } as const
          return { conflict: true } as const
        }
        throw e
      }
      return { created: true } as const
    })

    if ('conflict' in outcome) {
      return NextResponse.json(
        {
          error:
            'Vous avez déjà répondu à cette question avec un autre choix : la première réponse enregistrée est conservée.',
        },
        { status: 409 }
      )
    }
    if ('created' in outcome) {
      // v3.0.0 — Une réponse iRAT n'est visible NI par les autres
      // étudiants, NI par les équipes : SEUL le tableau de bord ensei-
      // gnant (progression) change → compteur enseignant SEUL. Avant,
      // le compteur étudiant global était incrémenté : chaque réponse
      // forçait les 149 autres étudiants à re-télécharger l'état
      // complet (150 réponses = 22 000 rechargements — c'était LA
      // tempête cachée des grandes classes). L'étudiant qui vient de
      // répondre voit SA réponse arriver par le rafraîchissement forcé
      // de son propre écran (pas par le compteur).
      await bumpRevisions(student.sessionId, { student: false })
      await recordSessionEvent(
        student.sessionId,
        'answer',
        questionId,
        { studentId: student.id, choice },
        eventOriginFromHeader(req.headers.get('x-tbl-origin'))
      )
    }

    // Pas de divulgation de la bonne réponse pendant l'iRAT.
    // duplicate: true → l'interface affiche « Enregistré » sans erreur.
    return NextResponse.json({ ok: true, duplicate: 'duplicate' in outcome })
  } catch (e) {
    console.error('POST /api/answer', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}

export const POST = withMetrics<unknown>(
  'answer',
  doPOST
)
