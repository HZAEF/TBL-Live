'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, KeyRound, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { api, getLastStudentSession, saveStudentSession, removeStudentSession } from '@/lib/tbl-client'
import type { PublicSessionDTO } from '@/lib/tbl-types'
import { StudentSession } from './student-session'

export function StudentPanel({ onExit }: { onExit: () => void }) {
  const [token, setToken] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)

  // Reprise automatique : dernier étudiant connecté sur cet appareil
  useEffect(() => {
    let alive = true
    const last = getLastStudentSession()
    if (last) {
      api<{ me: { name: string } }>(`/api/student?token=${encodeURIComponent(last.token)}`)
        .then(() => alive && setToken(last.token))
        .catch(() => alive && removeStudentSession(last.code))
        .finally(() => alive && setChecking(false))
    } else {
      Promise.resolve().then(() => alive && setChecking(false))
    }
    return () => {
      alive = false
    }
  }, [])

  if (checking) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600" />
      </div>
    )
  }

  if (token) {
    return (
      <StudentSession
        token={token}
        onLeave={() => {
          setToken(null)
        }}
        onExit={onExit}
      />
    )
  }

  return <JoinForm onJoined={(t) => setToken(t)} onExit={onExit} />
}

function JoinForm({
  onJoined,
  onExit,
}: {
  onJoined: (token: string) => void
  onExit: () => void
}) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [teamId, setTeamId] = useState<string>('auto')
  const [sessionInfo, setSessionInfo] = useState<PublicSessionDTO | null>(null)
  const [codeError, setCodeError] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // Écran « notez votre code de reprise » après une première connexion
  const [welcome, setWelcome] = useState<{ token: string; recoveryCode: string } | null>(null)

  // Dès que le code est complet, on cherche la séance
  useEffect(() => {
    if (code.length !== 6) {
      setSessionInfo(null)
      setCodeError('')
      return
    }
    let alive = true
    const t = setTimeout(async () => {
      try {
        const info = await api<PublicSessionDTO>(`/api/sessions/${code}`)
        if (alive) {
          setSessionInfo(info)
          setCodeError('')
        }
      } catch (e) {
        if (alive) {
          setSessionInfo(null)
          setCodeError(e instanceof Error ? e.message : 'Séance introuvable.')
        }
      }
    }, 400)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [code])

  const submit = async () => {
    if (code.length !== 6) {
      setError('Saisissez le code à 6 caractères donné par votre professeur.')
      return
    }
    if (name.trim().length < 2) {
      setError('Saisissez votre nom (au moins 2 caractères).')
      return
    }
    setError('')
    setLoading(true)
    try {
      const res = await api<{
        token: string
        name: string
        teamId: string | null
        title: string
        recoveryCode: string
        isNew: boolean
      }>('/api/join', {
        method: 'POST',
        body: JSON.stringify({
          code,
          name: name.trim(),
          teamId: teamId === 'auto' ? null : teamId,
          recoveryCode: recoveryCode.trim() || undefined,
        }),
      })
      const teamName =
        sessionInfo?.teams.find((t) => t.id === res.teamId)?.name ?? undefined
      saveStudentSession({
        code,
        token: res.token,
        name: res.name,
        teamName,
        savedAt: Date.now(),
      })
      // Première connexion : on montre le code de reprise AVANT d'entrer,
      // pour que l'étudiant le note (sinon il ne le cherchera qu'une fois
      // bloqué, trop tard).
      if (res.isNew) {
        setWelcome({ token: res.token, recoveryCode: res.recoveryCode })
      } else {
        onJoined(res.token)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue.')
    } finally {
      setLoading(false)
    }
  }

  // Écran intermédiaire : affichage du code de reprise
  if (welcome) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <div className="rounded-2xl border-2 border-emerald-300 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <KeyRound className="h-6 w-6" />
          </div>
          <h2 className="mt-3 text-xl font-bold text-stone-900">Bienvenue !</h2>
          <p className="mt-1 text-sm text-stone-600">
            Notez précieusement votre <b>code de reprise personnel</b> — il vous
            permettra de retrouver votre séance si vous changez d&apos;appareil ou
            perdez la connexion :
          </p>
          <p className="mt-4 select-all rounded-xl bg-stone-900 px-4 py-3 font-mono text-2xl font-bold tracking-[0.35em] text-emerald-300">
            {welcome.recoveryCode}
          </p>
          <p className="mt-3 text-xs text-stone-500">
            Vous pourrez aussi le revoir dans la séance (bouton « code » en haut
            de l&apos;écran) ou le demander à votre professeur.
          </p>
          <Button
            onClick={() => onJoined(welcome.token)}
            className="mt-5 h-12 w-full bg-emerald-600 text-base hover:bg-emerald-700"
          >
            J&apos;ai noté mon code — entrer dans la séance
          </Button>
        </div>
        <Button variant="ghost" onClick={onExit} className="w-full text-stone-500">
          <LogOut className="mr-1 h-4 w-4" />
          Retour à l&apos;accueil
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-stone-900">Rejoindre la séance</h1>
        <p className="mt-1 text-sm text-stone-600">
          Entrez le code affiché au tableau par votre professeur.
        </p>
      </div>

      <div className="space-y-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <div>
          <Label htmlFor="s-code">Code de la séance</Label>
          <Input
            id="s-code"
            value={code}
            onChange={(e) =>
              setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))
            }
            inputMode="text"
            autoCapitalize="characters"
            placeholder="AB3XK9"
            className="mt-1.5 h-14 text-center font-mono text-2xl font-bold tracking-[0.3em]"
          />
          {codeError && <p className="mt-1.5 text-sm text-red-600">{codeError}</p>}
        </div>

        {sessionInfo && (
          <>
            <div className="rounded-xl bg-emerald-50 p-3 text-center">
              <p className="text-sm font-semibold text-emerald-800">{sessionInfo.title}</p>
              <p className="text-xs text-emerald-700">
                {sessionInfo.studentCount} étudiant(s) déjà inscrit(s)
              </p>
            </div>

            <div>
              <Label htmlFor="s-name">Votre nom</Label>
              <Input
                id="s-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Prénom + nom de famille"
                className="mt-1.5 h-12 text-base"
                autoCapitalize="words"
              />
              <p className="mt-1 text-xs text-stone-500">
                Mettez votre prénom ET votre nom de famille : deux élèves au même
                prénom doivent se différencier.
              </p>
            </div>

            <div>
              <Label htmlFor="s-recovery">
                Code de reprise <span className="font-normal text-stone-400">(si vous reprenez votre séance)</span>
              </Label>
              <Input
                id="s-recovery"
                value={recoveryCode}
                onChange={(e) =>
                  setRecoveryCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))
                }
                placeholder="Ex. 7KQ2MP — uniquement si vous êtes déjà inscrit"
                className="mt-1.5 h-11 font-mono tracking-widest"
                autoCapitalize="characters"
              />
              <p className="mt-1 text-xs text-stone-500">
                Première connexion ? Laissez vide. Vous changez d&apos;appareil ? Entrez le code
                reçu lors de votre première connexion (ou demandez-le au professeur).
              </p>
            </div>

            {sessionInfo.teams.length > 0 && (
              <div>
                <Label>Votre équipe</Label>
                <Select value={teamId} onValueChange={setTeamId}>
                  <SelectTrigger className="mt-1.5 h-12 text-base">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">
                      🎲 Placement automatique (équipe la moins remplie)
                    </SelectItem>
                    {sessionInfo.teams.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </>
        )}

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <Button
          onClick={submit}
          disabled={loading || !sessionInfo}
          className="h-12 w-full bg-emerald-600 text-base hover:bg-emerald-700"
        >
          {loading ? 'Connexion…' : 'Rejoindre la séance'}
          <ArrowRight className="ml-2 h-5 w-5" />
        </Button>

        <p className="text-center text-xs text-stone-500">
          Si vous changez de téléphone en cours de séance : même code de séance, même nom, et votre
          code de reprise — vous retrouvez alors toutes vos réponses.
        </p>
      </div>

      <Button variant="ghost" onClick={onExit} className="w-full text-stone-500">
        <LogOut className="mr-1 h-4 w-4" />
        Retour à l&apos;accueil
      </Button>
    </div>
  )
}
