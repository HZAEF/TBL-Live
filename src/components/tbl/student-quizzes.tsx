'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, Clock, Loader2, Save, Send, Star, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { ApiError, api, useSubmitState, type SubmitPhase } from '@/lib/tbl-client'
import type { QuestionDTO, StudentStateDTO } from '@/lib/tbl-types'
import { useI18n } from '@/lib/i18n'
import { ChoiceButton, choiceLetter, Countdown, InfoCard, SubmitStatus } from './shared'
import { useToast } from '@/hooks/use-toast'

type RefreshFn = () => Promise<unknown>

// ================= iRAT : test individuel =================

export function IratQuiz({
  data,
  refresh,
  token,
}: {
  data: StudentStateDTO
  refresh: RefreshFn
  token: string
}) {
  const questions = data.questions
  const answered = new Map(data.myIratAnswers.map((a) => [a.questionId, a.choice]))
  const firstUnanswered = questions.findIndex((q) => !answered.has(q.id))
  const [index, setIndex] = useState(() => Math.max(0, firstUnanswered))
  const [selected, setSelected] = useState<number | null>(null)
  const { t } = useI18n()
  // v3.1.0 — ÉTAT D'ENVOI EXPLICITE (problème n°12) : « Envoi en
  // cours… » → « Enregistré ✓ » ou « Échec — non enregistré » +
  // RÉESSAI. La sélection RESTE en cas d'échec : le réessai renvoie
  // EXACTEMENT la même réponse (idempotent côté serveur : jamais de
  // doublon, jamais de « déjà répondu » brutal).
  const submitState = useSubmitState()
  const submitting = submitState.phase.state === 'sending'
  const lastChoiceRef = useRef<number | null>(null)

  const q = questions[Math.min(index, questions.length - 1)]
  const done = questions.length > 0 && questions.every((x) => answered.has(x.id))

  // v3.1.0 — reset de la sélection au changement de question par le
  // pattern React documenté « ajuster l'état pendant le rendu » (plus
  // de setState dans un effet — cascades de rendus éliminées). Au
  // passage, l'état d'envoi est remis à zéro : la confirmation de la
  // question précédente ne reste pas affichée sous la nouvelle.
  const [lastQId, setLastQId] = useState<string | null>(q?.id ?? null)
  if (q && q.id !== lastQId) {
    setLastQId(q.id)
    setSelected(null)
    submitState.reset()
  }

  if (questions.length === 0) {
    return (
      <InfoCard title={t('Aucune question')}>
        {t('Votre professeur n’a pas encore ajouté de questions.')}
      </InfoCard>
    )
  }

  if (done) {
    return (
      <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-6 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white">
          <Check className="h-7 w-7" />
        </span>
        {/* v2.5.1 : « Épreuve terminée » (demande enseignant) — bien plus
            clair que « Réponses enregistrées » une fois le test bouclé. */}
        <p className="mt-3 text-lg font-bold text-emerald-900">{t('Épreuve terminée !')}</p>
        <p className="mt-1 text-sm text-emerald-800">
          {t(
            'Vous avez répondu aux {n} questions. Attendez les instructions de votre professeur.',
            { n: questions.length }
          )}
        </p>
      </div>
    )
  }

  const submit = async (choiceOverride?: number) => {
    const choice = choiceOverride ?? selected
    if (choice === null) return
    lastChoiceRef.current = choice
    const result = await submitState.run(
      () =>
        api<{ ok: boolean; duplicate: boolean }>('/api/answer', {
          method: 'POST',
          body: JSON.stringify({ token, questionId: q.id, choice }),
        }),
      {
        onSaved: async () => {
          // La sélection est relâchée immédiatement, la confirmation
          // « Réponse enregistrée ✓ » reste visible ~900 ms PUIS la
          // question suivante arrive (l'étudiant VOIT que c'est pris —
          // jamais de doute « c'est enregistré ou pas ? »).
          setSelected(null)
          await refresh()
          setTimeout(() => {
            setIndex((i) => Math.min(i + 1, questions.length - 1))
          }, 900)
        },
      }
    )
    return result
  }
  const retry = () => {
    void submit(lastChoiceRef.current ?? undefined)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm">
        <span className="font-semibold text-amber-900">{t('Test individuel — répondez seul(e)')}</span>
        <Countdown startedAt={data.session.phaseStartedAt} minutes={data.session.iratMinutes} />
      </div>

      <QuestionProgress questions={questions} statuses={questions.map((x) => (answered.has(x.id) ? 'done' : 'pending'))} current={index} onSelect={setIndex} />

      <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-stone-400">
          {t('Question {i} sur {n}', { i: index + 1, n: questions.length })}
        </p>
        <p className="mt-2 text-lg font-semibold leading-snug text-stone-900">{q.text}</p>
        <div className="mt-5 space-y-2.5">
          {q.choices.map((c, ci) => (
            <ChoiceButton
              key={ci}
              letter={choiceLetter(ci)}
              text={c}
              state={selected === ci ? 'selected' : 'default'}
              disabled={submitting}
              onClick={() => setSelected(ci)}
            />
          ))}
        </div>
        {submitState.phase.state !== 'idle' && (
          <SubmitStatus phase={submitState.phase} onRetry={retry} />
        )}
        <Button
          className="mt-5 h-12 w-full bg-emerald-600 text-base hover:bg-emerald-700"
          disabled={selected === null || submitting}
          onClick={() => submit()}
        >
          {submitting ? t('Envoi…') : t('Valider ma réponse')}
          <ArrowRight className="ml-2 h-5 w-5 rtl:rotate-180" />
        </Button>
        <p className="mt-2 text-center text-xs text-stone-500">
          {t('Attention : une fois validée, la réponse ne peut plus être modifiée.')}
        </p>
      </div>
    </div>
  )
}

// ================= tRAT : test en équipe (façon carte à gratter) =================

const TRAT_POINTS = [4, 2, 1, 0]

