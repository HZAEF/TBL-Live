'use client'

import { useState } from 'react'
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

type Role = 'home' | 'teacher' | 'student'

const TBL_STEPS = [
  {
    icon: ClipboardCheck,
    title: '1. Préparation avant le cours',
    text: 'Les étudiants préparent le sujet chez eux (lecture, vidéo...). C\u2019est le seul travail hors application.',
  },
  {
    icon: UserCheck,
    title: '2. Test individuel — iRAT',
    text: 'Chaque étudiant répond seul aux mêmes questions sur son téléphone. L\u2019application calcule les scores.',
  },
  {
    icon: Users,
    title: '3. Test en équipe — tRAT',
    text: 'Mêmes questions, mais la équipe discute et répond ensemble. Feedback immédiat façon « carte à gratter » : 4, 2, 1 ou 0 point selon la tentative.',
  },
  {
    icon: MessageSquareWarning,
    title: '4. Réclamations',
    text: 'Les équipes peuvent contester une réponse avec une justification écrite. Vous acceptez ou refusez.',
  },
  {
    icon: Presentation,
    title: '5. Feedback du professeur',
    text: 'Mini-cours ciblé : l\u2019application vous montre les questions les moins réussies pour orienter vos explications.',
  },
  {
    icon: Puzzle,
    title: '6. Exercices d\u2019application',
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
  return (
    <div className="flex min-h-screen flex-col bg-stone-50">
      <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[15px] font-bold leading-none tracking-tight text-stone-900">
                TBL Live
              </p>
              <p className="text-[11px] leading-tight text-stone-500">Team-Based Learning</p>
            </div>
          </div>
          {role !== 'home' && (
            <Button variant="ghost" size="sm" onClick={() => setRole('home')}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              Accueil
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {role === 'home' && <HomeView onSelect={setRole} />}
        {role === 'teacher' && <TeacherLazy onExit={() => setRole('home')} />}
        {role === 'student' && <StudentLazy onExit={() => setRole('home')} />}
      </main>

      <footer className="mt-auto border-t border-stone-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-1 px-4 py-4 text-center text-xs text-stone-500 sm:flex-row sm:text-left">
          <p>TBL Live — Application libre d&apos;apprentissage en équipe, pour l&apos;enseignement.</p>
          <p>iRAT · tRAT · Réclamations · Application · Évaluation par les pairs</p>
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
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section className="text-center">
        <h1 className="text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
          L&apos;apprentissage en équipe, <span className="text-emerald-600">simplement</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-stone-600">
          Toute la méthode TBL (Team-Based Learning) dans votre poche : tests individuels et par
          équipe, réclamations, exercices d&apos;application et évaluation par les pairs — en temps
          réel, sur n&apos;importe quel téléphone.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <button
          onClick={() => onSelect('teacher')}
          className={cn(
            'group flex flex-col items-start gap-3 rounded-2xl border-2 border-stone-200 bg-white p-6 text-left shadow-sm transition-all',
            'hover:-translate-y-0.5 hover:border-emerald-500 hover:shadow-lg active:translate-y-0'
          )}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
            <GraduationCap className="h-6 w-6" />
          </span>
          <span>
            <span className="block text-lg font-bold text-stone-900">Je suis enseignant</span>
            <span className="mt-1 block text-sm leading-relaxed text-stone-600">
              Créez une séance TBL, composez vos questions et pilotez toutes les étapes en direct
              depuis votre tableau de bord.
            </span>
          </span>
        </button>

        <button
          onClick={() => onSelect('student')}
          className={cn(
            'group flex flex-col items-start gap-3 rounded-2xl border-2 border-stone-200 bg-white p-6 text-left shadow-sm transition-all',
            'hover:-translate-y-0.5 hover:border-amber-500 hover:shadow-lg active:translate-y-0'
          )}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <Users className="h-6 w-6" />
          </span>
          <span>
            <span className="block text-lg font-bold text-stone-900">Je suis étudiant</span>
            <span className="mt-1 block text-sm leading-relaxed text-stone-600">
              Rejoignez la séance de votre professeur avec le code affiché au tableau et
              participez depuis votre téléphone.
            </span>
          </span>
        </button>
      </section>

      <Collapsible>
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-xl border border-stone-200 bg-white px-4 py-3 text-left text-sm font-semibold text-stone-800 hover:bg-stone-50">
          <span className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-emerald-600" />
            Les 7 étapes de la méthode TBL
          </span>
          <ChevronDown className="h-4 w-4 text-stone-500" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 space-y-2 rounded-xl border border-stone-200 bg-white p-4">
            {TBL_STEPS.map((s) => (
              <div key={s.title} className="flex gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                  <s.icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-stone-900">{s.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-stone-600">{s.text}</p>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Collapsible>
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-xl border border-stone-200 bg-white px-4 py-3 text-left text-sm font-semibold text-stone-800 hover:bg-stone-50">
          <span className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-emerald-600" />
            Installer l&apos;application sur votre téléphone (gratuit)
          </span>
          <ChevronDown className="h-4 w-4 text-stone-500" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 space-y-3 rounded-xl border border-stone-200 bg-white p-4 text-sm leading-relaxed text-stone-700">
            <p>
              <strong>Sur Android (Chrome) :</strong> appuyez sur le menu ⋮ puis « Installer
              l&apos;application » ou « Ajouter à l&apos;écran d&apos;accueil ».
            </p>
            <p>
              <strong>Sur iPhone (Safari) :</strong> appuyez sur le bouton Partager (carré avec
              flèche), puis « Sur l&apos;écran d&apos;accueil ».
            </p>
            <p className="text-stone-500">
              L&apos;application s&apos;ouvrira alors en plein écran, comme une vraie application,
              sans passer par un magasin d&apos;applications.
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
