'use client'

// ============================================================
// TBL Live v3.0.0 — Connexion du compte enseignant
//
// Ouvrir des séances TBL (créer, reprendre, téléverser) exige un
// COMPTE enseignant : email institutionnel + mot de passe, comptes
// créés par l'ADMINISTRATEUR dans /admin → Comptes (saisie manuelle
// ou fichier Excel). Les étudiants, eux, rejoignent librement avec
// le code de la séance.
//
// Ce composant fournit :
//  - useTeacherAuth() : suis-je connecté ? (une requête au montage,
//    puis l'état vit dans le composant appelant) ;
//  - TeacherLoginGate : formulaire (email + mot de passe, mot de
//    passe oublié → l'administrateur reçoit une demande) ;
//  - TeacherAccountBar : barre « Bonjour Prénom Nom » + changement
//    de mot de passe + déconnexion.
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import {
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Lock,
  Mail,
  ShieldQuestion,
  UserRound,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/tbl-client'
import { useI18n } from '@/lib/i18n'
import { useToast } from '@/hooks/use-toast'

export interface TeacherIdentity {
  id: string
  firstName: string
  lastName: string
  email: string
}

interface AuthState {
  authenticated: boolean
  teacher: TeacherIdentity | null
}

/** Vérifie la connexion du compte enseignant (cookie de session). */
export async function checkTeacherAuth(): Promise<AuthState> {
  try {
    return await api<AuthState>('/api/teacher-auth')
  } catch {
    return { authenticated: false, teacher: null }
  }
}

// ---------------- Porte de connexion ----------------

export function TeacherLoginGate({ onLoggedIn }: { onLoggedIn: (t: TeacherIdentity) => void }) {
  const { t } = useI18n()
  const { toast } = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [forgotMode, setForgotMode] = useState(false)
  const [forgotDone, setForgotDone] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await api('/api/teacher-auth', {
        method: 'POST',
        body: JSON.stringify({ action: 'login', email, password }),
      })
      const state = await checkTeacherAuth()
      if (state.authenticated && state.teacher) {
        toast({
          title: t('Bienvenue, {prénom} !', { prénom: state.teacher.firstName }),
          description: t('Vous pouvez créer, reprendre et téléverser vos séances TBL.'),
        })
        onLoggedIn(state.teacher)
      } else {
        setError(t('Connexion impossible. Réessayez.'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Erreur inconnue.'))
    } finally {
      setBusy(false)
    }
  }

  const submitForgot = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await api('/api/teacher-auth', {
        method: 'POST',
        body: JSON.stringify({ action: 'forgot_password', email }),
      })
      setForgotDone(true)
    } catch {
      setForgotDone(true) // même réponse : aucune sonde d'adresses
    } finally {
      setBusy(false)
    }
  }

  if (forgotMode) {
    return (
      <form
        onSubmit={submitForgot}
        className="mx-auto max-w-md space-y-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <ShieldQuestion className="h-5 w-5" />
          </span>
          <div>
            <p className="font-bold text-stone-900">{t('Mot de passe oublié')}</p>
            <p className="text-sm text-stone-600">
              {t('Prévenez l’administrateur : il vous enverra un nouveau mot de passe.')}
            </p>
          </div>
        </div>
        {forgotDone ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            {t(
              'Demande envoyée. Prévenez votre administrateur : il vous enverra un nouveau mot de passe par email.'
            )}
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="forgot-email">{t('Email institutionnel')}</Label>
              <Input
                id="forgot-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="prenom.nom@famso.u-sousse.tn"
                className="h-12"
              />
            </div>
            <Button type="submit" disabled={busy} className="h-12 w-full bg-emerald-600 hover:bg-emerald-700">
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
              {t('Prévenir l’administrateur')}
            </Button>
          </>
        )}
        <Button type="button" variant="outline" className="h-11 w-full" onClick={() => setForgotMode(false)}>
          {t('Retour à la connexion')}
        </Button>
      </form>
    )
  }

  return (
    <form
      onSubmit={submit}
      className="mx-auto max-w-md space-y-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
          <Lock className="h-5 w-5" />
        </span>
        <div>
          <p className="font-bold text-stone-900">{t('Connexion enseignant')}</p>
          <p className="text-sm text-stone-600">
            {t('Votre email institutionnel et votre mot de passe (compte créé par l’administrateur).')}
          </p>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="login-email">{t('Email institutionnel')}</Label>
        <Input
          id="login-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="prenom.nom@famso.u-sousse.tn"
          className="h-12"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="login-password">{t('Mot de passe')}</Label>
        <Input
          id="login-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-12"
        />
      </div>
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}
      <Button type="submit" disabled={busy} className="h-12 w-full bg-emerald-600 hover:bg-emerald-700">
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
        {t('Se connecter')}
      </Button>
      <button
        type="button"
        onClick={() => setForgotMode(true)}
        className="w-full text-center text-sm font-medium text-stone-500 underline-offset-2 hover:text-stone-800 hover:underline"
      >
        {t('Mot de passe oublié ?')}
      </button>
      <p className="text-center text-xs leading-relaxed text-stone-500">
        {t(
          'Pas de compte ? Contactez l’administrateur de votre établissement : il crée les comptes enseignants (email institutionnel + mot de passe).'
        )}
      </p>
    </form>
  )
}

