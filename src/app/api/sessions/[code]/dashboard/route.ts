import { NextRequest, NextResponse } from 'next/server'
import { withMetrics } from '@/lib/metrics'
import { db } from '@/lib/db'
import { getSessionByCode, parseChoices, extractToken, safeEqualStrings } from '@/lib/tbl'
import { applyLifecycle } from '@/lib/session-lifecycle'
import { readRevParam } from '@/lib/revision'
import { listCollaboratorsDetailed } from '@/lib/sharing'
import { safeEventPayload, TEACHER_EVENT_TYPES } from '@/lib/write-queue'

// GET /api/sessions/[code]/dashboard — données complètes du tableau de bord
// enseignant. Jeton transmis par l'en-tête « Authorization: Bearer … » (les
// URL des appels API ne contiennent plus le jeton → il n'apparaît pas dans
// les journaux serveur) ; le repli ?token= reste accepté (onglets ouverts
// avant une mise à jour de l'application).
//
// v2.9.0 — SONDAGE ALLÉGÉ : ?rev=N → si le compteur enseignant de la
// séance vaut toujours N, réponse minuscule { unchanged: true } (une
// requête au lieu de quatorze) ; le moindre changement (réponse
// d'étudiant, signalement, phase…) redonne l'état complet.
async function doGET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params
    const token = extractToken(req)
    const session = await getSessionByCode(code)
    if (!session) {
      return NextResponse.json({ error: 'Séance introuvable.' }, { status: 404 })
    }
    if (!token || !safeEqualStrings(token, session.teacherToken)) {
      return NextResponse.json({ error: 'Accès refusé. Reconnectez-vous.' }, { status: 401 })
    }

    // Cycle de vie (à chaque ouverture enseignant) : corbeille expirée →
    // suppression définitive ; données étudiantes de plus de 4 mois → purge
    // automatique (la séance et ses QCM sont conservés).
    const live = await applyLifecycle(session)
    if (!live) {
      return NextResponse.json(
        { error: 'Cette séance a été supprimée définitivement (corbeille vidée).' },
        { status: 404 }
      )
    }

    // v2.9.0 — rien n'a changé depuis le dernier sondage du tableau de
    // bord : réponse minuscule, sans reconstituer l'état complet.
    const clientRev = readRevParam(req.nextUrl)
    if (clientRev !== null && clientRev === live.revisionTeacher) {
      return NextResponse.json({
        unchanged: true,
        revision: live.revisionTeacher,
        serverNow: new Date().toISOString(),
      })
    }

    const [questions, cases, teams, students, iratAnswers, tratAnswers, appeals, appAnswers, peerEvals, alertEvents, saiItems, saiResponses, saiComments, saiDetailedResponses, collaborators, ownerAccount, journalEvents] =
      await Promise.all([
        db.question.findMany({
          where: { sessionId: session.id },
          // Tri : questions iRAT/tRAT d'abord, puis exercices d'application,
          // chacun dans l'ordre défini par l'enseignant (champ order).
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
        }),
        db.case.findMany({
          where: { sessionId: session.id },
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
        }),
        db.team.findMany({ where: { sessionId: session.id }, orderBy: { number: 'asc' } }),
        db.student.findMany({
          where: { sessionId: session.id },
          orderBy: { createdAt: 'asc' },
          // recoveryCode : visible par l'enseignant uniquement — permet de
          // redonner son code à un étudiant qui l'a perdu (porte de secours).
          // saiCompletedAt : v2.6.0, statistiques du questionnaire TBL-SAI.
          select: { id: true, name: true, teamId: true, recoveryCode: true, saiCompletedAt: true },
        }),
        db.answer.findMany({
          where: { question: { sessionId: session.id }, kind: 'irat' },
          select: {
            questionId: true,
            studentId: true,
            choice: true,
            isCorrect: true,
            score: true,
          },
        }),
        db.answer.findMany({
          where: { question: { sessionId: session.id }, kind: 'trat' },
          orderBy: { attempt: 'asc' },
          select: {
            questionId: true,
            teamId: true,
            choice: true,
            attempt: true,
            isCorrect: true,
            score: true,
          },
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
          select: {
            evaluatorId: true,
            evaluatedId: true,
            score: true,
            comment: true,
          },
        }),
        // v2.5.0 : signalements anti-capture (capture suspectée / sortie
        // d'application) — les plus récents d'abord, volume borné.
        // v3.0.0 : requête EXÉCUTÉE uniquement si les signalements sont
        // activés pour cette séance (défaut : désactivés) — une requête
        // de moins à chaque sondage du tableau de bord, et l'onglet
        // « Signalements » ne s'affiche pas.
        live.reportsEnabled
          ? db.alertEvent.findMany({
              where: { student: { sessionId: session.id } },
              orderBy: { createdAt: 'desc' },
              take: 200,
              select: {
                id: true,
                studentId: true,
                kind: true,
                phase: true,
                createdAt: true,
                student: { select: { name: true } },
              },
            })
          : Promise.resolve([]),
        // v2.6.0 : questionnaire de fin de séance (TBL-SAI) — items de la
        // séance, réponses agrégées par item et commentaires libres.
        db.saiItem.findMany({
          where: { sessionId: session.id },
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
          select: { id: true, subscale: true, textKey: true, text: true, reversed: true },
        }),
        db.saiResponse.findMany({
          where: { student: { sessionId: session.id } },
          select: { itemId: true, value: true },
        }),
        db.student.findMany({
          where: { sessionId: session.id, saiComment: { not: null } },
          orderBy: [{ saiCompletedAt: 'asc' }],
          select: { name: true, saiComment: true, saiCompletedAt: true },
        }),
        // v2.7.0 : réponses individuelles au questionnaire (matrice
        // étudiant × item pour l'export CSV/Excel, onglet Questionnaire
        // et feuille 3 du classeur Excel).
        db.saiResponse.findMany({
          where: { student: { sessionId: session.id } },
          orderBy: { createdAt: 'asc' },
          select: { studentId: true, itemId: true, value: true },
        }),
        // v3.2.0 : partage de la séance — liste des enseignants invités
        // (avec statut de leur compte) + email du propriétaire (pour
        // l'affichage « partagée par » dans l'onglet Configurations).
        listCollaboratorsDetailed(session.id),
        live.teacherId
          ? db.teacherAccount.findUnique({
              where: { id: live.teacherId },
              select: { email: true, firstName: true, lastName: true },
            })
          : Promise.resolve(null),
        // v3.3.0 — JOURNAL DES MODIFICATIONS ENSEIGNANTES : les 150
        // dernières actions d'enseignant (phase, questions, équipes,
        // réglages, partage, redémarrage…), la plus récente d'abord.
        // Uniquement les types « action enseignante » (TEACHER_EVENT_
        // TYPES) — le journal complet (y compris événements étudiants)
        // reste disponible via export_events.
        db.sessionEvent.findMany({
          where: { sessionId: session.id, type: { in: [...TEACHER_EVENT_TYPES] } },
          orderBy: { sequence: 'desc' },
          take: 150,
          select: {
            sequence: true,
            type: true,
            payload: true,
            origin: true,
            createdAt: true,
          },
        }),
      ])

    // Questions RAT (iRAT + tRAT) en premier, exercices d'application ensuite —
    // la numérotation affichée correspond ainsi à l'ordre réel du déroulé TBL.
    const phaseRank = (p: string) => (p === 'application' ? 1 : 0)

    // v2.6.0 — Agrégats du questionnaire TBL-SAI (moyenne brute par item,
    // nombre d'étudiants ayant répondu, commentaires dans l'ordre).
    const saiByItem = new Map<string, { sum: number; n: number }>()
    for (const r of saiResponses) {
      const cur = saiByItem.get(r.itemId) ?? { sum: 0, n: 0 }
      cur.sum += r.value
      cur.n += 1
      saiByItem.set(r.itemId, cur)
    }
    questions.sort((a, b) => phaseRank(a.phase) - phaseRank(b.phase) || a.order - b.order)

    return NextResponse.json({
      // v2.9.0 : compteur enseignant (sondage allégé) + heure serveur
      // (minuteur iRAT synchronisé avec celui des étudiants).
      revision: live.revisionTeacher,
      serverNow: new Date().toISOString(),
      session: {
        id: live.id,
        code: live.code,
        title: live.title,
        status: live.status,
        iratMinutes: live.iratMinutes,
        phaseStartedAt: live.phaseStartedAt,
        revealed: live.revealed,
        // v2.7.0 : écran d'attente avant le feedback + date de dernière
        // synchronisation avec la version en ligne (onglet Configurations).
        feedbackReady: live.feedbackReady,
        syncedAt: live.syncedAt ? live.syncedAt.toISOString() : null,
        createdAt: live.createdAt,
        // Corbeille (null = séance active) et purge des données étudiantes
        deletedAt: live.deletedAt,
        dataPurgedAt: live.dataPurgedAt,
        // v3.0.0 : signalements anti-capture activés pour cette séance ?
        reportsEnabled: live.reportsEnabled === true,
        // v3.2.0 : partage — enseignants invités (email, nom si le
        // compte existe, statut du compte) et propriétaire. Un invité
        // dont le compte n'existe pas encore reste listé : l'adminis-
        // trateur est invité à le créer (même email) — la séance
        // apparaîtra alors dans ses « Mes séances ».
        collaborators,
        owner: ownerAccount
          ? { email: ownerAccount.email, name: `${ownerAccount.firstName} ${ownerAccount.lastName}` }
          : null,
      },
      questions: questions.map((q) => ({
        id: q.id,
        text: q.text,
        choices: parseChoices(q.choices),
        correct: q.correct,
        phase: q.phase,
        order: q.order,
        caseId: q.caseId,
      })),
      cases: cases.map((c) => ({
        id: c.id,
        title: c.title,
        intro: c.intro,
        order: c.order,
        // v2.7.0 : cas lancé par l'enseignant (bouton « Lancer le cas
        // clinique N ») — false = étudiants en page d'attente.
        opened: c.opened,
      })),
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        number: t.number,
        appealsDone: t.appealsDone,
      })),
      students,
      iratAnswers,
      tratAnswers,
      appeals,
      appAnswers: appAnswers.map((a) => ({
        teamId: a.teamId,
        questionId: a.questionId,
        choice: a.choice,
        text: a.text,
      })),
      peerEvals,
      alerts: alertEvents.map((a) => ({
        id: a.id,
        studentId: a.studentId,
        studentName: a.student.name,
        kind: a.kind as 'screenshot' | 'tab_hidden',
        phase: a.phase,
        createdAt: a.createdAt,
      })),
      // v3.3.0 — journal des modifications enseignantes (rubrique
      // « Journal ») : payload parsé et sécurisé, jamais de secret.
      journal: journalEvents.map((ev) => ({
        sequence: ev.sequence,
        type: ev.type,
        payload: safeEventPayload(ev.payload),
        origin: ev.origin,
        createdAt: ev.createdAt.toISOString(),
      })),
      // v2.6.0 — questionnaire TBL-SAI : items + agrégats par item +
      // commentaires. Les moyennes de sous-échelles sont calculées côté
      // client (inversion des items négatifs, libellés i18n).
      // v2.7.0 — réponses individuelles (matrice étudiant × item des
      // exports CSV/Excel du questionnaire).
      saiResponses: saiDetailedResponses,
      saiItems: saiItems.map((it) => ({
        id: it.id,
        subscale: it.subscale as 'accountability' | 'preference' | 'satisfaction',
        textKey: it.textKey,
        text: it.text,
        reversed: it.reversed,
      })),
      saiStats: {
        completed: students.filter((s) => s.saiCompletedAt !== null).length,
        items: saiItems.map((it) => {
          const agg = saiByItem.get(it.id)
          return {
            id: it.id,
            mean: agg && agg.n > 0 ? agg.sum / agg.n : 0,
            n: agg?.n ?? 0,
          }
        }),
        comments: saiComments.map((s) => ({
          studentName: s.name,
          comment: s.saiComment as string,
          createdAt: (s.saiCompletedAt ?? new Date()).toISOString(),
        })),
      },
    })
  } catch (e) {
    console.error('GET /api/sessions/[code]/dashboard', e)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}

export const GET = withMetrics<{ params: Promise<{ code: string }> }>(
  'dashboard',
  doGET
)
