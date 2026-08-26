'use client'

import { useState } from 'react'
import { Plus, LogIn, ChevronRight, Trash2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  api,
  getTeacherSessions,
  removeTeacherSession,
  saveTeacherSession,
  type StoredTeacherSession,
} from '@/lib/tbl-client'
import { exampleQuestions, emptyQuestion, QuestionEditor } from './question-editor'
import { TeacherDashboard } from './teacher-dashboard'
import type { DraftQuestion } from '@/lib/tbl-types'
import { useToast } from '@/hooks/use-toast'

type View = 'menu' | 'create' | 'login' | 'dashboard'

export function TeacherPanel({ onExit }: { onExit: () => void }) {
  const [view, setView] = useState<View>('menu')
  const [session, setSession] = useState<{ code: string; token: string } | null>(null)
  const [loginCode, setLoginCode] = useState('')
  const { toast } = useToast()

  const openDashboard = (code: string, token: string, title?: string) => {
    saveTeacherSession({ code, token, title: title || 'Séance', savedAt: Date.now() })
    setSession({ code, token })
    setView('dashboard')
  }

  if (view === 'dashboard' && session) {
    return (
      <TeacherDashboard
        code={session.code}
        token={session.token}
        onExit={() => setView('menu')}
        onAuthError={() => {
          toast({
            title: 'Session expirée',
            description: 'Reconnectez-vous avec le code de la séance et votre PIN.',
          })
          setLoginCode(session.code)
          setSession(null)
          setView('login')
        }}
      />
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {view === 'menu' && (
        <TeacherMenu
          onExit={onExit}
          onCreate={() => setView('create')}
          onLogin={() => setView('login')}
          onOpen={(code) => {
            const saved = getTeacherSessions()[code]
            if (saved) openDashboard(saved.code, saved.token, saved.title)
          }}
        />
      )}

      {view === 'create' && (
        <CreateSessionForm
          onCancel={() => setView('menu')}
          onCreated={(code, token, title) => openDashboard(code, token, title)}
        />
      )}

      {view === 'login' && (
        <LoginForm
          initialCode={loginCode}
          onCancel={() => setView('menu')}
          onLoggedIn={(code, token) => openDashboard(code, token)}
        />
      )}
    </div>
  )
}

// ---------------- Menu enseignant ----------------

function TeacherMenu({
  onCreate,
  onLogin,
  onOpen,
  onExit,
}: {
  onCreate: () => void
  onLogin: () => void
  onOpen: (code: string) => void
  onExit: () => void
}) {
  const saved = Object.values(getTeacherSessions()).sort((a, b) => b.savedAt - a.savedAt)
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <button
          onClick={onCreate}
          className="flex flex-col items-start gap-3 rounded-2xl border-2 border-stone-200 bg-white p-6 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-500 hover:shadow-lg"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
            <Plus className="h-5 w-5" />
          </span>
          <span>
            <span className="block font-bold text-stone-900">Créer une nouvelle séance</span>
            <span className="mt-1 block text-sm leading-relaxed text-stone-600">
              Composez vos questions et obtenez un code à 6 caractères pour vos étudiants.
            </span>
          </span>
        </button>

        <button
          onClick={onLogin}
          className="flex flex-col items-start gap-3 rounded-2xl border-2 border-stone-200 bg-white p-6 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-amber-500 hover:shadow-lg"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <LogIn className="h-5 w-5" />
          </span>
          <span>
            <span className="block font-bold text-stone-900">Reprendre une séance</span>
            <span className="mt-1 block text-sm leading-relaxed text-stone-600">
              Vous avez déjà une séance ? Retrouvez-la avec son code et votre PIN.
            </span>
          </span>
        </button>
      </div>

      {saved.length > 0 && (
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <p className="mb-3 text-sm font-bold text-stone-800">Mes séances sur cet appareil</p>
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {saved.map((s) => (
              <SavedSessionRow key={s.code} session={s} onOpen={() => onOpen(s.code)} />
            ))}
          </div>
          <p className="mt-3 text-xs text-stone-500">
            Ces liens restent valables même après avoir fermé votre navigateur.
          </p>
        </div>
      )}

      <Button variant="ghost" onClick={onExit} className="text-stone-500">
        Retour à l&apos;accueil
      </Button>
    </div>
  )
}