// ---------------- Barre de compte ----------------

export function TeacherAccountBar({
  teacher,
  onLoggedOut,
}: {
  teacher: TeacherIdentity
  onLoggedOut: () => void
}) {
  const { t } = useI18n()
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (next !== confirm) {
      setError(t('Les deux nouveaux mots de passe ne correspondent pas.'))
      return
    }
    setBusy(true)
    setError('')
    try {
      await api('/api/teacher-auth', {
        method: 'POST',
        body: JSON.stringify({ action: 'change_password', current, next }),
      })
      toast({
        title: t('Mot de passe modifié'),
        description: t('Utilisez le nouveau mot de passe à votre prochaine connexion.'),
      })
      setEditing(false)
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Erreur inconnue.'))
    } finally {
      setBusy(false)
    }
  }

  const logout = async () => {
    try {
      await api('/api/teacher-auth', {
        method: 'POST',
        body: JSON.stringify({ action: 'logout' }),
      })
    } catch {
      // déjà déconnecté : on continue
    }
    onLoggedOut()
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <UserRound className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-bold text-stone-900">
              {t('Bonjour, {prénom} {nom}', { prénom: teacher.firstName, nom: teacher.lastName })}
            </p>
            <p className="text-xs text-stone-500">{teacher.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditing((v) => !v)}
            className="h-9"
          >
            <KeyRound className="mr-1 h-3.5 w-3.5" />
            {t('Mon compte')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={logout} className="h-9">
            <LogOut className="mr-1 h-3.5 w-3.5" />
            {t('Se déconnecter')}
          </Button>
        </div>
      </div>
      {editing && (
        <form onSubmit={changePassword} className="mt-4 space-y-3 border-t border-stone-100 pt-4">
          <p className="text-sm font-semibold text-stone-800">{t('Changer mon mot de passe')}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="cur-pwd">{t('Mot de passe actuel')}</Label>
              <Input
                id="cur-pwd"
                type="password"
                required
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                className="h-10"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-pwd">{t('Nouveau mot de passe')}</Label>
              <Input
                id="new-pwd"
                type="password"
                required
                minLength={8}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                className="h-10"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="conf-pwd">{t('Confirmer')}</Label>
              <Input
                id="conf-pwd"
                type="password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="h-10"
              />
            </div>
          </div>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <Button type="submit" disabled={busy} className="h-10 bg-emerald-600 hover:bg-emerald-700">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('Enregistrer le nouveau mot de passe')}
          </Button>
        </form>
      )}
    </div>
  )
}

// ---------------- Hook de connexion ----------------

/** Vérifie la connexion au montage (une requête GET minuscule). */
export function useTeacherAuth(): {
  checking: boolean
  teacher: TeacherIdentity | null
  setTeacher: (t: TeacherIdentity | null) => void
  recheck: () => Promise<void>
} {
  const [checking, setChecking] = useState(true)
  const [teacher, setTeacher] = useState<TeacherIdentity | null>(null)
  const recheck = useCallback(async () => {
    const state = await checkTeacherAuth()
    setTeacher(state.teacher)
    setChecking(false)
  }, [])
  useEffect(() => {
    // Vérification initiale via continuation de promesse (le setState
    // arrive après l'attente réseau, jamais dans le corps synchrone de
    // l'effet — règle react-hooks/set-state-in-effect).
    Promise.resolve().then(recheck).catch(() => undefined)
  }, [recheck])
  return { checking, teacher, setTeacher, recheck }
}
