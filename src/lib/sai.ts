// ============================================================
// TBL Live — Questionnaire de fin de séance (TBL-SAI)
// Team-Based Learning Student Assessment Instrument
// © 2010 Heidi A. Mennenga — instrument implémenté sur document
// fourni par l'enseignant (voir upload/TBL-SAI.pdf).
//
// 33 items standard répartis en 3 sous-échelles :
//  - accountability  (items 1-8)   : préparation et contribution à l'équipe
//  - preference      (items 9-24)  : rappel du matériel et attention en
//                                    cours magistral vs apprentissage par équipes
//  - satisfaction    (items 25-33) : satisfaction vis-à-vis de l'apprentissage
//                                    par équipes
//
// Les items à formulation NÉGATIVE (reversed) sont inversés lors du calcul
// des moyennes de sous-échelle (valeur → 6 − valeur) : items 4, 11, 13, 14,
// 16, 18, 21, 22, 24, 28 et 30 dans la numérotation de l'instrument.
//
// Multilinguisme : chaque item standard porte une clé i18n (l'énoncé
// français EST la clé, convention de l'application) traduite dans les 6
// dictionnaires. L'énoncé anglais du dictionnaire en est le TEXTE ORIGINAL
// de l'instrument ; les autres langues sont traduites à partir de
// l'anglais avec rigueur. Dès que l'enseignant personnalise un libellé
// (SaiItem.text), le texte personnalisé est affiché tel quel, dans toutes
// les langues — comme pour les questions de la séance.
// ============================================================

export type SaiSubscale = 'accountability' | 'preference' | 'satisfaction'

export const SAI_SUBSCALES: SaiSubscale[] = ['accountability', 'preference', 'satisfaction']

export interface DefaultSaiItem {
  /** Clé i18n = énoncé français (convention de l'application) */
  key: string
  subscale: SaiSubscale
  /** Formulation négative → valeur inversée (6 − v) dans les moyennes */
  reversed: boolean
}

/** Libellé et description i18n de chaque sous-échelle (clés françaises). */
export const SAI_SUBSCALE_INFO: Record<
  SaiSubscale,
  { labelKey: string; descriptionKey: string }
> = {
  accountability: {
    labelKey: 'Sous-échelle Responsabilisation',
    descriptionKey:
      "Cette sous-échelle évalue la préparation de l’étudiant pour les cours et sa contribution à l’équipe.",
  },
  preference: {
    labelKey: 'Sous-échelle Préférence pour le cours magistral ou l’apprentissage par équipes',
    descriptionKey:
      "Cette sous-échelle évalue la capacité de l’étudiant à mémoriser la matière ainsi que son niveau d’attention en cours magistral et en apprentissage par équipes.",
  },
  satisfaction: {
    labelKey: "Sous-échelle Satisfaction de l’étudiant",
    descriptionKey:
      "Cette sous-échelle évalue la satisfaction de l’étudiant vis-à-vis de l’apprentissage par équipes.",
  },
}

/** Libellés de l'échelle de Likert (1 à 5) — clés i18n.
 *  L'affichage étudiant les utilise dynamiquement (t(SAI_LIKERT_KEYS[i])),
 *  le scanner i18n les extrait spécifiquement (section 8). */
export const SAI_LIKERT_KEYS = [
  'Pas du tout d’accord',
  'Pas d’accord',
  'Ni d’accord, ni pas d’accord',
  'D’accord',
  'Tout à fait d’accord',
]

/**
 * Les 33 items standard du TBL-SAI, dans l'ordre de l'instrument.
 * Le champ `key` est la clé i18n (énoncé français) ; l'énoncé anglais
 * original de l'instrument se trouve dans src/lib/i18n/dicts/en.ts.
 */
