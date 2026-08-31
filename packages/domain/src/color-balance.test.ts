import { describe, expect, it } from 'vitest'
import type { Card, Color, ManaLetter } from './card.js'
import { colorBalance, identityBucket } from './color-balance.js'
import { acceptedCopies, type Deck, type DeckEntry } from './deck.js'
import { deckId, oracleId, printingId } from './ids.js'
import type { OracleId } from './ids.js'

/**
 * Real cards, named as themselves, because the whole bug was a field mix-up
 * that only real cards expose.
 *
 * Command Tower's colour identity is EMPTY and it taps for all five; a
 * fetchland's identity is empty too and it produces nothing at all. A fixture
 * of invented cards where identity and production happen to agree would have
 * passed against the broken implementation, which is the point of AGENTS.md §4's
 * "fixtures over mocks".
 */
const card = (
  name: string,
  opts: {
    readonly colorIdentity?: readonly Color[]
    /** Omitted entirely for a row that predates migration 0008 — not `[]`. */
    readonly producedMana?: readonly ManaLetter[]
    readonly unknownProduction?: boolean
    /**
     * Real types, because "lands only" is a live way for this to go wrong.
     *
     * A fixture where every mana source happens to be a land cannot tell a
     * correct implementation from one that starts `if (!types.includes('land'))
     * continue` — which is exactly what the code being replaced here did.
     */
    readonly types?: Card['types']
  } = {},
): Card => ({
  oracleId: oracleId(name),
  name,
  manaCost: null,
  manaValue: 0,
  colorIdentity: opts.colorIdentity ?? [],
  colors: opts.colorIdentity ?? [],
  typeLine: (opts.types ?? ['land']).join(' '),
  types: opts.types ?? ['land'],
  oracleText: '',
  power: null,
  toughness: null,
  loyalty: null,
  keywords: [],
  legalities: { commander: 'legal' },
  edhrecRank: null,
  defaultPrinting: printingId(`${name}-p`),
  roles: ['land'],
  primaryRole: 'land',
  universesBeyond: false,
  gameChanger: false,
  synergyProduces: [],
  synergyWants: [],
  ...(opts.unknownProduction === true ? {} : { producedMana: opts.producedMana ?? [] }),
})

const CARDS: ReadonlyMap<OracleId, Card> = new Map(
  [
    card('krenko', { colorIdentity: ['R'], unknownProduction: true }),
    card('mountain', { colorIdentity: ['R'], producedMana: ['R'] }),
    card('command-tower', { producedMana: ['W', 'U', 'B', 'R', 'G'] }),
    // A fetch. Empty identity AND empty production — the pair that proves the
    // two fields are not interchangeable, since reading identity gives it the
    // same answer as Command Tower.
    card('scalding-tarn', { producedMana: [] }),
    // Not lands. A generation chart that filtered on `types.includes('land')` —
    // which is what the replaced code did — would lose both of these, and an
    // artifact ramp deck would report a third less mana than it has.
    card('sol-ring', { colorIdentity: [], producedMana: ['C'], types: ['artifact'] }),
    card('llanowar-elves', { colorIdentity: ['G'], producedMana: ['G'], types: ['creature'] }),
    card('wastes', { colorIdentity: [], producedMana: ['C'] }),
    card('steam-vents', { colorIdentity: ['U', 'R'], producedMana: ['U', 'R'] }),
    // Ingested before migration 0008: production unknown, not nil.
    card('ancient-tomb', { colorIdentity: [], unknownProduction: true }),
  ].map((c) => [c.oracleId, c]),
)

const entry = (name: string): DeckEntry => ({
  oracleId: oracleId(name),
  zone: 'accepted',
  origin: 'manual',
  locked: false,
  roleOverride: null,
  tags: [],
  addedAt: '2026-01-01T00:00:00Z',
})

const deckOf = (names: readonly string[], commanders: readonly string[] = ['krenko']): Deck => ({
  id: deckId('d'),
  name: 'd',
  description: '',
  commanders: commanders.map(oracleId),
  targetBracket: 3,
  archetype: 'midrange',
  archetypeSecondary: null,
  colorIdentity: ['R'],
  entries: names.map(entry),
  budget: null,
  excludeUniversesBeyond: false,
  status: 'active',
  version: 1,
  createdAt: '',
  updatedAt: '',
  lastOpenedAt: '',
})

describe('identityBucket', () => {
  it('puts a mono-coloured card in its own colour', () => {
    expect(identityBucket(['R'])).toBe('R')
  })

  it('puts two or more colours in M rather than in each colour', () => {
    // The design decision this whole chart rests on. Counting Steam Vents in
    // both U and R would make the slices total more than the deck holds.
    expect(identityBucket(['U', 'R'])).toBe('M')
    expect(identityBucket(['W', 'U', 'B', 'R', 'G'])).toBe('M')
  })

  it('calls an empty identity colourless, which is an answer and not a gap', () => {
    expect(identityBucket([])).toBe('C')
  })
})

describe('acceptedCopies', () => {
  it('returns one entry per copy, so ten Mountains are ten', () => {
    const deck = deckOf(['mountain', 'mountain', 'mountain'])
    expect(acceptedCopies(deck).filter((id) => id === oracleId('mountain'))).toHaveLength(3)
  })

  it('counts a commander that also has an accepted entry exactly once', () => {
    // Import a decklist with the commander in the hundred, then set it as the
    // commander, and the deck holds both rows.
    const deck = deckOf(['krenko', 'mountain'])
    expect(acceptedCopies(deck).filter((id) => id === oracleId('krenko'))).toHaveLength(1)
  })

  it('leaves out excluded entries', () => {
    const deck = deckOf(['mountain'])
    const withExcluded: Deck = {
      ...deck,
      entries: [...deck.entries, { ...entry('sol-ring'), zone: 'excluded' }],
    }
    expect(acceptedCopies(withExcluded)).toEqual([oracleId('krenko'), oracleId('mountain')])
  })
})