export function TratQuiz({
  data,
  refresh,
  token,
}: {
  data: StudentStateDTO
  refresh: RefreshFn
  token: string
}) {
  const { toast } = useToast()
  const questions = data.questions
  const team = data.me.team

  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<{ correct: boolean; score: number; attempt: number } | null>(null)
  const { t } = useI18n()
  // v3.1.0 — état d'envoi + RÉESSAI SÛR : le client envoie
  // expectedAttempt = le nombre de tentatives qu'il a VUES. Après un
  // timeout, le réessai de la MÊME tentative est reconnu par le serveur
  // (réponse identique renvoyée) ; si un coéquipier a gratté entre-
  // temps, le serveur répond syncNeeded → l'écran se rafraîchit au lieu
  // d'enregistrer une 2ᵉ case (l'équipe ne perd plus de points à cause
  // du réseau).
  const submitState = useSubmitState()
  const submitting = submitState.phase.state === 'sending'
  const lastChoiceRef = useRef<number | null>(null)

  const q = questions[Math.min(index, questions.length - 1)]
  const attempts = useMemo(
    () => data.teamTratAnswers.filter((a) => a.questionId === q?.id),
    [data.teamTratAnswers, q?.id]
  )
  const found = attempts.some((a) => a.isCorrect)
  const exhausted = attempts.length >= 4 && !found
  const teamScore = data.teamTratAnswers.reduce((s, a) => s + a.score, 0)

  // v3.1.0 — reset sélection + feedback au changement de question
  // (pattern « ajuster l'état pendant le rendu », sans effet).
  const [lastQId, setLastQId] = useState<string | null>(q?.id ?? null)
  if (q && q.id !== lastQId) {
    setLastQId(q.id)
    setSelected(null)
    setFeedback(null)
    submitState.reset()
  }

  if (!team) {
    return (
      <InfoCard tone="amber" title={t("Vous n’êtes pas dans une équipe")}>
        {t(
          'Prévenez votre professeur : il peut vous affecter à une équipe depuis son tableau de bord.'
        )}
      </InfoCard>
    )
  }
  if (questions.length === 0) {
    return (
      <InfoCard title={t('Aucune question')}>
        {t('Aucune question disponible pour le test.')}
      </InfoCard>
    )
  }

  const submit = async (choiceOverride?: number) => {
    const choice = choiceOverride ?? selected
    if (choice === null) return
    lastChoiceRef.current = choice
    await submitState.run(
      () =>
        api<{
          attempt: number
          isCorrect: boolean
          score: number
          pointsIfCorrect: number
          duplicate?: boolean
        }>('/api/team-answer', {
          method: 'POST',
          body: JSON.stringify({
            token,
            questionId: q.id,
            choice,
            // v3.1.0 — tentatives connues du client (garde-fou anti-
            // double-grattage après timeout / clic concurrent d'un
            // coéquipier) ; le serveur renvoie l'état réel sinon.
            expectedAttempt: attempts.length,
          }),
        }),
      {
        onSaved: async (res) => {
          setFeedback({ correct: res.isCorrect, score: res.score, attempt: res.attempt })
          if (res.isCorrect) {
            toast({
              title: t('Bonne réponse ! +{n} point(s)', { n: res.score }),
              description:
                res.attempt === 1
                  ? t('Trouvé du premier coup 🎉')
                  : t('Trouvé à la {n}ᵉ tentative.', { n: res.attempt }),
            })
          }
          await refresh()
        },
      }
    )
    setSelected(null)
  }
  const retry = () => {
    // syncNeeded : un coéquipier a déjà gratté cette case — on rafraîchit
    // l'état au lieu de renvoyer (l'écran se met à jour tout seul).
    if (submitState.phase.state === 'failed' && submitState.phase.syncNeeded) {
      void refresh()
      submitState.reset()
      return
    }
    void submit(lastChoiceRef.current ?? undefined)
  }

  const statuses = questions.map((x) => {
    const at = data.teamTratAnswers.filter((a) => a.questionId === x.id)
    if (at.some((a) => a.isCorrect)) return 'done'
    if (at.length >= 4) return 'failed'
    return 'pending'
  })
  // v2.5.1 : épreuve entièrement traitée (chaque question trouvée, ou 4
  // tentatives épuisées) → fin d'épreuve explicite. L'ancien bouton
  // « Question suivante » restait affiché sans rien avancer : il n'avait
  // plus de sens une fois le test accompli (demande de l'enseignant).
  const allDone = statuses.every((s) => s !== 'pending')

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-4">
        <p className="flex items-center gap-2 font-bold text-emerald-900">
          <Users className="h-5 w-5" />
          {t('Test en équipe — {team}', { team: team.name })}
        </p>
        <p className="mt-1 text-sm text-emerald-800">
          {t('Membres : {names}', { names: data.teamMembers.map((m) => m.name).join(', ') })}
        </p>
        <p className="mt-1.5 text-sm font-semibold text-emerald-900">
          {t('Discutez ensemble avant de valider ! Score de l’équipe : {n} pts', {
            n: teamScore,
          })}
        </p>
      </div>

      {/* v2.5.1 : carte de fin d'épreuve — visible dès que l'équipe a
          traité toutes les questions (les questions restent consultables
          en dessous pour révision). */}
      {allDone && (
        <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-6 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white">
            <Check className="h-7 w-7" />
          </span>
          <p className="mt-3 text-lg font-bold text-emerald-900">{t('Épreuve terminée !')}</p>
          <p className="mt-1 text-sm text-emerald-800">
            {t(
              'Vous avez répondu aux {n} questions. Attendez les instructions de votre professeur.',
              { n: questions.length }
            )}
          </p>
        </div>
      )}

      <QuestionProgress questions={questions} statuses={statuses} current={index} onSelect={setIndex} />

      <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-stone-400">
          {t('Question {i} sur {n}', { i: index + 1, n: questions.length })}
        </p>
        <p className="mt-2 text-lg font-semibold leading-snug text-stone-900">{q.text}</p>

        <div className="mt-5 space-y-2.5">
          {q.choices.map((c, ci) => {
            const attempted = attempts.find((a) => a.choice === ci)
            const isCorrectChoice = attempted?.isCorrect
            const isRejected = attempted && !attempted.isCorrect
            const isSelected = selected === ci
            const state = isCorrectChoice
              ? 'correct'
              : isRejected
                ? 'rejected'
                : isSelected
                  ? 'selected'
                  : 'default'
            return (
              <ChoiceButton
                key={ci}
                letter={choiceLetter(ci)}
                text={c}
                state={state}
                showIcon
                disabled={submitting || !!isCorrectChoice || !!isRejected || false}
                onClick={() => setSelected(ci)}
              />
            )
          })}
        </div>

        {feedback && !feedback.correct && (
          <p className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
            {t('Ce n’est pas la bonne réponse. Réessayez :')}{' '}
            {feedback.attempt < 4
              ? t('{n} point(s) encore en jeu.', { n: TRAT_POINTS[feedback.attempt] ?? 0 })
              : t('tentatives épuisées.')}
          </p>
        )}
        {feedback && feedback.correct && (
          <p className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
            <Check className="mr-1.5 inline h-4 w-4" />
            {t('Bonne réponse ! +{n} point(s) pour l’équipe', { n: feedback.score })}
          </p>
        )}
        {exhausted && (
          <p className="mt-4 rounded-xl border border-stone-300 bg-stone-100 px-4 py-3 text-sm text-stone-700">
            {t(
              'Les 4 tentatives sont épuisées pour cette question (0 point). La bonne réponse sera révélée à l’étape suivante.'
            )}
          </p>
        )}

        {submitState.phase.state !== 'idle' && (
          <SubmitStatus phase={submitState.phase} onRetry={retry} />
        )}

        {allDone ? (
          // v2.5.1 : en fin d'épreuve, le bouton confirme la fin au lieu
          // de proposer une « Question suivante » inexistante.
          <Button
            variant="outline"
            disabled
            className="mt-5 h-12 w-full border-emerald-400 text-emerald-700"
          >
            <Check className="mr-2 h-5 w-5" />
            {t('Épreuve terminée')}
          </Button>
        ) : !found ? (
          <Button
            className="mt-5 h-12 w-full bg-emerald-600 text-base hover:bg-emerald-700"
            disabled={selected === null || submitting || exhausted}
            onClick={() => submit()}
          >
            {submitting
              ? t('Envoi…')
              : t('Valider pour l’équipe ({n} pt en jeu)', {
                  n: TRAT_POINTS[attempts.length] ?? 0,
                })}
          </Button>
        ) : (
          <Button
            variant="outline"
            className="mt-5 h-12 w-full border-emerald-400 text-emerald-700 hover:bg-emerald-50"
            onClick={() => {
              const nextPending = questions.findIndex(
                (x, i) => i !== index && !data.teamTratAnswers.some((a) => a.questionId === x.id && a.isCorrect) && data.teamTratAnswers.filter((a) => a.questionId === x.id).length < 4
              )
              setIndex(nextPending >= 0 ? nextPending : Math.min(index + 1, questions.length - 1))
            }}
          >
            {t('Question suivante')}
            <ArrowRight className="ml-2 h-5 w-5 rtl:rotate-180" />
          </Button>
        )}
      </div>
    </div>
  )
}

