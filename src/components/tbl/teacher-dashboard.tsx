'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Copy,
  Check,
  Users,
  Timer,
  ArrowRight,
  Wifi,
  Wand2,
  Eye,
  EyeOff,
  Download,
  LogOut,
  RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { api, usePoll } from '@/lib/tbl-client'
import {
  PHASE_INFO,
  PHASE_ORDER,
  nextPhase,
  type DashboardDTO,
  type Phase,
} from '@/lib/tbl-types'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { Countdown, ElapsedSince, InfoCard, PhaseBadge, choiceLetter } from './shared'
import { TeamsTab, QuestionsTab, ResultsTab, AppealsTab, exportCsv } from './teacher-tabs'

export function TeacherDashboard({
  code,
  token,
  onExit,
  onAuthError,
}: {
  code: string
  token: string
  onExit: () => void
  onAuthError: () => void
}) {
  const { data, error, loading, refresh } = usePoll<DashboardDTO>(
    () => api<DashboardDTO>(`/api/sessions/${code}/dashboard?token=${encodeURIComponent(token)}`),
    2500
  )
  const { toast } = useToast()
  const [pendingPhase, setPendingPhase] = useState<Phase | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    if (error?.status === 401) {
      onAuthError()
    }
  }, [error?.status, onAuthError])

  const manage = async (action: string, extra: Record<string, unknown> = {}) => {
    try {
      await api(`/api/sessions/${code}/manage`, {
        method: 'POST',
        body: JSON.stringify({ token, action, ...extra }),
      })
      await refresh()
      return true
    } catch (e) {
      toast({
        title: 'Action impossible',
        description: e instanceof Error ? e.message : 'Erreur inconnue.',
        variant: 'destructive',
      })
      return false
    }
  }

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      toast({ title: 'Copie impossible', description: 'Copiez le code manuellement.' })
    }
  }

  const ratQs = useMemo(() => data?.questions.filter((q) => q.phase === 'rat') ?? [], [data])
  const appQs = useMemo(() => data?.questions.filter((q) => q.phase === 'application') ?? [], [data])

  if (loading && !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600" />
      </div>
    )
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-16 text-center">
        <p className="font-semibold text-stone-800">Séance introuvable</p>
        <Button variant="outline" onClick={onExit} className="border-stone-300">
          Retour
        </Button>
      </div>
    )
  }

  const status = data.session.status
  const next = nextPhase(status)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const unassigned = data.students.filter((s) => !s.teamId)
  const pendingAppeals = data.appeals.filter((a) => a.status === 'pending').length

  const confirmPhase = (phase: Phase) => setPendingPhase(phase)

  return (
    <div className="space-y-5">
      {/* En-tête */}
      <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-bold text-stone-900 sm:text-2xl">
                {data.session.title}
              </h1>
              <PhaseBadge phase={status} />
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-stone-500">
              <Wifi className="h-3.5 w-3.5 animate-pulse text-emerald-500" />
              En direct · actualisation automatique
              <button
                onClick={() => refresh()}
                className="ml-1 rounded p-1 hover:bg-stone-100"
                aria-label="Actualiser maintenant"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onExit} className="border-stone-300">
            <LogOut className="mr-1 h-4 w-4" />
            Quitter
          </Button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50 p-3 text-center sm:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
              Code à donner aux étudiants
            </p>
            <p className="mt-1 font-mono text-4xl font-bold tracking-[0.25em] text-emerald-800">
              {data.session.code}
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-100"
                onClick={() => copy(data.session.code, 'code')}
              >
                {copied === 'code' ? (
                  <Check className="mr-1 h-3.5 w-3.5" />
                ) : (
                  <Copy className="mr-1 h-3.5 w-3.5" />
                )}
                Copier le code
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-100"
                onClick={() =>
                  copy(`${origin} — code : ${data.session.code}`, 'url')
                }
              >
                {copied === 'url' ? (
                  <Check className="mr-1 h-3.5 w-3.5" />
                ) : (
                  <Copy className="mr-1 h-3.5 w-3.5" />
                )}
                Copier le lien + code
              </Button>
            </div>
          </div>
          <div className="flex flex-col justify-center gap-1 rounded-xl bg-stone-100 p-3 text-sm">
            <p className="flex items-center gap-2 text-stone-700">
              <Users className="h-4 w-4 text-emerald-600" />
              <strong>{data.students.length}</strong> étudiant(s) ·{' '}
              <strong>{data.teams.length}</strong> équipe(s)
            </p>
            <p className="flex items-center gap-2 text-stone-700">
              <Timer className="h-4 w-4 text-emerald-600" />
              {status === 'irat' ? (
                <>
                  Temps restant :{' '}
                  <Countdown
                    startedAt={data.session.phaseStartedAt}
                    minutes={data.session.iratMinutes}
                  />
                </>
              ) : (
                <>
                  Phase en cours depuis :{' '}
                  <ElapsedSince startedAt={data.session.phaseStartedAt} />
                </>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Fil des phases */}
      <PhaseStepper current={status} onSelect={confirmPhase} />

      {/* Onglets */}
      <Tabs defaultValue="overview">
        <TabsList className="h-auto w-full justify-start overflow-x-auto bg-stone-100 p-1">
          <TabsTrigger value="overview" className="flex-1 px-3 py-2 sm:flex-none">
            Déroulé
          </TabsTrigger>
          <TabsTrigger value="teams" className="flex-1 px-3 py-2 sm:flex-none">
            Équipes
          </TabsTrigger>
          <TabsTrigger value="questions" className="flex-1 px-3 py-2 sm:flex-none">
            Questions
          </TabsTrigger>
          <TabsTrigger value="results" className="flex-1 px-3 py-2 sm:flex-none">
            Résultats
          </TabsTrigger>
          <TabsTrigger value="appeals" className="flex-1 px-3 py-2 sm:flex-none">
            Réclamations
            {pendingAppeals > 0 && (
              <span className="ml-1.5 rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {pendingAppeals}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <OverviewPanel
            data={data}
            ratQs={ratQs}
            appQs={appQs}
            manage={manage}
            onPhase={confirmPhase}
          />
        </TabsContent>
        <TabsContent value="teams" className="mt-4">
          <TeamsTab data={data} manage={manage} />
        </TabsContent>
        <TabsContent value="questions" className="mt-4">
          <QuestionsTab data={data} manage={manage} />
        </TabsContent>
        <TabsContent value="results" className="mt-4">
          <ResultsTab data={data} ratQs={ratQs} appQs={appQs} />
        </TabsContent>
        <TabsContent value="appeals" className="mt-4">
          <AppealsTab data={data} manage={manage} />
        </TabsContent>
      </Tabs>

      {/* Bouton phase suivante */}
      {next && (
        <div className="sticky bottom-4 z-30 rounded-2xl border border-emerald-200 bg-white/95 p-3 shadow-lg backdrop-blur">
          <Button
            className="h-12 w-full bg-emerald-600 text-base hover:bg-emerald-700"
            onClick={() => confirmPhase(next)}
            disabled={status === 'lobby' && ratQs.length === 0}
          >
            {NEXT_LABEL[status]}
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
          {status === 'lobby' && ratQs.length === 0 && (
            <p className="mt-2 text-center text-xs text-stone-500">
              Ajoutez d&apos;abord des questions dans l&apos;onglet « Questions ».
            </p>
          )}
        </div>
      )}

      {/* Confirmation de changement de phase */}
      <AlertDialog open={pendingPhase !== null} onOpenChange={(o) => !o && setPendingPhase(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Passer à « {pendingPhase ? PHASE_INFO[pendingPhase].label : ''} » ?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>{pendingPhase ? PHASE_INFO[pendingPhase].teacherHint : ''}</p>
                {pendingPhase && PHASE_WARNING[pendingPhase] && (
                  <p className="font-medium text-amber-700">{PHASE_WARNING[pendingPhase]}</p>
                )}
                {pendingPhase && PHASE_ORDER.indexOf(pendingPhase) < PHASE_ORDER.indexOf(status) && (
                  <p className="font-medium text-red-700">
                    Attention : vous revenez à une phase déjà terminée. Les étudiants pourront
                    répondre à nouveau (les réponses déjà enregistrées sont conservées).
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={async () => {
                if (pendingPhase) await manage('set_phase', { phase: pendingPhase })
                setPendingPhase(null)
              }}
            >
              Confirmer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

const NEXT_LABEL: Record<Phase, string | null> = {
  lobby: 'Lancer le test individuel (iRAT)',
  irat: 'Terminer l\u2019iRAT → lancer le test en équipe (tRAT)',
  trat: 'Terminer le tRAT → ouvrir les réclamations',
  appeal: 'Clôturer les réclamations → passer au feedback',
  feedback: 'Lancer les exercices d\u2019application',
  application: 'Passer à l\u2019évaluation par les pairs',
  peer: 'Terminer la séance',
  finished: null,
}

const PHASE_WARNING: Partial<Record<Phase, string>> = {
  irat: 'Les étudiants ne pourront plus répondre à l\u2019iRAT une fois la phase passée. Vérifiez que tout le monde a terminé.',
  trat: 'Une fois le tRAT terminé, les équipes ne pourront plus répondre. Vérifiez que toutes les équipes ont fini.',
  appeal: 'Les équipes ne pourront plus soumettre de réclamations. Examinez les réclamations en attente avant de continuer.',
  application: 'Pensez à révéler les réponses avant de quitter cette phase, sinon les étudiants ne les verront jamais.',
  peer: 'Vérifiez que tous les étudiants ont soumis leur évaluation avant de terminer.',
}

// ---------------- Fil des phases ----------------

function PhaseStepper({ current, onSelect }: { current: Phase; onSelect: (p: Phase) => void }) {
  const currentIdx = PHASE_ORDER.indexOf(current)
  return (
    <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white p-2">
      <div className="flex min-w-max items-center gap-1.5">
        {PHASE_ORDER.map((p, i) => {
          const isCurrent = p === current
          const isPast = i < currentIdx
          return (
            <button
              key={p}
              onClick={() => onSelect(p)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                isCurrent
                  ? 'border-emerald-600 bg-emerald-600 text-white shadow'
                  : isPast
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    : 'border-stone-200 bg-white text-stone-500 hover:bg-stone-50'
              )}
              title={PHASE_INFO[p].label}
            >
              <span
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
                  isCurrent
                    ? 'bg-white/25'
                    : isPast
                      ? 'bg-emerald-600 text-white'
                      : 'bg-stone-100 text-stone-500'
                )}
              >
                {isPast ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              {PHASE_INFO[p].short}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------------- Panneau « Déroulé » selon la phase ----------------

function OverviewPanel({
  data,
  ratQs,
  appQs,
  manage,
  onPhase,
}: {
  data: DashboardDTO
  ratQs: DashboardDTO['questions']
  appQs: DashboardDTO['questions']
  manage: (action: string, extra?: Record<string, unknown>) => Promise<boolean>
  onPhase: (p: Phase) => void
}) {
  const status = data.session.status
  const teamById = new Map(data.teams.map((t) => [t.id, t.name]))
  const studentById = new Map(data.students.map((s) => [s.id, s.name]))

  // ----- lobby -----
  if (status === 'lobby') {
    const unassigned = data.students.filter((s) => !s.teamId)
    return (
      <div className="space-y-4">
        <InfoCard tone="emerald" title="Étape en cours : inscription">
          {PHASE_INFO.lobby.teacherHint} Demandez-leur de choisir leur équipe à l&apos;inscription,
          ou placez-les vous-même dans l&apos;onglet « Équipes ».
        </InfoCard>
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <p className="mb-3 text-sm font-bold text-stone-800">
            Étudiants inscrits ({data.students.length})
          </p>
          {data.students.length === 0 ? (
            <p className="text-sm text-stone-500">
              Aucun étudiant pour le moment. Affichez le code au tableau et attendez…
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {data.students.map((s) => (
                <span
                  key={s.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-sm"
                >
                  <span className="font-medium text-stone-800">{s.name}</span>
                  <span className="text-xs text-stone-500">
                    {s.teamId ? teamById.get(s.teamId) : 'sans équipe'}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
        {unassigned.length > 0 && (
          <Button
            variant="outline"
            className="h-11 border-amber-400 text-amber-800 hover:bg-amber-50"
            onClick={() => manage('auto_assign')}
          >
            <Wand2 className="mr-2 h-4 w-4" />
            Répartir automatiquement les {unassigned.length} étudiant(s) sans équipe
          </Button>
        )}
      </div>
    )
  }

  // ----- irat -----
  if (status === 'irat') {
    const answeredCount = (studentId: string) =>
      data.iratAnswers.filter((a) => a.studentId === studentId).length
    const finished = data.students.filter((s) => answeredCount(s.id) === ratQs.length).length
    return (
      <div className="space-y-4">
        <InfoCard tone="amber" title="Étape en cours : test individuel (iRAT)">
          {PHASE_INFO.irat.teacherHint}
        </InfoCard>
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-bold text-stone-800">
              Progression : {finished}/{data.students.length} étudiant(s) ont terminé
            </p>
            <IratMinutesEditor data={data} manage={manage} />
          </div>
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {data.students.map((s) => {
              const n = answeredCount(s.id)
              const done = n === ratQs.length
              return (
                <div
                  key={s.id}
                  className="flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2 text-sm"
                >
                  <span className="text-stone-800">{s.name}</span>
                  <span
                    className={cn(
                      'font-semibold',
                      done ? 'text-emerald-600' : 'text-stone-500'
                    )}
                  >
                    {done ? (
                      <span className="inline-flex items-center gap-1">
                        <Check className="h-4 w-4" /> terminé
                      </span>
                    ) : (
                      `${n}/${ratQs.length} question(s)`
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <p className="mb-3 text-sm font-bold text-stone-800">
            Répartition des réponses en direct
          </p>
          <div className="space-y-3">
            {ratQs.map((q, qi) => {
              const answers = data.iratAnswers.filter((a) => a.questionId === q.id)
              const counts = q.choices.map(
                (_, ci) => answers.filter((a) => a.choice === ci).length
              )
              return (
                <div key={q.id} className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                  <p className="mb-2 line-clamp-2 text-sm font-medium text-stone-700">
                    Q{qi + 1}. {q.text}
                  </p>
                  <div className="space-y-1">
                    {q.choices.map((c, ci) => (
                      <div key={ci} className="flex items-center gap-2 text-xs">
                        <span className="w-4 shrink-0 font-bold text-stone-500">
                          {choiceLetter(ci)}
                        </span>
                        <div className="h-5 flex-1 overflow-hidden rounded bg-white">
                          <div
                            className={cn(
                              'flex h-full items-center justify-end rounded px-1.5 text-[10px] font-bold text-white',
                              ci === q.correct ? 'bg-emerald-600' : 'bg-stone-400'
                            )}
                            style={{
                              width: `${answers.length > 0 ? (counts[ci] / answers.length) * 100 : 0}%`,
                              minWidth: counts[ci] > 0 ? '1.75rem' : 0,
                            }}
                          >
                            {counts[ci] > 0 ? counts[ci] : ''}
                          </div>
                        </div>
                      </div>
                    ))}
                    <p className="pt-0.5 text-right text-[11px] text-stone-500">
                      {answers.length}/{data.students.length} ont répondu · bonne réponse :{' '}
                      <strong>{choiceLetter(q.correct ?? 0)}</strong>
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // ----- trat -----
  if (status === 'trat') {
    return (
      <div className="space-y-4">
        <InfoCard tone="emerald" title="Étape en cours : test en équipe (tRAT)">
          {PHASE_INFO.trat.teacherHint} Un seul téléphone par équipe suffit (celui du « scribe »).
        </InfoCard>
        <div className="grid gap-3 sm:grid-cols-2">
          {data.teams.map((t) => {
            const members = data.students.filter((s) => s.teamId === t.id)
            const tAnswers = data.tratAnswers.filter((a) => a.teamId === t.id)
            const solved = new Set(tAnswers.filter((a) => a.isCorrect).map((a) => a.questionId))
              .size
            const exhausted = ratQs.filter(
              (q) =>
                tAnswers.filter((a) => a.questionId === q.id).length >= 4 &&
                !tAnswers.some((a) => a.questionId === q.id && a.isCorrect)
            ).length
            const score = tAnswers.reduce((sum, a) => sum + a.score, 0)
            const done = solved + exhausted >= ratQs.length && ratQs.length > 0
            return (
              <div key={t.id} className="rounded-2xl border border-stone-200 bg-white p-4">
                <div className="mb-1 flex items-center justify-between">
                  <p className="font-bold text-stone-900">{t.name}</p>
                  {done ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                      <Check className="h-3 w-3" /> terminé
                    </span>
                  ) : (
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-600">
                      en cours
                    </span>
                  )}
                </div>
                <p className="mb-2 text-xs text-stone-500">
                  {members.length} membre(s) · {members.map((m) => m.name).join(', ') || '—'}
                </p>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-stone-600">
                    {solved + exhausted}/{ratQs.length} question(s) traitée(s)
                  </span>
                  <span className="font-bold text-emerald-700">{score} pts</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{
                      width: `${ratQs.length > 0 ? ((solved + exhausted) / ratQs.length) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ----- appeal -----
  if (status === 'appeal') {
    const pending = data.appeals.filter((a) => a.status === 'pending')
    return (
      <div className="space-y-4">
        <InfoCard tone="amber" title="Étape en cours : réclamations">
          {PHASE_INFO.appeal.teacherHint} Donnez 5 à 10 minutes aux équipes.
        </InfoCard>
        <AppealsTab data={data} manage={manage} />
        {pending.length === 0 && (
          <p className="text-center text-sm text-stone-500">
            Aucune réclamation pour l&apos;instant. Les équipes peuvent encore en soumettre
            depuis leur téléphone.
          </p>
        )}
      </div>
    )
  }

  // ----- feedback -----
  if (status === 'feedback') {
    return (
      <div className="space-y-4">
        <InfoCard tone="emerald" title="Étape en cours : votre feedback">
          {PHASE_INFO.feedback.teacherHint} Le tableau ci-dessous vous montre les questions les
          moins bien comprises (en rouge) — c&apos;est là que votre mini-cours sera le plus utile.
        </InfoCard>
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <div className="space-y-3">
            {ratQs.map((q, qi) => {
              const answers = data.iratAnswers.filter((a) => a.questionId === q.id)
              const correct = answers.filter((a) => a.isCorrect).length
              const pct = answers.length > 0 ? Math.round((correct / answers.length) * 100) : 0
              const teamsFound = new Set(
                data.tratAnswers
                  .filter((a) => a.questionId === q.id && a.isCorrect)
                  .map((a) => a.teamId)
              ).size
              const teamsAnswering = new Set(
                data.tratAnswers.filter((a) => a.questionId === q.id).map((a) => a.teamId)
              ).size
              return (
                <div key={q.id} className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                  <p className="mb-2 line-clamp-2 text-sm font-medium text-stone-700">
                    Q{qi + 1}. {q.text}
                  </p>
                  <div className="flex items-center gap-3">
                    <div className="h-3 flex-1 overflow-hidden rounded-full bg-white">
                      <div
                        className={cn(
                          'h-full rounded-full',
                          pct < 50 ? 'bg-red-400' : pct < 75 ? 'bg-amber-400' : 'bg-emerald-500'
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span
                      className={cn(
                        'w-12 text-right text-sm font-bold',
                        pct < 50 ? 'text-red-500' : pct < 75 ? 'text-amber-600' : 'text-emerald-600'
                      )}
                    >
                      {pct}%
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-stone-500">
                    iRAT : {correct}/{answers.length} bonnes réponses · tRAT : {teamsFound}/
                    {Math.max(teamsAnswering, data.teams.filter((t) => data.students.some((s) => s.teamId === t.id)).length)}{' '}
                    équipes ont trouvé la bonne réponse
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // ----- application -----
  if (status === 'application') {
    const activeTeams = data.teams.filter((t) => data.students.some((s) => s.teamId === t.id))
    return (
      <div className="space-y-4">
        <InfoCard tone="emerald" title="Étape en cours : exercices d'application">
          {PHASE_INFO.application.teacherHint} Les équipes soumettent leur choix depuis un seul
          téléphone, avec une justification écrite.
        </InfoCard>
        {appQs.map((q, qi) => {
          const answered = data.appAnswers.filter((a) => a.questionId === q.id)
          const answeredTeams = new Set(answered.map((a) => a.teamId)).size
          return (
            <div key={q.id} className="rounded-2xl border border-stone-200 bg-white p-4">
              <p className="mb-2 line-clamp-2 text-sm font-medium text-stone-700">
                Exercice {qi + 1}. {q.text}
              </p>
              <p className="text-sm text-stone-600">
                <strong>
                  {answeredTeams}/{activeTeams.length}
                </strong>{' '}
                équipe(s) ont répondu
              </p>
            </div>
          )
        })}
        <div className="rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-bold text-amber-900">
            Révélation simultanée : {data.session.revealed ? 'activée' : 'désactivée'}
          </p>
          <p className="mb-3 mt-1 text-sm text-amber-800">
            {data.session.revealed
              ? 'Les étudiants voient les réponses de toutes les équipes. C\'est le moment d\'animer le débat !'
              : 'Attendez que toutes les équipes aient répondu, puis révélez pour lancer le débat.'}
          </p>
          <Button
            className={cn(
              'h-11 w-full text-white',
              data.session.revealed ? 'bg-stone-700 hover:bg-stone-800' : 'bg-amber-600 hover:bg-amber-700'
            )}
            onClick={() => manage('toggle_reveal', { revealed: !data.session.revealed })}
          >
            {data.session.revealed ? (
              <>
                <EyeOff className="mr-2 h-4 w-4" /> Masquer les réponses
              </>
            ) : (
              <>
                <Eye className="mr-2 h-4 w-4" /> Révéler les réponses de toutes les équipes
              </>
            )}
          </Button>
        </div>
        {data.session.revealed && (
          <div className="grid gap-3 sm:grid-cols-2">
            {appQs.map((q, qi) => (
              <div key={q.id} className="rounded-2xl border border-stone-200 bg-white p-4">
                <p className="mb-2 line-clamp-1 text-sm font-bold text-stone-800">
                  Exercice {qi + 1}
                </p>
                <div className="space-y-1.5">
                  {activeTeams.map((t) => {
                    const ans = data.appAnswers.find(
                      (a) => a.questionId === q.id && a.teamId === t.id
                    )
                    return (
                      <div
                        key={t.id}
                        className="flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2 text-sm"
                      >
                        <span className="text-stone-700">{t.name}</span>
                        <span
                          className={cn(
                            'font-bold',
                            ans
                              ? ans.choice === q.correct
                                ? 'text-emerald-600'
                                : 'text-stone-800'
                              : 'text-stone-400'
                          )}
                        >
                          {ans ? choiceLetter(ans.choice) : '—'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ----- peer -----
  if (status === 'peer') {
    const evaluators = new Set(data.peerEvals.map((e) => e.evaluatorId)).size
    const eligible = data.students.filter((s) => s.teamId).length
    return (
      <div className="space-y-4">
        <InfoCard tone="emerald" title="Étape en cours : évaluation par les pairs">
          {PHASE_INFO.peer.teacherHint} Chaque étudiant ne voit que ses coéquipiers. Prévoyez 3 à
          5 minutes.
        </InfoCard>
        <div className="rounded-2xl border border-stone-200 bg-white p-6 text-center">
          <p className="text-3xl font-bold text-stone-900">
            {evaluators}
            <span className="text-lg text-stone-400"> / {eligible}</span>
          </p>
          <p className="mt-1 text-sm text-stone-600">étudiants ont soumis leur évaluation</p>
          <div className="mx-auto mt-4 h-2 max-w-sm overflow-hidden rounded-full bg-stone-100">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${eligible > 0 ? (evaluators / eligible) * 100 : 0}%` }}
            />
          </div>
        </div>
      </div>
    )
  }

  // ----- finished -----
  const avgIrat =
    data.students.length > 0
      ? (
          data.iratAnswers.reduce((s, a) => s + a.score, 0) / data.students.length
        ).toFixed(1)
      : '—'
  return (
    <div className="space-y-4">
      <InfoCard tone="emerald" title="Séance terminée">
        Bravo ! Les étudiants consultent leurs résultats sur leur téléphone. Vous pouvez exporter
        l&apos;ensemble des notes ci-dessous.
      </InfoCard>
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-stone-200 bg-white p-4 text-center">
          <p className="text-2xl font-bold text-stone-900">{data.students.length}</p>
          <p className="text-xs text-stone-500">étudiants</p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-4 text-center">
          <p className="text-2xl font-bold text-stone-900">{avgIrat}</p>
          <p className="text-xs text-stone-500">moyenne iRAT (/{ratQs.length})</p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-4 text-center">
          <p className="text-2xl font-bold text-stone-900">{data.appeals.length}</p>
          <p className="text-xs text-stone-500">réclamation(s)</p>
        </div>
      </div>
      <Button
        variant="outline"
        className="h-12 w-full border-emerald-300 text-emerald-700 hover:bg-emerald-50"
        onClick={() => exportCsv(data, ratQs, appQs)}
      >
        <Download className="mr-2 h-4 w-4" />
        Exporter tous les résultats (CSV pour Excel)
      </Button>
      <p className="text-xs text-stone-500">
        Astuce : pour refaire une séance similaire, créez une nouvelle séance et reprenez vos
        questions.
      </p>
    </div>
  )
}

function IratMinutesEditor({
  data,
  manage,
}: {
  data: DashboardDTO
  manage: (action: string, extra?: Record<string, unknown>) => Promise<boolean>
}) {
  const [minutes, setMinutes] = useState(String(data.session.iratMinutes))
  const [saving, setSaving] = useState(false)
  return (
    <span className="flex items-center gap-1.5 text-xs text-stone-500">
      Durée :
      <Input
        type="number"
        min={1}
        max={90}
        value={minutes}
        onChange={(e) => setMinutes(e.target.value)}
        className="h-8 w-16 border-stone-300 text-center text-sm"
      />
      min
      <Button
        size="sm"
        variant="outline"
        className="h-8 border-stone-300 px-2 text-xs"
        disabled={saving || Number(minutes) === data.session.iratMinutes}
        onClick={async () => {
          setSaving(true)
          await manage('set_irat_minutes', { minutes: Number(minutes) })
          setSaving(false)
        }}
      >
        OK
      </Button>
    </span>
  )
}
