'use client'

import { useState } from 'react'
import { Clock, KeyRound, LogOut, Trophy, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { api, removeStudentSession, usePoll } from '@/lib/tbl-client'
import { PHASE_INFO, type StudentStateDTO, type SaiItemDTO } from '@/lib/tbl-types'
import { useI18n } from '@/lib/i18n'
import { fmtNote } from '@/lib/grades'
import { SAI_SUBSCALES, SAI_SUBSCALE_INFO, SAI_LIKERT_KEYS, saiItemText } from '@/lib/sai'
import { ChoiceButton, choiceLetter, InfoCard, PhaseBadge } from './shared'
import { IratQuiz, TratQuiz, AppealView, ApplicationView, PeerView } from './student-quizzes'
import { AntiCapture } from './anti-capture'
import { Textarea } from '@/components/ui/textarea'

export function StudentSession({
  token,
  onLeave,
  onExit,
}: {
  token: string
  onLeave: () => void
  onExit: () => void
}) {
  const { data, error, loading, refresh } = usePoll<StudentStateDTO>(
    // v2.4.0 : jeton dans l'en-tête Authorization (hors des journaux serveur).
    () => api<StudentStateDTO>('/api/student', { headers: { Authorization: `Bearer ${token}` } }),
    // Sondage adaptatif : 2,5 s pendant les phases où les étudiants
    // répondent (iRAT, tRAT, application), 5 s pendant les phases d'attente
    // (accueil, réclamations, feedback, pairs, fin) — divise environ par
    // deux la charge sur la base Neon pour une grande classe, sans perte
    // de réactivité là où elle compte.
    (d) => (d && ['irat', 'trat', 'application'].includes(d.session.status) ? 2500 : 5000)
  )
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [showCode, setShowCode] = useState(false)
  const { t } = useI18n()

  if (loading && !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600" />
      </div>
    )
  }

  // Séance mise à la corbeille par l'enseignant : l'accès est coupé
  // (l'enseignant peut encore la restaurer pendant 48 h).
  if (error?.status === 410) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-12 text-center">
        <p className="text-lg font-bold text-stone-900">{t('Séance supprimée')}</p>
        <p className="text-sm text-stone-600">
          {t(
            'Votre enseignant a supprimé cette séance : elle n’est plus accessible. Si vous pensez qu’il s’agit d’une erreur, prévenez-le — il peut la restaurer pendant 48 heures.'
          )}
        </p>
        <Button variant="outline" onClick={onExit} className="h-12 border-stone-300">
          {t('Retour à l’accueil')}
        </Button>
      </div>
    )
  }

  if (error?.status === 404 || (!data && error)) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-12 text-center">
        <p className="text-lg font-bold text-stone-900">{t('Connexion perdue')}</p>
        <p className="text-sm text-stone-600">
          {t(
            'Votre session n’est plus reconnue (séance terminée ou supprimée). Vous pouvez rejoindre à nouveau avec le code de la séance.'
          )}
        </p>
        <Button onClick={onLeave} className="h-12 bg-emerald-600 hover:bg-emerald-700">
          {t('Rejoindre à nouveau')}
        </Button>
      </div>
    )
  }

  if (!data) return null

  const status = data.session.status

  // v2.5.0 : protection anti-capture sur TOUTE la séance étudiante
  // (filigrane nom + code + horodatage, flou en arrière-plan,
  // anti-copie, impression bloquée). Voir anti-capture.tsx.
  return (
    <AntiCapture
      label={`${data.me.name} · ${data.session.code}`}
      printMessage={t('Impression désactivée pendant la séance.')}
      // v2.5.0 : signalement silencieux des suspicions de capture (PC)
      // vers le tableau de bord enseignant.
      reportToken={token}
      // Sorties d'application signalées pendant les phases de test
      // (iRAT, tRAT, application) — signal fiable sur tous les appareils.
      watchTab={['irat', 'trat', 'application'].includes(status)}
      // v2.5.1 : épreuve en cours transmise avec chaque signalement, pour
      // l'affichage « par épreuve » dans l'onglet Signalements enseignant.
      phase={status}
    >
      <div className="mx-auto max-w-2xl space-y-4">
        {/* En-tête */}
      <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold leading-tight text-stone-900">
              {data.session.title}
            </h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
              <PhaseBadge phase={status} />
              <span>{t(PHASE_INFO[status].label)}</span>
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-stone-400 hover:bg-red-50 hover:text-red-600"
            onClick={() => setConfirmLeave(true)}
          >
            <LogOut className="mr-1 h-4 w-4 rtl:rotate-180" />
            {t('Quitter')}
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-stone-100 px-2.5 py-1 font-semibold text-stone-700">
            {data.me.name}
          </span>
          {data.me.team && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 font-semibold text-emerald-800">
              <Users className="h-3 w-3" />
              {data.me.team.name}
            </span>
          )}
          <span className="rounded-full bg-stone-100 px-2.5 py-1 font-mono text-stone-500">
            {data.session.code}
          </span>
          {data.me.recoveryCode && (
            <button
              type="button"
              onClick={() => setShowCode(true)}
              className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-800 transition-colors hover:bg-amber-200"
              title={t('Voir mon code personnel')}
            >
              <KeyRound className="h-3 w-3" />
              {t('code')}
            </button>
          )}
        </div>
      </div>

      {/* Contenu selon la phase */}
        {status === 'lobby' && <LobbyView data={data} />}
        {status === 'irat' && <IratQuiz data={data} refresh={refresh} token={token} />}
        {status === 'trat' && <TratQuiz data={data} refresh={refresh} token={token} />}
        {status === 'appeal' && <AppealView data={data} refresh={refresh} token={token} />}
        {status === 'feedback' && <FeedbackView data={data} />}
        {status === 'application' && <ApplicationView data={data} refresh={refresh} token={token} />}
        {status === 'peer' && <PeerView data={data} refresh={refresh} token={token} />}
        {status === 'finished' && <FinishedView data={data} token={token} refresh={refresh} onExit={onExit} />}

      {/* Mon code de reprise */}
      <AlertDialog open={showCode} onOpenChange={setShowCode}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Mon code personnel')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  {t(
                    'Pour retrouver votre séance sur un autre appareil (ou après une perte de connexion), il vous faut : le code de la séance, votre nom, et ce code personnel.'
                  )}
                </p>
                <p className="select-all rounded-xl bg-stone-900 px-4 py-3 text-center font-mono text-2xl font-bold tracking-[0.35em] text-emerald-300">
                  {data.me.recoveryCode}
                </p>
                <p className="text-xs text-stone-500">
                  {t(
                    'Ne le partagez pas : quiconque le connaît peut reprendre votre compte. Si vous l’avez perdu, demandez-le à votre professeur.'
                  )}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction className="bg-emerald-600 hover:bg-emerald-700">
              {t('J’ai compris')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmation de sortie */}
      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Quitter cette séance ?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'Vos réponses déjà envoyées sont conservées. Vous pourrez revenir avec le même nom, le code de la séance et votre code personnel. (Vous pouvez aussi rester connecté et simplement retourner à l’accueil.)'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Rester')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                removeStudentSession(data.session.code)
                onLeave()
              }}
            >
              {t('Oui, me déconnecter')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </AntiCapture>
  )
}

