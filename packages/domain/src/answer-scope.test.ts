import { describe, expect, it } from 'vitest'
import { answerCoverage, answerScope, underCovered } from './answer-scope.js'
import type { Card, CardType } from './card.js'

const card = (name: string, typeLine: string, oracleText: string) =>
  ({ name, typeLine, oracleText }) as Pick<Card, 'name' | 'typeLine' | 'oracleText'>

// Real oracle text, from the corpus.
const DISENCHANT = card('Disenchant', 'Instant', 'Destroy target artifact or enchantment.')
const VANDALBLAST = card(
  'Vandalblast',
  'Sorcery',
  "Destroy target artifact you don't control.\nOverload {4}{R}",
)
const SWORDS = card(
  'Swords to Plowshares',
  'Instant',
  'Exile target creature. Its controller gains life equal to its power.',
)
const BEAST_WITHIN = card(
  'Beast Within',
  'Instant',
  'Destroy target permanent. Its controller creates a 3/3 green Beast creature token.',
)
const BANE = card(
  'Bane of Progress',
  'Creature — Elemental',
  'When this creature enters, destroy all artifacts and enchantments.',
)
const WRATH = card('Wrath of God', 'Sorcery', 'Destroy all creatures. They can’t be regenerated.')
const CANNONADE = card(
  'Fiery Cannonade',
  'Instant',
  'Fiery Cannonade deals 2 damage to each non-Pirate creature.',
)
const BOLT = card('Lightning Bolt', 'Instant', 'Lightning Bolt deals 3 damage to any target.')

describe('answerScope', () => {
  /*
   * The defect ADR-0058 exists for: 446 of the 2,563 cards counted as
   * spot-removal cannot kill a creature, and the meter counts all of them the
   * same. In green it is 144 of 207.
   */
  it('reads what a restricted answer can actually point at', () => {
    expect([...answerScope(DISENCHANT)].sort()).toEqual(['artifact', 'enchantment'])
    expect([...answerScope(VANDALBLAST)]).toEqual(['artifact'])
    expect([...answerScope(BANE)].sort()).toEqual(['artifact', 'enchantment'])
  })

  it('reads an unrestricted answer as reaching everything it names', () => {
    expect([...answerScope(SWORDS)]).toEqual(['creature'])
    expect([...answerScope(WRATH)]).toEqual(['creature'])
    expect([...answerScope(BEAST_WITHIN)]).toContain('creature')
    expect([...answerScope(BEAST_WITHIN)]).toContain('artifact')
  })

  /*
   * "Nonland permanent" reaches everything but a land, which is the reading a
   * plain word search gets backwards -- it contains the word "land".
   */
  it('subtracts a non- prefix rather than being fooled by it', () => {
    const rift = card(
      'Cyclonic Rift',
      'Instant',
      "Return target nonland permanent you don't control to its owner's hand.",
    )
    expect([...answerScope(rift)]).toContain('creature')
    expect([...answerScope(rift)]).not.toContain('land')
  })

  /*
   * Mass damage answers creatures without ever saying "destroy". Without this
   * the whole burn half of the board-wipe role reads as answering nothing.
   */
  it('counts mass damage and mass -X/-X as reaching creatures', () => {
    expect([...answerScope(CANNONADE)]).toContain('creature')
    const drain = card('Drain', 'Sorcery', 'All creatures get -3/-3 until end of turn.')
    expect([...answerScope(drain)]).toContain('creature')
  })

  it('counts a bolt at any target, which can always be pointed at a creature', () => {
    expect([...answerScope(BOLT)]).toContain('creature')
  })

  it('is empty for a card that answers nothing, which is not a claim that it is useless', () => {
    expect([...answerScope(card('Grizzly Bears', 'Creature — Bear', ''))]).toEqual([])
  })
})

describe('answerCoverage', () => {
  it('counts how many of the deck’s answers reach each type', () => {
    const coverage = answerCoverage([DISENCHANT, VANDALBLAST, SWORDS])

    expect(coverage.get('artifact')).toBe(2)
    expect(coverage.get('creature')).toBe(1)
    expect(coverage.get('enchantment')).toBe(1)
  })

  it('counts nothing for a deck of no answers', () => {
    expect(answerCoverage([card('Grizzly Bears', 'Creature — Bear', '')]).size).toBe(0)
  })
})

describe('underCovered', () => {
  /*
   * THE GREEN DECK. Its removal is Naturalize effects, so the composition meter
   * reads satisfied while the deck cannot kill a creature. This is the question
   * the offer ordering asks, and `creature` is the answer it has to give.
   */
  it('names creature when every answer in the deck is a Naturalize', () => {
    const coverage = answerCoverage([DISENCHANT, VANDALBLAST, BANE])

    expect([...underCovered(coverage)]).toEqual(['creature'])
  })

  it('names nothing once the deck holds real creature removal', () => {
    const coverage = answerCoverage([DISENCHANT, SWORDS, WRATH, BOLT])

    expect([...underCovered(coverage)]).toEqual([])
  })

  /*
   * PARTIAL, NOT BINARY -- the opposite ruling to ADR-0057, because Disenchant
   * really is removal. Nothing here removes a card from a role or a count; it
   * only says which of several real answers to offer FIRST.
   */
  it('is silent when the deck has no answers at all, rather than demanding one type', () => {
    // A deck with nothing yet is short of everything, and picking a type would
    // be this file inventing a target. `findDeficits` already says "you are six
    // short"; this only ever splits a tie between answers that both fill it.
    expect([...underCovered(new Map<CardType, number>())]).toEqual([])
  })

  it('holds the threshold at a quarter, and the threshold is the whole rule', () => {
    // Three artifact answers and one creature answer: a quarter, which passes.
    expect([...underCovered(answerCoverage([DISENCHANT, VANDALBLAST, BANE, SWORDS]))]).toEqual([])
    // Five and one is a fifth, which does not.
    const thin = answerCoverage([DISENCHANT, VANDALBLAST, BANE, DISENCHANT, VANDALBLAST, SWORDS])
    expect([...underCovered(thin)]).toEqual(['creature'])
  })
})
