'use client'

import { useState } from 'react'
import {
  Plus,
  LogIn,
  ChevronRight,
  Trash2,
  Sparkles,
  Dices,
  ClipboardList,
  RotateCcw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  api,
  getTeacherSessions,
  removeTeacherSession,
  saveTeacherSession,
  type StoredTeacherSession,
} from '@/lib/tbl-client'
import { exampleContent, emptyQuestion, emptyCase, QuestionEditor } from './question-editor'
import { TeacherDashboard } from './teacher-dashboard'
import { suggestPin, type DraftCase, type DraftQuestion } from '@/lib/tbl-types'
import { DEFAULT_SAI_ITEMS, SAI_SUBSCALES, SAI_SUBSCALE_INFO, type SaiSubscale } from '@/lib/sai'
import { t, useI18n } from '@/lib/i18n'
import { useToast } from '@/hooks/use-toast'

type View = 'menu' | 'create' | 'login' | 'dashboard'

export function TeacherPanel({ onExit }: { onExit: () => void }) {
  const [view, setView] = useState<View>('menu')
  const [session, setSession] = useState<{ code: string; token: string } | null>(null)
  const [loginCode, setLoginCode] = useState('')
  const { toast } = useToast()
  const { t } = useI18n()

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
        onOpenSession={openDashboard}
        onAuthError={() => {
          toast({
            title: t('Session expirée'),
            description: t('Reconnectez-vous avec le code de la séance et votre PIN.'),
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
  const { t } = useI18n()
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
            <span className="block font-bold text-stone-900">{t('Créer une nouvelle séance')}</span>
            <span className="mt-1 block text-sm leading-relaxed text-stone-600">
              {t('Composez vos questions et obtenez un code à 6 caractères pour vos étudiants.')}
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
            <span className="block font-bold text-stone-900">{t('Reprendre une séance')}</span>
            <span className="mt-1 block text-sm leading-relaxed text-stone-600">
              {t('Vous avez déjà une séance ? Retrouvez-la avec son code et votre PIN.')}
            </span>
          </span>
        </button>
      </div>

      {saved.length > 0 && (
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <p className="mb-3 text-sm font-bold text-stone-800">{t('Mes séances sur cet appareil')}</p>
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {saved.map((s) => (
              <SavedSessionRow key={s.code} session={s} onOpen={() => onOpen(s.code)} />
            ))}
          </div>
          <p className="mt-3 text-xs text-stone-500">
            {t('Ces liens restent valables même après avoir fermé votre navigateur.')}
          </p>
        </div>
      )}

      <Button variant="ghost" onClick={onExit} className="text-stone-500">
        {t('Retour à l’accueil')}
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
  const { t } = useI18n()
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
          aria-label={t('Oublier cette séance')}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        <Button size="sm" className="h-9 bg-emerald-600 hover:bg-emerald-700" onClick={onOpen}>
          {t('Ouvrir')}
          <ChevronRight className="ml-0.5 h-4 w-4 rtl:rotate-180" />
        </Button>
      </div>
    </div>
  )
}

// ---------------- v2.6.0 : questionnaire de fin de séance (création) ----------------

/** Brouillon d'un item TBL-SAI dans le formulaire de création.
 *  key = clé i18n de l'item standard (null = ajouté par l'enseignant) ;
 *  custom = true dès que l'enseignant modifie le libellé (le texte
 *  personnalisé remplace alors la traduction, affiché tel quel). */
interface DraftSaiItem {
  key: string | null
  subscale: SaiSubscale
  reversed: boolean
  text: string
  custom: boolean
}

function SaiCustomizationSection({
  drafts,
  setDrafts,
  onRestore,
}: {
  drafts: DraftSaiItem[]
  setDrafts: (next: DraftSaiItem[]) => void
  onRestore: () => void
}) {
  const { t } = useI18n()
  const [newSubscale, setNewSubscale] = useState<SaiSubscale>('satisfaction')
  const [newText, setNewText] = useState('')
  const modified = drafts.some((d) => d.custom || d.key === null) || drafts.length !== DEFAULT_SAI_ITEMS.length

  const update = (i: number, patch: Partial<DraftSaiItem>) => {
    const next = [...drafts]
    next[i] = { ...next[i], ...patch }
    setDrafts(next)
  }

  return (
    <div className="space-y-3 rounded-2xl border-2 border-dashed border-stone-300 bg-stone-50/50 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-bold text-stone-800">
            <ClipboardList className="h-4 w-4 text-stone-500" />
            {t('Personnaliser le questionnaire de fin de séance')}
            {modified && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                {t('Questionnaire personnalisé : {n} items', { n: drafts.length })}
              </span>
            )}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-stone-500">
            {t(
              'Par défaut, le questionnaire standard TBL-SAI (33 items, Mennenga 2010) est proposé aux étudiants, traduit dans toutes les langues de l’application. Cliquez ici si vous souhaitez l’adapter avant de créer la séance.'
            )}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 shrink-0 border-stone-300 text-stone-600"
          onClick={onRestore}
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          {t('Restaurer le questionnaire standard')}
        </Button>
      </div>

      {SAI_SUBSCALES.map((sub) => {
        const items = drafts.map((d, i) => ({ d, i })).filter(({ d }) => d.subscale === sub)
        const info = SAI_SUBSCALE_INFO[sub]
        return (
          <section key={sub} className="space-y-2">
            <div className="rounded-xl bg-white px-3 py-2">
              <p className="text-xs font-bold text-stone-700">{t(info.labelKey)}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-stone-400">
                {t(info.descriptionKey)}
              </p>
            </div>
            {items.length === 0 && (
              <p className="rounded-xl border border-dashed border-stone-300 bg-white/60 p-2 text-center text-xs text-stone-400">
                {t('Aucun item dans cette sous-échelle.')}
              </p>
            )}
            {items.map(({ d, i }) => (
              <div key={i} className="flex items-start gap-2 rounded-xl bg-white p-2">
                <span className="mt-2 w-6 shrink-0 text-center font-mono text-[11px] text-stone-300">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Textarea
                    value={d.text}
                    onChange={(e) => update(i, { text: e.target.value, custom: true })}
                    rows={2}
                    maxLength={500}
                    className="resize-none border-stone-200 text-sm"
                  />
                  <label className="flex items-center gap-1.5 text-[11px] text-stone-500">
                    <input
                      type="checkbox"
                      checked={d.reversed}
                      onChange={(e) => update(i, { reversed: e.target.checked })}
                      className="h-3.5 w-3.5 accent-emerald-600"
                    />
                    {t('Item inversé (formulation négative)')}
                  </label>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-stone-300 hover:bg-red-50 hover:text-red-600"
                  aria-label={t('Supprimer cet item')}
                  onClick={() => setDrafts(drafts.filter((_, idx) => idx !== i))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </section>
        )
      })}

      {/* Ajout d'un item libre */}
      <div className="space-y-1.5 rounded-xl border border-dashed border-emerald-300 bg-white p-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={newSubscale}
            onChange={(e) => setNewSubscale(e.target.value as SaiSubscale)}
            className="h-8 rounded-lg border border-stone-200 bg-white px-2 text-xs text-stone-700"
            aria-label={t('Sous-échelle de l’item')}
          >
            {SAI_SUBSCALES.map((sub) => (
              <option key={sub} value={sub}>
                {t(SAI_SUBSCALE_INFO[sub].labelKey)}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 border-emerald-400 text-emerald-700 hover:bg-emerald-50"
            disabled={newText.trim().length < 3}
            onClick={() => {
              setDrafts([
                ...drafts,
                {
                  key: null,
                  subscale: newSubscale,
                  reversed: false,
                  text: newText.trim(),
                  custom: true,
                },
              ])
              setNewText('')
            }}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t('Ajouter un item')}
          </Button>
        </div>
        <Textarea
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder={t('Libellé de l’item')}
          className="resize-none border-stone-200 text-sm"
        />
      </div>
    </div>
  )
}

// ---------------- Création de séance ----------------

function validateDrafts(drafts: DraftQuestion[]): Record<number, string[]> {
  const errors: Record<number, string[]> = {}
  drafts.forEach((q, i) => {
    const errs: string[] = []
    if (!q.text.trim()) errs.push(t('text: L’énoncé est obligatoire.'))
    const filled = q.choices.filter((c) => c.trim())
    if (filled.length < 2) errs.push(t('choices: Au moins 2 choix doivent être remplis.'))
    if (filled.length >= 2 && !q.choices[q.correct]?.trim())
      errs.push(t('correct: La bonne réponse cochée doit être un choix rempli.'))
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
  // Questions de préparation (iRAT puis tRAT)
  const [questions, setQuestions] = useState<DraftQuestion[]>([emptyQuestion('rat')])
  // Cas cliniques d'application : énoncé + 3 à 5 QCU, affichés un par un
  const [cases, setCases] = useState<DraftCase[]>([])
  // v2.6.0 : questionnaire de fin de séance (TBL-SAI). Les 33 items
  // standard (multilingues) sont proposés par défaut ; l'enseignant peut
  // cliquer sur le bouton en bas de page pour les personnaliser.
  const [showSai, setShowSai] = useState(false)
  const [saiDrafts, setSaiDrafts] = useState<DraftSaiItem[]>(() =>
    DEFAULT_SAI_ITEMS.map((it) => ({
      key: it.key,
      subscale: it.subscale,
      reversed: it.reversed,
      text: '',
      custom: false,
    }))
  )
  const { toast } = useToast()
  const { t } = useI18n()
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<number, string[]>>({})
  const [caseErrors, setCaseErrors] = useState<Record<string, Record<number, string[]>>>({})
  const [globalError, setGlobalError] = useState('')

  const restoreSaiDefaults = () => {
    setSaiDrafts(
      DEFAULT_SAI_ITEMS.map((it) => ({
        key: it.key,
        subscale: it.subscale,
        reversed: it.reversed,
        text: '',
        custom: false,
      }))
    )
    toast({ title: t('Les 33 items standard sont restaurés.') })
  }

  const submit = async () => {
    const qErrors = validateDrafts(questions)
    setErrors(qErrors)
    const cErrors: Record<string, Record<number, string[]>> = {}
    let caseProblem = ''
    cases.forEach((c) => {
      if (!c.title.trim()) {
        caseProblem = t('Chaque cas clinique doit avoir un titre.')
      }
      const errs = validateDrafts(c.questions)
      if (Object.keys(errs).length > 0) cErrors[c.title || 'sans-titre'] = errs
    })
    setCaseErrors(cErrors)
    if (Object.keys(qErrors).length > 0 || Object.keys(cErrors).length > 0 || caseProblem) {
      setGlobalError(
        caseProblem ||
          t(
            'Certaines questions sont incomplètes. Complétez-les ou supprimez-les avant de créer la séance.'
          )
      )
      return
    }
    if (title.trim().length < 3) {
      setGlobalError(t('Donnez un titre à votre séance (au moins 3 caractères).'))
      return
    }
    if (!/^[A-Z0-9]{6,12}$/.test(pin)) {
      setGlobalError(
        t(
          'Le code PIN doit contenir entre 6 et 12 caractères, chiffres et lettres (sans accents ni symboles). Utilisez le bouton « Générer » pour une suggestion robuste.'
        )
      )
      return
    }
    // v2.6.0 : les libellés personnalisés du questionnaire doivent être
    // remplis (les items standard intacts ne sont pas vérifiés : leur
    // traduction multilingue est conservée).
    if (showSai && saiDrafts.some((d) => d.custom && d.text.trim().length < 3)) {
      setGlobalError(t('Le libellé de l’item doit contenir au moins 3 caractères.'))
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
          // v2.6.0 : questionnaire personnalisé — envoyé UNIQUEMENT si
          // l'enseignant a ouvert la personnalisation (sinon le serveur
          // sème les 33 items standard multilingues).
          ...(showSai
            ? {
                saiItems: saiDrafts.map((d) => ({
                  key: d.key ?? undefined,
                  // Un item standard intact (custom = false) ne porte pas
                  // de texte : sa traduction multilingue reste utilisée.
                  text: d.custom ? d.text.trim() : undefined,
                  subscale: d.subscale,
                  reversed: d.reversed,
                })),
              }
            : {}),
          questions: questions.map((q) => ({
            text: q.text.trim(),
            choices: q.choices.filter((c) => c.trim()),
            correct: q.correct,
            phase: 'rat' as const,
          })),
          cases: cases.map((c, i) => ({
            title: c.title.trim() || `Application ${i + 1}`,
            intro: c.intro.trim(),
            questions: c.questions.map((q) => ({
              text: q.text.trim(),
              choices: q.choices.filter((ch) => ch.trim()),
              correct: q.correct,
              phase: 'application' as const,
            })),
          })),
        }),
      })
      toast({
        title: t('Séance créée !'),
        description: t('Code pour vos étudiants : {code}', { code: res.code }),
      })
      onCreated(res.code, res.teacherToken, title.trim())
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : t('Erreur inconnue.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-stone-900">{t('Créer une séance TBL')}</h2>
        <p className="mt-1 text-sm text-stone-600">
          {t(
            'Remplissez les informations générales, puis composez vos questions de préparation et vos cas cliniques d’application.'
          )}
        </p>
      </div>

      <div className="space-y-4 rounded-2xl border border-stone-200 bg-white p-5">
        <div>
          <Label htmlFor="title">{t('Titre de la séance *')}</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('Ex. Cardiologie — Séance 3 : douleur thoracique')}
            className="mt-1.5 h-11"
          />
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="pin">{t('Code PIN enseignant *')}</Label>
            <div className="mt-1.5 flex gap-2">
              <Input
                id="pin"
                value={pin}
                onChange={(e) =>
                  setPin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))
                }
                placeholder="ex. 7KQ2MP"
                autoCapitalize="characters"
                className="h-11 font-mono tracking-widest"
              />
              <Button
                type="button"
                variant="outline"
                className="h-11 shrink-0 border-stone-300"
                onClick={() => setPin(suggestPin())}
                aria-label={t('Générer un code PIN robuste')}
                title={t('Générer un code PIN robuste')}
              >
                <Dices className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-1 text-xs text-stone-500">
              {t(
                '6 caractères et plus (chiffres + lettres). Protégé contre les tentatives répétées — ne le communiquez jamais aux étudiants.'
              )}
            </p>
          </div>
          <div>
            <Label htmlFor="teams">{t('Nombre d’équipes')}</Label>
            <Input
              id="teams"
              type="number"
              min={2}
              max={50}
              value={teamCount}
              onChange={(e) =>
                setTeamCount(Math.min(50, Math.max(2, Number(e.target.value) || 2)))
              }
              className="mt-1.5 h-11"
            />
            <p className="mt-1 text-xs text-stone-500">{t('De 2 à 50 équipes.')}</p>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <Label htmlFor="minutes">{t('Durée iRAT (minutes)')}</Label>
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
          <h3 className="flex items-center gap-2 font-bold text-stone-900">
            <span className="rounded-full bg-amber-500 px-2.5 py-0.5 text-xs font-bold text-white">
              iRAT / tRAT
            </span>
            {t('Questions de préparation ({n})', { n: questions.length })}
          </h3>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-amber-300 text-amber-700 hover:bg-amber-50"
              onClick={() => {
                const ex = exampleContent()
                setQuestions(ex.rat)
                setCases(ex.cases)
                setErrors({})
              }}
            >
              <Sparkles className="mr-1 h-3.5 w-3.5" />
              {t('Charger l’exemple')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-stone-300"
              onClick={() => setQuestions([...questions, emptyQuestion('rat')])}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              {t('Ajouter une question')}
            </Button>
          </div>
        </div>

        {questions.map((q, i) => (
          <QuestionEditor
            key={`rat-${i}`}
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
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-bold text-stone-900">
            <span className="rounded-full bg-lime-600 px-2.5 py-0.5 text-xs font-bold text-white">
              Application
            </span>
            {t('Cas cliniques ({n})', { n: cases.length })}
          </h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-lime-500 text-lime-700 hover:bg-lime-50"
            onClick={() => setCases([...cases, emptyCase()])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t('Cas clinique')}
          </Button>
        </div>

        {cases.length === 0 && (
          <p className="rounded-2xl border border-dashed border-lime-300 bg-lime-50/50 p-4 text-center text-sm text-stone-500">
            {t(
              'Aucun cas clinique pour le moment. Chaque cas contient un énoncé et 3 à 5 QCU, affichés un par un aux équipes — avec révélation automatique des réponses dès que toutes les équipes ont répondu. (Vous pourrez aussi en ajouter plus tard depuis le tableau de bord.)'
            )}
          </p>
        )}

        {cases.map((c, ci) => (
          <div key={`case-${ci}`} className="space-y-2 rounded-2xl border-2 border-lime-200 bg-lime-50/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-stone-800">{t('Application {n}', { n: ci + 1 })}</p>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-stone-400 hover:bg-red-50 hover:text-red-600"
                onClick={() => setCases(cases.filter((_, idx) => idx !== ci))}
                aria-label={t('Supprimer le cas {n}', { n: ci + 1 })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <Input
              value={c.title}
              onChange={(e) => {
                const next = [...cases]
                next[ci] = { ...c, title: e.target.value }
                setCases(next)
              }}
              placeholder={t('Titre du cas (ex. : Cas clinique — Mme A., 62 ans, douleur thoracique)')}
              className="h-10 border-lime-300"
            />
            <Textarea
              value={c.intro}
              onChange={(e) => {
                const next = [...cases]
                next[ci] = { ...c, intro: e.target.value }
                setCases(next)
              }}
              placeholder={t('Énoncé du cas : contexte, patient, données cliniques ou biologiques…')}
              rows={3}
              className="resize-none border-lime-300 text-[15px]"
            />
            {c.questions.map((q, qi) => (
              <QuestionEditor
                key={`case-${ci}-q-${qi}`}
                index={qi}
                value={q}
                prefix="QCU"
                hidePhaseToggle
                errors={caseErrors[c.title || 'sans-titre']?.[qi]}
                onChange={(nq) => {
                  const next = [...cases]
                  next[ci] = {
                    ...c,
                    questions: c.questions.map((old, idx) => (idx === qi ? nq : old)),
                  }
                  setCases(next)
                }}
                onDelete={() => {
                  const next = [...cases]
                  next[ci] = { ...c, questions: c.questions.filter((_, idx) => idx !== qi) }
                  setCases(next)
                }}
              />
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 w-full border-lime-400 text-lime-700 hover:bg-lime-100"
              onClick={() => {
                const next = [...cases]
                next[ci] = { ...c, questions: [...c.questions, emptyQuestion('application')] }
                setCases(next)
              }}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              {t('Ajouter une QCU à ce cas')}
            </Button>
            <p className="text-center text-xs text-stone-500">
              {t('{n} QCU — 3 à 5 conseillées par cas', { n: c.questions.length })}
            </p>
          </div>
        ))}

        <p className="text-xs leading-relaxed text-stone-500">
          {t(
            'Astuce : les questions « iRAT / tRAT » vérifient la préparation (test individuel puis test en équipe). Les « cas cliniques » d’application sont des problèmes complexes résolus en équipe : les réponses de chaque question sont révélées automatiquement dès que toutes les équipes ont répondu.'
          )}
        </p>
      </div>

      {/* v2.6.0 : bouton demandé par l'enseignant — en bas de la page de
          création, pour personnaliser le questionnaire de fin de séance
          (TBL-SAI) si l'enseignant le souhaite. */}
      {showSai ? (
        <SaiCustomizationSection
          drafts={saiDrafts.map((d) => ({
            ...d,
            // Affichage : libellé personnalisé, sinon l'énoncé standard
            // dans la langue de l'interface de l'enseignant.
            text: d.custom ? d.text : d.key ? t(d.key) : '',
          }))}
          setDrafts={setSaiDrafts}
          onRestore={restoreSaiDefaults}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowSai(true)}
          className="flex w-full items-start gap-3 rounded-2xl border-2 border-dashed border-stone-300 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-md"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-500">
            <ClipboardList className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-bold text-stone-800">
              {t('Personnaliser le questionnaire de fin de séance')}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-stone-500">
              {t(
                'Par défaut, le questionnaire standard TBL-SAI (33 items, Mennenga 2010) est proposé aux étudiants, traduit dans toutes les langues de l’application. Cliquez ici si vous souhaitez l’adapter avant de créer la séance.'
              )}
            </span>
          </span>
        </button>
      )}
      {showSai && (
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full border-stone-300"
          onClick={() => setShowSai(false)}
        >
          {t('Terminer la personnalisation')}
        </Button>
      )}

      {globalError && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {globalError}
        </p>
      )}

      <div className="flex gap-3 pb-4">
        <Button variant="outline" onClick={onCancel} className="h-12 flex-1 border-stone-300">
          {t('Annuler')}
        </Button>
        <Button
          onClick={submit}
          disabled={submitting}
          className="h-12 flex-[2] bg-emerald-600 text-base hover:bg-emerald-700"
        >
          {submitting ? t('Création…') : t('Créer la séance')}
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
  const { t } = useI18n()

  const submit = async () => {
    if (!/^[A-Z0-9]{6}$/.test(code.toUpperCase())) {
      setError(t('Le code de la séance contient 6 caractères.'))
      return
    }
    if (!/^[A-Z0-9]{6,12}$/.test(pin)) {
      setError(t('Le code PIN enseignant contient au moins 6 caractères (chiffres et lettres).'))
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
      setError(e instanceof Error ? e.message : t('Erreur inconnue.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div>
        <h2 className="text-xl font-bold text-stone-900">{t('Reprendre une séance')}</h2>
        <p className="mt-1 text-sm text-stone-600">
          {t('Saisissez le code de la séance et votre code PIN enseignant.')}
        </p>
      </div>
      <div className="space-y-4 rounded-2xl border border-stone-200 bg-white p-5">
        <div>
          <Label htmlFor="login-code">{t('Code de la séance')}</Label>
          <Input
            id="login-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
            placeholder="AB3XK9"
            className="mt-1.5 h-12 text-center font-mono text-lg tracking-[0.3em]"
          />
        </div>
        <div>
          <Label htmlFor="login-pin">{t('Code PIN enseignant')}</Label>
          <Input
            id="login-pin"
            value={pin}
            onChange={(e) => setPin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))}
            autoCapitalize="characters"
            placeholder={t('6 caractères et plus')}
            className="mt-1.5 h-12 text-center font-mono text-lg tracking-[0.3em]"
          />
          <p className="mt-1 text-center text-xs text-stone-500">
            {t('Après 5 tentatives incorrectes, la connexion est bloquée 15 minutes.')}
          </p>
        </div>
        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex gap-3">
          <Button variant="outline" onClick={onCancel} className="h-12 flex-1 border-stone-300">
            {t('Retour')}
          </Button>
          <Button
            onClick={submit}
            disabled={loading}
            className="h-12 flex-[2] bg-emerald-600 hover:bg-emerald-700"
          >
            {loading ? t('Connexion…') : t('Ouvrir le tableau de bord')}
          </Button>
        </div>
      </div>
    </div>
  )
}
