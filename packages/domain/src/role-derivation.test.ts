import { describe, expect, it } from 'vitest'
import { oracleId } from './ids.js'
import type { Role } from './role.js'
import { primaryRole, ROLE_PRECEDENCE } from './role.js'
import { deriveRoles } from './role-derivation.js'

/**
 * These test the ENGINE against oracle-text patterns, not a corpus of real
 * cards. `DOM-04`'s DoD asks for ≥95% agreement with a 300-card hand-labelled
 * fixture set; that set requires real Scryfall data (DATA-01, ING-01) and cannot
 * be written from memory without inventing oracle text. The gap is tracked in
 * docs/11 rather than papered over with plausible-looking fixtures.
 */
const c = (typeLine: string, oracleText: string, id = 'x') => ({
  oracleId: oracleId(id),
  typeLine,
  oracleText,
})

const rolesOf = (typeLine: string, text: string): readonly Role[] =>
  deriveRoles(c(typeLine, text)).roles

describe('deriveRoles precedence', () => {
  const card = c('Artifact', 'T: Add {C}{C}.', 'sol-ring')

  it('user override beats everything', () => {
    const result = deriveRoles(card, {
      userOverride: ['wincon'],
      curated: new Map([[oracleId('sol-ring'), ['draw' as Role]]]),
    })
    expect(result).toEqual({ roles: ['wincon'], primary: 'wincon', source: 'override' })
  })

  it('curated table beats heuristics', () => {
    const result = deriveRoles(card, {
      curated: new Map([[oracleId('sol-ring'), ['draw' as Role]]]),
    })
    expect(result.source).toBe('curated')
    expect(result.roles).toEqual(['draw'])
  })

  it('falls through to heuristics', () => {
    const result = deriveRoles(card)
    expect(result.source).toBe('heuristic')
    expect(result.roles).toContain('ramp')
  })

  it('ignores an empty override rather than treating it as a decision', () => {
    expect(deriveRoles(card, { userOverride: [] }).source).toBe('heuristic')
    expect(deriveRoles(card, { userOverride: null }).source).toBe('heuristic')
  })
})

describe('heuristics', () => {
  it.each([
    ['ramp', 'Artifact', '{T}: Add {C}{C}.'],
    ['ramp', 'Sorcery', 'Search your library for a basic land card, put it onto the battlefield tapped.'],
    ['ramp', 'Creature — Goblin', 'When this creature enters, create a Treasure token.'],
    ['draw', 'Instant', 'Draw a card.'],
    ['draw', 'Enchantment', 'Whenever a creature dies, you draw two cards.'],
    ['spot-removal', 'Instant', 'Destroy target creature.'],
    ['spot-removal', 'Instant', 'Counter target spell.'],
    ['spot-removal', 'Sorcery', 'This spell deals 3 damage to any target.'],
    ['board-wipe', 'Sorcery', 'Destroy all creatures.'],
    ['board-wipe', 'Sorcery', 'All creatures get -5/-5 until end of turn.'],
    ['protection', 'Instant', 'Target creature you control gains hexproof and indestructible until end of turn.'],
    ['recursion', 'Sorcery', 'Return target creature card from your graveyard to the battlefield.'],
    ['sac-outlet', 'Enchantment', 'Sacrifice a creature: This enchantment deals 1 damage to any target.'],
    ['token-maker', 'Sorcery', 'Create two 1/1 red Goblin creature tokens.'],
    ['anthem', 'Enchantment', 'Creatures you control get +1/+1.'],
    ['equipment', 'Artifact — Equipment', 'Equipped creature gets +2/+0.'],
    ['aura', 'Enchantment — Aura', 'Enchanted creature gets +3/+3.'],
    ['evasion', 'Creature — Bird', 'Flying'],
    ['evasion', 'Creature — Rogue', "This creature can't be blocked."],
    ['graveyard-hate', 'Artifact', "Exile target player's graveyard."],
    ['wincon', 'Enchantment', 'At the beginning of your upkeep, you win the game.'],
    ['stax', 'Artifact', 'Creature spells cost {1} more to cast.'],
    ['stax', 'Enchantment', "Permanents don't untap during their untap step."],
  ] as const)('detects %s', (role, typeLine, text) => {
    expect(rolesOf(typeLine, text)).toContain(role)
  })

  it('assigns several roles to a card that does several things', () => {
    const roles = rolesOf('Instant', 'Destroy target creature. Draw a card.')
    expect(roles).toContain('spot-removal')
    expect(roles).toContain('draw')
  })

  it('falls back to synergy rather than to nothing', () => {
    const result = deriveRoles(c('Creature — Human', 'Vigilance'))
    expect(result.roles).toEqual(['synergy'])
    expect(result.primary).toBe('synergy')
  })
})

describe('lands', () => {
  // A land that draws a card must still count as a land, or the land count —
  // the first number anyone checks — silently comes up short.
  it('classifies a land as land only, whatever else its text does', () => {
    expect(rolesOf('Land', '{T}: Add {R}.')).toEqual(['land'])
    expect(rolesOf('Land', '{T}: Add {C}. {2}, {T}, Sacrifice this land: Draw a card.')).toEqual(['land'])
    expect(rolesOf('Land — Forest', '({T}: Add {G}.)')).toEqual(['land'])
  })

  it('treats a creature-land as a land', () => {
    expect(rolesOf('Creature Land — Elemental', 'Flying. {T}: Add {U}.')).toEqual(['land'])
  })
})

describe('primaryRole', () => {
  it('picks the highest-precedence role so counting cannot double up', () => {
    expect(primaryRole(['draw', 'ramp'])).toBe('ramp')
    expect(primaryRole(['synergy', 'land'])).toBe('land')
    expect(primaryRole(['wincon', 'spot-removal'])).toBe('spot-removal')
  })

  it('falls back to synergy for an empty or unknown set', () => {
    expect(primaryRole([])).toBe('synergy')
  })

  it('lists every role exactly once, so precedence is total', () => {
    expect(new Set(ROLE_PRECEDENCE).size).toBe(ROLE_PRECEDENCE.length)
  })
})
