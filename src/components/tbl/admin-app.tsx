'use client'

// ============================================================
// TBL Live v2.9.0 — Espace administrateur de l'application
//
// Interface réservée à la propriétaire de l'application (page /admin,
// mot de passe propre choisi à la première visite). Elle permet :
//  - de voir et gérer TOUTES les séances TBL de la base : renommer,
//    régénérer le code d'accès, réinitialiser le PIN enseignant,
//    mettre à la corbeille, restaurer, supprimer définitivement —
//    individuellement ou en bloc ;
//  - de régler le délai du cycle de synchronisation Internet ↔
//    réseau local (2 s à 60 s) ;
//  - de personnaliser N'IMPORTE QUEL texte de l'application (le
//    remplacement s'affiche dans toutes les langues, reste
//    modifiable et réinitialisable à tout moment) ;
//  - de changer le mot de passe administrateur.
//
// v3.0.0 — TROIS espaces nouveaux :
//  - COMPTES : comptes enseignants (connexion obligatoire pour ouvrir
//    une séance) : saisie manuelle, import Excel/CSV, mots de passe
//    oubliés, domaine institutionnel des emails ;
//  - APPARENCE : couleurs de l'application (principale, accent, fond)
//    et icônes de l'accueil ;
//  - PERFORMANCES : étudiants actifs, requêtes/minute, latence des
//    routes (en direct pendant un cours).
//  - Séances : sélection MULTIPLE avec corbeille/suppression en bloc
//    (boutons en haut, près d'« Actualiser ») + signalements
//    anti-capture activables TBL par TBL (désactivés par défaut).
//
// Page volontairement en FRANÇAIS SEUL (aucune clé i18n) : seul
// l'espace enseignant/étudiant est multilingue.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Check,
  Dices,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  Trash2,
  Upload,
  UserRound,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/tbl-client'
import { reloadAppConfig } from '@/lib/app-config'
import { THEME_ICON_CHOICES, THEME_PRESETS, type ThemeConfig, type ThemeIconKind } from '@/lib/theme'
import { themeIcon } from '@/lib/theme-client'
import { buildXlsx, downloadBlob } from '@/lib/xlsx-writer'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

// ---------------- Types locaux ----------------

interface AdminState {
  authenticated: boolean
  needsSetup: boolean
  syncIntervalMs: number
  textsCount: number
  /** v3.0.0 — domaine des emails institutionnels enseignants. */
  teacherEmailDomain?: string
  /** v3.0.0 — thème actuel (couleurs + icônes). */
  theme?: ThemeConfig
}

interface AdminSessionRow {
  id: string
  code: string
  title: string
  status: string
  createdAt: string
  deletedAt: string | null
  dataPurgedAt: string | null
  syncedAt: string | null
  students: number
  teams: number
  questions: number
  cases: number
  answers: number
  /** v3.0.0 : signalements anti-capture activés pour cette séance. */
  reportsEnabled?: boolean
  /** v3.0.0 : compte enseignant propriétaire (null = importée/ancienne). */
  teacher?: { firstName: string; lastName: string; email: string } | null
}

/** v3.0.0 — ligne de compte enseignant (espace Comptes). */
interface AdminAccountRow {
  id: string
  firstName: string
  lastName: string
  email: string
  sessions: number
  lockedUntil: string | null
  forgotPending: boolean
  forgotPasswordAt: string | null
  createdAt: string
}

const SYNC_CHOICES = [
  { ms: 2000, label: '2 secondes — très réactif (grandes salles, bonne connexion)' },
  { ms: 5000, label: '5 secondes — recommandé (défaut)' },
  { ms: 10000, label: '10 secondes' },
  { ms: 30000, label: '30 secondes — économe (connexion limitée)' },
  { ms: 60000, label: '60 secondes — très économe' },
]

const STATUS_LABEL: Record<string, string> = {
  lobby: 'Inscription',
  irat: 'iRAT',
  trat: 'tRAT',
  appeal: 'Réclamations',
  feedback: 'Feedback',
  application: 'Application',
  peer: 'Paires',
  finished: 'Terminée',
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

// ---------------- Composant racine ----------------

export function AdminApp() {
  const [state, setState] = useState<AdminState | null>(null)
  const [loadError, setLoadError] = useState('')

  const reload = useCallback(async () => {
    try {
      const s = await api<AdminState>('/api/admin')
      setState(s)
      setLoadError('')
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Erreur inconnue.')
    }
  }, [])

  useEffect(() => {
    // Chargement initial : via continuation de promesse (le setState
    // arrive après le await réseau, jamais dans le corps synchrone de
    // l'effet — règle react-hooks/set-state-in-effect).
    Promise.resolve().then(reload).catch(() => undefined)
  }, [reload])

  if (loadError && !state) {
    return (
      <div className="mx-auto max-w-md space-y-3 py-16 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-red-400" />
        <p className="font-semibold text-stone-900">Espace administrateur indisponible</p>
        <p className="text-sm text-stone-600">{loadError}</p>
        <Button variant="outline" onClick={reload} className="border-stone-300">
          <RefreshCw className="mr-2 h-4 w-4" /> Réessayer
        </Button>
      </div>
    )
  }
  if (!state) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600" />
      </div>
    )
  }
  if (state.needsSetup) return <SetupCard onDone={reload} />
  if (!state.authenticated) return <LoginCard onDone={reload} />
  return <AdminMain state={state} refresh={reload} onLogout={reload} />
}

// ---------------- Première installation ----------------

