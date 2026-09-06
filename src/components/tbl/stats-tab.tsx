'use client'

// ============================================================
// Onglet « Statistiques » du tableau de bord enseignant :
// analyse docimologique complète (théorie classique des tests)
// des questions iRAT, tRAT, applications et cas cliniques.
// Les calculs sont dans src/lib/docimology.ts (module pur,
// validé par scripts/test-docimology.ts).
// ============================================================

import { Fragment, useMemo } from 'react'
import { AlertTriangle, BookOpen, CheckCircle2, Download, TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import type { DashboardDTO } from '@/lib/tbl-types'
import { LETTERS } from '@/lib/tbl-types'
import { t, useI18n, formatDate } from '@/lib/i18n'
import {
  alphaInterp,
  analyzeSection,
  buildApplicationSection,
  buildComparison,
  buildIratSection,
  buildTratSection,
  difficultyInterp,
  discriminationInterp,
  flagQuestions,
  fmt2,
  fmtNum,
  fmtPct,
  rpbsInterp,
  type ComparisonRow,
  type FlaggedQuestion,
  type Interp,
  type ItemAnalysis,
  type SectionAnalysis,
  type SectionKind,
  type Tone,
} from '@/lib/docimology'

// ---------- Petites aides de rendu ----------

const TONE_TEXT: Record<Tone, string> = {
  good: 'text-emerald-600',
  ok: 'text-lime-600',
  warn: 'text-amber-600',
  bad: 'text-red-500',
  neutral: 'text-stone-400',
}

const TONE_BG: Record<Tone, string> = {
  good: 'bg-emerald-100 text-emerald-700',
  ok: 'bg-lime-100 text-lime-700',
  warn: 'bg-amber-100 text-amber-700',
  bad: 'bg-red-100 text-red-600',
  neutral: 'bg-stone-100 text-stone-500',
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-bold text-stone-800">{title}</h3>
      {children}
    </section>
  )
}

/** Valeur + mini-libellé d'interprétation coloré. */
function StatCell({
  value,
  interp,
  tone,
}: {
  value: string
  interp?: Interp | null
  tone?: Tone
}) {
  const { t } = useI18n()
  return (
    <span className="inline-flex flex-col items-center leading-tight">
      <span className="font-bold text-stone-800">{value}</span>
      {interp && (
        <span className={cn('text-[10px]', TONE_TEXT[interp.tone])}>{t(interp.label)}</span>
      )}
      {!interp && tone && <span className={cn('text-[10px]', TONE_TEXT[tone])}>&nbsp;</span>}
    </span>
  )
}

/** Répartition des choix : « A 63 % · B 25 % · … » (bonne réponse en vert). */
function OptionsCell({ item }: { item: ItemAnalysis }) {
  const { t } = useI18n()
  const n = item.n
  return (
    <div className="flex flex-wrap justify-center gap-x-2 gap-y-0.5 text-[10px] leading-tight">
      {item.options.map((o) => {
        const dead = !o.isCorrect && n >= 8 && o.pct !== null && o.pct < 0.05
        return (
          <span
            key={o.index}
            title={t('{n} réponse(s)', { n: o.count })}
            className={cn(
              o.isCorrect
                ? 'font-bold text-emerald-700'
                : dead
                  ? 'text-stone-300 line-through'
                  : 'text-stone-600'
            )}
          >
            {o.label} {o.pct !== null ? Math.round(o.pct * 100) + ' %' : '—'}
          </span>
        )
      })}
      {item.nMissing > 0 && (
        <span className="text-stone-400" title={t("n'ont pas répondu")}>
          {t('sans rép. {n}', { n: item.nMissing })}
        </span>
      )}
    </div>
  )
}

/** Répartition IF-AT d'une question tRAT : nb d'équipes à 4 / 2 / 1 / 0 point. */
function IfatCell({ item }: { item: ItemAnalysis }) {
  const { t } = useI18n()
  if (!item.ifat) return <span className="text-stone-300">—</span>
  const cells: [string, number][] = [
    [t('4 pts'), item.ifat.c4],
    [t('2 pts'), item.ifat.c2],
    [t('1 pt'), item.ifat.c1],
    [t('0 pt'), item.ifat.c0],
  ]
  return (
    <span className="inline-flex gap-1">
      {cells.map(([label, count]) => (
        <span
          key={label}
          className="inline-flex flex-col items-center rounded bg-stone-100 px-1.5 py-0.5 leading-tight"
        >
          <span className="text-[10px] font-bold text-stone-600">{label}</span>
          <span className="text-[11px] font-bold text-stone-800">{count}</span>
        </span>
      ))}
    </span>
  )
}

