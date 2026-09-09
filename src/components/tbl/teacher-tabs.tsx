'use client'

import { useEffect, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  Dices,
  Download,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  Share2,
  Trash2,
  UserPlus,
  Users,
  Wand2,
  Wifi,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { t, useI18n, formatDate } from '@/lib/i18n'
import type { DashboardDTO } from '@/lib/tbl-types'
import { LETTERS } from '@/lib/tbl-types'
import { gradeForStudent, fmtNote } from '@/lib/grades'
import { SAI_SUBSCALES, SAI_SUBSCALE_INFO, saiItemText } from '@/lib/sai'
import {
  analyzeSection,
  buildIratSection,
  buildTratSection,
  buildApplicationSection,
  buildComparison,
  flagQuestions,
  alphaInterp,
  difficultyInterp,
  discriminationInterp,
  type SectionAnalysis,
  type ComparisonRow,
  type FlaggedQuestion,
} from '@/lib/docimology'
import { api } from '@/lib/tbl-client'
import { loadAppConfig } from '@/lib/app-config'
import { buildXlsx, downloadBlob } from '@/lib/xlsx-writer'
import { choiceLetter } from './shared'
import { QuestionEditor, emptyQuestion } from './question-editor'
import type { DraftQuestion } from '@/lib/tbl-types'

type ManageFn = (action: string, extra?: Record<string, unknown>) => Promise<boolean>

// ================= Onglet ÉQUIPES =================

export function TeamsTab({ data, manage }: { data: DashboardDTO; manage: ManageFn }) {
  const [teamCount, setTeamCount] = useState(String(data.teams.length))
  const { toast } = useToast()
  const { t } = useI18n()
  const unassigned = data.students.filter((s) => !s.teamId)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-stone-200 bg-white p-4">
        <div>
          <Label htmlFor="team-count" className="text-sm">
            {t('Nombre d’équipes')}
          </Label>
          <Input
            id="team-count"
            type="number"
            min={2}
            max={50}
            value={teamCount}
            onChange={(e) => setTeamCount(e.target.value)}
            className="mt-1 h-10 w-24"
          />
          <p className="mt-1 text-xs text-stone-500">{t('Entre 2 et 50.')}</p>
        </div>
        <Button
          variant="outline"
          className="h-10 border-stone-300"
          onClick={() =>
            manage('set_team_count', {
              count: Math.min(50, Math.max(2, Number(teamCount) || 2)),
            })
          }
        >
          {t('Appliquer')}
        </Button>
        <Button
          variant="outline"
          className="h-10 border-amber-400 text-amber-800 hover:bg-amber-50"
          onClick={async () => {
            if (
              window.confirm(
                t(
                  'Répartir automatiquement tous les étudiants sans équipe ? (À faire idéalement avant les tests)'
                )
              )
            ) {
              const ok = await manage('auto_assign')
              if (ok) toast({ title: t('Répartition effectuée') })
            }
          }}
        >
          <Wand2 className="mr-2 h-4 w-4" />
          {t('Répartir automatiquement')}
          {unassigned.length > 0 &&
            ` (${t('{n} sans équipe', { n: unassigned.length })})`}
        </Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {data.teams.map((tm) => {
          const members = data.students.filter((s) => s.teamId === tm.id)
          return (
            <div key={tm.id} className="rounded-2xl border border-stone-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <TeamNameEditor team={tm} manage={manage} />
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-600">
                  <Users className="h-3.5 w-3.5" />
                  {members.length}
                </span>
              </div>
              <div className="space-y-2">
                {members.length === 0 && (
                  <p className="text-sm text-stone-400">{t('Aucun membre (pour l’instant)')}</p>
                )}
                {members.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between gap-2 rounded-xl bg-stone-50 px-3 py-2"
                  >
                    <span className="min-w-0 truncate text-sm font-medium text-stone-800">
                      {m.name}
                      {m.recoveryCode && (
                        <span
                          className="ml-2 font-mono text-[11px] font-normal text-stone-400"
                          title={t(
                            'Code personnel de l’étudiant (à lui redonner s’il l’a perdu)'
                          )}
                        >
                          {m.recoveryCode}
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <Select
                        value={m.teamId ?? 'none'}
                        onValueChange={(v) =>
                          manage('move_student', {
                            studentId: m.id,
                            teamId: v === 'none' ? null : v,
                          })
                        }
                      >
                        <SelectTrigger className="h-8 w-36 border-stone-200 bg-white text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t('Sans équipe')}</SelectItem>
                          {data.teams.map((tt) => (
                            <SelectItem key={tt.id} value={tt.id}>
                              {tt.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 text-stone-300 hover:bg-red-50 hover:text-red-600"
                        onClick={() => {
                          if (
                            window.confirm(
                              t(
                                'Retirer {name} de la séance ? Ses réponses seront supprimées.',
                                { name: m.name }
                              )
                            )
                          ) {
                            manage('remove_student', { studentId: m.id })
                          }
                        }}
                        aria-label={t('Retirer {name}', { name: m.name })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {unassigned.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-bold text-amber-900">
            {t('{n} étudiant(s) sans équipe', { n: unassigned.length })}
          </p>
          <p className="mt-1 text-sm text-amber-800">
            {unassigned.map((s) => s.name).join(', ')} —{' '}
            {t(
              'utilisez le menu « Sans équipe » ci-dessus ou la répartition automatique.'
            )}
          </p>
        </div>
      )}
    </div>
  )
}

function TeamNameEditor({
  team,
  manage,
}: {
  team: { id: string; name: string }
  manage: ManageFn
}) {
  const [name, setName] = useState(team.name)
  const dirty = name !== team.name
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-9 w-40 border-transparent bg-transparent px-1 text-base font-bold text-stone-900 hover:border-stone-200 focus-visible:border-stone-300"
      />
      {dirty && (
        <Button
          size="sm"
          className="h-8 bg-emerald-600 px-2 hover:bg-emerald-700"
          onClick={() => manage('rename_team', { id: team.id, name })}
        >
          <Save className="h-3.5 w-3.5" />
        </Button>
      )}
    </span>
  )
}

// ================= Onglet QUESTIONS =================

export function QuestionsTab({ data, manage }: { data: DashboardDTO; manage: ManageFn }) {
  const { t } = useI18n()
  const hasAnswers =
    data.iratAnswers.length > 0 || data.tratAnswers.length > 0 || data.appAnswers.length > 0
  const [newQ, setNewQ] = useState<DraftQuestion | null>(null)
  const [newQCaseId, setNewQCaseId] = useState<string | null>(null)
  const ratQs = data.questions.filter((q) => q.phase === 'rat')
  const appQs = data.questions.filter((q) => q.phase === 'application')
  const freeAppQs = appQs.filter((q) => !q.caseId)

  return (
    <div className="space-y-4">
      {hasAnswers && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t(
            'Des réponses existent déjà ({a} iRAT, {b} tRAT, {c} application). Modifier ou supprimer des questions peut rendre les résultats incohérents — à éviter en cours de séance.',
            {
              a: data.iratAnswers.length,
              b: data.tratAnswers.length,
              c: data.appAnswers.length,
            }
          )}
        </p>
      )}

      <p className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">
        {t(
          'Les questions sont réparties en deux listes indépendantes : les questions de préparation (utilisées pour l’iRAT puis le tRAT) et les cas cliniques d’application (affichés un par un aux équipes, avec révélation automatique des réponses).'
        )}
      </p>

      {/* --- Questions iRAT / tRAT --- */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-bold text-stone-800">
            <span className="rounded-full bg-amber-500 px-2.5 py-0.5 text-xs font-bold text-white">
              iRAT / tRAT
            </span>
            {t('{n} question(s) de préparation', { n: ratQs.length })}
          </h3>
          {/* v2.9.0 — « Aléatoire » : mélange questions + réponses. */}
          <ShuffleButton
            manage={manage}
            scope="rat"
            count={ratQs.length}
            label={t('Mélanger au hasard les questions et les réponses')}
          />
        </div>
        {ratQs.length === 0 && (
          <p className="rounded-2xl border border-dashed border-amber-300 bg-amber-50/50 p-4 text-center text-sm text-stone-500">
            {t(
              'Aucune question de préparation. Elles sont indispensables pour lancer l’iRAT.'
            )}
          </p>
        )}
        {ratQs.map((q, i) => (
          <ExistingQuestionEditor
            key={q.id}
            index={i}
            question={q}
            manage={manage}
            onMove={
              ratQs.length > 1
                ? (direction) => manage('move_question', { id: q.id, direction })
                : undefined
            }
          />
        ))}
      </section>

      {/* --- Cas cliniques d'application --- */}
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-stone-800">
          <span className="rounded-full bg-lime-600 px-2.5 py-0.5 text-xs font-bold text-white">
            Application
          </span>
          {t('{n} cas clinique(s) · {m} QCU', {
            n: data.cases.length,
            m: appQs.filter((q) => q.caseId).length,
          })}
        </h3>
        {data.cases.length === 0 && (
          <p className="rounded-2xl border border-dashed border-lime-300 bg-lime-50/50 p-4 text-center text-sm text-stone-500">
            {t(
              'Aucun cas clinique pour le moment. Chaque cas contient un énoncé et 3 à 5 QCU, affichés un par un aux équipes.'
            )}
          </p>
        )}
        {data.cases.map((c, ci) => (
          <CaseEditor
            key={c.id}
            index={ci}
            kase={c}
            questions={appQs.filter((q) => q.caseId === c.id)}
            manage={manage}
            hasAnswers={hasAnswers}
          />
        ))}
        <Button
          variant="outline"
          className="h-11 w-full border-dashed border-lime-500 text-lime-700 hover:bg-lime-50"
          disabled={data.cases.length >= 20}
          onClick={() => {
            if (
              window.confirm(t('Ajouter un nouveau cas clinique (énoncé + QCU) ?'))
            ) {
              manage('add_case', {
                title: t('Cas clinique {n}', { n: data.cases.length + 1 }),
                intro: '',
              })
            }
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          {t('Ajouter un cas clinique')}
        </Button>

        {/* Ancien format : exercices libres */}
        {freeAppQs.length > 0 && (
          <div className="space-y-2 rounded-2xl border border-dashed border-stone-300 bg-stone-50/50 p-3">
            <p className="text-xs font-semibold text-stone-500">
              {t(
                'Exercices d’application isolés (ancien format — affichés ensemble sur une seule page aux étudiants) :'
              )}
            </p>
            {freeAppQs.map((q, i) => (
              <ExistingQuestionEditor
                key={q.id}
                index={i}
                question={q}
                manage={manage}
                prefix="Exercice"
                onMove={
                  freeAppQs.length > 1
                    ? (direction) => manage('move_question', { id: q.id, direction })
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </section>

      {newQ ? (
        <div className="space-y-2 rounded-2xl border-2 border-emerald-300 bg-emerald-50/50 p-3">
          <QuestionEditor
            index={newQ.phase === 'rat' ? ratQs.length : 0}
            value={newQ}
            onChange={setNewQ}
            onDelete={() => setNewQ(null)}
            hidePhaseToggle={newQ.phase === 'application' && !!newQCaseId}
            prefix={newQ.phase === 'rat' ? 'Question' : 'QCU'}
          />
          <Button
            className="h-11 w-full bg-emerald-600 hover:bg-emerald-700"
            onClick={async () => {
              const ok = await manage('add_question', {
                question: newQ,
                caseId: newQCaseId,
              })
              if (ok) {
                setNewQ(null)
                setNewQCaseId(null)
              }
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t('Ajouter cette question')}
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          className="h-11 w-full border-dashed border-amber-400 text-stone-700 hover:bg-amber-50"
          onClick={() => {
            setNewQCaseId(null)
            setNewQ(emptyQuestion('rat'))
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          {t('Question iRAT / tRAT')}
        </Button>
      )}
    </div>
  )
}

// ----- Éditeur d'un cas clinique (titre + énoncé + QCU) -----

function CaseEditor({
  index,
  kase,
  questions,
  manage,
  hasAnswers,
}: {
  index: number
  kase: DashboardDTO['cases'][number]
  questions: DashboardDTO['questions']
  manage: ManageFn
  hasAnswers: boolean
}) {
  const [title, setTitle] = useState(kase.title)
  const [intro, setIntro] = useState(kase.intro ?? '')
  const [newQ, setNewQ] = useState<DraftQuestion | null>(null)
  const dirty = title !== kase.title || intro !== (kase.intro ?? '')
  const { t } = useI18n()

  return (
    <div className="space-y-2 rounded-2xl border-2 border-lime-200 bg-lime-50/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-stone-800">
          {t('Application {n}', { n: index + 1 })}
        </p>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-stone-400 hover:bg-red-50 hover:text-red-600"
          onClick={() => {
            if (
              window.confirm(
                t(
                  'Supprimer « {title} » ? Ses {n} QCU et leurs réponses seront aussi supprimées.',
                  { title: kase.title, n: questions.length }
                )
              )
            ) {
              manage('delete_case', { id: kase.id })
            }
          }}
          aria-label={t('Supprimer le cas {n}', { n: index + 1 })}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('Titre du cas (ex. : Cas clinique — Mme A., 62 ans, douleur thoracique)')}
        className="h-10 border-lime-300"
      />
      <Textarea
        value={intro}
        onChange={(e) => setIntro(e.target.value)}
        placeholder={t('Énoncé du cas : contexte, patient, données cliniques ou biologiques…')}
        rows={3}
        className="resize-none border-lime-300 text-[15px]"
      />
      {dirty && (
        <Button
          size="sm"
          className="h-9 w-full bg-emerald-600 hover:bg-emerald-700"
          onClick={() => manage('update_case', { id: kase.id, title, intro })}
        >
          <Save className="mr-1.5 h-4 w-4" />
          {t('Enregistrer le cas')}
        </Button>
      )}

      {questions.map((q, qi) => (
        <ExistingQuestionEditor
          key={q.id}
          index={qi}
          question={q}
          manage={manage}
          prefix="QCU"
          onMove={
            questions.length > 1
              ? (direction) => manage('move_question', { id: q.id, direction })
              : undefined
          }
        />
      ))}

      {/* v2.9.0 — Mélanger les QCU du cas (et leurs réponses). */}
      {questions.length >= 2 && (
        <ShuffleButton
          manage={manage}
          scope={kase.id}
          count={questions.length}
          label={t('Mélanger au hasard les QCU de ce cas et leurs réponses')}
        />
      )}

      {newQ ? (
        <div className="space-y-2 rounded-xl border border-lime-300 bg-white p-2">
          <QuestionEditor
            index={questions.length}
            value={newQ}
            onChange={setNewQ}
            hidePhaseToggle
            prefix="QCU"
            onDelete={() => setNewQ(null)}
          />
          <Button
            size="sm"
            className="h-10 w-full bg-emerald-600 hover:bg-emerald-700"
            onClick={async () => {
              const ok = await manage('add_question', { question: newQ, caseId: kase.id })
              if (ok) setNewQ(null)
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t('Ajouter cette QCU au cas')}
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="h-9 w-full border-lime-400 text-lime-700 hover:bg-lime-100"
          onClick={() => setNewQ(emptyQuestion('application'))}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t('Ajouter une QCU à ce cas')}
        </Button>
      )}
      <p className="text-center text-xs text-stone-500">
        {t('{n} QCU — 3 à 5 conseillées par cas', { n: questions.length })}
        {hasAnswers && ` · ${t('des réponses existent déjà')}`}
      </p>
    </div>
  )
}

function ExistingQuestionEditor({
  index,
  question,
  manage,
  prefix,
  hidePhaseToggle = false,
  onMove,
}: {
  index: number
  question: DashboardDTO['questions'][number]
  manage: ManageFn
  prefix?: string
  hidePhaseToggle?: boolean
  /** v2.9.0 — déplacer la question dans sa liste (flèches ↑ / ↓).
   *  Absent = liste non réordonnable. */
  onMove?: (direction: -1 | 1) => void
}) {
  const [draft, setDraft] = useState<DraftQuestion>({
    text: question.text,
    choices: question.choices,
    correct: question.correct ?? 0,
    phase: question.phase,
  })
  const { t } = useI18n()
  const dirty =
    draft.text !== question.text ||
    JSON.stringify(draft.choices) !== JSON.stringify(question.choices) ||
    draft.correct !== question.correct ||
    draft.phase !== question.phase
  return (
    <div className="flex items-start gap-1.5">
      {/* v2.9.0 — Réordonnancement : monter / descendre la question
          dans SA liste (iRAT/tRAT, QCU du cas, exercices libres). */}
      {onMove && (
        <div className="flex flex-col gap-1 pt-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 border-stone-300 text-stone-500 hover:bg-stone-50"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label={t('Monter la question')}
            title={t('Monter la question')}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 border-stone-300 text-stone-500 hover:bg-stone-50"
            onClick={() => onMove(1)}
            disabled={false}
            aria-label={t('Descendre la question')}
            title={t('Descendre la question')}
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-2">
        <QuestionEditor
          index={index}
          value={draft}
          onChange={setDraft}
          hidePhaseToggle={hidePhaseToggle || question.caseId !== null}
          prefix={prefix ?? (question.phase === 'application' ? 'Exercice' : 'Question')}
          onDelete={() => {
            if (
              window.confirm(
                t('Supprimer cette question ? Ses réponses seront aussi supprimées.')
              )
            ) {
              manage('delete_question', { id: question.id })
            }
          }}
        />
        {dirty && (
          <Button
            size="sm"
            className="h-9 w-full bg-emerald-600 hover:bg-emerald-700"
            onClick={() => manage('update_question', { id: question.id, question: draft })}
          >
            <Save className="mr-1.5 h-4 w-4" />
            {t('Enregistrer les modifications')}
          </Button>
        )}
      </div>
    </div>
  )
}

// v2.9.0 — Bouton « Aléatoire » : mélange au hasard les questions du
// groupe ET les réponses de chaque question. Les réponses déjà
// enregistrées suivent leur texte (remappage serveur) : les résultats
// restent exacts même si le mélange a lieu pendant la séance.
function ShuffleButton({
  manage,
  scope,
  count,
  label,
}: {
  manage: ManageFn
  scope: string
  count: number
  label: string
}) {
  const { t } = useI18n()
  if (count < 2) return null
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 border-stone-300 text-stone-600 hover:bg-stone-50"
      onClick={() => {
        if (
          window.confirm(
            t(
              'Mélanger au hasard les {n} questions et leurs réponses ? L’ordre actuel sera remplacé (les résultats déjà enregistrés suivent leur texte, rien n’est perdu).',
              { n: count }
            )
          )
        ) {
          manage('shuffle_quiz', { scope })
        }
      }}
      title={label}
    >
      <Dices className="mr-1 h-3.5 w-3.5" />
      {t('Aléatoire')}
    </Button>
  )
}

// ================= Onglet RÉSULTATS =================

export function ResultsTab({
  data,
  ratQs,
  appQs,
}: {
  data: DashboardDTO
  ratQs: DashboardDTO['questions']
  appQs: DashboardDTO['questions']
}) {
  const { t } = useI18n()
  if (data.students.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
        {t('Les résultats apparaîtront ici dès que des étudiants auront répondu.')}
      </p>
    )
  }
  return (
    <div className="space-y-6">
      {/* Note finale sur 20 */}
      <FinalGradesSection data={data} finished={data.session.status === 'finished'} />

      {/* iRAT */}
      {ratQs.length > 0 && (
        <ResultSection title={t('Test individuel (iRAT) — 1 point par bonne réponse')}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-start text-xs text-stone-500">
                  <th className="py-2 pe-3 font-medium">{t('Étudiant')}</th>
                  <th className="py-2 pe-3 font-medium">{t('Équipe')}</th>
                  {ratQs.map((_, i) => (
                    <th key={i} className="py-2 px-1.5 text-center font-medium">
                      Q{i + 1}
                    </th>
                  ))}
                  <th className="py-2 ps-3 text-center font-medium">{t('Total')}</th>
                </tr>
              </thead>
              <tbody>
                {data.students.map((s) => {
                  const total = data.iratAnswers
                    .filter((a) => a.studentId === s.id)
                    .reduce((sum, a) => sum + a.score, 0)
                  return (
                    <tr key={s.id} className="border-b border-stone-100">
                      <td className="py-2 pr-3 font-medium text-stone-800">{s.name}</td>
                      <td className="py-2 pr-3 text-xs text-stone-500">
                        {data.teams.find((t) => t.id === s.teamId)?.name ?? '—'}
                      </td>
                      {ratQs.map((q) => {
                        const a = data.iratAnswers.find(
                          (x) => x.questionId === q.id && x.studentId === s.id
                        )
                        return (
                          <td key={q.id} className="py-2 px-1.5 text-center">
                            {a ? (
                              a.isCorrect ? (
                                <Check className="mx-auto h-4 w-4 text-emerald-600" />
                              ) : (
                                <X className="mx-auto h-4 w-4 text-red-400" />
                              )
                            ) : (
                              <span className="text-stone-300">—</span>
                            )}
                          </td>
                        )
                      })}
                      <td className="py-2 pl-3 text-center font-bold text-stone-900">
                        {total}/{ratQs.length}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </ResultSection>
      )}

      {/* tRAT */}
      {ratQs.length > 0 && (
        <ResultSection
          title={t('Test en équipe (tRAT) — barème 4 / 2 / 1 / 0 selon la tentative')}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-start text-xs text-stone-500">
                  <th className="py-2 pe-3 font-medium">{t('Équipe')}</th>
                  {ratQs.map((_, i) => (
                    <th key={i} className="py-2 px-1.5 text-center font-medium">
                      Q{i + 1}
                    </th>
                  ))}
                  <th className="py-2 ps-3 text-center font-medium">{t('Total')}</th>
                </tr>
              </thead>
              <tbody>
                {data.teams.map((tm) => {
                  const total = data.tratAnswers
                    .filter((a) => a.teamId === tm.id)
                    .reduce((sum, a) => sum + a.score, 0)
                  return (
                    <tr key={tm.id} className="border-b border-stone-100">
                      <td className="py-2 pe-3 font-medium text-stone-800">{tm.name}</td>
                      {ratQs.map((q) => {
                        const answers = data.tratAnswers.filter(
                          (x) => x.questionId === q.id && x.teamId === tm.id
                        )
                        const best = answers.find((a) => a.isCorrect)
                        const score = answers.reduce((sum, a) => sum + a.score, 0)
                        const attempts = answers.length
                        return (
                          <td key={q.id} className="py-2 px-1.5 text-center">
                            <span
                              className={cn(
                                'inline-flex flex-col items-center leading-tight',
                                score > 0 ? 'text-emerald-700' : 'text-stone-400'
                              )}
                            >
                              <span className="font-bold">{score > 0 ? score : '·'}</span>
                              {attempts > 0 && (
                                <span className="text-[10px] text-stone-400">
                                  {best ? t('{n}ᵉ essai', { n: attempts }) : t('échoué')}
                                </span>
                              )}
                            </span>
                          </td>
                        )
                      })}
                      <td className="py-2 pl-3 text-center font-bold text-stone-900">
                        {total}/{ratQs.length * 4}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </ResultSection>
      )}

      {/* Application : un tableau par cas clinique */}
      {appQs.length > 0 && (
        <AppResultsByCase data={data} appQs={appQs} />
      )}

      {/* Évaluation par les pairs */}
      {data.peerEvals.length > 0 && (
        <ResultSection
          title={t('Évaluation par les pairs — note moyenne reçue (sur 5)')}
        >
          <div className="space-y-2">
            {data.students.map((s) => {
              const received = data.peerEvals.filter((e) => e.evaluatedId === s.id)
              if (received.length === 0) return null
              const avg = received.reduce((sum, e) => sum + e.score, 0) / received.length
              return (
                <div key={s.id} className="rounded-xl border border-stone-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-stone-800">{s.name}</p>
                    <span
                      className={cn(
                        'rounded-full px-2.5 py-1 text-sm font-bold',
                        avg >= 4
                          ? 'bg-emerald-100 text-emerald-700'
                          : avg >= 3
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-red-100 text-red-700'
                      )}
                    >
                      {avg.toFixed(1)} / 5
                    </span>
                  </div>
                  {received.some((e) => e.comment) && (
                    <div className="mt-2 space-y-1">
                      {received
                        .filter((e) => e.comment)
                        .map((e, i) => (
                          <p key={i} className="text-xs italic text-stone-600">
                            « {e.comment} »
                          </p>
                        ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </ResultSection>
      )}

      <Button
        variant="outline"
        className="h-12 w-full border-emerald-300 text-emerald-700 hover:bg-emerald-50"
        onClick={() => exportCsv(data, ratQs, appQs)}
      >
        <Download className="mr-2 h-4 w-4" />
        {t('Exporter tous les résultats (CSV pour Excel)')}
      </Button>
    </div>
  )
}

// Tableaux d'application groupés par cas clinique
function AppResultsByCase({
  data,
  appQs,
}: {
  data: DashboardDTO
  appQs: DashboardDTO['questions']
}) {
  const { t } = useI18n()
  const caseById = new Map(data.cases.map((c) => [c.id, c]))
  const groups: { label: string; questions: DashboardDTO['questions'] }[] = []
  for (const c of data.cases) {
    const qs = appQs.filter((q) => q.caseId === c.id)
    if (qs.length > 0)
      groups.push({
        label: `${t('Application')} ${c.order + 1} — ${c.title}`,
        questions: qs,
      })
  }
  const free = appQs.filter((q) => !q.caseId || !caseById.has(q.caseId))
  if (free.length > 0) {
    groups.push({ label: t("Exercices d'application (ancien format)"), questions: free })
  }
  return (
    <>
      {groups.map((g) => (
        <ResultSection key={g.label} title={`${g.label} — ${t('choix des équipes')}`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[320px] text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-start text-xs text-stone-500">
                  <th className="py-2 pe-3 font-medium">{t('Équipe')}</th>
                  {g.questions.map((_, i) => (
                    <th key={i} className="py-2 px-1.5 text-center font-medium">
                      Q{i + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.teams.map((tm) => (
                  <tr key={tm.id} className="border-b border-stone-100">
                    <td className="py-2 pe-3 font-medium text-stone-800">{tm.name}</td>
                    {g.questions.map((q) => {
                      const a = data.appAnswers.find(
                        (x) => x.questionId === q.id && x.teamId === tm.id
                      )
                      return (
                        <td key={q.id} className="py-2 px-1.5 text-center">
                          {a ? (
                            <span
                              className={cn(
                                'font-bold',
                                a.choice === q.correct ? 'text-emerald-600' : 'text-stone-800'
                              )}
                            >
                              {choiceLetter(a.choice)}
                            </span>
                          ) : (
                            <span className="text-stone-300">—</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {g.questions.some((q) =>
            data.appAnswers.some((a) => a.questionId === q.id && a.text)
          ) && (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-semibold text-stone-500">
                {t('Justifications des équipes :')}
              </p>
              {g.questions.map((q, qi) =>
                data.appAnswers
                  .filter((a) => a.questionId === q.id && a.text)
                  .map((a) => (
                    <p key={`${a.teamId}-${q.id}`} className="text-xs text-stone-600">
                      <strong>{data.teams.find((t) => t.id === a.teamId)?.name}</strong> (Q
                      {qi + 1}) : {a.text}
                    </p>
                  ))
              )}
            </div>
          )}
        </ResultSection>
      ))}
    </>
  )
}

function ResultSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-bold text-stone-800">{title}</h3>
      {children}
    </section>
  )
}

// ================= Note finale sur 20 =================

function noteTone(note: number | null): string {
  if (note === null) return 'bg-stone-100 text-stone-500'
  if (note >= 16) return 'bg-emerald-100 text-emerald-700'
  if (note >= 12) return 'bg-lime-100 text-lime-700'
  if (note >= 10) return 'bg-amber-100 text-amber-700'
  return 'bg-red-100 text-red-700'
}

function FinalGradesSection({ data, finished }: { data: DashboardDTO; finished: boolean }) {
  const { t } = useI18n()
  const grades = data.students.map((s) => ({ s, g: gradeForStudent(data, s.id) }))
  const anyGrade = grades.some(({ g }) => g.final !== null)
  if (!anyGrade) return null

  return (
    <ResultSection
      title={t(
        'Note finale sur 20 — iRAT 25 % · tRAT 25 % · Application 35 % · Pairs 15 %'
      )}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-start text-xs text-stone-500">
              <th className="py-2 pe-3 font-medium">{t('Étudiant')}</th>
              <th className="py-2 pe-3 font-medium">{t('Équipe')}</th>
              <th className="py-2 px-1.5 text-center font-medium">
                iRAT
                <span className="block text-[10px] font-normal">25 %</span>
              </th>
              <th className="py-2 px-1.5 text-center font-medium">
                tRAT
                <span className="block text-[10px] font-normal">25 %</span>
              </th>
              <th className="py-2 px-1.5 text-center font-medium">
                {t('Application')}
                <span className="block text-[10px] font-normal">35 %</span>
              </th>
              <th className="py-2 px-1.5 text-center font-medium">
                {t('Pairs')}
                <span className="block text-[10px] font-normal">15 %</span>
              </th>
              <th className="py-2 ps-3 text-center font-medium">{t('Note finale')}</th>
            </tr>
          </thead>
          <tbody>
            {grades.map(({ s, g }) => {
              const team = data.teams.find((t) => t.id === s.teamId)
              return (
                <tr key={s.id} className="border-b border-stone-100">
                  <td className="py-2 pr-3 font-medium text-stone-800">{s.name}</td>
                  <td className="py-2 pr-3 text-xs text-stone-500">{team?.name ?? '—'}</td>
                  {([g.irat, g.trat, g.application, g.peer] as const).map((c, i) => (
                    <td key={i} className="py-2 px-1.5 text-center">
                      <span className="font-semibold text-stone-800">{fmtNote(c.note)}</span>
                      <span className="block text-[10px] text-stone-400">{c.detail}</span>
                    </td>
                  ))}
                  <td className="py-2 pl-3 text-center">
                    <span
                      className={cn(
                        'inline-flex min-w-[3.5rem] justify-center rounded-full px-2.5 py-1 text-sm font-bold',
                        noteTone(g.final)
                      )}
                    >
                      {fmtNote(g.final)}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-stone-500">
        {t(
          'Chaque composante est d’abord ramenée sur 20 (iRAT : 1 point par bonne réponse ; tRAT : barème 4/2/1/0 ; application : réponses correctes de l’équipe ; pairs : moyenne reçue sur 5). Si une composante est indisponible — par exemple aucun exercice d’application ou aucune évaluation reçue — son poids est automatiquement redistribué sur les autres (colonne « — »).'
        )}{' '}
        {!finished && (
          <span className="font-medium text-amber-700">
            {t('Séance en cours : ces notes sont provisoires.')}
          </span>
        )}
      </p>
    </ResultSection>
  )
}

// ================= Onglet RÉCLAMATIONS =================

export function AppealsTab({ data, manage }: { data: DashboardDTO; manage: ManageFn }) {
  const { t } = useI18n()
  // Les réclamations portent toujours sur les questions RAT (iRAT/tRAT) :
  // on numérote donc dans cette liste, pas dans la liste complète.
  const ratQs = data.questions.filter((q) => q.phase === 'rat')
  if (data.appeals.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
        {t(
          'Aucune réclamation pour le moment. Pendant la phase « Réclamations », les équipes peuvent contester une réponse directement depuis leur téléphone.'
        )}
      </p>
    )
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-stone-500">
        {t(
          'Accepter une réclamation donne automatiquement les 4 points du tRAT à l’équipe pour cette question.'
        )}
      </p>
      {data.appeals.map((a) => {
        const team = data.teams.find((t) => t.id === a.teamId)
        const question = ratQs.find((q) => q.id === a.questionId)
        const qi = question ? ratQs.indexOf(question) + 1 : '?'
        return (
          <div key={a.id} className="rounded-2xl border border-stone-200 bg-white p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                {team?.name ?? t('Équipe ?')}
              </span>
              <span className="text-xs text-stone-500">
                {t('Question {n} : {text}', {
                  n: qi,
                  text: (question?.text ?? '').slice(0, 60),
                })}
                {(question?.text ?? '').length > 60 ? '…' : ''}
              </span>
            </div>
            <p className="rounded-xl bg-stone-50 p-3 text-sm leading-relaxed text-stone-700">
              {a.text}
            </p>
            {a.status === 'pending' ? (
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  className="h-9 flex-1 bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => manage('resolve_appeal', { id: a.id, status: 'accepted' })}
                >
                  <Check className="mr-1.5 h-4 w-4" />
                  {t('Accepter (+4 pts)')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 flex-1 border-red-300 text-red-600 hover:bg-red-50"
                  onClick={() => manage('resolve_appeal', { id: a.id, status: 'rejected' })}
                >
                  <X className="mr-1.5 h-4 w-4" />
                  {t('Refuser')}
                </Button>
              </div>
            ) : (
              <p
                className={cn(
                  'mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold',
                  a.status === 'accepted'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-stone-100 text-stone-600'
                )}
              >
                {a.status === 'accepted' ? (
                  <>
                    <Check className="h-3.5 w-3.5" /> {t('Acceptée (+4 pts)')}
                  </>
                ) : (
                  <>
                    <X className="h-3.5 w-3.5" /> {t('Refusée')}
                  </>
                )}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ================= Onglet SIGNALEMENTS (v2.5.1) =================
// Rubrique demandée par l'enseignant, à part entière et placée juste
// après « Réclamations ». Chaque signalement envoyé par les appareils
// étudiants est divisé PAR ÉPREUVE : iRAT, tRAT, application (= cas
// cliniques). Les événements hors épreuve (accueil, réclamations,
// évaluation par les pairs…) ou antérieurs à la v2.5.1 (phase NULL)
// sont regroupés sous « Autres moments ». Rappel : ce sont des indices
// à interpréter, jamais des preuves.

const ALERT_CATS = ['irat', 'trat', 'application', 'autres'] as const
type AlertCat = (typeof ALERT_CATS)[number]

interface AlertCell {
  total: number
  /** combinaison de touches de capture (PC uniquement) */
  captures: number
  /** application passée en arrière-plan pendant l'épreuve */
  sorties: number
}

function catOf(phase: string | null): AlertCat {
  if (phase === 'irat' || phase === 'trat' || phase === 'application') return phase
  return 'autres'
}

export function SignalementsTab({ data }: { data: DashboardDTO }) {
  const { t } = useI18n()
  const alerts = data.alerts ?? []

  if (alerts.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
        {t(
          "Aucun signalement pour le moment. Les suspicions de capture d’écran (ordinateur) et les sorties de l’application pendant les épreuves apparaîtront ici, réparties par étudiant et par épreuve."
        )}
      </p>
    )
  }

  // Regroupement : une ligne par étudiant, un compteur par épreuve.
  const rows: {
    key: string
    name: string
    cells: Record<AlertCat, AlertCell>
    total: number
    last: Date
  }[] = []
  const byStudent = new Map<string, (typeof rows)[number]>()
  for (const a of alerts) {
    let row = byStudent.get(a.studentId)
    if (!row) {
      row = {
        key: a.studentId,
        name: a.studentName,
        cells: {
          irat: { total: 0, captures: 0, sorties: 0 },
          trat: { total: 0, captures: 0, sorties: 0 },
          application: { total: 0, captures: 0, sorties: 0 },
          autres: { total: 0, captures: 0, sorties: 0 },
        },
        total: 0,
        last: new Date(a.createdAt),
      }
      byStudent.set(a.studentId, row)
      rows.push(row)
    }
    const cell = row.cells[catOf(a.phase)]
    cell.total += 1
    if (a.kind === 'screenshot') cell.captures += 1
    else cell.sorties += 1
    row.total += 1
    const d = new Date(a.createdAt)
    if (d > row.last) row.last = d
  }
  // Étudiants les plus récemment signalés en premier.
  rows.sort((x, y) => y.last.getTime() - x.last.getTime())

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-stone-500">
        {t(
          'Chaque signalement est classé par épreuve : iRAT, tRAT ou application (cas cliniques). Ceux survenus hors épreuve — accueil, réclamations, évaluation par les pairs… — sont regroupés sous « Autres moments ».'
        )}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-start text-xs text-stone-500">
              <th className="py-2 pe-3 font-medium">{t('Étudiant')}</th>
              <th className="py-2 px-1.5 text-center font-medium">{t('iRAT')}</th>
              <th className="py-2 px-1.5 text-center font-medium">{t('tRAT')}</th>
              <th className="py-2 px-1.5 text-center font-medium">
                {t('Application (cas cliniques)')}
              </th>
              <th className="py-2 px-1.5 text-center font-medium">{t('Autres moments')}</th>
              <th className="py-2 px-1.5 text-center font-medium">{t('Total')}</th>
              <th className="py-2 ps-3 text-center font-medium">{t('Dernier')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-stone-100 align-top">
                <td className="py-2 pe-3 font-medium text-stone-800">{r.name}</td>
                {ALERT_CATS.map((cat) => (
                  <AlertCountCell key={cat} cell={r.cells[cat]} />
                ))}
                <td className="py-2 px-1.5 text-center font-bold text-stone-900">{r.total}</td>
                <td
                  className="py-2 ps-3 text-center text-xs text-stone-500"
                  title={formatDate(r.last)}
                >
                  {formatDate(r.last, { hour: '2-digit', minute: '2-digit' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-amber-700">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        {t(
          'Une suspicion, pas une preuve : l’écran peut s’être simplement verrouillé, ou la combinaison de touches appartenir au navigateur. Les captures ne sont jamais bloquables (limite des navigateurs) — mais chaque image reste marquée du nom de l’étudiant.'
        )}
      </p>
    </div>
  )
}

/** Cellule compteur d'une épreuve : total en gras, détail captures /
 *  sorties en petit sous le nombre (— si aucun). */
function AlertCountCell({ cell }: { cell: AlertCell }) {
  const { t } = useI18n()
  if (cell.total === 0) {
    return (
      <td className="py-2 px-1.5 text-center">
        <span className="text-stone-300">—</span>
      </td>
    )
  }
  return (
    <td className="py-2 px-1.5 text-center">
      <span className="font-bold text-amber-800">{cell.total}</span>
      {cell.captures > 0 && (
        <p className="text-[10px] leading-tight text-stone-500">
          {t('{n} capture(s) d’écran suspectée(s)', { n: cell.captures })}
        </p>
      )}
      {cell.sorties > 0 && (
        <p className="text-[10px] leading-tight text-stone-500">
          {t('{n} sortie(s) de l’application', { n: cell.sorties })}
        </p>
      )}
    </td>
  )
}

// ================= v2.6.0 : Onglet QUESTIONNAIRE (TBL-SAI) =================

/** Moyenne d'une sous-échelle (1 à 5) à partir des moyennes brutes par
 *  item : les items inversés (formulation négative) voient leur moyenne
 *  retournée (6 − moyenne), conformément à la cotation de l'instrument. */
function saiSubscaleMeanFromItemMeans(
  entries: { mean: number; n: number; reversed: boolean }[]
): number | null {
  const usable = entries.filter((e) => e.n > 0 && Number.isFinite(e.mean))
  if (usable.length === 0) return null
  const adjusted = usable.map((e) => (e.reversed ? 6 - e.mean : e.mean))
  return adjusted.reduce((s, v) => s + v, 0) / adjusted.length
}

export function QuestionnaireTab({
  data,
  manage,
}: {
  data: DashboardDTO
  manage: ManageFn
}) {
  const { t } = useI18n()
  const { toast } = useToast()
  const stats = data.saiStats ?? { completed: 0, items: [], comments: [] }
  const hasResponses = stats.items.some((it) => it.n > 0)
  const itemStats = new Map(stats.items.map((s) => [s.id, s]))

  const [newSubscale, setNewSubscale] = useState('satisfaction')
  const [newText, setNewText] = useState('')
  const [newReversed, setNewReversed] = useState(false)

  return (
    <div className="space-y-4">
      {/* Présentation */}
      <div className="rounded-2xl border border-stone-200 bg-white p-4">
        <p className="text-sm font-bold text-stone-900">
          {t('Questionnaire de fin de séance (TBL-SAI)')}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-stone-600">
          {t(
            'À la fin de la séance, les étudiants répondent à ce questionnaire pour accéder à leur note et à leur rang. Par défaut, les 33 items standard de l’instrument (Mennenga, 2010) sont proposés, traduits dans toutes les langues de l’application.'
          )}
        </p>
        <p className="mt-2 rounded-xl bg-stone-50 px-3 py-2 text-xs leading-relaxed text-stone-500">
          {t(
            'Personnaliser le libellé d’un item remplace sa traduction par votre texte, affiché tel quel dans toutes les langues. Les items « inversés » (formulation négative) sont automatiquement pris en compte dans les moyennes de sous-échelles.'
          )}
        </p>
      </div>

      {/* Garde-fou : réponses déjà collectées */}
      {hasResponses && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t(
            'Des étudiants ont déjà répondu : la suppression d’items et la réinitialisation sont bloquées, mais les libellés restent modifiables.'
          )}
        </p>
      )}

      {/* Réinitialisation (bloquée par le serveur si des réponses existent) */}
      <Button
        variant="outline"
        className="h-10 w-full border-stone-300 text-stone-600"
        onClick={() => {
          if (
            window.confirm(
              t(
                'Réinitialiser le questionnaire standard ? Toutes vos modifications seront perdues (l’opération est impossible si des étudiants ont déjà répondu).'
              )
            )
          ) {
            manage('sai_reset')
          }
        }}
      >
        {t('Réinitialiser le questionnaire standard')}
      </Button>

      {/* Items par sous-échelle */}
      {SAI_SUBSCALES.map((sub) => {
        const items = data.saiItems.filter((it) => it.subscale === sub)
        const info = SAI_SUBSCALE_INFO[sub]
        return (
          <section key={sub} className="space-y-2">
            <div className="rounded-xl bg-stone-100 px-4 py-3">
              <p className="text-sm font-bold text-stone-800">{t(info.labelKey)}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-stone-500">
                {t(info.descriptionKey)}
              </p>
            </div>
            {items.length === 0 && (
              <p className="rounded-2xl border border-dashed border-stone-300 bg-stone-50/50 p-4 text-center text-sm text-stone-500">
                {t('Aucun item dans cette sous-échelle.')}
              </p>
            )}
            <div className="space-y-2">
              {items.map((it, i) => (
                <SaiItemEditor
                  key={it.id}
                  index={i}
                  item={it}
                  deletable={!hasResponses}
                  manage={manage}
                />
              ))}
            </div>
          </section>
        )
      })}

      {/* Ajout d'un item personnalisé */}
      <div className="space-y-2 rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50/40 p-3">
        <p className="text-sm font-bold text-stone-800">{t('Ajouter un item')}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div>
            <Label className="text-xs">{t('Sous-échelle de l’item')}</Label>
            <Select value={newSubscale} onValueChange={setNewSubscale}>
              <SelectTrigger className="mt-1 h-9 bg-white text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SAI_SUBSCALES.map((sub) => (
                  <SelectItem key={sub} value={sub}>
                    {t(SAI_SUBSCALE_INFO[sub].labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2 flex items-end">
            <label className="flex items-center gap-2 pb-2 text-xs text-stone-600">
              <input
                type="checkbox"
                checked={newReversed}
                onChange={(e) => setNewReversed(e.target.checked)}
                className="h-4 w-4 accent-emerald-600"
              />
              {t('Item inversé (formulation négative)')}
            </label>
          </div>
        </div>
        <Textarea
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder={t('Libellé de l’item')}
          rows={2}
          maxLength={500}
          className="resize-none bg-white text-sm"
        />
        <Button
          className="h-10 w-full bg-emerald-600 hover:bg-emerald-700"
          disabled={newText.trim().length < 3}
          onClick={async () => {
            const ok = await manage('sai_add_item', {
              subscale: newSubscale,
              text: newText.trim(),
              reversed: newReversed,
            })
            if (ok) {
              toast({ title: t('Nouvel item ajouté en fin de liste.') })
              setNewText('')
              setNewReversed(false)
            }
          }}
        >
          <Plus className="mr-1 h-4 w-4" />
          {t('Ajouter un item')}
        </Button>
      </div>

      {/* ---- Résultats ---- */}
      <div className="space-y-4 rounded-2xl border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-bold text-stone-900">{t('Résultats du questionnaire')}</p>
          <p className="text-xs text-stone-500">
            {t('{n} étudiant(s) ont répondu sur {total} inscrit(s)', {
              n: stats.completed,
              total: data.students.length,
            })}
          </p>
        </div>

        {stats.completed === 0 ? (
          <p className="rounded-xl bg-stone-50 px-3 py-2 text-sm text-stone-500">
            {t('Aucune réponse pour le moment.')}
          </p>
        ) : (
          <>
            {/* Moyennes de sous-échelles (items inversés pris en compte) */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {SAI_SUBSCALES.map((sub) => {
                const entries = data.saiItems
                  .filter((it) => it.subscale === sub)
                  .map((it) => ({
                    mean: itemStats.get(it.id)?.mean ?? 0,
                    n: itemStats.get(it.id)?.n ?? 0,
                    reversed: it.reversed,
                  }))
                const mean = saiSubscaleMeanFromItemMeans(entries)
                return (
                  <div
                    key={sub}
                    className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-center"
                  >
                    <p className="text-[11px] font-semibold leading-tight text-stone-500">
                      {t(SAI_SUBSCALE_INFO[sub].labelKey)}
                    </p>
                    <p className="mt-1 text-2xl font-bold text-stone-800">
                      {mean === null ? '—' : fmtNote(mean)}
                      <span className="text-xs font-normal text-stone-400"> / 5</span>
                    </p>
                  </div>
                )
              })}
            </div>
            <p className="text-center text-[11px] text-stone-400">
              {t('Moyenne (1 à 5) — items inversés pris en compte')}
            </p>

            {/* Détail par item */}
            <div>
              <p className="mb-1.5 text-xs font-semibold text-stone-500">
                {t('Réponses aux items')}
              </p>
              <div className="max-h-72 overflow-y-auto rounded-xl border border-stone-200">
                <table className="w-full text-xs">
                  <tbody>
                    {data.saiItems.map((it, i) => {
                      const st = itemStats.get(it.id)
                      return (
                        <tr key={it.id} className={i % 2 === 0 ? 'bg-white' : 'bg-stone-50'}>
                          <td className="px-3 py-2 leading-snug text-stone-700">
                            <span className="mr-1 font-mono text-stone-400">{i + 1}.</span>
                            {saiItemText(it)}
                            {it.reversed && (
                              <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-700">
                                {t('Item inversé (formulation négative)')}
                              </span>
                            )}
                          </td>
                          <td className="w-28 px-3 py-2 text-right">
                            <span className="font-bold text-stone-800">
                              {st && st.n > 0 ? fmtNote(st.mean) : '—'}
                            </span>
                            <span className="ml-1 text-stone-400">/ 5</span>
                          </td>
                          <td className="w-14 px-3 py-2 text-right text-stone-400">
                            n={st?.n ?? 0}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-right text-[11px] text-stone-400">{t('Moyenne de l’item')}</p>
            </div>

            {/* Commentaires */}
            <div>
              <p className="mb-1.5 text-xs font-semibold text-stone-500">
                {t('Commentaires des étudiants')}
              </p>
              {stats.comments.length === 0 ? (
                <p className="rounded-xl bg-stone-50 px-3 py-2 text-sm text-stone-500">
                  {t('Aucun commentaire pour le moment.')}
                </p>
              ) : (
                <div className="space-y-2">
                  {stats.comments.map((c, i) => (
                    <div key={i} className="rounded-xl bg-stone-50 px-3 py-2">
                      <p className="text-xs font-semibold text-stone-600">{c.studentName}</p>
                      <p className="mt-0.5 text-sm leading-relaxed text-stone-700">{c.comment}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* v2.7.0 : export CSV du questionnaire — DANS sa rubrique
                dédiée (comme les résultats et la docimologie). */}
            {stats.completed > 0 && (
              <Button
                variant="outline"
                className="h-11 w-full border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                onClick={() => exportQuestionnaireCsv(data)}
              >
                <Download className="mr-2 h-4 w-4" />
                {t('Exporter le questionnaire (CSV pour Excel)')}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ================= Onglet CONFIGURATIONS (v2.7.0) =================

// Réglages de synchronisation mémorisés sur l'ordinateur de l'enseignant
// (une adresse par séance) : adresse de la version en ligne + synchro
// automatique toutes les 5 secondes (v2.8.2) et à chaque action de
// l'enseignant pendant que le tableau de bord est ouvert. Voir la
// section « Synchronisation » ci-dessous.
export interface SyncConfig {
  url: string
  auto: boolean
}

export function readSyncConfig(code: string): SyncConfig | null {
  try {
    const raw = window.localStorage.getItem('tbl_sync_settings')
    if (!raw) return null
    const all = JSON.parse(raw) as Record<string, SyncConfig>
    const cfg = all[code]
    if (cfg && typeof cfg.url === 'string' && cfg.url.length > 0) return cfg
    return null
  } catch {
    return null
  }
}

export function writeSyncConfig(code: string, cfg: SyncConfig | null) {
  try {
    const raw = window.localStorage.getItem('tbl_sync_settings')
    const all = raw ? (JSON.parse(raw) as Record<string, SyncConfig>) : {}
    if (cfg) all[code] = cfg
    else delete all[code]
    window.localStorage.setItem('tbl_sync_settings', JSON.stringify(all))
  } catch {
    // stockage indisponible : réglage non mémorisé, sans erreur
  }
}

// ---------------- v3.2.0 : partage de la séance ----------------

/**
 * Carte « Partage de la séance » (onglet Configurations) : inviter des
 * collègues par leur email institutionnel — la séance apparaît dans
 * « Mes séances » de leur compte, ouverture sans PIN, co-pilotage du
 * même tableau de bord. La liste suit la séance (sync locale ↔ en
 * ligne, sauvegarde .json) : l'email est l'identifiant stable.
 */
function ShareCard({
  data,
  token,
  refresh,
}: {
  data: DashboardDTO
  token: string
  refresh: () => Promise<unknown>
}) {
  const { t } = useI18n()
  const { toast } = useToast()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const collaborators = data.session.collaborators ?? []
  const code = data.session.code

  const invite = async () => {
    if (busy || !email.trim()) return
    setBusy(true)
    try {
      const res = await api<{
        ok: boolean
        duplicate?: boolean
        email: string
        hasAccount: boolean
        name: string | null
      }>(`/api/sessions/${code}/manage`, {
        method: 'POST',
        body: JSON.stringify({ token, action: 'share_session', email: email.trim() }),
      })
      if (res.duplicate) {
        toast({ title: t('Déjà invité'), description: t('Cet enseignant a déjà accès à la séance.') })
      } else if (!res.hasAccount) {
        toast({
          title: t('Invitation enregistrée'),
          description: t(
            'Aucun compte enseignant n’existe encore avec cet email : prévenez votre administrateur pour qu’il le crée — la séance apparaîtra alors dans ses « Mes séances ».'
          ),
        })
      } else {
        toast({
          title: t('Invitation envoyée'),
          description: t('{name} retrouve la séance dans « Mes séances » de son compte.', {
            name: res.name ?? res.email,
          }),
        })
      }
      setEmail('')
      await refresh()
    } catch (e) {
      toast({
        title: t('Invitation impossible'),
        description: e instanceof Error ? e.message : t('Erreur inconnue.'),
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (target: string) => {
    if (busy) return
    setBusy(true)
    try {
      await api(`/api/sessions/${code}/manage`, {
        method: 'POST',
        body: JSON.stringify({ token, action: 'unshare_session', email: target }),
      })
      toast({
        title: t('Partage retiré'),
        description: t('{email} ne verra plus la séance dans « Mes séances ».', { email: target }),
      })
      await refresh()
    } catch (e) {
      toast({
        title: t('Retrait impossible'),
        description: e instanceof Error ? e.message : t('Erreur inconnue.'),
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-bold text-stone-900">
          <Share2 className="h-4 w-4 text-emerald-600" />
          {t('Partage de la séance')}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-stone-500">
          {t(
            'Invitez d’autres enseignants par leur email institutionnel : la séance s’ajoute dans leurs « Mes séances », ouverture sans PIN, même tableau de bord — idéal pour animer la séance à plusieurs.'
          )}
        </p>
      </div>

      {data.session.owner && (
        <p className="rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-600">
          {t('Propriétaire :')} <b>{data.session.owner.name}</b>
          <span className="text-stone-400"> ({data.session.owner.email})</span>
        </p>
      )}

      {collaborators.length > 0 && (
        <ul className="space-y-1.5">
          {collaborators.map((c) => (
            <li
              key={c.email}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-stone-800">
                  {c.name ?? c.email}
                  {c.name && <span className="ml-2 text-xs text-stone-400">{c.email}</span>}
                </p>
                <p className="text-[11px]">
                  {c.hasAccount ? (
                    <span className="text-emerald-600">{t('Compte actif')}</span>
                  ) : (
                    <span className="text-amber-600">
                      {t('Compte inexistant — prévenez l’administrateur')}
                    </span>
                  )}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-stone-400 hover:bg-red-50 hover:text-red-600"
                disabled={busy}
                onClick={() => void revoke(c.email)}
              >
                <X className="mr-0.5 h-3.5 w-3.5" />
                {t('Retirer')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <Label htmlFor="share-email">{t('Email institutionnel')}</Label>
          <Input
            id="share-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="prenom.nom@etablissement"
            className="mt-1.5 h-11"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void invite()
              }
            }}
          />
        </div>
        <Button
          className="h-11 bg-emerald-600 hover:bg-emerald-700"
          disabled={busy || email.trim().length < 5}
          onClick={() => void invite()}
        >
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <UserPlus className="mr-1 h-4 w-4" />}
          {t('Inviter')}
        </Button>
      </div>
    </section>
  )
}

export function ConfigurationsTab({
  data,
  manage,
  token,
  refresh,
}: {
  data: DashboardDTO
  manage: ManageFn
  token: string
  refresh: () => Promise<unknown>
}) {
  const { t } = useI18n()
  const { toast } = useToast()
  const [title, setTitle] = useState(data.session.title)
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [savingTitle, setSavingTitle] = useState(false)
  const [savingPin, setSavingPin] = useState(false)
  const [minutes, setMinutes] = useState(String(data.session.iratMinutes))
  const [savingMinutes, setSavingMinutes] = useState(false)
  const [syncUrl, setSyncUrl] = useState(() => readSyncConfig(data.session.code)?.url ?? '')
  const [autoSync, setAutoSync] = useState(() => readSyncConfig(data.session.code)?.auto ?? false)
  const [syncing, setSyncing] = useState(false)
  const [excludeId, setExcludeId] = useState<string | null>(null)
  // v2.9.0 : délai du cycle de synchronisation — réglable dans
  // l'espace administrateur (/admin), affiché ici en secondes.
  const [syncSeconds, setSyncSeconds] = useState(5)
  useEffect(() => {
    loadAppConfig().then((c) => setSyncSeconds(Math.round(c.syncIntervalMs / 1000)))
  }, [])

  const saveSync = (url: string, auto: boolean) => {
    setSyncUrl(url)
    setAutoSync(auto)
    if (url.trim()) writeSyncConfig(data.session.code, { url: url.trim(), auto })
    else writeSyncConfig(data.session.code, null)
  }

  // v2.8.1 : les boutons « Sauvegarder » (en-tête du tableau de bord,
  // à côté de « Dupliquer ») et « Téléverser une séance » (écran
  // d'accueil enseignant) ne vivent plus dans cet onglet — l'enseignante
  // l'a demandé : chaque chose à sa place, la rubrique Configurations
  // ne garde que les réglages (titre, durée, PIN, exclusion,
  // synchronisation).

  const doSync = async () => {
    if (!syncUrl.trim() || syncing) return
    setSyncing(true)
    try {
      const res = await api<{ pulled: { answersInserted: number } | null }>(
        `/api/sessions/${data.session.code}/manage`,
        {
          method: 'POST',
          body: JSON.stringify({ token, action: 'sync_now', remoteUrl: syncUrl.trim() }),
        }
      )
      toast({
        title: t('Synchronisation réussie'),
        description: res.pulled
          ? t('Contributions distantes fusionnées puis état complet envoyé à la version en ligne.')
          : t('Séance envoyée à la version en ligne (aucune contribution distante en attente).'),
      })
      await refresh()
    } catch (e) {
      toast({
        title: t('Synchronisation impossible'),
        description: e instanceof Error ? e.message : t('Erreur inconnue.'),
        variant: 'destructive',
      })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* v3.0.0 — pouls de la séance EN DIRECT : étudiants actifs
          (vu dans la dernière minute) et requêtes/minute. Une requête
          minuscule toutes les 10 s : l'enseignante repère immédiatement
          un problème pendant le cours (serveur local = chiffres exacts). */}
      <LiveStatsCard />

      {/* ---- Paramètres de la séance ---- */}
      <section className="space-y-4 rounded-2xl border border-stone-200 bg-white p-4">
        <div>
          <p className="text-sm font-bold text-stone-900">{t('Paramètres de la séance')}</p>
          <p className="mt-0.5 text-xs text-stone-500">
            {t(
              'Titre, durée et code PIN. Les questions et le questionnaire se modifient dans leurs onglets dédiés.'
            )}
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <Label htmlFor="cfg-title">{t('Titre de la séance')}</Label>
            <Input
              id="cfg-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              className="mt-1.5 h-11"
            />
          </div>
          <Button
            className="h-11 bg-emerald-600 hover:bg-emerald-700"
            disabled={savingTitle || title.trim() === data.session.title || title.trim().length < 2}
            onClick={async () => {
              setSavingTitle(true)
              await manage('set_title', { title: title.trim() })
              setSavingTitle(false)
            }}
          >
            {savingTitle ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            {t('Enregistrer')}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="cfg-minutes" className="text-sm">
            {t('Durée conseillée du iRAT :')}
          </Label>
          <Input
            id="cfg-minutes"
            type="number"
            min={1}
            max={90}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            className="h-10 w-20 text-center"
          />
          <span className="text-sm text-stone-500">{t('min')}</span>
          <Button
            size="sm"
            variant="outline"
            className="h-10 border-stone-300"
            disabled={
              savingMinutes ||
              !Number.isInteger(Number(minutes)) ||
              Number(minutes) === data.session.iratMinutes ||
              Number(minutes) < 1 ||
              Number(minutes) > 90
            }
            onClick={async () => {
              setSavingMinutes(true)
              await manage('set_irat_minutes', { minutes: Number(minutes) })
              setSavingMinutes(false)
            }}
          >
            {t('Enregistrer')}
          </Button>
        </div>

        <div className="grid gap-2 border-t border-stone-100 pt-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="flex items-center gap-1.5 text-sm">
              <KeyRound className="h-4 w-4 text-emerald-600" />
              {t('Changer le code PIN enseignant')}
            </Label>
            <p className="mt-0.5 text-xs text-stone-500">
              {t('Notez-le : il sert à rouvrir cette séance. 6 à 12 caractères, chiffres et lettres.')}
            </p>
          </div>
          <Input
            value={pin}
            onChange={(e) => setPin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))}
            placeholder="ex. 7KQ2MP"
            autoCapitalize="characters"
            className="mt-1.5 h-11 font-mono tracking-widest"
            aria-label={t('Nouveau code PIN')}
          />
          <Input
            value={pin2}
            onChange={(e) => setPin2(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))}
            placeholder={t('confirmez le PIN')}
            autoCapitalize="characters"
            className="mt-1.5 h-11 font-mono tracking-widest"
            aria-label={t('Confirmez le nouveau code PIN')}
          />
          <div className="sm:col-span-2">
            <Button
              className="h-11 bg-emerald-600 hover:bg-emerald-700"
              disabled={
                savingPin ||
                pin.length < 6 ||
                pin !== pin2
              }
              onClick={async () => {
                setSavingPin(true)
                const ok = await manage('set_pin', { pin })
                setSavingPin(false)
                if (ok) {
                  setPin('')
                  setPin2('')
                  toast({ title: t('Code PIN modifié.') })
                }
              }}
            >
              {savingPin ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <KeyRound className="mr-1 h-4 w-4" />}
              {t('Changer le PIN')}
            </Button>
            {pin.length > 0 && pin !== pin2 && (
              <p className="mt-1.5 text-xs text-red-600">{t('Les deux PIN ne correspondent pas.')}</p>
            )}
          </div>
        </div>
      </section>

      {/* ---- v3.2.0 : partage de la séance avec d'autres enseignants ---- */}
      <ShareCard data={data} token={token} refresh={refresh} />

      {/* ---- Exclure un étudiant ---- */}
      <section className="space-y-3 rounded-2xl border border-stone-200 bg-white p-4">
        <div>
          <p className="text-sm font-bold text-stone-900">{t('Exclure un étudiant de la séance')}</p>
          <p className="mt-0.5 text-xs text-stone-500">
            {t(
              'L’étudiant perd immédiatement l’accès à la séance (appareil déconnecté). Ses réponses déjà enregistrées sont supprimées.'
            )}
          </p>
        </div>
        {data.students.length === 0 ? (
          <p className="text-sm text-stone-500">{t('Aucun étudiant inscrit.')}</p>
        ) : (
          <div className="max-h-56 space-y-1.5 overflow-y-auto">
            {data.students.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate text-stone-800">
                  {s.name}
                  <span className="ml-2 text-xs text-stone-500">
                    {data.teams.find((tm) => tm.id === s.teamId)?.name ?? t('sans équipe')}
                  </span>
                </span>
                {excludeId === s.id ? (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2 text-xs"
                      onClick={() => setExcludeId(null)}
                    >
                      {t('Annuler')}
                    </Button>
                    <Button
                      size="sm"
                      className="h-8 bg-red-600 px-3 text-xs hover:bg-red-700"
                      onClick={async () => {
                        const ok = await manage('remove_student', { studentId: s.id })
                        if (ok) setExcludeId(null)
                      }}
                    >
                      {t('Confirmer l’exclusion')}
                    </Button>
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 shrink-0 border-red-200 px-3 text-xs text-red-600 hover:bg-red-50"
                    onClick={() => setExcludeId(s.id)}
                  >
                    {t('Exclure')}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---- Synchronisation Internet ↔ réseau local ---- */}
      <section className="space-y-3 rounded-2xl border-2 border-sky-200 bg-sky-50/50 p-4">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-bold text-stone-900">
            <Wifi className="h-4 w-4 text-sky-600" />
            {t('Synchronisation Internet ↔ réseau local')}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-stone-600">
            {t(
              'Si la séance est aussi servie par une autre version de l’application (version en ligne Vercel pendant que vous utilisez le réseau local, ou l’inverse), indiquez son adresse : cet ordinateur tire les réponses des étudiants connectés à l’autre version, fusionne tout, puis renvoie l’état complet. Aucun doublon, aucun conflit — et en cas de coupure réseau, la séance continue : relancez la synchronisation plus tard.'
            )}
          </p>
          {/* v2.8.2 : la synchronisation est devenue quasi immédiate —
              conseil d'usage : UN SEUL tableau de bord (celui-ci), les
              étudiants rejoignent l'une ou l'autre adresse. */}
          <p className="mt-1.5 rounded-xl bg-white/80 px-3 py-2 text-xs leading-relaxed text-sky-900">
            {t(
              'Synchronisation quasi immédiate : vos actions partent tout de suite et les contributions des étudiants arrivent en quelques secondes. Gardez ce tableau de bord ouvert sur cet ordinateur — c’est lui qui fait tourner la synchronisation. N’ouvrez pas en même temps le tableau de bord de la version en ligne : un seul « chef d’orchestre » à la fois.'
            )}
          </p>
        </div>
        <div>
          <Label htmlFor="cfg-sync-url">{t('Adresse de la version en ligne')}</Label>
          <Input
            id="cfg-sync-url"
            type="url"
            inputMode="url"
            value={syncUrl}
            onChange={(e) => saveSync(e.target.value, autoSync)}
            placeholder="https://votre-application.vercel.app"
            className="mt-1.5 h-11"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={autoSync}
            onChange={(e) => saveSync(syncUrl, e.target.checked)}
            disabled={!syncUrl.trim()}
            className="h-4 w-4 accent-emerald-600"
          />
          {t(
            'Synchroniser automatiquement (toutes les {s} secondes et à chacune de vos actions, pendant que ce tableau de bord est ouvert)',
            { s: syncSeconds }
          )}
        </label>
        <p className="-mt-1 pl-6 text-xs text-stone-500">
          {t('Ce délai se règle dans l’espace administrateur de l’application.')}
        </p>
        <Button
          className="h-11 w-full bg-sky-600 hover:bg-sky-700"
          disabled={!syncUrl.trim() || syncing}
          onClick={doSync}
        >
          {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          {t('Synchroniser maintenant')}
        </Button>
        {data.session.syncedAt && (
          <p className="text-center text-xs text-stone-500">
            {t('Dernière synchronisation réussie : {date}', {
              date: formatDate(new Date(data.session.syncedAt), {
                dateStyle: 'short',
                timeStyle: 'medium',
              }),
            })}
          </p>
        )}
      </section>
    </div>
  )
}

function SaiItemEditor({
  index,
  item,
  deletable,
  manage,
}: {
  index: number
  item: DashboardDTO['saiItems'][number]
  deletable: boolean
  manage: ManageFn
}) {
  const { t } = useI18n()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(item.text ?? (item.textKey ? t(item.textKey) : ''))
  const [reversed, setReversed] = useState(item.reversed)
  const [saving, setSaving] = useState(false)
  const dirty = (item.text ?? null) !== (text.trim() || null) || reversed !== item.reversed

  const save = async (customText: string | null) => {
    if (saving) return
    if (customText !== null && customText.trim().length < 3) {
      toast({ title: t('Le libellé de l’item doit contenir au moins 3 caractères.') })
      return
    }
    setSaving(true)
    const ok = await manage('sai_update_item', {
      id: item.id,
      text: customText,
      reversed,
    })
    setSaving(false)
    if (ok) setOpen(false)
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-sm leading-snug text-stone-700">
          <span className="mr-1 font-mono text-xs text-stone-400">{index + 1}.</span>
          {saiItemText(item)}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          {item.reversed && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
              {t('Item inversé (formulation négative)')}
            </span>
          )}
          {item.text && (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
              {t('Libellé personnalisé')}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-stone-500"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-3.5 w-3.5" /> : <Wand2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {open && (
        <div className="mt-2 space-y-2 border-t border-stone-100 pt-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            maxLength={500}
            className="resize-none text-sm"
            placeholder={t('Libellé de l’item')}
          />
          <label className="flex items-center gap-2 text-xs text-stone-600">
            <input
              type="checkbox"
              checked={reversed}
              onChange={(e) => setReversed(e.target.checked)}
              className="h-4 w-4 accent-emerald-600"
            />
            {t('Item inversé (formulation négative)')}
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              className="h-9 bg-emerald-600 hover:bg-emerald-700"
              disabled={saving || !dirty}
              onClick={() => save(text.trim() || null)}
            >
              <Save className="mr-1 h-3.5 w-3.5" />
              {t('Sauvegarder')}
            </Button>
            {item.textKey && item.text && (
              <Button
                size="sm"
                variant="outline"
                className="h-9 border-stone-300"
                disabled={saving}
                onClick={() => save(null)}
              >
                {t('Réinitialiser le libellé standard')}
              </Button>
            )}
            {deletable && (
              <Button
                size="sm"
                variant="outline"
                className="h-9 border-red-200 text-red-600 hover:bg-red-50"
                disabled={saving}
                onClick={() => {
                  if (window.confirm(t('Supprimer cet item ?'))) {
                    manage('sai_delete_item', { id: item.id })
                  }
                }}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                {t('Supprimer cet item')}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}


// ================= Exports : matrices partagées CSV + Excel =================
//
// v2.7.0 : chaque rubrique garde SON export CSV (Résultats, Docimologie,
// Questionnaire) et l'onglet « Terminé » du déroulé exporte un classeur
// Excel UNIQUE à 3 feuilles (Résultats / Docimologie / Questionnaire).
// Les trois exports partagent les mêmes matrices de données, construites
// ici une seule fois — aucune divergence possible entre le CSV et l'Excel.

type Cell = string | number | null | undefined

export interface MatrixResult {
  rows: Cell[][]
  /** Index des lignes d'en-tête (gras + fond dans l'Excel) */
  boldRows: number[]
}

/** Matrice 1 : résultats par étudiant + réclamations + commentaires des pairs. */
export function buildResultsMatrix(
  data: DashboardDTO,
  ratQs: DashboardDTO['questions'],
  appQs: DashboardDTO['questions']
): MatrixResult {
  const rows: Cell[][] = []
  const boldRows: number[] = [0]

  // Tableau 1 : résultats par étudiant
  // NB : les scores s'écrivent « 10 sur 10 » (et non « 10/10 ») pour éviter
  // la conversion automatique en date par Excel (10/10 → 10-oct).
  const caseById = new Map(data.cases.map((c) => [c.id, c]))
  const appColumnLabel = (q: DashboardDTO['questions'][number], i: number) => {
    const c = q.caseId ? caseById.get(q.caseId) : undefined
    return c
      ? `${t('Application')} ${c.order + 1} Q${
          appQs.filter((x) => x.caseId === q.caseId).indexOf(q) + 1
        }`
      : `${t('Exercice')} ex.${i + 1}`
  }
  rows.push([
    t('Étudiant'),
    t('Équipe'),
    ...ratQs.map((_, i) => `iRAT Q${i + 1}`),
    t('iRAT total (sur {n})', { n: ratQs.length }),
    t('tRAT équipe (total sur {n})', { n: ratQs.length * 4 }),
    ...appQs.map((q, i) => appColumnLabel(q, i)),
    t('Note pairs (moyenne sur 5)'),
    t('iRAT sur 20 (25%)'),
    t('tRAT sur 20 (25%)'),
    t('Application sur 20 (35%)'),
    t('Pairs sur 20 (15%)'),
    t('NOTE FINALE sur 20'),
  ])
  for (const s of data.students) {
    const team = data.teams.find((tm) => tm.id === s.teamId)
    const iratCells = ratQs.map((q) => {
      const a = data.iratAnswers.find((x) => x.questionId === q.id && x.studentId === s.id)
      return a ? (a.isCorrect ? '✓' : choiceLetter(a.choice)) : ''
    })
    const iratTotal = data.iratAnswers
      .filter((a) => a.studentId === s.id)
      .reduce((sum, a) => sum + a.score, 0)
    const tratTotal = team
      ? data.tratAnswers.filter((a) => a.teamId === team.id).reduce((sum, a) => sum + a.score, 0)
      : 0
    const appCells = appQs.map((q) => {
      const a = team ? data.appAnswers.find((x) => x.questionId === q.id && x.teamId === team.id) : null
      return a ? choiceLetter(a.choice) : ''
    })
    const received = data.peerEvals.filter((e) => e.evaluatedId === s.id)
    const peerAvg =
      received.length > 0
        ? Math.round((received.reduce((sum, e) => sum + e.score, 0) / received.length) * 10) / 10
        : null
    // Notes finales sur 20 (nombres — l'Excel affiche la virgule selon la
    // langue de l'ordinateur, le CSV l'écrit à la française)
    const g = gradeForStudent(data, s.id)
    const cells = [g.irat, g.trat, g.application, g.peer].map((c) =>
      c.note === null ? null : Math.round(c.note * 100) / 100
    )
    const finalCell = g.final === null ? null : Math.round(g.final * 100) / 100
    rows.push([
      s.name,
      team?.name ?? '',
      ...iratCells,
      t('{n} sur {m}', { n: iratTotal, m: ratQs.length }),
      t('{n} sur {m}', { n: tratTotal, m: ratQs.length * 4 }),
      ...appCells,
      peerAvg,
      ...cells,
      finalCell,
    ])
  }

  // Tableau 2 : réclamations
  if (data.appeals.length > 0) {
    rows.push([])
    boldRows.push(rows.length)
    rows.push([t('Réclamations'), t('Équipe'), t('Question'), t('Justification'), t('Décision')])
    for (const a of data.appeals) {
      const team = data.teams.find((tm) => tm.id === a.teamId)
      const q = data.questions.find((x) => x.id === a.questionId)
      rows.push([
        '',
        team?.name ?? '',
        q?.text ?? '',
        a.text,
        a.status === 'accepted'
          ? t('Acceptée')
          : a.status === 'rejected'
            ? t('Refusée')
            : t('En attente'),
      ])
    }
  }

  // Tableau 3 : commentaires des pairs
  const withComments = data.peerEvals.filter((e) => e.comment)
  if (withComments.length > 0) {
    rows.push([])
    boldRows.push(rows.length)
    rows.push([t('Évaluation par les pairs'), t('Évaluateur'), t('Évalué'), t('Note'), t('Commentaire')])
    for (const e of withComments) {
      rows.push([
        '',
        data.students.find((s) => s.id === e.evaluatorId)?.name ?? '',
        data.students.find((s) => s.id === e.evaluatedId)?.name ?? '',
        e.score,
        e.comment ?? '',
      ])
    }
  }

  return { rows, boldRows }
}

/** Matrice 3 : questionnaire de fin de séance (synthèse + réponses détaillées). */
export function buildQuestionnaireMatrix(data: DashboardDTO): MatrixResult {
  const rows: Cell[][] = []
  const boldRows: number[] = [0]
  const items = data.saiItems
  const statsByItem = new Map((data.saiStats?.items ?? []).map((s) => [s.id, s]))
  const respByStudent = new Map<string, Map<string, number>>()
  for (const r of data.saiResponses ?? []) {
    if (!respByStudent.has(r.studentId)) respByStudent.set(r.studentId, new Map())
    respByStudent.get(r.studentId)!.set(r.itemId, r.value)
  }
  const commentsByName = new Map(
    (data.saiStats?.comments ?? []).map((c) => [c.studentName, c.comment])
  )

  // Section 1 : synthèse par item
  rows.push([
    t('N°'),
    t('Sous-échelle'),
    t('Item'),
    t('Inversé'),
    t('Réponses'),
    t('Moyenne (1 à 5)'),
  ])
  items.forEach((it, i) => {
    const st = statsByItem.get(it.id)
    rows.push([
      i + 1,
      t(SAI_SUBSCALE_INFO[it.subscale].labelKey),
      saiItemText(it),
      it.reversed ? t('oui') : '',
      st?.n ?? 0,
      st && st.n > 0 ? Math.round(st.mean * 100) / 100 : null,
    ])
  })

  // Section 2 : réponses détaillées (matrice étudiant × item)
  rows.push([])
  boldRows.push(rows.length)
  rows.push([
    t('Étudiant'),
    t('Équipe'),
    ...items.map((_, i) => `I${i + 1}`),
    t('Complété le'),
    t('Commentaire'),
  ])
  for (const s of data.students) {
    const mine = respByStudent.get(s.id)
    rows.push([
      s.name,
      data.teams.find((tm) => tm.id === s.teamId)?.name ?? '',
      ...items.map((it) => (mine ? (mine.get(it.id) ?? null) : null)),
      s.saiCompletedAt ? formatDate(new Date(s.saiCompletedAt)) : '',
      commentsByName.get(s.name) ?? '',
    ])
  }
  return { rows, boldRows }
}

/** Matrice 2 : analyse docimologique complète (mêmes calculs que l'onglet Statistiques). */
export function buildDocimologyMatrix(
  data: DashboardDTO,
  irat: SectionAnalysis | null,
  trat: SectionAnalysis | null,
  app: SectionAnalysis | null,
  comparison: ComparisonRow[] | null,
  flagged: FlaggedQuestion[]
): MatrixResult {
  const rows: Cell[][] = []
  const boldRows: number[] = []
  const line = (...cells: Cell[]) => rows.push(cells)
  /** nombre décimal arrondi (null si non calculable) */
  const nb = (x: number | null, decimals = 2): number | null =>
    x === null || !Number.isFinite(x) ? null : Math.round(x * 10 ** decimals) / 10 ** decimals
  /** pourcentage (0-100, 1 décimale) */
  const pc = (x: number | null): number | null =>
    x === null ? null : Math.round(x * 1000) / 10

  // Libellés composés « Application 2 Q3 » → mot Application traduit
  const fmtQLabel = (label: string): string =>
    label
      .replace(/^Application ex\.(\d+)$/, (_m, n) => `${t('Exercice')} ${n}`)
      .replace(/^Application (\d+) Q(\d+)$/, (_m, a, q) => `${t('Application')} ${a} Q${q}`)

  line(`STATISTIQUES DOCIMOLOGIQUES — ${data.session.title} (code ${data.session.code})`)
  line(
    t('Exporté le {date} — phase : {phase} — {n} étudiant(s), {m} équipe(s)', {
      date: formatDate(new Date(), {
        dateStyle: 'short',
        timeStyle: 'short',
      }),
      phase: data.session.status,
      n: data.students.length,
      m: data.teams.length,
    })
  )
  rows.push([])

  // ---- 1. Synthèse par section ----
  boldRows.push(rows.length)
  line(t('1. SYNTHÈSE PAR SECTION'))
  boldRows.push(rows.length)
  line(
    t('Section'), t('Répondants'), t('Questions'), t('Score max'), t('Moyenne (points)'),
    t('Écart-type'), t('Moyenne /20'), t('Médiane (points)'), 'Q1', 'Q3', 'Min', 'Max',
    t('Fidélité (alpha)'), t('Interprétation fidélité'), t('SEM (points)'), t('Répondants complets')
  )
  const sections: [string, SectionAnalysis | null][] = [
    [t('iRAT (individuel)'), irat],
    [t('tRAT (équipes)'), trat],
    [t('Application (équipes)'), app],
  ]
  for (const [label, a] of sections) {
    if (!a) continue
    const tst = a.test
    line(
      label, tst.n, tst.k, tst.maxScore, nb(tst.mean), nb(tst.sd), nb(tst.mean20, 1),
      nb(tst.median), nb(tst.q1), nb(tst.q3), tst.min, tst.max, nb(tst.alpha),
      tst.alpha !== null ? t(alphaInterp(tst.alpha).label) : '', nb(tst.sem), tst.nComplete
    )
  }
  rows.push([])

  // ---- 2. Analyse des questions ----
  const itemRows = (kindLabel: string, a: SectionAnalysis, isTrat: boolean, isApp: boolean) => {
    boldRows.push(rows.length)
    line(`2. ${t('ANALYSE DES QUESTIONS')} — ${kindLabel}`)
    boldRows.push(rows.length)
    const header = isTrat
      ? [
          t('Question'), t('Intitulé'), t('Équipes'), t('Réussite 1er essai (%)'), t('Réussite finale (%)'),
          t('Points moyens (sur 4)'), t('Équipes à 4 pts'), t('à 2 pts'), t('à 1 pt'), t('à 0 pt'),
          t('Indice de discrimination (D)'), t('Interprétation D'), t('r point-bisériale'),
        ]
      : [
          ...(isApp ? [t('Cas')] : []), t('Question'), t('Intitulé'), t('Répondants'),
          ...(isApp ? [t('Bonnes réponses')] : []), t('Indice de difficulté (p)'),
          t('Interprétation difficulté'), t('Indice de discrimination (D)'), t('Interprétation D'),
          t('r point-bisériale'),
        ]
    const optHeader = LETTERS.map((l) => `${t('Choix')} ${l} (%)`)
    line(...header, ...optHeader, ...(isTrat ? [] : [t('Sans réponse')]))
    for (const it of a.items) {
      const optByIndex = new Map(it.options.map((o) => [o.index, o]))
      const optCells = Array.from({ length: 6 }, (_, i) => pc(optByIndex.get(i)?.pct ?? null))
      const base = isApp
        ? [fmtQLabel(it.question.caseLabel ?? ''), fmtQLabel(it.question.label), it.question.text, it.n, it.nCorrect]
        : isTrat
          ? [fmtQLabel(it.question.label), it.question.text, it.n]
          : [fmtQLabel(it.question.label), it.question.text, it.n, it.nCorrect]
      const stats = isTrat
        ? [
            pc(it.pFirst), pc(it.p), nb(it.avgScore),
            it.ifat?.c4 ?? '', it.ifat?.c2 ?? '', it.ifat?.c1 ?? '', it.ifat?.c0 ?? '',
            nb(it.d),
            it.d !== null ? t(discriminationInterp(it.d).label) : '',
            nb(it.rpbs),
          ]
        : [
            pc(it.p),
            it.p !== null ? t(difficultyInterp(it.p).label) : '',
            nb(it.d),
            it.d !== null ? t(discriminationInterp(it.d).label) : '',
            nb(it.rpbs),
          ]
      line(...base, ...stats, ...optCells, ...(isTrat ? [] : [it.nMissing]))
    }
    rows.push([])
  }
  if (irat) itemRows(t('iRAT (répondants : étudiants)'), irat, false, false)
  if (trat)
    itemRows(
      t('tRAT (répondants : équipes — choix du 1ᵉʳ essai — barème IF-AT 4/2/1/0)'),
      trat,
      true,
      false
    )
  if (app)
    itemRows(t('APPLICATION ET CAS CLINIQUES (répondants : équipes)'), app, false, true)

  // ---- 3. Comparaison iRAT → tRAT ----
  if (comparison && irat && trat) {
    boldRows.push(rows.length)
    line(`3. ${t('COMPARAISON iRAT → tRAT (effet équipe)')}`)
    boldRows.push(rows.length)
    line(
      t('Question'), t('Intitulé'), t('Réussite individus (%)'),
      t('Équipes 1er essai (%)'), t('Équipes au final (%)'), t('Gain (points de %)')
    )
    for (const row of comparison) {
      line(
        fmtQLabel(row.question.label),
        row.question.text,
        pc(row.pIrat),
        pc(row.pTratFirst),
        pc(row.pTratFinal),
        row.gain !== null ? Math.round(row.gain * 1000) / 10 : null
      )
    }
    line(
      t('Moyenne /20'), '', nb(irat.test.mean20, 1), '', nb(trat.test.mean20, 1),
      irat.test.mean20 !== null && trat.test.mean20 !== null
        ? nb(trat.test.mean20 - irat.test.mean20, 1)
        : null
    )
    rows.push([])
  }

  // ---- 4. Distribution des notes ----
  boldRows.push(rows.length)
  line(`4. ${t('RÉPARTITION DES NOTES (sur 20)')}`)
  boldRows.push(rows.length)
  line(t('Section'), t('Classe'), t('Effectif'))
  for (const [label, a] of sections) {
    if (!a) continue
    for (const bin of a.test.distribution) {
      line(label, bin.label, bin.count)
    }
  }
  rows.push([])

  // ---- 5. Questions à revoir ----
  boldRows.push(rows.length)
  line(`5. ${t('QUESTIONS À REVOIR (signalement automatique)')}`)
  boldRows.push(rows.length)
  line(t('Section'), t('Question'), t('Intitulé'), t('Points à surveiller'))
  for (const f of flagged) {
    line(t(KIND_LABEL[f.kind]), f.label, f.text, f.problems.join(' ; '))
  }

  return { rows, boldRows }
}

// Libellés de section utilisés par l'export docimologique
const KIND_LABEL: Record<string, string> = {
  irat: 'iRAT (individuel)',
  trat: 'tRAT (équipes)',
  application: 'Application (équipes)',
}

// ---------------- Écriture CSV (BOM UTF-8, « ; », virgule décimale) ----------------

/** Convertit une matrice en lignes CSV francophones (Excel FR). */
function matrixToCsv(matrix: MatrixResult): string {
  const esc = (v: Cell) => {
    let s: string
    if (typeof v === 'number' && Number.isFinite(v)) {
      // virgule décimale française, comme les exports historiques
      s = String(v).replace('.', ',')
    } else {
      s = String(v ?? '')
    }
    // Anti « CSV injection » : un texte libre saisi par un étudiant (nom,
    // justification, commentaire) qui commencerait par =, +, -, @, une
    // tabulation ou un retour chariot pourrait être interprété comme une
    // formule par Excel. On le neutralise d’une apostrophe initiale.
    if (/^[=+\-@\t\r]/.test(s)) {
      s = "'" + s
    }
    return `"${s.replace(/"/g, '""')}"`
  }
  return matrix.rows.map((r) => r.map(esc).join(';')).join('\r\n')
}

function downloadCsv(matrix: MatrixResult, filename: string) {
  const blob = new Blob(['\uFEFF' + matrixToCsv(matrix)], { type: 'text/csv;charset=utf-8' })
  downloadBlob(blob, filename)
}

/** CSV des résultats — bouton de la rubrique « Résultats ». */
export function exportCsv(
  data: DashboardDTO,
  ratQs: DashboardDTO['questions'],
  appQs: DashboardDTO['questions']
) {
  downloadCsv(buildResultsMatrix(data, ratQs, appQs), `resultats-tbl-${data.session.code}.csv`)
}

/** CSV du questionnaire — bouton de la rubrique « Questionnaire ». */
export function exportQuestionnaireCsv(data: DashboardDTO) {
  downloadCsv(buildQuestionnaireMatrix(data), `questionnaire-tbl-${data.session.code}.csv`)
}

/** CSV de la docimologie — bouton de la rubrique « Statistiques » (Docimologie). */
export function exportDocimologyCsvFromMatrix(matrix: MatrixResult, code: string) {
  downloadCsv(matrix, `docimologie-tbl-${code}.csv`)
}

// ---------------- Classeur Excel à 3 feuilles ----------------

/**
 * v2.7.0 — « Exporter les résultats — Excel (3 feuilles) », dans la
 * rubrique Terminé du déroulé : un UNIQUE fichier .xlsx contenant
 *   feuille 1 : Résultats (notes, réclamations, commentaires des pairs) ;
 *   feuille 2 : Docimologie (analyse complète) ;
 *   feuille 3 : Questionnaire (synthèse par item + réponses détaillées).
 * Le fichier est construit localement par le navigateur, sans service
 * externe (fonctionne aussi en mode réseau local sans Internet).
 */
export function exportXlsx(
  data: DashboardDTO,
  ratQs: DashboardDTO['questions'],
  appQs: DashboardDTO['questions']
) {
  const results = buildResultsMatrix(data, ratQs, appQs)
  const questionnaire = buildQuestionnaireMatrix(data)

  // Analyses docimologiques : mêmes fonctions que l'onglet Statistiques.
  const irat = ratQs.length > 0 && data.students.length > 0 ? analyzeSection(buildIratSection(data)) : null
  const trat = ratQs.length > 0 && data.teams.length > 0 ? analyzeSection(buildTratSection(data)) : null
  const app = appQs.length > 0 && data.teams.length > 0 ? analyzeSection(buildApplicationSection(data)) : null
  const comparison = irat && trat ? buildComparison(irat, trat) : null
  const flagged = flagQuestions(
    [
      { kind: 'irat', analysis: irat },
      { kind: 'trat', analysis: trat },
      { kind: 'application', analysis: app },
    ].filter((s): s is { kind: 'irat' | 'trat' | 'application'; analysis: SectionAnalysis } => s.analysis !== null)
  )
  const docimology = buildDocimologyMatrix(data, irat, trat, app, comparison, flagged)

  // Neutralisation des formules pour les chaînes Excel (même règle que le CSV)
  const neutralize = (m: MatrixResult): MatrixResult => ({
    rows: m.rows.map((r) =>
      r.map((c) =>
        typeof c === 'string' && /^[=+\-@\t\r]/.test(c) ? `'${c}` : c
      )
    ),
    boldRows: m.boldRows,
  })

  const blob = buildXlsx([
    {
      name: t('Résultats'),
      rows: neutralize(results).rows,
      boldRows: results.boldRows,
      colWidths: { 0: 22, 1: 14 },
    },
    {
      name: t('Docimologie'),
      rows: neutralize(docimology).rows,
      boldRows: docimology.boldRows,
      colWidths: { 0: 18, 1: 14, 2: 46 },
    },
    {
      name: t('Questionnaire'),
      rows: neutralize(questionnaire).rows,
      boldRows: questionnaire.boldRows,
      colWidths: { 0: 20, 1: 12, 2: 60 },
    },
  ])
  downloadBlob(blob, `resultats-tbl-${data.session.code}.xlsx`)
}

// v3.0.0 — Pouls de la séance en direct (étudiants actifs, charge).
function LiveStatsCard() {
  const { t } = useI18n()
  const [stats, setStats] = useState<{ activeStudents: number; requestsPerMinute: number } | null>(null)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const res = await fetch('/api/config?live=1', { cache: 'no-store' })
        if (res.ok && alive) {
          const d = (await res.json()) as { live?: { activeStudents?: number; requestsPerMinute?: number } }
          if (d.live) {
            setStats({
              activeStudents: d.live.activeStudents ?? 0,
              requestsPerMinute: d.live.requestsPerMinute ?? 0,
            })
          }
        }
      } catch {
        // indicateur silencieux : jamais bloquant
      }
    }
    void tick()
    const id = setInterval(tick, 10_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
      <div className="flex items-center gap-3">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
        </span>
        <p className="text-sm font-bold text-emerald-900">{t('Pouls de la séance (en direct)')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-emerald-900">
        <span>
          <strong className="text-lg">{stats?.activeStudents ?? '…'}</strong>{' '}
          {t('étudiant(s) actif(s)')}
        </span>
        <span>
          <strong className="text-lg">{stats?.requestsPerMinute ?? '…'}</strong>{' '}
          {t('requêtes / minute')}
        </span>
      </div>
    </section>
  )
}
