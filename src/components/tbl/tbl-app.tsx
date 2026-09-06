'use client'

import { useEffect, useState } from 'react'
import {
  GraduationCap,
  Smartphone,
  Users,
  ChevronDown,
  ListChecks,
  UserCheck,
  MessageSquareWarning,
  Presentation,
  Puzzle,
  HeartHandshake,
  ClipboardCheck,
  ArrowLeft,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { initLangFromStorage, useI18n } from '@/lib/i18n'
import { LangPicker } from './lang-picker'

type Role = 'home' | 'teacher' | 'student'

// Libellés français = clés de traduction (traduits au rendu)
const TBL_STEPS = [
  {
    icon: ClipboardCheck,
    title: '1. Préparation avant le cours',
    text: 'Les étudiants préparent le sujet chez eux (lecture, vidéo…). C’est le seul travail hors application.',
  },
  {
    icon: UserCheck,
    title: '2. Test individuel — iRAT',
    text: 'Chaque étudiant répond seul aux mêmes questions sur son téléphone. L’application calcule les scores.',
  },
  {
    icon: Users,
    title: '3. Test en équipe — tRAT',
    text: 'Mêmes questions, mais l’équipe discute et répond ensemble. Feedback immédiat façon « carte à gratter » : 4, 2, 1 ou 0 point selon la tentative.',
  },
  {
    icon: MessageSquareWarning,
    title: '4. Réclamations',
    text: 'Les équipes peuvent contester une réponse avec une justification écrite. Vous acceptez ou refusez.',
  },
  {
    icon: Presentation,
    title: '5. Feedback du professeur',
    text: 'Mini-cours ciblé : l’application vous montre les questions les moins réussies pour orienter vos explications.',
  },
  {
    icon: Puzzle,
    title: '6. Exercices d’application',
    text: 'Toutes les équipes résolvent le même problème, choisissent une réponse, puis les réponses sont révélées simultanément pour lancer le débat.',
  },
  {
    icon: HeartHandshake,
    title: '7. Évaluation par les pairs',
    text: 'Chaque étudiant note la contribution de ses coéquipiers. Vous obtenez les moyennes et commentaires.',
  },
]

export function TblApp() {
  const [role, setRole] = useState<Role>('home')
  const { t } = useI18n()

  // Restaure la langue choisie (après hydratation → aucun décalage)
  useEffect(() => {
    initLangFromStorage()
  }, [])

  return (
    <div className="flex min-h-screen flex-col bg-stone-50">
      <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-2 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[15px] font-bold leading-none tracking-tight text-stone-900">
                TBL Live
              </p>
              <p className="hidden text-[11px] leading-tight text-stone-500 sm:block">
                Team-Based Learning
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <LangPicker />
            {role !== 'home' && (
              <Button variant="ghost" size="sm" onClick={() => setRole('home')}>
                <ArrowLeft className="mr-1 h-4 w-4 rtl:rotate-180" />
                {t('Accueil')}
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {role === 'home' && <HomeView onSelect={setRole} />}
        {role === 'teacher' && <TeacherLazy onExit={() => setRole('home')} />}
        {role === 'student' && <StudentLazy onExit={() => setRole('home')} />}
      </main>

      <footer className="mt-auto border-t border-stone-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-1 px-4 py-4 text-center text-xs text-stone-500 sm:flex-row sm:text-start">
          <p>
            {t(
              'TBL Live — Application libre d’apprentissage en équipe, pour l’enseignement.'
            )}
          </p>
          <p>
            {t(
              'iRAT · tRAT · Réclamations · Application · Évaluation par les pairs'
            )}
          </p>
        </div>
      </footer>
    </div>
  )
}

// Chargement différé pour garder le bundle d'accueil léger
import { lazy, Suspense } from 'react'
const TeacherPanel = lazy(() =>
  import('./teacher-panel').then((m) => ({ default: m.TeacherPanel }))
)
const StudentPanel = lazy(() =>
  import('./student-panel').then((m) => ({ default: m.StudentPanel }))
)

function TeacherLazy({ onExit }: { onExit: () => void }) {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <TeacherPanel onExit={onExit} />
    </Suspense>
  )
}

function StudentLazy({ onExit }: { onExit: () => void }) {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <StudentPanel onExit={onExit} />
    </Suspense>
  )
}

function LoadingBlock() {
  return (
    <div className="flex h-64 items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600" />
    </div>
  )
}

// ---------------- Accueil ----------------

function HomeView({ onSelect }: { onSelect: (r: Role) => void }) {
  const { t } = useI18n()
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section className="text-center">
        <h1 className="text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
          {t('L’apprentissage en équipe,')}{' '}
          <span className="text-emerald-600">{t('simplement')}</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-stone-600">
          {t(
            'Toute la méthode TBL (Team-Based Learning) dans votre poche : tests individuels et par équipe, réclamations, exercices d’application et évaluation par les pairs — en temps réel, sur n’importe quel téléphone.'
          )}
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <button
          onClick={() => onSelect('teacher')}
          className={cn(
            'group flex flex-col items-start gap-3 rounded-2xl border-2 border-stone-200 bg-white p-6 text-start shadow-sm transition-all',
            'hover:-translate-y-0.5 hover:border-emerald-500 hover:shadow-lg active:translate-y-0'
          )}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
            <GraduationCap className="h-6 w-6" />
          </span>
          <span>
            <span className="block text-lg font-bold text-stone-900">
              {t('Je suis enseignant')}
            </span>
            <span className="mt-1 block text-sm leading-relaxed text-stone-600">
              {t(
                'Créez une séance TBL, composez vos questions et pilotez toutes les étapes en direct depuis votre tableau de bord.'
              )}
            </span>
          </span>
        </button>

        <button
          onClick={() => onSelect('student')}
          className={cn(
            'group flex flex-col items-start gap-3 rounded-2xl border-2 border-stone-200 bg-white p-6 text-start shadow-sm transition-all',
            'hover:-translate-y-0.5 hover:border-amber-500 hover:shadow-lg active:translate-y-0'
          )}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <Users className="h-6 w-6" />
          </span>
          <span>
            <span className="block text-lg font-bold text-stone-900">
              {t('Je suis étudiant')}
            </span>
            <span className="mt-1 block text-sm leading-relaxed text-stone-600">
              {t(
                'Rejoignez la séance de votre professeur avec le code affiché au tableau et participez depuis votre téléphone.'
              )}
            </span>
          </span>
        </button>
      </section>

      <Collapsible>
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-xl border border-stone-200 bg-white px-4 py-3 text-start text-sm font-semibold text-stone-800 hover:bg-stone-50">
          <span className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-emerald-600" />
            {t('Les 7 étapes de la méthode TBL')}
          </span>
          <ChevronDown className="h-4 w-4 text-stone-500 rtl:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 space-y-2 rounded-xl border border-stone-200 bg-white p-4">
            {TBL_STEPS.map((s) => (
              <div key={s.title} className="flex gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                  <s.icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-stone-900">{t(s.title)}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-stone-600">{t(s.text)}</p>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Collapsible>
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-xl border border-stone-200 bg-white px-4 py-3 text-start text-sm font-semibold text-stone-800 hover:bg-stone-50">
          <span className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-emerald-600" />
            {t('Installer l’application sur votre téléphone (gratuit)')}
          </span>
          <ChevronDown className="h-4 w-4 text-stone-500 rtl:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 space-y-3 rounded-xl border border-stone-200 bg-white p-4 text-sm leading-relaxed text-stone-700">
            <p>
              <strong>{t('Sur Android (Chrome) :')}</strong>{' '}
              {t(
                'appuyez sur le menu ⋮ puis « Installer l’application » ou « Ajouter à l’écran d’accueil ».'
              )}
            </p>
            <p>
              <strong>{t('Sur iPhone (Safari) :')}</strong>{' '}
              {t('appuyez sur le bouton Partager (carré avec flèche), puis « Sur l’écran d’accueil ».')}
            </p>
            <p className="text-stone-500">
              {t(
                'L’application s’ouvrira alors en plein écran, comme une vraie application, sans passer par un magasin d’applications.'
              )}
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
