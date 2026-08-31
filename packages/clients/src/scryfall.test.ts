import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  isUniversesBeyondCard,
  tallyPrinting,
  type ProvenanceTally,
  parseTypes,
  toCard,
  toPrinting,
  delayFor,
  skipReason,
  type ScryfallCard,
} from './scryfall.js'

/**
 * Contract tests against a RECORDED fixture, never the live API (AGENTS.md §4).
 *
 * The fixture is a hand-picked sample containing the shapes that break naive
 * mappers: split cards, MDFCs, adventures, meld backs, accented names, a banned
 * card, a basic land and the singleton exceptions.
 */
const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'scryfall-oracle-sample.jsonl',
)

const cards: ScryfallCard[] = readFileSync(FIXTURE, 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line) => JSON.parse(line) as ScryfallCard)

const byName = (name: string): ScryfallCard => {
  const found = cards.find((c) => c.name === name)
  if (found === undefined) throw new Error(`fixture missing ${name}`)
  return found
}

describe('parseTypes', () => {
  it('reads types from the front of the type line only', () => {
    // "Druid" is a subtype and must not produce a type.
    expect(parseTypes('Legendary Creature — Elf Druid')).toEqual(['creature'])
  })

  it('handles a multi-type line', () => {
    expect([...parseTypes('Artifact Creature — Golem')].sort()).toEqual(['artifact', 'creature'])
  })

  it('does not invent a type from a subtype that shares a word', () => {
    // "Enchantment Creature — Enchantment Whale" style lines; the subtype half
    // is discarded entirely.
    expect(parseTypes('Land — Forest')).toEqual(['land'])
  })

  it('returns nothing for a type line it does not recognise', () => {
    expect(parseTypes('Vanguard')).toEqual([])
    expect(parseTypes('Stickers')).toEqual([])
    expect(parseTypes('Conspiracy')).toEqual([])
    expect(parseTypes('Card')).toEqual([])
  })

  it('reads the pre-6th-edition "Summon" wording as a creature', () => {
    // "Summon Dragon" and friends are still legal in Commander.
    expect(parseTypes('Summon Dragon')).toEqual(['creature'])
    expect(parseTypes('Summon Legend')).toEqual(['creature'])
  })
})

