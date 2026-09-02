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

/**
 * What the coverage costs, read per ability instead of per card.
 *
 * ADR-0035 discounted a land for entering tapped, for being spend-restricted
 * and for having a mana cost, and left the case it could not reach: a coloured
 * ability GATED BEHIND SOMETHING. Measured on a five-colour Najeela deck,
 * `fills-land` over 677 candidates, the head of the list was a 33-way tie at
 * 2.250 in which City of Brass and Reflecting Pool sat level with Baldur's
 * Gate, The Grey Havens, Gemstone Caverns and Study Hall — every one of them a
 * land that taps for {C} and reaches five colours only by paying something
 * else. The Triomes were outside the top 200 and the fetchlands were 651st.
 *
 * `producedMana` is a flat array of "colours this card can ever make" and can
 * never separate them. The oracle text can: an ability states its own cost.
 */
describe('what an ability costs to activate', () => {
  const five: Parameters<typeof fixingFor>[1] = ['W', 'U', 'B', 'R', 'G']
  const anyColour: Card['producedMana'] = ['W', 'U', 'B', 'R', 'G']
  const withC: Card['producedMana'] = ['W', 'U', 'B', 'R', 'G', 'C']

  const cityOfBrass = land({
    name: 'City of Brass',
    producedMana: anyColour,
    oracleText:
      'Whenever this land becomes tapped, it deals 1 damage to you.\n{T}: Add one mana of any color.',
  })
  const steamVents = land({ producedMana: ['U', 'R'], oracleText: '{T}: Add {U} or {R}.' })
  const triome = land({
    name: 'Raugrin Triome',
    producedMana: ['R', 'U', 'W'],
    oracleText: 'This land enters tapped.\n{T}: Add {R}, {U}, or {W}.\nCycling {3}',
  })
  const mycosynth = land({
    name: 'The Mycosynth Gardens',
    producedMana: withC,
    oracleText: '{T}: Add {C}.\n{1}, {T}: Add one mana of any color.',
  })

  it('leaves City of Brass alone, because life is a price and not a prerequisite', () => {
    // The counter-example that any rule demoting gated lands has to survive.
    // City of Brass is a premium fixer whose cost is life, and the damage is a
    // TRIGGERED ability on its own line — the mana ability costs {T} and
    // nothing else. A rule that reads "this land hurts you" as a gate takes
    // out City of Brass, Mana Confluence, Grand Coliseum and every painland.
    const fixing = fixingFor(cityOfBrass, five)
    expect(fixing.value).toBe(1)
    expect(fixing.reach).toBe('taps')
  })

  it('leaves Mana Confluence alone, whose life payment is in the cost itself', () => {
    const confluence = land({
      name: 'Mana Confluence',
      producedMana: anyColour,
      oracleText: '{T}, Pay 1 life: Add one mana of any color.',
    })
    expect(fixingFor(confluence, five).value).toBe(1)
    expect(fixingFor(confluence, five).reach).toBe('taps')
  })

  it('scores a land that needs a second land below a dual of two of five colours', () => {
    // The Mycosynth Gardens led the reported list. `{1}, {T}: Add one mana of
    // any color` adds NO mana to your pool — it converts one generic into one
    // coloured, so it is two lands doing one land's work, and it does nothing
    // at all until the second land is there.
    expect(fixingFor(mycosynth, five).value).toBeLessThan(fixingFor(steamVents, five).value)
    expect(fixingFor(mycosynth, five).reach).toBe('gated')
  })

  it('scores a Triome above it too, even though the Triome enters tapped', () => {
    // Entering tapped costs one turn. Needing another land costs one every turn.
    expect(fixingFor(mycosynth, five).value).toBeLessThan(fixingFor(triome, five).value)
  })

  it('does not demote a filter land, which makes two mana for one', () => {
    // The trade ADR-0035 refused, now derived rather than excepted. A filter
    // land's activation cost is a mana symbol, so a rule that reads "costs mana
    // to activate" as a gate demotes Mystic Gate and Cascade Bluffs. It nets
    // one mana exactly as a plain land does, so it is not a converter.
    const filter = land({
      name: 'Cascade Bluffs',
      producedMana: withC,
      oracleText: '{T}: Add {C}.\n{U/R}, {T}: Add {U}{U}, {U}{R}, or {R}{R}.',
    })
    expect(fixingFor(filter, ['U', 'R']).value).toBe(1)
    expect(fixingFor(filter, ['U', 'R']).reach).toBe('taps')
  })

  it('does demote a land that pays four mana for four', () => {
    // Baxter Building, named in ADR-0035 as known and unfixed. Four mana for
    // {4} and a tap nets zero, which is the same defect as Mycosynth Gardens
    // at a larger number, and the same arithmetic catches it.
    const baxter = land({
      name: 'Baxter Building',
      producedMana: withC,
      oracleText: '{T}: Add {C}.\n{4}, {T}: Add four mana in any combination of colors.',
    })
    expect(fixingFor(baxter, five).value).toBeLessThan(fixingFor(steamVents, five).value)
  })

  it('reads a spend-restriction on an ability the old phrasing missed', () => {
    // Great Hall of the Citadel. The old guard required `{W}`-style symbols or
    // the words "any color" on the line before it would look for the
    // restriction, and "Add two mana in any combination of colors" says
    // neither — so the 0.5 discount was skipped on a card whose very next
    // sentence is the exact Oracle template. A false NEGATIVE, which
    // ADR-0035's "zero false positives" claim did not measure.
    const greatHall = land({
      name: 'Great Hall of the Citadel',
      producedMana: withC,
      oracleText:
        '{T}: Add {C}.\n{1}, {T}: Add two mana in any combination of colors. Spend this mana only to cast legendary spells.',
    })
    expect(fixingFor(greatHall, five).restricted).toBe(true)
    expect(fixingFor(greatHall, five).reach).toBe('restricted')
  })

  it('scores colours borrowed from a board state below mana that is merely restricted', () => {
    // A restriction still gives you the mana; a board state may give you
    // nothing at all. The Grey Havens taps for five colours only if the right
    // legendary creatures are in your graveyard, and a five-colour deck starts
    // with an empty one.
    const greyHavens = land({
      name: 'The Grey Havens',
      producedMana: withC,
      oracleText:
        'When this land enters, scry 1.\n{T}: Add {C}.\n{T}: Add one mana of any color among legendary creature cards in your graveyard.',
    })
    const cavern = land({
      name: 'Cavern of Souls',
      producedMana: anyColour,
      oracleText:
        '{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type.',
    })
    expect(fixingFor(greyHavens, five).value).toBeLessThan(fixingFor(cavern, five).value)
    expect(fixingFor(greyHavens, five).reach).toBe('gated')
  })

  it('reads "activate only if" as a gate', () => {
    // Mirrex taps for any colour ONLY on the turn it entered, and the chip said
    // "taps for 5 of your 5 colours" on every turn after that.
    const mirrex = land({
      name: 'Mirrex',
      producedMana: withC,
      oracleText:
        '{T}: Add {C}.\n{T}: Add one mana of any color. Activate only if this land entered this turn.',
    })
    expect(fixingFor(mirrex, five).reach).toBe('gated')
    expect(fixingFor(mirrex, five).value).toBeLessThan(fixingFor(steamVents, five).value)
  })

  it('is gentler on colours mirrored off a land than off a graveyard', () => {
    // The counter-example in the other direction. Reflecting Pool's condition
    // is "a land you control", and a deck the product is at this moment
    // computing a LAND deficit for has lands. What it cannot be is your first
    // source of a colour — it copies a mana base rather than building one —
    // and that is the same every-turn limit a spend-restriction is.
    const pool = land({
      name: 'Reflecting Pool',
      producedMana: anyColour,
      oracleText: '{T}: Add one mana of any type that a land you control could produce.',
    })
    const graveyard = land({
      name: 'The Grey Havens',
      producedMana: withC,
      oracleText:
        '{T}: Add {C}.\n{T}: Add one mana of any color among legendary creature cards in your graveyard.',
    })
    expect(fixingFor(pool, five).value).toBeGreaterThan(fixingFor(graveyard, five).value)
    expect(fixingFor(pool, five).value).toBeLessThan(fixingFor(cityOfBrass, five).value)
  })

  it('does not read the commander identity clause as a gate', () => {
    // Command Tower's "in your commander's color identity" IS the deck's
    // identity. It is the one condition that is true by construction.
    const tower = land({
      name: 'Command Tower',
      colorIdentity: [],
      producedMana: anyColour,
      oracleText: "{T}: Add one mana of any color in your commander's color identity.",
    })
    expect(fixingFor(tower, five).value).toBe(1)
    expect(fixingFor(tower, five).reach).toBe('taps')
  })

  it('scores a land that eats another permanent no higher than a colourless one', () => {
    // Lazotep Quarry ranked 2nd of 677. Sacrificing a creature costs a card and
    // works once; on every other turn the card is a land that taps for {C},
    // which is exactly what it should be scored as.
    const quarry = land({
      name: 'Lazotep Quarry',
      producedMana: withC,
      oracleText: '{T}: Add {C}.\n{T}, Sacrifice a creature: Add one mana of any color.',
    })
    const wastes = land({ name: 'Wastes', producedMana: ['C'], oracleText: '{T}: Add {C}.' })
    expect(fixingFor(quarry, five).value).toBe(fixingFor(wastes, five).value)
  })

  it('counts a colour chosen as the land entered once, not five times', () => {
    // Twenty-two lands claim five colours in `producedMana` and make one or two:
    // the Thriving cycle, the Gate cycle, Cryptic Spires. The chip read "taps
    // for 5 of your 5 colours" on a land that taps for two, which is a P4
    // violation on its own, whatever the score does.
    const thriving = land({
      name: 'Thriving Isle',
      producedMana: anyColour,
      oracleText:
        'This land enters tapped.\nAs this land enters, choose a color other than blue.\n{T}: Add {U} or one mana of the chosen color.',
    })
    expect(fixingFor(thriving, five).coloursCovered).toBe(2)
  })
})

