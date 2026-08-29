import { describe, expect, it } from 'vitest'
import type { Card, CardType, Color } from './card.js'
import type { Deck, DeckEntry } from './deck.js'
import { deckId, oracleId, printingId } from './ids.js'
import type { OracleId } from './ids.js'
import {
  deckColorIdentity,
  partnershipAllowed,
  validateDeck,
  type CommanderInfo,
} from './legality.js'
import { loadBracketRules, type RawBracketData } from './bracket-rules.js'
import rawBracketData from './brackets/rules.data.json' with { type: 'json' }

const card = (
  name: string,
  opts: Partial<Card> & { typeLine?: string; colorIdentity?: readonly Color[] } = {},
): Card => ({
  oracleId: oracleId(name),
  name,
  manaCost: '{1}',
  manaValue: 1,
  colorIdentity: opts.colorIdentity ?? ['R'],
  colors: opts.colors ?? ['R'],
  typeLine: opts.typeLine ?? 'Creature — Goblin',
  types: (opts.types ?? ['creature']) as readonly CardType[],
  oracleText: opts.oracleText ?? '',
  keywords: [],
  legalities: opts.legalities ?? { commander: 'legal' },
  edhrecRank: null,
  defaultPrinting: printingId(`${name}-p`),
  roles: ['synergy'],
  primaryRole: opts.primaryRole ?? 'synergy',
})

const entry = (name: string, over: Partial<DeckEntry> = {}): DeckEntry => ({
  oracleId: oracleId(name),
  zone: 'accepted',
  origin: 'manual',
  locked: false,
  roleOverride: null,
  tags: [],
  addedAt: '2026-01-01T00:00:00Z',
  ...over,
})

const makeDeck = (commanders: string[], names: string[], colorIdentity: Color[] = ['R']): Deck => ({
  id: deckId('d1'),
  name: 'test',
  commanders: commanders.map(oracleId),
  targetBracket: 3,
  archetype: 'midrange',
  archetypeSecondary: null,
  colorIdentity,
  entries: names.map((n) => entry(n)),
  budget: null,
  status: 'active',
  version: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  lastOpenedAt: '2026-01-01T00:00:00Z',
})

const commander: CommanderInfo = { canBeCommander: true, partnerRule: { kind: 'none' } }

const cardMap = (...cards: Card[]): ReadonlyMap<OracleId, Card> =>
  new Map(cards.map((c) => [c.oracleId, c]))

/** 99 distinct filler cards plus the commander = a legal 100. */
const legalDeck = () => {
  const fillers = Array.from({ length: 99 }, (_, i) => card(`filler-${i}`))
  const cmdr = card('Krenko')
  const deck = makeDeck(['Krenko'], fillers.map((f) => f.name))
  return { deck, cards: cardMap(cmdr, ...fillers), info: new Map([[oracleId('Krenko'), commander]]) }
}

