import { describe, expect, it } from 'vitest'
import { oracleId } from './ids.js'
import type { OracleId } from './ids.js'
import {
  COMMANDER_WEIGHT,
  deckSynergy,
  deriveSynergy,
  interactsWith,
  SYNERGY_TAGS,
  synergyMatches,
  synergyScore,
  type DeckSynergy,
  type SynergyProfile,
  type SynergyTag,
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

describe('theme matches — looking at the rest of the deck', () => {
  const deck = (
    entries: readonly { produces?: SynergyTag[]; wants?: SynergyTag[] }[],
  ): DeckSynergy => {
    const ids = entries.map((_, i) => `o${String(i)}` as OracleId)
    const profiles = new Map(
      ids.map((id, i) => [
        id,
        { produces: entries[i]?.produces ?? [], wants: entries[i]?.wants ?? [] },
      ]),
    )
    return deckSynergy([], ids, (id) => profiles.get(id))
  }

  it('counts a want two other cards share, which the strict rule missed', () => {
    // Three cards all paying off +1/+1 counters and nothing producing them used
    // to report "no synergy" on every one of them. They are in the deck for the
    // same reason, which is a relationship even without an engine.
    const theDeck = deck([{ wants: ['plus1-counter'] }, { wants: ['plus1-counter'] }])
    const matches = synergyMatches({ produces: [], wants: ['plus1-counter'] }, theDeck)
    expect(matches).toHaveLength(1)
    expect(matches[0]?.direction).toBe('theme')
  })

  it('weights a theme far below a real enable', () => {
    // A theme without an engine wins no games, so it must never outrank the
    // card that actually provides what the deck wants.
    const theDeck = deck([{ wants: ['sacrifice-fodder'] }, { wants: ['sacrifice-fodder'] }])
    const themed = synergyMatches({ produces: [], wants: ['sacrifice-fodder'] }, theDeck)
    const enabling = synergyMatches({ produces: ['sacrifice-fodder'], wants: [] }, theDeck)
    expect(synergyScore(enabling)).toBeGreaterThan(synergyScore(themed) * 3)
  })

  it('does not let a card share a theme with itself', () => {
    // Every accepted card contributes its own wants to the deck profile, so a
    // card in the deck of one would otherwise always "share" with itself.
    const theDeck = deck([{ wants: ['plus1-counter'] }])
    const matches = synergyMatches({ produces: [], wants: ['plus1-counter'] }, theDeck, {
      selfCounted: true,
    })
    expect(matches).toEqual([])
  })

  it('still counts the theme for a card that is NOT in the deck yet', () => {
    // A recommendation candidate contributes nothing to the deck profile, so
    // subtracting a self-contribution there would undercount it.
    const theDeck = deck([{ wants: ['plus1-counter'] }])
    const matches = synergyMatches({ produces: [], wants: ['plus1-counter'] }, theDeck)
    expect(matches).toHaveLength(1)
    expect(matches[0]?.direction).toBe('theme')
  })

  it('prefers the stronger reading when a tag qualifies for both', () => {
    // A card that pays off the deck's engine should not ALSO be credited for
    // wanting what its neighbours want — that is the same fact counted twice.
    const theDeck = deck([{ produces: ['plus1-counter'] }, { wants: ['plus1-counter'] }])
    const matches = synergyMatches({ produces: [], wants: ['plus1-counter'] }, theDeck)
    expect(matches.map((m) => m.direction)).toEqual(['payoff'])
  })

  it('does not treat two cards doing the same thing as synergy', () => {
    // Two sacrifice outlets are redundancy. Counting a shared PRODUCE would
    // make every token deck claim every token maker synergises with every other.
    const theDeck = deck([{ produces: ['sacrifice-fodder'] }, { produces: ['sacrifice-fodder'] }])
    expect(synergyMatches({ produces: ['sacrifice-fodder'], wants: [] }, theDeck)).toEqual([])
  })
})

describe('interactsWith', () => {
  it('is symmetric for every tag', () => {
    // The table is written as unordered pairs precisely so this cannot drift;
    // this is the test that says so out loud.
    for (const tag of SYNERGY_TAGS) {
      for (const other of interactsWith(tag)) {
        expect(interactsWith(other), `${other} should list ${tag}`).toContain(tag)
      }
    }
  })

  it('never lists a tag as interacting with itself', () => {
    // Same-tag pairing is the produce/want relation and falls out of the model.
    // Repeating it here would be a second, weaker statement of it.
    for (const tag of SYNERGY_TAGS) {
      expect(interactsWith(tag)).not.toContain(tag)
    }
  })

  it('answers for every tag in the vocabulary, without throwing', () => {
    for (const tag of SYNERGY_TAGS) {
      expect(Array.isArray(interactsWith(tag))).toBe(true)
    }
  })

  it('knows the aristocrats loop', () => {
    // Bodies you do not mind losing, a way to lose them, the drain that pays.
    expect(interactsWith('token')).toContain('sacrifice-fodder')
    expect(interactsWith('creature-death')).toContain('lifeloss')
    expect(interactsWith('sacrifice-fodder')).toContain('creature-death')
  })

  it('knows what fills a graveyard', () => {
    expect(interactsWith('graveyard-creature')).toEqual(
      expect.arrayContaining(['creature-death', 'discard']),
    )
  })

  it('returns each partner once', () => {
    for (const tag of SYNERGY_TAGS) {
      const list = interactsWith(tag)
      expect(new Set(list).size, tag).toBe(list.length)
    }
  })
})