/** Mini histogramme des notes ramenées sur 20. */
function DistributionBars({ dist }: { dist: { label: string; count: number }[] }) {
  const max = Math.max(1, ...dist.map((b) => b.count))
  return (
    <div className="space-y-1">
      {dist.map((b) => (
        <div key={b.label} className="flex items-center gap-2 text-[11px]">
          <span className="w-16 shrink-0 text-stone-500">{b.label}</span>
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-stone-100">
            <div
              className="h-3 rounded-full bg-emerald-400"
              style={{ width: `${(b.count / max) * 100}%` }}
            />
          </div>
          <span className="w-5 text-right font-semibold text-stone-700">{b.count}</span>
        </div>
      ))}
    </div>
  )
}

// ---------- Glossaire ----------

function Glossary() {
  const { t } = useI18n()
  return (
    <Collapsible>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-start text-sm font-semibold text-stone-700 hover:bg-stone-50">
        <BookOpen className="h-4 w-4 text-emerald-600" />
        {t('Comprendre les indices docimologiques')}
        <span className="ms-auto text-xs font-normal text-stone-400">
          {t('cliquer pour déplier')}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <dl className="mt-2 space-y-3 rounded-2xl border border-stone-200 bg-white p-4 text-xs leading-relaxed text-stone-600">
          <div>
            <dt className="font-bold text-stone-800">{t('Indice de difficulté (p)')}</dt>
            <dd>
              {t(
                'Proportion de répondants qui choisissent la bonne réponse (p = 0,62 → 62 % de réussite). Zone recommandée : 0,30 à 0,90 ; un test bien calibré vise une moyenne autour de 0,50 à 0,75. p très élevé = question trop facile (peu informative) ; p très bas = question très difficile.'
              )}
            </dd>
          </div>
          <div>
            <dt className="font-bold text-stone-800">{t('Indice de discrimination (D)')}</dt>
            <dd>
              {t(
                'Écart de réussite entre les 27 % de répondants les plus forts et les 27 % les plus faibles (sur le score total). D ≥ 0,30 : la question sépare bien forts et faibles ; D < 0,20 : à réviser ; D négatif : les plus faibles réussissent mieux — défaut sérieux (question ambiguë ou erronée).'
              )}
            </dd>
          </div>
          <div>
            <dt className="font-bold text-stone-800">{t('Corrélation point-bisériale (r pbs)')}</dt>
            <dd>
              {t(
                'Lien entre la réussite à la question et le score au reste du test (−1 à +1). ≥ 0,30 souhaité ; < 0,20 : la question mesure autre chose que le reste du test.'
              )}
            </dd>
          </div>
          <div>
            <dt className="font-bold text-stone-800">
              {t('Fidélité (KR-20 / alpha de Cronbach)')}
            </dt>
            <dd>
              {t(
                'Homogénéité de l’ensemble du test (0 à 1). ≥ 0,70 acceptable en classe. Avec peu de questions (< 10) ou de petits effectifs, un alpha modeste est normal — il s’interprète avec prudence.'
              )}
            </dd>
          </div>
          <div>
            <dt className="font-bold text-stone-800">
              {t('Erreur standard de mesure (SEM)')}
            </dt>
            <dd>
              {t(
                'Marge d’erreur sur le score d’un répondant : score observé ± SEM. Le SEM diminue quand la fidélité augmente.'
              )}
            </dd>
          </div>
          <div>
            <dt className="font-bold text-stone-800">{t('Analyse des distracteurs')}</dt>
            <dd>
              {t(
                'Répartition des choix pour chaque option. Un distracteur choisi par moins de 5 % des répondants (barré dans les tableaux) ne remplit pas son rôle : à réécrire ou remplacer. Au tRAT, l’analyse porte sur le choix du 1ᵉʳ essai (avant grattage).'
              )}
            </dd>
          </div>
          <p className="rounded-xl bg-stone-50 p-3 text-[11px] text-stone-500">
            {t(
              'Seuils usuels de la docimologie (Ebel & Frisbie ; Nunnally) à titre indicatif : avec moins de ~10 répondants — ou moins de ~6 équipes — D, r pbs et alpha perdent de la précision et s’interprètent comme des tendances.'
            )}
          </p>
        </dl>
      </CollapsibleContent>
    </Collapsible>
  )
}

