import { describe, expect, it } from 'vitest'
import type { Combo } from './combo.js'
import { isTwoCardInfinite, producesInfinite } from './combo.js'
import { comboId, oracleId } from './ids.js'
import type { OracleId } from './ids.js'
import {
  annotateCombos,
  buildComboIndex,
  candidatesAffectedBy,
  comboDegree,
  combosContaining,
  completedCombos,
  deckCombos,
  nearCombos,
} from './combo-index.js'

const card = (name: string): OracleId => oracleId(name)

const combo = (id: string, pieces: readonly string[], produces: Combo['produces'] = ['value']): Combo => ({
  id: comboId(id),
  pieces: pieces.map(card),
  prerequisites: '',
  steps: [],
  produces,
  colorIdentity: [],
})

const setOf = (...names: string[]): ReadonlySet<OracleId> => new Set(names.map(card))

describe('buildComboIndex', () => {
  it('indexes every piece of every combo', () => {
    const index = buildComboIndex([combo('c1', ['A', 'B']), combo('c2', ['B', 'C'])])
    expect(index.byId.size).toBe(2)
    expect(combosContaining(index, card('B')).map((c) => c.id)).toEqual([
      comboId('c1'),
      comboId('c2'),
    ])
    expect(combosContaining(index, card('A')).map((c) => c.id)).toEqual([comboId('c1')])
  })

  it('returns empty for a card in no combo, which is normal', () => {
    const index = buildComboIndex([combo('c1', ['A', 'B'])])
    expect(combosContaining(index, card('Z'))).toEqual([])
  })

  // AGENTS.md §8 / doc 04 §4.2 — malformed data fails loudly, never silently.
  it('rejects a combo with no pieces and reports why', () => {
    const index = buildComboIndex([combo('empty', []), combo('c1', ['A', 'B'])])
    expect(index.byId.has(comboId('empty'))).toBe(false)
    expect(index.rejected).toEqual([{ id: comboId('empty'), reason: 'combo has no pieces' }])
  })

  it('rejects a duplicate combo id and reports why', () => {
    const index = buildComboIndex([combo('c1', ['A', 'B']), combo('c1', ['C', 'D'])])
    expect(index.byId.size).toBe(1)
    expect(index.rejected).toEqual([{ id: comboId('c1'), reason: 'duplicate combo id' }])
  })

  it('dedupes repeated pieces within one combo rather than rejecting it', () => {
    const index = buildComboIndex([combo('c1', ['A', 'A', 'B'])])
    expect(index.byId.get(comboId('c1'))?.pieces).toEqual([card('A'), card('B')])
    expect(index.rejected).toEqual([])
    // and the deduped piece is indexed once, not twice
    expect(combosContaining(index, card('A'))).toHaveLength(1)
  })

  it('handles an empty combo list', () => {
    const index = buildComboIndex([])
    expect(index.byId.size).toBe(0)
    expect(index.rejected).toEqual([])
    expect(comboDegree(index, setOf('A'), card('B'))).toBe(0)
  })
})

describe('comboDegree', () => {
  it('counts a combo the candidate completes', () => {
    const index = buildComboIndex([combo('c1', ['X', 'A'])])
    expect(comboDegree(index, setOf('A'), card('X'))).toBe(1)
  })

  it('does not count a combo still missing a piece', () => {
    const index = buildComboIndex([combo('c1', ['X', 'A', 'B'])])
    expect(comboDegree(index, setOf('A'), card('X'))).toBe(0)
  })

  it('counts a one-card combo as completed', () => {
    const index = buildComboIndex([combo('solo', ['X'])])
    expect(comboDegree(index, setOf(), card('X'))).toBe(1)
  })

  it('is zero for a card in no combo', () => {
    const index = buildComboIndex([combo('c1', ['A', 'B'])])
    expect(comboDegree(index, setOf('A', 'B'), card('Z'))).toBe(0)
  })

  it('is zero for a card already accepted — it is not a candidate', () => {
    const index = buildComboIndex([combo('c1', ['X', 'A'])])
    expect(comboDegree(index, setOf('A', 'X'), card('X'))).toBe(0)
  })

  it('does not count combos already assembled without the candidate', () => {
    const index = buildComboIndex([combo('done', ['A', 'B'])])
    expect(comboDegree(index, setOf('A', 'B'), card('X'))).toBe(0)
  })

  it('is zero against an empty accepted set unless the combo is one card', () => {
    const index = buildComboIndex([combo('c1', ['X', 'A']), combo('solo', ['X'])])
    expect(comboDegree(index, setOf(), card('X'))).toBe(1)
    expect(completedCombos(index, setOf(), card('X'))).toEqual([comboId('solo')])
  })

  // ---- The distinctness rule (doc 02 §2.3). This is the definition the whole
  // ---- product rests on, so both halves of it are pinned here.

  it('counts two combos that SHARE a piece as two', () => {
    const index = buildComboIndex([
      combo('c1', ['X', 'A']),
      combo('c2', ['X', 'A', 'B']),
    ])
    expect(comboDegree(index, setOf('A', 'B'), card('X'))).toBe(2)
  })

  it('counts two combos with NO shared partner as two', () => {
    // One combo with the commander, one with an unrelated accepted card —
    // the case doc 02 §2.3 calls out explicitly.
    const index = buildComboIndex([
      combo('withCommander', ['X', 'Commander']),
      combo('withOther', ['X', 'B']),
    ])
    expect(comboDegree(index, setOf('Commander', 'B'), card('X'))).toBe(2)
  })

  it('counts combos, not distinct partner cards', () => {
    // Three combos, two distinct partners. Degree is 3, not 2.
    const index = buildComboIndex([
      combo('c1', ['X', 'A']),
      combo('c2', ['X', 'A', 'B']),
      combo('c3', ['X', 'B']),
    ])
    expect(comboDegree(index, setOf('A', 'B'), card('X'))).toBe(3)
  })
})