// ================= Salle d'attente =================

function LobbyView({ data }: { data: StudentStateDTO }) {
  const { t } = useI18n()
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-stone-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 animate-pulse items-center justify-center rounded-full bg-emerald-100">
          <Clock className="h-7 w-7 text-emerald-600" />
        </div>
        <p className="mt-3 text-lg font-bold text-stone-900">
          {t('Bienvenue {name} !', { name: data.me.name })}
        </p>
        <p className="mt-1 text-sm text-stone-600">
          {t(PHASE_INFO.lobby.studentHint)} {t('Cet écran se mettra à jour automatiquement.')}
        </p>
        {data.me.team && (
          <div className="mt-4 rounded-xl bg-emerald-50 p-4">
            <p className="text-sm font-bold text-emerald-900">
              <Users className="mr-1.5 inline h-4 w-4" />
              {data.me.team.name}
            </p>
            <p className="mt-1 text-sm text-emerald-800">
              {data.teamMembers.map((m) => m.name).join(' · ') ||
                t('Vous êtes seul pour le moment')}
            </p>
          </div>
        )}
        {!data.me.team && (
          <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            {t(
              'Vous n’êtes pas encore dans une équipe — votre professeur va vous en attribuer une.'
            )}
          </p>
        )}
      </div>
    </div>
  )
}

