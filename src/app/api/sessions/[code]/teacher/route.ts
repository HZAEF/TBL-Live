import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionByCode, normalizePin, PIN_MAX_ATTEMPTS, PIN_LOCK_MINUTES } from '@/lib/tbl'
import { applyLifecycle } from '@/lib/session-lifecycle'

// POST /api/sessions/[code]/teacher — connexion enseignant (PIN)
//
// Anti force-brute : le code de la séance est public (affiché au tableau),
// mais le PIN ne peut PAS être deviné en essayant toutes les combinaisons :
// après 5 tentatives fausses, la connexion est verrouillée 15 minutes.
// Le compteur est stocké en base (Vercel est serverless, la mémoire d'une
// requête ne survit pas à la suivante). Une connexion réussie remet à zéro.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params
    const body = await req.json().catch(() => null)
    const pin = body?.pin
    if (typeof pin !== 'string') {
      return NextResponse.json({ error: 'Code PIN manquant.' }, { status: 400 })
    }
    let session = await getSessionByCode(code)
    if (!session) {
      return NextResponse.json({ error: 'Séance introuvable. Vérifiez le code.' }, { status: 404 })
    }
    // Cycle de vie (corbeille expirée → suppression définitive ; données
    // étudiantes de plus de 4 mois → purge). Une séance en corbeille NON
    // expirée reste connectable : l'enseignant doit pouvoir la restaurer.
    const live = await applyLifecycle(session)
    if (!live) {
      return NextResponse.json(
        { error: 'Cette séance a été supprimée définitivement (corbeille vidée).' },
        { status: 404 }
      )
    }
    session = live

    // Verrouillage en cours ?
    if (session.pinLockedUntil && session.pinLockedUntil > new Date()) {
      const minutes = Math.max(1, Math.ceil((session.pinLockedUntil.getTime() - Date.now()) / 60000))
      return NextResponse.json(
        {
          error: `Trop de tentatives incorrectes. La connexion est verrouillée pendant ${PIN_LOCK_MINUTES} minutes — patientez encore environ ${minutes} minute(s), puis réessayez.`,
        },
        { status: 429 }
      )
    }

    if (session.teacherPin !== normalizePin(pin)) {
      const attempts = session.pinAttempts + 1
      if (attempts >= PIN_MAX_ATTEMPTS) {
        // Dernière tentative consommée : on verrouille et on repart de zéro
        // ensuite (le compteur sera à 0 à l'expiration du verrouillage).
        await db.session.update({
          where: { id: session.id },
          data: {
            pinAttempts: 0,
            pinLockedUntil: new Date(Date.now() + PIN_LOCK_MINUTES * 60_000),
          },
        })
        return NextResponse.json(
          {
            error: `Trop de tentatives incorrectes. La connexion est verrouillée pendant ${PIN_LOCK_MINUTES} minutes.`,
          },
          { status: 429 }
        )
      }
      await db.session.update({
        where: { id: session.id },
        data: { pinAttempts: attempts },
      })
      const left = PIN_MAX_ATTEMPTS - attempts
      return NextResponse.json(
        {
          error: `Code PIN incorrect. Attention : il vous reste ${left} tentative${left > 1 ? 's' : ''} avant un verrouillage de ${PIN_LOCK_MINUTES} minutes.`,
        },
        { status: 401 }
      )
    }

    // Connexion réussie : on nettoie le compteur et le verrouillage éventuel
    if (session.pinAttempts !== 0 || session.pinLockedUntil) {
      await db.session.update({
        where: { id: session.id },
        data: { pinAttempts: 0, pinLockedUntil: null },
      })
    }

    return NextResponse.json({ code: session.code, teacherToken: session.teacherToken })
  } catch (e) {
    console.error('POST /api/sessions/[code]/teacher', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}
