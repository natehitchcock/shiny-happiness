import { describe, expect, it } from 'vitest'
import type { Card } from './card.js'
import { oracleId } from './ids.js'
import type { OracleId } from './ids.js'
import {
  COMMANDER_WEIGHT,
  deckSynergy,
  deriveSynergy,
  interactsWith,
  EVENT_TAGS,
  SYNERGY_TAGS,
  synergyMatches,
  synergyScore,
  type DeckSynergy,
  type SynergyProfile,
  type SynergyTag,
} from './synergy.js'

const card = (
  name: string,
  typeLine: string,
  oracleText: string,
  keywords: readonly string[] = [],
) => ({
  oracleId: oracleId(name),
  // The name and the keywords are what the derived families read (ADR-0046).
  // Both are required rather than optional, because a missing name silently
  // turns off the refusal that keeps a card from wanting its own tribe.
  name,
  typeLine,
  oracleText,
  keywords,
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

  it('reads damage to a player as damage, not as life lost', () => {
    // This test used to assert `lifeloss`, on the true premise that damage to a
    // player makes that player lose life. ADR-0023 separates the two events:
    // the premise holds for the payoff side only, and as a producer tag it told
    // a burn deck it was a drain deck.
    const chandra = card(
      'Chandra, Pyrogenius',
      'Legendary Planeswalker — Chandra',
      '+2: Chandra, Pyrogenius deals 2 damage to each opponent.',
    )

    expect(deriveSynergy(chandra).produces).toContain('player-damage')
    expect(deriveSynergy(chandra).produces).not.toContain('lifeloss')
  })

  it('reads damage to "any target" as damage to a player', () => {
    // Also reversed by ADR-0023. Excluding "any target" was right for
    // `lifeloss` — a Bolt pointed at a creature takes nobody's life total with
    // it — and wrong for a damage tag, which asks whether the card can be
    // pointed at a face. Lightning Bolt matched no rule at all before.
    const bolt = card('Lightning Bolt', 'Instant', 'Lightning Bolt deals 3 damage to any target.')

    expect(deriveSynergy(bolt).produces).toContain('player-damage')
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

  describe('the third direction (ADR-0048)', () => {
    // A deck that wants fliers — Favorable Winds and nothing else.
    const wantsFliers: DeckSynergy = {
      produces: new Map(),
      wants: new Map([['ability:flying', 4] as const]),
      has: new Map(),
    }
    // A deck full of fliers and no payoff.
    const fullOfFliers: DeckSynergy = {
      produces: new Map(),
      wants: new Map(),
      has: new Map([['ability:flying', 6] as const]),
    }

    it('lets a card SUPPLY a tag by having it, not only by causing it', () => {
      // The whole point. A flier does not cause flying, so under two directions
      // it could satisfy Favorable Winds only by lying about what it does.
      const flier: SynergyProfile = { produces: [], wants: [], has: ['ability:flying'] }
      const matches = synergyMatches(flier, wantsFliers)

      expect(matches).toHaveLength(1)
      expect(matches[0]?.direction).toBe('enables')
      expect(matches[0]?.weight).toBe(4)
    })

    it('pays off a deck that HAS the tag, as well as one that produces it', () => {
      const payoff: SynergyProfile = { produces: [], wants: ['ability:flying'], has: [] }
      const matches = synergyMatches(payoff, fullOfFliers)

      expect(matches[0]?.direction).toBe('payoff')
      expect(matches[0]?.weight).toBe(6)
    })

    it('adds the two ways a deck supplies a tag rather than picking one', () => {
      // A deck with six fliers and a card that grants flying supplies both, and
      // the payoff is worth more there than in a deck with only one of them.
      const deck: DeckSynergy = {
        produces: new Map([['ability:flying', 2] as const]),
        wants: new Map(),
        has: new Map([['ability:flying', 6] as const]),
      }
      const payoff: SynergyProfile = { produces: [], wants: ['ability:flying'], has: [] }

      expect(synergyMatches(payoff, deck)[0]?.weight).toBe(8)
    })

    it('does NOT score two cards that merely have the same thing', () => {
      // Two Elves are redundancy, not synergy — the ruling `produces` already
      // carries. What makes a tribe a deck is the card that WANTS the tribe.
      const elf: SynergyProfile = { produces: [], wants: [], has: ['subtype:elf'] }
      const deckOfElves: DeckSynergy = {
        produces: new Map(),
        wants: new Map(),
        has: new Map([['subtype:elf', 9] as const]),
      }

      expect(synergyMatches(elf, deckOfElves)).toEqual([])
    })

    it('does NOT score having a tag against a deck that makes it', () => {
      // An Elf and an Elf-token maker are two copies of the same effect.
      const elf: SynergyProfile = { produces: [], wants: [], has: ['subtype:elf'] }
      const deckMakesElves: DeckSynergy = {
        produces: new Map([['subtype:elf', 5] as const]),
        wants: new Map(),
        has: new Map(),
      }

      expect(synergyMatches(elf, deckMakesElves)).toEqual([])
    })

    it('credits a card once when it both has and causes the same tag', () => {
      // A Bird that also grants flying supplies the tag twice over and is still
      // one card doing one thing for the deck.
      const both: SynergyProfile = {
        produces: ['ability:flying'],
        wants: [],
        has: ['ability:flying'],
      }

      expect(synergyMatches(both, wantsFliers)).toHaveLength(1)
    })

    it('treats a profile with no `has` as a card that has not been asked', () => {
      // Absent is not `[]` with a different spelling — but it must not throw and
      // must not invent a match. A card read before the field existed simply
      // supplies nothing through this direction.
      const old = { produces: [], wants: [] } as SynergyProfile

      expect(synergyMatches(old, wantsFliers)).toEqual([])
    })
  })

  it('puts the strongest match first, so the reason names the real one', () => {
    const deck = {
      produces: new Map([['token', 1] as const]),
      wants: new Map([['creature-death', 8] as const, ['landfall', 1] as const]),
      has: new Map(),
    }
    const candidate: SynergyProfile = { produces: ['landfall', 'creature-death'], wants: [] }

    expect(synergyMatches(candidate, deck)[0]?.tag).toBe('creature-death')
  })
})

/*
 * ADR-0057. The want says WHICH EVENT; the qualifier says which cards can cause
 * it. Y'shtola is the case the ADR was written from and the acceptance test the
 * product owner set.
 */
describe('synergyMatches — a qualified want (ADR-0057)', () => {
  const YSHTOLA = card(
    "Y'shtola, Night's Blessed",
    'Legendary Creature — Cat Warlock',
    'Vigilance\n' +
      'At the beginning of each end step, if a player lost 4 or more life this turn, you draw a card.\n' +
      'Whenever you cast a noncreature spell with mana value 3 or greater, ' +
      "Y'shtola deals 2 damage to each opponent and you gain 2 life.",
  )
  const deck = deckSynergy([oracleId("Y'shtola, Night's Blessed")], [], () =>
    deriveSynergy(YSHTOLA),
  )
  const supplier: SynergyProfile = { produces: ['spell-cast'], wants: [] }
  const facts = (manaValue: number, types: Card['types']) => ({
    manaValue,
    types,
    colors: [] as Card['colors'],
  })

  it('still records the want, because the tag is wanted', () => {
    expect(deck.wants.get('spell-cast')).toBe(COMMANDER_WEIGHT)
  })

  it("drops Counterspell, which does not cost enough to fire her", () => {
    const matches = synergyMatches(supplier, deck, { candidate: facts(2, ['instant']) })

    expect(matches.find((m) => m.tag === 'spell-cast')).toBeUndefined()
  })

  it('keeps a three-mana noncreature spell, at the full weight', () => {
    const matches = synergyMatches(supplier, deck, { candidate: facts(3, ['sorcery']) })
    const match = matches.find((m) => m.tag === 'spell-cast')

    expect(match?.direction).toBe('enables')
    expect(match?.weight).toBe(COMMANDER_WEIGHT)
  })

  it('drops a five-mana creature, which clears the floor and fails the type', () => {
    expect(
      synergyMatches(supplier, deck, { candidate: facts(5, ['creature']) }).find(
        (m) => m.tag === 'spell-cast',
      ),
    ).toBeUndefined()
  })

  /*
   * EXCLUDE, NOT REDUCE. A trigger has no partial state -- Counterspell does not
   * half-fire Y'shtola -- which is the opposite ruling ADR-0058 makes for roles,
   * where Disenchant really is removal.
   */
  it('excludes rather than reducing', () => {
    const matches = synergyMatches(supplier, deck, { candidate: facts(1, ['instant']) })

    expect(matches).toEqual([])
  })

  /*
   * A deck's want is the SUM of its wanters, and only the qualified ones can be
   * subtracted. An unqualified spellslinger beside her still pays a cheap spell.
   */
  it('subtracts only the wanters the candidate fails', () => {
    const GUTTERSNIPE = card(
      'Guttersnipe',
      'Creature — Goblin Shaman',
      'Whenever you cast an instant or sorcery spell, this creature deals 2 damage to each opponent.',
    )
    const profiles = new Map<OracleId, SynergyProfile>([
      [oracleId("Y'shtola, Night's Blessed"), deriveSynergy(YSHTOLA)],
      [oracleId('Guttersnipe'), deriveSynergy(GUTTERSNIPE)],
    ])
    const both = deckSynergy(
      [oracleId("Y'shtola, Night's Blessed")],
      [oracleId('Guttersnipe')],
      (id) => profiles.get(id),
    )
    expect(both.wants.get('spell-cast')).toBe(COMMANDER_WEIGHT + 1)

    // A one-mana instant fails her floor and satisfies Guttersnipe's type test.
    const cheap = synergyMatches(supplier, both, { candidate: facts(1, ['instant']) })
    expect(cheap.find((m) => m.tag === 'spell-cast')?.weight).toBe(1)

    // A four-mana instant satisfies both.
    const dear = synergyMatches(supplier, both, { candidate: facts(4, ['instant']) })
    expect(dear.find((m) => m.tag === 'spell-cast')?.weight).toBe(COMMANDER_WEIGHT + 1)
  })

  /*
   * The fallback is stated out loud because it is the dangerous half: a caller
   * that does not hand over the candidate's own columns gets the UNQUALIFIED
   * answer, which is over-inclusive. Absence means "did not ask", never "this
   * candidate satisfies the qualifier".
   */
  it('answers unqualified when the caller supplies no candidate columns', () => {
    expect(synergyMatches(supplier, deck).find((m) => m.tag === 'spell-cast')?.weight).toBe(
      COMMANDER_WEIGHT,
    )
  })

  it('leaves every unqualified tag alone', () => {
    const sacDeck = deckSynergy([oracleId('Blood Artist')], [], () => deriveSynergy(BLOOD_ARTIST))
    const matches = synergyMatches(deriveSynergy(ASHNODS_ALTAR), sacDeck, {
      candidate: facts(1, ['artifact']),
    })

    expect(matches.find((m) => m.tag === 'creature-death')?.weight).toBe(COMMANDER_WEIGHT)
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

describe('enchantment-etb', () => {
  const derive = (typeLine: string, oracleText: string): SynergyProfile =>
    deriveSynergy({
      oracleId: oracleId('00000000-0000-4000-8000-000000000001'),
      name: 'Test Card',
      typeLine,
      oracleText,
      keywords: [],
    })

  it('reads any enchantment as putting one onto the battlefield', () => {
    // Definitional, and read off the TYPE LINE rather than the rules text —
    // exactly how `artifact-etb` treats artifacts. An Aura with no relevant
    // text is still an enchantment entering, which is the whole of what a
    // constellation trigger asks for.
    expect(
      derive('Enchantment — Aura', 'Enchant creature. Enchanted creature gets +2/+0.').produces,
    ).toContain('enchantment-etb')
    expect(derive('Enchantment', 'Players cannot untap more than one land.').produces).toContain(
      'enchantment-etb',
    )
  })

  it('pays off for an enchantress', () => {
    expect(
      derive(
        'Legendary Creature — Nymph',
        'Whenever you cast an enchantment spell, you draw a card.',
      ).wants,
    ).toContain('enchantment-etb')
  })

  it('pays off for constellation', () => {
    expect(
      derive(
        'Creature — Giant',
        'Constellation — Whenever an enchantment enters, each opponent loses 1 life.',
      ).wants,
    ).toContain('enchantment-etb')
  })

  it('does not tag a creature that merely mentions an enchantment', () => {
    // The false-positive guard. Enchantment REMOVAL is not an enchantment
    // payoff — it is the opposite, and would pair a hate card with the deck it
    // hates.
    expect(
      derive('Creature — Bird', 'When this creature enters, destroy target enchantment.').wants,
    ).not.toContain('enchantment-etb')
  })

  it('does not read a Saga or an Aura as WANTING enchantments', () => {
    // Being one is the produce side. Only a payoff wants them.
    const rancor = derive('Enchantment — Aura', 'Enchant creature. Enchanted creature gets +2/+0.')
    expect(rancor.wants).not.toContain('enchantment-etb')
  })

  it('leaves a vanilla creature alone', () => {
    // `has` carries `subtype:bear` since ADR-0046 — the card IS a Bear, which is
    // true and is a different claim from causing or wanting anything. The two
    // EVENT directions are what this test is about and they stay empty.
    const profile = derive('Creature — Bear', '')

    expect(profile.produces).toEqual([])
    expect(profile.wants).toEqual([])
  })
})

describe('a creature that pays off its own death', () => {
  const derive = (typeLine: string, oracleText: string): SynergyProfile =>
    deriveSynergy({
      oracleId: oracleId('00000000-0000-4000-8000-000000000002'),
      name: 'Test Card',
      typeLine,
      oracleText,
      keywords: [],
    })

  it('reads the one-shot "When this creature dies" form', () => {
    // Magic writes "Whenever" for a repeatable trigger and "When" for a
    // one-shot. The rules matched every death ENGINE and missed every creature
    // that cashes in its own death — which is the other half of aristocrats.
    expect(
      derive('Creature — Goblin', 'When this creature dies, it deals 2 damage to any target.')
        .wants,
    ).toContain('creature-death')
  })

  it('reads the same trigger written with the card name', () => {
    expect(
      derive(
        'Creature — Human',
        'When Bucky Barnes dies, look at the top four cards of your library.',
      ).wants,
    ).toContain('creature-death')
  })

  it('does not fire across a sentence boundary', () => {
    // The window is bounded by a full stop on purpose: without it, any card
    // mentioning "when" anywhere and "dies" much later would pair up.
    expect(
      derive(
        'Creature — Wizard',
        'When this creature enters, draw a card. Target creature an opponent controls dies at end of turn.',
      ).wants,
    ).not.toContain('creature-death')
  })

  it('still leaves a vanilla creature alone', () => {
    const profile = derive('Creature — Bear', '')

    expect(profile.produces).toEqual([])
    expect(profile.wants).toEqual([])
  })
})

describe('plus1-counter direction', () => {
  const derive = (typeLine: string, oracleText: string): SynergyProfile =>
    deriveSynergy({
      oracleId: oracleId('00000000-0000-4000-8000-000000000003'),
      name: 'Test Card',
      typeLine,
      oracleText,
      keywords: [],
    })

  it('does not call a counter-MAKER a counter payoff', () => {
    // The inversion. "Whenever this attacks, put a +1/+1 counter on it" is the
    // producer's phrasing, and matching it as a want made the app pair two
    // counter-makers and announce one as the other's payoff — 429 cards of it.
    const maker = derive(
      'Creature — Beast',
      'Whenever this creature attacks, put a +1/+1 counter on it.',
    )
    expect(maker.produces).toContain('plus1-counter')
    expect(maker.wants).not.toContain('plus1-counter')
  })

  it('does not read "enters with a +1/+1 counter" as wanting them', () => {
    const enters = derive(
      'Creature — Construct',
      'This creature enters with a +1/+1 counter on it.',
    )
    expect(enters.produces).toContain('plus1-counter')
    expect(enters.wants).not.toContain('plus1-counter')
  })

  it('reads proliferate as wanting them', () => {
    expect(derive('Instant', 'Proliferate.').wants).toContain('plus1-counter')
  })

  it('reads spending a counter as wanting them', () => {
    expect(
      derive('Creature — Human', 'Remove a +1/+1 counter from this creature: Draw a card.').wants,
    ).toContain('plus1-counter')
  })

  it('reads a counter as a CONDITION as wanting them', () => {
    expect(
      derive('Instant', 'Target creature with a +1/+1 counter on it gains flying.').wants,
    ).toContain('plus1-counter')
  })
})

/**
 * ADR-0022. Every card below is real Scryfall oracle text.
 *
 * The tags exist because the model had no subject: "you discard a card" and
 * "each opponent discards a card" were one tag, so the entire opponent-discard
 * archetype — 481 producers against the 43 self-discard cards the tag was tuned
 * for — was either untagged or tagged as its own opposite. Half the cases here
 * are therefore MUST-NOT assertions: the split is only worth anything if the
 * two sides stay apart.
 */
describe('deriveSynergy — whose event it is', () => {
  const derive = (
    name: string,
    typeLine: string,
    oracleText: string,
    faces?: readonly string[],
  ): SynergyProfile =>
    deriveSynergy({
      oracleId: oracleId(name),
      name,
      typeLine,
      oracleText,
      keywords: [],
      ...(faces === undefined ? {} : { oracleTextFaces: faces }),
    })

  // The card the bug was reported on.
  const HOPELESS_NIGHTMARE = derive(
    'Hopeless Nightmare',
    'Enchantment',
    'When this enchantment enters, each opponent discards a card and loses 2 life.\nWhen this enchantment is put into a graveyard from the battlefield, scry 1.',
  )
  const MIND_ROT = derive('Mind Rot', 'Sorcery', 'Target player discards two cards.')
  const THOUGHTSEIZE = derive(
    'Thoughtseize',
    'Sorcery',
    'Target player reveals their hand. You choose a nonland card from it. That player discards that card. You lose 2 life.',
  )
  const FAITHLESS_LOOTING = derive(
    'Faithless Looting',
    'Sorcery',
    'Draw two cards, then discard two cards.\nFlashback {2}{R}',
  )

  it('reads a card that makes OPPONENTS discard', () => {
    expect(HOPELESS_NIGHTMARE.produces).toContain('opponent-discard')
    expect(MIND_ROT.produces).toContain('opponent-discard')
    expect(THOUGHTSEIZE.produces).toContain('opponent-discard')
  })

  it('does not call a hand attack a loot engine', () => {
    // The whole reason ADR-0016 narrowed `discard` was that this was happening
    // to 296 cards. Splitting the tag must not quietly undo that.
    expect(HOPELESS_NIGHTMARE.produces).not.toContain('discard')
    expect(MIND_ROT.produces).not.toContain('discard')
    expect(THOUGHTSEIZE.produces).not.toContain('discard')
  })

  it('does not call a loot engine a hand attack', () => {
    expect(FAITHLESS_LOOTING.produces).toContain('discard')
    expect(FAITHLESS_LOOTING.produces).not.toContain('opponent-discard')
  })

  it('reads a wheel as BOTH, because it is', () => {
    // "Each player discards" empties your hand and theirs. Claiming one and not
    // the other would be false whichever one you picked.
    const windfall = derive(
      'Windfall',
      'Sorcery',
      'Each player discards their hand, then draws cards equal to the greatest number of cards a player had in hand as this spell resolved.',
    )

    expect(windfall.produces).toContain('discard')
    expect(windfall.produces).toContain('opponent-discard')
  })

  it('does not read a punisher clause as YOU discarding', () => {
    // "…unless they sacrifice a permanent of their choice OR DISCARD A CARD".
    // The verb is a bare infinitive because its subject is "they", and the self
    // rule read that as being addressed to the caster. This is the exact clause
    // that put a self-discard tag on Tergrid's Lantern.
    const hailfire = derive(
      'Torment of Hailfire',
      'Sorcery',
      'Repeat the following process X times. Each opponent loses 3 life unless that player sacrifices a nonland permanent of their choice or discards a card.',
    )
    const court = derive(
      'Court of Ambition',
      'Enchantment',
      'When this enchantment enters, you become the monarch.\nAt the beginning of your upkeep, each opponent loses 3 life unless they discard a card.',
    )

    expect(court.produces).toContain('opponent-discard')
    expect(court.produces).not.toContain('discard')
    expect(hailfire.produces).toContain('opponent-discard')
    expect(hailfire.produces).toContain('opponent-sacrifice')
  })

  it('reads the payoffs the single tag could not reach', () => {
    const megrim = derive(
      'Megrim',
      'Enchantment',
      'Whenever an opponent discards a card, this enchantment deals 2 damage to that player.',
    )
    const wasteNot = derive(
      'Waste Not',
      'Enchantment',
      'Whenever an opponent discards a creature card, create a 2/2 black Zombie creature token.\nWhenever an opponent discards a land card, add {B}{B}.',
    )

    expect(megrim.wants).toContain('opponent-discard')
    expect(wasteNot.wants).toContain('opponent-discard')
    // And madness is still the OTHER tag's payoff, not this one's.
    expect(megrim.wants).not.toContain('discard')
  })

  it('reads an empty enemy hand as the payoff it is, and hellbent as the other one', () => {
    const tinybones = derive(
      'Tinybones, Trinket Thief',
      'Legendary Creature — Skeleton Rogue',
      'Deathtouch\nAt the beginning of each end step, if an opponent discarded a card this turn, you draw a card and you lose 1 life.\n{4}{B}{B}: Each opponent with no cards in hand loses 10 life.',
    )
    // Hellbent is the same sentence about YOU. It must not read as a hand
    // attack payoff — that is the subject confusion this ADR exists to remove.
    const jester = derive(
      "Demon's Jester",
      'Creature — Devil',
      'Flying\nHellbent — This creature gets +2/+1 as long as you have no cards in hand.',
    )

    expect(tinybones.wants).toContain('opponent-discard')
    expect(jester.wants).not.toContain('opponent-discard')
  })

  it('reads an edict as making an OPPONENT sacrifice', () => {
    const edict = derive(
      'Diabolic Edict',
      'Instant',
      'Target player sacrifices a creature of their choice.',
    )
    const fleshbag = derive(
      'Fleshbag Marauder',
      'Creature — Zombie Warrior',
      'When this creature enters, each player sacrifices a creature of their choice.',
    )
    const gravePact = derive(
      'Grave Pact',
      'Enchantment',
      'Whenever a creature you control dies, each other player sacrifices a creature of their choice.',
    )

    expect(edict.produces).toContain('opponent-sacrifice')
    expect(fleshbag.produces).toContain('opponent-sacrifice')
    expect(gravePact.produces).toContain('opponent-sacrifice')
  })

  it('does not call your own sacrifice outlet an edict', () => {
    // `sacrifice-fodder` is the aristocrats tag and its outlet eats YOUR board.
    // The imperative "Sacrifice a creature:" is addressed to the caster; only
    // the inflected "sacrifices" has a third-party subject.
    expect(deriveSynergy(ASHNODS_ALTAR).produces).not.toContain('opponent-sacrifice')
    expect(deriveSynergy(BLOOD_ARTIST).wants).not.toContain('opponent-sacrifice')
  })

  it('does not read a card that eats its OWN tokens as an edict', () => {
    const clamp = derive(
      'Skullclamp',
      'Artifact — Equipment',
      'Equipped creature gets +1/-1.\nWhenever equipped creature dies, draw two cards.\nEquip {1}',
    )
    const elder = derive(
      'Sakura-Tribe Elder',
      'Creature — Snake Shaman',
      'Sacrifice this creature: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
    )

    expect(clamp.produces).not.toContain('opponent-sacrifice')
    expect(elder.produces).not.toContain('opponent-sacrifice')
  })

  it('reads a payoff for a sacrifice you do not control', () => {
    const betrays = derive(
      'It That Betrays',
      'Creature — Eldrazi',
      'Annihilator 2\nWhenever an opponent sacrifices a nontoken permanent, put that card onto the battlefield under your control.',
    )
    const devil = derive(
      'Mayhem Devil',
      'Creature — Devil',
      'Whenever a player sacrifices a permanent, this creature deals 1 damage to any target.',
    )

    expect(betrays.wants).toContain('opponent-sacrifice')
    expect(devil.wants).toContain('opponent-sacrifice')
  })

  /**
   * The reported card, and the reason the model needed a subject at all.
   *
   * Both halves matter and they say different things. The front face is a pure
   * payoff and the Lantern is a pure producer, so the correct answer is that
   * Tergrid CAUSES and BENEFITS FROM both events. She is her own engine, and
   * every version of this before ADR-0022 could express neither half.
   */
  describe('Tergrid, God of Fright // Tergrid’s Lantern', () => {
    const FRONT =
      'Menace\nWhenever an opponent sacrifices a nontoken permanent or discards a permanent card, you may put that card from a graveyard onto the battlefield under your control.'
    const BACK =
      "{T}: Target player loses 3 life unless they sacrifice a nonland permanent of their choice or discard a card.\n{3}{B}: Untap Tergrid's Lantern."
    const tergrid = derive(
      'Tergrid, God of Fright',
      'Legendary Creature — God // Legendary Artifact',
      `${FRONT}\n${BACK}`,
      [FRONT, BACK],
    )

    it('benefits from both events, from the front face', () => {
      expect(tergrid.wants).toContain('opponent-discard')
      expect(tergrid.wants).toContain('opponent-sacrifice')
    })

    it('causes both events, from the Lantern', () => {
      expect(tergrid.produces).toContain('opponent-discard')
      expect(tergrid.produces).toContain('opponent-sacrifice')
    })

    it('is not reported as looting herself', () => {
      // The Lantern makes an OPPONENT discard. The old rules put the self tag
      // on her, which is how the front half's payoff went missing entirely.
      expect(tergrid.produces).not.toContain('discard')
    })

    it('reads the payoff across an "or", but not across a comma', () => {
      // "…sacrifices a nontoken permanent OR discards a permanent card" is one
      // trigger condition naming two events. A comma is where the condition
      // ends, and past it the sentence is describing an EFFECT — which for
      // Painful Quandary means it produces the discard rather than paying off.
      const quandary = derive(
        'Painful Quandary',
        'Enchantment',
        'Whenever an opponent casts a spell, that player loses 5 life unless they discard a card.',
      )

      expect(quandary.produces).toContain('opponent-discard')
      expect(quandary.wants).not.toContain('opponent-discard')
    })
  })

  it('reads each face on its own, so no rule spans the // boundary', () => {
    // SYNTHETIC TEXT, deliberately. No card in the corpus trips this — all 825
    // multi-faced commander-legal cards derive identically split or joined —
    // because a `[^.]` gap can only cross the join if the front face's last
    // line has no full stop, and real oracle text ends its sentences. That is
    // the measured reason this is safe today, not a reason it stays safe: the
    // landfall rule below really does match across the newline, and only
    // deriving per face is what stops it.
    const front = 'Landfall — Whenever a land card'
    const back = 'is put onto the battlefield, draw a card.'
    const joined = derive('Straddler', 'Sorcery // Sorcery', `${front}\n${back}`)
    const split = derive('Straddler', 'Sorcery // Sorcery', `${front}\n${back}`, [front, back])

    expect(joined.produces).toContain('landfall')
    expect(split.produces).not.toContain('landfall')
  })

  it('falls back to the whole text when the faces are not known', () => {
    // `oracleTextFaces` is absent for a single-faced card AND for any row
    // written before the column existed. Absence must not mean "no text".
    expect(MIND_ROT.produces).toContain('opponent-discard')
  })

  it('pairs the new tags, and refuses the pairings that would rebuild the bug', () => {
    expect(SYNERGY_TAGS).toContain('opponent-discard')
    expect(SYNERGY_TAGS).toContain('opponent-sacrifice')

    expect(interactsWith('opponent-discard')).toEqual(
      expect.arrayContaining(['opponent-sacrifice', 'lifeloss']),
    )
    expect(interactsWith('opponent-sacrifice')).toEqual(
      expect.arrayContaining(['opponent-discard', 'lifeloss', 'creature-death']),
    )

    // The rejected pairings, asserted so a later "obvious" addition has to
    // argue with a test rather than slip through. Looting yourself does not
    // feed Megrim, your tokens are not what an edict eats, and ADR-0016 already
    // ruled that an opponent's graveyard is not the resource.
    expect(interactsWith('opponent-discard')).not.toContain('discard')
    expect(interactsWith('opponent-discard')).not.toContain('graveyard-creature')
    expect(interactsWith('opponent-sacrifice')).not.toContain('sacrifice-fodder')
  })
})

describe('synergyMatches — a card that is its own engine', () => {
  // Tergrid produces AND wants `opponent-discard`. `synergyMatches` suppresses
  // the weaker reading of a tag it has already matched, and that rule was
  // written for `theme`; this is the test that says it does not reach further
  // and silence one half of a self-contained engine.
  const engine: SynergyProfile = {
    produces: ['opponent-discard'],
    wants: ['opponent-discard'],
  }

  it('keeps both readings when the deck both wants and produces the event', () => {
    const deck: DeckSynergy = {
      produces: new Map([['opponent-discard', 3] as const]),
      wants: new Map([['opponent-discard', 2] as const]),
      has: new Map(),
    }

    const directions = synergyMatches(engine, deck).map((m) => m.direction)
    expect(directions).toContain('enables')
    expect(directions).toContain('payoff')
  })

  it('does not additionally credit it with a theme it already enables', () => {
    // One fact counted twice. The deck wants the event and the card provides
    // it, which is the `enables` match; adding "and it wants what its
    // neighbours want" on top would inflate the same card for the same reason.
    const deck: DeckSynergy = {
      produces: new Map(),
      wants: new Map([['opponent-discard', 2] as const]),
      has: new Map(),
    }

    const matches = synergyMatches(engine, deck)
    expect(matches).toHaveLength(1)
    expect(matches[0]?.direction).toBe('enables')
  })
})

describe('deriveSynergy — damage is not life loss (ADR-0023)', () => {
  const derive = (name: string, typeLine: string, oracleText: string): SynergyProfile =>
    deriveSynergy({ oracleId: oracleId(name), name, typeLine, oracleText, keywords: [] })

  // Real oracle text throughout, abbreviated only where the tail is irrelevant.
  const IMPACT_TREMORS = derive(
    'Impact Tremors',
    'Enchantment',
    'Whenever a creature you control enters, this enchantment deals 1 damage to each opponent.',
  )
  const MANABARBS = derive(
    'Manabarbs',
    'Enchantment',
    'Whenever a player taps a land for mana, this enchantment deals 1 damage to that player.',
  )
  const PRICE_OF_PROGRESS = derive(
    'Price of Progress',
    'Instant',
    'Price of Progress deals damage to each player equal to twice the number of nonbasic lands that player controls.',
  )
  const FIREBALL = derive(
    'Fireball',
    'Sorcery',
    'This spell costs {1} more to cast for each target beyond the first.\nFireball deals X damage divided evenly, rounded down, among any number of targets.',
  )
  const EXSANGUINATE = derive(
    'Exsanguinate',
    'Sorcery',
    'Each opponent loses X life. You gain life equal to the life lost this way.',
  )
  const VITO = derive(
    'Vito, Thorn of the Dusk Rose',
    'Legendary Creature — Vampire Cleric',
    'Whenever you gain life, target opponent loses that much life.',
  )
  const EXQUISITE_BLOOD = derive(
    'Exquisite Blood',
    'Enchantment',
    'Whenever an opponent loses life, you gain that much life.',
  )
  const TORBRAN = derive(
    'Torbran, Thane of Red Fell',
    'Legendary Creature — Dwarf Noble',
    'If a red source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 2 instead.',
  )

  describe('the producer side, where the two events come apart', () => {
    it('tags a burn card as damage and not as life loss', () => {
      // The reported defect, in one card. 384 of the 1,446 cards that produced
      // `lifeloss` were these — they never mention life at all.
      expect(IMPACT_TREMORS.produces).toContain('player-damage')
      expect(IMPACT_TREMORS.produces).not.toContain('lifeloss')
      expect(MANABARBS.produces).toContain('player-damage')
      expect(MANABARBS.produces).not.toContain('lifeloss')
    })

    it('tags a drain card as life loss and not as damage', () => {
      // The other direction, and the reason this is a split rather than a
      // rename: Exsanguinate deals no damage, so a damage payoff must not see
      // it.
      expect(EXSANGUINATE.produces).toContain('lifeloss')
      expect(EXSANGUINATE.produces).not.toContain('player-damage')
      expect(VITO.produces).toContain('lifeloss')
      expect(VITO.produces).not.toContain('player-damage')
    })

    it('gives a card that does both both tags', () => {
      // 13 cards in the corpus burn and drain in one sentence. Claiming one and
      // not the other would be false whichever one was picked — the same ruling
      // ADR-0022 made for "each player discards".
      const bolas = derive(
        'Nicol Bolas, the Deceiver',
        'Legendary Planeswalker — Bolas',
        '+3: Each opponent loses 3 life unless that player sacrifices a nonland permanent of their choice or discards a card.\n−3: Destroy target creature. Draw a card.\n−11: Nicol Bolas deals 7 damage to each opponent. You draw seven cards.',
      )

      expect(bolas.produces).toEqual(expect.arrayContaining(['lifeloss', 'player-damage']))
    })

    it('reads the amount trailing the target', () => {
      // "deals damage to each player equal to twice…" — the amount comes after
      // the target, so the rule that requires "deals N damage to" cannot see it.
      expect(PRICE_OF_PROGRESS.produces).toContain('player-damage')
    })

    it('reads the X-spell finisher that names no target', () => {
      expect(FIREBALL.produces).toContain('player-damage')
    })

    it('does not read combat damage as damage to a player', () => {
      // Most damage in Magic is combat damage, and 751 cards carry "deals
      // combat damage to a player". None of them is a burn card, and
      // `attack-trigger` already owns the event. The rules exclude it without a
      // word about combat: the templating never states an amount, so the word
      // "combat" occupies exactly the position the rule wants the number in.
      const edric = derive(
        'Edric, Spymaster of Trest',
        'Legendary Creature — Elf Rogue',
        'Whenever a creature deals combat damage to one of your opponents, its controller may draw a card.',
      )

      expect(edric.produces).not.toContain('player-damage')
    })

    it('still reads a combat trigger whose effect is noncombat damage', () => {
      // Why the exclusion above has to be per clause rather than per card. A
      // card-level "has the words combat damage" filter would have dropped
      // Kediss, whose entire function is to burn the rest of the table.
      const kediss = derive(
        'Kediss, Emberclaw Familiar',
        'Legendary Creature — Elemental Lizard',
        'Whenever a commander you control deals combat damage to an opponent, it deals that much damage to each other opponent.',
      )

      expect(kediss.produces).toContain('player-damage')
    })

    it('does not read damage aimed at creatures, or at you', () => {
      const wipe = derive(
        'Blasphemous Act',
        'Sorcery',
        'Blasphemous Act deals 13 damage to each creature.',
      )
      // The same noun doing the opposite job: "your OPPONENTS CONTROL" is a
      // board wipe, not a burn spell.
      const sweeper = derive(
        'Boiling Earth',
        'Sorcery',
        'Boiling Earth deals 1 damage to each creature your opponents control.',
      )
      const tomb = derive(
        'Ancient Tomb',
        'Land',
        '{T}: Add {C}{C}. This land deals 2 damage to you.',
      )

      expect(wipe.produces).not.toContain('player-damage')
      expect(sweeper.produces).not.toContain('player-damage')
      expect(tomb.produces).not.toContain('player-damage')
    })
  })

  describe('the payoff side, which is where the entailment lives', () => {
    it('lets a life-loss payoff be satisfied by damage', () => {
      // The nuance the whole change turns on. Damage dealt to a player IS that
      // player losing life, so Exquisite Blood really does trigger off a Bolt —
      // it prints "(Damage causes loss of life.)" on the card.
      expect(EXQUISITE_BLOOD.wants).toEqual(expect.arrayContaining(['lifeloss', 'player-damage']))
    })

    it('does not let a drain producer satisfy a damage payoff', () => {
      // The one-way half. Torbran doubles damage and does nothing at all for a
      // drain spell, so it wants `player-damage` and not `lifeloss`. If this
      // ever fails, the relation has become symmetric and the defect is back.
      expect(TORBRAN.wants).toContain('player-damage')
      expect(TORBRAN.wants).not.toContain('lifeloss')
      expect(EXSANGUINATE.produces).not.toContain('player-damage')
    })

    it('keeps the bridge off payoffs about your own life', () => {
      /*
       * The producer rules tag damage aimed at opponents and players, never
       * "deals 2 damage to you", so offering Vilis a burn spell would be a
       * match on a life total the spell never touches. That refusal is what
       * this test is for and it is unchanged.
       *
       * The TAG the payoff sits on changed in ADR-0059, and the assertion moved
       * with it rather than being relaxed. ADR-0023 wrote "12 cards sit on
       * `lifeloss` alone for this reason" as a consequence, not as a claim: the
       * 12 were on that tag because there was nowhere else, and every producer
       * `lifeloss` has takes life off somebody ELSE's total. Vilis now wants
       * `self-lifeloss`, which is the event she actually pays off, and the
       * bridge refusal below is the same assertion it always was.
       */
      const vilis = derive(
        'Vilis, Broker of Blood',
        'Legendary Creature — Demon',
        'Flying\n{B}, Pay 2 life: Target creature gets -1/-1 until end of turn.\nWhenever you lose life, draw that many cards. (Damage causes loss of life.)',
      )

      expect(vilis.wants).toContain('self-lifeloss')
      expect(vilis.wants).not.toContain('player-damage')
    })

    it('reads a payoff whose subject is not third person', () => {
      // `los[et]s?`, not `loses`. The old rule reached 7 of the 19 real
      // life-loss payoffs because it required the inflected verb.
      const emet = derive(
        'Emet-Selch of the Third Seat',
        'Legendary Creature — Elder Wizard',
        'Spells you cast from your graveyard cost {2} less to cast.\nWhenever one or more opponents lose life, you may cast target instant or sorcery card from your graveyard.',
      )

      expect(emet.wants).toEqual(expect.arrayContaining(['lifeloss', 'player-damage']))
    })

    it('refuses a producer wearing a payoff sentence', () => {
      // The comma is where a trigger condition ends (ADR-0022). All seven cards
      // the old gap misread are producers, and every one has that comma. A
      // direction inversion is the worst error this file can make.
      const withinRange = derive(
        'Within Range',
        'Enchantment',
        'When this enchantment enters, create two 1/1 red Warrior creature tokens.\nWhenever you attack, each opponent loses life equal to the number of creatures attacking them.',
      )

      expect(withinRange.produces).toContain('lifeloss')
      expect(withinRange.wants).not.toContain('lifeloss')
      expect(withinRange.wants).not.toContain('player-damage')
    })

    it('refuses a damage payoff whose source is the card itself', () => {
      // An evasive creature hitting in combat. No burn spell has ever triggered
      // Curiosity, so the deck cannot supply what it asks for.
      const curiosity = derive(
        'Curiosity',
        'Enchantment — Aura',
        'Enchant creature\nWhenever enchanted creature deals damage to an opponent, you may draw a card.',
      )

      expect(curiosity.wants).not.toContain('player-damage')
    })

    it('refuses damage prevention, which reads like a payoff and is its opposite', () => {
      // Both match "would deal damage to a player". Requiring the amplifying
      // consequence — "it deals double / triple / that much plus" — is what
      // sorts a burn payoff from the card that turns the burn off.
      const ghosts = derive(
        'Ghosts of the Innocent',
        'Creature — Spirit',
        'If a source would deal damage to a permanent or player, it deals half that damage, rounded down, to that permanent or player instead.',
      )
      const alchemist = derive(
        'Battletide Alchemist',
        'Creature — Kithkin Cleric',
        'If a source would deal damage to a player, you may prevent X of that damage, where X is the number of Clerics you control.',
      )

      expect(ghosts.wants).not.toContain('player-damage')
      expect(alchemist.wants).not.toContain('player-damage')
    })

    it('reads the passive voice, where the damage has no named source', () => {
      // "Whenever an opponent IS DEALT damage" is the same payoff written from
      // the other end, and it is the wording that does not care where the
      // damage came from — which is exactly what a burn deck can supply.
      const spitfire = derive(
        "Chandra's Spitfire",
        'Creature — Elemental',
        'Flying\nWhenever an opponent is dealt noncombat damage, this creature gets +3/+0 until end of turn.',
      )

      expect(spitfire.wants).toContain('player-damage')
    })
  })

  describe('the pair table, which cannot say "A causes B but not the reverse"', () => {
    it('carries the new tag', () => {
      expect(SYNERGY_TAGS).toContain('player-damage')
    })

    it('pairs burn with the spells it is cast from', () => {
      // 489 of the 1,576 producers are instants or sorceries, and 58 cards read
      // "whenever you cast an instant or sorcery spell, this deals 2 damage to
      // each opponent" — Guttersnipe, Firebrand Archer, Electrostatic Field.
      expect(interactsWith('player-damage')).toContain('spell-cast')
    })

    it('refuses to pair damage with life loss', () => {
      // The refusal this ADR exists for. The table is unordered by
      // construction, and its one consumer renders a pair as "Benefits, and
      // benefits from" — a sentence that is symmetric in English too. Damage
      // causes life loss; life loss causes no damage. The entailment is carried
      // by the payoff rule instead, which is the only side it holds on.
      expect(interactsWith('player-damage')).not.toContain('lifeloss')
      expect(interactsWith('lifeloss')).not.toContain('player-damage')
    })

    it('refuses to pair damage with attacking', () => {
      // Combat damage is the event this tag is defined to exclude.
      expect(interactsWith('player-damage')).not.toContain('attack-trigger')
    })
  })

  describe('what a deck sees', () => {
    it('offers a burn card to a deck built on an opponent losing life', () => {
      const bolt = derive(
        'Lightning Bolt',
        'Instant',
        'Lightning Bolt deals 3 damage to any target.',
      )
      const deck = deckSynergy([oracleId('Exquisite Blood')], [], (id) =>
        id === oracleId('Exquisite Blood') ? EXQUISITE_BLOOD : undefined,
      )

      const match = synergyMatches(bolt, deck).find((m) => m.tag === 'player-damage')
      expect(match?.direction).toBe('enables')
      expect(match?.weight).toBe(COMMANDER_WEIGHT)
    })

    it('does not offer a damage doubler to a deck that only drains', () => {
      // The whole point of the direction. Exsanguinate is not what Torbran is
      // for, and before this change every drain spell claimed to be.
      const deck = deckSynergy([oracleId('Exsanguinate')], [], (id) =>
        id === oracleId('Exsanguinate') ? EXSANGUINATE : undefined,
      )

      expect(synergyMatches(TORBRAN, deck)).toEqual([])
    })
  })
})

describe('deriveSynergy — dealing damage is its own event (ADR-0029)', () => {
  const derive = (name: string, typeLine: string, oracleText: string): SynergyProfile =>
    deriveSynergy({ oracleId: oracleId(name), name, typeLine, oracleText, keywords: [] })
  const deriveFaces = (name: string, typeLine: string, faces: readonly string[]): SynergyProfile =>
    deriveSynergy({
      oracleId: oracleId(name),
      name,
      typeLine,
      oracleText: faces.join('\n'),
      keywords: [],
      oracleTextFaces: faces,
    })

  // Real oracle text throughout, abbreviated only where the tail is irrelevant.
  const FLAME_SLASH = derive(
    'Flame Slash',
    'Sorcery',
    'Flame Slash deals 4 damage to target creature.',
  )
  const RIPJAW_RAPTOR = derive(
    'Ripjaw Raptor',
    'Creature — Dinosaur',
    'Enrage — Whenever this creature is dealt damage, draw a card.',
  )
  const FIERY_EMANCIPATION = derive(
    'Fiery Emancipation',
    'Enchantment',
    'If a source you control would deal damage to a permanent or player, it deals triple that damage to that permanent or player instead.',
  )

  describe('the tag', () => {
    it('is in the vocabulary, and was the twenty-first', () => {
      // The length moved to 22 when ADR-0047 added `land-creature`. Kept as a
      // count rather than softened to `toContain`: a vocabulary that grows
      // without anyone noticing is how two tags come to mean the same event.
      expect(SYNERGY_TAGS).toContain('damage')
      // The count is 27 since ADR-0059 added `self-lifeloss` to ADR-0054's
      // `ritual` and `creature-cast`;
      // this card was the twenty-first and still is, because the list is
      // append-only (the ORDER is a persisted contract — see `semantic-emphasis`).
      // `EVENT_TAGS` rather than `SYNERGY_TAGS` since ADR-0046, and the reason
      // the comment above gives is why the assertion survives rather than being
      // softened: the CURATED events are still a closed hand-written list, and
      // this is what keeps anyone from adding a twenty-third without saying so.
      // `SYNERGY_TAGS` is that list plus the generated families, whose length is
      // a fact about the corpus rather than a decision anyone made here.
      expect(EVENT_TAGS).toHaveLength(27)
    })

    it('is spelled as an event, not as an archetype', () => {
      // `burn` is a deck, and the tag names have to slot after "causes" in the
      // UI. The word a player types lives in the query alias instead — see
      // `normaliseTag` and its test.
      expect(SYNERGY_TAGS).not.toContain('burn')
    })
  })

  describe('the producers', () => {
    it('reads a burn spell pointed at a creature', () => {
      expect(FLAME_SLASH.produces).toContain('damage')
    })

    it('reads a pinger, which no threshold would have let in', () => {
      // The tag makes no claim about whether the creature dies, so the amount
      // stops mattering. 1 damage is damage.
      const embermage = derive(
        'Wojek Embermage',
        'Creature — Human Wizard',
        '{T}: This creature deals 1 damage to target creature.',
      )

      expect(embermage.produces).toContain('damage')
    })

    it('reads X and "that much" as well as a printed number', () => {
      const defiance = derive(
        'Clan Defiance',
        'Sorcery',
        'Choose one or more —\n• Clan Defiance deals X damage to target creature with flying.\n• Clan Defiance deals X damage to target player or planeswalker.',
      )
      // Balefire Dragon is also the combat-damage ruling: its TRIGGER is combat
      // damage and its EFFECT is not, and the clause is the unit (ADR-0023 §3).
      const balefire = derive(
        'Balefire Dragon',
        'Creature — Dragon',
        'Flying\nWhenever this creature deals combat damage to a player, it deals that much damage to each creature that player controls.',
      )

      expect(defiance.produces).toContain('damage')
      expect(balefire.produces).toContain('damage')
    })

    it('reads a sweeper', () => {
      const act = derive(
        'Blasphemous Act',
        'Sorcery',
        'This spell costs {1} less to cast for each creature on the battlefield.\nBlasphemous Act deals 13 damage to each creature.',
      )

      expect(act.produces).toContain('damage')
    })

    it('reads the amount that trails its target', () => {
      // "Deals damage to each player equal to…" and "deals damage equal to its
      // power to…" put the number after the noun, and no rule looked there.
      const price = derive(
        'Price of Progress',
        'Instant',
        'Price of Progress deals damage to each player equal to twice the number of nonbasic lands that player controls.',
      )
      const way = derive(
        "Nature's Way",
        'Sorcery',
        "Target creature you control gains vigilance and trample until end of turn. It deals damage equal to its power to target creature you don't control.",
      )

      expect(price.produces).toContain('damage')
      expect(way.produces).toContain('damage')
    })

    it('reads damage divided among targets, which names no amount per target', () => {
      const atarka = derive(
        'Dragonlord Atarka',
        'Legendary Creature — Elder Dragon',
        'Flying, trample\nWhen Dragonlord Atarka enters, it deals 5 damage divided as you choose among any number of target creatures and/or planeswalkers your opponents control.',
      )

      expect(atarka.produces).toContain('damage')
    })
  })

  describe('what the tag refuses', () => {
    it('refuses damage a card deals to you as a cost', () => {
      // 105 cards match on nothing else, and they are Ancient Tomb, Mana Vault,
      // the painlands and the Talismans. A damage deck does not play them for
      // the damage. Same ruling as ADR-0023 §6, one subject over.
      const tomb = derive(
        'Ancient Tomb',
        'Land',
        '{T}: Add {C}{C}. This land deals 2 damage to you.',
      )
      const vault = derive(
        'Mana Vault',
        'Artifact',
        "This artifact doesn't untap during your untap step.\n{4}: Untap this artifact.\nAt the beginning of your upkeep, this artifact deals 1 damage to you.\n{T}: Add {C}{C}{C}.",
      )

      expect(tomb.produces).not.toContain('damage')
      expect(vault.produces).not.toContain('damage')
    })

    it('refuses combat damage, because it never states an amount', () => {
      const edric = derive(
        'Edric, Spymaster of Trest',
        'Legendary Creature — Elf Rogue',
        'Whenever a creature deals combat damage to one of your opponents, its controller may draw a card.',
      )

      expect(edric.produces).not.toContain('damage')
    })

    it('refuses prevention, which is the opposite card', () => {
      const medic = derive(
        'Battlefield Medic',
        'Creature — Human Cleric',
        '{T}: Prevent the next X damage that would be dealt to target creature this turn, where X is the number of Clerics on the battlefield.',
      )

      expect(medic.produces).not.toContain('damage')
    })

    it('does not claim a creature dies', () => {
      // The ruling this ADR turns on. 4 damage kills 85.7% of the commander-legal
      // creature corpus and 3 kills 69.6% — a slope with no honest threshold on
      // it — so the producer promises damage and the pair table carries the rest.
      expect(FLAME_SLASH.produces).not.toContain('creature-death')
    })
  })

  describe('the boundary against player-damage', () => {
    it('claims both when the damage can reach a face', () => {
      // `player-damage` is the strictly narrower event. All 1,576 of its
      // producers produce `damage` too — checked card by card, no exceptions.
      const bolt = derive(
        'Lightning Bolt',
        'Instant',
        'Lightning Bolt deals 3 damage to any target.',
      )
      const tremors = derive(
        'Impact Tremors',
        'Enchantment',
        'Whenever a creature you control enters, this enchantment deals 1 damage to each opponent.',
      )

      expect(bolt.produces).toEqual(expect.arrayContaining(['damage', 'player-damage']))
      expect(tremors.produces).toEqual(expect.arrayContaining(['damage', 'player-damage']))
    })

    it('claims only the wider one when the damage cannot', () => {
      expect(FLAME_SLASH.produces).toContain('damage')
      expect(FLAME_SLASH.produces).not.toContain('player-damage')
    })

    it('leaves the life-loss split exactly where ADR-0023 put it', () => {
      const bolt = derive(
        'Lightning Bolt',
        'Instant',
        'Lightning Bolt deals 3 damage to any target.',
      )
      const exsanguinate = derive(
        'Exsanguinate',
        'Sorcery',
        'Each opponent loses X life. You gain life equal to the life lost this way.',
      )

      expect(bolt.produces).not.toContain('lifeloss')
      expect(exsanguinate.produces).not.toContain('damage')
      expect(exsanguinate.produces).not.toContain('player-damage')
    })
  })

  describe('the payoffs, which are why the tag is not inert', () => {
    it('reads enrage', () => {
      expect(RIPJAW_RAPTOR.wants).toContain('damage')
    })

    it('reads the same trigger on somebody else’s creature', () => {
      const repercussion = derive(
        'Repercussion',
        'Enchantment',
        "Whenever a creature is dealt damage, this enchantment deals that much damage to that creature's controller.",
      )

      expect(repercussion.wants).toContain('damage')
    })

    it('reads an amplifier, and gives it both damage tags', () => {
      // One sentence, two events — the ruling ADR-0022 made about "each player
      // discards". Fiery Emancipation triples damage at a permanent OR a player.
      expect(FIERY_EMANCIPATION.wants).toEqual(expect.arrayContaining(['damage', 'player-damage']))
    })

    it('reads Toralf, whom ADR-0023 named as unreachable', () => {
      const toralf = derive(
        'Toralf, God of Fury',
        'Legendary Creature — God',
        'Trample\nWhenever a creature or planeswalker an opponent controls is dealt excess noncombat damage, Toralf deals damage equal to the excess to any target other than that permanent.',
      )

      expect(toralf.wants).toContain('damage')
    })

    it('does not read trample as a damage payoff', () => {
      // Trample's reminder text says "excess COMBAT damage", and a permissive
      // adjective gap in the rule above made all 176 trample creatures burn
      // payoffs. Colossal Dreadmaw is the card that caught it.
      const dreadmaw = derive(
        'Colossal Dreadmaw',
        'Creature — Dinosaur',
        "Trample (This creature can deal excess combat damage to the player or planeswalker it's attacking.)",
      )

      expect(dreadmaw.wants).not.toContain('damage')
      expect(dreadmaw.produces).not.toContain('damage')
    })

    it('reads removal that only works on something already damaged', () => {
      const mist = derive(
        "Witch's Mist",
        'Artifact',
        '{2}{B}, {T}: Destroy target creature that was dealt damage this turn.',
      )

      expect(mist.wants).toContain('damage')
    })

    it('gives bloodthirst to the narrower tag, because it names the subject', () => {
      // "If an OPPONENT was dealt damage this turn". A Flame Slash aimed at a
      // creature does not turn it on, so the wider tag would be a wrong match.
      const ogre = derive(
        'Blood Ogre',
        'Creature — Vampire Warrior',
        'Bloodthirst 1 (If an opponent was dealt damage this turn, this creature enters with a +1/+1 counter on it.)\nFirst strike',
      )

      expect(ogre.wants).toContain('player-damage')
      expect(ogre.wants).not.toContain('damage')
    })

    it('refuses a payoff whose source can only be the card itself', () => {
      // ADR-0023's Curiosity ruling. No burn spell has ever triggered it, so the
      // deck cannot supply what it asks for.
      const curiosity = derive(
        'Curiosity',
        'Enchantment — Aura',
        'Enchant creature\nWhenever enchanted creature deals damage to an opponent, you may draw a card.',
      )

      expect(curiosity.wants).not.toContain('damage')
    })

    it('refuses damage prevention wearing a payoff sentence', () => {
      const ghosts = derive(
        'Ghosts of the Innocent',
        'Creature — Spirit',
        'If a source would deal damage to a permanent or player, it deals half that damage, rounded down, to that permanent or player instead.',
      )

      expect(ghosts.wants).not.toContain('damage')
    })
  })

  describe('the pair table', () => {
    it('pairs damage with creature deaths, which is where the entailment lives', () => {
      // Lethal damage destroys a creature, but "lethal" depends on a toughness
      // the card cannot see. A pair claims the weaker, true thing.
      expect(interactsWith('damage')).toContain('creature-death')
      expect(interactsWith('creature-death')).toContain('damage')
    })

    it('pairs damage with the spells most of it is cast from', () => {
      // 1,162 of the 2,740 producers are instants or sorceries.
      expect(interactsWith('damage')).toContain('spell-cast')
    })

    it('refuses to pair damage with the tag it contains', () => {
      // A strict subset does not feed its superset. ADR-0022's `discard` ↔
      // `opponent-discard` refusal, one event over.
      expect(interactsWith('damage')).not.toContain('player-damage')
      expect(interactsWith('player-damage')).not.toContain('damage')
    })

    it('refuses to pair damage with life loss, attacking, or counters', () => {
      expect(interactsWith('damage')).not.toContain('lifeloss')
      expect(interactsWith('damage')).not.toContain('attack-trigger')
      expect(interactsWith('damage')).not.toContain('plus1-counter')
    })
  })

  describe('reanimation that reaches into a graveyard', () => {
    it('reads "put ... onto the battlefield", which no rule spelled', () => {
      // The rules already accepted "a graveyard"; what none of them accepted was
      // the verb. Every reanimation rule in the file was written around "return".
      const reanimate = derive(
        'Reanimate',
        'Sorcery',
        "Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to that card's mana value.",
      )

      expect(reanimate.wants).toContain('graveyard-creature')
      expect(reanimate.produces).toContain('creature-etb')
    })

    it('reads the ones that are not about creatures', () => {
      // `graveyard-creature` is the graveyard-as-a-resource tag — its own
      // comment says so — but `creature-etb` really is about creatures.
      const restore = derive(
        'Restore',
        'Instant',
        'Put target land card from a graveyard onto the battlefield under your control.',
      )

      expect(restore.wants).toContain('graveyard-creature')
      expect(restore.produces).not.toContain('creature-etb')
    })

    it('does not claim your graveyard is full because you robbed theirs', () => {
      // ADR-0016 ruled that an opponent's graveyard is not the resource and
      // ADR-0022 kept that ruling. A card that only ever reaches into theirs
      // still makes a creature enter, so it produces `creature-etb` — but it
      // wants nothing from your own yard.
      const encore = derive(
        'Gruesome Encore',
        'Sorcery',
        "Put target creature card from an opponent's graveyard onto the battlefield under your control. It gains haste.",
      )

      expect(encore.produces).toContain('creature-etb')
      expect(encore.wants).not.toContain('graveyard-creature')
    })
  })

  describe('Nicol Bolas, the Ravager // Nicol Bolas, the Arisen — the reported card', () => {
    const BOLAS = deriveFaces(
      'Nicol Bolas, the Ravager // Nicol Bolas, the Arisen',
      'Legendary Creature — Elder Dragon // Legendary Planeswalker — Bolas',
      [
        "Flying\nWhen Nicol Bolas enters, each opponent discards a card.\n{4}{U}{B}{R}: Exile Nicol Bolas, then return him to the battlefield transformed under his owner's control. Activate only as a sorcery.",
        '+2: Draw two cards.\n−3: Nicol Bolas deals 10 damage to target creature or planeswalker.\n−4: Put target creature or planeswalker card from a graveyard onto the battlefield under your control.\n−12: Exile all but the bottom card of target player’s library.',
      ],
    )

    it('reads the −3 as damage', () => {
      expect(BOLAS.produces).toContain('damage')
    })

    it('does not read the −3 as damage at a face', () => {
      // It can only ever be pointed at a permanent, which is exactly the half of
      // the event `player-damage` was not built to see.
      expect(BOLAS.produces).not.toContain('player-damage')
    })

    it('reads the −4 as reanimation, in both directions', () => {
      expect(BOLAS.produces).toContain('creature-etb')
      expect(BOLAS.wants).toContain('graveyard-creature')
    })

    it('keeps everything the front face already said', () => {
      expect(BOLAS.produces).toEqual(
        expect.arrayContaining(['card-draw', 'opponent-discard', 'damage', 'creature-etb']),
      )
    })

    it('still says nothing about the −12, and that is the decision', () => {
      // Library exile is not modelled, deliberately: there is no `mill` tag, and
      // the ultimate is a win condition rather than an event another card in the
      // deck pays off. Four produces, and no fifth.
      expect(BOLAS.produces).toHaveLength(4)
    })
  })

  describe('what a deck sees', () => {
    it('offers a burn spell to a deck built on being damaged', () => {
      const deck = deckSynergy([oracleId('Ripjaw Raptor')], [], (id) =>
        id === oracleId('Ripjaw Raptor') ? RIPJAW_RAPTOR : undefined,
      )

      const match = synergyMatches(FLAME_SLASH, deck).find((m) => m.tag === 'damage')
      expect(match?.direction).toBe('enables')
      expect(match?.weight).toBe(COMMANDER_WEIGHT)
    })

    it('offers an amplifier to a deck that deals damage at creatures', () => {
      // Before this change Fiery Emancipation only ever matched a deck that
      // burned faces, so a creature-removal deck was told it had no payoff.
      const deck = deckSynergy([oracleId('Flame Slash')], [], (id) =>
        id === oracleId('Flame Slash') ? FLAME_SLASH : undefined,
      )

      expect(
        synergyMatches(FIERY_EMANCIPATION, deck).find((m) => m.tag === 'damage')?.direction,
      ).toBe('payoff')
    })

    it('does not offer a mana land to either', () => {
      const tomb = derive(
        'Ancient Tomb',
        'Land',
        '{T}: Add {C}{C}. This land deals 2 damage to you.',
      )
      const deck = deckSynergy([oracleId('Ripjaw Raptor')], [], (id) =>
        id === oracleId('Ripjaw Raptor') ? RIPJAW_RAPTOR : undefined,
      )

      expect(synergyMatches(tomb, deck)).toEqual([])
    })
  })
})

describe('deriveSynergy — one semantic per clause (ADR-0038)', () => {
  const derive = (name: string, typeLine: string, oracleText: string): SynergyProfile =>
    deriveSynergy({ oracleId: oracleId(name), name, typeLine, oracleText, keywords: [] })

  describe('a permanent that arrives carrying counters', () => {
    it('reads the reported card', () => {
      // Moritte was the report: "no semantics, even though she does both +1/+1
      // counters and copy a creature". The counter half was a rule gap — the old
      // pattern was `enters with (a|an|one|two|…) +1/+1 counter`, a closed list
      // with no room for the word "additional".
      const moritte = derive(
        'Moritte of the Frost',
        'Legendary Snow Creature — Shapeshifter',
        "Changeling (This card is every creature type.)\nYou may have Moritte enter as a copy of a permanent you control, except it's legendary and snow in addition to its other types and, if it's a creature, it enters with two additional +1/+1 counters on it and has changeling.",
      )

      expect(moritte.produces).toContain('plus1-counter')
    })

    it('reads the counters a clone brings with it', () => {
      const altered = derive(
        'Altered Ego',
        'Creature — Shapeshifter',
        'You may have this creature enter as a copy of any creature on the battlefield, except it enters with X additional +1/+1 counters on it.',
      )

      expect(altered.produces).toContain('plus1-counter')
    })

    it('reads a count that is spelled out rather than numbered', () => {
      const scavenger = derive(
        'Undergrowth Scavenger',
        'Creature — Plant Elemental',
        'This creature enters with a number of +1/+1 counters on it equal to the number of creature cards in all graveyards.',
      )

      expect(scavenger.produces).toContain('plus1-counter')
    })

    it('still reads the plain numbered form the closed list used to reach', () => {
      // The widened gap has to be a superset, not a replacement.
      const polukranos = derive(
        'Polukranos, Unchained',
        'Legendary Creature — Zombie Hydra',
        'Polukranos enters with six +1/+1 counters on it.',
      )

      expect(polukranos.produces).toContain('plus1-counter')
    })

    it('reads reanimation that adds counters on the way back', () => {
      const evil = derive(
        'Evil Reawakened',
        'Sorcery',
        'Return target creature card from your graveyard to the battlefield with two additional +1/+1 counters on it.',
      )

      expect(evil.produces).toContain('plus1-counter')
    })
  })

  describe('a creature that sacrifices itself', () => {
    it('reads the self-sacrifice as a creature dying', () => {
      const elder = derive(
        'Sakura-Tribe Elder',
        'Creature — Snake Shaman',
        'Sacrifice this creature: Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
      )

      expect(elder.produces).toContain('creature-death')
    })

    it('reads it even when the death is a drawback rather than an outlet', () => {
      // A board wipe is already read this way: the card is not a sacrifice
      // outlet, but a deck built on "whenever a creature dies" still gets one.
      const runner = derive(
        'Arc Runner',
        'Creature — Elemental Ox',
        'Haste (This creature can attack and {T} as soon as it comes under your control.)\nAt the beginning of the end step, sacrifice this creature.',
      )

      expect(runner.produces).toContain('creature-death')
    })

    it('does not mistake it for a sacrifice outlet', () => {
      // An outlet WANTS fodder because you feed it your board. A creature that
      // can only eat itself asks for nothing.
      const cantor = derive(
        'Wild Cantor',
        'Creature — Human Druid',
        'Sacrifice this creature: Add one mana of any color.',
      )

      expect(cantor.wants).not.toContain('sacrifice-fodder')
    })
  })

  describe('the attack trigger Magic stopped writing as "attacks"', () => {
    it('reads "whenever you attack"', () => {
      // The rule asked for the inflected verb, and the modern template does not
      // use it: "Whenever you attack" is one trigger for the whole team.
      const adeline = derive(
        'Adeline, Resplendent Cathar',
        'Legendary Creature — Human Knight',
        "Vigilance\nAdeline's power is equal to the number of creatures you control.\nWhenever you attack, for each opponent, create a 1/1 white Human creature token that's tapped and attacking that player or a planeswalker they control.",
      )

      expect(adeline.wants).toContain('attack-trigger')
    })

    it('reads the form that counts the attackers', () => {
      const champions = derive(
        'Champions from Beyond',
        'Enchantment',
        'When this enchantment enters, create X 1/1 colorless Hero creature tokens.\nFull Party — Whenever you attack with eight or more creatures, those creatures get +4/+4 until end of turn.',
      )

      expect(champions.wants).toContain('attack-trigger')
    })
  })

  describe('fetching a land by its basic type', () => {
    it('reads a fetchland as putting a land onto the battlefield', () => {
      // The old rules wanted the WORD "land". A fetchland never says it — it
      // names the basic types instead — so the most-played landfall enabler in
      // the format read as nothing at all.
      const strand = derive(
        'Flooded Strand',
        'Land',
        '{T}, Pay 1 life, Sacrifice this land: Search your library for a Plains or Island card, put it onto the battlefield, then shuffle.',
      )

      expect(strand.produces).toContain('landfall')
    })

    it('reads the ramp spells the same way', () => {
      const farseek = derive(
        'Farseek',
        'Sorcery',
        'Search your library for a Plains, Island, Swamp, or Mountain card, put it onto the battlefield tapped, then shuffle.',
      )

      expect(farseek.produces).toContain('landfall')
    })

    it('does not read a tutor that fetches something else', () => {
      // The word "land" is in this card's COST, not in what it fetches. A rule
      // that read the whole clause would call every sacrifice-a-land tutor a
      // landfall enabler.
      const glider = derive(
        'Bog Glider',
        'Creature — Kor Rebel',
        '{T}, Sacrifice a land: Search your library for a Mercenary permanent card with mana value 2 or less, put it onto the battlefield, then shuffle.',
      )

      expect(glider.produces).not.toContain('landfall')
    })
  })

  describe("an enters trigger written with the card's own name", () => {
    it('reads it as wanting to be blinked', () => {
      // `when this creature enters` is the modern template; 527 commander-legal
      // creatures still print their own name there and matched nothing.
      const tolsimir = derive(
        'Tolsimir, Friend to Wolves',
        'Legendary Creature — Elf Scout',
        'When Tolsimir enters, create Voja, Friend to Elves, a legendary 3/3 green and white Wolf creature token.',
      )

      expect(tolsimir.wants).toContain('creature-etb')
    })

    it('reads "whenever" as well as "when"', () => {
      const ellivere = derive(
        'Ellivere of the Wild Court',
        'Legendary Creature — Human Knight',
        'Whenever Ellivere enters or attacks, create a Virtuous Role token attached to another target creature you control.',
      )

      expect(ellivere.wants).toContain('creature-etb')
    })

    it('does not read a non-creature permanent as a creature entering', () => {
      // A blink deck's whole vocabulary is creatures. An Equipment with an
      // enters trigger is a different card, and `creature-etb` says creature.
      const embercleave = derive(
        'Embercleave',
        'Legendary Artifact — Equipment',
        'When Embercleave enters, attach it to target creature you control.',
      )

      expect(embercleave.wants).not.toContain('creature-etb')
    })

    it('does not fire on a lowercase subject', () => {
      // The capital is what says "this is a name", and it is the whole of the
      // rule's precision. Read case-insensitively, "whenever AN ARTIFACT you
      // control enters" is a capital-A subject 28 characters wide, and this
      // card would ask to be blinked because somebody else's permanent entered.
      const fireweaver = derive(
        'Reckless Fireweaver',
        'Creature — Human Artificer',
        'Whenever an artifact you control enters, this creature deals 1 damage to each opponent.',
      )

      expect(fireweaver.wants).toContain('artifact-etb')
      expect(fireweaver.wants).not.toContain('creature-etb')
    })
  })

  describe('the spellslinger trigger that names no card type', () => {
    it('reads "whenever you cast a spell"', () => {
      const conduit = derive(
        'Aetherflux Conduit',
        'Artifact',
        'Whenever you cast a spell, you get an amount of {E} (energy counters) equal to the amount of mana spent to cast that spell.',
      )

      expect(conduit.wants).toContain('spell-cast')
    })
  })

  describe('caring about counters that are already there', () => {
    it('reads a payoff for creatures that carry counters', () => {
      const priest = derive(
        'Abzan Battle Priest',
        'Creature — Human Cleric',
        'Outlast {W}\nEach creature you control with a +1/+1 counter on it has lifelink.',
      )

      expect(priest.wants).toContain('plus1-counter')
    })

    it('does not read a creature that makes its own counters as a payoff', () => {
      // The worst error this file can make is a direction inversion, and the
      // article is where it would have got in: "each creature … with a +1/+1
      // counter on it" is a payoff, and "this creature ENTERS WITH a +1/+1
      // counter on it" is the produce side wearing nearly the same words.
      const colossus = derive(
        'Diregraf Colossus',
        'Creature — Zombie Giant',
        'This creature enters with a +1/+1 counter on it for each Zombie card in your graveyard.',
      )

      expect(colossus.produces).toContain('plus1-counter')
      expect(colossus.wants).not.toContain('plus1-counter')
    })
  })

  describe('a payoff for the tokens themselves', () => {
    it('reads an anthem that only pumps tokens', () => {
      const virtue = derive(
        'Intangible Virtue',
        'Enchantment',
        'Creature tokens you control get +1/+1 and have vigilance.',
      )

      expect(virtue.wants).toContain('token')
    })
  })

  describe('rules that were passing for no reason', () => {
    it('reads spot removal as a creature dying', () => {
      // Found by mutating the file: this rule had no test at all, so
      // `destroy target creature` could be deleted and every test stayed green.
      const murder = derive('Murder', 'Instant', 'Destroy target creature.')

      expect(murder.produces).toContain('creature-death')
    })

    it('reads a board wipe as creatures dying', () => {
      const wrath = derive(
        'Wrath of God',
        'Sorcery',
        "Destroy all creatures. They can't be regenerated.",
      )

      expect(wrath.produces).toContain('creature-death')
    })
  })

  describe('Moritte of the Frost, re-derived', () => {
    const MORITTE = derive(
      'Moritte of the Frost',
      'Legendary Snow Creature — Shapeshifter',
      "Changeling (This card is every creature type.)\nYou may have Moritte enter as a copy of a permanent you control, except it's legendary and snow in addition to its other types and, if it's a creature, it enters with two additional +1/+1 counters on it and has changeling.",
    )

    it('is no longer a card the model has nothing to say about', () => {
      // The EVENT it produces. Moritte also carries membership tags from its own
      // type line since ADR-0046, and those are a different question from what
      // the card causes — so the event half is asserted exactly and the
      // namespaced half is excluded by its prefix rather than retyped.
      expect(MORITTE.produces.filter((t) => !t.includes(':'))).toEqual(['plus1-counter'])
    })

    it('says nothing about the copy half, and that is the decision', () => {
      // A `copy` tag was measured and REFUSED on ADR-0029 §6's ground. The
      // corpus holds 452 cards that copy a permanent and 76 whose text is
      // payoff-shaped about copying — and every one of those 76 is a SPELL copy
      // ("magecraft", "whenever you cast an instant or sorcery, copy it"),
      // which `spell-cast` already owns. Nothing pays off having a copy of a
      // permanent, so the tag would be inert in exactly the way ADR-0029 §6
      // refused a mill tag for being.
      expect(MORITTE.wants).toEqual([])
    })
  })
})

describe('deriveSynergy — a sacrifice outlet that names a creature TYPE (ADR-0038)', () => {
  const derive = (name: string, typeLine: string, oracleText: string): SynergyProfile =>
    deriveSynergy({ oracleId: oracleId(name), name, typeLine, oracleText, keywords: [] })

  it('reads the reported card', () => {
    // "ambush commander has no semantic tags. why is that?" — because every
    // `creature-death` producer wanted the literal word "creature", and this
    // card names an Elf.
    const ambush = derive(
      'Ambush Commander',
      'Creature — Elf',
      'Forests you control are 1/1 green Elf creatures that are still lands.\n{1}{G}, Sacrifice an Elf: Target creature gets +3/+3 until end of turn.',
    )

    expect(ambush.produces).toContain('creature-death')
  })

  it('reads the archetypal tribal outlet', () => {
    const prospector = derive(
      'Skirk Prospector',
      'Creature — Goblin',
      'Sacrifice a Goblin: Add {R}.',
    )

    expect(prospector.produces).toContain('creature-death')
  })

  it('reads the verb mid-sentence as well as at the start of a clause', () => {
    // 10 of the 105 cards spell it lowercase, because the sacrifice is an
    // additional COST rather than an activated ability: Goblin Grenade, Sorin,
    // Wilhelt, Sacred Mesa, Writhing Chrysalis. Found by a mutation surviving —
    // `[Ss]` reduced to `S` broke nothing until this test existed.
    const grenade = derive(
      'Goblin Grenade',
      'Sorcery',
      'As an additional cost to cast this spell, sacrifice a Goblin.\nGoblin Grenade deals 5 damage to any target.',
    )

    expect(grenade.produces).toContain('creature-death')
  })

  it('reads a type that only ever exists as a token', () => {
    // Servo, Pentavite, Balloon, Prism, Caribou and Goat are creature types no
    // CARD carries, so a rule built from the corpus's own type lines could not
    // see them. That is the measurement that chose a deny list over an
    // allow list.
    const foundry = derive(
      'Retrofitter Foundry',
      'Artifact',
      '{2}, {T}: Create a 1/1 colorless Servo artifact creature token.\n{1}, {T}, Sacrifice a Servo: Create a 1/1 colorless Thopter artifact creature token with flying.',
    )

    expect(foundry.produces).toContain('creature-death')
  })

  it('does not read sacrificing a Food as a creature dying', () => {
    // The trap, and the biggest single class in it: 45 cards sacrifice a Food.
    // A Food is an artifact, and a deck built on "whenever a creature dies"
    // gets nothing from eating one.
    const farmer = derive(
      'Bristlebud Farmer',
      'Creature — Plant Druid',
      'Trample\nWhenever this creature attacks, you may sacrifice a Food. If you do, mill three cards.',
    )

    expect(farmer.produces).not.toContain('creature-death')
  })

  it('does not read sacrificing a Clue or a Treasure as a creature dying', () => {
    const cadaver = derive(
      'Curious Cadaver',
      'Creature — Zombie Detective',
      'Flying\nWhen you sacrifice a Clue, return this card from your graveyard to your hand.',
    )

    expect(cadaver.produces).not.toContain('creature-death')
  })

  it('does not read a land sacrifice as a creature dying', () => {
    // 75 card-mentions, and the reason the basic land types are in the deny
    // list even though Dryad Arbor makes "Forest" a creature subtype.
    const crash = derive(
      'Crash',
      'Instant',
      "You may sacrifice a Mountain rather than pay this spell's mana cost.\nDestroy target artifact.",
    )

    expect(crash.produces).not.toContain('creature-death')
  })

  it('does not read sacrificing an Equipment or a Room as a creature dying', () => {
    const soulrager = derive(
      'Intruding Soulrager',
      'Creature — Spirit',
      'Vigilance\n{T}, Sacrifice a Room: This creature deals 2 damage to each opponent. Draw a card.',
    )
    const ronin = derive(
      'Ronin, Shadow Stalker',
      'Legendary Creature — Human Rogue Hero',
      '{T}, Sacrifice an Equipment attached to Ronin: Target creature gets -4/-4 until end of turn.',
    )

    expect(soulrager.produces).not.toContain('creature-death')
    expect(ronin.produces).not.toContain('creature-death')
  })

  it('does not fire on a lowercase noun', () => {
    /*
     * The capital is the entire distinction, and this is what pays for the
     * missing `i` flag.
     *
     * Read case-insensitively, "Sacrifice an artifact" matches — the deny list
     * has no `artifact` in it and never should, because the rules above already
     * own "sacrifice a creature" and mean something else by it. Krark-Clan
     * Ironworks would become a sacrifice outlet for creatures it cannot eat.
     */
    const ironworks = derive(
      'Krark-Clan Ironworks',
      'Artifact',
      'Sacrifice an artifact: Add {C}{C}.',
    )

    expect(ironworks.produces).not.toContain('creature-death')
    expect(ironworks.produces).toContain('artifact-etb')
  })

  it('does not claim a tribal outlet wants generic fodder', () => {
    // `sacrifice-fodder` is produced by "create … creature token", and a
    // generic token maker does not make Clerics. The outlet produces the death
    // and asks for nothing, which is the same ruling the self-sacrifice rule
    // above gets.
    const archon = derive(
      'Cabal Archon',
      'Creature — Human Cleric',
      '{B}, Sacrifice a Cleric: Target player loses 2 life and you gain 2 life.',
    )

    expect(archon.produces).toContain('creature-death')
    expect(archon.wants).not.toContain('sacrifice-fodder')
  })

  it('reads BOTH of the reported card’s clauses, and neither as fodder', () => {
    // This test used to end `toEqual(['creature-death'])` and say the land
    // clause was deferred, which was true when ADR-0038 shipped: a
    // `land-creature` tag was warranted on the numbers but is a new
    // `SynergyTag`, and R2 makes that ADR-first. ADR-0047 is that ADR.
    //
    // What has NOT changed is the refusal underneath it. Those bodies are the
    // player's mana base, so `token` and `sacrifice-fodder` would recommend a
    // sacrifice outlet to somebody whose fodder is their lands.
    const ambush = derive(
      'Ambush Commander',
      'Creature — Elf',
      'Forests you control are 1/1 green Elf creatures that are still lands.\n{1}{G}, Sacrifice an Elf: Target creature gets +3/+3 until end of turn.',
    )

    expect(ambush.produces).not.toContain('token')
    expect(ambush.produces).not.toContain('sacrifice-fodder')
    expect([...ambush.produces].sort()).toEqual(['creature-death', 'land-creature'])
  })
})

describe('the third direction reaches the deck and the card (ADR-0048)', () => {
  it('surfaces membership through deriveSynergy, not only through the token module', () => {
    // `deriveSynergy` is what the ingest and the repository call; a `has` that
    // stopped at `semantic-tokens.ts` would be a direction nothing could read.
    const elf = deriveSynergy({
      oracleId: oracleId('Llanowar Elves'),
      name: 'Llanowar Elves',
      typeLine: 'Creature — Elf Druid',
      oracleText: '{T}: Add {G}.',
      keywords: [],
    })

    expect(elf.has).toContain('subtype:elf')
    expect(elf.has).toContain('subtype:druid')
    // And it stays OUT of the event directions, which is the whole distinction.
    expect(elf.produces).not.toContain('subtype:elf')
  })

  it("accumulates a commander's membership onto the deck at commander weight", () => {
    // `deckSynergy` has three maps now, and the commander branch and the
    // accepted-card branch each fill all three. A deck whose commander is an
    // Elf is an Elf deck before a single Elf is added to it.
    const commander = oracleId('Ambush Commander')
    const accepted = oracleId('Llanowar Elves')
    const profiles = new Map<OracleId, SynergyProfile>([
      [commander, { produces: [], wants: [], has: ['subtype:elf'] }],
      [accepted, { produces: [], wants: [], has: ['subtype:elf'] }],
    ])

    const deck = deckSynergy([commander], [accepted], (id) => profiles.get(id))

    expect(deck.has.get('subtype:elf')).toBe(COMMANDER_WEIGHT + 1)
  })
})

describe('deriveSynergy — two gaps the commander sweep found (ADR-0048)', () => {
  const derive = (name: string, typeLine: string, oracleText: string): SynergyProfile =>
    deriveSynergy({ oracleId: oracleId(name), name, typeLine, oracleText, keywords: [] })

  it('reads TWO additional lands, not only one', () => {
    // Azusa, verbatim. The determiner was a closed list of one, so the commander
    // the landfall archetype is named after derived no landfall tag.
    expect(
      derive(
        'Azusa, Lost but Seeking',
        'Legendary Creature — Human Monk',
        'You may play two additional lands on each of your turns.',
      ).produces,
    ).toContain('landfall')
  })

  it('still reads the one-land form', () => {
    expect(
      derive(
        'Dryad of the Ilysian Grove',
        'Creature — Dryad',
        'You may play an additional land on each of your turns.',
      ).produces,
    ).toContain('landfall')
  })

  it('reads a token DOUBLER as making tokens', () => {
    // Doubling Season, verbatim. A replacement effect puts the verb after its
    // object and in the passive, so "create … token" could reach none of the
    // fifteen most-played token cards in the format.
    expect(
      derive(
        'Doubling Season',
        'Enchantment',
        'If one or more tokens would be created under your control, twice that many of those tokens are created instead.',
      ).produces,
    ).toContain('token')
  })

  it('reads the doubler as a producer, not a payoff', () => {
    // Direction. A doubler makes tokens out of other tokens, which is still
    // making them; calling it a payoff would invert the single most-played
    // enchantment in the archetype.
    expect(
      derive(
        'Anointed Procession',
        'Enchantment',
        'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.',
      ).wants,
    ).not.toContain('token')
  })
})

describe('deriveSynergy — milling an opponent (ADR-0048)', () => {
  const derive = (name: string, typeLine: string, oracleText: string): SynergyProfile =>
    deriveSynergy({ oracleId: oracleId(name), name, typeLine, oracleText, keywords: [] })

  it('reads making an opponent mill as its own event', () => {
    // Glimpse the Unthinkable's shape. 242 cards, and no rule could see any of
    // them: `graveyard-creature` reads self-mill only, deliberately.
    expect(
      derive('Whetwheel', 'Artifact', '{X}{X}, {T}: Target player mills X cards.').produces,
    ).toContain('opponent-mill')
  })

  it('does not read SELF-mill as milling an opponent', () => {
    // The distinction the tag exists for. ADR-0016 ruled that an opponent's
    // graveyard is not the resource, and this is that ruling made mechanical.
    const profile = derive(
      'Dig Up the Body',
      'Sorcery',
      'Mill two cards, then you may return a creature card from your graveyard to your hand.',
    )

    expect(profile.produces).not.toContain('opponent-mill')
    expect(profile.produces).toContain('graveyard-creature')
  })

  it('reads a symmetric mill as BOTH, because it is', () => {
    // The ruling ADR-0022 made about "each player discards", one verb over.
    const profile = derive(
      'The Binding of the Titans',
      'Enchantment — Saga',
      'I — Each player mills three cards.',
    )

    expect(profile.produces).toContain('opponent-mill')
    expect(profile.produces).toContain('graveyard-creature')
  })

  it('has payoffs, which is what ADR-0029 §6 measured as zero for the tag it refused', () => {
    // Zellix, verbatim. Ten cards in the corpus, which is thin and is not none.
    expect(
      derive(
        'Zellix, Sanity Flayer',
        'Legendary Creature — Horror',
        'Hive Mind — Whenever a player mills one or more creature cards, you create a 1/1 black Horror creature token.',
      ).wants,
    ).toContain('opponent-mill')
  })

  it("reads counting an OPPONENT'S graveyard as a payoff", () => {
    expect(
      derive(
        'Spoils of War',
        'Instant',
        "X is the number of artifact and/or creature cards in an opponent's graveyard as you cast this spell.",
      ).wants,
    ).toContain('opponent-mill')
  })

  it('does not read counting YOUR OWN graveyard as one', () => {
    // "For each card in your graveyard" is a self-mill payoff and belongs to
    // `graveyard-creature`. Same graveyard ruling, other direction.
    expect(
      derive('Ancestral Tribute', 'Sorcery', 'You gain 2 life for each card in your graveyard.')
        .wants,
    ).not.toContain('opponent-mill')
  })

  it('is reachable by the word a player types', () => {
    // `mill` is aliased to it in the search box, for the reason `burn` is
    // aliased to `damage`: the tag name carries the subject and the typed word
    // does not have to.
    expect(SYNERGY_TAGS).toContain('opponent-mill')
  })
})

describe('deriveSynergy — extra turns (ADR-0048)', () => {
  const derive = (name: string, typeLine: string, oracleText: string): SynergyProfile =>
    deriveSynergy({ oracleId: oracleId(name), name, typeLine, oracleText, keywords: [] })

  it('reads a card that takes an extra turn', () => {
    expect(
      derive('Time Warp', 'Sorcery', 'Target player takes an extra turn after this one.').produces,
    ).toContain('extra-turns')
  })

  it("uses the barometer's own rule, so the two cannot disagree", () => {
    // The three cards that DENY extra turns say "would BEGIN an extra turn",
    // never "takes" — which is the distinction `bracket-barometers.ts` found and
    // documented, and which this tag inherits by importing the regex instead of
    // writing a second one. Flagging Stranglehold for GRANTING extra turns
    // would be the reverse of the truth.
    expect(
      derive(
        'Stranglehold',
        'Enchantment',
        "Your opponents can't search libraries.\nIf an opponent would begin an extra turn, that player skips that turn instead.",
      ).produces,
    ).not.toContain('extra-turns')
  })

  it('reads Emrakul, which does not say "after this one"', () => {
    expect(
      derive(
        'Emrakul, the Promised End',
        'Legendary Creature — Eldrazi',
        "When you cast this spell, you gain control of target opponent during that player's next turn. After that turn, that player takes an extra turn.",
      ).produces,
    ).toContain('extra-turns')
  })

  it('pays nothing off, and the model says so rather than pretending', () => {
    // 53 producers and zero payoff cards in the corpus. `synergyMatches` needs a
    // `wants` on the other side, so this tag cannot score — it is vocabulary and
    // a label, the same standing the derived keyword families have. Asserted so
    // that the day a payoff card is printed, someone has to come and change this
    // test on purpose.
    const timeWarp = derive(
      'Time Warp',
      'Sorcery',
      'Target player takes an extra turn after this one.',
    )

    expect(timeWarp.wants).not.toContain('extra-turns')
    expect(interactsWith('extra-turns')).toContain('attack-trigger')
  })
})

describe('deriveSynergy — a land that is also a creature (ADR-0047)', () => {
  const derive = (name: string, typeLine: string, oracleText: string): SynergyProfile =>
    deriveSynergy({ oracleId: oracleId(name), name, typeLine, oracleText, keywords: [] })

  describe('the tag', () => {
    it('is in the vocabulary, and is the twenty-second', () => {
      expect(SYNERGY_TAGS).toContain('land-creature')
      expect(EVENT_TAGS).toHaveLength(27)
    })

    it('is spelled as an event rather than as the deck that plays it', () => {
      // "Manland" is what a player calls the deck; the tag names slot after
      // "causes" in the UI, so this one names what happens to the permanent.
      expect(SYNERGY_TAGS).not.toContain('manland')
    })
  })

  describe('what animates a land', () => {
    it('reads the reported card', () => {
      // Ambush Commander's second clause is now a sacrifice outlet (ADR-0038).
      // This is its first, which said nothing at all.
      const ambush = derive(
        'Ambush Commander',
        'Creature — Elf',
        'Forests you control are 1/1 green Elf creatures that are still lands.\n{1}{G}, Sacrifice an Elf: Target creature gets +3/+3 until end of turn.',
      )

      expect(ambush.produces).toContain('land-creature')
      expect(ambush.produces).toContain('creature-death')
    })

    it('reads the templating Magic actually uses', () => {
      /*
       * "It's still a land" is the sentence that marks an animation, and it is
       * the single biggest contributor: 37 cards reach the tag on it ALONE.
       *
       * Crawling Barrens rather than Awakener Druid, and the swap was forced by
       * a surviving mutation. The Druid reads "target Forest becomes a 4/5 …
       * It's still a land", so the rule below catches it too and deleting this
       * one broke nothing. A test that cannot fail for the reason it names is
       * not testing that reason.
       */
      const barrens = derive(
        'Crawling Barrens',
        'Land',
        "{4}: Put two +1/+1 counters on this land. Then you may have it become a 0/0 Elemental creature until end of turn. It's still a land.",
      )

      expect(barrens.produces).toContain('land-creature')
    })

    it('reads the whole-mana-base form', () => {
      const kamahl = derive(
        "Kamahl's Will",
        'Instant',
        '• Until end of turn, any number of target lands you control become 1/1 Elemental creatures with vigilance, indestructible, and haste. They’re still lands.',
      )

      expect(kamahl.produces).toContain('land-creature')
    })

    it('reads a land that animates itself', () => {
      // "It's still a CAVE land" is why this needs its own rule: the phrase
      // above wants "a land" with nothing in between.
      const maw = derive(
        'Cavernous Maw',
        'Land — Cave',
        "{T}: Add {C}.\n{2}: This land becomes a 3/3 Elemental creature until end of turn. It's still a Cave land.",
      )

      expect(maw.produces).toContain('land-creature')
    })

    it('reads a land named by its TYPE rather than by the word "land"', () => {
      // "Target Island you control becomes a 4/4" and "Target snow land becomes
      // a 2/2" are four cards that a `target land` anchor lost, and that only
      // survived because the "still a land" rule happened to also catch them.
      // Elvish Branchbender is reached by this rule and NO other, which is what
      // makes the assertion mean something: it says "Forest", never "land", and
      // never "still a land".
      const branchbender = derive(
        'Elvish Branchbender',
        'Creature — Elf Druid',
        '{T}: Until end of turn, target Forest becomes an X/X Treefolk creature in addition to its other types, where X is the number of Elves you control.',
      )

      expect(branchbender.produces).toContain('land-creature')
    })

    it('reads making a land creature outright', () => {
      const woods = derive(
        'Awaken the Woods',
        'Sorcery',
        'Create X 1/1 green Forest Dryad land creature tokens. (They’re affected by summoning sickness.)',
      )

      expect(woods.produces).toContain('land-creature')
    })

    it('reads the keyword by name', () => {
      // Earthbend and awaken both print reminder text, but three cards carry
      // the keyword with none.
      const ascension = derive(
        'Earthbender Ascension',
        'Enchantment',
        'At the beginning of combat on your turn, earthbend 2.',
      )

      expect(ascension.produces).toContain('land-creature')
    })

    it('does not read a land changing its TYPE as a land becoming a creature', () => {
      // The measured false positive. "Have target land become a Plains UNTIL
      // THIS CREATURE leaves the battlefield" puts the word "creature" within
      // reach of "becomes a", and a land that turns into a Plains is still not
      // a creature.
      const antelope = derive(
        'Graceful Antelope',
        'Creature — Antelope',
        'Whenever this creature deals combat damage to a player, you may have target land become a Plains until this creature leaves the battlefield.',
      )

      expect(antelope.produces).not.toContain('land-creature')
    })

    it('does not read an enchantment animating ITSELF as land animation', () => {
      // The other measured false positive: the word "land" is in the trigger
      // condition and the thing that becomes a creature is the enchantment.
      const herd = derive(
        'Hidden Herd',
        'Enchantment',
        'When an opponent plays a nonbasic land, if this permanent is an enchantment, it becomes a 3/3 Beast creature.',
      )

      expect(herd.produces).not.toContain('land-creature')
    })

    it('does not read the tag off a joined type line', () => {
      /*
       * A `^[^\n]*\bLand\b[^\n]*\bCreature\b` rule was written and REJECTED.
       *
       * It reaches three cards and is wrong about two: Scryfall gives one
       * JOINED type line per card, so "Land // Artifact Creature — Horror
       * Construct" (Hostile Hostel) and "Land // Legendary Creature — Demon"
       * (Westvale Abbey) read as land creatures when they are transforming
       * lands whose two halves never share a game state. Dryad Arbor is the
       * only true one, and one card is not worth two wrong ones — the module
       * comment on `deriveSynergy` says why the decomposition is not available.
       */
      const arbor = derive(
        'Dryad Arbor',
        'Land Creature — Forest Dryad',
        '(This land isn\'t a spell, it\'s affected by summoning sickness, and it has "{T}: Add {G}.")',
      )

      expect(arbor.produces).not.toContain('land-creature')
    })
  })

  describe('what pays a land creature off', () => {
    it('reads the anthem that only reaches lands', () => {
      const advocate = derive(
        'Sylvan Advocate',
        'Creature — Elf Druid Ally',
        'Vigilance\nAs long as you control six or more lands, this creature and land creatures you control get +2/+2.',
      )

      expect(advocate.wants).toContain('land-creature')
    })

    it('reads a condition that checks for one', () => {
      const wrestlers = derive(
        'Earth Rumble Wrestlers',
        'Creature — Human Warrior Performer',
        'Reach\nThis creature gets +1/+0 and has trample as long as you control a land creature or a land entered the battlefield under your control this turn.',
      )

      expect(wrestlers.wants).toContain('land-creature')
    })

    it('does not read removal aimed at land creatures as wanting them', () => {
      // "Exile target land creature" is the opposite card. The payoff rules ask
      // for "land creatures YOU CONTROL", which is what keeps it out.
      const sinkhole = derive(
        'Consuming Sinkhole',
        'Instant',
        'Choose one —\n• Exile target land creature.\n• Consuming Sinkhole deals 4 damage to target player or planeswalker.',
      )

      expect(sinkhole.wants).not.toContain('land-creature')
    })
  })

  describe('what it feeds, and is fed by', () => {
    it('pairs with landfall, attacking and +1/+1 counters', () => {
      expect(interactsWith('land-creature')).toEqual(
        expect.arrayContaining(['landfall', 'attack-trigger', 'plus1-counter']),
      )
    })

    it('does not pair with making tokens or with expendable bodies', () => {
      // The refusal this tag exists to make. An animated land is a body, and
      // calling it fodder would offer a sacrifice outlet to a player whose
      // fodder is their mana base.
      expect(interactsWith('land-creature')).not.toContain('token')
      expect(interactsWith('land-creature')).not.toContain('sacrifice-fodder')
    })
  })
})

describe('synergyMatches — which half of a lord is the informative half (ADR-0054)', () => {
  /*
   * An Elf lord in an Elf deck was always "enables", never "payoff".
   *
   * `synergyMatches` pushed the `enables` loop before the `payoff` loop and
   * then sorted by weight alone; `Array.prototype.sort` is stable, so an exact
   * tie kept the first-pushed. `recommend` emits exactly one reason
   * (`topEmphasis ?? s.synergy[0]`), so every lord showed the weaker half.
   * Measured on a real Elf deck: all 42 Elf-typed candidates read "enables
   * your emphasised subtype:elf" and all 12 payoff reasons went to non-Elf
   * cards. Joraga Warcaller was described as another body rather than as the
   * lord it is.
   *
   * The tie is exact by construction rather than by accident: a commander who
   * IS an Elf and WANTS Elves contributes `COMMANDER_WEIGHT` to `has` and the
   * same to `wants`, so `deck.wants` and `deck.has` agree on the tag.
   */
  const ELF_DECK: DeckSynergy = {
    produces: new Map(),
    wants: new Map<SynergyTag, number>([['subtype:elf', COMMANDER_WEIGHT]]),
    has: new Map<SynergyTag, number>([['subtype:elf', COMMANDER_WEIGHT]]),
  }

  it('calls a lord a payoff rather than another body', () => {
    const lord: SynergyProfile = {
      produces: [],
      wants: ['subtype:elf'],
      has: ['subtype:elf'],
    }
    const [first] = synergyMatches(lord, ELF_DECK)

    expect(first).toEqual({ tag: 'subtype:elf', direction: 'payoff', weight: COMMANDER_WEIGHT })
  })

  it('still credits both halves, because the score counts both', () => {
    const lord: SynergyProfile = { produces: [], wants: ['subtype:elf'], has: ['subtype:elf'] }
    const matches = synergyMatches(lord, ELF_DECK)

    expect(matches.map((m) => m.direction).sort()).toEqual(['enables', 'payoff'])
  })

  it('leaves a plain body alone — it has only the one reading', () => {
    const body: SynergyProfile = { produces: [], wants: [], has: ['subtype:elf'] }
    const [first] = synergyMatches(body, ELF_DECK)

    expect(first?.direction).toBe('enables')
  })

  it('never lets the tie-break beat a real weight difference', () => {
    // The weights already say which side the deck needs more of. A deck that
    // wants a tag far more than it supplies it must still hear "enables".
    const deck: DeckSynergy = {
      produces: new Map(),
      wants: new Map<SynergyTag, number>([['untap', 9]]),
      has: new Map<SynergyTag, number>([['untap', 1]]),
    }
    const engine: SynergyProfile = { produces: ['untap'], wants: ['untap'], has: [] }
    const [first] = synergyMatches(engine, deck)

    expect(first).toEqual({ tag: 'untap', direction: 'enables', weight: 9 })
  })

  it('does not let a payoff on one tag displace an enable on another', () => {
    /*
     * The restriction, and it is measured rather than cautious. A global
     * direction tie-break moved 87 rows across four real decks instead of 48;
     * the extra 39 were cross-tag, and they read worse — a sac outlet in a
     * Meren deck lost "enables your creature-death" to "pays off your Humans".
     * Two readings of ONE tag are two ways of saying one thing and one of them
     * is more informative. Two different tags are two different claims.
     */
    const deck: DeckSynergy = {
      produces: new Map<SynergyTag, number>([['subtype:human', 4]]),
      wants: new Map<SynergyTag, number>([['creature-death', 4]]),
      has: new Map(),
    }
    const outlet: SynergyProfile = {
      produces: ['creature-death'],
      wants: ['subtype:human'],
      has: [],
    }
    const [first] = synergyMatches(outlet, deck)

    expect(first).toEqual({ tag: 'creature-death', direction: 'enables', weight: 4 })
  })

  it('keeps theme last on a tie, because it is the weakest reading', () => {
    const deck: DeckSynergy = {
      produces: new Map<SynergyTag, number>([['token', 5]]),
      wants: new Map<SynergyTag, number>([['landfall', 25]]),
      has: new Map(),
    }
    // `token` pays off at 5; `landfall` is a shared want at 25 * 0.2 = 5.
    const card: SynergyProfile = { produces: [], wants: ['token', 'landfall'], has: [] }
    const matches = synergyMatches(card, deck)

    expect(matches.map((m) => m.weight)).toEqual([5, 5])
    expect(matches.map((m) => m.direction)).toEqual(['payoff', 'theme'])
  })
})

describe('deriveSynergy — whose tokens they are (ADR-0054)', () => {
  const derive = (name: string, typeLine: string, oracleText: string): SynergyProfile =>
    deriveSynergy({ oracleId: oracleId(name), name, typeLine, oracleText, keywords: [] })

  // The reported card. A land that hands a Spirit to somebody else.
  const FORBIDDEN_ORCHARD = derive(
    'Forbidden Orchard',
    'Land',
    '{T}: Add {C}.\n{T}: Add one mana of any color. Whenever you tap this land for mana, target opponent creates a 1/1 colorless Spirit creature token.',
  )
  const HUNTED_HORROR = derive(
    'Hunted Horror',
    'Creature — Horror',
    'Trample\nWhen this creature enters, target opponent creates two 3/3 green Centaur creature tokens.',
  )
  const CHATTER_OF_THE_SQUIRREL = derive(
    'Chatter of the Squirrel',
    'Sorcery',
    'Create a 1/1 green Squirrel creature token.\nFlashback {2}{G}',
  )

  it('refuses `token` when the card names an opponent as the creator', () => {
    expect(FORBIDDEN_ORCHARD.produces).not.toContain('token')
    expect(HUNTED_HORROR.produces).not.toContain('token')
  })

  it('refuses `sacrifice-fodder`, which is the claim that hurt most', () => {
    // An aristocrats deck reads `sacrifice-fodder` as bodies it may eat. These
    // bodies belong to the player across the table.
    expect(FORBIDDEN_ORCHARD.produces).not.toContain('sacrifice-fodder')
    expect(HUNTED_HORROR.produces).not.toContain('sacrifice-fodder')
  })

  it('still reads the imperative, which is addressed to you', () => {
    expect(CHATTER_OF_THE_SQUIRREL.produces).toContain('token')
    expect(CHATTER_OF_THE_SQUIRREL.produces).toContain('sacrifice-fodder')
  })

  it('keeps a symmetric clause, because you get one too', () => {
    // ADR-0022's ruling about "each player discards", one verb over: claiming
    // one side and not the other would be false whichever side you picked.
    const alliance = derive(
      'Alliance of Arms',
      'Sorcery',
      'Each player may pay any amount of mana. Each player creates X 1/1 white Soldier creature tokens, where X is the total amount of mana that player paid this way.',
    )

    expect(alliance.produces).toContain('token')
  })

  it('reads the clause and not the card', () => {
    // A card that makes its own tokens AND donates one is still a token maker.
    const both = derive(
      'Split Decision',
      'Sorcery',
      'Create a 1/1 white Soldier creature token. Target opponent creates a 1/1 green Hippo creature token.',
    )

    expect(both.produces).toContain('token')
  })

  it('does not read the donated body as something the deck WANTS either', () => {
    // The direction inversion is the worse error (ADR-0016): a card that gives
    // Centaurs away must not be offered to a Centaur deck as a payoff.
    expect(HUNTED_HORROR.wants).not.toContain('subtype:centaur')
  })

  it('refuses the derived families the clause used to hand over', () => {
    // ADR-0048's subtype and keyword tags multiply the same defect: Hunted
    // Troll made the opponent four Faeries with flying and claimed both.
    const troll = derive(
      'Hunted Troll',
      'Creature — Troll',
      'When this creature enters, target opponent creates four 1/1 blue Faerie creature tokens with flying.',
    )

    expect(troll.produces).not.toContain('subtype:faerie')
    expect(troll.produces).not.toContain('ability:flying')
  })

  it('reads an opponent in the OBJECT position as the attack target, not the creator', () => {
    // Found by diffing the corpus. "Whenever a player attacks one of your
    // opponents, that attacking player creates…" — the attacker is usually
    // you, and the Inklings are why the card is played. Three cards say this
    // (Combat Calligrapher, Ellie, Jolene) and a bare "opponent" in the window
    // lost all three.
    const calligrapher = derive(
      'Combat Calligrapher',
      'Creature — Bird Cleric',
      "Flying\nInklings can't attack you or planeswalkers you control.\nWhenever a player attacks one of your opponents, that attacking player creates a tapped 2/1 white and black Inkling creature token with flying that's attacking that opponent.",
    )

    // Not `token`: that rule's window is forty characters and this token's
    // description is forty-five, which is a pre-existing gap and not this
    // change. `sacrifice-fodder` and the subtype are the two it does reach.
    expect(calligrapher.produces).toContain('sacrifice-fodder')
    expect(calligrapher.produces).toContain('subtype:inkling')
  })

  it('leaves the removal shell alone, which is measured rather than assumed', () => {
    // "Its controller creates" was tried and refused: 54 further cards, of
    // which at least 14 hand the token to YOU — a symmetric wipe's controller
    // is also you, and Descent of the Dragons is pointed at your own board on
    // purpose. ADR-0022 refused "its controller sacrifices" for this reason.
    const beastWithin = derive(
      'Beast Within',
      'Instant',
      'Destroy target permanent. Its controller creates a 3/3 green Beast creature token.',
    )
    const marchOfSouls = derive(
      'March of Souls',
      'Sorcery',
      "Destroy all creatures. They can't be regenerated. For each creature destroyed this way, its controller creates a 1/1 white Spirit creature token with flying.",
    )

    expect(beastWithin.produces).toContain('token')
    expect(marchOfSouls.produces).toContain('token')
  })
})

describe('a ritual is not a mana rock (ADR-0054)', () => {
  const derive = (name: string, typeLine: string, oracleText: string): SynergyProfile =>
    deriveSynergy({ oracleId: oracleId(name), name, typeLine, oracleText, keywords: [] })

  /*
   * "add mana needs to be a semantic. if I want more cards like dark ritual, I
   * need a semantic to focus".
   *
   * `ramp` already exists as a ROLE, and the two vocabularies answer different
   * questions. A role is a partition for counting — one per card — so `ramp`
   * holds Sol Ring, Cultivate, Llanowar Elves and Dark Ritual in one bucket of
   * 1,385, and there is no way to say "this deck is about rituals": `emphasis`
   * reads tags, never roles. What the role also cannot say is the distinction
   * that makes a ritual a ritual — mana you get ONCE against mana you get every
   * turn.
   *
   * A broad `mana` tag was measured and refused: 2,402 commander-legal cards
   * add mana and 1,141 of them are lands, so half of what such a tag would
   * carry is the mana base the user explicitly did not want tagged.
   */
  it('reads the named case and its neighbours', () => {
    expect(derive('Dark Ritual', 'Instant', 'Add {B}{B}{B}.').produces).toContain('ritual')
    expect(derive('Seething Song', 'Instant', 'Add {R}{R}{R}{R}{R}.').produces).toContain('ritual')
    expect(derive('Pyretic Ritual', 'Instant', 'Add {R}{R}{R}.').produces).toContain('ritual')
  })

  it('reads a permanent that eats itself for a lump of mana', () => {
    expect(
      derive(
        'Lion Eye Diamond',
        'Artifact',
        '{T}, Discard your hand, Sacrifice this artifact: Add three mana of any one color.',
      ).produces,
    ).toContain('ritual')
    expect(
      derive('Basal Thrull', 'Creature — Thrull', 'Sacrifice this creature: Add {B}{B}.').produces,
    ).toContain('ritual')
  })

  it('refuses a land, a rock and a dork — mana that comes back every turn', () => {
    expect(derive('Forest', 'Basic Land — Forest', '({T}: Add {G}.)').produces).not.toContain(
      'ritual',
    )
    expect(derive('Sol Ring', 'Artifact', '{T}: Add {C}{C}.').produces).not.toContain('ritual')
    expect(
      derive('Llanowar Elves', 'Creature — Elf Druid', '{T}: Add {G}.').produces,
    ).not.toContain('ritual')
  })

  it('refuses a single mana, however it is spent', () => {
    expect(
      derive('Lotus Petal', 'Artifact', 'Sacrifice this artifact: Add one mana of any color.')
        .produces,
    ).not.toContain('ritual')
  })

  it('is paid off by the deck that casts three spells in a turn', () => {
    const storm = derive(
      'Grapeshot',
      'Sorcery',
      'Grapeshot deals 1 damage to any target.\nStorm (When you cast this spell, copy it for each spell cast before it this turn.)',
    )
    const second = derive(
      'Kraum, Violent Cacophony',
      'Legendary Creature — Zombie Horror',
      'Flying, haste\nWhenever you cast your second spell each turn, draw a card.',
    )

    expect(storm.wants).toContain('ritual')
    expect(second.wants).toContain('ritual')
  })

  it('feeds the spellslinger deck, and says so in the pair table', () => {
    // A ritual is how a storm deck casts its next spell, and a deck full of
    // spells is what makes a ritual worth a card. True read either way, which
    // is the bar that table sets.
    expect(interactsWith('ritual')).toContain('spell-cast')
  })
})

describe('casting a CREATURE is not casting a spell (ADR-0054)', () => {
  const derive = (name: string, typeLine: string, oracleText: string): SynergyProfile =>
    deriveSynergy({ oracleId: oracleId(name), name, typeLine, oracleText, keywords: [] })

  /*
   * "beast whisperer needs to have a semantic about benefiting from casting
   * creature spells."
   *
   * It carried none. `spell-cast` is defined as an instant or a sorcery, so
   * "whenever you cast a creature spell" matched nothing at all and Beast
   * Whisperer's only tag was `card-draw`. 74 commander-legal cards read this
   * way and 3 of them carried any cast tag.
   *
   * PAYOFF-ONLY, and the producer side is measured and refused. "A creature
   * card IS a creature spell" would put the tag on 17,751 of the 31,782
   * commander-legal cards — 55.9%, against 33.6% for the widest tag any real
   * pool carries today — and would attach "enables your creature-cast" to
   * every creature in the deck's colours, which is true of all of them and
   * therefore says nothing about any of them. What that sentence would have
   * said is already said better by the `type:creature` composition target and
   * the `fills-creature` group.
   *
   * That leaves it standing exactly where `extra-turns` stands (ADR-0048):
   * vocabulary and a label rather than a score, said out loud rather than left
   * to be discovered.
   */
  it('reads the reported card', () => {
    const whisperer = derive(
      'Beast Whisperer',
      'Creature — Elf Druid',
      'Whenever you cast a creature spell, draw a card.',
    )

    expect(whisperer.wants).toContain('creature-cast')
  })

  it('reads the cost-reduction form', () => {
    expect(
      derive('Monument', 'Legendary Artifact', 'Creature spells you cast cost {1} less to cast.')
        .wants,
    ).toContain('creature-cast')
  })

  it('does not put it on every creature', () => {
    const bear = derive('Grizzly Bears', 'Creature — Bear', '')
    expect(bear.produces).not.toContain('creature-cast')
    expect(bear.wants).not.toContain('creature-cast')
    expect(bear.has ?? []).not.toContain('creature-cast')
  })

  it('does not confuse it with a creature ENTERING', () => {
    // Young Pyromancer's tokens do not trigger Beast Whisperer, and offering
    // one to the other as an enabler would be a false claim.
    const pyromancer = derive(
      'Young Pyromancer',
      'Creature — Human Shaman',
      'Whenever you cast an instant or sorcery spell, create a 1/1 red Elemental creature token.',
    )

    expect(pyromancer.wants).not.toContain('creature-cast')
    expect(pyromancer.produces).not.toContain('creature-cast')
  })
})

describe('the cast payoffs that reached no tag at all (ADR-0054)', () => {
  const derive = (name: string, typeLine: string, oracleText: string): SynergyProfile =>
    deriveSynergy({ oracleId: oracleId(name), name, typeLine, oracleText, keywords: [] })

  it('reads "whenever you cast an artifact spell" as an artifact deck', () => {
    /*
     * 31 cards, 2 of which carried any cast or enters tag. NOT a new tag:
     * `artifact-etb` already exists, already means "this deck is about
     * artifacts", and already has 3,568 producers. The enchantment twin needed
     * nothing — 21 of its 22 cards were already covered — which is what makes
     * this a gap in one rule rather than a missing distinction.
     */
    const automaton = derive(
      'Patchwork Automaton',
      'Artifact Creature — Construct',
      'Whenever you cast an artifact spell, put a +1/+1 counter on this creature.',
    )

    expect(automaton.wants).toContain('artifact-etb')
  })

  it('reads "your second spell each turn" as the spellslinger payoff it is', () => {
    // 59 cards, 3 covered. The same event `spell-cast` already means — any
    // spell, not a type — so it belongs in that rule rather than in a new one.
    const lotho = derive(
      'Lotho, Corrupt Shirriff',
      'Legendary Creature — Halfling Rogue',
      'Whenever a player casts their second spell each turn, create a Treasure token.',
    )

    expect(lotho.wants).toContain('spell-cast')
  })
})

describe('a ritual is not the mana base (ADR-0054)', () => {
  const derive = (name: string, typeLine: string, oracleText: string): SynergyProfile =>
    deriveSynergy({ oracleId: oracleId(name), name, typeLine, oracleText, keywords: [] })

  it('refuses a land that eats itself for two mana', () => {
    /*
     * "a land tapping for mana is almost certainly not what they want tagged".
     * The sacrifice lands read exactly like rituals and are still the mana
     * base: Ebon Stronghold, Dwarven Ruins, Lake of the Dead, Phyrexian Tower,
     * Crystal Vein — 14 cards, found by diffing the corpus.
     */
    expect(
      derive(
        'Ebon Stronghold',
        'Land',
        'This land enters tapped.\n{T}: Add {B}.\n{T}, Sacrifice this land: Add {B}{B}.',
      ).produces,
    ).not.toContain('ritual')
    expect(
      derive('Phyrexian Tower', 'Land', '{T}: Add {C}.\n{T}, Sacrifice a creature: Add {B}{B}.')
        .produces,
    ).not.toContain('ritual')
  })

  it('still reads a non-land that eats itself', () => {
    // The guard has to be about the type line and nothing else.
    expect(
      derive('Blood Vassal', 'Creature — Thrull', 'Sacrifice this creature: Add {B}{B}.').produces,
    ).toContain('ritual')
  })
})

/**
 * A window measured from the wrong anchor (ADR-0059).
 *
 * Two rules read the same clause and differ by nine characters:
 *
 *   token            `${CREATES_FOR_YOU} .{0,40}\btoken`
 *   sacrifice-fodder `${CREATES_FOR_YOU} .{0,40}\bcreature token`
 *
 * `creature token` STARTS nine characters earlier than the bare word `token`,
 * so inside a window of the same size the NARROWER rule is the easier one to
 * match. Any token whose description runs 32 to 40 characters got
 * `sacrifice-fodder` and lost `token` — 277 commander-legal cards — and the
 * card that reported it says `primary_role: token-maker` on the same row as
 * tags claiming it makes no tokens.
 *
 * The fix is the anchor, not the number: both windows now end at the word
 * `token`, and the difference between the rules is a zero-width lookbehind
 * rather than a longer noun phrase. That makes the containment STRUCTURAL —
 * fodder cannot match where token does not — which is what the property test
 * below pins, because a number chosen by measurement can be un-chosen and an
 * invariant cannot.
 */
describe('a token description is measured to the word `token` (ADR-0059)', () => {
  const derive = (name: string, typeLine: string, oracleText: string): SynergyProfile =>
    deriveSynergy({ oracleId: oracleId(name), name, typeLine, oracleText, keywords: [] })

  // The reported card. Its description runs 38 characters from `create` to the
  // word `token`, which is inside the old fodder window and outside the old
  // token window.
  const AVIATION_PIONEER = derive(
    'Aviation Pioneer',
    'Creature — Human Artificer',
    'When this creature enters, create a 1/1 colorless Thopter artifact creature token with flying.',
  )
  // The card the playtest watched it happen to, in a token deck, on screen.
  const FOUNDRY = derive(
    'Foundry of the Consuls',
    'Land',
    '{T}: Add {C}.\n{5}, {T}, Sacrifice this land: Create two 1/1 colorless Thopter artifact creature tokens with flying.',
  )

  it('reads the token a long description describes', () => {
    expect(AVIATION_PIONEER.produces).toContain('token')
    expect(FOUNDRY.produces).toContain('token')
  })

  it('still reads the fodder it always read', () => {
    expect(AVIATION_PIONEER.produces).toContain('sacrifice-fodder')
    expect(FOUNDRY.produces).toContain('sacrifice-fodder')
  })

  it('reads an artifact creature token as an artifact entering', () => {
    // The same anchor defect one adjective over: the rule wanted `artifact
    // token` adjacent and the game writes `Thopter ARTIFACT CREATURE token`.
    // 133 commander-legal cards, and a Thopter is an artifact entering the
    // battlefield whatever else it is.
    expect(AVIATION_PIONEER.produces).toContain('artifact-etb')
    expect(FOUNDRY.produces).toContain('artifact-etb')
  })

  it('never claims the fodder without claiming the token', () => {
    /*
     * The invariant, over every description length the window can hold. This is
     * the test the numbers cannot drift past: `sacrifice-fodder` is `token`
     * plus a condition, so a card carrying the first and not the second is a
     * contradiction rather than a missing card.
     */
    for (let length = 0; length <= 80; length += 1) {
      const filler = 'x'.repeat(length)
      const profile = derive(
        'Filler',
        'Sorcery',
        `Create a ${filler} 1/1 white Soldier creature token.`,
      )
      if (profile.produces.includes('sacrifice-fodder')) {
        expect(profile.produces).toContain('token')
      }
    }
  })

  it('keeps the subject test the window sits in front of', () => {
    // Widening the window must not widen whose tokens they are (ADR-0054).
    const hunted = derive(
      'Hunted Horror',
      'Creature — Horror',
      'Trample\nWhen this creature enters, target opponent creates two 3/3 green Centaur creature tokens.',
    )

    expect(hunted.produces).not.toContain('token')
    expect(hunted.produces).not.toContain('sacrifice-fodder')
  })
})

/**
 * The same defect on the trigger side: a window sized for a short subject
 * (ADR-0059).
 *
 * `whenever .{0,40}\bdies\b` reaches 308 of the 430 commander-legal cards that
 * carry a "whenever … dies" trigger. Blood Artist's subject is 33 characters
 * and matches; Zulaport Cutthroat's is the same sentence plus "you control",
 * runs to 46, and matched nothing at all — so the two halves of one aristocrats
 * deck disagreed about whether deaths were worth anything.
 *
 * 80 is where the measurement stops paying: it reaches 423 of the 430, every
 * one of the cards it adds is a real death trigger, and the first match at 90
 * is Rivaz of the Claw, where the words in the window are no longer a subject
 * at all.
 */
describe('a trigger subject is longer than forty characters (ADR-0059)', () => {
  const derive = (name: string, typeLine: string, oracleText: string): SynergyProfile =>
    deriveSynergy({ oracleId: oracleId(name), name, typeLine, oracleText, keywords: [] })

  it('reads the aristocrats drain that was reachable by nothing', () => {
    const zulaport = derive(
      'Zulaport Cutthroat',
      'Creature — Human Rogue Ally',
      'Whenever this creature or another creature you control dies, each opponent loses 1 life and you gain 1 life.',
    )
    const butcher = derive(
      'Butcher of Malakir',
      'Creature — Vampire Warrior',
      'Flying\nWhenever this creature or another creature you control dies, each opponent sacrifices a creature of their choice.',
    )
    const celebrant = derive(
      'Cruel Celebrant',
      'Creature — Vampire Soldier',
      'Whenever this creature or another creature or planeswalker you control dies, each opponent loses 1 life and you gain 1 life.',
    )

    expect(zulaport.wants).toContain('creature-death')
    expect(butcher.wants).toContain('creature-death')
    expect(celebrant.wants).toContain('creature-death')
  })

  it('reads the attack triggers the thirty-character window could not', () => {
    // 69 cards, all the same shape: the subject is a qualified creature rather
    // than a name. Winota, Kindred Discovery, Nahiri, Hooded Blightfang.
    const winota = derive(
      'Winota, Joiner of Forces',
      'Legendary Creature — Human Soldier',
      'Whenever a non-Human creature you control attacks, look at the top six cards of your library.',
    )
    const blightfang = derive(
      'Hooded Blightfang',
      'Creature — Snake',
      'Deathtouch\nWhenever a creature you control with deathtouch attacks, each opponent loses 1 life and you gain 1 life.',
    )

    expect(winota.wants).toContain('attack-trigger')
    expect(blightfang.wants).toContain('attack-trigger')
  })

  it('keeps the subject whose own name carries a full stop', () => {
    /*
     * Why the attack rule's gap stays `.` where the death rule's became
     * `[^.\n]`. The sentence boundary costs exactly one card in the corpus and
     * it is this one — the honorific trap `creature-etb` documents on "J. Jonah
     * Jameson" and "Ms. Marvel" — and it buys nothing measurable at sixty
     * characters. `.` is already bounded by the face, which is the guarantee
     * that mattered.
     */
    const foxglove = derive(
      'Mr. Foxglove',
      'Legendary Creature — Fox Noble',
      "Lifelink\nWhenever Mr. Foxglove attacks, draw cards equal to the number of cards in defending player's hand minus the number of cards in your hand.",
    )

    expect(foxglove.wants).toContain('attack-trigger')
  })

  it('does not let the wider window leave the sentence it started in', () => {
    /*
     * The window was `.{0,40}`, which crosses a full stop. Widening a gap that
     * can leave its own sentence is how a trigger condition finds its verb in
     * the next ability — so the gap became `[^.\n]`, which is this file's own
     * instrument. Measured to cost nothing at eighty characters, and pinned
     * here so a later widening cannot quietly restore it.
     */
    const unrelated = derive(
      'Unrelated Clauses',
      'Enchantment',
      'Whenever you cast a spell, draw a card. Something in the next sentence dies.',
    )

    expect(unrelated.wants).not.toContain('creature-death')
  })
})

/**
 * "Its controller" is two different people (ADR-0059).
 *
 * ADR-0022 gave the model a subject and ADR-0054 gave the token family one.
 * Four more families never got the question, and the phrase they all lose it to
 * is the same: `lifegain`, `landfall`, `card-draw` and the `sacrifice-fodder`
 * WANT all read a verb whose subject was somebody across the table.
 *
 * The reported case is the sharpest. Swords to Plowshares — "Exile target
 * creature. ITS CONTROLLER gains life equal to its power" — ranked #1 in
 * Staples for a Heliod deck, whose reason read "enables your emphasised gaining
 * life". Heliod triggers on YOU gaining life. The card never triggers him.
 *
 * The test lives beside the other subject tests and the refusal itself lives in
 * `token-subject.ts`, which is now the one place the question is decided —
 * ADR-0054 put it there because four rule tables had made the mistake
 * independently, and this is the fifth through eighth.
 */
describe('deriveSynergy — whose life, whose card, whose land (ADR-0059)', () => {
  const derive = (name: string, typeLine: string, oracleText: string): SynergyProfile =>
    deriveSynergy({ oracleId: oracleId(name), name, typeLine, oracleText, keywords: [] })

  const SWORDS = derive(
    'Swords to Plowshares',
    'Instant',
    "Exile target creature. Its controller gains life equal to its power.",
  )
  const PATH = derive(
    'Path to Exile',
    'Instant',
    'Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
  )

  it('refuses the life the card gives away', () => {
    // 24 cards, every one read by hand: Swords, Path, Illumination, Nature's
    // Claim, Condemn, Oust, Last Breath, Lay Down Arms, the Phelddagrifs.
    expect(SWORDS.produces).not.toContain('lifegain')
    expect(derive('Illumination', 'Instant', 'Counter target artifact or enchantment spell. Its controller gains life equal to its mana value.').produces).not.toContain('lifegain')
    expect(derive("Nature's Claim", 'Instant', 'Destroy target artifact or enchantment. Its controller gains 4 life.').produces).not.toContain('lifegain')
  })

  it('refuses the land the opponent fetches', () => {
    expect(PATH.produces).not.toContain('landfall')
    expect(derive('Ghost Quarter', 'Land', '{T}: Add {C}.\n{T}, Sacrifice this land: Destroy target land. Its controller may search their library for a basic land card, put it onto the battlefield, then shuffle.').produces).not.toContain('landfall')
  })

  it('refuses the card the opponent draws', () => {
    expect(derive('Bargain', 'Sorcery', 'Target opponent draws a card.\nYou gain 7 life.').produces).not.toContain('card-draw')
    expect(derive('Master of the Feast', 'Creature — Demon', 'Flying\nAt the beginning of your upkeep, each opponent draws a card.').produces).not.toContain('card-draw')
    expect(derive('Introduction to Annihilation', 'Sorcery', 'Exile target nonland permanent. Its controller draws a card.').produces).not.toContain('card-draw')
  })

  it('still reads the same phrase when the antecedent is yours', () => {
    /*
     * The half the refusal must NOT take, and the reason the antecedent test is
     * `target` rather than a list of removal verbs. In a trigger the "it" is a
     * permanent that fired an ability, which in your own deck is yours — and
     * Edric is played precisely because YOU draw.
     */
    const sliver = derive(
      'Essence Sliver',
      'Creature — Sliver',
      'Whenever a Sliver deals damage, its controller gains that much life.',
    )
    const edric = derive(
      'Edric, Spymaster of Trest',
      'Legendary Creature — Elf Rogue',
      'Whenever a creature deals combat damage to one of your opponents, its controller may draw a card.',
    )

    expect(sliver.produces).toContain('lifegain')
    expect(edric.produces).toContain('card-draw')
  })

  it('leaves a symmetric clause alone, because you get one too', () => {
    /*
     * ADR-0022's ruling about "each player discards", in a pronoun. "That
     * player" refers back to "each player" and therefore includes you, so the
     * pronoun is only refused when its own sentence names an opponent. Nine
     * cards turn on this, and Horn of Greed is the clearest: it is a card you
     * play to draw off your own lands.
     */
    const horn = derive(
      'Horn of Greed',
      'Artifact',
      'Whenever a player plays a land, that player draws a card.',
    )
    const ashes = derive(
      'From the Ashes',
      'Sorcery',
      'Destroy all nonbasic lands. For each land destroyed this way, its controller may search their library for a basic land card and put it onto the battlefield.',
    )

    expect(horn.produces).toContain('card-draw')
    // A wipe names no target, so the antecedent test refuses it for free —
    // which is why `target` was chosen over a list of removal verbs.
    expect(ashes.produces).toContain('landfall')
  })

  it('still refuses the pronoun when its own sentence names an opponent', () => {
    const fruition = derive(
      'Forced Fruition',
      'Enchantment',
      'Whenever an opponent casts a spell, that player draws seven cards.',
    )

    expect(fruition.produces).not.toContain('card-draw')
  })

  it('reads the clause and not the card', () => {
    // Armistice draws YOU a card in the same sentence that gives an opponent
    // life. The refusal has to take one and leave the other.
    const armistice = derive(
      'Armistice',
      'Enchantment',
      '{3}{W}{W}: You draw a card and target opponent gains 3 life.',
    )

    expect(armistice.produces).toContain('card-draw')
    expect(armistice.produces).not.toContain('lifegain')
  })

  it('does not read an edict as a payoff for your own tokens', () => {
    /*
     * The WANT side of `sacrifice-fodder` had no subject test at all, so
     * Clackbridge Troll was offered to an aristocrats deck as "benefits from
     * your expendable bodies". Your bodies are the one thing that does not turn
     * it on: the Goats are the opponent's, and so is the choice.
     */
    const troll = derive(
      'Clackbridge Troll',
      'Creature — Troll',
      'Trample, haste\nWhen this creature enters, target opponent creates three 0/1 white Goat creature tokens.\nAt the beginning of combat on your turn, any opponent may sacrifice a creature of their choice. If a player does, tap this creature and you lose 3 life.',
    )
    const demon = derive(
      'Desecration Demon',
      'Creature — Demon',
      'Flying\nAt the beginning of each combat, any opponent may sacrifice a creature of their choice. If a player does, tap this creature and put a +1/+1 counter on it.',
    )

    // "Any PLAYER may sacrifice" is the same clause without the word opponent,
    // and it is why this rule takes `addressedToYou` rather than `forYou`.
    const gorgers = derive(
      'Brain Gorgers',
      'Creature — Zombie',
      'When you cast this spell, any player may sacrifice a creature of their choice. If a player does, counter Brain Gorgers.',
    )

    expect(troll.wants).not.toContain('sacrifice-fodder')
    expect(demon.wants).not.toContain('sacrifice-fodder')
    expect(gorgers.wants).not.toContain('sacrifice-fodder')
  })

  it('still reads a sacrifice outlet, which is the imperative addressed to you', () => {
    expect(deriveSynergy(ASHNODS_ALTAR).wants).toContain('sacrifice-fodder')
    const viscera = derive(
      'Viscera Seer',
      'Creature — Vampire Wizard',
      'Sacrifice a creature: Scry 1.',
    )

    expect(viscera.wants).toContain('sacrifice-fodder')
  })

  it('leaves the token family refused, which was re-measured and not assumed', () => {
    /*
     * ADR-0054 rejected "its controller creates" at ~74% precision and this
     * change does not rescue it. Restricting the phrase to a TARGETED
     * antecedent is what makes it safe for life, cards and lands; the cards
     * that broke it for tokens name a target too. Descent of the Dragons and
     * Saw in Half are pointed at your own board on purpose.
     */
    const sawInHalf = derive(
      'Saw in Half',
      'Instant',
      "Destroy target creature. If that creature dies this way, its controller creates two tokens that are copies of that creature, except they're 1/1.",
    )

    expect(sawInHalf.produces).toContain('token')
  })
})

/**
 * A land that taps for mana does not want untapping (ADR-0059).
 *
 * `{ tag: 'untap', test: /\{T\}:/ }` asked whether a permanent has a tap
 * ability at all, and 1,129 of the 1,247 commander-legal lands have one —
 * 94.5%. Every deck runs about thirty-six lands, so `untap` was the largest
 * single want in every deck in the product, and it was the mana base saying it.
 *
 * The playtest demonstrated it rather than inferring it: with nine Forests in a
 * green deck, every top-eight row in both the ramp and spot-removal groups was
 * chipped "shares your untapping theme" — Thornbite Staff, Lux Cannon, Crooked
 * Scales, Acorn Catapult. Remove the Forests and the chips vanish; re-add them
 * and they return. It buried green's real cards and hid two other changes.
 *
 * WHAT THE RULE IS FOR, measured before narrowing it. There are 324 producers
 * and they are Seedborn Muse, Wilderness Reclamation, Voltaic Key, Kiora and
 * Thornbite Staff, and what they are worth is a second activation of an ability
 * that DOES something. Two guards follow from that and no more:
 *
 *   1. The effect is not "Add". A land tapping for mana is the mana base, which
 *      is the line the user drew for `ritual` one tag over and the same line
 *      here. 1,129 lands become 442.
 *   2. The cost does not eat the permanent. "{T}, Sacrifice this land: Destroy
 *      target nonbasic land" is Wasteland, and untapping Wasteland is worth
 *      nothing, because it is not there. 442 lands become 294.
 *
 * The tag survives for the cards it was for: Krenko, Arcanis, Staff of
 * Domination, Thornbite Staff, Voltaic Key, Mikokoro, Deserted Temple, Arcane
 * Lighthouse, Slayers' Stronghold. 3,538 wanters become 2,518, and the share of
 * lands carrying it goes from 94.5% to 24.6% — the utility lands, which is what
 * an untap deck is actually built to abuse.
 *
 * THE COST IS STATED: Sol Ring, Gilded Lotus, Gaea's Cradle and every mana dork
 * lose the want, and untapping those is a real thing decks do. It is a thing
 * they do to make MANA, which `ramp` and `ritual` already name, and it is not
 * worth 94.5% of the mana base to say it here as well.
 */
describe('a land that taps for mana does not want untapping (ADR-0059)', () => {
  const derive = (name: string, typeLine: string, oracleText: string): SynergyProfile =>
    deriveSynergy({ oracleId: oracleId(name), name, typeLine, oracleText, keywords: [] })

  it('refuses the mana base, which was 94.5% of it', () => {
    expect(derive('Forest', 'Basic Land — Forest', '({T}: Add {G}.)').wants).not.toContain('untap')
    expect(derive('Sol Ring', 'Artifact', '{T}: Add {C}{C}.').wants).not.toContain('untap')
    expect(
      derive('Llanowar Elves', 'Creature — Elf Druid', '{T}: Add {G}.').wants,
    ).not.toContain('untap')
  })

  it('refuses an ability that eats the permanent it is on', () => {
    // Untapping Wasteland is worth nothing, because it is not there.
    const wasteland = derive(
      'Wasteland',
      'Land',
      '{T}: Add {C}.\n{T}, Sacrifice this land: Destroy target nonbasic land.',
    )

    expect(wasteland.wants).not.toContain('untap')
  })

  it('keeps the permanents the tag was for', () => {
    const krenko = derive(
      'Krenko, Mob Boss',
      'Legendary Creature — Goblin Warrior',
      '{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.',
    )
    const arcanis = derive(
      'Arcanis the Omnipotent',
      'Legendary Creature — Wizard',
      '{T}: Draw three cards.\n{2}{U}{U}: Return this creature to its owner’s hand.',
    )
    const key = derive('Voltaic Key', 'Artifact', '{1}, {T}: Untap target artifact.')

    expect(krenko.wants).toContain('untap')
    expect(arcanis.wants).toContain('untap')
    expect(key.wants).toContain('untap')
  })

  it('reads a tap ability whose cost is more than the tap', () => {
    /*
     * Found by the same narrowing, in the opposite direction. `/\{T\}:/`
     * required the tap to be the WHOLE cost, so 399 commander-legal cards whose
     * only tap ability is a compound one wanted nothing at all: Hell's
     * Caretaker, Cryptbreaker, Krovikan Sorcerer, Balloon Peddler. They are
     * exactly the abilities an untapper is played to use twice.
     */
    const caretaker = derive(
      "Hell's Caretaker",
      'Creature — Human Cleric',
      '{T}, Sacrifice a creature: Return target creature card from your graveyard to the battlefield. Activate only during your upkeep.',
    )

    expect(caretaker.wants).toContain('untap')
  })

  it('keeps a utility land, which is the quarter of the mana base that survives', () => {
    // The clause is the unit, not the card: these tap for mana AND do something.
    const mikokoro = derive(
      'Mikokoro, Center of the Sea',
      'Legendary Land',
      '{T}: Add {C}.\n{2}, {T}: Each player draws a card.',
    )
    const lighthouse = derive(
      'Arcane Lighthouse',
      'Land',
      "{T}: Add {C}.\n{1}, {T}: Until end of turn, creatures your opponents control lose hexproof and shroud and can't have hexproof or shroud.",
    )

    expect(mikokoro.wants).toContain('untap')
    expect(lighthouse.wants).toContain('untap')
  })

  it('does not read a card that is merely named after a storm', () => {
    /*
     * `spell-cast` read the bare word `storm`, and Scryfall spells a card's own
     * name out in its oracle text — so "Storm's Wrath deals 4 damage to each
     * creature" claimed to be a spellslinger payoff. 24 cards match on the word
     * alone and 20 of them are named after weather: Cinder Storm, Lightning
     * Storm, Comet Storm, Arrow Storm, Storm Seeker, Storm of Souls.
     *
     * The instrument is the one the `ritual` payoff rule two rules down already
     * uses, and using it twice is the point: read the KEYWORD by its reminder
     * text. Every one of the 33 commander-legal cards with the storm keyword
     * prints it — checked, zero exceptions — so the narrowing costs nothing.
     */
    const wrath = derive('Storm’s Wrath', 'Sorcery', 'Storm’s Wrath deals 4 damage to each creature and each planeswalker.')
    const cinder = derive('Cinder Storm', 'Sorcery', 'Cinder Storm deals 7 damage to any target.')
    const real = derive(
      'Weather the Storm',
      'Instant',
      'You gain 3 life.\nStorm (When you cast this spell, copy it for each spell cast before it this turn.)',
    )

    expect(wrath.wants).not.toContain('spell-cast')
    expect(cinder.wants).not.toContain('spell-cast')
    expect(real.wants).toContain('spell-cast')
  })

  it('counts the spells instead of naming one', () => {
    /*
     * Found by the storm narrowing, which is the reason to do the corpus diff:
     * two of the 22 cards that lost the tag were matching on the word inside a
     * TOKEN'S name — "create a 1/2 blue Bird creature token with flying named
     * STORM CROW" — and one of them, Murmuration, is a real spellslinger payoff
     * that no correct rule could reach.
     *
     * The template it uses is its own: a card that COUNTS the spells you have
     * cast this turn rather than triggering on one. 12 commander-legal cards,
     * read one by one — Gnostro, Narset Jeskai Waymaster, Surge of Brilliance,
     * and the "second spell you cast each turn costs less" cycle, which is the
     * same deck asking the same question from the cost side.
     */
    const murmuration = derive(
      'Murmuration',
      'Enchantment',
      "Birds you control get +1/+1 and have vigilance.\nAt the beginning of your end step, for each spell you've cast this turn, create a 1/2 blue Bird creature token with flying named Storm Crow.",
    )
    const gnostro = derive(
      'Gnostro, Voice of the Crags',
      'Legendary Creature — Elemental',
      "{T}: Choose one. X is the number of spells you've cast this turn.\n• Scry X.",
    )
    const ringer = derive(
      'Highspire Bell-Ringer',
      'Creature — Human Monk',
      'Flying\nThe second spell you cast each turn costs {1} less to cast.',
    )

    expect(murmuration.wants).toContain('spell-cast')
    expect(gnostro.wants).toContain('spell-cast')
    expect(ringer.wants).toContain('spell-cast')
  })

  it('still produces untap where it always did', () => {
    // The producer side is untouched: this change is about who WANTS it.
    const muse = derive(
      'Seedborn Muse',
      'Creature — Fungus',
      "Untap all permanents you control during each other player's untap step.",
    )

    expect(muse.produces).toContain('untap')
  })
})

/**
 * Losing life yourself is a different event from making somebody else lose it
 * (ADR-0059, amending ADR-0023).
 *
 * `lifeloss` had no subject test at all. 257 of its 1,062 commander-legal
 * producers lose the life THEMSELVES — Dark Confidant, Grim Tutor, Foul Imp,
 * Bellowing Saddlebrute, Feed the Swarm — and the panel renders the tag as
 * "opponents losing life", so a Vito deck was offered a card that takes life
 * off its own total as an enabler for taking it off theirs.
 *
 * ADR-0023 saw half of this and left it: "that leaves 12 self-life payoffs on
 * `lifeloss` alone, which is correct". It was correct about the payoffs and it
 * never measured the producers, and with both sides subject-agnostic the tag
 * matched in BOTH wrong directions — 257 self-producers against 7 opponent
 * payoffs, and 805 opponent-producers against 10 self ones.
 *
 * A SUBJECT TEST ALONE CANNOT FIX IT, which is why this is a tag and not a
 * regex. Narrowing only the producer leaves Vilis wanting an event nothing
 * emits; narrowing both sides deletes the Vilis deck, which is precisely the
 * mistake ADR-0016 records against itself ("narrowed it to here and stopped,
 * which deleted the opponent side rather than modelling it"). The event has two
 * subjects and needs two names.
 *
 * 317 producers and 12 payoffs, which is the same order as `land-creature`'s
 * 185 and 12 — the count ADR-0047 admitted a tag on.
 */
describe('losing life yourself is its own event (ADR-0059)', () => {
  const derive = (name: string, typeLine: string, oracleText: string): SynergyProfile =>
    deriveSynergy({ oracleId: oracleId(name), name, typeLine, oracleText, keywords: [] })

  const CONFIDANT = derive(
    'Dark Confidant',
    'Creature — Human Wizard',
    'At the beginning of your upkeep, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.',
  )
  const VITO = derive(
    'Vito, Thorn of the Dusk Rose',
    'Legendary Creature — Vampire Cleric',
    'Lifelink\nWhenever you gain life, each opponent loses that much life.',
  )
  const VILIS = derive(
    'Vilis, Broker of Blood',
    'Legendary Creature — Demon',
    '{B}, Pay 2 life: Target creature gets -1/-1 until end of turn.\nWhenever you lose life, draw that many cards.',
  )

  it('is in the vocabulary, and appended rather than inserted', () => {
    // The ORDER is a persisted contract (`semantic-emphasis`), so the events
    // keep the indices they had and this one goes on the end.
    expect(SYNERGY_TAGS).toContain('self-lifeloss')
    expect(EVENT_TAGS).toHaveLength(27)
    expect(EVENT_TAGS[EVENT_TAGS.length - 1]).toBe('self-lifeloss')
  })

  it('does not call a card that pays its own life an opponent drain', () => {
    expect(CONFIDANT.produces).not.toContain('lifeloss')
    expect(CONFIDANT.produces).toContain('self-lifeloss')
  })

  it('keeps the drain on the tag whose label says drain', () => {
    expect(VITO.produces).toContain('lifeloss')
    expect(VITO.produces).not.toContain('self-lifeloss')
  })

  it('gives the payoff for your own life loss somewhere to live', () => {
    // The 12 cards ADR-0023 named and left mislabelled. Under one tag Vilis was
    // offered a Vito, which never touches your total.
    expect(VILIS.wants).toContain('self-lifeloss')
    expect(VILIS.wants).not.toContain('lifeloss')
  })

  it('reads the disjunction the payoffs are written with', () => {
    // "Whenever you gain OR LOSE life" — two of the twelve, and an adjacency
    // test reads straight past them.
    const witness = derive(
      'Wax-Wane Witness',
      'Creature — Spirit',
      'Flying, vigilance\nWhenever you gain or lose life during your turn, this creature gets +1/+0 until end of turn.',
    )

    expect(witness.wants).toContain('self-lifeloss')
  })

  it('reads a symmetric clause as BOTH, because it is', () => {
    // ADR-0022's ruling about "each player discards", one event over.
    const syphon = derive(
      'Syphon Life',
      'Sorcery',
      'Each player loses 2 life. You gain life equal to the life lost this way.',
    )

    expect(syphon.produces).toContain('lifeloss')
    expect(syphon.produces).toContain('self-lifeloss')
  })

  it('does not extend the damage bridge to your own total', () => {
    /*
     * ADR-0023's ruling, kept: "whenever an opponent loses life" fires off a
     * Lightning Bolt and "whenever YOU lose life" does not, because no producer
     * rule ever emits `lifeloss` for damage aimed at you. Splitting the tag
     * must not quietly rebuild that bridge on the new side.
     */
    expect(VILIS.wants).not.toContain('player-damage')
  })

  it('pairs the new tag with what a deck that pays life is actually for', () => {
    // Necropotence, Bolas's Citadel, Vilis: life is the resource you spend on
    // cards, and gaining it back is how the deck survives doing so.
    expect(interactsWith('self-lifeloss')).toContain('card-draw')
    expect(interactsWith('self-lifeloss')).toContain('lifegain')
  })
})
