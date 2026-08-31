import { describe, expect, it } from 'vitest'
import type { Card, CardType, Color, Legality } from './card.js'
import type { Deck, DeckEntry } from './deck.js'
import { deckId, oracleId, printingId } from './ids.js'
import type { OracleId } from './ids.js'
import {
  deckColorIdentity,
  deriveCanBeCommander,
  partnershipAllowed,
  validateDeck,
  type CommanderInfo,
} from './legality.js'

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
  power: null,
  toughness: null,
  loyalty: null,
  keywords: [],
  legalities: opts.legalities ?? { commander: 'legal' },
  edhrecRank: null,
  defaultPrinting: printingId(`${name}-p`),
  roles: ['synergy'],
  primaryRole: opts.primaryRole ?? 'synergy',
  universesBeyond: false,
  gameChanger: false,
  synergyProduces: [],
  synergyWants: [],
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
  description: '',
  commanders: commanders.map(oracleId),
  targetBracket: 3,
  archetype: 'midrange',
  archetypeSecondary: null,
  colorIdentity,
  entries: names.map((n) => entry(n)),
  budget: null,
  excludeUniversesBeyond: false,
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
  const deck = makeDeck(
    ['Krenko'],
    fillers.map((f) => f.name),
  )
  return {
    deck,
    cards: cardMap(cmdr, ...fillers),
    info: new Map([[oracleId('Krenko'), commander]]),
  }
}

describe('validateDeck', () => {
  it('accepts a legal 100-card deck', () => {
    const { deck, cards, info } = legalDeck()
    expect(validateDeck(deck, cards, info)).toEqual({ legal: true, problems: [] })
  })

  it('rejects a deck that is not 100 cards', () => {
    const cmdr = card('Krenko')
    const deck = makeDeck(['Krenko'], ['a'])
    const report = validateDeck(
      deck,
      cardMap(cmdr, card('a')),
      new Map([[oracleId('Krenko'), commander]]),
    )
    expect(report.legal).toBe(false)
    expect(report.problems).toContainEqual({ kind: 'wrong-card-count', actual: 2, expected: 100 })
  })

  it('reports every problem rather than stopping at the first', () => {
    const cmdr = card('Krenko')
    const banned = card('banned', { legalities: { commander: 'banned' } })
    const offColor = card('offColor', { colorIdentity: ['G'] })
    const deck = makeDeck(['Krenko'], ['banned', 'offColor'])
    const report = validateDeck(
      deck,
      cardMap(cmdr, banned, offColor),
      new Map([[oracleId('Krenko'), commander]]),
    )
    const kinds = report.problems.map((p) => p.kind)
    expect(kinds).toContain('banned')
    expect(kinds).toContain('color-identity')
    expect(kinds).toContain('wrong-card-count')
  })

  it('rejects a card outside the commander colour identity and names the offending colours', () => {
    const cmdr = card('Krenko')
    const birds = card('Birds of Paradise', { colorIdentity: ['G'] })
    const deck = makeDeck(['Krenko'], ['Birds of Paradise'])
    const report = validateDeck(
      deck,
      cardMap(cmdr, birds),
      new Map([[oracleId('Krenko'), commander]]),
    )
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
    const deck = makeDeck(
      ['Krenko'],
      Array.from({ length: 5 }, () => 'Mountain'),
    )
    const report = validateDeck(
      deck,
      cardMap(cmdr, mountain),
      new Map([[oracleId('Krenko'), commander]]),
    )
    expect(report.problems.some((p) => p.kind === 'not-singleton')).toBe(false)
  })

  it('rejects a duplicate non-basic', () => {
    const sol = card('Sol Ring', { typeLine: 'Artifact' })
    const deck = makeDeck(['Krenko'], ['Sol Ring', 'Sol Ring'])
    const report = validateDeck(
      deck,
      cardMap(cmdr, sol),
      new Map([[oracleId('Krenko'), commander]]),
    )
    expect(report.problems).toContainEqual({
      kind: 'not-singleton',
      oracleId: oracleId('Sol Ring'),
      copies: 2,
      allowed: 1,
    })
  })

  it('allows unlimited copies of a card on the exception list', () => {
    const rats = card('Relentless Rats')
    const deck = makeDeck(
      ['Krenko'],
      Array.from({ length: 9 }, () => 'Relentless Rats'),
    )
    const report = validateDeck(
      deck,
      cardMap(cmdr, rats),
      new Map([[oracleId('Krenko'), commander]]),
      {
        unlimited: new Set([oracleId('Relentless Rats')]),
        limited: new Map(),
      },
    )
    expect(report.problems.some((p) => p.kind === 'not-singleton')).toBe(false)
  })

  it('enforces a specific higher limit', () => {
    const nazgul = card('Nazgul')
    const exceptions = {
      unlimited: new Set<OracleId>(),
      limited: new Map([[oracleId('Nazgul'), 9]]),
    }
    const under = makeDeck(
      ['Krenko'],
      Array.from({ length: 9 }, () => 'Nazgul'),
    )
    const over = makeDeck(
      ['Krenko'],
      Array.from({ length: 10 }, () => 'Nazgul'),
    )
    const info = new Map([[oracleId('Krenko'), commander]])
    expect(
      validateDeck(under, cardMap(cmdr, nazgul), info, exceptions).problems.some(
        (p) => p.kind === 'not-singleton',
      ),
    ).toBe(false)
    expect(
      validateDeck(over, cardMap(cmdr, nazgul), info, exceptions).problems.some(
        (p) => p.kind === 'not-singleton',
      ),
    ).toBe(true)
  })
})