describe('validateDeck', () => {
  it('accepts a legal 100-card deck', () => {
    const { deck, cards, info } = legalDeck()
    expect(validateDeck(deck, cards, info)).toEqual({ legal: true, problems: [] })
  })

  it('rejects a deck that is not 100 cards', () => {
    const cmdr = card('Krenko')
    const deck = makeDeck(['Krenko'], ['a'])
    const report = validateDeck(deck, cardMap(cmdr, card('a')), new Map([[oracleId('Krenko'), commander]]))
    expect(report.legal).toBe(false)
    expect(report.problems).toContainEqual({ kind: 'wrong-card-count', actual: 2, expected: 100 })
  })

  it('reports every problem rather than stopping at the first', () => {
    const cmdr = card('Krenko')
    const banned = card('banned', { legalities: { commander: 'banned' } })
    const offColor = card('offColor', { colorIdentity: ['G'] })
    const deck = makeDeck(['Krenko'], ['banned', 'offColor'])
    const report = validateDeck(deck, cardMap(cmdr, banned, offColor), new Map([[oracleId('Krenko'), commander]]))
    const kinds = report.problems.map((p) => p.kind)
    expect(kinds).toContain('banned')
    expect(kinds).toContain('color-identity')
    expect(kinds).toContain('wrong-card-count')
  })

  it('rejects a card outside the commander colour identity and names the offending colours', () => {
    const cmdr = card('Krenko')
    const birds = card('Birds of Paradise', { colorIdentity: ['G'] })
    const deck = makeDeck(['Krenko'], ['Birds of Paradise'])
    const report = validateDeck(deck, cardMap(cmdr, birds), new Map([[oracleId('Krenko'), commander]]))
    expect(report.problems).toContainEqual({
      kind: 'color-identity',
      oracleId: oracleId('Birds of Paradise'),
      offending: ['G'],
    })
  })

  it('reports a missing commander and a card it has never heard of', () => {
    const deck = makeDeck([], ['ghost'])
    const report = validateDeck(deck, new Map(), new Map())
    const kinds = report.problems.map((p) => p.kind)
    expect(kinds).toContain('no-commander')
    expect(kinds).toContain('unknown-card')
  })

  it('rejects a commander that may not be one', () => {
    const cmdr = card('Sol Ring', { typeLine: 'Artifact' })
    const deck = makeDeck(['Sol Ring'], [])
    const report = validateDeck(deck, cardMap(cmdr), new Map())
    expect(report.problems.some((p) => p.kind === 'invalid-commander')).toBe(true)
  })

  it('rejects three commanders', () => {
    const deck = makeDeck(['a', 'b', 'c'], [])
    const report = validateDeck(deck, cardMap(card('a'), card('b'), card('c')), new Map())
    expect(report.problems).toContainEqual({ kind: 'too-many-commanders', count: 3 })
  })
})

describe('singleton', () => {
  const cmdr = card('Krenko')

  it('allows any number of basic lands', () => {
    const mountain = card('Mountain', { typeLine: 'Basic Land — Mountain', types: ['land'] })
    const deck = makeDeck(['Krenko'], Array.from({ length: 5 }, () => 'Mountain'))
    const report = validateDeck(deck, cardMap(cmdr, mountain), new Map([[oracleId('Krenko'), commander]]))
    expect(report.problems.some((p) => p.kind === 'not-singleton')).toBe(false)
  })

  it('rejects a duplicate non-basic', () => {
    const sol = card('Sol Ring', { typeLine: 'Artifact' })
    const deck = makeDeck(['Krenko'], ['Sol Ring', 'Sol Ring'])
    const report = validateDeck(deck, cardMap(cmdr, sol), new Map([[oracleId('Krenko'), commander]]))
    expect(report.problems).toContainEqual({
      kind: 'not-singleton',
      oracleId: oracleId('Sol Ring'),
      copies: 2,
      allowed: 1,
    })
  })

  it('allows unlimited copies of a card on the exception list', () => {
    const rats = card('Relentless Rats')
    const deck = makeDeck(['Krenko'], Array.from({ length: 9 }, () => 'Relentless Rats'))
    const report = validateDeck(deck, cardMap(cmdr, rats), new Map([[oracleId('Krenko'), commander]]), {
      unlimited: new Set([oracleId('Relentless Rats')]),
      limited: new Map(),
    })
    expect(report.problems.some((p) => p.kind === 'not-singleton')).toBe(false)
  })

  it('enforces a specific higher limit', () => {
    const nazgul = card('Nazgul')
    const exceptions = { unlimited: new Set<OracleId>(), limited: new Map([[oracleId('Nazgul'), 9]]) }
    const under = makeDeck(['Krenko'], Array.from({ length: 9 }, () => 'Nazgul'))
    const over = makeDeck(['Krenko'], Array.from({ length: 10 }, () => 'Nazgul'))
    const info = new Map([[oracleId('Krenko'), commander]])
    expect(validateDeck(under, cardMap(cmdr, nazgul), info, exceptions).problems.some((p) => p.kind === 'not-singleton')).toBe(false)
    expect(validateDeck(over, cardMap(cmdr, nazgul), info, exceptions).problems.some((p) => p.kind === 'not-singleton')).toBe(true)
  })
})

