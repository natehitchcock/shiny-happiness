import { describe, expect, it } from 'vitest'
import type { Card, CardType } from './card.js'
import { oracleId, printingId } from './ids.js'
import { fixingFor, isManaSource, NO_FIXING } from './fixing.js'

/**
 * The defect these tests exist for.
 *
 * The land category was ranked entirely by rules text, because rules text was
 * all the scorer could see. Measured on an Izzet deck, every one of the top 40
 * "fills land" suggestions scored on `keyword-synergy` or `near-combo`, and the
 * best of them were Smoldering Crater and Desert of the Fervent — lands whose
 * only merit is that they cycle. Steam Vents and Command Tower appeared
 * nowhere, because a dual's text is a mana ability, and a mana ability produces
 * no synergy tags and joins no combos.
 */

const land = (over: Partial<Card> = {}): Card => ({
  oracleId: oracleId(over.name ?? 'l'),
  name: 'Steam Vents',
  manaCost: null,
  manaValue: 0,
  colorIdentity: ['R', 'U'],
  colors: [],
  typeLine: 'Land — Island Mountain',
  types: ['land'] as readonly CardType[],
  oracleText: '',
  power: null,
  toughness: null,
  loyalty: null,
  keywords: [],
  legalities: { commander: 'legal' },
  edhrecRank: 100,
  defaultPrinting: printingId('p'),
  roles: ['land'],
  primaryRole: 'land',
  universesBeyond: false,
  gameChanger: false,
  synergyProduces: [],
  synergyWants: [],
  producedMana: ['R', 'U'],
  ...over,
})

describe('what a land is worth to a deck', () => {
  it('scores a dual above a land that taps for one of the colours', () => {
    const dual = fixingFor(land({ producedMana: ['R', 'U'] }), ['R', 'U'])
    const single = fixingFor(land({ producedMana: ['R'] }), ['R', 'U'])

    expect(dual.value).toBeGreaterThan(single.value)
    expect(dual.coloursCovered).toBe(2)
    expect(single.coloursCovered).toBe(1)
  })

  it('scores a land producing none of the deck colours below either', () => {
    // A colourless utility land in a two-colour deck. Still mana, still worse
    // than mana of the right colour.
    const colourless = fixingFor(land({ producedMana: ['C'] }), ['R', 'U'])
    const single = fixingFor(land({ producedMana: ['R'] }), ['R', 'U'])

    expect(colourless.value).toBeGreaterThan(0)
    expect(colourless.value).toBeLessThan(single.value)
    expect(colourless.coloursCovered).toBe(0)
  })

  it('scores a card that produces nothing at zero', () => {
    // A land with no mana ability is a spell that costs a land drop.
    expect(fixingFor(land({ producedMana: [] }), ['R', 'U'])).toEqual(NO_FIXING)
  })

  it('reads Command Tower from produced mana, which its identity cannot say', () => {
    // The case that proves `colorIdentity` is not a substitute: Command Tower's
    // identity is EMPTY and it taps for every colour.
    const tower = land({
      name: 'Command Tower',
      colorIdentity: [],
      producedMana: ['W', 'U', 'B', 'R', 'G'],
    })

    expect(fixingFor(tower, ['R', 'U']).coloursCovered).toBe(2)
    // Against the identity alone it would have scored as producing nothing.
    expect(
      fixingFor({ ...tower, producedMana: tower.colorIdentity }, ['R', 'U']).coloursCovered,
    ).toBe(0)
  })

  it('gives diminishing returns per extra colour', () => {
    const five: Parameters<typeof fixingFor>[1] = ['W', 'U', 'B', 'R', 'G']
    const one = fixingFor(land({ producedMana: ['R'] }), five).value
    const two = fixingFor(land({ producedMana: ['R', 'U'] }), five).value
    const four = fixingFor(land({ producedMana: ['R', 'U', 'B', 'G'] }), five).value

    // Each extra colour helps, but the first is worth more than the fourth.
    expect(two).toBeGreaterThan(one)
    expect(four).toBeGreaterThan(two)
    expect(two - one).toBeGreaterThan(
      four - fixingFor(land({ producedMana: ['R', 'U', 'B'] }), five).value,
    )
  })

  it('does not pretend a mono-colour deck needs fixing', () => {
    // Every land producing the one colour covers the whole identity, so they
    // tie — which is right. A mono-red deck has no fixing problem, and the term
    // should not invent an ordering where there is no question.
    const a = fixingFor(land({ producedMana: ['R'] }), ['R'])
    const b = fixingFor(land({ producedMana: ['R', 'U'] }), ['R'])

    expect(a.value).toBe(b.value)
    expect(a.value).toBe(1)
  })

  it('treats a colourless deck as wanting colourless mana', () => {
    // There are no colours to cover, so "covers none of them" is not a fault.
    const c = fixingFor(land({ producedMana: ['C'] }), [])
    expect(c.producesMana).toBe(true)
    expect(c.value).toBeGreaterThan(0)
  })

  it('says nothing about a card with no produced mana recorded', () => {
    // A card read before the column existed. `[]` would be the wrong answer —
    // "produces nothing" is a claim, and this is a gap.
    const before = { ...land() }
    delete (before as { producedMana?: unknown }).producedMana
    expect(fixingFor(before, ['R', 'U'])).toEqual(NO_FIXING)
  })
})

