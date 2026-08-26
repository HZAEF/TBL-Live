'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, RotateCcw, Send, Star, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { api } from '@/lib/tbl-client'
import type { StudentStateDTO } from '@/lib/tbl-types'
import { ChoiceButton, choiceLetter, Countdown, InfoCard } from './shared'
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
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const q = questions[Math.min(index, questions.length - 1)]
  const done = questions.length > 0 && questions.every((x) => answered.has(x.id))

  useEffect(() => {
    setSelected(null)
    setError('')
  }, [q?.id])

  if (questions.length === 0) {
    return <InfoCard title="Aucune question">Votre professeur n&apos;a pas encore ajouté de questions.</InfoCard>
  }

  if (done) {
    return (
      <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-6 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white">
          <Check className="h-7 w-7" />
        </span>
        <p className="mt-3 text-lg font-bold text-emerald-900">Réponses enregistrées !</p>
        <p className="mt-1 text-sm text-emerald-800">
          Vous avez répondu aux {questions.length} questions. Attendez les instructions de votre
          professeur.
        </p>
      </div>
    )
  }

  const submit = async () => {
    if (selected === null) return
    setSubmitting(true)
    setError('')
    try {
      await api('/api/answer', {
        method: 'POST',
        body: JSON.stringify({ token, questionId: q.id, choice: selected }),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue.')
      return
    } finally {
      setSubmitting(false)
    }
    setSelected(null)
    await refresh()
    setIndex((i) => Math.min(i + 1, questions.length - 1))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm">
        <span className="font-semibold text-amber-900">Test individuel — répondez seul(e)</span>
        <Countdown startedAt={data.session.phaseStartedAt} minutes={data.session.iratMinutes} />
      </div>

      <QuestionProgress questions={questions} statuses={questions.map((x) => (answered.has(x.id) ? 'done' : 'pending'))} current={index} onSelect={setIndex} />

      <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-stone-400">
          Question {index + 1} sur {questions.length}
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
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <Button
          className="mt-5 h-12 w-full bg-emerald-600 text-base hover:bg-emerald-700"
          disabled={selected === null || submitting}
          onClick={submit}
        >
          {submitting ? 'Envoi…' : 'Valider ma réponse'}
          <ArrowRight className="ml-2 h-5 w-5" />
        </Button>
        <p className="mt-2 text-center text-xs text-stone-500">
          Attention : une fois validée, la réponse ne peut plus être modifiée.
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
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ correct: boolean; score: number; attempt: number } | null>(null)

  const q = questions[Math.min(index, questions.length - 1)]
  const attempts = useMemo(
    () => data.teamTratAnswers.filter((a) => a.questionId === q?.id),
    [data.teamTratAnswers, q?.id]
  )
  const found = attempts.some((a) => a.isCorrect)
  const exhausted = attempts.length >= 4 && !found
  const teamScore = data.teamTratAnswers.reduce((s, a) => s + a.score, 0)

  useEffect(() => {
    setSelected(null)
    setFeedback(null)
  }, [q?.id])

  if (!team) {
    return (
      <InfoCard tone="amber" title="Vous n'êtes pas dans une équipe">
        Prévenez votre professeur : il peut vous affecter à une équipe depuis son tableau de bord.
      </InfoCard>
    )
  }
  if (questions.length === 0) {
    return <InfoCard title="Aucune question">Aucune question disponible pour le test.</InfoCard>
  }

  const submit = async () => {
    if (selected === null) return
    setSubmitting(true)
    try {
      const res = await api<{ attempt: number; isCorrect: boolean; score: number }>(
        '/api/team-answer',
        { method: 'POST', body: JSON.stringify({ token, questionId: q.id, choice: selected }) }
      )
      setFeedback({ correct: res.isCorrect, score: res.score, attempt: res.attempt })
      if (res.isCorrect) {
        toast({
          title: `Bonne réponse ! +${res.score} point${res.score > 1 ? 's' : ''}`,
          description: res.attempt === 1 ? 'Trouvé du premier coup 🎉' : `Trouvé à la ${res.attempt}ᵉ tentative.`,
        })
      }
      await refresh()
    } catch (e) {
      toast({
        title: 'Impossible d\u2019envoyer',
        description: e instanceof Error ? e.message : 'Erreur inconnue.',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
      setSelected(null)
    }
  }

  const questionDone = found || exhausted
  const statuses = questions.map((x) => {
    const at = data.teamTratAnswers.filter((a) => a.questionId === x.id)
    if (at.some((a) => a.isCorrect)) return 'done'
    if (at.length >= 4) return 'failed'
    return 'pending'
  })

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-4">
        <p className="flex items-center gap-2 font-bold text-emerald-900">
          <Users className="h-5 w-5" />
          Test en équipe — {team.name}
        </p>
        <p className="mt-1 text-sm text-emerald-800">
          Membres : {data.teamMembers.map((m) => m.name).join(', ')}
        </p>
        <p className="mt-1.5 text-sm font-semibold text-emerald-900">
          Discutez ensemble avant de valider ! Score de l&apos;équipe : {teamScore} pts
        </p>
      </div>

      <QuestionProgress questions={questions} statuses={statuses} current={index} onSelect={setIndex} />

      <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-stone-400">
          Question {index + 1} sur {questions.length}
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
            Ce n&apos;est pas la bonne réponse. Réessayez :{' '}
            {feedback.attempt < 4
              ? `${TRAT_POINTS[feedback.attempt] ?? 0} point(s) encore en jeu.`
              : 'tentatives épuisées.'}
          </p>
        )}
        {feedback && feedback.correct && (
          <p className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
            <Check className="mr-1.5 inline h-4 w-4" />
            Bonne réponse ! +{feedback.score} point(s) pour l&apos;équipe
          </p>
        )}
        {exhausted && (
          <p className="mt-4 rounded-xl border border-stone-300 bg-stone-100 px-4 py-3 text-sm text-stone-700">
            Les 4 tentatives sont épuisées pour cette question (0 point). La bonne réponse sera
            révélée à l&apos;étape suivante.
          </p>
        )}

        {!found ? (
          <Button
            className="mt-5 h-12 w-full bg-emerald-600 text-base hover:bg-emerald-700"
            disabled={selected === null || submitting || exhausted}
            onClick={submit}
          >
            {submitting ? 'Envoi…' : `Valider pour l'équipe (${TRAT_POINTS[attempts.length] ?? 0} pt en jeu)`}
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
            Question suivante
            <ArrowRight className="ml-2 h-5 w-5" />
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
  const [submitting, setSubmitting] = useState<string | null>(null)
  const appealByQuestion = new Map(data.myAppeals.map((a) => [a.questionId, a]))

  if (!data.me.team) {
    return (
      <InfoCard tone="amber" title="Vous n'êtes pas dans une équipe">
        Prévenez votre professeur.
      </InfoCard>
    )
  }

  const submit = async (questionId: string) => {
    const text = (drafts[questionId] ?? '').trim()
    if (text.length < 10) {
      toast({
        title: 'Justification trop courte',
        description: 'Expliquez en au moins 10 caractères pourquoi votre réponse devrait être acceptée.',
        variant: 'destructive',
      })
      return
    }
    setSubmitting(questionId)
    try {
      await api('/api/appeal', {
        method: 'POST',
        body: JSON.stringify({ token, questionId, text }),
      })
      toast({ title: 'Réclamation envoyée', description: 'Votre professeur va l\u2019examiner.' })
      await refresh()
    } catch (e) {
      toast({
        title: 'Impossible d\u2019envoyer',
        description: e instanceof Error ? e.message : 'Erreur inconnue.',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <div className="space-y-4">
      <InfoCard tone="amber" title="Réclamations (appels)">
        Si vous pensez qu&apos;une de vos réponses devrait être acceptée (question ambiguë, sources
        contradictoires…), écrivez une justification claire. Votre professeur décidera.
      </InfoCard>
      {data.questions.map((q, qi) => {
        const attempts = data.teamTratAnswers.filter((a) => a.questionId === q.id)
        const found = attempts.some((a) => a.isCorrect)
        const appeal = appealByQuestion.get(q.id)
        return (
          <div key={q.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-bold text-stone-500">Question {qi + 1}</p>
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
                ? `Votre équipe a trouvé la bonne réponse (${attempts.length} tentative(s)).`
                : attempts.length > 0
                  ? `Réponse(s) tentée(s) : ${attempts.map((a) => choiceLetter(a.choice)).join(', ')} — sans succès.`
                  : 'Votre équipe n\u2019a pas répondu à cette question.'}
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
                  ? 'Réclamation acceptée (+4 pts)'
                  : appeal.status === 'rejected'
                    ? 'Réclamation refusée'
                    : 'Réclamation en attente'}
              </p>
            )}

            <Textarea
              value={drafts[q.id] ?? appeal?.text ?? ''}
              onChange={(e) => setDrafts({ ...drafts, [q.id]: e.target.value })}
              placeholder="Votre justification : pourquoi cette réponse devrait-elle être acceptée ?"
              rows={3}
              className="mt-3 resize-none text-[15px]"
            />
            <Button
              className="mt-2 h-11 w-full bg-amber-600 hover:bg-amber-700"
              disabled={submitting === q.id}
              onClick={() => submit(q.id)}
            >
              <Send className="mr-2 h-4 w-4" />
              {appeal ? 'Mettre à jour la réclamation' : 'Envoyer la réclamation'}
            </Button>
          </div>
        )
      })}
    </div>
  )
}

// ================= Application =================

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
  const questions = data.applicationQuestions
  const [selected, setSelected] = useState<Record<string, number>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState<string | null>(null)
  const revealed = data.session.revealed

  if (!data.me.team) {
    return (
      <InfoCard tone="amber" title="Vous n'êtes pas dans une équipe">
        Prévenez votre professeur.
      </InfoCard>
    )
  }
  if (questions.length === 0) {
    return (
      <InfoCard title="Aucun exercice">
        Votre professeur n&apos;a pas prévu d&apos;exercice d&apos;application pour cette séance.
        Attendez la suite.
      </InfoCard>
    )
  }

  const submit = async (questionId: string) => {
    const choice = selected[questionId]
    if (choice === undefined) {
      toast({
        title: 'Choisissez une réponse',
        description: 'Sélectionnez d\u2019abord la réponse de votre équipe.',
        variant: 'destructive',
      })
      return
    }
    setSubmitting(questionId)
    try {
      await api('/api/app-answer', {
        method: 'POST',
        body: JSON.stringify({ token, questionId, choice, text: drafts[questionId] ?? '' }),
      })
      toast({ title: 'Réponse enregistrée', description: 'Vous pouvez encore la modifier avant la révélation.' })
      await refresh()
    } catch (e) {
      toast({
        title: 'Impossible d\u2019envoyer',
        description: e instanceof Error ? e.message : 'Erreur inconnue.',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <div className="space-y-4">
      <InfoCard tone="emerald" title="Exercice d'application">
        Travaillez le problème en équipe, choisissez ensemble une réponse et justifiez-la. Toutes
        les équipes verront les réponses au même moment quand votre professeur les révélera.
      </InfoCard>

      {questions.map((q, qi) => {
        const mine = data.teamAppAnswers.find((a) => a.questionId === q.id)
        const sel = selected[q.id] ?? mine?.choice
        return (
          <div key={q.id} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-stone-400">
              Exercice {qi + 1}
            </p>
            <p className="mt-2 text-lg font-semibold leading-snug text-stone-900">{q.text}</p>
            <div className="mt-5 space-y-2.5">
              {q.choices.map((c, ci) => (
                <ChoiceButton
                  key={ci}
                  letter={choiceLetter(ci)}
                  text={c}
                  state={sel === ci ? 'selected' : 'default'}
                  disabled={revealed}
                  onClick={() => setSelected({ ...selected, [q.id]: ci })}
                />
              ))}
            </div>

            {!revealed ? (
              <>
                <Textarea
                  value={drafts[q.id] ?? mine?.text ?? ''}
                  onChange={(e) => setDrafts({ ...drafts, [q.id]: e.target.value })}
                  placeholder="Justification de votre équipe (facultatif mais recommandé)…"
                  rows={3}
                  className="mt-4 resize-none text-[15px]"
                />
                <Button
                  className="mt-3 h-12 w-full bg-emerald-600 text-base hover:bg-emerald-700"
                  disabled={submitting === q.id}
                  onClick={() => submit(q.id)}
                >
                  {mine ? (
                    <>
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Mettre à jour la réponse de l&apos;équipe
                    </>
                  ) : (
                    <>
                      <Send className="mr-2 h-4 w-4" />
                      Envoyer la réponse de l&apos;équipe
                    </>
                  )}
                </Button>
                {mine && (
                  <p className="mt-2 text-center text-xs font-medium text-emerald-700">
                    <Check className="mr-1 inline h-3.5 w-3.5" />
                    Réponse enregistrée ({choiceLetter(mine.choice)}) — modifiable jusqu&apos;à la
                    révélation.
                  </p>
                )}
              </>
            ) : (
              <div className="mt-5 rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
                <p className="mb-2 text-sm font-bold text-amber-900">
                  Réponses de toutes les équipes :
                </p>
                <div className="space-y-1.5">
                  {(data.allTeamAppAnswers ?? [])
                    .filter((a) => a.questionId === q.id)
                    .map((a, i) => (
                      <div
                        key={i}
                        className={cn(
                          'flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm',
                          a.teamName === data.me.team?.name && 'border-2 border-emerald-400'
                        )}
                      >
                        <span className="text-stone-700">
                          {a.teamName}
                          {a.teamName === data.me.team?.name && (
                            <span className="ml-1 text-xs font-bold text-emerald-600">(vous)</span>
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
                  {(data.allTeamAppAnswers ?? []).filter((a) => a.questionId === q.id).length ===
                    0 && <p className="text-sm text-stone-500">Aucune équipe n&apos;a répondu.</p>}
                </div>
                {q.correct !== undefined && (
                  <p className="mt-2 text-xs text-amber-800">
                    Réponse attendue : {choiceLetter(q.correct)}
                  </p>
                )}
              </div>
            )}
          </div>
        )
      })}
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
  const teammates = data.teamMembers.filter((m) => m.id !== data.me.id)
  const [scores, setScores] = useState<Record<string, number>>({})
  const [comments, setComments] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

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
  }, [data.myPeerEvals])

  if (teammates.length === 0) {
    return (
      <InfoCard title="Pas de coéquipiers à évaluer">
        Vous êtes seul(e) dans votre équipe, il n&apos;y a personne à évaluer. Attendez la fin de
        cette étape.
      </InfoCard>
    )
  }

  const submit = async () => {
    const missing = teammates.filter((m) => scores[m.id] === undefined)
    if (missing.length > 0) {
      toast({
        title: 'Notes incomplètes',
        description: `Attribuez une note à ${missing.map((m) => m.name).join(', ')}.`,
        variant: 'destructive',
      })
      return
    }
    setSubmitting(true)
    try {
      await api('/api/peer', {
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
      setSubmitted(true)
      toast({ title: 'Évaluations envoyées', description: 'Merci pour votre honnêteté !' })
      await refresh()
    } catch (e) {
      toast({
        title: 'Impossible d\u2019envoyer',
        description: e instanceof Error ? e.message : 'Erreur inconnue.',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <InfoCard tone="emerald" title="Évaluation de vos coéquipiers">
        Notez la contribution de chaque coéquipier pendant la séance (5 = excellente
        contribution, 1 = très faible). Vos notes sont anonymes pour les autres étudiants ; votre
        professeur voit les moyennes.
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
                aria-label={`Noter ${m.name} : ${n} sur 5`}
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
            placeholder="Commentaire (facultatif) : qu'a-t-il/elle apporté à l'équipe ?"
            rows={2}
            className="mt-3 resize-none text-sm"
          />
        </div>
      ))}

      <Button
        className="h-12 w-full bg-emerald-600 text-base hover:bg-emerald-700"
        disabled={submitting}
        onClick={submit}
      >
        {submitting ? 'Envoi…' : submitted ? 'Mettre à jour mes évaluations' : 'Envoyer mes évaluations'}
      </Button>
      {submitted && (
        <p className="text-center text-sm font-medium text-emerald-700">
          <Check className="mr-1 inline h-4 w-4" />
          Évaluations enregistrées. Vous pouvez encore les ajuster.
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
  return (
    <div className="flex flex-wrap gap-1.5">
      {questions.map((q, i) => (
        <button
          key={q.id}
          onClick={() => onSelect(i)}
          aria-label={`Aller à la question ${i + 1}`}
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