describe('partnershipAllowed', () => {
  const c = (id: string, rule: CommanderInfo['partnerRule']) => ({
    oracleId: oracleId(id),
    partnerRule: rule,
  })

  it('allows two Partner commanders', () => {
    expect(
      partnershipAllowed(c('a', { kind: 'partner' }), c('b', { kind: 'partner' })).allowed,
    ).toBe(true)
  })

  it('allows Partner With only when the cards name each other', () => {
    const a = c('a', { kind: 'partner-with', partner: oracleId('b') })
    const b = c('b', { kind: 'partner-with', partner: oracleId('a') })
    const stranger = c('z', { kind: 'partner-with', partner: oracleId('y') })
    expect(partnershipAllowed(a, b).allowed).toBe(true)
    expect(partnershipAllowed(a, stranger).allowed).toBe(false)
  })

  it('allows Friends Forever with Friends Forever', () => {
    expect(
      partnershipAllowed(c('a', { kind: 'friends-forever' }), c('b', { kind: 'friends-forever' }))
        .allowed,
    ).toBe(true)
  })

  it('allows a Background with a plain commander', () => {
    expect(
      partnershipAllowed(c('a', { kind: 'none' }), c('b', { kind: 'background' })).allowed,
    ).toBe(true)
  })

  it('refuses a plain pair, and says why', () => {
    const verdict = partnershipAllowed(c('a', { kind: 'none' }), c('b', { kind: 'none' }))
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toMatch(/may not be paired/)
  })

  it('refuses Partner paired with Friends Forever', () => {
    expect(
      partnershipAllowed(c('a', { kind: 'partner' }), c('b', { kind: 'friends-forever' })).allowed,
    ).toBe(false)
  })
})

/**
 * Commander eligibility, against real cards.
 *
 * Every type line and every quoted line of rules text below was read out of the
 * 34,492-card corpus rather than written here. That is the whole point: the
 * cases that break this rule — a land whose BACK is a legendary creature, a
 * Background that never says it can lead a deck, reminder text that says the
 * phrase about somebody else — are not cases anyone invents at a keyboard
 * (AGENTS.md §4).
 */