function SavedSessionRow({
  session,
  onOpen,
}: {
  session: StoredTeacherSession
  onOpen: () => void
}) {
  const [deleted, setDeleted] = useState(false)
  if (deleted) return null
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-stone-200 px-3 py-2.5 hover:bg-stone-50">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-stone-800">{session.title}</p>
        <p className="font-mono text-xs tracking-wider text-stone-500">{session.code}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 text-stone-300 hover:bg-red-50 hover:text-red-600"
          onClick={() => {
            removeTeacherSession(session.code)
            setDeleted(true)
          }}
          aria-label="Oublier cette séance"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        <Button size="sm" className="h-9 bg-emerald-600 hover:bg-emerald-700" onClick={onOpen}>
          Ouvrir
          <ChevronRight className="ml-0.5 h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// ---------------- Création de séance ----------------

function validateDrafts(drafts: DraftQuestion[]): Record<number, string[]> {
  const errors: Record<number, string[]> = {}
  drafts.forEach((q, i) => {
    const errs: string[] = []
    if (!q.text.trim()) errs.push('text: L\u2019énoncé est obligatoire.')
    const filled = q.choices.filter((c) => c.trim())
    if (filled.length < 2) errs.push('choices: Au moins 2 choix doivent être remplis.')
    if (filled.length >= 2 && !q.choices[q.correct]?.trim())
      errs.push('correct: La bonne réponse cochée doit être un choix rempli.')
    if (errs.length) errors[i] = errs
  })
  return errors
}

function CreateSessionForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void
  onCreated: (code: string, token: string, title: string) => void
}) {
  const [title, setTitle] = useState('')
  const [pin, setPin] = useState('')
  const [teamCount, setTeamCount] = useState(6)
  const [iratMinutes, setIratMinutes] = useState(10)
  const [questions, setQuestions] = useState<DraftQuestion[]>([emptyQuestion()])
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<number, string[]>>({})
  const [globalError, setGlobalError] = useState('')
  const { toast } = useToast()

  const submit = async () => {
    const qErrors = validateDrafts(questions)
    setErrors(qErrors)
    if (Object.keys(qErrors).length > 0) {
      setGlobalError(
        'Certaines questions sont incomplètes. Complétez-les ou supprimez-les avant de créer la séance.'
      )
      return
    }
    if (title.trim().length < 3) {
      setGlobalError('Donnez un titre à votre séance (au moins 3 caractères).')
      return
    }
    if (!/^\d{4}$/.test(pin)) {
      setGlobalError('Le code PIN doit contenir exactement 4 chiffres.')
      return
    }
    setGlobalError('')
    setSubmitting(true)
    try {
      const res = await api<{ code: string; teacherToken: string }>('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          pin,
          teamCount,
          iratMinutes,
          questions: questions.map((q) => ({
            text: q.text.trim(),
            choices: q.choices.filter((c) => c.trim()),
            correct: q.correct,
            phase: q.phase,
          })),
        }),
      })
      toast({
        title: 'Séance créée !',
        description: `Code pour vos étudiants : ${res.code}`,
      })
      onCreated(res.code, res.teacherToken, title.trim())
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : 'Erreur inconnue.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-stone-900">Créer une séance TBL</h2>
        <p className="mt-1 text-sm text-stone-600">
          Remplissez les informations générales, puis composez vos questions.
        </p>
      </div>

      <div className="space-y-4 rounded-2xl border border-stone-200 bg-white p-5">
        <div>
          <Label htmlFor="title">Titre de la séance *</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex. Introduction à la photosynthèse — Séance 3"
            className="mt-1.5 h-11"
          />
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="pin">Code PIN (4 chiffres) *</Label>
            <Input
              id="pin"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric"
              placeholder="1234"
              className="mt-1.5 h-11 font-mono tracking-widest"
            />
            <p className="mt-1 text-xs text-stone-500">Pour reprendre la séance plus tard.</p>
          </div>
          <div>
            <Label htmlFor="teams">Nombre d&apos;équipes</Label>
            <Input
              id="teams"
              type="number"
              min={1}
              max={12}
              value={teamCount}
              onChange={(e) =>
                setTeamCount(Math.min(12, Math.max(1, Number(e.target.value) || 1)))
              }
              className="mt-1.5 h-11"
            />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <Label htmlFor="minutes">Durée iRAT (minutes)</Label>
            <Input
              id="minutes"
              type="number"
              min={1}
              max={90}
              value={iratMinutes}
              onChange={(e) =>
                setIratMinutes(Math.min(90, Math.max(1, Number(e.target.value) || 1)))
              }
              className="mt-1.5 h-11"
            />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-stone-900">Questions ({questions.length})</h3>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-amber-300 text-amber-700 hover:bg-amber-50"
              onClick={() => {
                setQuestions(exampleQuestions())
                setErrors({})
              }}
            >
              <Sparkles className="mr-1 h-3.5 w-3.5" />
              Charger l&apos;exemple
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-stone-300"
              onClick={() => setQuestions([...questions, emptyQuestion()])}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Question
            </Button>
          </div>
        </div>

        {questions.map((q, i) => (
          <QuestionEditor
            key={i}
            index={i}
            value={q}
            errors={errors[i]}
            onChange={(nq) => {
              const next = [...questions]
              next[i] = nq
              setQuestions(next)
            }}
            onDelete={
              questions.length > 1
                ? () => setQuestions(questions.filter((_, idx) => idx !== i))
                : undefined
            }
          />
        ))}

        <p className="text-xs leading-relaxed text-stone-500">
          Astuce : les questions « iRAT / tRAT » servent à vérifier la préparation (test individuel
          puis test en équipe). Les questions « Application » sont des problèmes plus complexes
          résolus en équipe avec révélation simultanée des réponses.
        </p>
      </div>

      {globalError && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {globalError}
        </p>
      )}

      <div className="flex gap-3 pb-4">
        <Button variant="outline" onClick={onCancel} className="h-12 flex-1 border-stone-300">
          Annuler
        </Button>
        <Button
          onClick={submit}
          disabled={submitting}
          className="h-12 flex-[2] bg-emerald-600 text-base hover:bg-emerald-700"
        >
          {submitting ? 'Création…' : 'Créer la séance'}
        </Button>
      </div>
    </div>
  )
}

