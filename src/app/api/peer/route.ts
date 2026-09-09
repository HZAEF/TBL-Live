import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { bumpRevisions } from '@/lib/revision'
import { withSessionWrite, recordSessionEvent, eventOriginFromHeader } from '@/lib/write-queue'

// POST /api/peer — évaluation par les pairs (coéquipiers)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const token = body?.token
    const evaluations = Array.isArray(body?.evaluations) ? body.evaluations : []
    if (typeof token !== 'string' || evaluations.length === 0) {
      return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })
    }
    if (evaluations.length > 20) {
      return NextResponse.json({ error: 'Trop d\u2019évaluations.' }, { status: 400 })
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
    if (student.session.status !== 'peer') {
      return NextResponse.json(
        { error: 'La phase d\u2019évaluation n\u2019est pas ouverte.' },
        { status: 409 }
      )
    }

    for (const ev of evaluations) {
      const evaluatedId = ev?.evaluatedId
      const score = Number(ev?.score)
      if (typeof evaluatedId !== 'string') continue
      if (!Number.isInteger(score) || score < 1 || score > 5) {
        return NextResponse.json(
          { error: 'Chaque note doit être entre 1 et 5.' },
          { status: 400 }
        )
      }
      if (evaluatedId === student.id) {
        return NextResponse.json(
          { error: 'Vous ne pouvez pas vous évaluer vous-même.' },
          { status: 400 }
        )
      }
      // L'évalué doit être un coéquipier
      const target = await db.student.findFirst({
        where: { id: evaluatedId, sessionId: student.sessionId },
      })
      if (!target || target.teamId !== student.teamId) {
        return NextResponse.json(
          { error: 'Vous ne pouvez évaluer que vos coéquipiers.' },
          { status: 400 }
        )
      }
    }

    // v3.1.0 — VERROU D'ÉCRITURE + IDEMPOTENCE : chaque évaluation est
    // un UPSERT par (évaluateur, évalué) — un réessai après timeout
    // réécrit les MÊMES valeurs, aucun double effet. La boucle
    // d'écriture est atomique pour la séance.
    const origin = eventOriginFromHeader(req.headers.get('x-tbl-origin'))
    await withSessionWrite(student.sessionId, 'peer', async () => {
      for (const ev of evaluations) {
        const evaluatedId = ev.evaluatedId as string
        const score = Number(ev.score)
        const comment = typeof ev.comment === 'string' ? ev.comment.trim().slice(0, 1000) : ''
        const existing = await db.peerEval.findUnique({
          where: { evaluatorId_evaluatedId: { evaluatorId: student.id, evaluatedId } },
        })
        if (existing) {
          await db.peerEval.update({
            where: { id: existing.id },
            data: { score, comment },
          })
        } else {
          await db.peerEval.create({
            data: {
              sessionId: student.sessionId,
              evaluatorId: student.id,
              evaluatedId,
              score,
              comment,
            },
          })
        }
      }
    })

    // v2.9.0 : évaluations par les pairs enregistrées → compteurs + 1.
    // v3.0.0 — Les évaluations par les pairs ne sont visibles que
    // par l'enseignant (moyennes/commentaires) : compteur enseignant
    // seul — l'étudiant qui vient de voter voit sa confirmation par
    // le rafraîchissement forcé de son propre écran.
    await bumpRevisions(student.sessionId, { student: false })
    await recordSessionEvent(
      student.sessionId,
      'peer',
      student.id,
      { count: evaluations.length },
      origin
    )

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('POST /api/peer', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}