describe('deriveCanBeCommander', () => {
  const eligible = (typeLine: string, oracleText = '', commander: Legality = 'legal'): boolean =>
    deriveCanBeCommander({ typeLine, oracleText, legalities: { commander } })

  it('accepts a legendary creature', () => {
    // Krenko, Mob Boss.
    expect(eligible('Legendary Creature — Goblin Warrior')).toBe(true)
  })

  it('refuses an artifact, which is the bug this exists for', () => {
    // A deck was created on production with Sol Ring in the command zone.
    expect(eligible('Artifact', '{T}: Add {C}{C}.')).toBe(false)
  })

  it('refuses a plain legendary artifact', () => {
    // Legendary is not enough on its own: 208 legal legendary artifacts are in
    // the corpus and none of them may lead a deck.
    expect(eligible('Legendary Artifact')).toBe(false)
  })

  it('refuses a legendary planeswalker whose text does not say it may lead a deck', () => {
    // Ajani Goldmane and 266 others. The type line looks eligible and is not.
    expect(eligible('Legendary Planeswalker — Ajani', '+1: You gain 2 life.')).toBe(false)
  })

  it('accepts a planeswalker whose text says it can be your commander', () => {
    // Rowan Kenrith, verbatim.
    expect(
      eligible(
        'Legendary Planeswalker — Rowan',
        'Partner with Will Kenrith\nRowan Kenrith can be your commander.',
      ),
    ).toBe(true)
  })

  it('reads the phrase, not the card name in front of it', () => {
    // "Svega, the Unconventional" says "Svega can be your commander." A rule
    // keyed to the card's own full name would miss it.
    expect(eligible('Legendary Planeswalker — Svega', 'Svega can be your commander.')).toBe(true)
  })

  it('accepts a Background, which never says so itself', () => {
    // Candlekeep Sage, verbatim — nothing here mentions being a commander. The
    // 31 cards with `Choose a Background` carry the reminder text that does:
    // "You can have a Background as a second commander."
    expect(
      eligible(
        'Legendary Enchantment — Background',
        'Commander creatures you own have "When this creature enters or leaves the battlefield, draw a card."',
      ),
    ).toBe(true)
  })

  it('accepts a card that is a creature everywhere except the battlefield', () => {
    // Grist, the Hunger Tide — a planeswalker type line, and the only card in
    // the corpus with this clause. It leads decks because the command zone is
    // not the battlefield.
    expect(
      eligible(
        'Legendary Planeswalker — Grist',
        "As long as Grist isn't on the battlefield, it's a 1/1 Insect creature in addition to its other types.\n+1: Create a 1/1 black and green Insect creature token, then mill a card.",
      ),
    ).toBe(true)
  })

  it('reads the front face, not the whole type line', () => {
    // Westvale Abbey // Ormendahl, Profane Prince. You cast the land; the
    // legendary creature is the back. A substring test over the joined line
    // offers a land as a commander — which the web search did until this
    // predicate replaced it.
    expect(eligible('Land // Legendary Creature — Demon', '{T}: Add {C}.')).toBe(false)
  })

  it('refuses a battle whose back face is a legendary creature', () => {
    // Invasion of Ikoria // Zilortha, Apex of Ikoria, and nine more like it.
    expect(eligible('Battle — Siege // Legendary Creature — Dinosaur')).toBe(false)
  })

  it('accepts a double-faced card whose FRONT is the legendary creature', () => {
    // Tergrid, God of Fright // Tergrid's Lantern.
    expect(eligible('Legendary Creature — God // Legendary Artifact')).toBe(true)
  })

  it('refuses a card that is not legal in Commander, whatever its type line', () => {
    // Un-set and playtest legends. Legality is also what keeps the text rule
    // honest: every card where "can be your commander" appears in reminder
    // text about a DIFFERENT card is not_legal.
    expect(eligible('Legendary Creature — Human Wizard', '', 'not_legal')).toBe(false)
    expect(eligible('Legendary Creature — Human Wizard', '', 'banned')).toBe(false)
  })

  it('does not read "can be your commanders" out of somebody else’s reminder text', () => {
    // Wizard from Beyond, a Background whose reminder text says the CREATURE
    // choosing it becomes legendary "and can be your commander". It is not_legal,
    // which is the only reason this reads correctly — recorded so that the day
    // a legal card carries the phrase about another card, this test says why.
    expect(
      eligible(
        'Legendary Enchantment — Background',
        'Create a Character (Any nonlegendary creature can choose this as its Background. It becomes legendary and can be your commander.)',
        'not_legal',
      ),
    ).toBe(false)
  })

  it('refuses a legendary Vehicle — a known gap, not an oversight', () => {
    // Shorikai, Genesis Engine is a real face commander and this says no. Its
    // oracle text is indistinguishable from Heart of Kiran's, which is not a
    // commander, so nothing in the data separates them. Asserting the rule from
    // memory is what AGENTS.md §8 forbids; the gap is reported instead. Change
    // this test the day the corpus carries a field that decides it.
    expect(
      eligible(
        'Legendary Artifact — Vehicle',
        '{1}, {T}: Draw two cards, then discard a card.\nCrew 8',
      ),
    ).toBe(false)
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
