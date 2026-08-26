'use client'

import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { LETTERS, type DraftQuestion, type QuestionPhase } from '@/lib/tbl-types'

export function emptyQuestion(phase: QuestionPhase = 'rat'): DraftQuestion {
  return { text: '', choices: ['', '', '', ''], correct: 0, phase }
}

export function QuestionEditor({
  index,
  value,
  onChange,
  onDelete,
  errors,
}: {
  index: number
  value: DraftQuestion
  onChange: (q: DraftQuestion) => void
  onDelete?: () => void
  errors?: string[]
}) {
  const setChoice = (i: number, v: string) => {
    const choices = [...value.choices]
    choices[i] = v
    onChange({ ...value, choices })
  }
  const removeChoice = (i: number) => {
    if (value.choices.length <= 2) return
    const choices = value.choices.filter((_, idx) => idx !== i)
    let correct = value.correct
    if (correct === i) correct = 0
    else if (correct > i) correct -= 1
    onChange({ ...value, choices, correct })
  }
  const addChoice = () => {
    if (value.choices.length >= 6) return
    onChange({ ...value, choices: [...value.choices, ''] })
  }

  const err = (field: string) => errors?.find((e) => e.startsWith(field))
  const hasErrors = (errors && errors.length > 0) || false

  return (
    <div
      className={cn(
        'rounded-xl border-2 bg-white p-4',
        hasErrors ? 'border-red-300' : 'border-stone-200'
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-stone-800">Question {index + 1}</p>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-stone-300 text-xs font-semibold">
            <button
              type="button"
              onClick={() => onChange({ ...value, phase: 'rat' })}
              className={cn(
                'px-2.5 py-1.5',
                value.phase === 'rat'
                  ? 'bg-amber-500 text-white'
                  : 'bg-white text-stone-600 hover:bg-stone-50'
              )}
            >
              iRAT / tRAT
            </button>
            <button
              type="button"
              onClick={() => onChange({ ...value, phase: 'application' })}
              className={cn(
                'px-2.5 py-1.5',
                value.phase === 'application'
                  ? 'bg-lime-600 text-white'
                  : 'bg-white text-stone-600 hover:bg-stone-50'
              )}
            >
              Application
            </button>
          </div>
          {onDelete && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-stone-400 hover:bg-red-50 hover:text-red-600"
              onClick={onDelete}
              aria-label="Supprimer la question"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <p className="mb-1.5 text-xs font-medium text-stone-500">
        {value.phase === 'rat'
          ? 'Question de préparation (utilisée pour le test individuel PUIS le test en équipe)'
          : "Exercice d'application (résolu en équipe, révélation simultanée des réponses)"}
      </p>

      <Textarea
        value={value.text}
        onChange={(e) => onChange({ ...value, text: e.target.value })}
        placeholder="Énoncez votre question ici…"
        rows={2}
        className="mb-1 resize-none text-[15px]"
      />
      {err('text') && <p className="mb-2 text-xs text-red-600">{err('text')}</p>}

      <div className="mt-3 space-y-2">
        {value.choices.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onChange({ ...value, correct: i })}
              title="Cocher la bonne réponse"
              aria-label={`Marquer le choix ${LETTERS[i]} comme bonne réponse`}
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold transition-colors',
                value.correct === i
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : 'border-stone-300 bg-white text-stone-500 hover:border-emerald-400'
              )}
            >
              {LETTERS[i]}
            </button>
            <Input
              value={c}
              onChange={(e) => setChoice(i, e.target.value)}
              placeholder={`Choix ${LETTERS[i]}`}
              className="h-10 flex-1"
            />
            {value.choices.length > 2 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0 text-stone-300 hover:bg-red-50 hover:text-red-600"
                onClick={() => removeChoice(i)}
                aria-label={`Supprimer le choix ${LETTERS[i]}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
      </div>

      {err('choices') && <p className="mt-2 text-xs text-red-600">{err('choices')}</p>}
      {err('correct') && <p className="mt-2 text-xs text-red-600">{err('correct')}</p>}

      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-stone-500">
          La bonne réponse est entourée de <span className="font-semibold text-emerald-700">vert</span>.
        </p>
        {value.choices.length < 6 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addChoice}
            className="h-8 border-stone-300 text-stone-600"
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Choix
          </Button>
        )}
      </div>
    </div>
  )
}

// Exemple prêt à l'emploi pour découvrir l'application
export function exampleQuestions(): DraftQuestion[] {
  return [
    {
      text: 'Quel est le rôle principal de la chlorophylle dans la photosynthèse ?',
      choices: [
        'Absorber la lumière du soleil',
        'Fixer le carbone atmosphérique',
        'Transporter la sève brute',
        'Stocker l\u2019amidon',
      ],
      correct: 0,
      phase: 'rat',
    },
    {
      text: 'Quels gaz sont respectivement consommé et produit lors de la photosynthèse ?',
      choices: [
        'CO₂ consommé, O₂ produit',
        'O₂ consommé, CO₂ produit',
        'Azote consommé, O₂ produit',
        'CO₂ consommé, hydrogène produit',
      ],
      correct: 0,
      phase: 'rat',
    },
    {
      text: 'Dans quelle partie de la cellule la photosynthèse a-t-elle principalement lieu ?',
      choices: ['Les mitochondries', 'Le noyau', 'Les chloroplastes', 'La paroi cellulaire'],
      correct: 2,
      phase: 'rat',
    },
    {
      text: 'Une plante est placée sous une lumière verte. Quelle sera sa croissance comparée à une plante sous lumière blanche, et pourquoi ?',
      choices: [
        'Meilleure : le vert est la couleur la plus énergétique',
        'Identique : toutes les couleurs sont également utilisées',
        'Moins bonne : le vert est majoritairement réfléchi, peu absorbé',
        'Nulle : la photosynthèse est impossible sans lumière blanche',
      ],
      correct: 2,
      phase: 'application',
    },
  ]
}
