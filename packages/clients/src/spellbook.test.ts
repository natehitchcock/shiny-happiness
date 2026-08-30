import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  parseIdentity,
  piecesOf,
  toCombo,
  toComboResult,
  variantSkipReason,
  type SpellbookVariant,
} from './spellbook.js'

/** Recorded fixture, never the live API (AGENTS.md §4). */
const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'spellbook-variants-sample.json',
)

const { variants } = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
  variants: SpellbookVariant[]
}

describe('toComboResult', () => {
  it('maps the mana features that actually appear in the feed', () => {
    // The vocabulary is open-ended: "colored", "red", "green" are all separate
    // features. Substring matching is why a new colour needs no code change.
    expect(toComboResult('Infinite colorless mana')).toBe('infinite-mana')
    expect(toComboResult('Infinite colored mana')).toBe('infinite-mana')
    expect(toComboResult('Infinite red mana')).toBe('infinite-mana')
  })

  it('prefers tokens over creatures when a feature says both', () => {
    // "Infinite creature tokens with haste" is a token engine, not a creature
    // count; the pattern order encodes that.
    expect(toComboResult('Infinite creature tokens with haste')).toBe('infinite-tokens')
    expect(toComboResult('Infinite Treasure tokens')).toBe('infinite-tokens')
  })

  it('maps a win condition stated from the other side', () => {
    // "Each opponent loses the game" is a win, and must not fall through to
    // `value` just because it does not contain the word "win".
    expect(toComboResult('Each opponent loses the game')).toBe('win-the-game')
    expect(toComboResult('Win the game')).toBe('win-the-game')
  })

  it('maps a lock', () => {
    expect(toComboResult('Opponents cannot cast spells')).toBe('lock')
  })

  it('treats infinite combat phases as extra turns, the closest the union has', () => {
    // Brackets restrict extra-turn chaining (doc 03 §3.2), and infinite combats
    // is the same kind of thing. `value` would understate it.
    expect(toComboResult('Infinite combat phases')).toBe('infinite-turns')
  })

  it('falls back to value rather than guessing at an unknown feature', () => {
    expect(toComboResult('Infinite death triggers')).toBe('value')
    expect(toComboResult('Something nobody has written yet')).toBe('value')
  })
})

describe('parseIdentity', () => {
  it('reads a multicolour identity', () => {
    expect(parseIdentity('WUB')).toEqual(['W', 'U', 'B'])
  })

  it('treats Spellbook colourless "C" as the domain\'s empty identity', () => {
    // "C" is not a Color. Left in, it would fail the char(1)[] column check and
    // break every colour-identity comparison.
    expect(parseIdentity('C')).toEqual([])
  })

  it('handles an absent identity', () => {
    expect(parseIdentity(undefined)).toEqual([])
  })
})

describe('variantSkipReason', () => {
  it('accepts an OK variant with pieces', () => {
    expect(variantSkipReason(variants[0]!)).toBeNull()
  })

  it('skips a variant their own editors have not accepted', () => {
    // Publishing a draft as fact would put combos in front of users that
    // Spellbook itself has not signed off.
    expect(variantSkipReason({ ...variants[0]!, status: 'D' })).toBe('not-ok-status')
  })

  it('skips a variant with no card pieces', () => {
    expect(variantSkipReason({ id: 'x', status: 'OK', uses: [] })).toBe('no-pieces')
  })
})

describe('toCombo', () => {
  it('maps every fixture variant', () => {
    for (const variant of variants) {
      const combo = toCombo(variant)
      expect(combo).not.toBeNull()
      // The DB CHECK refuses a combo with no pieces; so does the domain.
      expect(combo!.pieces.length).toBeGreaterThan(0)
      expect(combo!.id).toBe(variant.id)
    }
  })

  it('maps pieces on oracle id, with no name matching anywhere', () => {
    const variant = variants[0]!
    const combo = toCombo(variant)!

    for (const piece of combo.pieces) {
      // Every piece is a uuid taken straight from `uses[].card.oracleId`.
      expect(piece).toMatch(/^[0-9a-f-]{36}$/)
    }
    expect(combo.pieces.length).toBe(new Set(piecesOf(variant)).size)
  })

  it('de-duplicates a card used twice in one combo', () => {
    const twice: SpellbookVariant = {
      id: 'dup-1',
      status: 'OK',
      uses: [
        { card: { oracleId: '11111111-1111-1111-1111-111111111111' } },
        { card: { oracleId: '11111111-1111-1111-1111-111111111111' } },
      ],
    }

    // A combo's pieces are a set; two copies is still one required card, and a
    // duplicate would double-count in comboDegree.
    expect(toCombo(twice)!.pieces).toHaveLength(1)
  })

  it('de-duplicates results that map to the same domain outcome', () => {
    const manyMana: SpellbookVariant = {
      id: 'mana-1',
      status: 'OK',
      uses: [{ card: { oracleId: '22222222-2222-2222-2222-222222222222' } }],
      produces: [
        { feature: { name: 'Infinite red mana' } },
        { feature: { name: 'Infinite green mana' } },
      ],
    }

    expect(toCombo(manyMana)!.produces).toEqual(['infinite-mana'])
  })

  it('returns null rather than a pieceless combo', () => {
    expect(toCombo({ id: 'empty', status: 'OK', uses: [] })).toBeNull()
  })
})