// ---------------- Connexion (reprise) ----------------

function LoginForm({
  initialCode,
  onCancel,
  onLoggedIn,
}: {
  initialCode?: string
  onCancel: () => void
  onLoggedIn: (code: string, token: string) => void
}) {
  const [code, setCode] = useState(initialCode || '')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (!/^[A-Z0-9]{6}$/.test(code.toUpperCase())) {
      setError('Le code de la séance contient 6 caractères.')
      return
    }
    if (!/^\d{4}$/.test(pin)) {
      setError('Le code PIN contient 4 chiffres.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const res = await api<{ code: string; teacherToken: string }>(
        `/api/sessions/${code.toUpperCase()}/teacher`,
        { method: 'POST', body: JSON.stringify({ pin }) }
      )
      onLoggedIn(res.code, res.teacherToken)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div>
        <h2 className="text-xl font-bold text-stone-900">Reprendre une séance</h2>
        <p className="mt-1 text-sm text-stone-600">
          Saisissez le code de la séance et votre code PIN enseignant.
        </p>
      </div>
      <div className="space-y-4 rounded-2xl border border-stone-200 bg-white p-5">
        <div>
          <Label htmlFor="login-code">Code de la séance</Label>
          <Input
            id="login-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
            placeholder="AB3XK9"
            className="mt-1.5 h-12 text-center font-mono text-lg tracking-[0.3em]"
          />
        </div>
        <div>
          <Label htmlFor="login-pin">Code PIN enseignant</Label>
          <Input
            id="login-pin"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            inputMode="numeric"
            placeholder="1234"
            className="mt-1.5 h-12 text-center font-mono text-lg tracking-[0.3em]"
          />
        </div>
        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex gap-3">
          <Button variant="outline" onClick={onCancel} className="h-12 flex-1 border-stone-300">
            Retour
          </Button>
          <Button
            onClick={submit}
            disabled={loading}
            className="h-12 flex-[2] bg-emerald-600 hover:bg-emerald-700"
          >
            {loading ? 'Connexion…' : 'Ouvrir le tableau de bord'}
          </Button>
        </div>
      </div>
    </div>
  )
}
