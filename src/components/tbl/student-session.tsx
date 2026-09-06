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
import { PHASE_INFO, type StudentStateDTO } from '@/lib/tbl-types'
import { useI18n } from '@/lib/i18n'
import { gradeForStudentSelf, fmtNote } from '@/lib/grades'
import { ChoiceButton, choiceLetter, InfoCard, PhaseBadge } from './shared'
import { IratQuiz, TratQuiz, AppealView, ApplicationView, PeerView } from './student-quizzes'
import { AntiCapture } from './anti-capture'

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
              title={t('Voir mon code de reprise')}
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
        {status === 'finished' && <FinishedView data={data} onExit={onExit} />}

      {/* Mon code de reprise */}
      <AlertDialog open={showCode} onOpenChange={setShowCode}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Mon code de reprise')}</AlertDialogTitle>
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
                'Vos réponses déjà envoyées sont conservées. Vous pourrez revenir avec le même nom et le même code de séance. (Vous pouvez aussi rester connecté et simplement retourner à l’accueil.)'
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

function FinishedView({ data, onExit }: { data: StudentStateDTO; onExit: () => void }) {
  const { t } = useI18n()
  const grade = gradeForStudentSelf(data)

  // Réponses correctes : questions de préparation puis cas cliniques
  const appCases = data.appCases ?? []
  const caseQuestions = (caseId: string) =>
    data.applicationQuestions.filter((q) => q.caseId === caseId)
  const freeAppQuestions = data.applicationQuestions.filter((q) => !q.caseId)

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-6 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white">
          <Trophy className="h-7 w-7" />
        </span>
        <p className="mt-3 text-lg font-bold text-emerald-900">{t('Séance terminée, bravo !')}</p>
        <p className="mt-1 text-sm text-emerald-800">
          {t('Merci pour votre participation. Voici votre résultat.')}
        </p>
      </div>

      {/* Note finale sur 20 — sans détails, comme demandé */}
      {grade.final !== null && (
        <div className="rounded-2xl border-2 border-stone-800 bg-stone-900 p-6 text-center shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">
            {t('Ma note finale')}
          </p>
          <p className="mt-1 text-5xl font-black text-white">
            {fmtNote(grade.final)}
            <span className="text-xl font-bold text-stone-400"> / 20</span>
          </p>
        </div>
      )}

      {/* Réponses correctes */}
      <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-bold text-stone-800">{t('Réponses correctes')}</p>
        <div className="space-y-2">
          {data.questions.map((q, qi) => (
            <div key={q.id} className="rounded-xl bg-stone-50 p-3">
              <p className="text-sm font-medium text-stone-800">
                Q{qi + 1}. {q.text}
              </p>
              <p className="mt-1 text-xs text-stone-600">
                {t('Bonne réponse :')}{' '}
                <strong className="text-emerald-700">
                  {choiceLetter(q.correct ?? 0)} — {q.choices[q.correct ?? 0]}
                </strong>
              </p>
            </div>
          ))}

          {appCases.map((c, ci) => (
            <div key={c.id} className="rounded-xl border border-lime-200 bg-lime-50/60 p-3">
              <p className="text-sm font-bold text-lime-800">
                {t('Application {n}', { n: ci + 1 })} — {c.title}
              </p>
              <div className="mt-2 space-y-2">
                {caseQuestions(c.id).map((q, qi) => (
                  <div key={q.id} className="rounded-lg bg-white p-2.5">
                    <p className="text-sm font-medium text-stone-800">
                      Q{qi + 1}. {q.text}
                    </p>
                    <p className="mt-1 text-xs text-stone-600">
                      {t('Bonne réponse :')}{' '}
                      <strong className="text-emerald-700">
                        {q.correct !== undefined
                          ? `${choiceLetter(q.correct)} — ${q.choices[q.correct]}`
                          : '—'}
                      </strong>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {freeAppQuestions.length > 0 && (
            <div className="rounded-xl border border-lime-200 bg-lime-50/60 p-3">
              <p className="text-sm font-bold text-lime-800">{t('Exercices d’application')}</p>
              <div className="mt-2 space-y-2">
                {freeAppQuestions.map((q, qi) => (
                  <div key={q.id} className="rounded-lg bg-white p-2.5">
                    <p className="text-sm font-medium text-stone-800">
                      Ex. {qi + 1}. {q.text}
                    </p>
                    <p className="mt-1 text-xs text-stone-600">
                      {t('Bonne réponse :')}{' '}
                      <strong className="text-emerald-700">
                        {q.correct !== undefined
                          ? `${choiceLetter(q.correct)} — ${q.choices[q.correct]}`
                          : '—'}
                      </strong>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
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
