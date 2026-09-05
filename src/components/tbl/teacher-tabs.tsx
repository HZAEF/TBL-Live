'use client'

import { useState } from 'react'
import { Check, Download, Plus, Save, Trash2, Users, Wand2, X } from 'lucide-react'
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
import type { DashboardDTO } from '@/lib/tbl-types'
import { gradeForStudent, fmtNote } from '@/lib/grades'
import { choiceLetter } from './shared'
import { QuestionEditor, emptyQuestion } from './question-editor'
import type { DraftQuestion } from '@/lib/tbl-types'

type ManageFn = (action: string, extra?: Record<string, unknown>) => Promise<boolean>

// ================= Onglet ÉQUIPES =================

export function TeamsTab({ data, manage }: { data: DashboardDTO; manage: ManageFn }) {
  const [teamCount, setTeamCount] = useState(String(data.teams.length))
  const { toast } = useToast()
  const unassigned = data.students.filter((s) => !s.teamId)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-stone-200 bg-white p-4">
        <div>
          <Label htmlFor="team-count" className="text-sm">
            Nombre d&apos;équipes
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
          <p className="mt-1 text-xs text-stone-500">Entre 2 et 50.</p>
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
          Appliquer
        </Button>
        <Button
          variant="outline"
          className="h-10 border-amber-400 text-amber-800 hover:bg-amber-50"
          onClick={async () => {
            if (
              window.confirm(
                'Répartir automatiquement tous les étudiants sans équipe ? (À faire idéalement avant les tests)'
              )
            ) {
              const ok = await manage('auto_assign')
              if (ok) toast({ title: 'Répartition effectuée' })
            }
          }}
        >
          <Wand2 className="mr-2 h-4 w-4" />
          Répartir automatiquement {unassigned.length > 0 && `(${unassigned.length} sans équipe)`}
        </Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {data.teams.map((t) => {
          const members = data.students.filter((s) => s.teamId === t.id)
          return (
            <div key={t.id} className="rounded-2xl border border-stone-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <TeamNameEditor team={t} manage={manage} />
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-600">
                  <Users className="h-3.5 w-3.5" />
                  {members.length}
                </span>
              </div>
              <div className="space-y-2">
                {members.length === 0 && (
                  <p className="text-sm text-stone-400">Aucun membre (pour l&apos;instant)</p>
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
                          title="Code de reprise personnel de l’étudiant (à lui redonner s’il l’a perdu)"
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
                          <SelectItem value="none">Sans équipe</SelectItem>
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
                              `Retirer ${m.name} de la séance ? Ses réponses seront supprimées.`
                            )
                          ) {
                            manage('remove_student', { studentId: m.id })
                          }
                        }}
                        aria-label={`Retirer ${m.name}`}
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
            {unassigned.length} étudiant(s) sans équipe
          </p>
          <p className="mt-1 text-sm text-amber-800">
            {unassigned.map((s) => s.name).join(', ')} — utilisez le menu « Sans équipe » ci-dessus
            ou la répartition automatique.
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
          Des réponses existent déjà ({data.iratAnswers.length} iRAT, {data.tratAnswers.length}{' '}
          tRAT, {data.appAnswers.length} application). Modifier ou supprimer des questions peut
          rendre les résultats incohérents — à éviter en cours de séance.
        </p>
      )}

      <p className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">
        Les questions sont réparties en deux listes indépendantes : les questions de préparation
        (utilisées pour l&apos;iRAT <em>puis</em> le tRAT) et les cas cliniques d&apos;application
        (affichés un par un aux équipes, avec révélation automatique des réponses).
      </p>

      {/* --- Questions iRAT / tRAT --- */}
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-stone-800">
          <span className="rounded-full bg-amber-500 px-2.5 py-0.5 text-xs font-bold text-white">
            iRAT / tRAT
          </span>
          {ratQs.length} question{ratQs.length > 1 ? 's' : ''} de préparation
        </h3>
        {ratQs.length === 0 && (
          <p className="rounded-2xl border border-dashed border-amber-300 bg-amber-50/50 p-4 text-center text-sm text-stone-500">
            Aucune question de préparation. Elles sont indispensables pour lancer l&apos;iRAT.
          </p>
        )}
        {ratQs.map((q, i) => (
          <ExistingQuestionEditor key={q.id} index={i} question={q} manage={manage} />
        ))}
      </section>

      {/* --- Cas cliniques d'application --- */}
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-stone-800">
          <span className="rounded-full bg-lime-600 px-2.5 py-0.5 text-xs font-bold text-white">
            Application
          </span>
          {data.cases.length} cas clinique{data.cases.length > 1 ? 's' : ''} · {appQs.filter((q) => q.caseId).length} QCU
        </h3>
        {data.cases.length === 0 && (
          <p className="rounded-2xl border border-dashed border-lime-300 bg-lime-50/50 p-4 text-center text-sm text-stone-500">
            Aucun cas clinique pour le moment. Chaque cas contient un énoncé et 3 à 5 QCU,
            affichés un par un aux équipes.
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
              window.confirm(
                'Ajouter un nouveau cas clinique (énoncé + QCU) ?'
              )
            ) {
              manage('add_case', { title: `Cas clinique ${data.cases.length + 1}`, intro: '' })
            }
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Ajouter un cas clinique
        </Button>

        {/* Ancien format : exercices libres */}
        {freeAppQs.length > 0 && (
          <div className="space-y-2 rounded-2xl border border-dashed border-stone-300 bg-stone-50/50 p-3">
            <p className="text-xs font-semibold text-stone-500">
              Exercices d&apos;application isolés (ancien format — affichés ensemble sur une
              seule page aux étudiants) :
            </p>
            {freeAppQs.map((q, i) => (
              <ExistingQuestionEditor key={q.id} index={i} question={q} manage={manage} prefix="Exercice" />
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
            Ajouter cette question
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
          Question iRAT / tRAT
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

  return (
    <div className="space-y-2 rounded-2xl border-2 border-lime-200 bg-lime-50/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-stone-800">Application {index + 1}</p>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-stone-400 hover:bg-red-50 hover:text-red-600"
          onClick={() => {
            if (
              window.confirm(
                `Supprimer « ${kase.title} » ? Ses ${questions.length} QCU et leurs réponses seront aussi supprimées.`
              )
            ) {
              manage('delete_case', { id: kase.id })
            }
          }}
          aria-label={`Supprimer le cas ${index + 1}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Titre du cas (ex. : Cas clinique — Mme A., 62 ans, douleur thoracique)"
        className="h-10 border-lime-300"
      />
      <Textarea
        value={intro}
        onChange={(e) => setIntro(e.target.value)}
        placeholder="Énoncé du cas : contexte, patient, données cliniques ou biologiques…"
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
          Enregistrer le cas
        </Button>
      )}

      {questions.map((q, qi) => (
        <ExistingQuestionEditor
          key={q.id}
          index={qi}
          question={q}
          manage={manage}
          prefix="QCU"
        />
      ))}

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
            Ajouter cette QCU au cas
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
          Ajouter une QCU à ce cas
        </Button>
      )}
      <p className="text-center text-xs text-stone-500">
        {questions.length} QCU — 3 à 5 conseillées par cas
        {hasAnswers && ' · des réponses existent déjà'}
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
}: {
  index: number
  question: DashboardDTO['questions'][number]
  manage: ManageFn
  prefix?: string
  hidePhaseToggle?: boolean
}) {
  const [draft, setDraft] = useState<DraftQuestion>({
    text: question.text,
    choices: question.choices,
    correct: question.correct ?? 0,
    phase: question.phase,
  })
  const dirty =
    draft.text !== question.text ||
    JSON.stringify(draft.choices) !== JSON.stringify(question.choices) ||
    draft.correct !== question.correct ||
    draft.phase !== question.phase
  return (
    <div className="space-y-2">
      <QuestionEditor
        index={index}
        value={draft}
        onChange={setDraft}
        hidePhaseToggle={hidePhaseToggle || question.caseId !== null}
        prefix={prefix ?? (question.phase === 'application' ? 'Exercice' : 'Question')}
        onDelete={() => {
          if (window.confirm('Supprimer cette question ? Ses réponses seront aussi supprimées.')) {
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
          Enregistrer les modifications
        </Button>
      )}
    </div>
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
  if (data.students.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
        Les résultats apparaîtront ici dès que des étudiants auront répondu.
      </p>
    )
  }
  return (
    <div className="space-y-6">
      {/* Note finale sur 20 */}
      <FinalGradesSection data={data} finished={data.session.status === 'finished'} />

      {/* iRAT */}
      {ratQs.length > 0 && (
        <ResultSection title="Test individuel (iRAT) — 1 point par bonne réponse">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-xs text-stone-500">
                  <th className="py-2 pr-3 font-medium">Étudiant</th>
                  <th className="py-2 pr-3 font-medium">Équipe</th>
                  {ratQs.map((_, i) => (
                    <th key={i} className="py-2 px-1.5 text-center font-medium">
                      Q{i + 1}
                    </th>
                  ))}
                  <th className="py-2 pl-3 text-center font-medium">Total</th>
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
        <ResultSection title="Test en équipe (tRAT) — barème 4 / 2 / 1 / 0 selon la tentative">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-xs text-stone-500">
                  <th className="py-2 pr-3 font-medium">Équipe</th>
                  {ratQs.map((_, i) => (
                    <th key={i} className="py-2 px-1.5 text-center font-medium">
                      Q{i + 1}
                    </th>
                  ))}
                  <th className="py-2 pl-3 text-center font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.teams.map((t) => {
                  const total = data.tratAnswers
                    .filter((a) => a.teamId === t.id)
                    .reduce((sum, a) => sum + a.score, 0)
                  return (
                    <tr key={t.id} className="border-b border-stone-100">
                      <td className="py-2 pr-3 font-medium text-stone-800">{t.name}</td>
                      {ratQs.map((q) => {
                        const answers = data.tratAnswers.filter(
                          (x) => x.questionId === q.id && x.teamId === t.id
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
                                  {best ? `${attempts}ᵉ essai` : 'échoué'}
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
        <ResultSection title="Évaluation par les pairs — note moyenne reçue (sur 5)">
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
        Exporter tous les résultats (CSV pour Excel)
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
  const caseById = new Map(data.cases.map((c) => [c.id, c]))
  const groups: { label: string; questions: DashboardDTO['questions'] }[] = []
  for (const c of data.cases) {
    const qs = appQs.filter((q) => q.caseId === c.id)
    if (qs.length > 0) groups.push({ label: `Application ${c.order + 1} — ${c.title}`, questions: qs })
  }
  const free = appQs.filter((q) => !q.caseId || !caseById.has(q.caseId))
  if (free.length > 0) {
    groups.push({ label: "Exercices d'application (ancien format)", questions: free })
  }
  return (
    <>
      {groups.map((g) => (
        <ResultSection key={g.label} title={`${g.label} — choix des équipes`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[320px] text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-xs text-stone-500">
                  <th className="py-2 pr-3 font-medium">Équipe</th>
                  {g.questions.map((_, i) => (
                    <th key={i} className="py-2 px-1.5 text-center font-medium">
                      Q{i + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.teams.map((t) => (
                  <tr key={t.id} className="border-b border-stone-100">
                    <td className="py-2 pr-3 font-medium text-stone-800">{t.name}</td>
                    {g.questions.map((q) => {
                      const a = data.appAnswers.find(
                        (x) => x.questionId === q.id && x.teamId === t.id
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
              <p className="text-xs font-semibold text-stone-500">Justifications des équipes :</p>
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
  const grades = data.students.map((s) => ({ s, g: gradeForStudent(data, s.id) }))
  const anyGrade = grades.some(({ g }) => g.final !== null)
  if (!anyGrade) return null

  return (
    <ResultSection title="Note finale sur 20 — iRAT 25 % · tRAT 25 % · Application 35 % · Pairs 15 %">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs text-stone-500">
              <th className="py-2 pr-3 font-medium">Étudiant</th>
              <th className="py-2 pr-3 font-medium">Équipe</th>
              <th className="py-2 px-1.5 text-center font-medium">
                iRAT
                <span className="block text-[10px] font-normal">25 %</span>
              </th>
              <th className="py-2 px-1.5 text-center font-medium">
                tRAT
                <span className="block text-[10px] font-normal">25 %</span>
              </th>
              <th className="py-2 px-1.5 text-center font-medium">
                Application
                <span className="block text-[10px] font-normal">35 %</span>
              </th>
              <th className="py-2 px-1.5 text-center font-medium">
                Pairs
                <span className="block text-[10px] font-normal">15 %</span>
              </th>
              <th className="py-2 pl-3 text-center font-medium">Note finale</th>
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
        Chaque composante est d&apos;abord ramenée sur 20 (iRAT : 1 point par bonne réponse ; tRAT :
        barème 4/2/1/0 ; application : réponses correctes de l&apos;équipe ; pairs : moyenne reçue
        sur 5). Si une composante est indisponible — par exemple aucun exercice
        d&apos;application ou aucune évaluation reçue — son poids est automatiquement redistribué
        sur les autres (colonne « — »).{' '}
        {!finished && (
          <span className="font-medium text-amber-700">
            Séance en cours : ces notes sont provisoires.
          </span>
        )}
      </p>
    </ResultSection>
  )
}

// ================= Onglet RÉCLAMATIONS =================

export function AppealsTab({ data, manage }: { data: DashboardDTO; manage: ManageFn }) {
  // Les réclamations portent toujours sur les questions RAT (iRAT/tRAT) :
  // on numérote donc dans cette liste, pas dans la liste complète.
  const ratQs = data.questions.filter((q) => q.phase === 'rat')
  if (data.appeals.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
        Aucune réclamation pour le moment. Pendant la phase « Réclamations », les équipes peuvent
        contester une réponse directement depuis leur téléphone.
      </p>
    )
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-stone-500">
        Accepter une réclamation donne automatiquement les 4 points du tRAT à l&apos;équipe pour
        cette question.
      </p>
      {data.appeals.map((a) => {
        const team = data.teams.find((t) => t.id === a.teamId)
        const question = ratQs.find((q) => q.id === a.questionId)
        const qi = question ? ratQs.indexOf(question) + 1 : '?'
        return (
          <div key={a.id} className="rounded-2xl border border-stone-200 bg-white p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                {team?.name ?? 'Équipe ?'}
              </span>
              <span className="text-xs text-stone-500">
                Question {qi} : {(question?.text ?? '').slice(0, 60)}
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
                  Accepter (+4 pts)
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 flex-1 border-red-300 text-red-600 hover:bg-red-50"
                  onClick={() => manage('resolve_appeal', { id: a.id, status: 'rejected' })}
                >
                  <X className="mr-1.5 h-4 w-4" />
                  Refuser
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
                    <Check className="h-3.5 w-3.5" /> Acceptée (+4 pts)
                  </>
                ) : (
                  <>
                    <X className="h-3.5 w-3.5" /> Refusée
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

// ================= Export CSV =================

export function exportCsv(
  data: DashboardDTO,
  ratQs: DashboardDTO['questions'],
  appQs: DashboardDTO['questions']
) {
  const esc = (v: string | number | null | undefined) => {
    let s = String(v ?? '')
    // Anti « CSV injection » : un texte libre saisi par un étudiant (nom,
    // justification, commentaire) qui commencerait par =, +, -, @, une
    // tabulation ou un retour chariot pourrait être interprété comme une
    // formule par Excel. On le neutralise d’une apostrophe initiale.
    if (/^[=+\-@\t\r]/.test(s)) {
      s = "'" + s
    }
    return `"${s.replace(/"/g, '""')}"`
  }
  const rows: string[] = []

  // Tableau 1 : résultats par étudiant
  // NB : les scores s'écrivent « 10 sur 10 » (et non « 10/10 ») pour éviter
  // la conversion automatique en date par Excel (10/10 → 10-oct).
  const caseById = new Map(data.cases.map((c) => [c.id, c]))
  const appColumnLabel = (q: DashboardDTO['questions'][number], i: number) => {
    const c = q.caseId ? caseById.get(q.caseId) : undefined
    return c ? `Application ${c.order + 1} Q${appQs.filter((x) => x.caseId === q.caseId).indexOf(q) + 1}` : `Application ex.${i + 1}`
  }
  rows.push(['Étudiant', 'Équipe', ...ratQs.map((_, i) => `iRAT Q${i + 1}`), 'iRAT total (sur ' + ratQs.length + ')', 'tRAT équipe (total sur ' + ratQs.length * 4 + ')', ...appQs.map((q, i) => appColumnLabel(q, i)), 'Note pairs (moyenne sur 5)', 'iRAT sur 20 (25%)', 'tRAT sur 20 (25%)', 'Application sur 20 (35%)', 'Pairs sur 20 (15%)', 'NOTE FINALE sur 20'].map(esc).join(';'))
  for (const s of data.students) {
    const team = data.teams.find((t) => t.id === s.teamId)
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
      const a = team
        ? data.appAnswers.find((x) => x.questionId === q.id && x.teamId === team.id)
        : null
      return a ? choiceLetter(a.choice) : ''
    })
    const received = data.peerEvals.filter((e) => e.evaluatedId === s.id)
    const peerAvg =
      received.length > 0
        ? (received.reduce((sum, e) => sum + e.score, 0) / received.length).toFixed(1)
        : ''
    // Notes finales sur 20 (avec virgule décimale, Excel FR)
    const g = gradeForStudent(data, s.id)
    const cells = [g.irat, g.trat, g.application, g.peer].map((c) =>
      c.note === null ? '' : c.note.toFixed(2).replace('.', ',')
    )
    const finalCell = g.final === null ? '' : g.final.toFixed(2).replace('.', ',')
    rows.push([s.name, team?.name ?? '', ...iratCells, `${iratTotal} sur ${ratQs.length}`, `${tratTotal} sur ${ratQs.length * 4}`, ...appCells, peerAvg, ...cells, finalCell].map(esc).join(';'))
  }

  rows.push('')

  // Tableau 2 : réclamations
  if (data.appeals.length > 0) {
    rows.push(['Réclamations', 'Équipe', 'Question', 'Justification', 'Décision'].map(esc).join(';'))
    for (const a of data.appeals) {
      const team = data.teams.find((t) => t.id === a.teamId)
      const q = data.questions.find((x) => x.id === a.questionId)
      rows.push(
        ['', team?.name ?? '', q?.text ?? '', a.text, a.status === 'accepted' ? 'Acceptée' : a.status === 'rejected' ? 'Refusée' : 'En attente'].map(esc).join(';')
      )
    }
    rows.push('')
  }

  // Tableau 3 : commentaires des pairs
  const withComments = data.peerEvals.filter((e) => e.comment)
  if (withComments.length > 0) {
    rows.push(['Évaluation par les pairs', 'Évaluateur', 'Évalué', 'Note', 'Commentaire'].map(esc).join(';'))
    for (const e of withComments) {
      rows.push(
        ['', data.students.find((s) => s.id === e.evaluatorId)?.name ?? '', data.students.find((s) => s.id === e.evaluatedId)?.name ?? '', String(e.score), e.comment ?? ''].map(esc).join(';')
      )
    }
  }

  // BOM UTF-8 pour Excel + séparateur « ; » (Excel francophone)
  const blob = new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `resultats-tbl-${data.session.code}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
