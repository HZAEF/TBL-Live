'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
  Lock,
  LogOut,
  Play,
  RefreshCw,
  CopyPlus,
  Dices,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { api, refreshTeacherSessionMeta, removeTeacherSession, usePoll } from '@/lib/tbl-client'
import { noteServerNow } from '@/lib/server-clock'
import { loadAppConfig } from '@/lib/app-config'
import {
  PHASE_INFO,
  PHASE_ORDER,
  nextPhase,
  computeRevealedAppQuestionIds,
  suggestPin,
  type DashboardDTO,
  type JournalEntryDTO,
  type Phase,
} from '@/lib/tbl-types'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { useI18n, formatDate } from '@/lib/i18n'
import { Countdown, ElapsedSince, InfoCard, PhaseBadge, choiceLetter } from './shared'
import {
  TeamsTab,
  QuestionsTab,
  ResultsTab,
  AppealsTab,
  SignalementsTab,
  QuestionnaireTab,
  ConfigurationsTab,
  readSyncConfig,
  exportXlsx,
} from './teacher-tabs'
import { StatsTab } from './stats-tab'
import { downloadBlob } from '@/lib/xlsx-writer'

// v2.8.2 — Synchronisation d'arrière-plan Internet ↔ réseau local.
// Partagée par le cycle automatique (toutes les 5 secondes) ET par le
// déclenchement immédiat qui suit CHAQUE action de l'enseignant
// (changement de phase, lancement d'un cas, feedback…) : les étudiants
// connectés à l'autre version voient la page tourner sans attendre le
// prochain cycle. Un seul cycle à la fois par séance — jamais de
// chevauchement (un cycle = tirage + fusion + envoi du miroir complet,
// quelques centaines de millisecondes sur une séance ordinaire).
// Silencieuse : une coupure réseau n'affiche rien, la séance continue.
const syncInFlight = new Set<string>()
function backgroundSync(code: string, token: string) {
  const cfg = readSyncConfig(code)
  if (!cfg?.auto || !cfg.url) return
  if (syncInFlight.has(code)) return
  syncInFlight.add(code)
  api(`/api/sessions/${code}/manage`, {
    method: 'POST',
    body: JSON.stringify({ token, action: 'sync_now', remoteUrl: cfg.url }),
  })
    .catch(() => undefined)
    .finally(() => {
      syncInFlight.delete(code)
    })
}

