import { NextRequest, NextResponse } from 'next/server'
import type { Session } from '@prisma/client'
import { db } from '@/lib/db'
import {
  getSessionByCode,
  PHASES,
  sanitizeQuestionInput,
  parseChoices,
  generateUniqueCode,
  randomToken,
  randomCode,
  isValidPin,
  normalizePin,
  safeEqualStrings,
} from '@/lib/tbl'
import { hashPin } from '@/lib/pin'
import { isTrashExpired } from '@/lib/session-lifecycle'
import { SAI_SUBSCALES, DEFAULT_SAI_ITEMS } from '@/lib/sai'
import { buildSyncBackup, syncNow, normalizeRemoteUrl, SyncError } from '@/lib/sync'
import { bumpRevisions } from '@/lib/revision'
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

// ------------------------------------------------------------
// v2.9.0 — Réordonnancement des QCM (demande de l'enseignante) :
// monter/descendre une question, déplacer une réponse, tout
// mélanger au hasard. Les réponses DÉJÀ ENREGISTRÉES suivent leur
// texte : l'indice choisi est répercuté par permutation, les scores
// et la docimologie restent exacts — que le réordonnancement ait
// lieu avant, pendant ou après les épreuves.
// ------------------------------------------------------------

/** Détecte une pure réorganisation des choix : mêmes textes, ordre
 *  différent. Renvoie perm[ancienIndex] = nouvelIndex, null si les
 *  textes ont réellement changé (édition, pas déplacement). */
function choicePermutation(oldChoices: string[], newChoices: string[]): number[] | null {
  if (oldChoices.length !== newChoices.length) return null
  const used = new Array(newChoices.length).fill(false)
  const perm = new Array<number>(oldChoices.length).fill(-1)
  for (let i = 0; i < oldChoices.length; i++) {
    const text = oldChoices[i]
    let j = -1
    for (let k = 0; k < newChoices.length; k++) {
      if (!used[k] && newChoices[k] === text) {
        j = k
        break
      }
    }
    if (j < 0) return null
    used[j] = true
    perm[i] = j
  }
  return perm
}

/** Répercute une permutation de choix sur toutes les réponses déjà
 *  enregistrées pour la question (iRAT, tRAT, application) : chaque
 *  indice choisi suit le texte de la réponse cochée. updatedAt est
 *  rafraîchi pour que la fusion Internet ↔ réseau local adopte la
 *  version la plus récente. */
async function remapQuestionAnswers(questionId: string, perm: number[]): Promise<void> {
  const changed = new Map<string, number>()
  for (let old = 0; old < perm.length; old++) {
    if (perm[old] !== old) changed.set(String(old), perm[old])
  }
  if (changed.size === 0) return
  const answers = await db.answer.findMany({
    where: { questionId },
    select: { id: true, choice: true },
  })
  for (const a of answers) {
    const nc = changed.get(String(a.choice))
    if (nc !== undefined) {
      await db.answer.update({
        where: { id: a.id },
        data: { choice: nc, updatedAt: new Date() },
      })
    }
  }
  const appAnswers = await db.appAnswer.findMany({
    where: { questionId },
    select: { id: true, choice: true },
  })
  for (const a of appAnswers) {
    const nc = changed.get(String(a.choice))
    if (nc !== undefined) {
      await db.appAnswer.update({
        where: { id: a.id },
        data: { choice: nc, updatedAt: new Date() },
      })
    }
  }
}

/** Applique une permutation de choix à une question : réécrit la
 *  liste, déplace l'indice de la bonne réponse et répercute sur les
 *  réponses enregistrées. Utilisé par « Mélanger » (aléatoire) — la
 *  permutation est fournie par l'appelant. */
async function permuteQuestionChoices(
  question: { id: string; choices: string; correct: number },
  perm: number[]
): Promise<void> {
  const oldChoices = JSON.parse(question.choices) as string[]
  const newChoices = perm.map((newIdx) => oldChoices[newIdx])
  // La bonne réponse suit son texte : nouvel indice du texte pointé
  // par l'ancien indice correct.
  const newCorrect = perm.indexOf(question.correct)
  await db.question.update({
    where: { id: question.id },
    data: {
      choices: JSON.stringify(newChoices),
      correct: newCorrect >= 0 ? newCorrect : question.correct,
      updatedAt: new Date(),
    },
  })
  // Réponses enregistrées : l'indice ancien old devient perm[old] →
  // il faut la permutation INVERSE pour traduire ancien → nouveau.
  // perm[newIdx] = oldIdx ; inverse[oldIdx] = newIdx.
  const inverse: number[] = []
  for (let newIdx = 0; newIdx < perm.length; newIdx++) inverse[perm[newIdx]] = newIdx
  await remapQuestionAnswers(question.id, inverse)
}

