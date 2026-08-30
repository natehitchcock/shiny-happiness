import { describe, expect, it } from 'vitest'
import { buildComboIndex } from './combo-index.js'
import { countComposition } from './composition-analysis.js'
import { curveTarget } from './curve.js'
import { lockedComposition, lockedCurve, suggestCuts, type CutInput } from './cut.js'
import { comboId, deckId, oracleId, printingId } from './ids.js'
import type { Card, CardType, Deck, DeckEntry } from './index.js'

const card = (name: string, opts: Partial<Card> = {}): Card => ({
  oracleId: oracleId(name),
  name,
  manaCost: '{1}{R}',
  manaValue: opts.manaValue ?? 2,
  colorIdentity: ['R'],
  colors: ['R'],
  typeLine: opts.typeLine ?? 'Creature — Goblin',
  types: (opts.types ?? ['creature']) as readonly CardType[],
  oracleText: '',
  keywords: [],
  legalities: { commander: 'legal' },
  edhrecRank: null,
  defaultPrinting: printingId(`${name}-p`),
  roles: opts.roles ?? ['ramp'],
  primaryRole: opts.primaryRole ?? 'ramp',
  universesBeyond: false,
  synergyProduces: opts.synergyProduces ?? [],
  synergyWants: opts.synergyWants ?? [],
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

const deck = (entries: DeckEntry[]): Deck => ({
  id: deckId('d'),
  name: 't',
  description: '',
  commanders: [oracleId('Cmdr')],
  targetBracket: 3,
  archetype: 'midrange',
  archetypeSecondary: null,
  colorIdentity: ['R'],
  entries,
  budget: null,
  excludeUniversesBeyond: false,
  status: 'active',
  version: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  lastOpenedAt: '2026-01-01T00:00:00Z',
})

const inputFor = (d: Deck, cards: Card[], extra: Partial<CutInput> = {}): CutInput => {
  const index = new Map(cards.map((c) => [c.oracleId, c]))
  // The commander counts toward composition (doc 02 §2.3), so it is given a
  // role the tests are not measuring — otherwise it silently skews every count.
  index.set(oracleId('Cmdr'), card('Cmdr', { roles: ['wincon'], primaryRole: 'wincon' }))
  return {
    deck: d,
    cards: index,
    counts: countComposition(d, index, (c) => c.primaryRole),
    // One ramp allowed; anything past that is over-supplied.
    targets: [{ dimension: { kind: 'role', role: 'ramp' }, min: 0, ideal: 1, max: 1 }],
    curveTarget: curveTarget('midrange'),
    comboIndex: buildComboIndex([]),
    deckSynergy: { produces: new Map(), wants: new Map() },
    ...extra,
  }
}

describe('suggestCuts', () => {
  it('never suggests cutting a locked card, however weak it looks', () => {
    // Locking is how the user says "this stays"; the whole point is to stop
    // being asked about cards that are already decided.
    const cards = [card('A'), card('B'), card('C')]
    const d = deck([entry('A', { locked: true }), entry('B'), entry('C')])

    const hints = suggestCuts(inputFor(d, cards))

    expect(hints.map((h) => h.oracleId)).not.toContain(oracleId('A'))
    expect(hints.length).toBeGreaterThan(0)
  })

  it('names an over-supplied role, measured against the range top not the ideal', () => {
    const cards = [card('A'), card('B'), card('C')]
    const d = deck([entry('A'), entry('B'), entry('C')])

    const hints = suggestCuts(inputFor(d, cards))

    const roleReason = hints[0]?.reasons.find((r) => r.kind === 'role-over-target')
    expect(roleReason).toBeDefined()
    // Three ramp against a max of one.
    expect(roleReason).toMatchObject({ over: 2 })
  })

  it('does not flag a role that is merely at its ideal', () => {
    const cards = [card('A')]
    const d = deck([entry('A')])

    const hints = suggestCuts(inputFor(d, cards))

    expect(hints[0]?.reasons.some((r) => r.kind === 'role-over-target')).toBe(false)
  })

  it('holds a combo piece back — its absence is what counts against a card', () => {
    const piece = card('Piece')
    const other = card('Other')
    const index = buildComboIndex([
      {
        id: comboId('c1'),
        pieces: [oracleId('Piece'), oracleId('Cmdr')],
        prerequisites: '',
        steps: [],
        produces: ['infinite-mana'],
        colorIdentity: ['R'],
      },
    ])
    const d = deck([entry('Piece'), entry('Other')])

    const hints = suggestCuts(inputFor(d, [piece, other], { comboIndex: index }))

    const pieceHint = hints.find((h) => h.oracleId === oracleId('Piece'))
    const otherHint = hints.find((h) => h.oracleId === oracleId('Other'))
    expect(pieceHint?.reasons.some((r) => r.kind === 'no-combos')).toBe(false)
    expect(otherHint?.reasons.some((r) => r.kind === 'no-combos')).toBe(true)
    // And it therefore ranks as less cuttable.
    expect(pieceHint?.score ?? 1).toBeLessThan(otherHint?.score ?? 0)
  })

  it('flags a card over the per-card budget', () => {
    const cards = [card('Pricey')]
    const d = deck([entry('Pricey')])

    const hints = suggestCuts(inputFor(d, cards, { priceOf: () => 40, maxCardUsd: 10 }))

    expect(hints[0]?.reasons).toContainEqual({ kind: 'over-budget', priceUsd: 40, limit: 10 })
  })

  it('says nothing about price when no limit is set', () => {
    const cards = [card('Pricey')]
    const d = deck([entry('Pricey')])

    const hints = suggestCuts(inputFor(d, cards, { priceOf: () => 4000 }))

    expect(hints[0]?.reasons.some((r) => r.kind === 'over-budget')).toBe(false)
  })

  it('gives every hint at least one reason', () => {
    const cards = [card('A'), card('B')]
    const d = deck([entry('A'), entry('B')])

    for (const hint of suggestCuts(inputFor(d, cards))) {
      expect(hint.reasons.length).toBeGreaterThan(0)
    }
  })

  it('ranks the weakest first', () => {
    const cards = [card('A'), card('B')]
    const d = deck([entry('A'), entry('B')])

    const hints = suggestCuts(
      inputFor(d, cards, { priceOf: (id) => (id === oracleId('A') ? 99 : 1), maxCardUsd: 5 }),
    )

    expect(hints[0]?.oracleId).toBe(oracleId('A'))
  })

  it('ignores excluded entries — they are already out of the deck', () => {
    const cards = [card('A')]
    const d = deck([entry('A', { zone: 'excluded' })])

    expect(suggestCuts(inputFor(d, cards))).toEqual([])
  })
})

describe('lockedCurve', () => {
  it('counts locked copies per bucket, duplicates included', () => {
    const mountain = card('M', { manaValue: 0, roles: ['land'], primaryRole: 'land' })
    const d = deck([entry('M', { locked: true }), entry('M', { locked: true }), entry('M')])

    const locked = lockedCurve(d, new Map([[oracleId('M'), mountain]]), 8)

    // Two of the three are locked, and they are not collapsed into one.
    expect(locked[0]).toBe(2)
  })

  it('counts nothing for an unlocked deck', () => {
    const c = card('A')
    const d = deck([entry('A')])

    expect(lockedCurve(d, new Map([[oracleId('A'), c]]), 8).every((n) => n === 0)).toBe(true)
  })
})

describe('lockedComposition', () => {
  it('counts locked cards per role', () => {
    const c = card('A', { primaryRole: 'ramp' })
    const d = deck([entry('A', { locked: true }), entry('A')])

    const locked = lockedComposition(d, new Map([[oracleId('A'), c]]), (x) => x.primaryRole)

    expect(locked.get('role:ramp')).toBe(1)
  })
})

describe('"no synergy" versus "we did not derive any tags"', () => {
  /** One unlocked card in a deck, with whatever synergy tags the test wants. */
  const cutFor = (tags: Pick<Card, 'synergyProduces' | 'synergyWants'>) => {
    const subject = card('Subject', tags)
    const d = deck([entry('Subject')])
    return suggestCuts(inputFor(d, [subject]))
  }

  it('says synergy is unknown for a card we derived no tags for', () => {
    // 16,684 of the 34,492 cards in the corpus derive no tags at all — the
    // regexes are heuristics over oracle text and miss roughly half of Magic.
    // Calling every one of those "no synergy" was the app asserting something
    // it had never checked, on about half the deck.
    const hints = cutFor({ synergyProduces: [], synergyWants: [] })
    const kinds = hints[0]?.reasons.map((r) => r.kind) ?? []
    expect(kinds).toContain('unknown-synergy')
    expect(kinds).not.toContain('no-synergy')
  })

  it('still says NO synergy when the card has tags and none of them land', () => {
    // The honest finding has to survive; the point was to make it findable, not
    // to stop making it.
    const hints = cutFor({ synergyProduces: ['landfall'], synergyWants: [] })
    const kinds = hints[0]?.reasons.map((r) => r.kind) ?? []
    expect(kinds).toContain('no-synergy')
    expect(kinds).not.toContain('unknown-synergy')
  })

  it('charges an unknown card less than one we can actually judge', () => {
    // The gap is in our ingest. Charging the card the full weight for it would
    // push out cards whose text our regexes simply do not read.
    const unknown = cutFor({ synergyProduces: [], synergyWants: [] })[0]?.score ?? 0
    const known = cutFor({ synergyProduces: ['landfall'], synergyWants: [] })[0]?.score ?? 0
    expect(unknown).toBeLessThan(known)
    expect(unknown).toBeGreaterThan(0)
  })
})

describe('lockedComposition counts by the same rule as the bar', () => {
  it('credits a locked card to its TYPE dimension, not only its role', () => {
    // The bug: it emitted `role:` keys only, so the `type:creature` meter could
    // never show gold however many creatures were locked. An overlay counted by
    // a different rule than the bar under it is not an overlay.
    const creature = card('Locked Creature', {
      types: ['creature'] as CardType[],
      primaryRole: 'wincon',
    })
    const d = deck([entry('Locked Creature', { locked: true })])
    const locked = lockedComposition(d, new Map([[creature.oracleId, creature]]))
    expect(locked.get('type:creature')).toBe(1)
    expect(locked.get('role:wincon')).toBe(1)
  })

  it('agrees with countComposition on the same cards', () => {
    // The guarantee that makes the overlay an overlay: lock everything, and the
    // gold must equal the bar on every dimension.
    const cards = [
      card('A', { types: ['creature'] as CardType[], primaryRole: 'wincon' }),
      card('B', { types: ['artifact'] as CardType[], primaryRole: 'ramp' }),
      card('C', { types: ['creature', 'artifact'] as CardType[], primaryRole: 'ramp' }),
    ]
    const d = deck(cards.map((c) => entry(c.name, { locked: true })))
    const byId = new Map(cards.map((c) => [c.oracleId, c]))
    const locked = lockedComposition(d, byId)
    const counts = countComposition(d, byId)
    for (const [key, count] of counts.byDimension) {
      expect(locked.get(key) ?? 0, key).toBe(count)
    }
  })

  it('never exceeds the bar when only some cards are locked', () => {
    const cards = [
      card('A', { types: ['creature'] as CardType[], primaryRole: 'wincon' }),
      card('B', { types: ['creature'] as CardType[], primaryRole: 'wincon' }),
    ]
    const d = deck([entry('A', { locked: true }), entry('B')])
    const byId = new Map(cards.map((c) => [c.oracleId, c]))
    const locked = lockedComposition(d, byId)
    const counts = countComposition(d, byId)
    for (const [key, count] of locked) {
      expect(count, key).toBeLessThanOrEqual(counts.byDimension.get(key) ?? 0)
    }
    expect(locked.get('type:creature')).toBe(1)
    expect(counts.byDimension.get('type:creature')).toBe(2)
  })

  it('does not count a commander as something the user locked', () => {
    // Gold means "you decided this". A commander is permanent, but it is not a
    // decision the lock button made.
    const cmd = card('The Commander', { types: ['creature'] as CardType[] })
    const d = {
      ...deck([entry('The Commander', { locked: true })]),
      commanders: [cmd.oracleId],
    }
    expect(lockedComposition(d, new Map([[cmd.oracleId, cmd]])).size).toBe(0)
  })
})
