import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { extractToken } from '@/lib/tbl'

// POST /api/sai — soumission du questionnaire de fin de séance (TBL-SAI).
//
// v2.6.0 : l'étudiant répond au questionnaire pour accéder à sa note
// finale et à son rang. Verrous serveur :
//  - jeton étudiant requis (en-tête Authorization, repli ?token=) ;
//  - séance en corbeille → 410 (comme /api/student) ;
//  - séance non terminée → 409 (le questionnaire n'est proposé qu'à la fin) ;
//  - TOUTES les questions de la séance doivent être renseignées, valeurs
//    1 à 5 uniquement ;
//  - idempotent : une seconde soumission ne modifie RIEN (réponses et
//    commentaires initiaux conservés, la date de complétion aussi).
// Le commentaire facultatif (≤ 1000 caractères) est transmis avec les
// réponses et visible par l'enseignant dans la rubrique Questionnaire.
export async function POST(req: NextRequest) {
  try {
    const token = extractToken(req)
    if (!token) {
      return NextResponse.json({ error: 'Jeton manquant.' }, { status: 400 })
    }
    const student = await db.student.findUnique({
      where: { token },
      include: { session: true },
    })
    if (!student) {
      return NextResponse.json(
        { error: 'Connexion perdue. Rejoignez à nouveau la séance.' },
        { status: 404 }
      )
    }
    if (student.session.deletedAt) {
      return NextResponse.json(
        { error: 'Cette séance a été supprimée par l\u2019enseignant.' },
        { status: 410 }
      )
    }
    if (student.session.status !== 'finished') {
      return NextResponse.json(
        {
          error:
            'Cette séance n\u2019est pas terminée : le questionnaire est proposé aux étudiants à la fin.',
        },
        { status: 409 }
      )
    }

    // Idempotence : un questionnaire déjà soumis n'est jamais modifié
    // (ni les réponses, ni le commentaire, ni la date de complétion).
    if (student.saiCompletedAt) {
      return NextResponse.json({ ok: true, alreadyCompleted: true })
    }

    const body = await req.json().catch(() => null)
    const rawResponses = Array.isArray(body?.responses) ? body.responses : null
    const comment =
      typeof body?.comment === 'string' ? body.comment.trim().slice(0, 1000) : ''

    // Les items de la séance (source de vérité : la base, pas le client)
    const items = await db.saiItem.findMany({
      where: { sessionId: student.sessionId },
      select: { id: true },
    })
    if (items.length === 0) {
      // Séance sans questionnaire (créée avant la v2.6.0) : accès direct
      // à la note — on marque la complétion sans réponses.
      await db.student.update({
        where: { id: student.id },
        data: { saiCompletedAt: new Date(), saiComment: comment || null },
      })
      return NextResponse.json({ ok: true })
    }

    if (!rawResponses) {
      return NextResponse.json(
        { error: 'Toutes les questions du questionnaire doivent être renseignées.' },
        { status: 400 }
      )
    }

    // Validation : chaque item exactement une fois, valeur entière 1 à 5.
    const byItem = new Map<string, number>()
    for (const r of rawResponses) {
      const itemId = typeof r?.itemId === 'string' ? r.itemId : ''
      const value = Number(r?.value)
      if (
        !itemId ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > 5 ||
        byItem.has(itemId)
      ) {
        return NextResponse.json({ error: 'Valeur invalide (1 à 5).' }, { status: 400 })
      }
      byItem.set(itemId, value)
    }
    for (const it of items) {
      if (!byItem.has(it.id)) {
        return NextResponse.json(
          { error: 'Toutes les questions du questionnaire doivent être renseignées.' },
          { status: 400 }
        )
      }
    }

    // Enregistrement atomique : réponses + date de complétion + commentaire.
    await db.$transaction([
      db.saiResponse.createMany({
        data: items.map((it) => ({
          studentId: student.id,
          itemId: it.id,
          value: byItem.get(it.id) as number,
        })),
      }),
      db.student.update({
        where: { id: student.id },
        data: { saiCompletedAt: new Date(), saiComment: comment || null },
      }),
    ])

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('POST /api/sai', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}
