import { describe, expect, it } from 'vitest'
import { oracleId } from './ids.js'
import {
  COMMANDER_WEIGHT,
  deckSynergy,
  deriveSynergy,
  synergyMatches,
  synergyScore,
  type SynergyProfile,
} from './synergy.js'

const card = (name: string, typeLine: string, oracleText: string) => ({
  oracleId: oracleId(name),
  typeLine,
  oracleText,
})

// Real oracle text, abbreviated only where the tail is irrelevant.
const BLOOD_ARTIST = card(
  'Blood Artist',
  'Creature — Vampire',
  'Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.',
)
const ASHNODS_ALTAR = card("Ashnod's Altar", 'Artifact', 'Sacrifice a creature: Add {C}{C}.')
const KRENKO = card(
  'Krenko, Mob Boss',
  'Legendary Creature — Goblin Warrior',
  '{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.',
)
const COUNTERSPELL = card('Counterspell', 'Instant', 'Counter target spell.')

describe('deriveSynergy', () => {
  it('reads a death trigger as WANTING creature deaths', () => {
    // The user's example: this is what a sacrifice outlet is for.
    expect(deriveSynergy(BLOOD_ARTIST).wants).toContain('creature-death')
  })

  it('reads a sacrifice outlet as PRODUCING creature deaths', () => {
    expect(deriveSynergy(ASHNODS_ALTAR).produces).toContain('creature-death')
  })

  it('reads a token maker as producing fodder', () => {
    const profile = deriveSynergy(KRENKO)

    expect(profile.produces).toContain('token')
    expect(profile.produces).toContain('sacrifice-fodder')
  })

  it('gives a card with no interactions an empty profile rather than a guess', () => {
    const profile = deriveSynergy(COUNTERSPELL)

    expect(profile.produces).toEqual([])
    expect(profile.wants).toEqual([])
  })

  it('lets a card both produce and want the same tag', () => {
    // A sac outlet that also triggers on death is an engine by itself, and
    // collapsing that would lose something true.
    const engine = card(
      'Engine',
      'Creature',
      'Sacrifice a creature: Draw a card. Whenever another creature dies, you gain 1 life.',
    )
    const profile = deriveSynergy(engine)

    expect(profile.produces).toContain('creature-death')
    expect(profile.wants).toContain('creature-death')
  })

  it('prefers a curated override over the heuristics', () => {
    const override: SynergyProfile = { produces: ['landfall'], wants: [] }
    const curated = new Map([[oracleId('Blood Artist'), override]])

    expect(deriveSynergy(BLOOD_ARTIST, { curated })).toEqual(override)
  })

  it('never returns a duplicate tag when several patterns hit', () => {
    const many = card('Many', 'Creature', 'Sacrifice a creature: Sacrifice another creature.')

    const produces = deriveSynergy(many).produces
    expect(new Set(produces).size).toBe(produces.length)
  })
})

describe('deckSynergy', () => {
  const profiles = new Map([
    [oracleId('Blood Artist'), deriveSynergy(BLOOD_ARTIST)],
    [oracleId("Ashnod's Altar"), deriveSynergy(ASHNODS_ALTAR)],
  ])
  const profileOf = (id: ReturnType<typeof oracleId>) => profiles.get(id)

  it('weights the commander far above an accepted card', () => {
    const asCommander = deckSynergy([oracleId('Blood Artist')], [], profileOf)
    const asMember = deckSynergy([], [oracleId('Blood Artist')], profileOf)

    // Asserting against COMMANDER_WEIGHT on both sides would be tautological —
    // it passes for any value including 1. The property is the RATIO.
    const commander = asCommander.wants.get('creature-death') ?? 0
    const member = asMember.wants.get('creature-death') ?? 0
    expect(member).toBe(1)
    expect(commander).toBeGreaterThanOrEqual(3)
    expect(commander / member).toBeGreaterThanOrEqual(3)
  })

  it('does not let a pile of accepted cards drown the commander', () => {
    // Three accepted cards pulling one way must not outweigh the commander,
    // or a 99-card deck stops being built around the card that defines it.
    const commanderWants = deckSynergy([oracleId('Blood Artist')], [], profileOf).wants.get(
      'creature-death',
    )

    expect(commanderWants).toBeGreaterThan(3)
  })

  it('does not double-count a commander that also appears in the accepted list', () => {
    const id = oracleId('Blood Artist')
    const deck = deckSynergy([id], [id], profileOf)

    expect(deck.wants.get('creature-death')).toBe(COMMANDER_WEIGHT)
  })

  it('ignores cards it has no profile for', () => {
    const deck = deckSynergy([oracleId('unknown')], [], profileOf)

    expect(deck.wants.size).toBe(0)
  })
})

describe('synergyMatches', () => {
  const bloodArtistCommander = deckSynergy([oracleId('Blood Artist')], [], () =>
    deriveSynergy(BLOOD_ARTIST),
  )

  it('matches a sacrifice outlet to a commander that wants deaths', () => {
    const matches = synergyMatches(deriveSynergy(ASHNODS_ALTAR), bloodArtistCommander)

    const death = matches.find((m) => m.tag === 'creature-death')
    expect(death).toBeDefined()
    expect(death?.direction).toBe('enables')
    expect(death?.weight).toBe(COMMANDER_WEIGHT)
  })

  it('matches in the other direction too — a payoff for what the deck already does', () => {
    // Deck already sacrifices; Blood Artist is the payoff for that.
    const sacDeck = deckSynergy([oracleId("Ashnod's Altar")], [], () =>
      deriveSynergy(ASHNODS_ALTAR),
    )

    const matches = synergyMatches(deriveSynergy(BLOOD_ARTIST), sacDeck)

    expect(matches.find((m) => m.tag === 'creature-death')?.direction).toBe('payoff')
  })

  it('finds nothing for an unrelated card', () => {
    expect(synergyMatches(deriveSynergy(COUNTERSPELL), bloodArtistCommander)).toEqual([])
  })

  it('puts the strongest match first, so the reason names the real one', () => {
    const deck = {
      produces: new Map([['token', 1] as const]),
      wants: new Map([['creature-death', 8] as const, ['landfall', 1] as const]),
    }
    const candidate: SynergyProfile = { produces: ['landfall', 'creature-death'], wants: [] }

    expect(synergyMatches(candidate, deck)[0]?.tag).toBe('creature-death')
  })
})

describe('synergyScore', () => {
  it('is zero with no matches', () => {
    expect(synergyScore([])).toBe(0)
  })

  it('stays within 0..1 however many tags match', () => {
    const many = Array.from({ length: 12 }, () => ({
      tag: 'token' as const,
      direction: 'enables' as const,
      weight: 9,
    }))

    expect(synergyScore(many)).toBeGreaterThan(0)
    expect(synergyScore(many)).toBeLessThanOrEqual(1)
  })

  it('saturates: doubling the matched weight does not double the score', () => {
    // The distinguishing property of saturation, and the one a linear score
    // fails. Ordering alone does not test this — linear preserves order too.
    const at = (weight: number): number =>
      synergyScore([{ tag: 'token', direction: 'enables', weight }])

    const firstHalf = at(8) - at(0)
    const secondHalf = at(16) - at(8)

    expect(secondHalf).toBeLessThan(firstHalf / 2)
  })

  it('never reaches 1, however much matches', () => {
    // A linear score clamped with Math.min would sit exactly at 1 here.
    expect(synergyScore([{ tag: 'token', direction: 'enables', weight: 10_000 }])).toBeLessThan(1)
  })
})
