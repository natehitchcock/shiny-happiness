import { describe, expect, it } from 'vitest'
import {
  BRACKET_DATA,
  bracketViolations,
  deckGameChangers,
  loadBracketRules,
  type BracketRuleset,
  type RawBracketData,
} from './bracket-rules.js'
import { oracleId } from './ids.js'
import type { OracleId } from './ids.js'

const gc = (n: number): OracleId => oracleId(`gc-${n}`)
const plain = (n: number): OracleId => oracleId(`plain-${n}`)

/** Two Game Changers, so no test relies on the corpus being empty. */
const CORPUS: readonly OracleId[] = [gc(1), gc(2), gc(3), gc(4)]

const bracketsWith = (allowances: readonly (number | 'unlimited' | null)[]) =>
  allowances.map((allowed, index) => ({
    bracket: index + 1,
    name: `B${index + 1}`,
    gameChangersAllowed: allowed,
    massLandDenial: null,
    extraTurnChaining: null,
    twoCardInfinites: null,
    tutorDensity: null,
  }))

const raw = (over: Partial<RawBracketData> = {}): RawBracketData => ({
  sourceUrl: 'https://example.invalid/brackets',
  retrievedAt: '2026-08-30',
  brackets: bracketsWith([0, 0, 3, 'unlimited', 'unlimited']),
  ...over,
})

const loaded = (over: Partial<RawBracketData> = {}): BracketRuleset => {
  const result = loadBracketRules(raw(over), CORPUS)
  if (!result.ok) throw new Error(`fixture failed to load: ${result.error.message}`)
  return result.value
}

describe('loadBracketRules', () => {
  it('loads the checked-in bracket data', () => {
    const result = loadBracketRules(BRACKET_DATA, CORPUS)
    expect(result.ok).toBe(true)
  })

  /*
   * The one allowance Wizards publishes, pinned to the fetched wording:
   * "Bracket 1 and 2 decks exclude Game Changers. Bracket 3 allows for up to
   * three Game Changers. Brackets 4 and 5 allow for unlimited Game Changers."
   * (https://magic.wizards.com/en/formats/commander, retrieved 2026-08-30)
   *
   * Asserted against the real file rather than a fixture, because the value that
   * matters is the one that ships. A typo here — 4 instead of 3, or an
   * allowance on Bracket 2 — is a wrong verdict in the product.
   */
  it('reads the Game Changers allowance Wizards publishes', () => {
    const result = loadBracketRules(BRACKET_DATA, CORPUS)
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.byBracket.get(1)?.gameChangersAllowed).toBe(0)
    expect(result.value.byBracket.get(2)?.gameChangersAllowed).toBe(0)
    expect(result.value.byBracket.get(3)?.gameChangersAllowed).toBe(3)
    expect(result.value.byBracket.get(4)?.gameChangersAllowed).toBe('unlimited')
    expect(result.value.byBracket.get(5)?.gameChangersAllowed).toBe('unlimited')
  })

  /*
   * ADR-0006 in one assertion. The four barometers Wizards no longer publishes
   * per bracket must stay null in the shipped file: `'allowed'` would be an
   * invented permission, and `'forbidden'` an invented prohibition. If a later
   * change populates them, this test should be updated together with the quoted
   * wording that justifies the values — not deleted to get green.
   */
  it('keeps every unpublished barometer null in the checked-in data', () => {
    const result = loadBracketRules(BRACKET_DATA, CORPUS)
    if (!result.ok) throw new Error(result.error.message)
    for (const rules of result.value.byBracket.values()) {
      expect(rules.massLandDenial).toBeNull()
      expect(rules.extraTurnChaining).toBeNull()
      expect(rules.twoCardInfinites).toBeNull()
      expect(rules.tutorDensity).toBeNull()
    }
  })

  it('carries the source url and retrieval date through', () => {
    const result = loadBracketRules(BRACKET_DATA, CORPUS)
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.sourceUrl).toBe('https://magic.wizards.com/en/formats/commander')
    expect(result.value.retrievedAt).toBe('2026-08-30')
  })

  it('reports data with no source url as unpopulated instead of guessing', () => {
    const result = loadBracketRules(raw({ sourceUrl: null }), CORPUS)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe('not-populated')
      expect(result.error.message).toMatch(/DATA-05|ADR-0006/)
    }
  })

  it('reports data with no retrieval date as unpopulated', () => {
    const result = loadBracketRules(raw({ retrievedAt: null }), CORPUS)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('not-populated')
  })

  it('reports a missing Game Changers allowance as unpopulated', () => {
    const result = loadBracketRules(
      raw({ brackets: bracketsWith([0, 0, null, 'unlimited', 'unlimited']) }),
      CORPUS,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('not-populated')
  })

  /*
   * The barometers Wizards dropped must NOT make the file unloadable — that was
   * the old behaviour, and it is why the whole feature was dark. A null here is
   * "the format has no rule", which is loadable data.
   */
  it('loads despite every other barometer being null', () => {
    const result = loadBracketRules(raw(), CORPUS)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.byBracket.get(1)?.tutorDensity).toBeNull()
  })

  it('still accepts a barometer that has a value', () => {
    const brackets = bracketsWith([0, 0, 3, 'unlimited', 'unlimited']).map((b) => ({
      ...b,
      massLandDenial: 'forbidden',
      tutorDensity: 'low',
    }))
    const result = loadBracketRules(raw({ brackets }), CORPUS)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.byBracket.get(1)?.massLandDenial).toBe('forbidden')
      expect(result.value.byBracket.get(1)?.tutorDensity).toBe('low')
    }
  })

  it('rejects an unknown permission value', () => {
    const brackets = bracketsWith([0, 0, 3, 'unlimited', 'unlimited']).map((b) => ({
      ...b,
      massLandDenial: 'sometimes',
    }))
    const result = loadBracketRules(raw({ brackets }), CORPUS)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('malformed')
  })

  it('rejects an unknown tutor density', () => {
    const brackets = bracketsWith([0, 0, 3, 'unlimited', 'unlimited']).map((b) => ({
      ...b,
      tutorDensity: 'some',
    }))
    const result = loadBracketRules(raw({ brackets }), CORPUS)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('malformed')
  })

  it('rejects a negative Game Changers allowance', () => {
    const result = loadBracketRules(
      raw({ brackets: bracketsWith([-1, 0, 3, 'unlimited', 'unlimited']) }),
      CORPUS,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('malformed')
  })

  it('rejects a file missing brackets', () => {
    const result = loadBracketRules(raw({ brackets: bracketsWith([0]) }), CORPUS)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('malformed')
  })

  it('rejects a bracket number outside 1-5', () => {
    const brackets = [{ ...bracketsWith([0])[0]!, bracket: 6 }]
    const result = loadBracketRules(raw({ brackets }), CORPUS)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('malformed')
  })

  /*
   * An empty corpus set satisfies every allowance vacuously, so a deck of
   * nothing but Game Changers would pass Bracket 1 and the app would say so with
   * a straight face. Refusing to load is the only honest answer, and this test
   * is the one standing between that and a silent wrong verdict.
   */
  it('refuses to load when the corpus supplies no Game Changers', () => {
    const result = loadBracketRules(raw(), [])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe('game-changers-empty')
      expect(result.error.message).toMatch(/ingest/)
    }
  })

  it('takes the Game Changers list from the corpus, not the file', () => {
    const result = loadBracketRules(raw(), [gc(1), gc(2)])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.gameChangers.size).toBe(2)
      expect(result.value.gameChangers.has(gc(1))).toBe(true)
      expect(result.value.gameChangers.has(gc(3))).toBe(false)
    }
  })

  it('deduplicates a corpus list that repeats an id', () => {
    const result = loadBracketRules(raw(), [gc(1), gc(1), gc(2)])
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.gameChangers.size).toBe(2)
  })
})