// ================= Réclamations =================

export function AppealView({
  data,
  refresh,
  token,
}: {
  data: StudentStateDTO
  refresh: RefreshFn
  token: string
}) {
  const { toast } = useToast()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const { t } = useI18n()
  // v3.1.0 — états d'envoi explicites : réclamation (par question) et
  // bouton « pas de réclamation ». En cas d'échec : message + RÉESSAI
  // (l'upsert serveur est idempotent : renvoyer le même texte ne crée
  // jamais de doublon).
  const appealSubmit = useSubmitState()
  const doneSubmit = useSubmitState()
  // v3.1.0 — Question concernée par l'envoi en cours / échoué : en STATE
  // (lue pendant le rendu pour afficher l'état de LA question envoyée —
  // une ref ne doit jamais être lue au rendu, règle react-hooks/refs).
  const [appealQ, setAppealQ] = useState<string | null>(null)
  // État (true/false) du dernier « pas de réclamation » — sert au réessai.
  const doneStateRef = useRef(true)
  const submitting = appealSubmit.phase.state === 'sending' ? appealQ : null
  const sendingDone = doneSubmit.phase.state === 'sending'
  const appealByQuestion = new Map(data.myAppeals.map((a) => [a.questionId, a]))
  const myTeamDone = data.myTeamAppealsDone ?? false
  const progress = data.appealsProgress

  if (!data.me.team) {
    return (
      <InfoCard tone="amber" title={t("Vous n’êtes pas dans une équipe")}>
        {t('Prévenez votre professeur.')}
      </InfoCard>
    )
  }

  const submit = async (questionId: string, textOverride?: string) => {
    const text = (textOverride ?? drafts[questionId] ?? '').trim()
    if (text.length < 10) {
      toast({
        title: t('Justification trop courte'),
        description: t(
          'Expliquez en au moins 10 caractères pourquoi votre réponse devrait être acceptée.'
        ),
        variant: 'destructive',
      })
      return
    }
    setAppealQ(questionId)
    const result = await appealSubmit.run(() => 
      api<{ ok: boolean }>('/api/appeal', {
        method: 'POST',
        body: JSON.stringify({ token, questionId, text }),
      })
    )
    // Succès SEULEMENT : la confirmation « envoyée » n'apparaît qu'après
    // la réponse du serveur (jamais d'optimisme mensonger).
    if (result !== null) {
      toast({ title: t('Réclamation envoyée'), description: t('Votre professeur va l’examiner.') })
      await refresh()
    }
  }
  const retryAppeal = () => {
    if (!appealQ) return
    void submit(appealQ)
  }

  // Bouton « pas de réclamation » : marque l'équipe comme ayant répondu à
  // cette phase. Quand toutes les équipes ont répondu, la séance passe
  // automatiquement au feedback.
  const markDone = async (done: boolean, retrying = false) => {
    if (!retrying) doneStateRef.current = done
    const effectiveDone = doneStateRef.current
    await doneSubmit.run(
      () =>
        api<{ advanced: boolean; doneCount: number; total: number }>('/api/appeal-done', {
          method: 'POST',
          body: JSON.stringify({ token, done: effectiveDone }),
        }),
      {
        onSaved: async (res) => {
          if (effectiveDone) {
            toast({
              title: res.advanced ? t('Toutes les équipes ont répondu !') : t('Réponse enregistrée'),
              description: res.advanced
                ? t('La séance passe automatiquement à la phase de feedback.')
                : t('En attente des autres équipes ({d}/{n}).', {
                    d: res.doneCount,
                    n: res.total,
                  }),
            })
          }
          await refresh()
        },
      }
    )
  }

  return (
    <div className="space-y-4">
      {/* Bouton « pas de réclamation » — en haut, avant les questions */}
      <div
        className={cn(
          'rounded-2xl border-2 p-4',
          myTeamDone
            ? 'border-emerald-300 bg-emerald-50'
            : 'border-amber-300 bg-amber-50'
        )}
      >
        {!myTeamDone ? (
          <>
            <p className="text-sm font-bold text-amber-900">
              {data.myAppeals.length > 0
                ? t('Vos réclamations sont envoyées')
                : t('Aucune réclamation à formuler ?')}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-amber-800">
              {data.myAppeals.length > 0
                ? t(
                    'Si votre équipe a terminé, confirmez ci-dessous. Vous pourrez encore annuler tant que les autres équipes travaillent.'
                  )
                : t(
                    'Si votre équipe n’a aucune contestation, cliquez sur le bouton : la séance passera au feedback dès que toutes les équipes auront répondu.'
                  )}
            </p>
            <Button
              className="mt-3 h-12 w-full bg-amber-600 text-base hover:bg-amber-700"
              disabled={sendingDone}
              onClick={() => markDone(true)}
            >
              <Check className="mr-2 h-5 w-5" />
              {data.myAppeals.length > 0
                ? t('Nous avons terminé nos réclamations')
                : t('Nous n’avons pas de réclamation')}
            </Button>
            <SubmitStatus
              phase={doneSubmit.phase}
              onRetry={() => markDone(doneStateRef.current, true)}
            />
          </>
        ) : (
          <>
            <p className="flex items-center gap-2 text-sm font-bold text-emerald-900">
              <Check className="h-5 w-5" />
              {t('Votre équipe a répondu')}
              {data.myAppeals.length > 0
                ? t(' ({n} réclamation(s) envoyée(s))', { n: data.myAppeals.length })
                : t(' (aucune réclamation)')}
            </p>
            <p className="mt-1 text-sm text-emerald-800">
              {progress && progress.total > progress.done
                ? t('En attente des autres équipes : {d}/{n} ont répondu.', {
                    d: progress.done,
                    n: progress.total,
                  })
                : t('La phase va se terminer…')}
            </p>
            <button
              type="button"
              className="mt-2 text-xs font-semibold text-amber-700 underline"
              onClick={() => markDone(false)}
              disabled={sendingDone}
            >
              {t('Annuler — notre équipe veut (re)formuler une réclamation')}
            </button>
          </>
        )}
        {progress && !myTeamDone && (
          <p className="mt-2 text-center text-xs font-medium text-amber-700">
            {t('{d}/{n} équipe(s) ont déjà répondu', { d: progress.done, n: progress.total })}
          </p>
        )}
      </div>

      <InfoCard tone="amber" title={t('Réclamations (appels)')}>
        {t(
          'Si vous pensez qu’une de vos réponses devrait être acceptée (question ambiguë, sources contradictoires…), écrivez une justification claire. Votre professeur décidera.'
        )}
      </InfoCard>
      {data.questions.map((q, qi) => {
        const attempts = data.teamTratAnswers.filter((a) => a.questionId === q.id)
        const found = attempts.some((a) => a.isCorrect)
        const appeal = appealByQuestion.get(q.id)
        return (
          <div key={q.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-bold text-stone-500">
              {t('Question {n}', { n: qi + 1 })}
            </p>
            <p className="mt-1 font-semibold leading-snug text-stone-900">{q.text}</p>
            <div className="mt-3 space-y-1.5">
              {q.choices.map((c, ci) => (
                <ChoiceButton
                  key={ci}
                  letter={choiceLetter(ci)}
                  text={c}
                  state={ci === q.correct ? 'correct' : attempts.some((a) => a.choice === ci) ? 'rejected' : 'default'}
                  showIcon={ci === q.correct}
                  disabled
                />
              ))}
            </div>
            <p className="mt-2 text-xs text-stone-500">
              {found
                ? t('Votre équipe a trouvé la bonne réponse ({n} tentative(s)).', {
                    n: attempts.length,
                  })
                : attempts.length > 0
                  ? t('Réponse(s) tentée(s) : {choices} — sans succès.', {
                      choices: attempts.map((a) => choiceLetter(a.choice)).join(', '),
                    })
                  : t('Votre équipe n’a pas répondu à cette question.')}
            </p>

            {appeal && (
              <p
                className={cn(
                  'mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold',
                  appeal.status === 'accepted'
                    ? 'bg-emerald-100 text-emerald-700'
                    : appeal.status === 'rejected'
                      ? 'bg-stone-100 text-stone-600'
                      : 'bg-amber-100 text-amber-800'
                )}
              >
                {appeal.status === 'accepted'
                  ? t('Réclamation acceptée (+4 pts)')
                  : appeal.status === 'rejected'
                    ? t('Réclamation refusée')
                    : t('Réclamation en attente')}
              </p>
            )}

            <Textarea
              value={drafts[q.id] ?? appeal?.text ?? ''}
              onChange={(e) => setDrafts({ ...drafts, [q.id]: e.target.value })}
              placeholder={t(
                'Votre justification : pourquoi cette réponse devrait-elle être acceptée ?'
              )}
              rows={3}
              className="mt-3 resize-none text-[15px]"
            />
            <Button
              className="mt-2 h-11 w-full bg-amber-600 hover:bg-amber-700"
              disabled={submitting === q.id}
              onClick={() => submit(q.id)}
            >
              <Send className="mr-2 h-4 w-4" />
              {appeal ? t('Mettre à jour la réclamation') : t('Envoyer la réclamation')}
            </Button>
            {appealSubmit.phase.state !== 'idle' && appealQ === q.id && (
              <SubmitStatus phase={appealSubmit.phase} onRetry={retryAppeal} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ================= Application : cas cliniques =================

interface CaseGroup {
  key: string
  title: string | null
  intro: string | null
  questions: QuestionDTO[]
  /** v2.7.0 : cas lancé par l'enseignant (false = page d'attente).
   *  Le groupe « libres » (ancien format) est toujours accessible. */
  opened: boolean
}

export function ApplicationView({
  data,
  refresh,
  token,
}: {
  data: StudentStateDTO
  refresh: RefreshFn
  token: string
}) {
  const { toast } = useToast()
  const { t } = useI18n()
  const questions = data.applicationQuestions
  const revealedIds = useMemo(
    () => new Set(data.revealedAppQuestionIds ?? []),
    [data.revealedAppQuestionIds]
  )
  const progressByQuestion = useMemo(
    () => new Map((data.appAnswerProgress ?? []).map((p) => [p.questionId, p])),
    [data.appAnswerProgress]
  )

  // Groupes affichés : un par cas clinique (+ un groupe pour les exercices
  // libres de l'ancien format).
  // v2.8.2 : PLUS DE NAVIGATION ÉTUDIANTE — un seul cas est ouvert à la
  // fois (le serveur referme le précédent au lancement du suivant) : la
  // page suit AUTOMATIQUEMENT le cas lancé par l'enseignant (polling
  // 2,5 s). Un cas non lancé n'envoie ni énoncé ni questions : page
  // d'attente neutre, aucun contenu ne fuit.
  const groups: CaseGroup[] = useMemo(() => {
    const gs: CaseGroup[] = (data.appCases ?? []).map((c) => ({
      key: c.id,
      title: c.title,
      intro: c.intro,
      questions: questions.filter((q) => q.caseId === c.id),
      opened: c.opened !== false,
    }))
    const free = questions.filter((q) => !q.caseId)
    if (free.length > 0) {
      gs.push({
        key: 'libres',
        title: 'Exercices d\u2019application',
        intro: null,
        questions: free,
        opened: true,
      })
    }
    return gs.filter((g) => g.questions.length > 0 || !g.opened)
  }, [data.appCases, questions])

  // Réponses déjà données par l'équipe (pour l'état « terminé » du cas).
  const answeredIds = useMemo(
    () => new Set(data.teamAppAnswers.map((a) => a.questionId)),
    [data.teamAppAnswers]
  )
  // v2.7.0 : brouillons des justifications (le texte reste à enregistrer
  // explicitement ; les RÉPONSES, elles, s'enregistrent au clic).
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  // v3.1.0 — état d'envoi PAR QUESTION (enregistrement automatique au
  // clic) : « Envoi… » pendant, « Enregistré ✓ » après confirmation
  // serveur, « Échec + Réessayer » sinon. L'optimisme visuel reste,
  // mais le doute disparaît : la confirmation ne s'affiche qu'après la
  // réponse du serveur.
  const [sendStates, setSendStates] = useState<Record<string, SubmitPhase>>({})
  const setSendState = (questionId: string, phase: SubmitPhase) =>
    setSendStates((prev) => ({ ...prev, [questionId]: phase }))
  // Dernière intention par question (choix + texte) — sert au RÉESSAI
  // après échec : on renvoie EXACTEMENT la même chose (upsert
  // idempotent côté serveur).
  const lastIntent = useRef<Record<string, { choice: number; text: string }>>({})
  const saving = Object.entries(sendStates).find(([, p]) => p.state === 'sending')?.[0] ?? null
  // v2.7.0 : affichage immédiat (optimiste) de la réponse choisie — le clic
  // est visible INSTANTANÉMENT, l'enregistrement part en arrière-plan.
  const [optimistic, setOptimistic] = useState<Record<string, number>>({})
  // v2.7.0 : chaînage des envois par question (deux clics rapides A puis B
  // partent DANS l'ORDRE — la dernière réponse est toujours la bonne).
  const chains = useRef<Record<string, Promise<void>>>({})

  // Nettoyage de l'optimisme (v3.1.0 : DÉRIVÉ au rendu, plus de
  // setState dans un effet) : quand le serveur confirme la réponse
  // (mine.choice == valeur optimiste), l'optimisme devient inutile.
  const shownOptimistic = useMemo(() => {
    const next: Record<string, number> = {}
    for (const [qid, choice] of Object.entries(optimistic)) {
      const mine = data.teamAppAnswers.find((a) => a.questionId === qid)
      if (!(mine && mine.choice === choice)) next[qid] = choice
    }
    return next
  }, [optimistic, data.teamAppAnswers])

  // Reset de l'optimisme au changement de phase (pattern « ajuster
  // l'état pendant le rendu », sans effet).
  const [lastStatus, setLastStatus] = useState(data.session.status)
  if (data.session.status !== lastStatus) {
    setLastStatus(data.session.status)
    setOptimistic({})
  }

  // v2.8.2 : PLUS DE NAVIGATION — l'enseignant est seul pilote. La page
  // suit automatiquement LE cas lancé (un seul cas ouvert à la fois,
  // le lancement du cas N referme le précédent côté serveur). Séances
  // de l'ancien format (questions d'application sans cas clinique) :
  // exercices libres toujours accessibles. Calcul AVANT les retours
  // anticipés (règle des hooks React : l'effet de défilement qui suit
  // doit toujours être exécuté).
  const caseGroups = groups.filter((g) => g.key !== 'libres')
  const openCase = caseGroups.find((g) => g.opened) ?? null
  const libres = groups.find((g) => g.key === 'libres') ?? null
  const group = openCase ?? (caseGroups.length === 0 ? libres : null)
  const caseNumber = openCase
    ? caseGroups.indexOf(openCase) + 1
    : Math.max(1, caseGroups.findIndex((g) => !g.opened) + 1)
  const totalCases = caseGroups.length
  const isLastCase = openCase !== null ? caseNumber === totalCases : libres !== null
  const groupDone =
    group !== null &&
    group.questions.every(
      (q) => answeredIds.has(q.id) || revealedIds.has(q.id)
    )
  const allDone = groups.every(
    (g) =>
      !g.opened ||
      g.questions.every((q) => answeredIds.has(q.id) || revealedIds.has(q.id))
  )

  // v2.8.2 : quand l'enseignant lance un autre cas, la page « tourne » —
  // on remonte en haut pour montrer l'énoncé du nouveau cas.
  const groupKey = group?.key
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [groupKey])

  if (!data.me.team) {
    return (
      <InfoCard tone="amber" title={t("Vous n’êtes pas dans une équipe")}>
        {t('Prévenez votre professeur.')}
      </InfoCard>
    )
  }
  if (groups.length === 0) {
    return (
      <InfoCard title={t('Aucun cas clinique')}>
        {t(
          'Votre professeur n’a pas prévu d’exercice d’application pour cette séance. Attendez la suite.'
        )}
      </InfoCard>
    )
  }

  // v2.7.0 : enregistrement AUTOMATIQUE à CHAQUE clic — plus de bouton
  // « Mettre à jour » : si l'équipe change d'avis (A puis B), la réponse
  // est remplacée immédiatement, sans autre action. Les clics sur une
  // même question sont chaînés dans l'ordre : la DERNIÈRE réponse
  // envoyée est toujours celle enregistrée.
  const save = (questionId: string, choice: number, text: string) => {
    lastIntent.current[questionId] = { choice, text }
    const run = async () => {
      setSendState(questionId, { state: 'sending', slow: false })
      // « Connexion lente » au bout de 3 s ( même signal que partout).
      const slowTimer = setTimeout(() => {
        setSendStates((prev) => {
          const p = prev[questionId]
          return p && p.state === 'sending'
            ? { ...prev, [questionId]: { state: 'sending', slow: true } }
            : prev
        })
      }, 3000)
      try {
        const res = await api<{ revealedNow: boolean; duplicate: boolean }>(
          '/api/app-answer',
          {
            method: 'POST',
            body: JSON.stringify({ token, questionId, choice, text }),
          }
        )
        clearTimeout(slowTimer)
        setSendState(questionId, { state: 'saved', duplicate: res.duplicate })
        if (res.revealedNow) {
          toast({
            title: t('Toutes les équipes ont répondu !'),
            description: t('Les réponses à cette question sont maintenant révélées.'),
          })
        }
        await refresh()
      } catch (e) {
        clearTimeout(slowTimer)
        const apiErr = e instanceof ApiError ? e : null
        setSendState(questionId, {
          state: 'failed',
          message: e instanceof Error ? e.message : '',
          retryable:
            apiErr === null || apiErr.kind !== 'server' || apiErr.status >= 500 || apiErr.status === 429,
          kind: apiErr ? apiErr.kind : 'server',
        })
        await refresh()
      }
    }
    chains.current[questionId] = (chains.current[questionId] ?? Promise.resolve()).then(
      run,
      run
    )
  }

  // Réessai d'une question échouée : renvoie EXACTEMENT la dernière
  // intention (choix + texte) — l'upsert serveur est idempotent.
  const retrySave = (questionId: string) => {
    const intent = lastIntent.current[questionId]
    if (!intent) return
    save(questionId, intent.choice, intent.text)
  }

  // Clic sur une réponse : affichage immédiat + envoi en arrière-plan.
  const onChoice = (questionId: string, ci: number) => {
    const mine = data.teamAppAnswers.find((a) => a.questionId === questionId)
    if (mine && revealedIds.has(questionId)) return
    setOptimistic((prev) => ({ ...prev, [questionId]: ci }))
    save(questionId, ci, drafts[questionId] ?? mine?.text ?? '')
  }
  return (
    <div className="space-y-4">
      <InfoCard tone="emerald" title={t("Cas cliniques d'application")}>
        {t('Travaillez chaque cas en équipe et choisissez vos réponses :')}{' '}
        <strong>{t('chaque clic enregistre la réponse de votre équipe')}</strong>
        {t('. Vous pouvez changer d’avis jusqu’à la révélation : le dernier clic remplace le précédent. Les réponses sont')}{' '}
        <strong>{t('révélées automatiquement')}</strong>
        {t('dès que toutes les équipes auront répondu.')}{' '}
        {t('Votre professeur lance chaque cas l’un après l’autre : la page changera toute seule, aucun bouton à chercher.')}
      </InfoCard>

      {/* v2.8.2 : sélecteur de cas et boutons Précédent / Cas suivant
          SUPPRIMÉS (demande de l'enseignante) — la page tourne toute
          seule quand l'enseignant lance le cas suivant. */}

      {/* Aucun cas lancé : PAGE D'ATTENTE neutre — l'enseignant ouvre
          chaque cas au moment de l'expliquer, aucun contenu ne fuit. */}
      {!group ? (
        <CaseWaitCard caseNumber={caseNumber} total={totalCases} />
      ) : (
        <>
          {/* En-tête du cas courant */}
          <div className="rounded-2xl border-2 border-lime-300 bg-lime-50 p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-lime-700">
              {totalCases > 1
                ? t('Application {i} sur {n}', { i: caseNumber, n: totalCases })
                : t('Application')}
              {!groupDone && t(' — en cours')}
              {groupDone && t(' — terminé')}
            </p>
            <p className="mt-1.5 text-lg font-bold leading-snug text-stone-900">
              {group.key === 'libres' ? t('Exercices d’application') : group.title}
            </p>
            {group.intro && (
              <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-stone-700">
                {group.intro}
              </p>
            )}
          </div>

          {/* QCU du cas */}
          {group.questions.map((q, qi) => (
            <AppQuestionCard
              key={q.id}
              q={q}
              qi={qi}
              revealed={revealedIds.has(q.id)}
              progress={progressByQuestion.get(q.id)}
              mine={data.teamAppAnswers.find((a) => a.questionId === q.id)}
              optimisticChoice={shownOptimistic[q.id]}
              textDraft={drafts[q.id]}
              saving={saving === q.id}
              sendState={sendStates[q.id]}
              teamName={data.me.team?.name}
              allTeamAppAnswers={data.allTeamAppAnswers ?? []}
              onChoice={(ci) => onChoice(q.id, ci)}
              onTextChange={(v) => setDrafts({ ...drafts, [q.id]: v })}
              onRetry={() => retrySave(q.id)}
              onSaveText={() => {
                const mine = data.teamAppAnswers.find((a) => a.questionId === q.id)
                const choice = shownOptimistic[q.id] ?? mine?.choice ?? 0
                save(q.id, choice, drafts[q.id] ?? mine?.text ?? '')
              }}
            />
          ))}
        </>
      )}

      {/* v2.8.2 : plus de boutons de navigation — un simple état
          d'avancement : l'enseignant pilote le passage au cas suivant. */}
      {group && (
        <div className="flex items-center justify-center rounded-xl border-2 border-dashed border-stone-300 px-3 py-3 text-center text-sm text-stone-500">
          {allDone ? (
            <span className="font-semibold text-emerald-700">
              <Check className="mr-1 inline h-4 w-4" />
              {t('Tous les cas sont traités — attendez votre professeur.')}
            </span>
          ) : isLastCase ? (
            t('Dernier cas — attendez les autres équipes et votre professeur.')
          ) : groupDone ? (
            t('Ce cas est traité — votre professeur lancera le suivant.')
          ) : (
            t('Répondez en équipe — votre professeur lancera le cas suivant le moment venu.')
          )}
        </div>
      )}
    </div>
  )
}

// v2.7.0 — Page d'attente d'un cas clinique non lancé : neutre, sans
// énoncé ni questions (le serveur ne les envoie même pas), pour que
// l'enseignant explique chaque cas séparément sans avance des équipes.
function CaseWaitCard({ caseNumber, total }: { caseNumber: number; total: number }) {
  const { t } = useI18n()
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border-2 border-lime-300 bg-lime-50 p-8 text-center shadow-sm">
        <div className="mx-auto flex h-16 w-16 animate-pulse items-center justify-center rounded-full bg-lime-100">
          <Clock className="h-8 w-8 text-lime-700" />
        </div>
        {total > 1 && (
          <p className="mt-4 text-xs font-bold uppercase tracking-wide text-lime-700">
            {t('Application {i} sur {n}', { i: caseNumber, n: total })}
          </p>
        )}
        <p className="mt-1.5 text-lg font-bold text-stone-900">
          {t('Cas clinique {n} — en préparation', { n: caseNumber })}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-lime-900">
          {t(
            'Votre professeur va présenter ce cas avant de le lancer : gardez cette page ouverte, l’énoncé apparaîtra tout seul dès qu’il sera prêt.'
          )}
        </p>
        <p className="mt-3 rounded-xl bg-white/70 px-4 py-2 text-xs font-semibold text-lime-800">
          {t('Ne quittez pas l’application — l’attente se terminera automatiquement.')}
        </p>
      </div>
    </div>
  )
}

function AppQuestionCard({
  q,
  qi,
  revealed,
  progress,
  mine,
  optimisticChoice,
  textDraft,
  saving,
  sendState,
  teamName,
  allTeamAppAnswers,
  onChoice,
  onTextChange,
  onSaveText,
  onRetry,
}: {
  q: QuestionDTO
  qi: number
  revealed: boolean
  progress?: { questionId: string; answered: number; total: number }
  mine?: { questionId: string; choice: number; text: string | null }
  optimisticChoice?: number
  textDraft?: string
  saving: boolean
  /** v3.1.0 — état d'envoi de CETTE question (Envoi…/Enregistré/
   *  Échec — réessayer) ; l'étudiant ne doute plus jamais de l'état
   *  de sa réponse d'équipe. */
  sendState?: SubmitPhase
  teamName?: string
  allTeamAppAnswers: { teamName: string; questionId: string; choice: number; text: string | null }[]
  onChoice: (ci: number) => void
  onTextChange: (v: string) => void
  onSaveText: () => void
  onRetry: () => void
}) {
  const { t } = useI18n()
  // v2.7.0 : affichage optimiste — la réponse cliquée s'affiche
  // immédiatement, la confirmation du serveur suit en arrière-plan.
  const sel = optimisticChoice ?? mine?.choice
  const textDirty =
    mine !== undefined && textDraft !== undefined && textDraft !== (mine.text ?? '')
  // v3.1.0 — l'état d'envoi explicite PRIME sur l'ancien indicateur :
  // « Enregistrement… » tant que le serveur n'a PAS confirmé, puis
  // « Enregistrée ✓ » ou « Échec + Réessayer ».
  const sending = sendState?.state === 'sending'
  const cardSaving = saving || sending

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wide text-stone-400">
        {t('Question {n}', { n: qi + 1 })}
      </p>
      <p className="mt-2 text-lg font-semibold leading-snug text-stone-900">{q.text}</p>

      <div className="mt-5 space-y-2.5">
        {q.choices.map((c, ci) => {
          let state: 'default' | 'selected' | 'correct' | 'wrong' = 'default'
          if (revealed && q.correct !== undefined) {
            if (ci === q.correct) state = 'correct'
            else if (sel === ci) state = 'wrong'
          } else if (sel === ci) {
            state = 'selected'
          }
          return (
            <ChoiceButton
              key={ci}
              letter={choiceLetter(ci)}
              text={c}
              state={state}
              showIcon={revealed}
              disabled={revealed}
              onClick={() => onChoice(ci)}
            />
          )
        })}
      </div>

      {revealed ? (
        <div className="mt-5 rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
          <p className="mb-2 text-sm font-bold text-amber-900">
            {t('Réponses de toutes les équipes :')}
          </p>
          <div className="space-y-1.5">
            {allTeamAppAnswers
              .filter((a) => a.questionId === q.id)
              .map((a, i) => (
                <div
                  key={i}
                  className={cn(
                    'flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm',
                    a.teamName === teamName && 'border-2 border-emerald-400'
                  )}
                >
                  <span className="text-stone-700">
                    {a.teamName}
                    {a.teamName === teamName && (
                      <span className="ml-1 text-xs font-bold text-emerald-600">
                        {t('(vous)')}
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      'font-bold',
                      q.correct !== undefined && a.choice === q.correct
                        ? 'text-emerald-600'
                        : 'text-stone-800'
                    )}
                  >
                    {choiceLetter(a.choice)}
                  </span>
                </div>
              ))}
            {allTeamAppAnswers.filter((a) => a.questionId === q.id).length === 0 && (
              <p className="text-sm text-stone-500">{t('Aucune équipe n’a répondu.')}</p>
            )}
          </div>
          {q.correct !== undefined && (
            <p className="mt-2 text-xs font-semibold text-amber-900">
              {t('Réponse attendue : {l} — {c}', {
                l: choiceLetter(q.correct),
                c: q.choices[q.correct],
              })}
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Confirmation de l'enregistrement automatique */}
          {mine !== undefined && sendState === undefined && (
            <p
              className={cn(
                'mt-3 text-center text-xs font-medium',
                cardSaving ? 'text-stone-400' : 'text-emerald-700'
              )}
            >
              {cardSaving ? (
                <>
                  <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
                  {t('Enregistrement…')}
                </>
              ) : (
                <>
                  <Check className="mr-1 inline h-3.5 w-3.5" />
                  {t('Réponse enregistrée ({l})', { l: choiceLetter(mine.choice) })}
                  {progress && progress.total > 1
                    ? t(' — en attente des autres équipes ({d}/{n})', {
                        d: progress.answered,
                        n: progress.total,
                      })
                    : ''}
                </>
              )}
            </p>
          )}
          {mine === undefined && cardSaving && sendState === undefined && (
            <p className="mt-3 text-center text-xs font-medium text-stone-400">
              <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
              {t('Enregistrement…')}
            </p>
          )}
          {/* v3.1.0 — état d'envoi EXPLICITE de cette question : Envoi… /
              Enregistré ✓ / Échec — Réessayer. Remplace les anciens
              indicateurs silencieux : plus jamais de doute « c'est
              enregistré ou pas ? ». */}
          {sendState && (
            <SubmitStatus
              phase={sendState}
              onRetry={sendState.state === 'failed' ? onRetry : undefined}
            />
          )}
          {mine === undefined && !saving && progress && progress.total > 1 && (
            <p className="mt-3 text-center text-xs text-stone-500">
              {t('{d}/{n} équipe(s) ont répondu à cette question', {
                d: progress.answered,
                n: progress.total,
              })}
            </p>
          )}
          {mine !== undefined && !textDirty && (
            <p className="mt-2 text-center text-xs text-stone-400">
              {t(
                'Chaque clic enregistre directement la réponse — changez d’avis autant que vous voulez, le dernier clic compte.'
              )}
            </p>
          )}
          <Textarea
            value={textDraft ?? mine?.text ?? ''}
            onChange={(e) => onTextChange(e.target.value)}
            placeholder={t('Justification de votre équipe (facultatif mais recommandé)…')}
            rows={2}
            className="mt-3 resize-none text-[15px]"
          />
          {textDirty && (
            <Button
              className="mt-3 h-11 w-full bg-emerald-600 text-base hover:bg-emerald-700"
              disabled={cardSaving}
              onClick={onSaveText}
            >
              {cardSaving ? (
                t('Envoi…')
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  {t('Enregistrer la justification')}
                </>
              )}
            </Button>
          )}
        </>
      )}
    </div>
  )
}

// ================= Évaluation par les pairs =================

export function PeerView({
  data,
  refresh,
  token,
}: {
  data: StudentStateDTO
  refresh: RefreshFn
  token: string
}) {
  const { toast } = useToast()
  const { t } = useI18n()
  const teammates = data.teamMembers.filter((m) => m.id !== data.me.id)
  const [scores, setScores] = useState<Record<string, number>>({})
  const [comments, setComments] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)
  // v3.1.0 — état d'envoi explicite + réessai (l'upsert par (évaluateur,
  // évalué) est idempotent : renvoyer les mêmes notes ne crée rien).
  const submitState = useSubmitState()
  const submitting = submitState.phase.state === 'sending'

  useEffect(() => {
    const init: Record<string, number> = {}
    const initComments: Record<string, string> = {}
    for (const m of teammates) {
      const existing = data.myPeerEvals?.find((e) => e.evaluatedId === m.id)
      if (existing && scores[m.id] === undefined) init[m.id] = existing.score
      if (existing?.comment && comments[m.id] === undefined) initComments[m.id] = existing.comment
    }
    if (Object.keys(init).length) setScores((s) => ({ ...init, ...s }))
    if (Object.keys(initComments).length) setComments((c) => ({ ...initComments, ...c }))
    // Dépendance volontairement limitée à myPeerEvals : `teammates` est un
    // tableau recréé à chaque rafraîchissement (2,5 s) ; l'inclure ferait
    // tourner cette initialisation en boucle. scores/comments ne sont lus
    // que pour éviter d'écraser une saisie en cours.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.myPeerEvals])

  if (teammates.length === 0) {
    return (
      <InfoCard title={t('Pas de coéquipiers à évaluer')}>
        {t(
          'Vous êtes seul(e) dans votre équipe, il n’y a personne à évaluer. Attendez la fin de cette étape.'
        )}
      </InfoCard>
    )
  }

  const submit = async () => {
    const missing = teammates.filter((m) => scores[m.id] === undefined)
    if (missing.length > 0) {
      toast({
        title: t('Notes incomplètes'),
        description: t('Attribuez une note à {names}.', {
          names: missing.map((m) => m.name).join(', '),
        }),
        variant: 'destructive',
      })
      return
    }
    // v3.1.0 — état d'envoi explicite : la confirmation « envoyées »
    // n'apparaît qu'après la réponse du serveur ; en cas d'échec,
    // message + RÉESSAI (upsert idempotent par (évaluateur, évalué)).
    const result = await submitState.run(() =>
      api<{ ok: boolean }>('/api/peer', {
        method: 'POST',
        body: JSON.stringify({
          token,
          evaluations: teammates.map((m) => ({
            evaluatedId: m.id,
            score: scores[m.id],
            comment: comments[m.id] ?? '',
          })),
        }),
      })
    )
    if (result !== null) {
      setSubmitted(true)
      toast({ title: t('Évaluations envoyées'), description: t('Merci pour votre honnêteté !') })
      await refresh()
    }
  }

  return (
    <div className="space-y-4">
      <InfoCard tone="emerald" title={t('Évaluation de vos coéquipiers')}>
        {t(
          'Notez la contribution de chaque coéquipier pendant la séance (5 = excellente contribution, 1 = très faible). Vos notes sont anonymes pour les autres étudiants ; votre professeur voit les moyennes.'
        )}
      </InfoCard>

      {teammates.map((m) => (
        <div key={m.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <p className="font-bold text-stone-900">{m.name}</p>
          <div className="mt-2 flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setScores({ ...scores, [m.id]: n })}
                aria-label={t('Noter {name} : {n} sur 5', { name: m.name, n })}
                className={cn(
                  'flex h-12 flex-1 flex-col items-center justify-center rounded-xl border-2 text-sm font-bold transition-all',
                  scores[m.id] === n
                    ? 'border-amber-500 bg-amber-500 text-white'
                    : 'border-stone-200 bg-white text-stone-500 hover:border-amber-300'
                )}
              >
                <Star
                  className={cn('h-4 w-4', scores[m.id] === n && 'fill-white')}
                />
                {n}
              </button>
            ))}
          </div>
          <Textarea
            value={comments[m.id] ?? ''}
            onChange={(e) => setComments({ ...comments, [m.id]: e.target.value })}
            placeholder={t("Commentaire (facultatif) : qu'a-t-il/elle apporté à l'équipe ?")}
            rows={2}
            className="mt-3 resize-none text-sm"
          />
        </div>
      ))}

      <Button
        className="h-12 w-full bg-emerald-600 text-base hover:bg-emerald-700"
        disabled={submitting}
        onClick={() => submit()}
      >
        {submitting
          ? t('Envoi…')
          : submitted
            ? t('Mettre à jour mes évaluations')
            : t('Envoyer mes évaluations')}
      </Button>
      {submitState.phase.state !== 'idle' && (
        <SubmitStatus phase={submitState.phase} onRetry={() => submit()} />
      )}
      {submitted && submitState.phase.state !== 'failed' && (
        <p className="text-center text-sm font-medium text-emerald-700">
          <Check className="mr-1 inline h-4 w-4" />
          {t('Évaluations enregistrées. Vous pouvez encore les ajuster.')}
        </p>
      )}
    </div>
  )
}

// ================= Barre de progression des questions =================

function QuestionProgress({
  questions,
  statuses,
  current,
  onSelect,
}: {
  questions: { id: string }[]
  statuses: ('done' | 'failed' | 'pending')[]
  current: number
  onSelect: (i: number) => void
}) {
  const { t } = useI18n()
  return (
    <div className="flex flex-wrap gap-1.5">
      {questions.map((q, i) => (
        <button
          key={q.id}
          onClick={() => onSelect(i)}
          aria-label={t('Aller à la question {n}', { n: i + 1 })}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors',
            i === current
              ? 'border-emerald-600 bg-white text-emerald-700'
              : statuses[i] === 'done'
                ? 'border-emerald-500 bg-emerald-500 text-white'
                : statuses[i] === 'failed'
                  ? 'border-red-300 bg-red-100 text-red-600'
                  : 'border-stone-300 bg-white text-stone-400'
          )}
        >
          {statuses[i] === 'done' ? <Check className="h-4 w-4" /> : statuses[i] === 'failed' ? <X className="h-4 w-4" /> : i + 1}
        </button>
      ))}
    </div>
  )
}
