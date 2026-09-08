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
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/tbl-client'
import { reloadAppConfig } from '@/lib/app-config'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

// ---------------- Types locaux ----------------

interface AdminState {
  authenticated: boolean
  needsSetup: boolean
  syncIntervalMs: number
  textsCount: number
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
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-9 border-stone-300" onClick={load}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Actualiser
          </Button>
          {selected.size > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 border-red-300 text-red-700 hover:bg-red-50"
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
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Supprimer la sélection ({selected.size})
            </Button>
          )}
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
          </p>

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
