// ============================================================
// TBL Live v3.3.0 — Tests unitaires des nouveaux mécanismes :
//  1. PAYLOAD DU JOURNAL (safeEventPayload) : JSON valide accepté,
//     tout le reste (JSON cassé, tableau, chaîne, nombre) → {} —
//     jamais d'objet hostile issu de la base dans le tableau de bord ;
//  2. TYPES DU JOURNAL ENSEIGNANT (TEACHER_EVENT_TYPES) : les 9 types
//     d'action enseignante, zéro type étudiant (la rubrique « Journal »
//     ne doit jamais montrer les réponses/inscriptions des étudiants).
// ============================================================

import { describe, expect, it, vi } from 'vitest'

// write-queue importe @/lib/db (Prisma) pour le journal : mocké — ces
// tests ne touchent JAMAIS la base.
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/metrics', () => ({
  recordWrite: () => undefined,
  recordWriteQueueDelta: () => undefined,
}))

import { safeEventPayload, TEACHER_EVENT_TYPES } from '@/lib/write-queue'

// ============================================================
// 1. safeEventPayload — le JSON stocké d'un événement
// ============================================================
describe('safeEventPayload', () => {
  it('parse un objet JSON valide', () => {
    const p = safeEventPayload('{"action":"set_title","actor":"Rania Propriétaire"}')
    expect(p).toEqual({ action: 'set_title', actor: 'Rania Propriétaire' })
  })

  it('conserve les valeurs imbriquées et les nombres', () => {
    const p = safeEventPayload('{"erasedAnswers":9,"nested":{"from":"irat","to":"trat"}}')
    expect(p.erasedAnswers).toBe(9)
    expect(p.nested).toEqual({ from: 'irat', to: 'trat' })
  })

  it('JSON cassé → objet vide (jamais d’exception)', () => {
    expect(safeEventPayload('{pas du json')).toEqual({})
  })

  it('tableau → objet vide (la rubrique attend un objet)', () => {
    expect(safeEventPayload('[1,2,3]')).toEqual({})
  })

  it('chaîne / nombre / null JSON → objet vide', () => {
    expect(safeEventPayload('"du texte"')).toEqual({})
    expect(safeEventPayload('42')).toEqual({})
    expect(safeEventPayload('null')).toEqual({})
  })
})

// ============================================================
// 2. TEACHER_EVENT_TYPES — le filtre de la rubrique « Journal »
// ============================================================
describe('TEACHER_EVENT_TYPES', () => {
  it('liste exactement les 9 types d’action enseignante', () => {
    expect([...TEACHER_EVENT_TYPES].sort()).toEqual(
      [
        'appeal_decision',
        'case_open',
        'phase',
        'question_edit',
        'restart',
        'reveal',
        'session_edit',
        'share',
        'team_edit',
      ].sort()
    )
  })

  it('ne contient AUCUN type étudiant (réponses, inscriptions…)', () => {
    const studentTypes = ['join', 'answer', 'team_answer', 'app_answer', 'appeal', 'appeal_done', 'peer', 'sai']
    for (const t of studentTypes) {
      expect(TEACHER_EVENT_TYPES).not.toContain(t)
    }
  })
})