export const DEFAULT_SAI_ITEMS: DefaultSaiItem[] = [
  // ---------- Sous-échelle : Responsabilisation (items 1 à 8) ----------
  {
    key: "Je consacre du temps à étudier avant les cours afin d’être mieux préparé(e).",
    subscale: 'accountability',
    reversed: false,
  },
  {
    key: 'Je sens que je dois préparer ce cours pour réussir.',
    subscale: 'accountability',
    reversed: false,
  },
  {
    key: "Je contribue à l’apprentissage des membres de mon équipe.",
    subscale: 'accountability',
    reversed: false,
  },
  {
    key: "Ma contribution à l’équipe n’est pas importante.",
    subscale: 'accountability',
    reversed: true,
  },
  {
    key: 'Les membres de mon équipe comptent sur moi pour les aider dans leur apprentissage.',
    subscale: 'accountability',
    reversed: false,
  },
  {
    key: "Je suis responsable de l’apprentissage de mon équipe.",
    subscale: 'accountability',
    reversed: false,
  },
  {
    key: 'Je suis fier(ère) de ma capacité à aider mon équipe dans son apprentissage.',
    subscale: 'accountability',
    reversed: false,
  },
  {
    key: "J’ai besoin de contribuer à l’apprentissage de l’équipe.",
    subscale: 'accountability',
    reversed: false,
  },
  // ----- Sous-échelle : Préférence cours magistral / APE (items 9 à 24) -----
  {
    key: "Pendant les cours magistraux traditionnels, il m’arrive souvent de penser à autre chose.",
    subscale: 'preference',
    reversed: false,
  },
  {
    key: 'Je me laisse facilement distraire pendant les cours magistraux traditionnels.',
    subscale: 'preference',
    reversed: false,
  },
  {
    key: "Je me laisse facilement distraire pendant les activités d’apprentissage par équipes.",
    subscale: 'preference',
    reversed: true,
  },
  {
    key: "Je suis plus susceptible de m’endormir pendant un cours magistral que pendant les cours utilisant des activités d’apprentissage par équipes.",
    subscale: 'preference',
    reversed: false,
  },
  {
    key: "Je m’ennuie pendant les activités d’apprentissage par équipes.",
    subscale: 'preference',
    reversed: true,
  },
  {
    key: "Je parle d’autres choses pendant les activités d’apprentissage par équipes.",
    subscale: 'preference',
    reversed: true,
  },
  {
    key: "Je retiens facilement ce que j’apprends quand je travaille en équipe.",
    subscale: 'preference',
    reversed: false,
  },
  {
    key: 'Je retiens mieux la matière quand l’enseignant la présente en cours magistral.',
    subscale: 'preference',
    reversed: true,
  },
  {
    key: "Les activités d’apprentissage par équipes m’aident à me rappeler les informations déjà vues.",
    subscale: 'preference',
    reversed: false,
  },
  {
    key: "Il est plus facile de réviser pour les examens quand l’enseignant a présenté la matière en cours magistral.",
    subscale: 'preference',
    reversed: true,
  },
  {
    key: "Je retiens l’information plus longtemps quand je la revois avec mes coéquipiers lors des tests en équipe (GRAT) de l’apprentissage par équipes.",
    subscale: 'preference',
    reversed: false,
  },
  {
    key: "Je retiens mieux la matière après les exercices d’application de l’apprentissage par équipes.",
    subscale: 'preference',
    reversed: false,
  },
  {
    key: 'Je peux facilement me rappeler la matière des cours magistraux.',
    subscale: 'preference',
    reversed: true,
  },
  {
    key: "Après avoir travaillé avec mes coéquipiers, j’ai du mal à me souvenir de ce dont nous avons parlé en classe.",
    subscale: 'preference',
    reversed: true,
  },
  {
    key: "J’obtiens de meilleurs résultats aux examens quand l’apprentissage par équipes a été utilisé pour aborder la matière.",
    subscale: 'preference',
    reversed: false,
  },
  {
    key: "Après avoir écouté un cours magistral, j’ai du mal à me souvenir de ce dont l’enseignant a parlé en classe.",
    subscale: 'preference',
    reversed: true,
  },
  // ---------- Sous-échelle : Satisfaction (items 25 à 33) ----------
  {
    key: "J’aime les activités d’apprentissage par équipes.",
    subscale: 'satisfaction',
    reversed: false,
  },
  {
    key: "J’apprends mieux en équipe.",
    subscale: 'satisfaction',
    reversed: false,
  },
  {
    key: "Je pense que les activités d’apprentissage par équipes constituent une approche efficace de l’apprentissage.",
    subscale: 'satisfaction',
    reversed: false,
  },
  {
    key: "Je n’aime pas travailler en équipe.",
    subscale: 'satisfaction',
    reversed: true,
  },
  {
    key: "Les activités d’apprentissage par équipes sont amusantes.",
    subscale: 'satisfaction',
    reversed: false,
  },
  {
    key: "Les activités d’apprentissage par équipes sont une perte de temps.",
    subscale: 'satisfaction',
    reversed: true,
  },
  {
    key: "Je pense que l’apprentissage par équipes m’a aidé à améliorer mes notes.",
    subscale: 'satisfaction',
    reversed: false,
  },
  {
    key: "J’ai une attitude positive envers les activités d’apprentissage par équipes.",
    subscale: 'satisfaction',
    reversed: false,
  },
  {
    key: "J’ai vécu une bonne expérience avec l’apprentissage par équipes.",
    subscale: 'satisfaction',
    reversed: false,
  },
]

/**
 * Valeur inversée d'une réponse Likert (1-5) : 1↔5, 2↔4, 3→3.
 * Utilisée pour les items à formulation négative lors du calcul des
 * moyennes de sous-échelles.
 */
export function reverseSaiValue(v: number): number {
  return 6 - v
}

/**
 * Moyenne d'une sous-échelle (1 à 5) à partir des réponses brutes,
 * en inversant les valeurs des items négatifs. Renvoie null si aucune
 * réponse exploitable.
 */
export function saiSubscaleMean(
  responses: { value: number; reversed: boolean }[]
): number | null {
  const usable = responses.filter((r) => Number.isFinite(r.value) && r.value >= 1 && r.value <= 5)
  if (usable.length === 0) return null
  const adjusted = usable.map((r) => (r.reversed ? reverseSaiValue(r.value) : r.value))
  return adjusted.reduce((s, v) => s + v, 0) / adjusted.length
}

/** Normalise une saisie de code personnel (majuscules, A-Z 0-9). */
export function normalizePersonalCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Un code personnel choisi par l'étudiant est valide (4 à 12 caractères). */
export function isValidPersonalCode(code: string): boolean {
  return /^[A-Z0-9]{4,12}$/.test(code)
}

/** Libellé d'affichage d'un item : texte personnalisé sinon clé i18n. */
export function saiItemText(item: { text: string | null; textKey: string | null }): string {
  return (item.text ?? item.textKey ?? '').trim()
}