describe('partnershipAllowed', () => {
  const c = (id: string, rule: CommanderInfo['partnerRule']) => ({ oracleId: oracleId(id), partnerRule: rule })

  it('allows two Partner commanders', () => {
    expect(partnershipAllowed(c('a', { kind: 'partner' }), c('b', { kind: 'partner' })).allowed).toBe(true)
  })

  it('allows Partner With only when the cards name each other', () => {
    const a = c('a', { kind: 'partner-with', partner: oracleId('b') })
    const b = c('b', { kind: 'partner-with', partner: oracleId('a') })
    const stranger = c('z', { kind: 'partner-with', partner: oracleId('y') })
    expect(partnershipAllowed(a, b).allowed).toBe(true)
    expect(partnershipAllowed(a, stranger).allowed).toBe(false)
  })

  it('allows Friends Forever with Friends Forever', () => {
    expect(partnershipAllowed(c('a', { kind: 'friends-forever' }), c('b', { kind: 'friends-forever' })).allowed).toBe(true)
  })

  it('allows a Background with a plain commander', () => {
    expect(partnershipAllowed(c('a', { kind: 'none' }), c('b', { kind: 'background' })).allowed).toBe(true)
  })

  it('refuses a plain pair, and says why', () => {
    const verdict = partnershipAllowed(c('a', { kind: 'none' }), c('b', { kind: 'none' }))
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toMatch(/may not be paired/)
  })

  it('refuses Partner paired with Friends Forever', () => {
    expect(partnershipAllowed(c('a', { kind: 'partner' }), c('b', { kind: 'friends-forever' })).allowed).toBe(false)
  })
})

describe('deckColorIdentity', () => {
  it('unions the commanders', () => {
    const a = card('a', { colorIdentity: ['R'] })
    const b = card('b', { colorIdentity: ['W', 'R'] })
    expect(new Set(deckColorIdentity([oracleId('a'), oracleId('b')], cardMap(a, b)))).toEqual(
      new Set(['R', 'W']),
    )
  })

  it('is empty for a colourless commander', () => {
    const a = card('a', { colorIdentity: [] })
    expect(deckColorIdentity([oracleId('a')], cardMap(a))).toEqual([])
  })
})

describe('loadBracketRules', () => {
  // ADR-0006: the official allowances have not been fetched. The loader must say
  // so rather than letting the app assert a bracket verdict it cannot support.
  it('reports the checked-in data as unpopulated instead of guessing', () => {
    const result = loadBracketRules(rawBracketData as RawBracketData)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe('not-populated')
      expect(result.error.message).toMatch(/DATA-05|ADR-0006/)
    }
  })

  it('loads a fully populated file', () => {
    const populated: RawBracketData = {
      sourceUrl: 'https://example.invalid/brackets',
      retrievedAt: '2026-08-29',
      brackets: [1, 2, 3, 4, 5].map((n) => ({
        bracket: n,
        name: `B${n}`,
        gameChangersAllowed: n >= 4 ? ('unlimited' as const) : n,
        massLandDenial: 'forbidden',
        extraTurnChaining: 'discouraged',
        twoCardInfinites: 'allowed',
        tutorDensity: 'moderate',
      })),
      gameChangers: ['gc-1', 'gc-2'],
    }
    const result = loadBracketRules(populated)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.byBracket.size).toBe(5)
      expect(result.value.gameChangers.size).toBe(2)
      expect(result.value.byBracket.get(4)?.gameChangersAllowed).toBe('unlimited')
    }
  })

  it('rejects an unknown permission value', () => {
    const bad = {
      sourceUrl: 'x', retrievedAt: 'y',
      brackets: [{ bracket: 1, name: 'B1', gameChangersAllowed: 0, massLandDenial: 'sometimes', extraTurnChaining: 'allowed', twoCardInfinites: 'allowed', tutorDensity: 'low' }],
      gameChangers: [],
    } as RawBracketData
    const result = loadBracketRules(bad)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('malformed')
  })

  it('rejects a file missing brackets', () => {
    const short = {
      sourceUrl: 'x', retrievedAt: 'y',
      brackets: [{ bracket: 1, name: 'B1', gameChangersAllowed: 0, massLandDenial: 'allowed', extraTurnChaining: 'allowed', twoCardInfinites: 'allowed', tutorDensity: 'low' }],
      gameChangers: [],
    } as RawBracketData
    const result = loadBracketRules(short)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('malformed')
  })
})