export function TeacherDashboard({
  code,
  token,
  onExit,
  onAuthError,
  onOpenSession,
}: {
  code: string
  token: string
  onExit: () => void
  onAuthError: () => void
  onOpenSession: (code: string, token: string, title: string) => void
}) {
  // v2.9.0 — Sondage allégé : ?rev=N → réponse minuscule si rien n'a
  // changé (l'ancien objet est renvoyé → aucun re-rendu). Au moindre
  // changement (réponse, signalement, phase…), l'état complet arrive.
  const lastStateRef = useRef<DashboardDTO | null>(null)
  const { data, error, loading, refresh } = usePoll<DashboardDTO>(
    // v2.4.0 : jeton dans l'en-tête Authorization (plus jamais dans l'URL
    // des appels API → n'apparaît pas dans les journaux serveur).
    async () => {
      const rev = lastStateRef.current?.revision
      const url = rev === undefined ? `/api/sessions/${code}/dashboard` : `/api/sessions/${code}/dashboard?rev=${rev}`
      const d = await api<DashboardDTO | { unchanged: true; revision: number; serverNow?: string }>(
        url,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      )
      // v2.9.0 : heure serveur → minuteur iRAT synchronisé avec celui des
      // étudiants, même si l'horloge de cet ordinateur est décalée.
      noteServerNow(d.serverNow)
      if ((d as { unchanged?: boolean }).unchanged === true) {
        return lastStateRef.current as DashboardDTO
      }
      lastStateRef.current = d as DashboardDTO
      return d as DashboardDTO
    },
    2500
  )
  const { toast } = useToast()
  const [pendingPhase, setPendingPhase] = useState<Phase | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  // Cycle de vie : corbeille, suppression définitive, duplication
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmForever, setConfirmForever] = useState(false)
  const [confirmDuplicate, setConfirmDuplicate] = useState(false)
  // v3.3.0 — redémarrage de la séance (fenêtre d'avertissement puis
  // effacement des réponses / retour de tous les étudiants à l'accueil).
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [dupPin, setDupPin] = useState('')
  const [duplicating, setDuplicating] = useState(false)
  // v2.4.0 : sauvegarde complète (JSON) — copie hors-ligne de toutes les
  // données de la séance. v2.8.1 : le bouton revient dans l'en-tête du
  // tableau de bord, à son ancienne place à côté de « Dupliquer »
  // (demande de l'enseignante) ; le téléversement d'une sauvegarde vit
  // désormais dans l'écran d'accueil enseignant.
  const [backingUp, setBackingUp] = useState(false)
  const { t } = useI18n()

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
      // v2.8.2 : l'action part immédiatement vers la version en ligne
      // (si la synchronisation automatique est activée) — les étudiants
      // de l'autre version n'attendent pas le prochain cycle de 5 s.
      backgroundSync(code, token)
      await refresh()
      return true
    } catch (e) {
      toast({
        title: t('Action impossible'),
        description: e instanceof Error ? e.message : t('Erreur inconnue.'),
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
      toast({ title: t('Copie impossible'), description: t('Copiez le code manuellement.') })
    }
  }

  // Duplication : crée la copie puis bascule directement dessus
  const doDuplicate = async (pin: string) => {
    setDuplicating(true)
    try {
      const res = await api<{ code: string; teacherToken: string; title: string; pin: string }>(
        `/api/sessions/${code}/manage`,
        {
          method: 'POST',
          body: JSON.stringify({ token, action: 'duplicate_session', pin }),
        }
      )
      toast({
        title: t('Séance dupliquée !'),
        description: t('Nouveau code : {code} — notez aussi votre PIN.', { code: res.code }),
      })
      onOpenSession(res.code, res.teacherToken, res.title)
    } catch (e) {
      toast({
        title: t('Duplication impossible'),
        description: e instanceof Error ? e.message : t('Erreur inconnue.'),
        variant: 'destructive',
      })
    } finally {
      setDuplicating(false)
    }
  }

  // Sauvegarde complète (v2.8.1) : de retour dans l'en-tête du tableau de
  // bord, à côté de « Dupliquer ». Le fichier .json produit se téléverse
  // depuis l'écran d'accueil enseignant (« Téléverser une séance ») pour
  // restaurer ou transférer la séance sur un autre appareil.
  const doBackup = async () => {
    setBackingUp(true)
    try {
      const res = await api<Record<string, unknown>>(`/api/sessions/${code}/manage`, {
        method: 'POST',
        body: JSON.stringify({ token, action: 'export_backup' }),
      })
      const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' })
      downloadBlob(blob, `sauvegarde-tbl-${code}.json`)
      toast({ title: t('Fichier de sauvegarde téléchargé.') })
    } catch (e) {
      toast({
        title: t('Action impossible'),
        description: e instanceof Error ? e.message : t('Erreur inconnue.'),
        variant: 'destructive',
      })
    } finally {
      setBackingUp(false)
    }
  }

  const ratQs = useMemo(() => data?.questions.filter((q) => q.phase === 'rat') ?? [], [data])
  const appQs = useMemo(() => data?.questions.filter((q) => q.phase === 'application') ?? [], [data])

  // v2.8.2 : « Mes séances sur cet appareil » suit les renommages —
  // le titre mémorisé à la création restait affiché après un changement
  // de titre dans l'onglet Configurations (bug signalé par
  // l'enseignante). Chaque rafraîchissement du tableau de bord met à
  // jour le titre mémorisé (le jeton et la date de sauvegarde ne
  // bougent pas, l'ordre de la liste reste stable).
  useEffect(() => {
    const title = data?.session.title
    if (title) refreshTeacherSessionMeta(code, title)
  }, [code, data?.session.title])

  // v2.7.0 — Synchronisation automatique Internet ↔ réseau local.
  // v2.8.2 : QUASI IMMÉDIATE — toutes les 5 secondes (au lieu de 30)
  // + immédiatement après chaque action de l'enseignant (voir manage
  // ci-dessous). v2.9.0 : le délai du cycle est réglable dans
  // l'ESPACE ADMINISTRATEUR (/admin) — 2 s (très réactif) à 60 s
  // (économe) ; le push n'envoie le miroir que si quelque chose a
  // réellement changé (voir sync.ts). Silencieuse : une coupure réseau
  // n'affiche rien, la séance continue. NB : déclaré AVANT les retours
  // anticipés (règle des hooks React).
  const [syncIntervalMs, setSyncIntervalMs] = useState(5000)
  useEffect(() => {
    loadAppConfig().then((c) => setSyncIntervalMs(c.syncIntervalMs))
  }, [])
  useEffect(() => {
    if (!data?.session.code || data.session.deletedAt) return
    const sessionCode = data.session.code
    const id = setInterval(() => {
      if (document.hidden) return
      backgroundSync(sessionCode, token)
    }, syncIntervalMs)
    return () => clearInterval(id)
  }, [data?.session.code, data?.session.deletedAt, token, syncIntervalMs])

  if (loading && !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600" />
      </div>
    )
  }
  // Séance supprimée définitivement (corbeille vidée) ou code erroné :
  // l'API répond 404. Les données affichées précédemment sont périmées.
  if (error?.status === 404) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-16 text-center">
        <p className="font-semibold text-stone-900">
          {data ? t('Séance supprimée définitivement') : t('Séance introuvable')}
        </p>
        <p className="text-sm text-stone-600">
          {data
            ? t('Toutes les données de cette séance ont été effacées.')
            : t('Vérifiez le code de la séance, ou reconnectez-vous avec votre PIN.')}
        </p>
        <Button variant="outline" onClick={onExit} className="border-stone-300">
          {t('Retour')}
        </Button>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-16 text-center">
        <p className="font-semibold text-stone-800">{t('Séance introuvable')}</p>
        <Button variant="outline" onClick={onExit} className="border-stone-300">
          {t('Retour')}
        </Button>
      </div>
    )
  }

  const status = data.session.status
  const next = nextPhase(status)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
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
              {t('En direct · actualisation automatique')}
              <button
                onClick={() => refresh()}
                className="ml-1 rounded p-1 hover:bg-stone-100"
                aria-label={t('Actualiser maintenant')}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="border-stone-300"
              onClick={doBackup}
              disabled={backingUp}
              title={t('Télécharger une copie complète de la séance (fichier JSON)')}
            >
              <Download className="mr-1 h-4 w-4" />
              {t('Sauvegarder')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-stone-300"
              onClick={() => {
                setDupPin(suggestPin())
                setConfirmDuplicate(true)
              }}
            >
              <CopyPlus className="mr-1 h-4 w-4" />
              {t('Dupliquer')}
            </Button>
            {/* v3.3.0 — REDÉMARRAGE DE LA SÉANCE : efface toutes les
                réponses enregistrées, ramène tous les étudiants à
                l'écran d'accueil (ils attendent le lancement du iRAT).
                Fenêtre d'avertissement obligatoire — action devenue
                courante pour rejouer une séance avec une autre classe. */}
            <Button
              variant="outline"
              size="sm"
              className="border-stone-300"
              onClick={() => setConfirmRestart(true)}
              disabled={!!data.session.deletedAt || restarting}
              title={t(
                'Effacer toutes les réponses enregistrées et ramener les étudiants à l’accueil'
              )}
            >
              <RotateCcw className="mr-1 h-4 w-4" />
              {t('Redémarrer')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-stone-400 hover:bg-red-50 hover:text-red-600"
              onClick={() => setConfirmDelete(true)}
              disabled={!!data.session.deletedAt}
              title={
                data.session.deletedAt
                  ? t('Séance déjà dans la corbeille')
                  : t('Supprimer cette séance')
              }
            >
              <Trash2 className="mr-1 h-4 w-4" />
              {t('Supprimer')}
            </Button>
            <Button variant="outline" size="sm" onClick={onExit} className="border-stone-300">
              <LogOut className="mr-1 h-4 w-4" />
              {t('Quitter')}
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50 p-3 text-center sm:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
              {t('Code à donner aux étudiants')}
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
                {t('Copier le code')}
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
                {t('Copier le lien + code')}
              </Button>
            </div>
          </div>
          <div className="flex flex-col justify-center gap-1 rounded-xl bg-stone-100 p-3 text-sm">
            <p className="flex items-center gap-2 text-stone-700">
              <Users className="h-4 w-4 text-emerald-600" />
              <strong>{data.students.length}</strong> {t('étudiant(s) ·')}{' '}
              <strong>{data.teams.length}</strong> {t('équipe(s)')}
            </p>
            {/* v2.9.0 — DOUBLE minuteur, comme demandé : (1) chronomètre
                ASCENDANT de la phase en cours, toujours visible (durée
                depuis le lancement) ; (2) pendant l'iRAT UNIQUEMENT, le
                compte à rebours DESCENDANT synchronisé avec celui des
                étudiants — il atteint 00:00 puis affiche « Temps écoulé »
                (plus jamais un compteur qui remonte). */}
            <p className="flex items-center gap-2 text-stone-700">
              <Timer className="h-4 w-4 text-emerald-600" />
              {t('Phase en cours depuis :')}{' '}
              <ElapsedSince startedAt={data.session.phaseStartedAt} />
            </p>
            {status === 'irat' && (
              <p className="flex items-center gap-2 text-stone-700">
                <Timer className="h-4 w-4 text-amber-600" />
                {t('Temps restant (iRAT) :')}{' '}
                <Countdown
                  startedAt={data.session.phaseStartedAt}
                  minutes={data.session.iratMinutes}
                />
              </p>
            )}
            <p className="pl-6 text-xs text-stone-500">
              {t('Séance créée le {date} · rétention des données étudiantes : 4 mois', {
                date: formatDate(new Date(data.session.createdAt)),
              })}
            </p>
          </div>
        </div>
      </div>

      {/* Corbeille : bandeau de restauration (48 h) */}
      {data.session.deletedAt && (
        <TrashBanner
          deletedAt={data.session.deletedAt}
          onRestore={async () => {
            await manage('restore_session')
          }}
          onForever={() => setConfirmForever(true)}
        />
      )}

      {/* Purge automatique des données étudiantes (rétention 4 mois) */}
      {!data.session.deletedAt && data.session.dataPurgedAt && (
        <PurgeBanner purgedAt={data.session.dataPurgedAt} />
      )}

      {/* Fil des phases */}
      <PhaseStepper current={status} onSelect={confirmPhase} disabled={!!data.session.deletedAt} />

      {/* Onglets */}
      <Tabs defaultValue="overview">
        <TabsList className="h-auto w-full justify-start overflow-x-auto bg-stone-100 p-1">
          <TabsTrigger value="overview" className="flex-1 px-3 py-2 sm:flex-none">
            {t('Déroulé')}
          </TabsTrigger>
          <TabsTrigger value="teams" className="flex-1 px-3 py-2 sm:flex-none">
            {t('Équipes')}
          </TabsTrigger>
          <TabsTrigger value="questions" className="flex-1 px-3 py-2 sm:flex-none">
            {t('Questions')}
          </TabsTrigger>
          {/* v2.6.0 : rubrique « Questionnaire » — édition des items du
              questionnaire de fin de séance (TBL-SAI) et résultats, à part
              entière juste après « Questions ». */}
          <TabsTrigger value="questionnaire" className="flex-1 px-3 py-2 sm:flex-none">
            {t('Questionnaire')}
          </TabsTrigger>
          <TabsTrigger value="results" className="flex-1 px-3 py-2 sm:flex-none">
            {t('Résultats')}
          </TabsTrigger>
          <TabsTrigger value="stats" className="flex-1 px-3 py-2 sm:flex-none">
            {t('Statistiques')}
          </TabsTrigger>
          <TabsTrigger value="appeals" className="flex-1 px-3 py-2 sm:flex-none">
            {t('Réclamations')}
            {pendingAppeals > 0 && (
              <span className="ml-1.5 rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {pendingAppeals}
              </span>
            )}
          </TabsTrigger>
          {/* v2.5.1 : rubrique « Signalements » (alertes anti-capture
              divisées par épreuve, voir teacher-tabs.tsx).
              v3.0.0 : DÉSACTIVÉE par défaut — l'onglet n'apparaît que si
              l'administrateur a activé les signalements pour CE TBL
              (espace /admin → Gestion des séances). Quand ils sont
              désactivés, la requête des événements n'est même plus
              exécutée côté serveur : la séance reste légère. */}
          {data.session.reportsEnabled === true && (
            <TabsTrigger value="alerts" className="flex-1 px-3 py-2 sm:flex-none">
              {t('Signalements')}
              {(data.alerts?.length ?? 0) > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {data.alerts!.length}
                </span>
              )}
            </TabsTrigger>
          )}
          {/* v2.7.0 : rubrique « Configurations » — paramètres de la séance
              (titre, PIN, durée), sauvegarde/téléversement, exclusion d'un
              étudiant et synchronisation Internet ↔ réseau local. */}
          <TabsTrigger value="config" className="flex-1 px-3 py-2 sm:flex-none">
            {t('Configurations')}
          </TabsTrigger>
          {/* v3.3.0 : rubrique « Journal » — modifications des enseignants
              (propriétaire et invités) : qui a changé quoi, quand, depuis
              quelle instance. Colonne vertébrale de la collaboration
              entre co-enseignants d'une séance partagée. */}
          <TabsTrigger value="journal" className="flex-1 px-3 py-2 sm:flex-none">
            {t('Journal')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <OverviewPanel
            data={data}
            ratQs={ratQs}
            appQs={appQs}
            manage={manage}
          />
        </TabsContent>
        <TabsContent value="teams" className="mt-4">
          <TeamsTab data={data} manage={manage} />
        </TabsContent>
        <TabsContent value="questions" className="mt-4">
          <QuestionsTab data={data} manage={manage} />
        </TabsContent>
        <TabsContent value="questionnaire" className="mt-4">
          <QuestionnaireTab data={data} manage={manage} />
        </TabsContent>
        <TabsContent value="results" className="mt-4">
          <ResultsTab data={data} ratQs={ratQs} appQs={appQs} />
        </TabsContent>
        <TabsContent value="stats" className="mt-4">
          <StatsTab data={data} ratQs={ratQs} appQs={appQs} />
        </TabsContent>
        <TabsContent value="appeals" className="mt-4">
          <AppealsTab data={data} manage={manage} />
        </TabsContent>
        {data.session.reportsEnabled === true && (
          <TabsContent value="alerts" className="mt-4">
            <SignalementsTab data={data} />
          </TabsContent>
        )}
        {/* v2.7.0 : Configurations — tout ce qui n'est ni questions, ni
            questionnaire, ni équipes : paramètres, sauvegarde, transfert,
            exclusion d'étudiant, synchronisation. */}
        <TabsContent value="config" className="mt-4">
          <ConfigurationsTab data={data} manage={manage} token={token} refresh={refresh} />
        </TabsContent>
        {/* v3.3.0 : Journal — modifications des enseignants (lecture pure,
            rafraîchi par le sondage du tableau de bord). */}
        <TabsContent value="journal" className="mt-4">
          <JournalTab data={data} />
        </TabsContent>
      </Tabs>

      {/* Bouton phase suivante */}
      {next && !data.session.deletedAt && (
        <div className="sticky bottom-4 z-30 rounded-2xl border border-emerald-200 bg-white/95 p-3 shadow-lg backdrop-blur">
          <Button
            className="h-12 w-full bg-emerald-600 text-base hover:bg-emerald-700"
            onClick={() => confirmPhase(next)}
            disabled={status === 'lobby' && ratQs.length === 0}
          >
            {t(NEXT_LABEL[status] ?? '')}
            <ArrowRight className="ml-2 h-5 w-5 rtl:rotate-180" />
          </Button>
          {status === 'lobby' && ratQs.length === 0 && (
            <p className="mt-2 text-center text-xs text-stone-500">
              {t('Ajoutez d’abord des questions dans l’onglet « Questions ».')}
            </p>
          )}
        </div>
      )}

      {/* Confirmation de changement de phase */}
      <AlertDialog open={pendingPhase !== null} onOpenChange={(o) => !o && setPendingPhase(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('Passer à « {label} » ?', {
                label: pendingPhase ? t(PHASE_INFO[pendingPhase].label) : '',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>{pendingPhase ? t(PHASE_INFO[pendingPhase].teacherHint) : ''}</p>
                {/* Avertissement sur la phase que l'on QUITTE (et non celle où l'on va) */}
                {pendingPhase &&
                  PHASE_ORDER.indexOf(pendingPhase) > PHASE_ORDER.indexOf(status) &&
                  PHASE_WARNING[status] && (
                    <p className="font-medium text-amber-700">{t(PHASE_WARNING[status])}</p>
                  )}
                {pendingPhase && PHASE_ORDER.indexOf(pendingPhase) < PHASE_ORDER.indexOf(status) && (
                  <p className="font-medium text-red-700">
                    {t(
                      'Attention : vous revenez à une phase déjà terminée. Les étudiants pourront répondre à nouveau (les réponses déjà enregistrées sont conservées).'
                    )}
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Annuler')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={async () => {
                if (pendingPhase) {
                  // v3.1.0 — expectedPhase : la commande embarque la phase
                  // QUE LE TABLEAU DE BORD CONNAÎT : si la séance a avancé
                  // entre-temps (autre appareil, requête lente en file),
                  // le serveur REFUSE la commande périmée au lieu de
                  // l'appliquer — l'affichage se resynchronise tout seul.
                  await manage('set_phase', { phase: pendingPhase, expectedPhase: status })
                  // v2.7.0 : fin de séance → synchronisation FINALE avec la
                  // version en ligne (si une adresse est configurée) : tous
                  // les résultats partent sur Internet, sans action
                  // supplémentaire de l'enseignant.
                  if (pendingPhase === 'finished') {
                    const cfg = readSyncConfig(code)
                    if (cfg?.url) {
                      api(`/api/sessions/${code}/manage`, {
                        method: 'POST',
                        body: JSON.stringify({ token, action: 'sync_now', remoteUrl: cfg.url }),
                      })
                        .then(() => refresh())
                        .catch(() =>
                          toast({
                            title: t('Synchronisation finale impossible'),
                            description: t(
                              'La séance est terminée et sauvegardée ici. Relancez la synchronisation depuis l’onglet « Configurations » quand la connexion reviendra.'
                            ),
                          })
                        )
                    }
                  }
                }
                setPendingPhase(null)
              }}
            >
              {t('Confirmer')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* v3.3.0 — Confirmation : REDÉMARRAGE DE LA SÉANCE (demande de
          l'enseignante). Toutes les réponses sont effacées, les étudiants
          restent inscrits et retombent à l'accueil ; l'enseignant relance
          le iRAT quand il veut. */}
      <AlertDialog open={confirmRestart} onOpenChange={setConfirmRestart}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Redémarrer la séance ?')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p className="font-medium text-red-700">
                  {t(
                    'Toutes les réponses enregistrées seront EFFACÉES : iRAT, tRAT, cas cliniques d’application, réclamations, évaluations par les pairs et questionnaire de fin.'
                  )}
                </p>
                <p>
                  {t(
                    'Les étudiants inscrits et les équipes sont conservés : chacun se retrouve sur l’écran d’accueil, en attente du lancement du iRAT — personne n’a à rejoindre à nouveau.'
                  )}
                </p>
                <p>
                  {t(
                    'Les questions, cas cliniques, réglages et le partage de la séance sont conservés tels quels.'
                  )}
                </p>
                <p className="text-xs text-stone-500">
                  {t(
                    'Action idéale pour rejouer la même séance avec un nouveau groupe, ou repartir de zéro après un essai. Le redémarrage est consigné dans le Journal.'
                  )}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Annuler')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={restarting}
              onClick={async () => {
                setConfirmRestart(false)
                setRestarting(true)
                const ok = await manage('restart_session')
                setRestarting(false)
                if (ok) {
                  toast({
                    title: t('Séance redémarrée'),
                    description: t(
                      'Les réponses ont été effacées : tous les étudiants sont revenus à l’accueil.'
                    ),
                  })
                }
              }}
            >
              <RotateCcw className="mr-1.5 h-4 w-4" />
              {restarting ? t('Redémarrage…') : t('Redémarrer la séance')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmation : mise à la corbeille */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Supprimer cette séance ?')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {t('La séance « {title} » sera placée dans la corbeille : vos étudiants', {
                    title: data.session.title,
                  })}{' '}
                  <strong>{t('n’y auront plus accès immédiatement')}</strong>
                  {t(
                    ', et le déroulé de la séance sera figé.'
                  )}
                </p>
                <p>
                  {t('Par sécurité, vous pourrez la')} <strong>{t('restaurer pendant 48 heures')}</strong>{' '}
                  {t(
                    'avec le bouton « Restaurer » (vos données restent intactes pendant ce délai) — pratique en cas de suppression par erreur.'
                  )}
                </p>
                <p className="font-medium text-red-700">
                  {t(
                    'Passé ce délai, la séance et toutes ses données (questions, réponses, notes) seront supprimées définitivement.'
                  )}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Annuler')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={async () => {
                setConfirmDelete(false)
                await manage('delete_session')
              }}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              {t('Mettre à la corbeille')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmation : suppression DÉFINITIVE */}
      <AlertDialog open={confirmForever} onOpenChange={setConfirmForever}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Supprimer DÉFINITIVEMENT cette séance ?')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p className="font-medium text-red-700">
                  {t(
                    'Toutes les données seront effacées sans possibilité de récupération : questions, cas cliniques, équipes, réponses, notes. Cette action est irréversible.'
                  )}
                </p>
                <p>
                  {t(
                    'Si vous hésitez, préférez la corbeille : elle laisse 48 heures de réflexion avant la suppression automatique.'
                  )}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Annuler')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-700 hover:bg-red-800"
              onClick={async () => {
                setConfirmForever(false)
                const ok = await manage('delete_forever')
                if (ok) removeTeacherSession(code)
              }}
            >
              {t('Supprimer définitivement')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmation : duplication */}
      <AlertDialog open={confirmDuplicate} onOpenChange={setConfirmDuplicate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Dupliquer cette séance')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  {t(
                    'Une nouvelle séance sera créée avec les mêmes questions iRAT/tRAT, les mêmes cas cliniques ({cases}), le même nombre d’équipes ({teams}) et la même durée d’iRAT — mais',
                    { cases: data.cases.length, teams: data.teams.length }
                  )}{' '}
                  <strong>{t('sans les données des étudiants')}</strong>
                  {t(
                    ' (inscriptions, réponses, notes, réclamations, évaluations). Elle s’ouvrira à l’étape d’inscription, prête pour une nouvelle classe.'
                  )}
                </p>
                <div>
                  <Label htmlFor="dup-pin">{t('Code PIN de la nouvelle séance')}</Label>
                  <div className="mt-1.5 flex gap-2">
                    <Input
                      id="dup-pin"
                      value={dupPin}
                      onChange={(e) =>
                        setDupPin(
                          e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
                        )
                      }
                      autoCapitalize="characters"
                      placeholder="ex. 7KQ2MP"
                      className="h-11 font-mono tracking-widest"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 shrink-0 border-stone-300"
                      onClick={() => setDupPin(suggestPin())}
                      aria-label={t('Générer un code PIN robuste')}
                      title={t('Générer un code PIN robuste')}
                    >
                      <Dices className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="mt-1 text-xs text-stone-500">
                    {t(
                      '6 caractères et plus (chiffres + lettres). Notez-le : il sert à rouvrir cette nouvelle séance.'
                    )}
                  </p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Annuler')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={duplicating}
              onClick={(e) => {
                if (!/^[A-Z0-9]{6,12}$/.test(dupPin)) {
                  e.preventDefault()
                  toast({
                    title: t('PIN invalide'),
                    description: t(
                      'Le code PIN doit contenir 6 à 12 caractères, chiffres et lettres (sans accents ni symboles).'
                    ),
                    variant: 'destructive',
                  })
                  return
                }
                setConfirmDuplicate(false)
                void doDuplicate(dupPin)
              }}
            >
              {duplicating ? t('Création…') : t('Créer la copie')}
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
  feedback: 'Lancer les cas cliniques d\u2019application',
  application: 'Passer à l\u2019évaluation par les pairs',
  peer: 'Terminer la séance',
  finished: null,
}

// Avertissements affichés au moment de QUITTER une phase (ils décrivent
// ce que les étudiants ne pourront plus faire une fois la phase passée).
const PHASE_WARNING: Partial<Record<Phase, string>> = {
  irat: 'Les étudiants ne pourront plus répondre à l\u2019iRAT une fois la phase passée. Vérifiez que tout le monde a terminé.',
  trat: 'Une fois le tRAT terminé, les équipes ne pourront plus répondre. Vérifiez que toutes les équipes ont fini.',
  appeal: 'Les équipes ne pourront plus soumettre de réclamations (le passage au feedback est sinon automatique dès que toutes les équipes ont répondu).',
  application: 'Les équipes ne pourront plus répondre aux cas cliniques. Les questions déjà révélées restent visibles.',
  peer: 'Vérifiez que tous les étudiants ont soumis leur évaluation avant de terminer.',
}

// ---------------- Fil des phases ----------------

function PhaseStepper({
  current,
  onSelect,
  disabled = false,
}: {
  current: Phase
  onSelect: (p: Phase) => void
  disabled?: boolean
}) {
  const currentIdx = PHASE_ORDER.indexOf(current)
  const { t } = useI18n()
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
              disabled={disabled}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                disabled && 'cursor-not-allowed opacity-60',
                isCurrent
                  ? 'border-emerald-600 bg-emerald-600 text-white shadow'
                  : isPast
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                    : 'border-stone-200 bg-white text-stone-500 hover:bg-stone-50'
              )}
              title={t(PHASE_INFO[p].label)}
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
              {t(PHASE_INFO[p].short)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------------- Bandeaux corbeille / purge automatique ----------------

// Bandeau affiché lorsqu'une séance est dans la corbeille : les étudiants
// sont bloqués, l'enseignant peut encore restaurer (48 h) ou supprimer
// définitivement tout de suite. Le compte à rebours se met à jour à chaque
// rafraîchissement automatique (2,5 s).
function TrashBanner({
  deletedAt,
  onRestore,
  onForever,
}: {
  deletedAt: string
  onRestore: () => Promise<void>
  onForever: () => void
}) {
  const [restoring, setRestoring] = useState(false)
  const { t } = useI18n()
  const msLeft = new Date(deletedAt).getTime() + 48 * 3_600_000 - Date.now()
  const hoursLeft = Math.max(0, Math.floor(msLeft / 3_600_000))
  const minutesLeft = Math.max(0, Math.floor((msLeft % 3_600_000) / 60_000))
  const deadline = new Date(new Date(deletedAt).getTime() + 48 * 3_600_000)
  return (
    <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-700">
          <Trash2 className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-red-900">{t('Cette séance est dans la corbeille')}</p>
          <p className="mt-1 text-sm leading-relaxed text-red-800">
            {t(
              'Vos étudiants n’y ont plus accès et le déroulé est figé ; vous pouvez encore consulter les résultats et exporter le CSV. Suppression définitive automatique'
            )}{' '}
            <strong>
              {t('dans {h} h {m} min', { h: hoursLeft, m: minutesLeft })}
            </strong>{' '}
            {t('(le {date} à {time}).', {
              date: formatDate(deadline),
              time: formatDate(deadline, { hour: '2-digit', minute: '2-digit' }),
            })}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              className="h-10 bg-emerald-600 hover:bg-emerald-700"
              disabled={restoring}
              onClick={async () => {
                setRestoring(true)
                try {
                  await onRestore()
                } finally {
                  setRestoring(false)
                }
              }}
            >
              <RotateCcw className="mr-1.5 h-4 w-4" />
              {restoring ? t('Restauration…') : t('Restaurer la séance')}
            </Button>
            <Button
              variant="outline"
              className="h-10 border-red-300 bg-white text-red-700 hover:bg-red-100"
              onClick={onForever}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              {t('Supprimer définitivement')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Bandeau informatif : les données étudiantes ont été purgées
// automatiquement (rétention de 4 mois) ; QCM et cas cliniques conservés.
function PurgeBanner({ purgedAt }: { purgedAt: string }) {
  const { t } = useI18n()
  const d = new Date(purgedAt)
  return (
    <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
      <p className="text-sm font-bold text-amber-900">
        {t('Données étudiantes purgées automatiquement')}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-amber-800">
        {t(
          'Conformément à la rétention de 4 mois, les noms, les réponses, les réclamations et les évaluations ont été supprimées le {date}. Les questions et les cas cliniques sont conservés : utilisez le bouton « Dupliquer » (en haut) pour réutiliser cette séance avec une nouvelle classe.',
          { date: formatDate(d) }
        )}
      </p>
    </div>
  )
}

// ---------------- Panneau « Déroulé » selon la phase ----------------

function OverviewPanel({
  data,
  ratQs,
  appQs,
  manage,
}: {
  data: DashboardDTO
  ratQs: DashboardDTO['questions']
  appQs: DashboardDTO['questions']
  manage: (action: string, extra?: Record<string, unknown>) => Promise<boolean>
}) {
  const status = data.session.status
  const teamById = new Map(data.teams.map((t) => [t.id, t.name]))
  const { t } = useI18n()

  // ----- lobby -----
  if (status === 'lobby') {
    const unassigned = data.students.filter((s) => !s.teamId)
    return (
      <div className="space-y-4">
        <InfoCard tone="emerald" title={t('Étape en cours : inscription')}>
          {t(PHASE_INFO.lobby.teacherHint)}{' '}
          {t(
            'Demandez-leur de choisir leur équipe à l’inscription, ou placez-les vous-même dans l’onglet « Équipes ».'
          )}
        </InfoCard>
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <p className="mb-3 text-sm font-bold text-stone-800">
            {t('Étudiants inscrits ({n})', { n: data.students.length })}
          </p>
          {data.students.length === 0 ? (
            <p className="text-sm text-stone-500">
              {t('Aucun étudiant pour le moment. Affichez le code au tableau et attendez…')}
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
                    {s.teamId ? teamById.get(s.teamId) : t('sans équipe')}
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
            {t('Répartir automatiquement les {n} étudiant(s) sans équipe', {
              n: unassigned.length,
            })}
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
        <InfoCard tone="amber" title={t('Étape en cours : test individuel (iRAT)')}>
          {t(PHASE_INFO.irat.teacherHint)}
        </InfoCard>
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-bold text-stone-800">
              {t('Progression : {n}/{m} étudiant(s) ont terminé', {
                n: finished,
                m: data.students.length,
              })}
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
                        <Check className="h-4 w-4" /> {t('terminé')}
                      </span>
                    ) : (
                      t('{n}/{m} question(s)', { n, m: ratQs.length })
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <p className="mb-3 text-sm font-bold text-stone-800">
            {t('Répartition des réponses en direct')}
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
                    <p className="pt-0.5 text-end text-[11px] text-stone-500">
                      {t('{n}/{m} ont répondu · bonne réponse :', {
                        n: answers.length,
                        m: data.students.length,
                      })}{' '}
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
        <InfoCard tone="emerald" title={t('Étape en cours : test en équipe (tRAT)')}>
          {t(PHASE_INFO.trat.teacherHint)}{' '}
          {t('Un seul téléphone par équipe suffit (celui du « scribe »).')}
        </InfoCard>
        <div className="grid gap-3 sm:grid-cols-2">
          {data.teams.map((tm) => {
            const members = data.students.filter((s) => s.teamId === tm.id)
            const tAnswers = data.tratAnswers.filter((a) => a.teamId === tm.id)
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
              <div key={tm.id} className="rounded-2xl border border-stone-200 bg-white p-4">
                <div className="mb-1 flex items-center justify-between">
                  <p className="font-bold text-stone-900">{tm.name}</p>
                  {done ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                      <Check className="h-3 w-3" /> {t('terminé')}
                    </span>
                  ) : (
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-600">
                      {t('en cours')}
                    </span>
                  )}
                </div>
                <p className="mb-2 text-xs text-stone-500">
                  {t('{n} membre(s) · {names}', {
                    n: members.length,
                    names: members.map((m) => m.name).join(', ') || '—',
                  })}
                </p>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-stone-600">
                    {t('{n}/{m} question(s) traitée(s)', {
                      n: solved + exhausted,
                      m: ratQs.length,
                    })}
                  </span>
                  <span className="font-bold text-emerald-700">{t('{n} pts', { n: score })}</span>
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
    const activeTeams = data.teams.filter((t) => data.students.some((s) => s.teamId === t.id))
    const doneTeams = activeTeams.filter((t) => t.appealsDone)
    return (
      <div className="space-y-4">
        <InfoCard tone="amber" title={t('Étape en cours : réclamations')}>
          {t(PHASE_INFO.appeal.teacherHint)}
        </InfoCard>

        {/* Progression du bouton « pas de réclamation » */}
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-bold text-amber-900">
            {t('Équipes ayant répondu : {d}/{n}', {
              d: doneTeams.length,
              n: activeTeams.length,
            })}
          </p>
          <p className="mt-1 text-sm text-amber-800">
            {t(
              'Dès que toutes les équipes auront cliqué sur « Nous n’avons pas de réclamation » (ou confirmé la fin de leurs réclamations), la séance passera automatiquement au feedback. Vous pouvez aussi avancer manuellement à tout moment.'
            )}
          </p>
          <div className="mt-3 space-y-1.5">
            {activeTeams.map((tm) => {
              const appeals = data.appeals.filter((a) => a.teamId === tm.id)
              return (
                <div
                  key={tm.id}
                  className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm"
                >
                  <span className="text-stone-800">{tm.name}</span>
                  <span
                    className={cn(
                      'font-semibold',
                      tm.appealsDone ? 'text-emerald-600' : 'text-stone-400'
                    )}
                  >
                    {tm.appealsDone ? (
                      <span className="inline-flex items-center gap-1">
                        <Check className="h-4 w-4" />
                        {appeals.length > 0
                          ? t('terminé ({n} réclamation(s))', { n: appeals.length })
                          : t('aucune réclamation')}
                      </span>
                    ) : (
                      t('en attente…')
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        <AppealsTab data={data} manage={manage} />
        {pending.length === 0 && (
          <p className="text-center text-sm text-stone-500">
            {t(
              'Aucune réclamation pour l’instant. Les équipes peuvent encore en soumettre depuis leur téléphone.'
            )}
          </p>
        )}
      </div>
    )
  }

  // ----- feedback -----
  if (status === 'feedback') {
    return (
      <div className="space-y-4">
        <InfoCard tone="emerald" title={t('Étape en cours : votre feedback')}>
          {t(PHASE_INFO.feedback.teacherHint)}{' '}
          {t(
            'Le tableau ci-dessous vous montre les questions les moins bien comprises (en rouge) — c’est là que votre mini-cours sera le plus utile.'
          )}
        </InfoCard>

        {/* v2.7.0 : écran d'attente des étudiants — les résultats n'apparaissent
            sur leur téléphone QUE lorsque vous lancez le feedback (entre les
            réclamations et ce moment, ils voient une page neutre : rien à
            capturer, l'attention reste sur vous). */}
        <div
          className={cn(
            'rounded-2xl border-2 p-5',
            data.session.feedbackReady
              ? 'border-emerald-200 bg-emerald-50'
              : 'border-sky-300 bg-sky-50'
          )}
        >
          {data.session.feedbackReady ? (
            <p className="flex items-center gap-2 text-sm font-bold text-emerald-800">
              <Check className="h-5 w-5" />
              {t('Feedback lancé : les étudiants voient leurs résultats et les réponses correctes.')}
            </p>
          ) : (
            <>
              <p className="text-sm font-bold text-sky-900">{t('Les étudiants patientent')}</p>
              <p className="mt-1 text-sm leading-relaxed text-sky-800">
                {t(
                  'Leur téléphone affiche une page d’attente neutre : ni notes, ni réponses correctes, rien à capturer d’écran. Commentez les résultats avec la classe, puis lancez le feedback quand vous êtes prêt — tout apparaîtra d’un coup sur leur écran.'
                )}
              </p>
              <Button
                className="mt-3 h-12 w-full bg-sky-600 text-base hover:bg-sky-700"
                onClick={() => manage('launch_feedback')}
              >
                <Play className="mr-2 h-5 w-5" />
                {t('Lancer le feedback')}
              </Button>
            </>
          )}
        </div>

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
                    {t(
                      'iRAT : {n}/{m} bonnes réponses · tRAT : {a}/{b} équipes ont trouvé la bonne réponse',
                      {
                        n: correct,
                        m: answers.length,
                        a: teamsFound,
                        b: Math.max(
                          teamsAnswering,
                          data.teams.filter((t) => data.students.some((s) => s.teamId === t.id)).length
                        ),
                      }
                    )}
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
    const revealedIds = new Set(
      computeRevealedAppQuestionIds({
        appQuestionIds: appQs.map((q) => q.id),
        activeTeamIds: activeTeams.map((t) => t.id),
        appAnswers: data.appAnswers,
        forcedReveal: data.session.revealed,
      })
    )
    // Cas cliniques (+ groupe « libre » pour l'ancien format)
    const caseGroups = [
      ...data.cases.map((c) => ({
        key: c.id,
        title: c.title,
        opened: c.opened,
        questions: appQs.filter((q) => q.caseId === c.id),
      })),
      ...(appQs.some((q) => !q.caseId)
        ? [
            {
              key: 'libres',
              title: t('Exercices d’application (ancien format)'),
              opened: true,
              questions: appQs.filter((q) => !q.caseId),
            },
          ]
        : []),
    ].filter((g) => g.questions.length > 0)

    return (
      <div className="space-y-4">
        <InfoCard tone="emerald" title={t("Étape en cours : cas cliniques d'application")}>
          {t(PHASE_INFO.application.teacherHint)}
        </InfoCard>

        <p className="rounded-xl border border-lime-200 bg-lime-50 px-4 py-3 text-sm text-lime-900">
          {t(
            'Les réponses de chaque question sont révélées automatiquement dès que toutes les équipes y ont répondu ({n} équipe(s) active(s)). Vous pouvez aussi tout révéler immédiatement avec le bouton en bas de page.',
            { n: activeTeams.length }
          )}
        </p>

        {/* v2.7.0 : lancement des cas cliniques UN PAR UN. Chaque cas reste
            INVISIBLE des étudiants (page d'attente neutre : ni énoncé, ni
            questions) jusqu'à son lancement — expliquez le cas précédent à
            voix haute, puis ouvrez le suivant quand la classe est prête. */}
        {caseGroups.some((g) => g.key !== 'libres') && (
          <div className="rounded-2xl border-2 border-lime-300 bg-lime-50 p-4">
            <p className="text-sm font-bold text-lime-900">
              {t('Lancement des cas cliniques')}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-lime-800">
              {t(
                'Tant qu’un cas n’est pas lancé, les étudiants voient une page d’attente. Lancer un cas fait tourner la page de toute la classe sur ce cas — l’ancien se referme, vous seul pilotez. Relancer un cas plus ancien ramène toute la classe dessus.'
              )}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {caseGroups.map((g, gi) =>
                g.key === 'libres' ? null : (
                  <Button
                    key={g.key}
                    className={cn(
                      'h-12 text-sm font-semibold',
                      g.opened
                        ? 'border border-lime-400 bg-white text-lime-700 hover:bg-lime-100'
                        : 'bg-lime-600 text-white hover:bg-lime-700'
                    )}
                    variant={g.opened ? 'outline' : 'default'}
                    onClick={() => manage('open_case', { caseId: g.key })}
                    disabled={g.opened}
                  >
                    {g.opened ? (
                      <>
                        <Check className="mr-2 h-4 w-4" />
                        {t('Cas clinique {n} lancé', { n: gi + 1 })}
                      </>
                    ) : (
                      <>
                        <Play className="mr-2 h-4 w-4" />
                        {t('Lancer le cas clinique {n}', { n: gi + 1 })}
                      </>
                    )}
                  </Button>
                )
              )}
            </div>
          </div>
        )}

        {caseGroups.map((g, gi) => (
          <section key={g.key} className="space-y-2">
            <h3 className="flex flex-wrap items-center gap-2 text-sm font-bold text-stone-800">
              <span className="rounded-full bg-lime-600 px-2.5 py-0.5 text-xs font-bold text-white">
                {t('Application {n}', { n: gi + 1 })}
              </span>
              {g.title}
              {/* v2.7.0 : état de lancement du cas */}
              {g.key !== 'libres' &&
                (g.opened ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-lime-100 px-2 py-0.5 text-[10px] font-bold text-lime-700">
                    <Check className="h-3 w-3" /> {t('lancé')}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-bold text-stone-600">
                    <Lock className="h-3 w-3" /> {t('en attente de lancement')}
                  </span>
                ))}
            </h3>
            {g.questions.map((q, qi) => {
              const answeredTeams = new Set(
                data.appAnswers.filter((a) => a.questionId === q.id).map((a) => a.teamId)
              ).size
              const revealed = revealedIds.has(q.id)
              return (
                <div key={q.id} className="rounded-2xl border border-stone-200 bg-white p-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-stone-700">
                      Q{qi + 1}. {q.text.length > 90 ? q.text.slice(0, 90) + '…' : q.text}
                    </p>
                    {revealed ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
                        <Eye className="h-3.5 w-3.5" /> {t('Révélée')}
                      </span>
                    ) : (
                      <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-600">
                        {t('en attente ({d}/{n})', { d: answeredTeams, n: activeTeams.length })}
                      </span>
                    )}
                  </div>
                  {revealed && (
                    <div className="space-y-1.5">
                      {activeTeams.map((tm) => {
                        const ans = data.appAnswers.find(
                          (a) => a.questionId === q.id && a.teamId === tm.id
                        )
                        return (
                          <div
                            key={tm.id}
                            className="flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2 text-sm"
                          >
                            <span className="text-stone-700">{tm.name}</span>
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
                  )}
                </div>
              )
            })}
          </section>
        ))}

        <div className="rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-bold text-amber-900">
            {t('Forçage manuel : {state}', {
              state: data.session.revealed ? t('activé') : t('désactivé'),
            })}
          </p>
          <p className="mb-3 mt-1 text-sm text-amber-800">
            {t(
              'La révélation est automatique dès que toutes les équipes ont répondu à une question. Ce bouton sert uniquement à révéler en avance (par exemple si une équipe a abandonné).'
            )}
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
                <EyeOff className="mr-2 h-4 w-4" /> {t('Annuler le forçage')}
              </>
            ) : (
              <>
                <Eye className="mr-2 h-4 w-4" /> {t('Tout révéler maintenant')}
              </>
            )}
          </Button>
        </div>
      </div>
    )
  }

  // ----- peer -----
  if (status === 'peer') {
    const evaluators = new Set(data.peerEvals.map((e) => e.evaluatorId)).size
    const eligible = data.students.filter((s) => s.teamId).length
    return (
      <div className="space-y-4">
        <InfoCard tone="emerald" title={t('Étape en cours : évaluation par les pairs')}>
          {t(PHASE_INFO.peer.teacherHint)}{' '}
          {t('Chaque étudiant ne voit que ses coéquipiers. Prévoyez 3 à 5 minutes.')}
        </InfoCard>
        <div className="rounded-2xl border border-stone-200 bg-white p-6 text-center">
          <p className="text-3xl font-bold text-stone-900">
            {evaluators}
            <span className="text-lg text-stone-400"> / {eligible}</span>
          </p>
          <p className="mt-1 text-sm text-stone-600">{t('étudiants ont soumis leur évaluation')}</p>
          <div className="mx-auto mt-4 h-2 max-w-sm overflow-hidden rounded-full bg-stone-100">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${eligible > 0 ? (evaluators / eligible) * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* v2.7.0 : équipes qui n'ont PAS complètement évalué leurs pairs
            — pour les solliciter avant la fin de la phase. */}
        <PeerCompletenessCard data={data} />
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
      <InfoCard tone="emerald" title={t('Séance terminée')}>
        {t(
          'Bravo ! Les étudiants consultent leurs résultats sur leur téléphone. Vous pouvez exporter l’ensemble des notes ci-dessous.'
        )}
      </InfoCard>
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-stone-200 bg-white p-4 text-center">
          <p className="text-2xl font-bold text-stone-900">{data.students.length}</p>
          <p className="text-xs text-stone-500">{t('étudiants')}</p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-4 text-center">
          <p className="text-2xl font-bold text-stone-900">{avgIrat}</p>
          <p className="text-xs text-stone-500">
            {t('moyenne iRAT (/{n})', { n: ratQs.length })}
          </p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-4 text-center">
          <p className="text-2xl font-bold text-stone-900">{data.appeals.length}</p>
          <p className="text-xs text-stone-500">{t('réclamation(s)')}</p>
        </div>
      </div>
      <Button
        className="h-12 w-full bg-emerald-600 text-white hover:bg-emerald-700"
        onClick={() => exportXlsx(data, ratQs, appQs)}
      >
        <Download className="mr-2 h-4 w-4" />
        {t('Exporter les résultats — Excel (3 feuilles)')}
      </Button>
      <p className="text-xs leading-relaxed text-stone-500">
        {t(
          'Un seul fichier Excel : feuille 1 « Résultats », feuille 2 « Docimologie », feuille 3 « Questionnaire ». Les exports CSV restent disponibles dans leurs rubriques : « Résultats », « Statistiques » et « Questionnaire ».'
        )}
      </p>
      <p className="text-xs text-stone-500">
        {t(
          'Astuce : pour refaire une séance similaire, créez une nouvelle séance et reprenez vos questions.'
        )}
      </p>
    </div>
  )
}

// v2.7.0 — Carte « équipes à solliciter » : équipes dont un ou plusieurs
// membres n'ont pas encore évalué TOUS leurs coéquipiers. Affichée en phase
// d'évaluation par les pairs (rubrique 7 du déroulé) : l'enseignant voit
// immédiatement qui relancer pour compléter.
function PeerCompletenessCard({ data }: { data: DashboardDTO }) {
  const { t } = useI18n()
  const rows = data.teams
    .map((tm) => ({
      team: tm,
      members: data.students.filter((s) => s.teamId === tm.id),
    }))
    .filter(({ members }) => members.length > 1)
    .map(({ team, members }) => {
      const details = members.map((m) => {
        const teammateIds = members.filter((x) => x.id !== m.id).map((x) => x.id)
        const done = data.peerEvals.filter(
          (e) => e.evaluatorId === m.id && teammateIds.includes(e.evaluatedId)
        ).length
        return { name: m.name, done, expected: teammateIds.length }
      })
      return {
        team,
        details,
        complete: details.every((d) => d.done >= d.expected),
      }
    })

  if (rows.length === 0) return null
  const incomplete = rows.filter((r) => !r.complete)

  if (incomplete.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-4 text-center">
        <p className="flex items-center justify-center gap-2 text-sm font-bold text-emerald-800">
          <Check className="h-5 w-5" />
          {t('Toutes les équipes ont complété leurs évaluations de pairs.')}
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
      <p className="text-sm font-bold text-amber-900">
        {t('Équipes à solliciter ({n})', { n: incomplete.length })}
      </p>
      <p className="mt-0.5 text-sm text-amber-800">
        {t(
          'Ces étudiants n’ont pas encore évalué tous leurs coéquipiers — invitez-les à terminer avant la fin de la phase.'
        )}
      </p>
      <div className="mt-3 space-y-2">
        {incomplete.map(({ team, details }) => (
          <div key={team.id} className="rounded-xl bg-white p-3">
            <p className="text-sm font-bold text-stone-800">{team.name}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {details
                .filter((d) => d.done < d.expected)
                .map((d) => (
                  <span
                    key={d.name}
                    className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800"
                  >
                    <Users className="h-3 w-3" />
                    {d.name}
                    <span className="font-mono">
                      {d.done}/{d.expected}
                    </span>
                  </span>
                ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-amber-700">
        {t('Compteur : évaluations données par l’étudiant sur ses coéquipiers.')}
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
  const { t } = useI18n()
  return (
    <span className="flex items-center gap-1.5 text-xs text-stone-500">
      {t('Durée :')}
      <Input
        type="number"
        min={1}
        max={90}
        value={minutes}
        onChange={(e) => setMinutes(e.target.value)}
        className="h-8 w-16 border-stone-300 text-center text-sm"
      />
      {t('min')}
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
        {t('OK')}
      </Button>
    </span>
  )
}

// ============================================================
// v3.3.0 — RUBRIQUE « JOURNAL » : modifications des enseignants
//
// Demande de l'enseignante : « une rubrique contenant le journal de
// modifications par les enseignants serait nécessaire pour une
// meilleure collaboration entre les enseignants ». Avec le partage
// v3.2 (propriétaire + invités co-pilotent la même séance), chaque
// modification est consignée avec son AUTEUR (compte connecté), son
// heure et son origine (local / en ligne) : chacun voit ce que les
// autres ont changé — plus de « qui a tourné la phase ?? ».
// Lecture pure : le sondage du tableau de bord rafraîchit la liste.
// ============================================================

/** Libellé i18n d'une entrée du journal, selon son type + son action. */
function journalEventLabel(
  ev: JournalEntryDTO,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  const p = ev.payload
  const action = typeof p.action === 'string' ? p.action : ''
  switch (ev.type) {
    case 'phase': {
      const fromLabel =
        typeof p.from === 'string' && p.from in PHASE_INFO
          ? PHASE_INFO[p.from as Phase].short
          : String(p.from ?? '?')
      const toLabel =
        typeof p.to === 'string' && p.to in PHASE_INFO
          ? PHASE_INFO[p.to as Phase].short
          : String(p.to ?? '?')
      return t('Phase : {from} → {to}', { from: t(fromLabel), to: t(toLabel) })
    }
    case 'case_open':
      return t('Cas clinique lancé')
    case 'reveal':
      return t('Révélation des réponses demandée')
    case 'appeal_decision':
      return p.status === 'accepted' ? t('Réclamation acceptée') : t('Réclamation rejetée')
    case 'restart':
      return t('Séance redémarrée — réponses effacées')
    case 'share':
      return action === 'unshare_session' ? t('Partage retiré') : t('Partage ajouté')
    case 'question_edit':
      switch (action) {
        case 'add_question':
          return t('Question ajoutée')
        case 'update_question':
          return t('Question modifiée')
        case 'move_question':
          return t('Question déplacée')
        case 'shuffle_quiz':
          return t('Questions mélangées')
        case 'delete_question':
          return t('Question supprimée')
        default:
          return t('Question modifiée')
      }
    case 'team_edit':
      switch (action) {
        case 'set_team_count':
          return t("Nombre d'équipes ajusté")
        case 'rename_team':
          return t('Équipe renommée')
        case 'move_student':
          return t('Étudiant changé d’équipe')
        case 'auto_assign':
          return t('Répartition automatique des équipes')
        case 'remove_student':
          return t('Étudiant exclu de la séance')
        default:
          return t('Équipes modifiées')
      }
    case 'session_edit':
      switch (action) {
        case 'launch_feedback':
          return t('Feedback lancé')
        case 'set_title':
          return t('Titre de la séance modifié')
        case 'set_pin':
          return t('Code PIN modifié')
        case 'set_irat_minutes':
          return t('Durée du iRAT modifiée')
        case 'add_case':
          return t('Cas clinique ajouté')
        case 'update_case':
          return t('Cas clinique modifié')
        case 'delete_case':
          return t('Cas clinique supprimé')
        case 'sai_update_item':
          return t('Item du questionnaire modifié')
        case 'sai_add_item':
          return t('Item ajouté au questionnaire')
        case 'sai_delete_item':
          return t('Item supprimé du questionnaire')
        case 'sai_reset':
          return t('Questionnaire réinitialisé')
        case 'delete_session':
          return t('Séance mise à la corbeille')
        case 'restore_session':
          return t('Séance restaurée')
        case 'delete_forever':
          return t('Séance supprimée définitivement')
        case 'duplicate_session':
          return t('Séance dupliquée')
        default:
          return t('Réglage de la séance modifié')
      }
    default:
      return t('Modification')
  }
}

function JournalTab({ data }: { data: DashboardDTO }) {
  const { t } = useI18n()
  const events = data.journal ?? []
  return (
    <div className="space-y-4">
      <InfoCard tone="emerald" title={t('Journal de la séance')}>
        {t(
          'Toutes les modifications faites par les enseignants de cette séance (propriétaire et invités) : qui a changé quoi, quand, depuis quelle version de l’application. Précieux quand plusieurs enseignants co-animent la même séance.'
        )}
      </InfoCard>
      {events.length === 0 ? (
        <div className="rounded-2xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-500">
          {t('Aucune modification enregistrée pour le moment — les actions des enseignants apparaîtront ici.')}
        </div>
      ) : (
        <ol className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
          {events.map((ev) => {
            const actor =
              typeof ev.payload.actor === 'string' && ev.payload.actor.length > 0
                ? ev.payload.actor
                : null
            const actorEmail =
              typeof ev.payload.actorEmail === 'string' && ev.payload.actorEmail.length > 0
                ? ev.payload.actorEmail
                : null
            const detail =
              typeof ev.payload.detail === 'string' && ev.payload.detail.length > 0
                ? ev.payload.detail
                : null
            return (
              <li
                key={ev.sequence}
                className="rounded-xl border border-stone-200 bg-white px-3 py-2.5 shadow-sm"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                  <span className="font-mono text-xs text-stone-400">
                    {formatDate(new Date(ev.createdAt), {
                      dateStyle: 'short',
                      timeStyle: 'medium',
                    })}
                  </span>
                  <span className="font-semibold text-stone-800">
                    {journalEventLabel(ev, t)}
                  </span>
                  <span
                    className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600"
                    title={actorEmail ?? undefined}
                  >
                    {actor ?? t('Enseignant')}
                  </span>
                  {ev.origin === 'online' && (
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">
                      {t('version en ligne')}
                    </span>
                  )}
                </div>
                {detail && (
                  <p className="mt-1 truncate text-xs text-stone-500" title={detail}>
                    {detail}
                  </p>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