describe('which cards the term applies to', () => {
  it('applies to lands', () => {
    expect(isManaSource(land())).toBe(true)
  })

  it('does not apply to a mana dork', () => {
    // Llanowar Elves genuinely fixes, but it competes in a group of creatures
    // where its body and its text are the interesting part. Letting fixing
    // reorder that group would be the same mistake in the other direction.
    const elf = land({
      name: 'Llanowar Elves',
      typeLine: 'Creature — Elf Druid',
      types: ['creature'] as readonly CardType[],
      producedMana: ['G'],
    })
    expect(isManaSource(elf)).toBe(false)
  })

  it('applies to an MDFC land, which is a land on the side that matters', () => {
    const mdfc = land({
      name: 'Riverglide Pathway // Lavaglide Pathway',
      typeLine: 'Land // Land',
      types: ['land'] as readonly CardType[],
    })
    expect(isManaSource(mdfc)).toBe(true)
  })
})

describe('entering tapped', () => {
  const izzet: Parameters<typeof fixingFor>[1] = ['R', 'U']

  it('scores a tapped dual below the same dual untapped', () => {
    const untapped = fixingFor(land({ oracleText: '{T}: Add {U} or {R}.' }), izzet)
    const tapped = fixingFor(
      land({ oracleText: 'This land enters tapped. {T}: Add {U} or {R}.' }),
      izzet,
    )

    expect(tapped.value).toBeLessThan(untapped.value)
    expect(tapped.entersTapped).toBe(true)
    // Not zero. A tapped dual is a real card real decks play; scoring it as
    // producing nothing would be a worse lie than the one being fixed.
    expect(tapped.value).toBeGreaterThan(0)
  })

  it('does not demote a shockland', () => {
    // The naive `/enters tapped/` flags this, because of the second sentence.
    // Demoting the best duals in the game would be worse than not modelling
    // tapped-ness at all.
    const shock = land({
      name: 'Steam Vents',
      oracleText:
        "As Steam Vents enters, you may pay 2 life. If you don't, it enters tapped. {T}: Add {U} or {R}.",
    })
    expect(fixingFor(shock, izzet).entersTapped).toBe(false)
  })

  it('does not demote a checkland or a fastland', () => {
    const check = land({
      oracleText: 'This land enters tapped unless you control an Island or a Mountain.',
    })
    const fast = land({
      oracleText: 'This land enters tapped unless you control two or fewer other lands.',
    })
    expect(fixingFor(check, izzet).entersTapped).toBe(false)
    expect(fixingFor(fast, izzet).entersTapped).toBe(false)
  })

  it('does not demote a land that only OFFERS to enter tapped', () => {
    // Mariposa Military Base: a choice, not a cost.
    const optional = land({
      oracleText: 'You may have this land enter tapped. If you do, you get two rad counters.',
    })
    expect(fixingFor(optional, izzet).entersTapped).toBe(false)
  })

  it('reads the older wording too', () => {
    // Still in print — Gate to Tumbledown and friends.
    const gate = land({ oracleText: 'Gate to Tumbledown enters the battlefield tapped.' })
    expect(fixingFor(gate, izzet).entersTapped).toBe(true)
  })

  it('penalises a tapped colourless land as well', () => {
    const a = fixingFor(land({ producedMana: ['C'], oracleText: '' }), izzet)
    const b = fixingFor(
      land({ producedMana: ['C'], oracleText: 'This land enters tapped.' }),
      izzet,
    )
    expect(b.value).toBeLessThan(a.value)
  })

  /*
   * The guard has to read the CLAUSE, not the card.
   *
   * Measured against the corpus: twenty legal lands say "This land enters
   * tapped." on a line of their own and were scored as untapped anyway, because
   * a conditional word appeared somewhere else on the card. None of them was a
   * near miss — every one is unconditionally tapped.
   */
  it('does not let a later clause cancel an unconditional tapped clause', () => {
    // Dakmor Salvage. The "if you do" is inside Dredge's REMINDER TEXT and has
    // nothing to do with how the land enters.
    const dredge = land({
      name: 'Dakmor Salvage',
      producedMana: ['B'],
      oracleText:
        'This land enters tapped.\n{T}: Add {B}.\nDredge 2 (If you would draw a card, you may mill two cards instead. If you do, return this card from your graveyard to your hand.)',
    })
    expect(fixingFor(dredge, izzet).entersTapped).toBe(true)
  })

  it('does not let a sacrifice clause cancel it either', () => {
    // The karoo cycle, and Rupture Spire. "Sacrifice it unless you pay {1}" is
    // a second cost, not a way to have the land enter untapped.
    const karoo = land({
      name: 'Coral Atoll',
      producedMana: ['C', 'U'],
      oracleText:
        "This land enters tapped.\nWhen this land enters, sacrifice it unless you return an untapped Island you control to its owner's hand.\n{T}: Add {C}{U}.",
    })
    expect(fixingFor(karoo, izzet).entersTapped).toBe(true)
  })

  it('reads the land face of a two-faced card, not the spell face', () => {
    // Rush of Inspiration // Crackling Falls. `oracleText` is both faces
    // concatenated, so the INSTANT's "unless you pay {E}{E}" was cancelling the
    // land's own "This land enters tapped".
    const mdfc = land({
      name: 'Rush of Inspiration // Crackling Falls',
      typeLine: 'Instant // Land',
      manaValue: 3,
      oracleText:
        'Draw two cards. Then discard a card at random unless you pay {E}{E} (two energy counters).\nThis land enters tapped.\n{T}: Add {U} or {R}.',
    })
    expect(fixingFor(mdfc, izzet).entersTapped).toBe(true)
  })
})