describe('toCard', () => {
  it('maps an ordinary card', () => {
    const card = toCard(byName('Sol Ring'))

    expect(card).not.toBeNull()
    expect(card?.name).toBe('Sol Ring')
    expect(card?.manaValue).toBe(1)
    expect(card?.types).toEqual(['artifact'])
    expect(card?.colorIdentity).toEqual([])
    expect(card?.legalities.commander).toBe('legal')
  })

  it('renames cmc to manaValue, as the domain names it (AGENTS.md §7)', () => {
    const raw = byName('Counterspell')
    const card = toCard(raw)

    expect(card?.manaValue).toBe(raw.cmc)
  })

  it('carries the banned verdict rather than defaulting it to legal', () => {
    const card = toCard(byName('Black Lotus'))

    expect(card?.legalities.commander).toBe('banned')
  })

  it('treats an unrecognised legality as not legal, never as legal', () => {
    const card = toCard({ ...byName('Sol Ring'), legalities: { commander: 'sideways' } })

    expect(card?.legalities.commander).toBe('not_legal')
  })

  it('treats a missing legality as not legal', () => {
    const raw = { ...byName('Sol Ring') }
    delete (raw as { legalities?: unknown }).legalities
    expect(toCard(raw)?.legalities.commander).toBe('not_legal')
  })

  it('keeps both halves of a split card searchable', () => {
    const card = toCard(byName('Fire // Ice'))

    expect(card?.name).toBe('Fire // Ice')
    // Text lives on the faces; joining them keeps the role heuristics working.
    expect(card?.oracleText.length).toBeGreaterThan(0)
  })

  it('keeps the face boundary of a split card, which the join destroys', () => {
    // Fire // Ice is the case that proves it cannot be recovered afterwards:
    // Fire has one ability, Ice has two, and the join separates all three with
    // the same newline. Splitting `oracleText` would rule a line in the wrong
    // place; only the faces know where the boundary is.
    const card = toCard(byName('Fire // Ice'))

    expect(card?.oracleTextFaces).toHaveLength(2)
    expect(card?.oracleTextFaces?.[0]).toMatch(/^Fire deals/)
    expect(card?.oracleTextFaces?.[1]).toContain('\n')
    // The invariant every consumer relies on: the faces reproduce the joined
    // text exactly, so nothing derived from `oracleText` sees anything new.
    expect(card?.oracleTextFaces?.join('\n')).toBe(card?.oracleText)
    // And the joined text is still three newline-separated chunks, unmarked —
    // no sentinel was smuggled into the field the synergy regexes read.
    expect(card?.oracleText.split('\n')).toHaveLength(3)
    expect(card?.oracleText).not.toContain('//')
  })

  it('leaves a single-faced card with no faces at all', () => {
    // Not `[]`. "One face" and "not known" are both nothing to say, and an
    // empty array would instead claim the card has zero faces.
    expect(toCard(byName('Sol Ring'))?.oracleTextFaces).toBeUndefined()
  })

  it('keeps the faces of an adventure, which are halves of one physical card', () => {
    const raw = cards.find((c) => c.name.startsWith('Bonecrusher Giant'))!
    expect(toCard(raw)?.oracleTextFaces).toHaveLength(2)
  })

  it('maps a transforming double-faced card', () => {
    const card = toCard(cards.find((c) => c.layout === 'transform')!)

    expect(card).not.toBeNull()
    expect(card?.types).toContain('creature')
  })

  it('maps an adventure card, whose oracle name carries both halves', () => {
    const raw = cards.find((c) => c.name.startsWith('Bonecrusher Giant'))
    expect(raw).toBeDefined()

    const card = toCard(raw!)
    expect(card?.types).toContain('creature')
  })

  it('preserves an accented name exactly', () => {
    const raw = cards.find((c) => c.name.includes('Nazg'))!
    const card = toCard(raw)

    expect(card?.name).toBe(raw.name)
    expect(card?.name).toMatch(/û/)
  })

  it('derives a role for every fixture card, never an empty set', () => {
    for (const raw of cards) {
      const card = toCard(raw)
      if (card === null) continue
      // primaryRole falls back to `synergy`; an empty role list would break
      // composition counting silently.
      expect(card.roles.length).toBeGreaterThan(0)
      expect(card.primaryRole).toBeTruthy()
    }
  })

  it('classifies a basic land as a land', () => {
    const card = toCard(byName('Mountain'))

    expect(card?.types).toEqual(['land'])
    expect(card?.primaryRole).toBe('land')
  })

  it('returns null for a record with no oracle_id rather than inventing one', () => {
    const raw = { ...byName('Sol Ring') }
    delete (raw as { oracle_id?: string }).oracle_id

    expect(toCard(raw)).toBeNull()
    expect(skipReason(raw)).toBe('no-oracle-id')
  })

  it('rejects art-series records, which carry an oracle_id but are not cards', () => {
    // These are in the real oracle export. Their type line is "Card", so they
    // map to a card with no types that pollutes search and role counting.
    const artSeries = cards.find((c) => c.layout === 'art_series')
    expect(artSeries).toBeDefined()

    expect(skipReason(artSeries!)).toBe('non-playable-layout')
    expect(toCard(artSeries!)).toBeNull()
    expect(toPrinting(artSeries!)).toBeNull()
  })

  it('rejects a card type that cannot be in a deck, even when Scryfall calls it legal', () => {
    // Scryfall marks Unfinity sticker sheets `legal` in Commander, so a filter
    // on legality alone lets them into the candidate pool.
    const sticker = {
      ...byName('Sol Ring'),
      name: 'Ancestral Hot Dog Minotaur',
      type_line: 'Stickers',
      legalities: { commander: 'legal' },
    }

    expect(skipReason(sticker)).toBe('no-card-type')
    expect(toCard(sticker)).toBeNull()
  })

  it('every card it does map has at least one type', () => {
    for (const raw of cards) {
      const card = toCard(raw)
      if (card === null) continue
      expect(card.types.length).toBeGreaterThan(0)
    }
  })
})

describe('toPrinting', () => {
  it('maps set, rarity and a price estimate', () => {
    const printing = toPrinting(byName('Sol Ring'))

    expect(printing?.setCode.length).toBeGreaterThan(0)
    expect(printing?.rarity).toBeTruthy()
    expect(printing?.priceUsd === null || typeof printing?.priceUsd === 'number').toBe(true)
  })

  it('leaves the price null rather than zero when Scryfall has none', () => {
    const printing = toPrinting({ ...byName('Sol Ring'), prices: { usd: null } })

    // Zero would read as "free" everywhere a budget filter looks.
    expect(printing?.priceUsd).toBeNull()
  })

  it('reports the reserved list flag', () => {
    const printing = toPrinting(byName('Black Lotus'))

    expect(typeof printing?.reserved).toBe('boolean')
  })
})

