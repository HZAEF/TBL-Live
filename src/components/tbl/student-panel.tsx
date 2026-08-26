'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, LogOut } from 'lucide-react'
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
  const [teamId, setTeamId] = useState<string>('auto')
  const [sessionInfo, setSessionInfo] = useState<PublicSessionDTO | null>(null)
  const [codeError, setCodeError] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
      const res = await api<{ token: string; name: string; teamId: string | null; title: string }>(
        '/api/join',
        {
          method: 'POST',
          body: JSON.stringify({
            code,
            name: name.trim(),
            teamId: teamId === 'auto' ? null : teamId,
          }),
        }
      )
      const teamName =
        sessionInfo?.teams.find((t) => t.id === res.teamId)?.name ?? undefined
      saveStudentSession({
        code,
        token: res.token,
        name: res.name,
        teamName,
        savedAt: Date.now(),
      })
      onJoined(res.token)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue.')
    } finally {
      setLoading(false)
    }
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
                placeholder="Prénom + première lettre du nom"
                className="mt-1.5 h-12 text-base"
                autoCapitalize="words"
              />
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
          Conseil : notez votre nom exact — si vous changez de téléphone, il vous permettra de
          retrouver votre session.
        </p>
      </div>

      <Button variant="ghost" onClick={onExit} className="w-full text-stone-500">
        <LogOut className="mr-1 h-4 w-4" />
        Retour à l&apos;accueil
      </Button>
    </div>
  )
}