// ================= Feedback du professeur =================

function FeedbackView({ data }: { data: StudentStateDTO }) {
  const { t } = useI18n()
  const myScore = data.myIratAnswers.reduce((s, a) => s + (a.score ?? 0), 0)
  const teamScore = data.teamTratAnswers.reduce((s, a) => s + a.score, 0)
  const statsByQuestion = new Map((data.iratStats ?? []).map((s) => [s.questionId, s.percent]))

  return (
    <div className="space-y-4">
      <InfoCard tone="emerald" title={t('Écoutez votre professeur')}>
        {t(PHASE_INFO.feedback.studentHint)}{' '}
        {t('En attendant, voici vos résultats et les réponses correctes.')}
      </InfoCard>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-stone-200 bg-white p-4 text-center">
          <p className="text-2xl font-bold text-stone-900">
            {myScore}
            <span className="text-sm text-stone-400">/{data.questions.length}</span>
          </p>
          <p className="text-xs text-stone-500">{t('Mon score iRAT')}</p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-4 text-center">
          <p className="text-2xl font-bold text-emerald-700">
            {teamScore}
            <span className="text-sm text-stone-400">/{data.questions.length * 4}</span>
          </p>
          <p className="text-xs text-stone-500">{t('Score tRAT de mon équipe')}</p>
        </div>
      </div>

      {data.questions.map((q, qi) => {
        const myAnswer = data.myIratAnswers.find((a) => a.questionId === q.id)
        const percent = statsByQuestion.get(q.id)
        return (
          <div key={q.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-bold text-stone-500">
              {t('Question {n}', { n: qi + 1 })}
            </p>
            <p className="mt-1 font-semibold leading-snug text-stone-900">{q.text}</p>
            <div className="mt-3 space-y-1.5">
              {q.choices.map((c, ci) => {
                const isCorrect = ci === q.correct
                const isMine = myAnswer?.choice === ci
                return (
                  <ChoiceButton
                    key={ci}
                    letter={choiceLetter(ci)}
                    text={c}
                    state={isCorrect ? 'correct' : isMine ? 'wrong' : 'default'}
                    showIcon
                    disabled
                  />
                )
              })}
            </div>
            <div className="mt-2.5 flex items-center justify-between text-xs text-stone-500">
              <span>
                {t('Ma réponse :')}{' '}
                {myAnswer ? (
                  myAnswer.isCorrect ? (
                    <span className="font-bold text-emerald-600">{t('correcte ✓')}</span>
                  ) : (
                    <span className="font-bold text-red-500">{t('incorrecte')}</span>
                  )
                ) : (
                  t('pas répondu')
                )}
              </span>
              {percent !== undefined && <span>{t('{n}% de la classe a réussi', { n: percent })}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ================= Fin de séance =================

function FinishedView({
  data,
  token,
  refresh,
  onExit,
}: {
  data: StudentStateDTO
  token: string
  refresh: () => Promise<unknown>
  onExit: () => void
}) {
  // v2.6.0 : l'étudiant doit d'abord répondre au questionnaire de fin de
  // séance (TBL-SAI) pour accéder à sa note et à son rang. La note et le
  // rang ne sont transmis par le serveur qu'APRÈS la soumission : ce
  // verrou ne peut pas être contourné depuis le navigateur.
  if (!data.me.saiCompletedAt) {
    return <SaiQuestionnaire data={data} token={token} refresh={refresh} onExit={onExit} />
  }
  return <FinalResults data={data} onExit={onExit} />
}

// ---------- Questionnaire TBL-SAI (avant l'accès à la note) ----------

function SaiQuestionnaire({
  data,
  token,
  refresh,
  onExit,
}: {
  data: StudentStateDTO
  token: string
  refresh: () => Promise<unknown>
  onExit: () => void
}) {
  const { t } = useI18n()
  const items = data.saiItems ?? []
  // Réponses locales : id d'item -> valeur 1 à 5
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  const answered = Object.keys(answers).length
  // Questionnaire sans items (séance personnalisée) : envoi direct.
  const allAnswered = answered === items.length

  const submit = async () => {
    if (!allAnswered || sending) {
      setError(t('Répondez à toutes les questions pour continuer.'))
      return
    }
    setError('')
    setSending(true)
    try {
      await api('/api/sai', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          responses: items.map((it) => ({ itemId: it.id, value: answers[it.id] })),
          comment: comment.trim() || undefined,
        }),
      })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Erreur inconnue.'))
      setSending(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* En-tête */}
      <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-5 text-center">
        <p className="text-lg font-bold text-emerald-900">
          {t('Séance terminée, bravo !')}
        </p>
        <p className="mt-1 text-sm font-semibold text-emerald-800">
          {t('Questionnaire de fin de séance')}
        </p>
        <p className="mt-1 text-sm text-emerald-800">
          {t('Répondez à ce questionnaire pour accéder à votre note et à votre rang.')}
        </p>
      </div>

      {/* Consignes de l'instrument */}
      <InfoCard tone="emerald" title={t('Questionnaire de fin de séance')}>
        <p className="leading-relaxed">
          {t(
            'Ce questionnaire porte sur votre expérience avec l’apprentissage par équipes (TBL). Il n’y a ni bonnes ni mauvaises réponses. Répondez honnêtement et indiquez votre réaction réelle à chaque question.'
          )}
        </p>
        <p className="mt-2 text-xs font-semibold text-stone-600">
          {t('L’échelle est la même pour toutes les affirmations :')}
        </p>
        <div className="mt-1.5 grid grid-cols-1 gap-1 text-xs text-stone-600 sm:grid-cols-2">
          {SAI_LIKERT_KEYS.map((label, i) => (
            <p key={label}>
              <span className="font-mono font-bold text-stone-800">{i + 1}</span> — {t(label)}
            </p>
          ))}
        </div>
      </InfoCard>

      {/* Une section par sous-échelle */}
      {SAI_SUBSCALES.map((sub) => {
        const sectionItems = items.filter((it) => it.subscale === sub)
        if (sectionItems.length === 0) return null
        const info = SAI_SUBSCALE_INFO[sub]
        return (
          <section key={sub} className="space-y-2.5">
            <div className="rounded-xl bg-stone-100 px-4 py-3">
              <p className="text-sm font-bold text-stone-800">{t(info.labelKey)}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-stone-500">
                {t(info.descriptionKey)}
              </p>
            </div>
            {sectionItems.map((it) => (
              <SaiItemRow
                key={it.id}
                item={it}
                value={answers[it.id]}
                onPick={(v) => setAnswers((prev) => ({ ...prev, [it.id]: v }))}
              />
            ))}
          </section>
        )
      })}

      {/* Commentaire facultatif */}
      <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <label htmlFor="sai-comment" className="text-sm font-bold text-stone-800">
          {t(
            'Si vous le souhaitez, ajoutez un commentaire sur votre expérience de l’apprentissage par équipes :'
          )}{' '}
          <span className="font-normal text-stone-400">{t('(facultatif)')}</span>
        </label>
        <Textarea
          id="sai-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          maxLength={1000}
          className="mt-2 resize-none text-[15px]"
        />
      </div>

      {/* Progression + envoi */}
      <div className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <p className="text-center text-sm font-semibold text-stone-600">
          {t('{n} / {total} réponses', { n: answered, total: items.length })}
        </p>
        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <Button
          onClick={submit}
          disabled={sending || answered < items.length}
          className="h-12 w-full bg-emerald-600 text-base hover:bg-emerald-700"
        >
          {sending ? t('Envoi en cours…') : t('Envoyer mes réponses')}
        </Button>
        {answered < items.length && (
          <p className="text-center text-xs text-stone-500">
            {t('Répondez à toutes les questions pour continuer.')}
          </p>
        )}
      </div>

      <Button
        variant="outline"
        onClick={onExit}
        className="h-11 w-full border-stone-300 text-stone-600"
      >
        {t('Retour à l’accueil')}
      </Button>
    </div>
  )
}

function SaiItemRow({
  item,
  value,
  onPick,
}: {
  item: SaiItemDTO
  value: number | undefined
  onPick: (v: number) => void
}) {
  const { t } = useI18n()
  const text = saiItemText(item)
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-medium leading-relaxed text-stone-800">{t(text)}</p>
      <div
        className="mt-3 grid grid-cols-5 gap-1.5"
        role="radiogroup"
        aria-label={t(text)}
      >
        {SAI_LIKERT_KEYS.map((label, i) => {
          const v = i + 1
          const selected = value === v
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${v} — ${t(label)}`}
              onClick={() => onPick(v)}
              className={
                'flex h-11 min-h-11 items-center justify-center rounded-xl border-2 text-base font-bold transition-all active:scale-95 ' +
                (selected
                  ? 'border-emerald-600 bg-emerald-600 text-white shadow-sm'
                  : 'border-stone-200 bg-white text-stone-600 hover:border-emerald-300 hover:bg-emerald-50')
              }
            >
              {v}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------- Résultats : note finale + rang (après le questionnaire) ----------

function FinalResults({ data, onExit }: { data: StudentStateDTO; onExit: () => void }) {
  const { t } = useI18n()
  const note = data.finalNote ?? null
  const rank = data.myRank ?? null

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-6 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white">
          <Trophy className="h-7 w-7" />
        </span>
        <p className="mt-3 text-lg font-bold text-emerald-900">
          {t('Séance terminée, bravo !')}
        </p>
        <p className="mt-1 text-sm text-emerald-800">
          {t('Merci d’avoir partagé votre expérience !')}
        </p>
        <p className="mt-1 text-sm text-emerald-800">
          {t('Merci pour votre participation. Voici votre résultat.')}
        </p>
      </div>

      {/* Note finale sur 20 — calculée par le serveur, sans détail des
          composantes et SANS les corrections (protection anti-divulgation) */}
      {note !== null && (
        <div className="rounded-2xl border-2 border-stone-800 bg-stone-900 p-6 text-center shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">
            {t('Ma note finale')}
          </p>
          <p className="mt-1 text-5xl font-black text-white">
            {fmtNote(note)}
            <span className="text-xl font-bold text-stone-400"> / 20</span>
          </p>
        </div>
      )}

      {/* Rang parmi les étudiants notés de la séance — uniquement le
          sien : aucun classement des autres étudiants n'est affiché */}
      {rank !== null && (
        <div className="rounded-2xl border-2 border-emerald-700 bg-white p-6 text-center shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            {t('Mon rang')}
          </p>
          <p className="mt-1 text-4xl font-black text-emerald-800">
            {t('Rang {rank} / {total}', { rank: rank.rank, total: rank.total })}
          </p>
          <p className="mt-2 text-sm text-stone-500">
            {t('Votre position parmi les {total} étudiants notés de la séance.', {
              total: rank.total,
            })}
          </p>
        </div>
      )}

      <Button
        variant="outline"
        onClick={onExit}
        className="h-11 w-full border-stone-300 text-stone-600"
      >
        {t('Retour à l’accueil')}
      </Button>
    </div>
  )
}
