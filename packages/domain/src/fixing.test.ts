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
})
