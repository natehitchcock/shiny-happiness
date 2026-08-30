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
// Nothing at all: no rules text, and a type line that names no event. Counterspell
// is no longer this card — an instant PRODUCES `spell-cast` by being one.
const GRIZZLY_BEARS = card('Grizzly Bears', 'Creature — Bear', '')

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
    const profile = deriveSynergy(GRIZZLY_BEARS)

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

/**
 * ADR-0016 widened these rules against the loaded corpus. Each case here is real
 * oracle text from a card the rule newly reads, and — more importantly — each
 * rule that was tightened or rejected has a card that must NOT match, because
 * the whole argument of that ADR is that a wrong tag costs more than a gap.
 */
describe('deriveSynergy — the events the regexes used to miss', () => {
  it('reads an instant or sorcery as producing a spell cast', () => {
    // The event a prowess trigger waits for is "you cast an instant or sorcery",
    // and the type line answers that without reading a word of rules text.
    expect(deriveSynergy(COUNTERSPELL).produces).toContain('spell-cast')
  })

  it('does not let a creature produce a spell cast by talking about spells', () => {
    const mentor = card(
      'Monastery Mentor',
      'Creature — Human Monk',
      'Prowess\nWhenever you cast a noncreature spell, create a 1/1 white Monk creature token with prowess.',
    )
    const profile = deriveSynergy(mentor)

    expect(profile.wants).toContain('spell-cast')
    expect(profile.produces).not.toContain('spell-cast')
  })

  it('reads an enters-the-battlefield trigger as wanting creatures to enter', () => {
    const slime = card(
      'Acidic Slime',
      'Creature — Ooze',
      'Deathtouch\nWhen this creature enters, destroy target artifact, enchantment, or land.',
    )

    expect(deriveSynergy(slime).wants).toContain('creature-etb')
  })

  it('does not read "enters tapped" as an enters trigger', () => {
    // No trigger, nothing to blink for. The word "enters" alone is not an event.
    const wall = card('Wall of Wood', 'Creature — Wall', 'Defender\nThis creature enters tapped.')

    expect(deriveSynergy(wall).wants).not.toContain('creature-etb')
  })

  it('reads a flicker effect as producing an enter', () => {
    const blur = card(
      'Blur',
      'Instant',
      "Flash\nExile target creature you control, then return that card to the battlefield under its owner's control.\nDraw a card.",
    )

    expect(deriveSynergy(blur).produces).toContain('creature-etb')
  })

  it('reads an artifact as producing an artifact entering', () => {
    expect(deriveSynergy(card('Sol Ring', 'Artifact', '{T}: Add {C}{C}.')).produces).toContain(
      'artifact-etb',
    )
  })

  it('does not read destroying an artifact as making one enter', () => {
    // The type line is the only place this question can be answered; the word
    // "artifact" in the rules text is as often an artifact leaving.
    const shatter = card('Shatter', 'Instant', 'Destroy target artifact.')

    expect(deriveSynergy(shatter).produces).not.toContain('artifact-etb')
  })

  it('reads your own discard, and not an opponent’s', () => {
    // "Target opponent discards two cards" is a hand attack. It does not feed
    // madness and it does not fill your graveyard, which is all this tag pairs
    // with, so counting it was labelling 296 cards as something they are not.
    const looting = card(
      'Faithless Looting',
      'Sorcery',
      'Draw two cards, then discard two cards.\nFlashback {2}{R}',
    )
    const mindRot = card('Mind Rot', 'Sorcery', 'Target player discards two cards.')

    expect(deriveSynergy(looting).produces).toContain('discard')
    expect(deriveSynergy(mindRot).produces).not.toContain('discard')
  })

  it('reads self-mill, and not milling an opponent', () => {
    // Same reason: an opponent's graveyard is not the resource this tag means.
    const supplier = card(
      "Stitcher's Supplier",
      'Creature — Zombie',
      'When this creature enters or dies, mill three cards.',
    )
    const scour = card('Tome Scour', 'Sorcery', 'Target player mills five cards.')

    expect(deriveSynergy(supplier).produces).toContain('graveyard-creature')
    expect(deriveSynergy(scour).produces).not.toContain('graveyard-creature')
  })

  it('reads a fetch as producing landfall', () => {
    // The old pattern wanted the word "land" AFTER "put", so every ramp spell in
    // the corpus — the most common landfall enabler there is — read as nothing.
    const growth = card(
      'Rampant Growth',
      'Sorcery',
      'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
    )

    expect(deriveSynergy(growth).produces).toContain('landfall')
  })

  it('does not read a land that goes to hand as landfall', () => {
    const cycler = card(
      'Shefet Monitor',
      'Creature — Lizard',
      'Basic landcycling {2} ({2}, Discard this card: Search your library for a basic land card, reveal it, put it into your hand, then shuffle.)',
    )

    expect(deriveSynergy(cycler).produces).not.toContain('landfall')
  })

  it('reads an extra combat phase as producing attacks', () => {
    // Nothing produced this tag at all, so 1,848 cards wanted an event no card
    // in the corpus could supply.
    const assault = card(
      'Relentless Assault',
      'Sorcery',
      'Untap all creatures that attacked this turn. After this main phase, there is an additional combat phase.',
    )

    expect(deriveSynergy(assault).produces).toContain('attack-trigger')
  })

  it('does not read goad as producing attacks', () => {
    // Goad makes an OPPONENT's creature attack, which no "whenever a creature
    // you control attacks" trigger ever sees.
    const goad = card(
      'Sing to the Water',
      'Instant',
      'Goad target creature. (Until your next turn, that creature attacks a player other than you if able.)',
    )

    expect(deriveSynergy(goad).produces).not.toContain('attack-trigger')
  })

  it('reads a combat damage trigger as wanting to attack', () => {
    const rogue = card(
      'Thieving Sprite',
      'Creature — Faerie Rogue',
      'Flying\nWhenever this creature deals combat damage to a player, draw a card.',
    )

    expect(deriveSynergy(rogue).wants).toContain('attack-trigger')
  })

  it('reads damage to a player as life lost', () => {
    // Damage to a player IS that player losing life, and the payoff side of this
    // tag — "whenever a player loses life" — triggers on it.
    const chandra = card(
      'Chandra, Pyrogenius',
      'Legendary Planeswalker — Chandra',
      '+2: Chandra, Pyrogenius deals 2 damage to each opponent.',
    )

    expect(deriveSynergy(chandra).produces).toContain('lifeloss')
  })

  it('does not read damage to "any target" as life lost', () => {
    // It points at a creature as often as at a player.
    const bolt = card('Lightning Bolt', 'Instant', 'Lightning Bolt deals 3 damage to any target.')

    expect(deriveSynergy(bolt).produces).not.toContain('lifeloss')
  })

  it('reads a board wipe as producing deaths', () => {
    const wrath = card(
      'Wrath of God',
      'Sorcery',
      "Destroy all creatures. They can't be regenerated.",
    )

    expect(deriveSynergy(wrath).produces).toContain('creature-death')
  })

  it('does not read "destroy target nonland permanent" as producing deaths', () => {
    // Tried, measured at about 70%, dropped: it as often points at an
    // enchantment, and a confident wrong tag costs more than a gap.
    const rend = card(
      'Void Rend',
      'Instant',
      "This spell can't be countered.\nDestroy target nonland permanent.",
    )

    expect(deriveSynergy(rend).produces).not.toContain('creature-death')
  })

  it('reads a creature that arrives with counters', () => {
    // The templating never says "put", so the old pattern saw none of these.
    const swimmer = card(
      'Nimbus Swimmer',
      'Creature — Leviathan',
      'Flying\nThis creature enters with X +1/+1 counters on it.',
    )

    expect(deriveSynergy(swimmer).produces).toContain('plus1-counter')
  })

  it('counts life and cards it could not count before', () => {
    // "Four" and "equal to" were simply absent from the closed lists of numbers.
    const chastise = card(
      'Chastise',
      'Instant',
      'Destroy target attacking creature. You gain life equal to its power.',
    )
    const flare = card('Thoughtflare', 'Instant', 'Draw four cards, then discard two cards.')
    const strike = card(
      'Synchronized Strike',
      'Instant',
      'Untap up to two target creatures. They each get +2/+2 until end of turn.',
    )

    expect(deriveSynergy(chastise).produces).toContain('lifegain')
    expect(deriveSynergy(flare).produces).toContain('card-draw')
    expect(deriveSynergy(strike).produces).toContain('untap')
  })

  it('reads the graveyard as a resource, not only as a source of creatures', () => {
    // `delve` and `threshold` were already in this tag, so it never meant only
    // creatures. Flashback and "cards in your graveyard" belong with them.
    const ghoultree = card(
      'Ghoultree',
      'Creature — Zombie Treefolk',
      'This spell costs {1} less to cast for each creature card in your graveyard.',
    )
    const looting = card(
      'Faithless Looting',
      'Sorcery',
      'Draw two cards, then discard two cards.\nFlashback {2}{R}',
    )

    expect(deriveSynergy(ghoultree).wants).toContain('graveyard-creature')
    expect(deriveSynergy(looting).wants).toContain('graveyard-creature')
  })

  it('gives both new tags a place in the vocabulary and the interaction table', () => {
    // A tag nothing is paired with is invisible to the deck view, which is the
    // failure mode this whole exercise is about.
    expect(SYNERGY_TAGS).toContain('creature-etb')
    expect(SYNERGY_TAGS).toContain('spell-cast')
    expect(interactsWith('creature-etb')).toContain('token')
    expect(interactsWith('spell-cast')).toContain('card-draw')
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