/**
 * What the coverage is worth once you have it.
 *
 * `coloursCovered` saturates: in a two-colour deck every land that taps for
 * both colours scores the same, and the term stops ordering at exactly the
 * point the builder still has a question. Measured on an Izzet deck, the eight
 * suggestions under "Fills gap · land" were Matzalantli, Treasure Map, Rush of
 * Inspiration, Azor's Gateway, The Mycosynth Gardens, Fiery Islet, Horizon of
 * Progress and Voldaren Estate — no dual, no shockland, and four of the eight
 * not lands at all. Steam Vents was twentieth.
 *
 * `producedMana` is Scryfall's "colours this card can ever make". It says
 * nothing about what they cost you, so these all read as full coverage.
 */
describe('what the coverage costs', () => {
  const izzet: Parameters<typeof fixingFor>[1] = ['R', 'U']
  const anyColour: Card['producedMana'] = ['W', 'U', 'B', 'R', 'G']

  const restricted = land({
    name: 'Villainous Hideout',
    producedMana: anyColour,
    oracleText:
      '{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a Villain spell.',
  })
  const unrestricted = land({
    name: 'Command Tower',
    producedMana: anyColour,
    oracleText: '{T}: Add one mana of any color.',
  })

  it('scores mana you may not spend below mana you may', () => {
    expect(fixingFor(restricted, izzet).value).toBeLessThan(fixingFor(unrestricted, izzet).value)
    expect(fixingFor(restricted, izzet).restricted).toBe(true)
    expect(fixingFor(unrestricted, izzet).restricted).toBe(false)
  })

  it('scores a restricted land below a tapped one that is not restricted', () => {
    // A restriction applies every turn; entering tapped costs one. The larger
    // penalty belongs to the larger problem.
    const tappedDual = land({ oracleText: 'This land enters tapped.\n{T}: Add {U} or {R}.' })
    expect(fixingFor(restricted, izzet).value).toBeLessThan(fixingFor(tappedDual, izzet).value)
  })

  it('does not flag a land that also has an unrestricted coloured source', () => {
    // Plaza of Heroes: one restricted any-colour ability and one that is not.
    // The deck can still reach its colours, so the card is not discounted.
    const plaza = land({
      name: 'Plaza of Heroes',
      producedMana: anyColour,
      oracleText:
        '{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a legendary spell.\n{T}: Add one mana of any color among legendary permanents you control.',
    })
    expect(fixingFor(plaza, izzet).restricted).toBe(false)
  })

  it('keeps a restricted land above one that produces none of your colours', () => {
    // Cavern of Souls is a real card real decks play. A discount, not a zero —
    // the same argument the tapped penalty already makes.
    const colourless = fixingFor(land({ producedMana: ['C'] }), izzet)
    expect(fixingFor(restricted, izzet).value).toBeGreaterThan(colourless.value)
  })

  it('scores a land you have to cast below a real land that covers less', () => {
    // Treasure Map // Treasure Cove taps for every colour — after you have paid
    // {2}, spent a card, and activated it three times. It is not a land drop,
    // and it led the land category over every dual in the format.
    const mustCast = land({
      name: 'Treasure Map // Treasure Cove',
      typeLine: 'Artifact // Land',
      manaValue: 2,
      producedMana: anyColour,
      oracleText: '{T}: Add {C}.',
    })
    const oneColourLand = land({ producedMana: ['R'] })

    expect(fixingFor(mustCast, izzet).mustBeCast).toBe(true)
    expect(fixingFor(mustCast, izzet).value).toBeLessThan(fixingFor(oneColourLand, izzet).value)
  })

  it('leaves every real land alone, because a land has no mana cost', () => {
    expect(fixingFor(land({ producedMana: ['R', 'U'] }), izzet).mustBeCast).toBe(false)
  })

  it('stacks the discounts, so two problems are worse than one', () => {
    const both = land({
      name: 'Sea Gate Restoration // Sea Gate, Reborn',
      typeLine: 'Sorcery // Land',
      manaValue: 7,
      producedMana: ['U'],
      oracleText:
        'Draw cards equal to the number of cards in your hand.\nThis land enters tapped.\n{T}: Add {U}.',
    })
    const tappedOnly = land({
      producedMana: ['U'],
      oracleText: 'This land enters tapped.\n{T}: Add {U}.',
    })
    expect(fixingFor(both, izzet).value).toBeLessThan(fixingFor(tappedOnly, izzet).value)
  })

  it('still puts a plain untapped dual above all of them', () => {
    // The whole point. Steam Vents is what this category is for.
    const shock = fixingFor(
      land({
        oracleText:
          "({T}: Add {U} or {R}.)\nAs this land enters, you may pay 2 life. If you don't, it enters tapped.",
      }),
      izzet,
    )
    for (const other of [
      restricted,
      land({
        name: 'Treasure Map // Treasure Cove',
        typeLine: 'Artifact // Land',
        manaValue: 2,
        producedMana: anyColour,
      }),
      land({ oracleText: 'This land enters tapped.' }),
    ]) {
      expect(shock.value).toBeGreaterThan(fixingFor(other, izzet).value)
    }
  })
})