describe('nearCombos', () => {
  it('counts combos missing exactly d more cards', () => {
    const index = buildComboIndex([
      combo('one-away', ['X', 'A', 'B']),
      combo('two-away', ['X', 'A', 'B', 'C']),
      combo('complete', ['X', 'A']),
    ])
    const accepted = setOf('A')
    expect(nearCombos(index, accepted, card('X'), 1)).toBe(1)
    expect(nearCombos(index, accepted, card('X'), 2)).toBe(1)
    expect(nearCombos(index, accepted, card('X'), 3)).toBe(0)
  })

  it('never counts a completed combo as near', () => {
    const index = buildComboIndex([combo('c1', ['X', 'A'])])
    expect(nearCombos(index, setOf('A'), card('X'), 1)).toBe(0)
    expect(comboDegree(index, setOf('A'), card('X'))).toBe(1)
  })

  it('returns 0 for a distance below 1, which is not a near-combo', () => {
    const index = buildComboIndex([combo('c1', ['X', 'A', 'B'])])
    expect(nearCombos(index, setOf('A'), card('X'), 0)).toBe(0)
    expect(nearCombos(index, setOf('A'), card('X'), -1)).toBe(0)
  })
})

describe('annotateCombos', () => {
  it('reports degree, completed ids and near buckets in one pass', () => {
    const index = buildComboIndex([
      combo('done1', ['X', 'A']),
      combo('done2', ['X', 'A', 'B']),
      combo('near1', ['X', 'A', 'C']),
      combo('near2', ['X', 'C', 'D']),
    ])
    const result = annotateCombos(index, setOf('A', 'B'), card('X'))
    expect(result.degree).toBe(2)
    expect(result.completed).toEqual([comboId('done1'), comboId('done2')])
    expect(result.near.get(1)).toEqual([comboId('near1')])
    expect(result.near.get(2)).toEqual([comboId('near2')])
  })
})

describe('deckCombos', () => {
  it('finds combos fully assembled in the deck', () => {
    const index = buildComboIndex([
      combo('assembled', ['A', 'B']),
      combo('partial', ['A', 'B', 'C']),
    ])
    expect(deckCombos(index, setOf('A', 'B'))).toEqual([comboId('assembled')])
  })

  it('is empty for an empty deck', () => {
    const index = buildComboIndex([combo('c1', ['A', 'B'])])
    expect(deckCombos(index, setOf())).toEqual([])
  })
})

describe('candidatesAffectedBy', () => {
  it('returns only cards sharing a combo with the changed card', () => {
    const index = buildComboIndex([
      combo('c1', ['X', 'A']),
      combo('c2', ['X', 'B', 'C']),
      combo('unrelated', ['P', 'Q']),
    ])
    expect(candidatesAffectedBy(index, card('X'))).toEqual(setOf('A', 'B', 'C'))
  })

  it('excludes the changed card itself', () => {
    const index = buildComboIndex([combo('c1', ['X', 'A'])])
    expect(candidatesAffectedBy(index, card('X')).has(card('X'))).toBe(false)
  })

  it('is empty for a card in no combo', () => {
    const index = buildComboIndex([combo('c1', ['A', 'B'])])
    expect(candidatesAffectedBy(index, card('Z')).size).toBe(0)
  })
})

describe('the documented Krenko example (doc 05 §5.7)', () => {
  // Kiki-Jiki completes three combos against an accepted set of
  // {Krenko, Zealous Conscripts, Goblin Bombardment, Purphoros}. All three
  // share Zealous Conscripts and still count as three.
  const KIKI = 'Kiki-Jiki, Mirror Breaker'
  const combos = [
    combo('kiki-conscripts', [KIKI, 'Zealous Conscripts'], ['infinite-creatures']),
    combo('kiki-bombardment', [KIKI, 'Zealous Conscripts', 'Goblin Bombardment'], ['infinite-damage']),
    combo('kiki-purphoros', [KIKI, 'Zealous Conscripts', 'Purphoros, God of the Forge'], ['infinite-damage']),
    combo('krenko-staff', ['Krenko, Mob Boss', 'Thornbite Staff', 'Skirk Prospector'], ['infinite-creatures']),
  ]
  const index = buildComboIndex(combos)
  const accepted = setOf(
    'Krenko, Mob Boss',
    'Zealous Conscripts',
    'Goblin Bombardment',
    'Purphoros, God of the Forge',
  )

  it('gives Kiki-Jiki degree 3', () => {
    expect(comboDegree(index, accepted, card(KIKI))).toBe(3)
  })

  it('gives Thornbite Staff degree 0 — one piece is still missing', () => {
    expect(comboDegree(index, accepted, card('Thornbite Staff'))).toBe(0)
    expect(nearCombos(index, accepted, card('Thornbite Staff'), 1)).toBe(1)
  })

  it('promotes Thornbite Staff to degree 1 once Skirk Prospector is accepted', () => {
    const after = new Set([...accepted, card('Skirk Prospector')])
    expect(comboDegree(index, after, card('Thornbite Staff'))).toBe(1)
  })

  it('classifies the two-card infinite that brackets 1–3 restrict', () => {
    const kikiConscripts = index.byId.get(comboId('kiki-conscripts'))
    const kikiBombardment = index.byId.get(comboId('kiki-bombardment'))
    expect(kikiConscripts && isTwoCardInfinite(kikiConscripts)).toBe(true)
    expect(kikiBombardment && isTwoCardInfinite(kikiBombardment)).toBe(false)
    expect(kikiBombardment && producesInfinite(kikiBombardment)).toBe(true)
  })
})
