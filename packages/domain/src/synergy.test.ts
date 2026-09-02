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

describe('deriveSynergy — dealing damage is its own event (ADR-0029)', () => {
  const derive = (name: string, typeLine: string, oracleText: string): SynergyProfile =>
    deriveSynergy({ oracleId: oracleId(name), typeLine, oracleText })
  const deriveFaces = (name: string, typeLine: string, faces: readonly string[]): SynergyProfile =>
    deriveSynergy({
      oracleId: oracleId(name),
      typeLine,
      oracleText: faces.join('\n'),
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
    it('is in the vocabulary, and is the twenty-first', () => {
      expect(SYNERGY_TAGS).toContain('damage')
      expect(SYNERGY_TAGS).toHaveLength(21)
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
    deriveSynergy({ oracleId: oracleId(name), typeLine, oracleText })

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
      expect(MORITTE.produces).toEqual(['plus1-counter'])
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