// ---------- Cartes de synthèse ----------

function SynthesisCard({ kind, analysis }: { kind: SectionKind; analysis: SectionAnalysis }) {
  const { t } = useI18n()
  const titles: Record<SectionKind, string> = {
    irat: 'Test individuel (iRAT)',
    trat: 'Test en équipe (tRAT)',
    application: 'Cas cliniques d’application',
  }
  const tst = analysis.test
  const small = tst.n < 10
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4">
      <h4 className="text-sm font-bold text-stone-800">{t(titles[kind])}</h4>
      <p className="mb-2 text-[11px] text-stone-500">
        {tst.n} {t(analysis.data.unitLabel)} · {t('{k} question(s)', { k: tst.k })} · max{' '}
        {tst.maxScore} pts
      </p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <div className="col-span-2 flex items-baseline justify-between border-b border-stone-100 pb-1">
          <dt className="text-stone-500">{t('Moyenne')}</dt>
          <dd className="font-bold text-stone-800">
            {fmtNum(tst.mean)} pts
            <span className="ml-1.5 font-normal text-stone-500">
              ({fmtNum(tst.mean20)}/20)
            </span>
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-stone-500">{t('Écart-type')}</dt>
          <dd className="font-semibold text-stone-700">{fmtNum(tst.sd)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-stone-500">{t('Médiane')}</dt>
          <dd className="font-semibold text-stone-700">{fmtNum(tst.median)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-stone-500">{t('Min – Max')}</dt>
          <dd className="font-semibold text-stone-700">
            {fmtNum(tst.min, 0)} – {fmtNum(tst.max, 0)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-stone-500">SEM</dt>
          <dd className="font-semibold text-stone-700">{fmtNum(tst.sem, 2)}</dd>
        </div>
        <div className="col-span-2 flex items-center justify-between border-t border-stone-100 pt-1.5">
          <dt className="text-stone-500">{t('Fidélité (alpha)')}</dt>
          <dd className="flex items-center gap-2">
            <span className="font-bold text-stone-800">{fmt2(tst.alpha)}</span>
            {tst.alpha !== null && (
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-bold',
                  TONE_BG[alphaInterp(tst.alpha).tone]
                )}
              >
                {t(alphaInterp(tst.alpha).label)}
              </span>
            )}
          </dd>
        </div>
      </dl>
      <div className="mt-3 border-t border-stone-100 pt-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
          {t('Répartition / 20')}
        </p>
        <DistributionBars dist={tst.distribution} />
      </div>
      {small && (
        <p className="mt-2 text-[10px] italic text-amber-600">
          {t('Effectif réduit : indices indicatifs.')}
        </p>
      )}
    </div>
  )
}

// ---------- Tableau générique des questions ----------