describe('rate limits (ADR-0009 Q1)', () => {
  it('throttles search four times harder than ordinary endpoints', () => {
    expect(delayFor('/cards/search')).toBe(500)
    expect(delayFor('/cards/collection')).toBe(500)
  })

  it('uses 100 ms for everything else', () => {
    expect(delayFor('/cards/some-other-thing')).toBe(100)
  })

  it('backs off hardest on the manifest endpoint', () => {
    expect(delayFor('/cards/manifest')).toBe(6_000)
  })
})

describe('Universes Beyond provenance (ADR-0011)', () => {
  const tally = (printings: { oracle_id?: string; promo_types?: string[] }[]) => {
    const into = new Map<string, ProvenanceTally>()
    for (const p of printings) tallyPrinting(into, { id: 'x', name: 'n', ...p })
    return into
  }

  it('marks a card whose every printing is Universes Beyond', () => {
    const t = tally([
      { oracle_id: 'a', promo_types: ['universesbeyond'] },
      { oracle_id: 'a', promo_types: ['universesbeyond', 'boosterfun'] },
    ])

    expect(isUniversesBeyondCard(t.get('a'))).toBe(true)
  })

  it('does NOT mark a card with even one ordinary printing', () => {
    // This is the Sol Ring case. Scryfall's oracle export picked a Marvel
    // Commander printing for it, so trusting a single printing would have
    // dropped Sol Ring out of every deck.
    const t = tally([
      { oracle_id: 'sol', promo_types: ['surgefoil', 'universesbeyond'] },
      { oracle_id: 'sol', promo_types: [] },
    ])

    expect(isUniversesBeyondCard(t.get('sol'))).toBe(false)
  })

  it('does not mark a card with no printings at all', () => {
    // An empty tally must not read as "all of its printings are UB".
    expect(isUniversesBeyondCard(undefined)).toBe(false)
    expect(isUniversesBeyondCard({ total: 0, universesBeyond: 0 })).toBe(false)
  })

  it('ignores printings with no oracle id', () => {
    const t = tally([{ promo_types: ['universesbeyond'] }])

    expect(t.size).toBe(0)
  })

  it('defaults a mapped card to not-Universes-Beyond when provenance is unknown', () => {
    // Safe direction: an unknown card stays visible rather than vanishing.
    expect(toCard(byName('Sol Ring'))?.universesBeyond).toBe(false)
  })

  it('carries provenance the caller computed', () => {
    expect(toCard(byName('Sol Ring'), { universesBeyond: true })?.universesBeyond).toBe(true)
  })
})

describe('the Game Changers flag (DATA-05)', () => {
  /*
   * Both fixtures are real Scryfall records, and both are on Wizards' list as of
   * 2026-08-30. The list is not written down anywhere in this repository — it is
   * read from `game_changer` on the records we already download — so these
   * assertions are about the mapping, never about which cards belong.
   */
  it('maps a card Scryfall flags as a Game Changer', () => {
    expect(toCard(byName('Rhystic Study'))?.gameChanger).toBe(true)
  })

  it('maps a multi-faced Game Changer', () => {
    // Wizards lists "Tergrid, God of Fright"; Scryfall names the record with
    // both faces. Nothing has to reconcile the two spellings because the flag
    // travels with the record rather than being matched by name — which is the
    // whole reason this comes from the corpus and not a checked-in array.
    expect(toCard(byName("Tergrid, God of Fright // Tergrid's Lantern"))?.gameChanger).toBe(true)
  })

  it('leaves an ordinary card unflagged', () => {
    expect(toCard(byName('Sol Ring'))?.gameChanger).toBe(false)
    expect(toCard(byName('Cultivate'))?.gameChanger).toBe(false)
  })

  it('does not read a banned card as a Game Changer', () => {
    // Black Lotus is banned, not listed. Conflating the two would flag a card
    // the deck cannot legally hold and miss the flag on one it can.
    expect(toCard(byName('Black Lotus'))?.gameChanger).toBe(false)
  })

  it('reads a record with no game_changer field as unflagged', () => {
    // An older mirror predating the field. `false` is the safe direction: it
    // under-reports rather than accusing a deck of holding a Game Changer.
    const { game_changer: flag, ...withoutField } = byName('Rhystic Study')
    // Guards the test itself: if the fixture ever stops carrying the field, the
    // assertion below would pass for the wrong reason.
    expect(flag).toBe(true)
    expect(toCard(withoutField)?.gameChanger).toBe(false)
  })
})
