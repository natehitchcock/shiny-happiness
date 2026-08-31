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

describe('enchantment-etb', () => {
  const derive = (typeLine: string, oracleText: string): SynergyProfile =>
    deriveSynergy({
      oracleId: oracleId('00000000-0000-4000-8000-000000000001'),
      typeLine,
      oracleText,
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
    expect(derive('Creature — Bear', '')).toEqual({ produces: [], wants: [] })
  })
})

describe('a creature that pays off its own death', () => {
  const derive = (typeLine: string, oracleText: string): SynergyProfile =>
    deriveSynergy({
      oracleId: oracleId('00000000-0000-4000-8000-000000000002'),
      typeLine,
      oracleText,
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
    expect(derive('Creature — Bear', '')).toEqual({ produces: [], wants: [] })
  })
})

describe('plus1-counter direction', () => {
  const derive = (typeLine: string, oracleText: string): SynergyProfile =>
    deriveSynergy({
      oracleId: oracleId('00000000-0000-4000-8000-000000000003'),
      typeLine,
      oracleText,
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
      typeLine,
      oracleText,
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
    }

    const matches = synergyMatches(engine, deck)
    expect(matches).toHaveLength(1)
    expect(matches[0]?.direction).toBe('enables')
  })
})

describe('deriveSynergy — damage is not life loss (ADR-0023)', () => {
  const derive = (name: string, typeLine: string, oracleText: string): SynergyProfile =>
    deriveSynergy({ oracleId: oracleId(name), typeLine, oracleText })

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
      // The producer rules tag damage aimed at opponents and players, never
      // "deals 2 damage to you", so offering Vilis a burn spell would be a
      // match on a life total the spell never touches. 12 cards sit on
      // `lifeloss` alone for this reason.
      const vilis = derive(
        'Vilis, Broker of Blood',
        'Legendary Creature — Demon',
        'Flying\n{B}, Pay 2 life: Target creature gets -1/-1 until end of turn.\nWhenever you lose life, draw that many cards. (Damage causes loss of life.)',
      )

      expect(vilis.wants).toContain('lifeloss')
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