/** Mélange de Fisher-Yates (uniforme, non biaisé). */
function shuffledIndices(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
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
    if (!safeEqualStrings(token, session.teacherToken)) {
      return NextResponse.json({ error: 'Accès refusé. Reconnectez-vous.' }, { status: 401 })
    }

    // Séance en corbeille : les étudiants n'ont plus accès, le déroulé est
    // figé. Seules la restauration, la sauvegarde (on peut vouloir archiver
    // juste avant de supprimer définitivement) et la suppression
    // définitive sont admises.
    if (
      session.deletedAt &&
      action !== 'restore_session' &&
      action !== 'delete_forever' &&
      action !== 'export_backup'
    ) {
      return NextResponse.json(
        {
          error:
            'Cette séance est dans la corbeille. Restaurez-la d\u2019abord (bouton « Restaurer ») pour pouvoir la modifier.',
        },
        { status: 409 }
      )
    }

    // v2.9.0 — EXTRACTION : le commutateur des actions vit désormais dans
    // runManageAction (ci-dessous) — POST garde l'authentification ET les
    // compteurs de révision du sondage allégé.
    const res = await runManageAction(session, body as Record<string, unknown>, action)

    // v2.9.0 — Sondage allégé : toute action qui MODIFIE la séance
    // incrémente les compteurs (étudiants + tableau de bord renouvellent
    // leur état au prochain sondage). Sont exclues les actions de pure
    // lecture (exports) et la synchronisation (la fusion gère elle-même
    // ses compteurs). Un échec d'action (4xx/5xx) ne compte pas.
    if (
      res.status >= 200 &&
      res.status < 300 &&
      action !== 'export_sync' &&
      action !== 'export_backup' &&
      action !== 'sync_now'
    ) {
      await bumpRevisions(session.id)
    }
    return res
  } catch (e) {
    console.error('POST /api/sessions/[code]/manage', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}

// ------------------------------------------------------------
// v2.9.0 — Commutateur des actions enseignant (extrait de POST).
// Renvoie la réponse HTTP ; l'authentification et les compteurs de
// révision restent dans POST.
// ------------------------------------------------------------
async function runManageAction(
  session: Session,
  body: Record<string, unknown>,
  action: string
): Promise<NextResponse> {
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
            // v2.7.0 : en entrant dans le feedback, les étudiants voient
            // d'abord l'écran d'attente — l'enseignant lance l'affichage
            // des résultats avec « Lancer le feedback » (launch_feedback).
            feedbackReady: phase === 'feedback' ? false : session.feedbackReady,
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
        // v2.7.0 : en entrant dans la phase d'application, tous les cas
        // cliniques redeviennent NON lancés — l'enseignant ouvre chaque cas
        // au moment de l'expliquer (boutons « Lancer le cas clinique N »).
        if (phase === 'application') {
          await db.case.updateMany({
            where: { sessionId: session.id },
            data: { opened: false },
          })
        }
        return NextResponse.json({ ok: true })
      }

      // v2.7.0 — Lancer l'affichage du feedback aux étudiants (fin de
      // l'écran d'attente entre réclamations et feedback).
      case 'launch_feedback': {
        if (session.status !== 'feedback') {
          return NextResponse.json(
            { error: 'La phase de feedback n’est pas ouverte.' },
            { status: 409 }
          )
        }
        await db.session.update({
          where: { id: session.id },
          data: { feedbackReady: true },
        })
        return NextResponse.json({ ok: true })
      }

      // v2.7.0 — Lancer un cas clinique. v2.8.2 : un seul cas ouvert à la
      // fois — l'enseignant est LE pilote : lancer le cas N fait tourner
      // la page de toute la classe sur ce cas (énoncé + questions) et
      // referme le précédent ; aucun bouton de navigation côté étudiant.
      // Relancer un cas plus ancien le rouvre pour toute la classe
      // (retour volontaire, p. ex. pour en reparler). updatedAt est
      // horodaté pour que la fusion Internet ↔ réseau local adopte
      // l'état d'ouverture le plus récent (voir sync.ts).
      case 'open_case': {
        const caseId = typeof body.caseId === 'string' ? body.caseId : ''
        if (session.status !== 'application') {
          return NextResponse.json(
            { error: 'La phase d’application n’est pas ouverte.' },
            { status: 409 }
          )
        }
        const c = await db.case.findFirst({
          where: { id: caseId, sessionId: session.id },
        })
        if (!c) {
          return NextResponse.json({ error: 'Cas clinique introuvable.' }, { status: 404 })
        }
        if (!c.opened) {
          const now = new Date()
          await db.$transaction([
            db.case.updateMany({
              where: { sessionId: session.id, id: { not: c.id } },
              data: { opened: false, updatedAt: now },
            }),
            db.case.update({
              where: { id: c.id },
              data: { opened: true, updatedAt: now },
            }),
          ])
        }
        return NextResponse.json({ ok: true })
      }

      // v2.7.0 — Modifier le titre de la séance (onglet Configurations).
      case 'set_title': {
        const title = typeof body.title === 'string' ? body.title.trim() : ''
        if (title.length < 2 || title.length > 120) {
          return NextResponse.json(
            { error: 'Le titre doit contenir entre 2 et 120 caractères.' },
            { status: 400 }
          )
        }
        await db.session.update({ where: { id: session.id }, data: { title } })
        return NextResponse.json({ ok: true })
      }

      // v2.7.0 — Changer le code PIN enseignant (onglet Configurations).
      case 'set_pin': {
        const pin = typeof body.pin === 'string' ? body.pin : ''
        if (!isValidPin(pin)) {
          return NextResponse.json(
            {
              error:
                'Le code PIN doit contenir 6 à 12 caractères, chiffres et lettres (sans accents ni symboles).',
            },
            { status: 400 }
          )
        }
        await db.session.update({
          where: { id: session.id },
          data: { teacherPin: await hashPin(normalizePin(pin)), pinAttempts: 0, pinLockedUntil: null },
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
            // v2.9.0 : horodatage pour la fusion Internet ↔ local
            updatedAt: new Date(),
            // Une question qui quitte la phase application perd son cas
            caseId: q.phase === 'application' ? existing.caseId : null,
          },
        })
        // v2.9.0 — RÉORDONNANCEMENT DES RÉPONSES : si la nouvelle liste de
        // choix est une pure réorganisation de l'ancienne (mêmes textes,
        // ordre différent — l'enseignant a déplacé une réponse avec les
        // flèches de l'éditeur), les réponses DÉJÀ ENREGISTRÉES suivent
        // leur texte : scores et docimologie restent exacts.
        const perm = choicePermutation(parseChoices(existing.choices), q.choices)
        if (perm) {
          await remapQuestionAnswers(id, perm)
        }
        // Si la question change de phase (rat ↔ application), on renumérote
        // les deux listes pour garder des ordres consécutifs sans doublons.
        if (q.phase !== existing.phase) {
          if (existing.caseId) await renumberCase(existing.caseId)
          await renumberPhase(session.id, existing.phase)
          await renumberPhase(session.id, q.phase)
        }
        return NextResponse.json({ ok: true })
      }

      // v2.9.0 — Déplacer une question dans sa liste (flèches ↑ / ↓ de
      // l'onglet Questions). Le déplacement reste DANS le même groupe
      // (questions iRAT/tRAT entre elles, QCU d'un même cas entre
      // elles) : l'ordre des autres listes n'est jamais touché.
      case 'move_question': {
        const id = typeof body.id === 'string' ? body.id : ''
        const direction = body.direction === -1 ? -1 : body.direction === 1 ? 1 : 0
        if (!id || direction === 0) {
          return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })
        }
        const q = await db.question.findFirst({ where: { id, sessionId: session.id } })
        if (!q) {
          return NextResponse.json({ error: 'Question introuvable.' }, { status: 404 })
        }
        const group = await db.question.findMany({
          where: { sessionId: session.id, phase: q.phase, caseId: q.caseId },
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
        })
        // Normalisation préalable (ordres égaux possibles en base ancienne)
        for (let i = 0; i < group.length; i++) {
          if (group[i].order !== i) {
            await db.question.update({ where: { id: group[i].id }, data: { order: i } })
            group[i].order = i
          }
        }
        const idx = group.findIndex((x) => x.id === id)
        const target = idx + direction
        if (idx < 0 || target < 0 || target >= group.length) {
          return NextResponse.json(
            { error: 'La question est déjà en bout de liste.' },
            { status: 400 }
          )
        }
        // Échange des ordres des deux questions voisines.
        await db.$transaction([
          db.question.update({
            where: { id: group[idx].id },
            data: { order: target, updatedAt: new Date() },
          }),
          db.question.update({
            where: { id: group[target].id },
            data: { order: idx, updatedAt: new Date() },
          }),
        ])
        return NextResponse.json({ ok: true })
      }

      // v2.9.0 — MÉLANGER au hasard (bouton « Aléatoire ») : les
      // questions du groupe demandé sont redistribuées (la question 1
      // peut devenir la n° 4, etc.) ET, dans chaque question, les
      // réponses sont redistribuées elles aussi (la réponse B d'une
      // question peut devenir la réponse E). Les réponses déjà
      // enregistrées suivent leur texte — rien n'est perdu ni faussé.
      // Portée : 'rat' (questions iRAT/tRAT), 'free-app' (exercices
      // libres) ou l'identifiant d'un cas clinique (ses QCU).
      case 'shuffle_quiz': {
        const scope = typeof body.scope === 'string' ? body.scope : ''
        let questions: { id: string; choices: string; correct: number; order: number }[]
        if (scope === 'rat') {
          questions = await db.question.findMany({
            where: { sessionId: session.id, phase: 'rat' },
            orderBy: [{ order: 'asc' }, { id: 'asc' }],
            select: { id: true, choices: true, correct: true, order: true },
          })
        } else if (scope === 'free-app') {
          questions = await db.question.findMany({
            where: { sessionId: session.id, phase: 'application', caseId: null },
            orderBy: [{ order: 'asc' }, { id: 'asc' }],
            select: { id: true, choices: true, correct: true, order: true },
          })
        } else {
          const kase = await db.case.findFirst({
            where: { id: scope, sessionId: session.id },
            select: { id: true },
          })
          if (!kase) {
            return NextResponse.json({ error: 'Cas clinique introuvable.' }, { status: 404 })
          }
          questions = await db.question.findMany({
            where: { caseId: kase.id },
            orderBy: [{ order: 'asc' }, { id: 'asc' }],
            select: { id: true, choices: true, correct: true, order: true },
          })
        }
        if (questions.length < 2) {
          return NextResponse.json(
            { error: 'Il faut au moins deux questions pour pouvoir mélanger.' },
            { status: 400 }
          )
        }
        // 1) Ordre aléatoire des questions du groupe.
        const newOrder = shuffledIndices(questions.length)
        for (let i = 0; i < questions.length; i++) {
          if (questions[i].order !== newOrder[i]) {
            await db.question.update({
              where: { id: questions[i].id },
              data: { order: newOrder[i], updatedAt: new Date() },
            })
          }
        }
        // 2) Réponses redistribuées dans CHAQUE question (2 choix ou plus).
        for (const question of questions) {
          const choices = parseChoices(question.choices)
          if (choices.length >= 2) {
            await permuteQuestionChoices(question, shuffledIndices(choices.length))
          }
        }
        return NextResponse.json({ ok: true, shuffled: questions.length })
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

      // ----- v2.6.0 : questionnaire de fin de séance (TBL-SAI) -----
      // Édition des items par l'enseignant. GARDE-FOUS : la suppression
      // d'un item (et la réinitialisation complète) est refusée dès que
      // des réponses existent — les réponses étant liées par cascade,
      // les effacer reviendrait à fausser les résultats déjà collectés.
      // La modification du libellé reste toujours possible (elle ne
      // touche ni les réponses ni les moyennes).

      case 'sai_update_item': {
        const id = typeof body.id === 'string' ? body.id : ''
        const rawText = typeof body.text === 'string' ? body.text.trim() : ''
        const restoreDefault = body.text === null
        const reversed = body.reversed === true
        const item = await db.saiItem.findFirst({
          where: { id, sessionId: session.id },
          include: { _count: { select: { responses: true } } },
        })
        if (!item) {
          return NextResponse.json({ error: 'Item introuvable.' }, { status: 404 })
        }
        // null = restaurer le libellé standard (multilingue i18n) ;
        // sinon le texte personnalisé remplace la traduction partout.
        let text: string | null
        if (restoreDefault) {
          text = null
        } else {
          if (rawText.length < 3 || rawText.length > 500) {
            return NextResponse.json(
              { error: 'Le libellé de l\u2019item doit contenir au moins 3 caractères.' },
              { status: 400 }
            )
          }
          text = rawText
        }
        await db.saiItem.update({
          where: { id: item.id },
          data: { text, reversed },
        })
        return NextResponse.json({ ok: true })
      }

      case 'sai_add_item': {
        const subscale = typeof body.subscale === 'string' ? body.subscale : ''
        const text = typeof body.text === 'string' ? body.text.trim() : ''
        const reversed = body.reversed === true
        if (!SAI_SUBSCALES.includes(subscale as (typeof SAI_SUBSCALES)[number])) {
          return NextResponse.json({ error: 'Sous-échelle inconnue.' }, { status: 400 })
        }
        if (text.length < 3 || text.length > 500) {
          return NextResponse.json(
            { error: 'Le libellé de l\u2019item doit contenir au moins 3 caractères.' },
            { status: 400 }
          )
        }
        const last = await db.saiItem.findFirst({
          where: { sessionId: session.id },
          orderBy: { order: 'desc' },
          select: { order: true },
        })
        await db.saiItem.create({
          data: {
            sessionId: session.id,
            subscale,
            textKey: null, // item de l'enseignant : affiché tel quel
            text,
            reversed,
            order: (last?.order ?? -1) + 1,
          },
        })
        return NextResponse.json({ ok: true })
      }

      case 'sai_delete_item': {
        const id = typeof body.id === 'string' ? body.id : ''
        const item = await db.saiItem.findFirst({
          where: { id, sessionId: session.id },
          include: { _count: { select: { responses: true } } },
        })
        if (!item) {
          return NextResponse.json({ error: 'Item introuvable.' }, { status: 404 })
        }
        if (item._count.responses > 0) {
          return NextResponse.json(
            {
              error:
                'Cet item a reçu des réponses : il ne peut plus être supprimé (son libellé reste modifiable).',
            },
            { status: 409 }
          )
        }
        await db.saiItem.delete({ where: { id: item.id } })
        return NextResponse.json({ ok: true })
      }

      case 'sai_reset': {
        // Réinitialisation complète aux 33 items standard. Refusée dès
        // qu'UNE réponse existe (les items personnalisés et leurs réponses
        // seraient supprimés en cascade par la réinitialisation).
        const anyResponse = await db.saiResponse.findFirst({
          where: { student: { sessionId: session.id } },
          select: { id: true },
        })
        if (anyResponse) {
          return NextResponse.json(
            {
              error:
                'Des étudiants ont déjà répondu au questionnaire : la réinitialisation est bloquée (les réponses associées seraient perdues).',
            },
            { status: 409 }
          )
        }
        await db.saiItem.deleteMany({ where: { sessionId: session.id } })
        await db.saiItem.createMany({
          data: DEFAULT_SAI_ITEMS.map((it, i) => ({
            sessionId: session.id,
            subscale: it.subscale,
            textKey: it.key,
            text: null,
            reversed: it.reversed,
            order: i,
          })),
        })
        return NextResponse.json({ ok: true })
      }

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
        const [teams, freeQuestions, cases, saiItems] = await Promise.all([
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
          // v2.6.0 : le questionnaire TBL-SAI fait partie de la copie
          // pédagogique (items, libellés personnalisés, ordre) — jamais
          // les réponses des étudiants.
          db.saiItem.findMany({
            where: { sessionId: session.id },
            orderBy: [{ order: 'asc' }, { id: 'asc' }],
          }),
        ])
        const newCode = await generateUniqueCode()
        const teacherToken = randomToken()
        // v2.4.0 : le PIN de la copie est stocké haché, comme à la création.
        const teacherPinHash = await hashPin(pin)
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
            teacherPin: teacherPinHash,
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
        // v2.6.0 : copie du questionnaire TBL-SAI (items uniquement).
        if (saiItems.length > 0) {
          await db.saiItem.createMany({
            data: saiItems.map((it) => ({
              sessionId: copy.id,
              subscale: it.subscale,
              textKey: it.textKey,
              text: it.text,
              reversed: it.reversed,
              order: it.order,
            })),
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

      // v2.7.0 — Sauvegarde v2 AVEC secrets (jetons + PIN haché) pour la
      // synchronisation serveur ↔ serveur. Jamais exposée au navigateur :
      // ce format est tiré/poussé par les serveurs eux-mêmes. La demande
      // doit venir d'une instance qui possède déjà le jeton enseignant.
      case 'export_sync': {
        return NextResponse.json(await buildSyncBackup(session))
      }

      // v2.7.0 — Synchronisation complète avec la version en ligne :
      // tirer les contributions distantes → fusionner → pousser l'état
      // complet (miroir exact, mêmes identifiants → aucun doublon,
      // aucun conflit). Une panne de réseau interrompt la synchronisation,
      // jamais la séance locale.
      case 'sync_now': {
        const remoteUrl = normalizeRemoteUrl(body.remoteUrl)
        if (!remoteUrl) {
          return NextResponse.json(
            { error: 'Adresse de la version en ligne invalide (ex. https://mon-tbl.vercel.app).' },
            { status: 400 }
          )
        }
        try {
          const result = await syncNow(session, remoteUrl)
          return NextResponse.json(result)
        } catch (e) {
          if (e instanceof SyncError) {
            return NextResponse.json({ error: e.message }, { status: 502 })
          }
          console.error('sync_now', e)
          return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
        }
      }

      case 'export_backup': {
        // v2.4.0 — Sauvegarde complète de la séance (JSON) : copie hors-ligne
        // de TOUTES les données — questions, cas, équipes, étudiants (avec
        // leurs codes de reprise), réponses, réclamations, évaluations.
        // À télécharger avant chaque mise à jour de l'application.
        // Les secrets (PIN haché, jetons enseignant/étudiants) sont exclus.
        const [teams, students, questions, cases, answers, appeals, appAnswers, peerEvals, saiItems, saiResponses] =
          await Promise.all([
            db.team.findMany({
              where: { sessionId: session.id },
              orderBy: { number: 'asc' },
            }),
            db.student.findMany({
              where: { sessionId: session.id },
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                name: true,
                teamId: true,
                recoveryCode: true,
                saiCompletedAt: true,
                saiComment: true,
                createdAt: true,
              },
            }),
            db.question.findMany({
              where: { sessionId: session.id },
              orderBy: [{ order: 'asc' }, { id: 'asc' }],
            }),
            db.case.findMany({
              where: { sessionId: session.id },
              orderBy: [{ order: 'asc' }, { id: 'asc' }],
            }),
            db.answer.findMany({
              where: { question: { sessionId: session.id } },
              orderBy: { createdAt: 'asc' },
            }),
            db.appeal.findMany({
              where: { sessionId: session.id },
              orderBy: { createdAt: 'asc' },
            }),
            db.appAnswer.findMany({
              where: { team: { sessionId: session.id } },
            }),
            db.peerEval.findMany({
              where: { sessionId: session.id },
              orderBy: { createdAt: 'asc' },
            }),
            // v2.6.0 : questionnaire TBL-SAI (items + réponses + complétion)
            db.saiItem.findMany({
              where: { sessionId: session.id },
              orderBy: [{ order: 'asc' }, { id: 'asc' }],
            }),
            db.saiResponse.findMany({
              where: { student: { sessionId: session.id } },
              orderBy: { createdAt: 'asc' },
            }),
          ])
        return NextResponse.json({
          format: 'tbl-live-sauvegarde',
          version: 1,
          exportedAt: new Date().toISOString(),
          session: {
            code: session.code,
            title: session.title,
            status: session.status,
            iratMinutes: session.iratMinutes,
            createdAt: session.createdAt,
            deletedAt: session.deletedAt,
            dataPurgedAt: session.dataPurgedAt,
          },
          teams,
          students,
          questions,
          cases,
          answers,
          appeals,
          appAnswers,
          peerEvals,
          // v2.6.0 : questionnaire TBL-SAI — items et réponses
          saiItems,
          saiResponses,
        })
      }

      default:
        return NextResponse.json({ error: 'Action inconnue.' }, { status: 400 })
    }
}
