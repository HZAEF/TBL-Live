import { describe, it, expect } from 'vitest'
import { computeRankFor } from '../src/lib/grades'
import {
  reverseSaiValue,
  saiSubscaleMean,
  normalizePersonalCode,
  isValidPersonalCode,
  saiItemText,
  DEFAULT_SAI_ITEMS,
  SAI_LIKERT_KEYS,
} from '../src/lib/sai'

// ============================================================
// v2.6.0 — Tests du questionnaire TBL-SAI et du rang étudiant
// ============================================================

describe('computeRankFor — rang de l\'étudiant (classement sportif)', () => {
  it('classe distinctement des notes différentes', () => {
    const finals = [
      { studentId: 'a', final: 12 },
      { studentId: 'b', final: 18 },
      { studentId: 'c', final: 15 },
    ]
    expect(computeRankFor(finals, 'b')).toEqual({ rank: 1, total: 3 })
    expect(computeRankFor(finals, 'c')).toEqual({ rank: 2, total: 3 })
    expect(computeRankFor(finals, 'a')).toEqual({ rank: 3, total: 3 })
  })

  it('les ex æquo partagent le même rang, le suivant saute (1, 2, 2, 4)', () => {
    const finals = [
      { studentId: 'a', final: 20 },
      { studentId: 'b', final: 17 },
      { studentId: 'c', final: 17 },
      { studentId: 'd', final: 14 },
      { studentId: 'e', final: 10 },
    ]
    expect(computeRankFor(finals, 'a')).toEqual({ rank: 1, total: 5 })
    expect(computeRankFor(finals, 'b')).toEqual({ rank: 2, total: 5 })
    expect(computeRankFor(finals, 'c')).toEqual({ rank: 2, total: 5 })
    expect(computeRankFor(finals, 'd')).toEqual({ rank: 4, total: 5 })
    expect(computeRankFor(finals, 'e')).toEqual({ rank: 5, total: 5 })
  })

  it('ignore les étudiants sans note calculable (total = notés seulement)', () => {
    const finals = [
      { studentId: 'a', final: 12 },
      { studentId: 'b', final: 18 },
      { studentId: 'c', final: null },
    ]
    expect(computeRankFor(finals, 'b')).toEqual({ rank: 1, total: 2 })
    expect(computeRankFor(finals, 'a')).toEqual({ rank: 2, total: 2 })
  })

  it('renvoie null pour un étudiant sans note ou introuvable', () => {
    const finals = [
      { studentId: 'a', final: 12 },
      { studentId: 'b', final: null },
      { studentId: 'c', final: 9 },
    ]
    expect(computeRankFor(finals, 'b')).toBeNull()
    expect(computeRankFor(finals, 'zzz')).toBeNull()
  })

  it('un seul étudiant noté : rang 1 sur 1', () => {
    expect(computeRankFor([{ studentId: 'a', final: 7.5 }], 'a')).toEqual({ rank: 1, total: 1 })
  })

  it('liste vide : null', () => {
    expect(computeRankFor([], 'a')).toBeNull()
  })
})

