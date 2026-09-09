import { NextRequest, NextResponse } from 'next/server'
import { withMetrics } from '@/lib/metrics'
import { db } from '@/lib/db'
import { bumpTeamRevision } from '@/lib/revision'
import { withSessionWrite, recordSessionEvent, eventOriginFromHeader } from '@/lib/write-queue'

// Barème IF-AT : tentative 1 = 4 pts, tentative 2 = 2 pts, tentative 3 = 1 pt, ensuite 0
const TRAT_POINTS = [4, 2, 1, 0]

// POST /api/team-answer — réponse d'équipe (tRAT) avec feedback immédiat
//
// v3.1.0 — IDEMPOTENCE ROBUSTE (problème n°3) : la carte IF-AT a un
// piège que la contrainte unique ne couvre pas seule — après un
// TIMEOUT réseau, un réessai naïf recalculerait « tentative suivante »
// et gratterait une DEUXIÈME case pour le même choix (l'équipe perdrait
// des points). Le client envoie donc expectedAttempt = le nombre de
// tentatives qu'il a VUES (son état).
//
// v3.3.0 — CORRECTIF DU BUG FATAL « l'équipe ne peut plus gratter » :
// un client périmé (écran pas encore rafraîchi, coéquipier plus rapide,
// ou rafraîchissement servi depuis un cache d'état périmé — corrigé
// par ailleurs) envoyait expectedAttempt < nombre serveur et recevait
// 409 « behind » à CHAQUE tentative → boucle « envoi refusé / rien ne
// marche ». Désormais, quand le client est en retard :
//  a) son choix correspond à une tentative DÉJÀ enregistrée → on
//     renvoie le résultat de CETTE tentative (un réessai après timeout
//     ne peut JAMAIS re-gratter une case déjà ouverte — l'anti-double-
//     grattage v3.1 est conservé) ;
//  b) son choix est NOUVEAU (case encore fermée) → c'est un grattage
//     délibéré de l'équipe : on l'ACCEPTE comme tentative suivante au
//     barème réel — l'écran d'un membre ne bloque plus l'équipe.
// Le 409 « behind » ne survient plus que sur la vraie course à double
// insertion simultanée (contrainte unique P2002) : l'écran se
// resynchronise alors d'un cycle.
async function doPOST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const token = body?.token
    const questionId = body?.questionId
    const choice = Number(body?.choice)
    // v3.1.0 — nombre de tentatives déjà vues par le client (optionnel
    // pour compatibilité, mais toujours envoyé par l'interface v3.1).
    const expectedAttempt = Number(body?.expectedAttempt)
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
    if (student.session.status !== 'trat') {
      return NextResponse.json(
        { error: 'Le test en équipe n\u2019est pas ouvert en ce moment.' },
        { status: 409 }
      )
    }
    if (!student.teamId) {
      return NextResponse.json(
        { error: 'Vous n\u2019êtes pas dans une équipe. Prévenez votre professeur.' },
        { status: 403 }
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

    // v3.1.0 — ÉCRITURE SOUS VERROU DE SÉANCE : les lectures
    // (tentatives précédentes) ET l'insertion forment une séquence
    // ATOMIQUE pour la séance. Toujours SANS transaction interactive :
    // le verrou applicatif est court, la contrainte unique reste la
    // protection absolue (inter-instances serverless), et aucune
    // connexion n'est retenue pendant des secondes — les P1008 ne
    // reviennent pas.
    const origin = eventOriginFromHeader(req.headers.get('x-tbl-origin'))
    const teamId = student.teamId as string
    type TratOutcome =
      | {
          kind: 'result'
          attempt: number
          isCorrect: boolean
          score: number
          pointsIfCorrect: number
          duplicate?: boolean
        }
      | { kind: 'sync'; reason: 'behind' | 'found' | 'exhausted' }
    const outcome = await withSessionWrite<TratOutcome>(
      student.sessionId,
      'team-answer',
      async () => {
        const previous = await db.answer.findMany({
          where: { questionId, teamId, kind: 'trat' },
          orderBy: { attempt: 'asc' },
        })
        if (previous.some((a) => a.isCorrect)) {
          // La bonne réponse est déjà trouvée : rien à gratter. Si le
          // réessai concerne la tentative qui a GAGNÉ, on renvoie son
          // résultat (idempotence) ; sinon l'écran se resynchronise.
          if (Number.isInteger(expectedAttempt) && expectedAttempt >= 1) {
            const mine = previous.find((a) => a.attempt === expectedAttempt)
            if (mine) {
              return {
                kind: 'result',
                attempt: mine.attempt,
                isCorrect: mine.isCorrect,
                score: mine.score,
                pointsIfCorrect: 0,
                duplicate: true,
              }
            }
          }
          return { kind: 'sync', reason: 'found' }
        }
        if (previous.length >= 4) {
          return { kind: 'sync', reason: 'exhausted' }
        }
        // v3.3.0 — CLIENT EN RETARD (expectedAttempt < tentatives
        // serveur) : voir l'en-tête du fichier. Un choix DÉJÀ gratté
        // → on renvoie son résultat (jamais de re-grattage) ; un choix
        // NOUVEAU → on continue vers la création de la tentative
        // suivante (l'écran périmé d'un membre ne bloque plus son
        // équipe — c'était le cœur du bug fatal signalé).
        if (
          Number.isInteger(expectedAttempt) &&
          expectedAttempt >= 0 &&
          expectedAttempt < previous.length
        ) {
          const already = previous.find((a) => a.choice === choice)
          if (already) {
            return {
              kind: 'result',
              attempt: already.attempt,
              isCorrect: already.isCorrect,
              score: already.score,
              pointsIfCorrect: 0,
              duplicate: true,
            }
          }
          // choix nouveau : chute volontaire vers la tentative suivante
        }
        const attempt = previous.length + 1
        const isCorrect = choice === question.correct
        const score = isCorrect ? TRAT_POINTS[attempt - 1] : 0
        try {
          await db.answer.create({
            data: {
              questionId,
              teamId,
              kind: 'trat',
              choice,
              attempt,
              isCorrect,
              score,
            },
          })
        } catch (e) {
          if (
            e &&
            typeof e === 'object' &&
            'code' in e &&
            (e as { code?: string }).code === 'P2002'
          ) {
            // Double envoi simultané (même numéro de tentative) : l'autre
            // requête a enregistré cette tentative — on RELIT la ligne et
            // on renvoie son résultat exact (idempotence stricte).
            const winner = await db.answer.findFirst({
              where: { questionId, teamId, kind: 'trat', attempt },
            })
            if (winner && winner.choice === choice) {
              return {
                kind: 'result',
                attempt: winner.attempt,
                isCorrect: winner.isCorrect,
                score: winner.score,
                pointsIfCorrect: 0,
                duplicate: true,
              }
            }
            return { kind: 'sync', reason: 'behind' }
          }
          throw e
        }
        return {
          kind: 'result',
          attempt,
          isCorrect,
          score,
          pointsIfCorrect: TRAT_POINTS[attempt] ?? 0,
        }
      }
    )

    if (outcome.kind === 'sync') {
      // Aucun effet en base : l'état de l'équipe a AVANCÉ côté serveur,
      // le client doit rafraîchir (aucun point perdu, aucun doublon).
      // syncNeeded: true → le client rafraîchit au lieu de réenvoyer.
      if (outcome.reason === 'found') {
        return NextResponse.json(
          { error: 'Votre équipe a déjà trouvé la bonne réponse à cette question.', syncNeeded: true },
          { status: 409 }
        )
      }
      if (outcome.reason === 'exhausted') {
        return NextResponse.json(
          { error: 'Les 4 tentatives sont épuisées pour cette question.', syncNeeded: true },
          { status: 409 }
        )
      }
      return NextResponse.json(
        {
          error:
            'Votre équipe vient de gratter une autre tentative — l\u2019écran se met à jour.',
          syncNeeded: true,
        },
        { status: 409 }
      )
    }

    // v2.9.0 : tentative tRAT enregistrée → compteurs + 1.
    // v3.0.0 — La tentative tRAT est visible par les MEMBRES DE
    // L'ÉQUIPE uniquement (carte à gratter) + le tableau de bord :
    // compteur d'équipe, PAS la révision globale. Les autres équipes
    // n'ont rien à renouveler — chacune progresse à son rythme sans
    // déclencher de tempête de rechargements chez toute la classe.
    if (!outcome.duplicate) {
      await bumpTeamRevision(student.sessionId, teamId)
      await recordSessionEvent(
        student.sessionId,
        'team_answer',
        questionId,
        { teamId, choice, attempt: outcome.attempt },
        origin
      )
    }

    return NextResponse.json(outcome)
  } catch (e) {
    console.error('POST /api/team-answer', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}

export const POST = withMetrics<unknown>(
  'team-answer',
  doPOST
)