function ItemsTable({
  kind,
  analysis,
}: {
  kind: SectionKind
  analysis: SectionAnalysis
}) {
  const { t } = useI18n()
  const isTrat = kind === 'trat'
  const isApp = kind === 'application'
  const items = analysis.items

  // Libellés composés « Application 2 Q3 » → mot Application traduit
  const fmtQLabel = (label: string): string =>
    label
      .replace(/^Application ex\.(\d+)$/, (_m, n) => `${t('Exercice')} ${n}`)
      .replace(/^Application (\d+) Q(\d+)$/, (_m, a, q) => `${t('Application')} ${a} Q${q}`)

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-stone-200 text-start text-[11px] text-stone-500">
            <th className="py-2 pe-2 font-medium">{t('Question')}</th>
            <th className="py-2 pe-2 font-medium">{t('Intitulé')}</th>
            <th className="px-1.5 py-2 text-center font-medium">n</th>
            {isTrat ? (
              <>
                <th className="px-1.5 py-2 text-center font-medium">{t('1ᵉʳ essai')}</th>
                <th className="px-1.5 py-2 text-center font-medium">{t('Réussite finale')}</th>
                <th className="px-1.5 py-2 text-center font-medium">{t('Pts moyens /4')}</th>
                <th className="px-1.5 py-2 text-center font-medium">
                  {t('Répartition')}
                  <span className="block font-normal">4 / 2 / 1 / 0</span>
                </th>
              </>
            ) : (
              <th className="px-1.5 py-2 text-center font-medium">
                {t('Réussite')}
                <span className="block font-normal">(p)</span>
              </th>
            )}
            <th className="px-1.5 py-2 text-center font-medium">
              {t('Discrimination')}
              <span className="block font-normal">(D)</span>
            </th>
            <th className="px-1.5 py-2 text-center font-medium">r pbs</th>
            <th className="py-2 ps-2 text-center font-medium">
              {isTrat ? t('Choix initial') : t('Choix')}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, idx) => {
            // Application : regroupement par cas clinique (sous-en-têtes)
            const caseChanged =
              isApp &&
              (idx === 0 || items[idx - 1].question.caseLabel !== it.question.caseLabel)
            return (
              <Fragment key={it.question.id}>
                {caseChanged && (
                  <tr key={`case-${it.question.id}`}>
                    <td
                      colSpan={9}
                      className="border-b border-stone-100 bg-stone-50 px-2 py-1.5 text-[11px] font-bold text-stone-600"
                    >
                      {fmtQLabel(it.question.caseLabel ?? 'Exercices d’application')}
                    </td>
                  </tr>
                )}
                <tr className="border-b border-stone-100">
                  <td className="py-2 pe-2 whitespace-nowrap text-xs font-semibold text-stone-700">
                    {fmtQLabel(it.question.label)}
                  </td>
                  <td className="max-w-[220px] py-2 pr-2 text-xs text-stone-500" title={it.question.text}>
                    {it.question.text.length > 60
                      ? it.question.text.slice(0, 60) + '…'
                      : it.question.text}
                  </td>
                  <td className="px-1.5 py-2 text-center text-xs text-stone-600">{it.n}</td>
                  {isTrat ? (
                    <>
                      <td className="px-1.5 py-2 text-center">
                        <StatCell value={fmtPct(it.pFirst)} />
                      </td>
                      <td className="px-1.5 py-2 text-center">
                        <StatCell value={fmtPct(it.p)} interp={it.p !== null ? difficultyInterp(it.p) : null} />
                      </td>
                      <td className="px-1.5 py-2 text-center text-xs font-semibold text-stone-700">
                        {fmtNum(it.avgScore, 2)}
                      </td>
                      <td className="px-1.5 py-2 text-center">
                        <IfatCell item={it} />
                      </td>
                    </>
                  ) : (
                    <td className="px-1.5 py-2 text-center">
                      <StatCell value={fmtPct(it.p)} interp={it.p !== null ? difficultyInterp(it.p) : null} />
                    </td>
                  )}
                  <td className="px-1.5 py-2 text-center">
                    <StatCell
                      value={fmt2(it.d)}
                      interp={it.d !== null ? discriminationInterp(it.d) : null}
                    />
                  </td>
                  <td className="px-1.5 py-2 text-center">
                    <StatCell
                      value={fmt2(it.rpbs)}
                      interp={it.rpbs !== null ? rpbsInterp(it.rpbs) : null}
                    />
                  </td>
                  <td className="py-2 pl-2">
                    <OptionsCell item={it} />
                  </td>
                </tr>
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------- Comparaison iRAT → tRAT ----------

function ComparisonSection({
  irat,
  trat,
  comparison,
}: {
  irat: SectionAnalysis
  trat: SectionAnalysis
  comparison: ComparisonRow[]
}) {
  const { t } = useI18n()
  const gain20 =
    irat.test.mean20 !== null && trat.test.mean20 !== null
      ? trat.test.mean20 - irat.test.mean20
      : null
  return (
    <Section title={t('Effet équipe : iRAT → tRAT')}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-start text-[11px] text-stone-500">
              <th className="py-2 pe-2 font-medium">{t('Question')}</th>
              <th className="px-1.5 py-2 text-center font-medium">{t('Réussite individus')}</th>
              <th className="px-1.5 py-2 text-center font-medium">{t('Équipes 1ᵉʳ essai')}</th>
              <th className="px-1.5 py-2 text-center font-medium">{t('Équipes au final')}</th>
              <th className="px-1.5 py-2 text-center font-medium">{t('Gain équipe')}</th>
            </tr>
          </thead>
          <tbody>
            {comparison.map((row) => (
              <tr key={row.question.id} className="border-b border-stone-100">
                <td className="py-2 pr-2 text-xs font-semibold text-stone-700">
                  {row.question.label}
                </td>
                <td className="px-1.5 py-2 text-center text-xs font-semibold text-stone-700">
                  {fmtPct(row.pIrat)}
                </td>
                <td className="px-1.5 py-2 text-center text-xs text-stone-600">
                  {fmtPct(row.pTratFirst)}
                </td>
                <td className="px-1.5 py-2 text-center text-xs font-semibold text-stone-700">
                  {fmtPct(row.pTratFinal)}
                </td>
                <td className="px-1.5 py-2 text-center">
                  {row.gain !== null ? (
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-bold',
                        row.gain > 0.001
                          ? 'bg-emerald-100 text-emerald-700'
                          : row.gain < -0.001
                            ? 'bg-red-100 text-red-600'
                            : 'bg-stone-100 text-stone-500'
                      )}
                    >
                      {row.gain > 0 ? '+' : ''}
                      {(row.gain * 100).toFixed(0)} pts de %
                    </span>
                  ) : (
                    <span className="text-stone-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-stone-200 text-xs">
              <td className="py-2 pe-2 font-bold text-stone-700">{t('Moyenne / 20')}</td>
              <td className="px-1.5 py-2 text-center font-bold text-stone-700">
                {fmtNum(irat.test.mean20)}
              </td>
              <td className="px-1.5 py-2 text-center text-stone-500">—</td>
              <td className="px-1.5 py-2 text-center font-bold text-stone-700">
                {fmtNum(trat.test.mean20)}
              </td>
              <td className="px-1.5 py-2 text-center">
                {gain20 !== null && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                    <TrendingUp className="mr-0.5 inline h-3 w-3" />
                    {gain20 > 0 ? '+' : ''}
                    {fmtNum(gain20)} pts
                  </span>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-stone-500">
        {t(
          'Le gain mesure l’effet du travail en équipe : différence entre la réussite finale des équipes (tRAT, après grattage) et la réussite individuelle (iRAT). Un gain positif — le cas le plus fréquent — traduit l’apprentissage par la discussion ; les questions à gain nul ou négatif méritent une explication en feedback.'
        )}
      </p>
    </Section>
  )
}

// ---------- Questions à revoir ----------

const KIND_LABEL: Record<SectionKind, string> = {
  irat: 'iRAT',
  trat: 'tRAT',
  application: 'Application',
}

function FlaggedSection({ flagged }: { flagged: FlaggedQuestion[] }) {
  const { t } = useI18n()
  if (flagged.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
        <CheckCircle2 className="h-5 w-5 shrink-0" />
        {t(
          'Aucune question à signaler : tous les indices se situent dans les plages recommandées.'
        )}
      </div>
    )
  }
  return (
    <Section title={t('Questions à revoir ({n})', { n: flagged.length })}>
      <div className="space-y-2">
        {flagged.map((f) => (
          <div
            key={`${f.kind}-${f.label}`}
            className="rounded-xl border border-amber-200 bg-amber-50/60 p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                {t(KIND_LABEL[f.kind])}
              </span>
              <span className="text-xs font-bold text-stone-700">{f.label}</span>
              <span className="text-xs text-stone-500" title={f.text}>
                {f.text.length > 50 ? f.text.slice(0, 50) + '…' : f.text}
              </span>
            </div>
            <ul className="mt-1.5 space-y-0.5">
              {f.problems.map((p) => (
                <li key={p} className="flex items-start gap-1.5 text-xs text-stone-600">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-stone-500">
        {t(
          'Signalement automatique : question très difficile (p < 0,25) ou très facile (p > 0,95), discrimination D < 0,20, corrélation au reste du test < 0,20, ou distracteur jamais choisi.'
        )}
      </p>
    </Section>
  )
}

// ---------- Onglet principal ----------

export function StatsTab({
  data,
  ratQs,
  appQs,
}: {
  data: DashboardDTO
  ratQs: DashboardDTO['questions']
  appQs: DashboardDTO['questions']
}) {
  const analyses = useMemo(() => {
    const irat =
      ratQs.length > 0 && data.iratAnswers.length > 0
        ? analyzeSection(buildIratSection(data))
        : null
    const trat =
      ratQs.length > 0 && data.tratAnswers.length > 0
        ? analyzeSection(buildTratSection(data))
        : null
    const app =
      appQs.length > 0 && data.appAnswers.length > 0
        ? analyzeSection(buildApplicationSection(data))
        : null
    const comparison = irat && trat ? buildComparison(irat, trat) : null
    const flagged = flagQuestions(
      [
        { kind: 'irat' as const, analysis: irat },
        { kind: 'trat' as const, analysis: trat },
        { kind: 'application' as const, analysis: app },
      ].filter((s): s is { kind: SectionKind; analysis: SectionAnalysis } => s.analysis !== null)
    )
    return { irat, trat, app, comparison, flagged }
  }, [data, ratQs, appQs])

  const { irat, trat, app, comparison, flagged } = analyses
  const { t } = useI18n()

  if (!irat && !trat && !app) {
    return (
      <p className="rounded-2xl border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
        {t(
          'Les statistiques docimologiques apparaîtront ici dès que les étudiants auront commencé à répondre (iRAT, tRAT ou cas cliniques). Elles se calculent automatiquement et s’affinent au fil des réponses.'
        )}
      </p>
    )
  }

  const finished = data.session.status === 'finished'

  return (
    <div className="space-y-5">
      {!finished && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-700">
          {t(
            'Séance en cours : statistiques provisoires (recalculées en direct). Exportez-les plutôt une fois la séance terminée.'
          )}
        </p>
      )}

      <Glossary />

      {/* Synthèse par section */}
      <div className="grid gap-4 md:grid-cols-3">
        {irat && <SynthesisCard kind="irat" analysis={irat} />}
        {trat && <SynthesisCard kind="trat" analysis={trat} />}
        {app && <SynthesisCard kind="application" analysis={app} />}
      </div>

      {/* Effet équipe */}
      {comparison && irat && trat && (
        <ComparisonSection irat={irat} trat={trat} comparison={comparison} />
      )}

      {/* Analyse des questions */}
      {irat && (
        <Section title={t('Analyse des questions — iRAT (répondants : étudiants)')}>
          <ItemsTable kind="irat" analysis={irat} />
        </Section>
      )}
      {trat && (
        <Section
          title={t(
            'Analyse des questions — tRAT (répondants : équipes · choix = 1ᵉʳ essai · barème IF-AT 4/2/1/0)'
          )}
        >
          <ItemsTable kind="trat" analysis={trat} />
        </Section>
      )}
      {app && (
        <Section
          title={t('Analyse des questions — application et cas cliniques (répondants : équipes)')}
        >
          <ItemsTable kind="application" analysis={app} />
        </Section>
      )}

      {/* Questions à revoir */}
      <FlaggedSection flagged={flagged} />

      {/* Export */}
      <Button
        variant="outline"
        className="h-12 w-full border-emerald-300 text-emerald-700 hover:bg-emerald-50"
        onClick={() => exportDocimologyCsv(data, irat, trat, app, comparison, flagged)}
      >
        <Download className="mr-2 h-4 w-4" />
        {t('Exporter l’analyse docimologique complète (CSV pour Excel)')}
      </Button>
    </div>
  )
}

// ================= Export CSV =================

export function exportDocimologyCsv(
  data: DashboardDTO,
  irat: SectionAnalysis | null,
  trat: SectionAnalysis | null,
  app: SectionAnalysis | null,
  comparison: ComparisonRow[] | null,
  flagged: FlaggedQuestion[]
) {
  const esc = (v: string | number | null | undefined) => {
    let s = String(v ?? '')
    // Anti « CSV injection » (formules Excel) — même garde-fou que l'export
    // des résultats : apostrophe initiale sur =, +, -, @, tab, CR.
    if (/^[=+\-@\t\r]/.test(s)) {
      s = "'" + s
    }
    return `"${s.replace(/"/g, '""')}"`
  }
  /** nombre décimal français : 0,625 */
  const nb = (x: number | null, decimals = 2) =>
    x === null || !Number.isFinite(x) ? '' : x.toFixed(decimals).replace('.', ',')
  /** pourcentage : 62,5 */
  const pc = (x: number | null) => (x === null ? '' : (x * 100).toFixed(1).replace('.', ','))

  const rows: string[] = []
  const line = (...cells: (string | number | null | undefined)[]) =>
    rows.push(cells.map(esc).join(';'))

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
  rows.push('')

  // ---- 1. Synthèse par section ----
  line(
    t('1. SYNTHÈSE PAR SECTION')
  )
  line(
    t('Section'),
    t('Répondants'),
    t('Questions'),
    t('Score max'),
    t('Moyenne (points)'),
    t('Écart-type'),
    t('Moyenne /20'),
    t('Médiane (points)'),
    'Q1',
    'Q3',
    'Min',
    'Max',
    t('Fidélité (alpha)'),
    t('Interprétation fidélité'),
    t('SEM (points)'),
    t('Répondants complets')
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
      label,
      tst.n,
      tst.k,
      tst.maxScore,
      nb(tst.mean),
      nb(tst.sd),
      nb(tst.mean20, 1),
      nb(tst.median),
      nb(tst.q1),
      nb(tst.q3),
      tst.min,
      tst.max,
      nb(tst.alpha),
      tst.alpha !== null ? t(alphaInterp(tst.alpha).label) : '',
      nb(tst.sem),
      tst.nComplete
    )
  }
  rows.push('')

  // ---- 2. Analyse des questions ----
  const itemRows = (kindLabel: string, a: SectionAnalysis, isTrat: boolean, isApp: boolean) => {
    line(`2. ${t('ANALYSE DES QUESTIONS')} — ${kindLabel}`)
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
    rows.push('')
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
    line(`3. ${t('COMPARAISON iRAT → tRAT (effet équipe)')}`)
    line(
      t('Question'),
      t('Intitulé'),
      t('Réussite individus (%)'),
      t('Équipes 1er essai (%)'),
      t('Équipes au final (%)'),
      t('Gain (points de %)')
    )
    for (const row of comparison) {
      line(
        fmtQLabel(row.question.label),
        row.question.text,
        pc(row.pIrat),
        pc(row.pTratFirst),
        pc(row.pTratFinal),
        row.gain !== null ? (row.gain * 100).toFixed(1).replace('.', ',') : ''
      )
    }
    line(
      t('Moyenne /20'),
      '',
      nb(irat.test.mean20, 1),
      '',
      nb(trat.test.mean20, 1),
      irat.test.mean20 !== null && trat.test.mean20 !== null
        ? nb(trat.test.mean20 - irat.test.mean20, 1)
        : ''
    )
    rows.push('')
  }

  // ---- 4. Distribution des notes ----
  line(`4. ${t('RÉPARTITION DES NOTES (sur 20)')}`)
  line(t('Section'), t('Classe'), t('Effectif'))
  for (const [label, a] of sections) {
    if (!a) continue
    for (const bin of a.test.distribution) {
      line(label, bin.label, bin.count)
    }
  }
  rows.push('')

  // ---- 5. Questions à revoir ----
  line(`5. ${t('QUESTIONS À REVOIR (signalement automatique)')}`)
  line(t('Section'), t('Question'), t('Intitulé'), t('Points à surveiller'))
  for (const f of flagged) {
    line(t(KIND_LABEL[f.kind]), f.label, f.text, f.problems.join(' ; '))
  }

  // BOM UTF-8 + séparateur « ; » (Excel francophone)
  const blob = new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `docimologie-tbl-${data.session.code}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