function SetupCard({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (password !== password2) {
      setError('Les deux mots de passe ne correspondent pas.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'setup', password }) })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Première utilisation">
      <p className="text-sm leading-relaxed text-stone-600">
        Aucun mot de passe administrateur n&apos;existe encore. Choisissez-en un maintenant
        pour sécuriser cet espace : personne d&apos;autre ne pourra s&apos;en approprier la
        configuration. Notez-le précieusement — il ne peut être changé qu&apos;avec lui.
      </p>
      <div className="space-y-2">
        <div>
          <Label htmlFor="admin-pass">Mot de passe (8 caractères ou plus)</Label>
          <Input
            id="admin-pass"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5 h-11"
            autoComplete="new-password"
          />
        </div>
        <div>
          <Label htmlFor="admin-pass2">Confirmez le mot de passe</Label>
          <Input
            id="admin-pass2"
            type="password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            className="mt-1.5 h-11"
            autoComplete="new-password"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button
          className="h-12 w-full bg-emerald-600 hover:bg-emerald-700"
          disabled={busy || password.length < 8 || password !== password2}
          onClick={submit}
        >
          {busy ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <KeyRound className="mr-2 h-5 w-5" />}
          Protéger l&apos;espace administrateur
        </Button>
      </div>
    </AuthShell>
  )
}

// ---------------- Connexion ----------------

function LoginCard({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      await api('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'login', password }) })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Espace administrateur">
      <p className="text-sm text-stone-600">
        Cet espace protège la configuration de l&apos;application et la liste des séances.
      </p>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div>
          <Label htmlFor="admin-login-pass">Mot de passe administrateur</Label>
          <Input
            id="admin-login-pass"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5 h-11"
            autoComplete="current-password"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" className="h-12 w-full bg-emerald-600 hover:bg-emerald-700" disabled={busy || !password}>
          {busy ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <KeyRound className="mr-2 h-5 w-5" />}
          Se connecter
        </Button>
      </form>
    </AuthShell>
  )
}

function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md py-10">
      <a
        href="/"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800"
      >
        <ArrowLeft className="h-4 w-4" /> Retour à l&apos;application
      </a>
      <div className="space-y-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-stone-900">{title}</h1>
        {children}
      </div>
    </div>
  )
}

// ---------------- Écran principal ----------------

function AdminMain({
  state,
  refresh,
  onLogout,
}: {
  state: AdminState
  refresh: () => Promise<void>
  onLogout: () => void
}) {
  const [toast, setToast] = useState('')

  const notify = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 4000)
  }

  const call = async (payload: Record<string, unknown>, okMsg?: string) => {
    try {
      const res = await api<Record<string, unknown>>('/api/admin', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      if (okMsg) notify(okMsg)
      await refresh()
      return res
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Erreur inconnue.')
      return null
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 py-8">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Espace administrateur</h1>
          <p className="text-sm text-stone-500">
            Configuration de l&apos;application et gestion des séances TBL.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-stone-300 px-3 text-sm text-stone-600 hover:bg-stone-50"
          >
            <ArrowLeft className="h-4 w-4" /> Application
          </a>
          <Button
            variant="ghost"
            size="sm"
            className="h-10 text-stone-400 hover:bg-red-50 hover:text-red-600"
            onClick={async () => {
              await call({ action: 'logout' })
              onLogout()
            }}
          >
            <LogOut className="mr-1 h-4 w-4" /> Quitter
          </Button>
        </div>
      </div>

      {toast && (
        <p className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
          {toast}
        </p>
      )}

      <Tabs defaultValue="sessions">
        <TabsList className="h-auto w-full justify-start overflow-x-auto bg-stone-100 p-1">
          <TabsTrigger value="sessions" className="flex-1 px-3 py-2 sm:flex-none">
            Séances TBL
          </TabsTrigger>
          {/* v3.0.0 — comptes enseignants (connexion obligatoire). */}
          <TabsTrigger value="accounts" className="flex-1 px-3 py-2 sm:flex-none">
            <UserRound className="mr-1 h-3.5 w-3.5" />
            Comptes
          </TabsTrigger>
          {/* v3.0.0 — couleurs et icônes de l'application. */}
          <TabsTrigger value="appearance" className="flex-1 px-3 py-2 sm:flex-none">
            <Palette className="mr-1 h-3.5 w-3.5" />
            Apparence
          </TabsTrigger>
          <TabsTrigger value="params" className="flex-1 px-3 py-2 sm:flex-none">
            Paramètres
          </TabsTrigger>
          <TabsTrigger value="texts" className="flex-1 px-3 py-2 sm:flex-none">
            Textes
            {state.textsCount > 0 && (
              <span className="ml-1.5 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {state.textsCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="security" className="flex-1 px-3 py-2 sm:flex-none">
            Sécurité
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sessions" className="mt-4">
          <SessionsTab call={call} />
        </TabsContent>
        <TabsContent value="accounts" className="mt-4">
          <AccountsTab call={call} />
        </TabsContent>
        <TabsContent value="appearance" className="mt-4">
          <AppearanceTab theme={state.theme ?? {}} call={call} />
        </TabsContent>
        <TabsContent value="params" className="mt-4">
          <ParamsTab state={state} call={call} />
        </TabsContent>
        <TabsContent value="texts" className="mt-4">
          <TextsTab call={call} />
        </TabsContent>
        <TabsContent value="security" className="mt-4">
          <SecurityTab onDone={onLogout} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------------- Onglet Séances ----------------

type CallFn = (payload: Record<string, unknown>, okMsg?: string) => Promise<Record<string, unknown> | null>

function SessionsTab({ call }: { call: CallFn }) {
  const [rows, setRows] = useState<AdminSessionRow[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await api<{ sessions: AdminSessionRow[] }>('/api/admin', {
        method: 'POST',
        body: JSON.stringify({ action: 'list' }),
      })
      setRows(res.sessions)
      setSelected(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue.')
    }
  }, [])

  useEffect(() => {
    Promise.resolve().then(load).catch(() => undefined)
  }, [load])

  if (error) {
    return <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>
  }
  if (!rows) {
    return (
      <div className="flex h-32 items-center justify-center">
        <div className="h-7 w-7 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600" />
      </div>
    )
  }

  const toggle = (code: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  const activeCount = rows.filter((r) => !r.deletedAt).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-stone-600">
          {rows.length} séance(s) dans la base · {activeCount} active(s) ·{' '}
          {rows.length - activeCount} en corbeille.
        </p>
        {/* v3.0.0 — sélection multiple : les DEUX options (corbeille et
            suppression définitive) sont en haut, À CÔTÉ d'« Actualiser »,
            comme demandé par l'administratrice. Cochez les cases des
            séances concernées, puis un seul clic agit sur toutes. */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="h-9 border-stone-300" onClick={load}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Actualiser
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 border-amber-300 text-amber-800 hover:bg-amber-50"
            disabled={selected.size === 0}
            title={
              selected.size === 0
                ? 'Cochez les cases des séances à mettre à la corbeille'
                : `Mettre les ${selected.size} séance(s) sélectionnée(s) à la corbeille`
            }
            onClick={() => {
              const n = selected.size
              if (
                window.confirm(
                  `Mettre ${n} séance(s) à la corbeille ? Les étudiants perdent immédiatement l'accès (restauration possible pendant 48 h, sélections possible ensuite).`
                )
              ) {
                call(
                  { action: 'bulk_trash', codes: [...selected] },
                  `${n} séance(s) mise(s) à la corbeille.`
                ).then(() => load())
              }
            }}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" /> Corbeille{selected.size > 0 ? ` (${selected.size})` : ''}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 border-red-300 text-red-700 hover:bg-red-50"
            disabled={selected.size === 0}
            title={
              selected.size === 0
                ? 'Cochez les cases des séances à supprimer définitivement'
                : `Supprimer DÉFINITIVEMENT les ${selected.size} séance(s) sélectionnée(s)`
            }
            onClick={() => {
              const n = selected.size
              if (
                window.confirm(
                  `Supprimer DÉFINITIVEMENT les ${n} séance(s) sélectionnées ? Toutes leurs données (étudiants, réponses, notes, réclamations, évaluations) seront effacées, sans possibilité de retour.`
                )
              ) {
                call(
                  { action: 'bulk_delete_forever', codes: [...selected] },
                  `${n} séance(s) supprimée(s) définitivement.`
                ).then(() => load())
              }
            }}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" /> Supprimer définitivement{selected.size > 0 ? ` (${selected.size})` : ''}
          </Button>
        </div>
      </div>

      {rows.length === 0 && (
        <p className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 p-8 text-center text-sm text-stone-500">
          Aucune séance dans la base pour le moment. Elles apparaîtront ici dès la première
          création.
        </p>
      )}

      <div className="space-y-3">
        {rows.map((r) => (
          <SessionCard key={r.id} row={r} checked={selected.has(r.code)} onToggle={() => toggle(r.code)} call={call} onChanged={load} />
        ))}
      </div>
    </div>
  )
}

function SessionCard({
  row,
  checked,
  onToggle,
  call,
  onChanged,
}: {
  row: AdminSessionRow
  checked: boolean
  onToggle: () => void
  call: CallFn
  onChanged: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(row.title)
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [newCode, setNewCode] = useState('')
  const [busy, setBusy] = useState(false)
  const trashed = !!row.deletedAt

  return (
    <div
      className={cn(
        'rounded-2xl border bg-white p-4 shadow-sm',
        trashed ? 'border-stone-200 opacity-75' : 'border-stone-200'
      )}
    >
      <div className="flex items-start gap-3">
        {/* Sélection (suppression en bloc) */}
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="mt-1.5 h-4 w-4 shrink-0 accent-red-600"
          aria-label={`Sélectionner la séance ${row.code}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-lg bg-stone-100 px-2 py-0.5 font-mono text-sm font-bold tracking-widest text-stone-700">
              {row.code}
            </span>
            {renaming ? (
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                  className="h-9"
                />
                <Button
                  size="sm"
                  className="h-9 bg-emerald-600 hover:bg-emerald-700"
                  disabled={busy || title.trim().length < 2 || title.trim() === row.title}
                  onClick={async () => {
                    setBusy(true)
                    const res = await call({ action: 'rename', code: row.code, title: title.trim() })
                    setBusy(false)
                    if (res) {
                      setRenaming(false)
                      onChanged()
                    }
                  }}
                >
                  <Save className="h-4 w-4" />
                </Button>
              </span>
            ) : (
              <>
                <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-stone-900">
                  {row.title}
                </p>
                <button
                  type="button"
                  className="text-xs font-semibold text-emerald-700 hover:underline"
                  onClick={() => {
                    setTitle(row.title)
                    setRenaming(true)
                  }}
                >
                  Renommer
                </button>
              </>
            )}
          </div>

          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
            <span className={cn('rounded-full px-2 py-0.5 font-semibold', trashed ? 'bg-stone-200 text-stone-600' : 'bg-emerald-100 text-emerald-800')}>
              {trashed ? 'Corbeille' : STATUS_LABEL[row.status] ?? row.status}
            </span>
            <span>{row.students} étudiant(s)</span>
            <span>{row.teams} équipe(s)</span>
            <span>{row.questions} question(s)</span>
            <span>{row.answers} réponse(s)</span>
            {row.dataPurgedAt && <span className="text-amber-700">données étudiantes purgées</span>}
            <span>créée le {fmtDate(row.createdAt)}</span>
            {row.teacher && (
              <span className="text-emerald-700">
                propriétaire : {row.teacher.firstName} {row.teacher.lastName}
              </span>
            )}
          </p>

          {/* v3.0.0 — Signalements anti-capture de CE TBL : désactivés par
              défaut (l'onglet « Signalements » n'apparaît pas dans le
              tableau de bord, aucune écriture en base, aucune requête
              au sondage). L'administratrice les réactive ici TBL par TBL
              si une séance particulière le justifie. */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await call(
                  { action: 'set_reports', code: row.code, enabled: !row.reportsEnabled },
                  row.reportsEnabled
                    ? `Signalements désactivés pour ${row.code}.`
                    : `Signalements activés pour ${row.code}.`
                )
                setBusy(false)
                onChanged()
              }}
              className={cn(
                'inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition-colors',
                row.reportsEnabled
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                  : 'border-stone-300 bg-stone-50 text-stone-600 hover:bg-stone-100'
              )}
              title="Les signalements anti-capture (captures suspectées, sorties d'application) sont envoyés au tableau de bord enseignant — désactivés par défaut pour alléger la séance."
            >
              <span
                className={cn(
                  'relative inline-block h-4 w-7 rounded-full transition-colors',
                  row.reportsEnabled ? 'bg-emerald-500' : 'bg-stone-300'
                )}
                aria-hidden="true"
              >
                <span
                  className={cn(
                    'absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all',
                    row.reportsEnabled ? 'left-3.5' : 'left-0.5'
                  )}
                />
              </span>
              Signalements anti-capture : {row.reportsEnabled ? 'activés' : 'désactivés'}
            </button>
          </div>

          {/* Réinitialiser le PIN */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Input
              value={pin}
              onChange={(e) => setPin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))}
              placeholder="Nouveau PIN enseignant"
              className="h-9 w-40 font-mono tracking-widest"
              aria-label={`Nouveau code PIN de la séance ${row.code}`}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-9 border-stone-300"
              disabled={pin.length < 6 || pin !== pin2 || busy}
              title="Renseignez et confirmez le même PIN à droite"
              onClick={async () => {
                setBusy(true)
                const res = await call(
                  { action: 'reset_pin', code: row.code, pin },
                  `PIN de la séance ${row.code} réinitialisé.`
                )
                setBusy(false)
                if (res) {
                  setPin('')
                  setPin2('')
                }
              }}
            >
              <KeyRound className="mr-1 h-3.5 w-3.5" /> Réinitialiser le PIN
            </Button>
            <Input
              value={pin2}
              onChange={(e) => setPin2(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))}
              placeholder="confirmez"
              className="h-9 w-28 font-mono tracking-widest"
              aria-label="Confirmez le nouveau PIN"
            />
          </div>

          {/* Nouveau code d'accès */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Input
              value={newCode}
              onChange={(e) => setNewCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              placeholder="Code choisi (6 car.)"
              className="h-9 w-40 font-mono tracking-widest"
              aria-label={`Nouveau code d'accès de la séance ${row.code}`}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-9 border-stone-300"
              disabled={busy || (newCode.length !== 0 && newCode.length !== 6)}
              title={
                newCode.length === 0
                  ? 'Laissez vide pour générer un code au hasard'
                  : 'Code personnalisé de 6 caractères'
              }
              onClick={async () => {
                setBusy(true)
                const res = await call({ action: 'set_code', code: row.code, newCode })
                setBusy(false)
                if (res && typeof res.code === 'string') {
                  setNewCode('')
                  window.alert(`Nouveau code de la séance : ${res.code}\n\nCommuniquez-le aux étudiants — l'ancien code (${row.code}) ne fonctionne plus.`)
                  onChanged()
                }
              }}
            >
              <Dices className="mr-1 h-3.5 w-3.5" />
              {newCode.length === 0 ? 'Régénérer le code' : 'Appliquer ce code'}
            </Button>
          </div>

          {/* Corbeille / restauration / suppression définitive */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!trashed ? (
              <Button
                variant="outline"
                size="sm"
                className="h-9 border-amber-300 text-amber-800 hover:bg-amber-50"
                disabled={busy}
                onClick={async () => {
                  if (window.confirm(`Mettre la séance ${row.code} à la corbeille ? Les étudiants perdent immédiatement l'accès (restauration possible pendant 48 h).`)) {
                    setBusy(true)
                    await call({ action: 'delete', code: row.code }, `Séance ${row.code} mise à la corbeille.`)
                    setBusy(false)
                    onChanged()
                  }
                }}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Corbeille
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-9 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  await call({ action: 'restore', code: row.code }, `Séance ${row.code} restaurée.`)
                  setBusy(false)
                  onChanged()
                }}
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" /> Restaurer
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-red-600 hover:bg-red-50"
              disabled={busy}
              onClick={async () => {
                if (
                  window.confirm(
                    `Supprimer DÉFINITIVEMENT la séance ${row.code} ?\n\nToutes ses données (étudiants, réponses, notes, réclamations, évaluations) seront effacées, sans possibilité de retour.`
                  )
                ) {
                  setBusy(true)
                  await call({ action: 'delete_forever', code: row.code }, `Séance ${row.code} supprimée définitivement.`)
                  setBusy(false)
                  onChanged()
                }
              }}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Supprimer définitivement
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------- Onglet Paramètres ----------------

function ParamsTab({ state, call }: { state: AdminState; call: CallFn }) {
  const [ms, setMs] = useState(state.syncIntervalMs)
  const [busy, setBusy] = useState(false)
  const saved = ms === state.syncIntervalMs

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4">
        <div>
          <p className="text-sm font-bold text-stone-900">Délai de synchronisation Internet ↔ réseau local</p>
          <p className="mt-0.5 text-xs leading-relaxed text-stone-500">
            Cadence à laquelle l&apos;ordinateur « chef d&apos;orchestre » échange avec la
            version en ligne : contributions des étudiants d&apos;une part, état complet
            d&apos;autre part. Un délai court rend la séance très réactif ; un délai long
            économise la connexion. Le rafraîchissement des écrans étudiants
            (~2,5 s pendant les épreuves) est indépendant de ce réglage et reste
            toujours léger grâce au sondage allégé.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={ms}
            onChange={(e) => setMs(Number(e.target.value))}
            className="h-11 rounded-xl border border-stone-300 bg-white px-3 text-sm"
            aria-label="Délai de synchronisation"
          >
            {SYNC_CHOICES.map((c) => (
              <option key={c.ms} value={c.ms}>
                {c.label}
              </option>
            ))}
          </select>
          <Button
            className="h-11 bg-emerald-600 hover:bg-emerald-700"
            disabled={busy || saved}
            onClick={async () => {
              setBusy(true)
              await call({ action: 'set_sync_interval', ms }, 'Délai de synchronisation enregistré.')
              setBusy(false)
            }}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Enregistrer
          </Button>
        </div>
        <p className="rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-600">
          Réglage actuel : <strong>{Math.round(state.syncIntervalMs / 1000)} s</strong>. Le
          changement s&apos;applique aux nouveaux tableaux de bord ouverts (un tableau de
          bord déjà ouvert prend le nouveau délai à son rechargement).
        </p>
      </section>

      <section className="space-y-2 rounded-2xl border border-stone-200 bg-white p-4">
        <p className="text-sm font-bold text-stone-900">Vue d&apos;ensemble de la configuration</p>
        <ul className="space-y-1.5 text-sm text-stone-700">
          <li>• Délai du cycle de synchronisation : {Math.round(state.syncIntervalMs / 1000)} secondes</li>
          <li>• Textes personnalisés : {state.textsCount}</li>
          <li>• Langues disponibles côté enseignant/étudiant : 9 (le texte personnalisé prime dans toutes)</li>
          <li>• Mot de passe administrateur : défini (modifiable dans l&apos;onglet Sécurité)</li>
        </ul>
        <p className="text-xs leading-relaxed text-stone-500">
          « Paramètres disponibles » : chaque valeur de cette page est modifiable et
          réinitialisable individuellement ; les textes se règlent dans l&apos;onglet
          Textes. Aucun autre paramètre caché n&apos;existe dans l&apos;application.
        </p>
      </section>
    </div>
  )
}

// ---------------- Onglet Textes ----------------

function TextsTab({ call }: { call: CallFn }) {
  const [keys, setKeys] = useState<string[] | null>(null)
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null)
  const [busy, setBusy] = useState(false)
  // Abonnement i18n : l'aperçu se met à jour dès qu'une personnalisation
  // est appliquée (reloadAppConfig → setTextOverrides → re-rendu). Le
  // reste de la page reste en français seul.
  const { t: translate } = useI18n()

  const load = useCallback(async () => {
    try {
      const res = await api<{ keys: string[] }>('/api/admin?keys=1')
      setKeys(res.keys)
      const cfg = await fetch('/api/config', { cache: 'no-store' })
      if (cfg.ok) {
        const d = (await cfg.json()) as { texts?: Record<string, string> }
        setOverrides(d.texts ?? {})
      }
    } catch {
      setKeys([])
    }
  }, [])

  useEffect(() => {
    Promise.resolve().then(load).catch(() => undefined)
  }, [load])

  const matches = useMemo(() => {
    if (!keys) return []
    const q = search.trim().toLowerCase()
    const filtered = q
      ? keys.filter((k) => k.toLowerCase().includes(q) || (overrides[k] ?? '').toLowerCase().includes(q))
      : keys
    return filtered.slice(0, 60)
  }, [keys, search, overrides])

  const save = async () => {
    if (!editing) return
    setBusy(true)
    const res = await call({ action: 'save_text', key: editing.key, value: editing.value }, 'Texte enregistré.')
    setBusy(false)
    if (res) {
      await reloadAppConfig()
      await load()
      setEditing(null)
    }
  }

  const resetOne = async (key: string) => {
    setBusy(true)
    const res = await call({ action: 'reset_text', key }, 'Texte réinitialisé.')
    setBusy(false)
    if (res) {
      await reloadAppConfig()
      await load()
    }
  }

  const resetAll = async () => {
    if (
      !window.confirm(
        `Réinitialiser TOUS les textes personnalisés (${Object.keys(overrides).length}) ? L'application retrouvera ses libellés d'origine.`
      )
    )
      return
    setBusy(true)
    const res = await call({ action: 'reset_texts' }, 'Tous les textes sont réinitialisés.')
    setBusy(false)
    if (res) {
      await reloadAppConfig()
      await load()
    }
  }

  if (!keys) {
    return (
      <div className="flex h-32 items-center justify-center">
        <div className="h-7 w-7 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4">
        <div>
          <p className="text-sm font-bold text-stone-900">Textes de l&apos;application</p>
          <p className="mt-0.5 text-xs leading-relaxed text-stone-500">
            Remplacez n&apos;importe quel libellé par votre propre formulation : le
            remplacement s&apos;affiche PARTOUT (toutes les langues, enseignant comme
            étudiants), immédiatement et de façon définitive — jusqu&apos;à ce que vous le
            modifiiez ou le réinitialisiez. Recherchez le texte d&apos;origine (ou une partie).
          </p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un texte (ex. « Test individuel »)…"
            className="h-11 ps-9"
          />
        </div>
        <p className="text-xs text-stone-500">
          {keys.length} textes au total{search.trim() ? ` · ${matches.length} correspondance(s) affichée(s)` : ' · 60 premiers affichés'} ·{' '}
          {Object.keys(overrides).length} personnalisé(s)
          {Object.keys(overrides).length > 0 && (
            <button
              type="button"
              className="ml-2 font-semibold text-red-600 hover:underline"
              onClick={resetAll}
              disabled={busy}
            >
              tout réinitialiser
            </button>
          )}
        </p>
      </section>

      {editing && (
        <section className="space-y-2 rounded-2xl border-2 border-emerald-300 bg-emerald-50/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
            Texte d&apos;origine
          </p>
          <p className="rounded-xl bg-white px-3 py-2 text-sm text-stone-700">{editing.key}</p>
          <div>
            <Label htmlFor="admin-text-value">Votre remplacement</Label>
            <Textarea
              id="admin-text-value"
              value={editing.value}
              onChange={(e) => setEditing({ ...editing, value: e.target.value })}
              rows={3}
              className="mt-1.5 bg-white"
              maxLength={1000}
            />
          </div>
          {editing.value.trim().length > 0 && (
            <p className="rounded-xl bg-white px-3 py-2 text-sm">
              <span className="text-xs font-semibold text-stone-500">Aperçu (ce que verront les utilisateurs) : </span>
              <span className="text-stone-800">{translate(editing.key)}</span>
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button className="h-10 bg-emerald-600 hover:bg-emerald-700" disabled={busy || editing.value.trim().length === 0} onClick={save}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Enregistrer ce texte
            </Button>
            {overrides[editing.key] && (
              <Button
                variant="outline"
                className="h-10 border-stone-300"
                disabled={busy}
                onClick={async () => {
                  await resetOne(editing.key)
                  setEditing(null)
                }}
              >
                <RotateCcw className="mr-2 h-4 w-4" /> Réinitialiser
              </Button>
            )}
            <Button variant="ghost" className="h-10" onClick={() => setEditing(null)}>
              Annuler
            </Button>
          </div>
        </section>
      )}

      <div className="space-y-1.5">
        {matches.length === 0 && (
          <p className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 p-6 text-center text-sm text-stone-500">
            Aucun texte ne correspond à cette recherche.
          </p>
        )}
        {matches.map((k) => {
          const custom = overrides[k]
          return (
            <button
              key={k}
              type="button"
              onClick={() => setEditing({ key: k, value: custom ?? k })}
              className="block w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-start transition-colors hover:border-emerald-300 hover:bg-emerald-50/40"
            >
              <p className="truncate text-sm text-stone-700">{k}</p>
              {custom ? (
                <p className="mt-0.5 truncate text-xs font-semibold text-emerald-700">
                  <Check className="mr-1 inline h-3 w-3" />
                  {custom}
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-stone-400">texte d&apos;origine — cliquer pour personnaliser</p>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------------- Onglet Sécurité ----------------

function SecurityTab({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [next2, setNext2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4">
        <div>
          <p className="text-sm font-bold text-stone-900">Changer le mot de passe administrateur</p>
          <p className="mt-0.5 text-xs text-stone-500">
            La session reste ouverte 12 heures après chaque connexion. Cinq tentatives
            erronées verrouillent l&apos;espace 15 minutes.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <div>
            <Label htmlFor="sec-current">Mot de passe actuel</Label>
            <Input
              id="sec-current"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="mt-1.5 h-11"
              autoComplete="current-password"
            />
          </div>
          <div>
            <Label htmlFor="sec-next">Nouveau (8 car. min.)</Label>
            <Input
              id="sec-next"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className="mt-1.5 h-11"
              autoComplete="new-password"
            />
          </div>
          <div>
            <Label htmlFor="sec-next2">Confirmez</Label>
            <Input
              id="sec-next2"
              type="password"
              value={next2}
              onChange={(e) => setNext2(e.target.value)}
              className="mt-1.5 h-11"
              autoComplete="new-password"
            />
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button
          className="h-11 bg-emerald-600 hover:bg-emerald-700"
          disabled={busy || current.length === 0 || next.length < 8 || next !== next2}
          onClick={async () => {
            setBusy(true)
            setError('')
            try {
              await api('/api/admin', {
                method: 'POST',
                body: JSON.stringify({ action: 'change_password', current, next }),
              })
              setCurrent('')
              setNext('')
              setNext2('')
              onDone() // rafraîchit l'état (toujours connecté)
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Erreur inconnue.')
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
          Changer le mot de passe
        </Button>
      </section>

      <section className="space-y-2 rounded-2xl border border-stone-200 bg-stone-50 p-4">
        <p className="text-sm font-bold text-stone-800">Ce que cet espace ne montre JAMAIS</p>
        <ul className="space-y-1 text-sm text-stone-600">
          <li>• Les réponses individuelles et les notes des étudiants</li>
          <li>• Les codes personnels de reprise des étudiants</li>
          <li>• Le PIN enseignant des séances (réinitialisable, jamais lisible)</li>
          <li>• Les jetons de connexion (enseignants et étudiants)</li>
        </ul>
        <p className="text-xs text-stone-500">
          L&apos;espace administrateur gère la structure des séances, pas leur contenu
          pédagogique — qui reste dans le tableau de bord enseignant, protégé par le PIN
          de chaque séance.
        </p>
      </section>
    </div>
  )
}

// ---------------- v3.0.0 : onglet Comptes (enseignants) ----------------

/** Mot de passe généré/renouvelé, montré UNE seule fois + lien email. */
function PasswordReveal({
  firstName,
  lastName,
  email,
  password,
  onDone,
}: {
  firstName: string
  lastName: string
  email: string
  password: string
  onDone: () => void
}) {
  const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(
    'Votre mot de passe TBL Live'
  )}&body=${encodeURIComponent(
    `Bonjour ${firstName},\n\nVoici votre mot de passe pour TBL Live :\n\n${password}\n\nConnectez-vous avec votre email institutionnel (${email}) puis changez ce mot de passe depuis « Mon compte » si vous le souhaitez.\n\nBonne séance !`
  )}`
  return (
    <div className="space-y-3 rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-4">
      <p className="text-sm font-bold text-emerald-900">
        Mot de passe de {firstName} {lastName} — à communiquer maintenant
      </p>
      <p className="text-xs leading-relaxed text-emerald-800">
        Ce mot de passe n&apos;est jamais stocké en clair : il ne sera plus visible après la
        fermeture de cet encadré. Envoyez-le à l&apos;enseignant(e) par email (le message est
        préparé), ou notez-le : en cas de perte, générez-en un nouveau ici.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="select-all rounded-xl border border-emerald-300 bg-white px-4 py-2 font-mono text-lg font-bold tracking-widest text-emerald-900">
          {password}
        </code>
        <a
          href={mailto}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          <Mail className="h-4 w-4" /> L&apos;envoyer par email
        </a>
        <Button variant="outline" className="h-10 border-emerald-300" onClick={onDone}>
          <Check className="mr-1 h-4 w-4" /> J&apos;ai communiqué ce mot de passe
        </Button>
      </div>
    </div>
  )
}

function AccountsTab({ call }: { call: CallFn }) {
  const [rows, setRows] = useState<AdminAccountRow[] | null>(null)
  const [domain, setDomain] = useState('')
  const [domainDraft, setDomainDraft] = useState('')
  const [error, setError] = useState('')
  // Formulaire de création
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [creating, setCreating] = useState(false)
  const [reveal, setReveal] = useState<{ firstName: string; lastName: string; email: string; password: string } | null>(null)
  // Import Excel
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{
    created: number
    total: number
    problems: { line: number; email: string; reason: string }[]
    accounts: { line: number; firstName: string; lastName: string; email: string; password: string }[]
  } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await api<{ accounts: AdminAccountRow[]; domain: string }>('/api/admin', {
        method: 'POST',
        body: JSON.stringify({ action: 'list_accounts' }),
      })
      setRows(res.accounts)
      setDomain(res.domain)
      setDomainDraft(res.domain)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue.')
    }
  }, [])

  useEffect(() => {
    Promise.resolve().then(load).catch(() => undefined)
  }, [load])

  if (error) {
    return <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>
  }
  if (!rows) {
    return (
      <div className="flex h-32 items-center justify-center">
        <div className="h-7 w-7 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600" />
      </div>
    )
  }

  const createAccount = async () => {
    if (creating) return
    setCreating(true)
    try {
      const res = await call({
        action: 'create_account',
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        password: password.trim(),
      })
      if (res && typeof res.password === 'string') {
        setReveal({
          firstName: firstName.trim() || '—',
          lastName: lastName.trim() || '—',
          email: email.trim(),
          password: res.password,
        })
        setFirstName('')
        setLastName('')
        setEmail('')
        setPassword('')
        await load()
      }
    } finally {
      setCreating(false)
    }
  }

  const importFile = async (file: File) => {
    if (importing) return
    setImporting(true)
    setImportResult(null)
    try {
      const buffer = new Uint8Array(await file.arrayBuffer())
      // Encodage base64 (découpage par tranches pour les gros fichiers)
      let binary = ''
      const CHUNK = 0x8000
      for (let i = 0; i < buffer.length; i += CHUNK) {
        binary += String.fromCharCode(...buffer.subarray(i, i + CHUNK))
      }
      const res = await api<{
        created: number
        total: number
        problems: { line: number; email: string; reason: string }[]
        accounts: { line: number; firstName: string; lastName: string; email: string; password: string }[]
      }>('/api/admin', {
        method: 'POST',
        body: JSON.stringify({
          action: 'import_accounts',
          fileBase64: btoa(binary),
          filename: file.name,
        }),
      })
      setImportResult(res)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue.')
    } finally {
      setImporting(false)
    }
  }

  const downloadTemplate = () => {
    const blob = buildXlsx([
      {
        name: 'Comptes',
        rows: [
          ['Prénom', 'Nom', 'Email institutionnel', 'Mot de passe'],
          ['', '', '', ''],
        ],
        colWidths: { 0: 20, 1: 20, 2: 34, 3: 22 },
      },
    ])
    downloadBlob(blob, 'modele-comptes-enseignants.xlsx')
  }

  return (
    <div className="space-y-5">
      {reveal && (
        <PasswordReveal
          firstName={reveal.firstName}
          lastName={reveal.lastName}
          email={reveal.email}
          password={reveal.password}
          onDone={() => setReveal(null)}
        />
      )}

      {/* Domaine institutionnel */}
      <section className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4">
        <div>
          <p className="text-sm font-bold text-stone-900">Domaine institutionnel des emails</p>
          <p className="mt-0.5 text-xs leading-relaxed text-stone-500">
            Les emails des comptes enseignants doivent se terminer par ce domaine (un seul
            compte par enseignant, aucun doublon). Si votre établissement change de domaine,
            modifiez-le ici : les comptes existants restent valables, les nouvelles créations
            exigent le nouveau domaine.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={domainDraft}
            onChange={(e) => setDomainDraft(e.target.value.toLowerCase())}
            placeholder="@famso.u-sousse.tn"
            className="h-11 w-64"
            aria-label="Domaine institutionnel"
          />
          <Button
            className="h-11 bg-emerald-600 hover:bg-emerald-700"
            disabled={domainDraft === domain}
            onClick={async () => {
              await call(
                { action: 'set_email_domain', domain: domainDraft },
                'Domaine institutionnel enregistré.'
              )
              await load()
            }}
          >
            <Save className="mr-2 h-4 w-4" /> Enregistrer
          </Button>
        </div>
      </section>

      {/* Création manuelle */}
      <section className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4">
        <div>
          <p className="text-sm font-bold text-stone-900">Ajouter un compte enseignant</p>
          <p className="mt-0.5 text-xs leading-relaxed text-stone-500">
            Le mot de passe peut rester vide : un mot de passe lisible sera généré (vous pourrez
            l&apos;envoyer par email depuis l&apos;encadré vert). L&apos;enseignant(e) peut ensuite
            changer son mot de passe depuis l&apos;application (« Mon compte »).
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Prénom"
            className="h-11"
            aria-label="Prénom"
          />
          <Input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Nom"
            className="h-11"
            aria-label="Nom"
          />
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value.toLowerCase())}
            placeholder={`email${domain || '@domaine'}`}
            type="email"
            className="h-11 sm:col-span-2"
            aria-label="Email institutionnel"
          />
          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mot de passe (vide = généré)"
            className="h-11 sm:col-span-2"
            aria-label="Mot de passe (facultatif)"
          />
        </div>
        <Button
          className="h-11 bg-emerald-600 hover:bg-emerald-700"
          disabled={creating || firstName.trim().length < 2 || lastName.trim().length < 2 || !email.includes('@')}
          onClick={createAccount}
        >
          {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
          Créer le compte
        </Button>
      </section>

      {/* Import Excel */}
      <section className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4">
        <div>
          <p className="text-sm font-bold text-stone-900">Téléverser un fichier Excel de comptes</p>
          <p className="mt-0.5 text-xs leading-relaxed text-stone-500">
            Une ligne par enseignant, dans l&apos;ordre : <strong>Prénom · Nom · Email
            institutionnel · Mot de passe</strong>. La première ligne est ignorée si c&apos;est un
            en-tête (Prénom, Nom…). Les mots de passe vides sont générés automatiquement. Les
            emails déjà utilisés sont ignorés (rapport détaillé après import) : jamais de doublon.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700">
            {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            {importing ? 'Import en cours…' : 'Choisir le fichier Excel (.xlsx ou .csv)'}
            <input
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              disabled={importing}
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void importFile(f)
              }}
            />
          </label>
          <Button variant="outline" className="h-11 border-stone-300" onClick={downloadTemplate}>
            Télécharger le modèle Excel
          </Button>
        </div>
        {importResult && (
          <div className="space-y-2 rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm">
            <p className="font-semibold text-stone-800">
              {importResult.created} compte(s) créé(s) sur {importResult.total} ligne(s)
              {importResult.problems.length > 0 && ` · ${importResult.problems.length} ligne(s) ignorée(s)`}
            </p>
            {importResult.accounts.length > 0 && (
              <details open className="space-y-1">
                <summary className="cursor-pointer font-semibold text-emerald-800">
                  Mots de passe à communiquer ({importResult.accounts.length})
                </summary>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-stone-500">
                        <th className="py-1 pr-2">Enseignant</th>
                        <th className="py-1 pr-2">Email</th>
                        <th className="py-1">Mot de passe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importResult.accounts.map((a) => (
                        <tr key={a.email} className="border-t border-stone-200">
                          <td className="py-1 pr-2">{a.firstName} {a.lastName}</td>
                          <td className="py-1 pr-2">{a.email}</td>
                          <td className="py-1 font-mono font-bold select-all">{a.password}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-stone-500">
                  Ces mots de passe ne seront plus visibles après fermeture : envoyez-les par
                  email maintenant (colonne copiable d&apos;un clic).
                </p>
              </details>
            )}
            {importResult.problems.length > 0 && (
              <details className="space-y-1">
                <summary className="cursor-pointer font-semibold text-amber-700">
                  Lignes ignorées ({importResult.problems.length})
                </summary>
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-stone-600">
                  {importResult.problems.map((p, i) => (
                    <li key={i}>
                      Ligne {p.line} {p.email ? `(${p.email})` : ''} — {p.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </section>

      {/* Liste des comptes */}
      <section className="space-y-3">
        <p className="text-sm text-stone-600">
          {rows.length} compte(s) enseignant(s) — connexion obligatoire pour ouvrir des séances.
        </p>
        {rows.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 p-8 text-center text-sm text-stone-500">
            Aucun compte enseignant pour le moment : créez-en un ci-dessus (ou importez le
            fichier Excel). Tant qu&apos;aucun compte n&apos;existe, personne ne peut créer de
            séance sur cette application.
          </p>
        ) : (
          <div className="space-y-3">
            {rows.map((a) => (
              <AccountCard key={a.id} row={a} call={call} onChanged={load} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function AccountCard({
  row,
  call,
  onChanged,
}: {
  row: AdminAccountRow
  call: CallFn
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [firstName, setFirstName] = useState(row.firstName)
  const [lastName, setLastName] = useState(row.lastName)
  const [email, setEmail] = useState(row.email)
  const [reveal, setReveal] = useState<string | null>(null)

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      {reveal !== null && (
        <div className="mb-3">
          <PasswordReveal
            firstName={row.firstName}
            lastName={row.lastName}
            email={row.email}
            password={reveal}
            onDone={() => {
              setReveal(null)
              onChanged()
            }}
          />
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[15px] font-semibold text-stone-900">
              {row.firstName} {row.lastName}
            </p>
            {row.forgotPending && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                mot de passe oublié — demande en attente
              </span>
            )}
            {row.lockedUntil && new Date(row.lockedUntil) > new Date() && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
                verrouillé (trop de tentatives)
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-stone-500">
            {row.email} · {row.sessions} séance(s) créée(s) · compte du {fmtDate(row.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {row.forgotPending && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 border-amber-300 text-amber-800 hover:bg-amber-50"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await call({ action: 'clear_forgot', id: row.id })
                setBusy(false)
                onChanged()
              }}
              title="Marquer la demande comme traitée (badge ambre)"
            >
              Marquer la demande vue
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-9 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              const res = await call({ action: 'reset_account_password', id: row.id })
              setBusy(false)
              if (res && typeof res.password === 'string') {
                setReveal(res.password)
              }
            }}
            title="Générer un nouveau mot de passe (l'ancien ne fonctionne plus, les sessions ouvertes sont déconnectées)"
          >
            <KeyRound className="mr-1 h-3.5 w-3.5" />
            {row.forgotPending ? 'Nouveau mot de passe' : 'Réinitialiser'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 border-stone-300"
            disabled={busy}
            onClick={() => setEditing((v) => !v)}
          >
            Modifier
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-red-600 hover:bg-red-50"
            disabled={busy}
            onClick={async () => {
              if (
                window.confirm(
                  `Supprimer le compte de ${row.firstName} ${row.lastName} ?\n\nSes séances restent intactes et utilisables (code + PIN) : seule la propriété est retirée. Cette action est définitive.`
                )
              ) {
                setBusy(true)
                await call({ action: 'delete_account', id: row.id }, 'Compte supprimé.')
                setBusy(false)
                onChanged()
              }
            }}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" /> Supprimer
          </Button>
        </div>
      </div>
      {editing && (
        <div className="mt-3 grid gap-2 border-t border-stone-100 pt-3 sm:grid-cols-3">
          <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Prénom" className="h-10" aria-label="Prénom" />
          <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Nom" className="h-10" aria-label="Nom" />
          <Input value={email} onChange={(e) => setEmail(e.target.value.toLowerCase())} placeholder="Email institutionnel" className="h-10" aria-label="Email" />
          <div className="sm:col-span-3">
            <Button
              className="h-10 bg-emerald-600 hover:bg-emerald-700"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                const res = await call({ action: 'update_account', id: row.id, firstName, lastName, email })
                setBusy(false)
                if (res) setEditing(false)
                onChanged()
              }}
            >
              <Save className="mr-2 h-4 w-4" /> Enregistrer les modifications
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------- v3.0.0 : onglet Apparence ----------------

const ICON_LABELS: Record<string, string> = {
  GraduationCap: 'Toge de diplômé',
  BookOpen: 'Livre ouvert',
  HeartPulse: 'Battement de cœur',
  Stethoscope: 'Stéthoscope',
  FlaskConical: 'Fiole de laboratoire',
  University: 'Université',
  Lightbulb: 'Ampoule',
  Sparkles: 'Étincelles',
  Presentation: 'Présentation au tableau',
  UserRound: 'Personne',
  ClipboardCheck: 'Liste de contrôle',
  PenLine: 'Stylo',
  Users: 'Groupe',
  UsersRound: 'Groupe (rond)',
  Smile: 'Sourire',
}

function AppearanceTab({
  theme,
  call,
}: {
  theme: ThemeConfig
  call: CallFn
}) {
  const [draft, setDraft] = useState<ThemeConfig>({ ...theme })
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(true)

  const update = (patch: Partial<ThemeConfig>) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    setSaved(false)
    // Aperçu immédiat : les couleurs s'appliquent à l'instant (et
    // disparaissent au rechargement tant que ce n'est pas enregistré).
    import('@/lib/theme-client').then((m) => m.applyTheme(next))
  }

  const iconChoice = (kind: ThemeIconKind, choices: readonly string[], label: string) => (
    <div className="space-y-1">
      <Label className="text-xs font-semibold text-stone-700">{label}</Label>
      <select
        value={draft.icons?.[kind] ?? ''}
        onChange={(e) =>
          update({
            icons: { ...draft.icons, [kind]: e.target.value || undefined },
          })
        }
        className="h-11 w-full rounded-xl border border-stone-300 bg-white px-3 text-sm"
      >
        <option value="">Icône d&apos;origine</option>
        {choices.map((c) => (
          <option key={c} value={c}>
            {ICON_LABELS[c] ?? c}
          </option>
        ))}
      </select>
    </div>
  )

  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4">
        <div>
          <p className="text-sm font-bold text-stone-900">Couleurs et icônes de l&apos;application</p>
          <p className="mt-0.5 text-xs leading-relaxed text-stone-500">
            La couleur principale colore boutons, liens et en-têtes ; la couleur d&apos;accent,
            la rubrique étudiante ; le fond teinte toutes les pages. L&apos;aperçu est immédiat
            sur CETTE page et l&apos;application — enregistrez pour l&apos;appliquer à tous les
            appareils à leur prochaine ouverture. Le fond doit rester clair (texte sombre
            dessous).
          </p>
        </div>

        {/* Palettes prêtes à l'emploi */}
        <div className="flex flex-wrap gap-2">
          {THEME_PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => update({ ...p.theme, icons: draft.icons })}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-stone-300 px-3 text-sm font-medium text-stone-700 hover:border-emerald-400 hover:bg-emerald-50"
            >
              {p.theme.primary && (
                <span
                  className="h-4 w-4 rounded-full border border-stone-300"
                  style={{ backgroundColor: p.theme.primary }}
                />
              )}
              {p.name}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-xs font-semibold text-stone-700">Couleur principale</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={draft.primary ?? '#059669'}
                onChange={(e) => update({ primary: e.target.value })}
                className="h-11 w-14 cursor-pointer rounded-xl border border-stone-300 bg-white p-1"
                aria-label="Couleur principale"
              />
              {draft.primary && (
                <button
                  type="button"
                  className="text-xs font-semibold text-stone-400 hover:text-stone-700"
                  onClick={() => update({ primary: undefined })}
                >
                  origine
                </button>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-semibold text-stone-700">Couleur d&apos;accent (étudiants)</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={draft.accent ?? '#d97706'}
                onChange={(e) => update({ accent: e.target.value })}
                className="h-11 w-14 cursor-pointer rounded-xl border border-stone-300 bg-white p-1"
                aria-label="Couleur d'accent"
              />
              {draft.accent && (
                <button
                  type="button"
                  className="text-xs font-semibold text-stone-400 hover:text-stone-700"
                  onClick={() => update({ accent: undefined })}
                >
                  origine
                </button>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-semibold text-stone-700">Fond des pages</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={draft.background ?? '#fafaf9'}
                onChange={(e) => update({ background: e.target.value })}
                className="h-11 w-14 cursor-pointer rounded-xl border border-stone-300 bg-white p-1"
                aria-label="Fond des pages"
              />
              {draft.background && (
                <button
                  type="button"
                  className="text-xs font-semibold text-stone-400 hover:text-stone-700"
                  onClick={() => update({ background: undefined })}
                >
                  origine
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {iconChoice('logo', THEME_ICON_CHOICES.logo, 'Icône du logo (en-tête)')}
          {iconChoice('teacher', THEME_ICON_CHOICES.teacher, 'Icône de la carte enseignant')}
          {iconChoice('student', THEME_ICON_CHOICES.student, 'Icône de la carte étudiant')}
        </div>

        {/* Aperçu */}
        <div className="grid gap-3 rounded-2xl border border-stone-200 p-4 sm:grid-cols-2">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
              {(() => {
                const I = themeIcon('teacher', draft.icons?.teacher)
                return <I className="h-5 w-5" />
              })()}
            </span>
            <span className="rounded-2xl border-2 border-stone-200 bg-white p-3 text-sm font-bold">
              Je suis enseignant
            </span>
            <Button size="sm" className="h-9 bg-emerald-600 hover:bg-emerald-700">
              Bouton principal
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              {(() => {
                const I = themeIcon('student', draft.icons?.student)
                return <I className="h-5 w-5" />
              })()}
            </span>
            <span className="rounded-2xl border-2 border-stone-200 bg-white p-3 text-sm font-bold">
              Je suis étudiant
            </span>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
              Badge accent
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            className="h-11 bg-emerald-600 hover:bg-emerald-700"
            disabled={busy || saved}
            onClick={async () => {
              setBusy(true)
              await call({ action: 'set_theme', theme: draft }, 'Apparence enregistrée — visible par tous à la prochaine ouverture.')
              setBusy(false)
              setSaved(true)
              await reloadAppConfig()
            }}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Enregistrer l&apos;apparence
          </Button>
          <Button
            variant="outline"
            className="h-11 border-stone-300"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await call({ action: 'reset_theme' }, 'Apparence réinitialisée (thème d\u2019origine).')
              setDraft({})
              setSaved(true)
              setBusy(false)
              import('@/lib/theme-client').then((m) => m.applyTheme({}))
              await reloadAppConfig()
            }}
          >
            <RotateCcw className="mr-2 h-4 w-4" /> Réinitialiser
          </Button>
          {!saved && (
            <span className="text-xs text-amber-700">
              Modifications non enregistrées (aperçu local uniquement).
            </span>
          )}
        </div>
      </section>
    </div>
  )
}
