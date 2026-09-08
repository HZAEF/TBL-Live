import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPin, verifyPin } from '@/lib/pin'
import { normalizePin, isValidPin, PIN_MAX_ATTEMPTS, PIN_LOCK_MINUTES } from '@/lib/tbl'
import { replaceSessionFromBackup, type SyncBackup } from '@/lib/sync'
import { bumpRevisions } from '@/lib/revision'

// POST /api/sessions/import — recrée (ou restaure) une séance à partir
// d'un fichier de sauvegarde, pour la déployer sur n'importe quel
// appareil.
//
// Deux formats :
//  - v2 « synchronisation » (jetons + PIN inclus, échangé entre
//    serveurs) : la séance est recréée À L'IDENTIQUE — mêmes jetons,
//    le PIN d'origine reste valable. Si la séance existe déjà ici,
//    le jeton du fichier doit correspondre (protection anti-détour-
//    nement : personne ne peut écraser une séance existante sans en
//    posséder le jeton enseignant).
//  - v1 « sauvegarde téléchargée » (bouton Sauvegarder, sans
//    secrets) : l'enseignant fournit un NOUVEAU code PIN ; les
//    étudiants retrouvent leurs comptes avec leur nom + code
//    personnel. Si la séance existe déjà ici (restauration), le PIN
//    fourni doit correspondre au PIN existant (5 tentatives →
//    verrouillage 15 minutes, comme la connexion enseignant).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const backup = body?.backup
    const pin = typeof body?.pin === 'string' ? normalizePin(body.pin) : ''
    const token = typeof body?.token === 'string' ? body.token : ''
    if (!backup || typeof backup !== 'object') {
      return NextResponse.json({ error: 'Fichier de sauvegarde manquant.' }, { status: 400 })
    }
    const b = backup as SyncBackup
    const code = typeof b.session?.code === 'string' ? b.session.code.toUpperCase() : ''
    if (code.length !== 6) {
      return NextResponse.json(
        { error: 'Ce fichier n’est pas une sauvegarde de séance valide.' },
        { status: 400 }
      )
    }
    const isV2 =
      b.format === 'tbl-live-sync' &&
      typeof b.secrets?.sessionId === 'string' &&
      typeof b.secrets?.teacherToken === 'string' &&
      b.secrets.teacherToken.length >= 32 &&
      typeof b.secrets?.teacherPin === 'string'

    // --- Séance déjà présente sur CET appareil ? ---
    const existing = await db.session.findUnique({ where: { code } })

    if (existing) {
      if (isV2) {
        // Anti-détournement : le jeton du fichier doit correspondre.
        if (b.secrets?.teacherToken !== existing.teacherToken) {
          return NextResponse.json(
            {
              error:
                'Cette séance existe déjà ici avec un jeton différent : le fichier ne correspond pas à cette séance.',
            },
            { status: 401 }
          )
        }
      } else {
        // Restauration d'une sauvegarde téléchargée : authentification
        // par PIN (avec le verrouillage anti force-brute habituel) ou
        // par jeton enseignant (import depuis le tableau de bord).
        const authed =
          (token.length > 0 && token === existing.teacherToken) ||
          (pin.length > 0 && (await verifyPin(existing.teacherPin, pin)).ok)
        if (!authed && pin.length > 0) {
          const attempts = existing.pinAttempts + 1
          const locked = attempts >= PIN_MAX_ATTEMPTS
          await db.session.update({
            where: { id: existing.id },
            data: {
              pinAttempts: locked ? 0 : attempts,
              pinLockedUntil: locked
                ? new Date(Date.now() + PIN_LOCK_MINUTES * 60_000)
                : existing.pinLockedUntil,
            },
          })
          return NextResponse.json(
            {
              error: locked
                ? `Trop de tentatives incorrectes. La restauration est verrouillée pendant ${PIN_LOCK_MINUTES} minutes.`
                : 'Code PIN incorrect pour restaurer cette séance.',
            },
            { status: locked ? 429 : 401 }
          )
        }
        if (!authed) {
          return NextResponse.json(
            {
              error:
                'Cette séance existe déjà : saisissez son code PIN actuel pour la restaurer.',
            },
            { status: 401 }
          )
        }
      }
    } else if (!isV2) {
      // Nouvelle séance depuis un fichier téléchargé : un PIN est exigé.
      if (!isValidPin(pin)) {
        return NextResponse.json(
          {
            error:
              'Choisissez un code PIN pour cette séance sur cet appareil (6 caractères et plus, chiffres et lettres).',
          },
          { status: 400 }
        )
      }
    }

    const hashedPin = isV2 ? undefined : await hashPin(pin)
    const { session } = await replaceSessionFromBackup(backup, hashedPin)

    // v2.9.0 — La séance vient d'être recréée : incrément EXPLICITE des
    // compteurs (en plus du +1 inscrit par replaceSessionFromBackup).
    // Les étudiants qui sondent avec un numéro antérieur à la
    // restauration recevront l'état complet neuf, jamais un « rien n'a
    // changé » par collision de numéros.
    await bumpRevisions(session.id)

    return NextResponse.json({
      ok: true,
      restored: !!existing,
      code: session.code,
      title: session.title,
      status: session.status,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur serveur inattendue.'
    console.error('POST /api/sessions/import', e)
    return NextResponse.json(
      {
        error: message.includes('sauvegarde') || message.includes('Fichier') || message.includes('fichier')
          ? message
          : 'Erreur serveur inattendue.',
      },
      { status: 400 }
    )
  }
}