describe('deckGameChangers', () => {
  it('returns only the deck cards that are on the list', () => {
    expect(deckGameChangers(loaded(), [plain(1), gc(2), plain(3), gc(4)])).toEqual([gc(2), gc(4)])
  })

  it('is empty for a deck with none', () => {
    expect(deckGameChangers(loaded(), [plain(1), plain(2)])).toEqual([])
  })

  // A deck cannot hold two copies of a nonbasic anyway, but a commander that is
  // also listed as an entry would otherwise be counted twice and push the deck
  // over an allowance it does not actually break.
  it('counts a repeated card once', () => {
    expect(deckGameChangers(loaded(), [gc(1), gc(1)])).toEqual([gc(1)])
  })
})

describe('bracketViolations', () => {
  it('reports nothing when the deck is inside the allowance', () => {
    expect(bracketViolations(loaded(), 3, [gc(1), gc(2), gc(3)])).toEqual([])
  })

  /*
   * The boundary is the whole rule. "Up to three" includes three and excludes
   * four, and an off-by-one here is a false accusation or a missed one.
   */
  it('reports a violation one card past the allowance', () => {
    const violations = bracketViolations(loaded(), 3, [gc(1), gc(2), gc(3), gc(4)])
    expect(violations.length).toBe(1)
    expect(violations[0]?.flag).toBe('game-changer')
    expect(violations[0]?.allowed).toBe(3)
    expect(violations[0]?.actual).toBe(4)
    expect(violations[0]?.cards).toEqual([gc(1), gc(2), gc(3), gc(4)])
  })

  it('reports a single Game Changer as a violation at bracket 1', () => {
    const violations = bracketViolations(loaded(), 1, [gc(1), plain(1)])
    expect(violations.length).toBe(1)
    expect(violations[0]?.allowed).toBe(0)
    expect(violations[0]?.actual).toBe(1)
  })

  it('reports nothing at bracket 1 for a deck with none', () => {
    expect(bracketViolations(loaded(), 1, [plain(1), plain(2)])).toEqual([])
  })

  it('reports nothing at an unlimited bracket, however many the deck holds', () => {
    expect(bracketViolations(loaded(), 4, [gc(1), gc(2), gc(3), gc(4)])).toEqual([])
    expect(bracketViolations(loaded(), 5, [gc(1), gc(2), gc(3), gc(4)])).toEqual([])
  })

  it('ignores cards that are not Game Changers when counting', () => {
    expect(bracketViolations(loaded(), 1, [plain(1), plain(2), plain(3), plain(4)])).toEqual([])
  })

  it('says which bracket and how many, in the message', () => {
    const violations = bracketViolations(loaded(), 3, [gc(1), gc(2), gc(3), gc(4)])
    expect(violations[0]?.message).toContain('Bracket 3')
    expect(violations[0]?.message).toContain('4')
  })

  it('pluralises the allowance correctly', () => {
    const one = loaded({ brackets: bracketsWith([1, 0, 3, 'unlimited', 'unlimited']) })
    expect(bracketViolations(one, 1, [gc(1), gc(2)])[0]?.message).toContain('1 Game Changer;')
    expect(bracketViolations(loaded(), 3, CORPUS)[0]?.message).toContain('3 Game Changers;')
  })
})