describe('TBL-SAI — cotation des items', () => {
  it('inverse les valeurs Likert : 1↔5, 2↔4, 3→3', () => {
    expect(reverseSaiValue(1)).toBe(5)
    expect(reverseSaiValue(2)).toBe(4)
    expect(reverseSaiValue(3)).toBe(3)
    expect(reverseSaiValue(4)).toBe(2)
    expect(reverseSaiValue(5)).toBe(1)
  })

  it('moyenne simple sans item inversé', () => {
    expect(saiSubscaleMean([{ value: 1, reversed: false }, { value: 3, reversed: false }, { value: 5, reversed: false }])).toBe(3)
  })

  it('moyenne avec inversion des items négatifs', () => {
    // valeurs brutes [1 (inversé), 5, 5] → ajustées [5, 5, 5]
    expect(
      saiSubscaleMean([
        { value: 1, reversed: true },
        { value: 5, reversed: false },
        { value: 5, reversed: false },
      ])
    ).toBe(5)
    // valeurs brutes [1, 2] toutes inversées → ajustées [5, 4] → 4,5
    expect(saiSubscaleMean([{ value: 1, reversed: true }, { value: 2, reversed: true }])).toBe(4.5)
  })

  it('renvoie null sans réponse exploitable (et filtre les valeurs hors échelle)', () => {
    expect(saiSubscaleMean([])).toBeNull()
    expect(saiSubscaleMean([{ value: 0, reversed: false }, { value: 6, reversed: true }])).toBeNull()
  })

  it('les 33 items standard : structure, sous-échelles et items inversés', () => {
    expect(DEFAULT_SAI_ITEMS).toHaveLength(33)
    // Répartition de l'instrument : 8 / 16 / 9
    expect(DEFAULT_SAI_ITEMS.filter((i) => i.subscale === 'accountability')).toHaveLength(8)
    expect(DEFAULT_SAI_ITEMS.filter((i) => i.subscale === 'preference')).toHaveLength(16)
    expect(DEFAULT_SAI_ITEMS.filter((i) => i.subscale === 'satisfaction')).toHaveLength(9)
    // 11 items inversés : 4, 11, 13, 14, 16, 18, 21, 22, 24, 28, 30
    expect(DEFAULT_SAI_ITEMS.filter((i) => i.reversed)).toHaveLength(11)
    // Tous les énoncés sont uniques et non vides
    const keys = DEFAULT_SAI_ITEMS.map((i) => i.key)
    expect(new Set(keys).size).toBe(33)
    expect(keys.every((k) => k.trim().length > 0)).toBe(true)
  })

  it('5 libellés de Likert, tous distincts et non vides', () => {
    expect(SAI_LIKERT_KEYS).toHaveLength(5)
    expect(new Set(SAI_LIKERT_KEYS).size).toBe(5)
    expect(SAI_LIKERT_KEYS.every((k) => k.trim().length > 0)).toBe(true)
  })

  it('libellé d\'affichage : texte personnalisé prioritaire sur la clé standard', () => {
    expect(saiItemText({ text: 'Ma question', textKey: 'Clé standard' })).toBe('Ma question')
    expect(saiItemText({ text: null, textKey: 'Clé standard' })).toBe('Clé standard')
    expect(saiItemText({ text: null, textKey: null })).toBe('')
  })
})

describe('Code personnel choisi par l\'étudiant', () => {
  it('normalise : majuscules, sans accents ni symboles', () => {
    expect(normalizePersonalCode('luna')).toBe('LUNA')
    expect(normalizePersonalCode(' 1 2 3 4 ')).toBe('1234')
    expect(normalizePersonalCode('a-b_c!d')).toBe('ABCD')
    expect(normalizePersonalCode('Éaà')).toBe('A') // accents supprimés (pas translittérés)
  })

  it('valide 4 à 12 caractères alphanumériques MAJUSCULES (après normalisation)', () => {
    expect(isValidPersonalCode('ABCD')).toBe(true)
    expect(isValidPersonalCode('1234')).toBe(true)
    expect(isValidPersonalCode('K7MP')).toBe(true)
    // Usage réel : normaliser AVANT de valider (l'étudiant peut saisir
    // en minuscules, le champ le convertit à la saisie).
    expect(isValidPersonalCode(normalizePersonalCode('luna2026'))).toBe(true)
    expect(isValidPersonalCode('luna2026')).toBe(false) // non normalisé
    expect(isValidPersonalCode('ABC')).toBe(false) // 3 caractères
    expect(isValidPersonalCode('A1B2C3D4E5F6G')).toBe(false) // 13 caractères
    expect(isValidPersonalCode('AB CD')).toBe(false) // espace
    expect(isValidPersonalCode('')).toBe(false)
    expect(isValidPersonalCode('ABÉD')).toBe(false) // accent
  })
})