describe('colorBalance', () => {
  it('counts identity over copies, not over distinct cards', () => {
    /*
     * The original defect. `acceptedSet` is a Set of oracle ids, so twelve
     * Mountains counted once and a deck that is nine tenths red read as evenly
     * split with its one blue card.
     */
    const balance = colorBalance(deckOf(['mountain', 'mountain', 'mountain']), CARDS)
    expect(balance.identity.R).toBe(4) // three Mountains plus the commander
    expect(balance.cards).toBe(4)
  })

  it('gives every card exactly one identity bucket, so the slices sum to the deck', () => {
    const balance = colorBalance(
      deckOf(['mountain', 'steam-vents', 'sol-ring', 'llanowar-elves']),
      CARDS,
    )
    expect(balance.identity).toEqual({ W: 0, U: 0, B: 0, R: 2, G: 1, M: 1, C: 1 })
    const summed = Object.values(balance.identity).reduce((a, b) => a + b, 0)
    expect(summed).toBe(balance.cards)
    expect(summed).toBe(5)
  })

  it('puts a colourless card in the identity chart rather than dropping it', () => {
    // The reported bug: Sol Ring and Wastes were in the deck and in no slice.
    const balance = colorBalance(deckOf(['sol-ring', 'wastes']), CARDS)
    expect(balance.identity.C).toBe(2)
  })

  it('reads generation from producedMana, never from colorIdentity', () => {
    /*
     * Command Tower's identity is empty and it taps for all five. The old code
     * read identity for its "sources" figure, so the best fixing land in the
     * format contributed nothing to any colour.
     */
    const balance = colorBalance(deckOf(['command-tower']), CARDS)
    expect(balance.generation).toEqual({ W: 1, U: 1, B: 1, R: 1, G: 1, C: 0 })
    // And its identity is still colourless. Both statements are true at once,
    // which is exactly why one field cannot answer both questions.
    expect(balance.identity.C).toBe(1)
  })

  it('gives a fetchland no generation at all, though its identity matches a Tower', () => {
    const balance = colorBalance(deckOf(['scalding-tarn']), CARDS)
    expect(balance.generation).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 })
    expect(balance.producers).toBe(0)
  })

  it('counts colourless production, so Sol Ring and Wastes appear', () => {
    const balance = colorBalance(deckOf(['sol-ring', 'wastes']), CARDS)
    expect(balance.generation.C).toBe(2)
  })

  it('counts non-lands that make mana — a chart of lands only under-reports ramp', () => {
    const balance = colorBalance(deckOf(['sol-ring', 'llanowar-elves']), CARDS)
    expect(balance.generation.C).toBe(1)
    expect(balance.generation.G).toBe(1)
    expect(balance.producers).toBe(2)
  })

  it('counts a dual in both its colours, so generation sums to more than producers', () => {
    const balance = colorBalance(deckOf(['steam-vents', 'mountain']), CARDS)
    expect(balance.generation.U).toBe(1)
    expect(balance.generation.R).toBe(2)
    const summed = Object.values(balance.generation).reduce((a, b) => a + b, 0)
    expect(summed).toBe(3)
    expect(balance.producers).toBe(2)
    // The property the caption has to state: these two numbers differ, and a UI
    // implying the generation total is a card count would be lying.
    expect(summed).toBeGreaterThan(balance.producers)
  })

  it('separates "produces nothing" from "we do not know", and never guesses', () => {
    /*
     * `producedMana` is optional because a row written before migration 0008
     * has no answer, and `[]` would be the wrong one. A fetch and a pre-0008
     * row both draw no slices; only one of them means the card makes no mana.
     */
    const balance = colorBalance(deckOf(['ancient-tomb', 'scalding-tarn']), CARDS)
    expect(balance.unknownProduction).toBe(2) // Ancient Tomb and the commander
    expect(balance.producers).toBe(0)
    // The unknown rows are still real cards and still have an identity.
    expect(balance.cards).toBe(3)
  })

  it('counts the commanders, which are accepted by definition', () => {
    const balance = colorBalance(deckOf([], ['krenko', 'llanowar-elves']), CARDS)
    expect(balance.cards).toBe(2)
    expect(balance.identity.R).toBe(1)
    expect(balance.identity.G).toBe(1)
  })

  it('leaves a card the corpus does not have out of both totals', () => {
    // Not bucketed as colourless: `C` is an answer, and we have none. The
    // absence is `legality`'s `unknown-card` to report, not this function's.
    const balance = colorBalance(deckOf(['nothing-like-this']), CARDS)
    expect(balance.cards).toBe(1) // the commander alone
    expect(balance.identity.C).toBe(0)
  })

  it('returns every bucket at zero for an empty deck rather than an empty object', () => {
    // A pie needs to know a colour is absent, which is not the same as never
    // having been asked about.
    const balance = colorBalance(deckOf([], []), CARDS)
    expect(balance.identity).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, M: 0, C: 0 })
    expect(balance.generation).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 })
    expect(balance.cards).toBe(0)
    expect(balance.producers).toBe(0)
    expect(balance.unknownProduction).toBe(0)
  })
})