/**
 * A land that finds a land.
 *
 * Flooded Strand has `producedMana: []`, which is CORRECT — a fetch makes no
 * mana — so it fell to `NO_FIXING` and scored 0.700, below every `{T}: Add {C}`
 * utility land in the format, in a five-colour deck where a fetch is a premium
 * fixer. It ranked 652nd of 677.
 *
 * The trap on the other side is the one the playtest walked into: Quickbuild
 * put Evolving Wilds, Terramorphic Expanse and Myriad Landscape into a deck
 * with ZERO basic lands, where all three are blank cards, and nothing on screen
 * said so. So a fetch is scored on what it can find, and only when the deck
 * holds something for it to find.
 */
describe('a land that fetches one', () => {
  const five: Parameters<typeof fixingFor>[1] = ['W', 'U', 'B', 'R', 'G']

  const floodedStrand = land({
    name: 'Flooded Strand',
    producedMana: [],
    oracleText:
      '{T}, Pay 1 life, Sacrifice this land: Search your library for a Plains or Island card, put it onto the battlefield, then shuffle.',
  })
  const evolvingWilds = land({
    name: 'Evolving Wilds',
    producedMana: [],
    oracleText:
      '{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
  })

  it('scores a fetch at nothing when the deck holds nothing to fetch', () => {
    // The reported trap. Absent deck lands means "nothing fetchable", NOT
    // "unknown, assume the best": the unsafe direction here is recommending a
    // blank card, so forgetting to pass the deck costs the fetch its score
    // rather than costing the builder a dead draw. Same default-deny argument
    // `gameChangerBudget` makes in `recommend.ts`.
    expect(fixingFor(floodedStrand, five)).toEqual(NO_FIXING)
    expect(fixingFor(floodedStrand, five, { types: new Set(), hasBasic: false })).toEqual(NO_FIXING)
  })

  it('scores a fetch on the colours of what the deck actually has to find', () => {
    const both = fixingFor(floodedStrand, five, {
      types: new Set(['Plains', 'Island'] as const),
      hasBasic: true,
    })
    const onlyIslands = fixingFor(floodedStrand, five, {
      types: new Set(['Island'] as const),
      hasBasic: true,
    })

    expect(both.coloursCovered).toBe(2)
    expect(onlyIslands.coloursCovered).toBe(1)
    expect(both.reach).toBe('fetches')
  })

  it('outranks a land that taps for colourless and reaches five colours at a cost', () => {
    // The ordering the report asked for. A fetch that the deck can pay off
    // beats Baldur's Gate, which taps for {C} and needs {2} and a board of
    // Gates for the rest.
    const baldursGate = land({
      name: "Baldur's Gate",
      producedMana: ['W', 'U', 'B', 'R', 'G', 'C'],
      oracleText:
        '{T}: Add {C}.\n{2}, {T}: Add X mana of any one color, where X is the number of other Gates you control.',
    })
    const fetch = fixingFor(floodedStrand, five, {
      types: new Set(['Plains', 'Island'] as const),
      hasBasic: true,
    })
    expect(fetch.value).toBeGreaterThan(fixingFor(baldursGate, five).value)
  })

  it('needs an actual basic for a fetch that says "basic land card"', () => {
    // Evolving Wilds cannot find a Triome. A deck of nothing but nonbasic duals
    // holds Island TYPES and no Island CARDS, and the safe direction is to
    // under-count what a fetch can reach: that withholds a recommendation, it
    // never makes a false one.
    const duals = { types: new Set(['Island', 'Plains'] as const), hasBasic: false }
    expect(fixingFor(evolvingWilds, five, duals)).toEqual(NO_FIXING)
    expect(
      fixingFor(evolvingWilds, five, { types: new Set(['Island'] as const), hasBasic: true })
        .coloursCovered,
    ).toBe(1)
  })

  it('scores a fetch that finds a tapped land below one that does not', () => {
    // Evolving Wilds puts the land in TAPPED; Flooded Strand does not. That is
    // the one turn `TAPPED_PENALTY` already prices, and it is the whole
    // difference between the two cards.
    //
    // `entersTapped` stays FALSE on both, and deliberately: the fetch itself
    // does not enter tapped, the land it finds does, and that field is read as
    // a claim about this card's own rules text everywhere else in the file.
    // The turn is charged to the value without lying about the flag.
    const strandOnOne = fixingFor(floodedStrand, five, {
      types: new Set(['Island'] as const),
      hasBasic: true,
    })
    const wildsOnOne = fixingFor(evolvingWilds, five, {
      types: new Set(['Island'] as const),
      hasBasic: true,
    })
    expect(wildsOnOne.entersTapped).toBe(false)
    expect(wildsOnOne.value).toBeLessThan(strandOnOne.value)
  })

  it('does not treat a land that sacrifices itself for mana as a fetch', () => {
    // Crumbling Vestige and the karoo-adjacent one-shots sacrifice themselves
    // to ADD mana, not to search. They are a one-shot mana ability, and the
    // sacrifice rule already prices them.
    const oneShot = land({
      name: 'Sanctum of Ugin',
      producedMana: ['W', 'U', 'B', 'R', 'G'],
      oracleText: '{T}, Sacrifice this land: Add one mana of any color.',
    })
    expect(fixingFor(oneShot, five).reach).not.toBe('fetches')
    expect(fixingFor(oneShot, five).producesMana).toBe(true)
  })
})
