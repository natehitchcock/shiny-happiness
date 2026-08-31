import { describe, expect, it } from 'vitest'
import { cardImpact, type ImpactInput } from './impact.js'

/**
 * The impact model (doc 18 §18.3–§18.5).
 *
 * Every card here is a REAL card with its real oracle text, copied from the
 * corpus rather than hand-written (AGENTS.md §4: fixtures over mocks). A
 * hand-written "destroy all creatures" teaches nothing about the seventeen ways
 * real Magic templating is weird — reminder text, self-reference by name,
 * self-reference by "this creature", keywords that change targeting.
 */
const card = (over: Partial<ImpactInput>): ImpactInput => ({
  name: 'Test Card',
  manaCost: '{1}',
  oracleText: '',
  typeLine: 'Artifact',
  ...over,
})

const WRATH_OF_GOD = card({
  name: 'Wrath of God',
  manaCost: '{2}{W}{W}',
  typeLine: 'Sorcery',
  oracleText: "Destroy all creatures. They can't be regenerated.",
})

const CYCLONIC_RIFT = card({
  name: 'Cyclonic Rift',
  manaCost: '{1}{U}',
  typeLine: 'Instant',
  oracleText:
    'Return target nonland permanent you don\'t control to its owner\'s hand.\nOverload {6}{U} (You may cast this spell for its overload cost. If you do, change "target" in its text to "each.")',
})

const LIGHTNING_BOLT = card({
  name: 'Lightning Bolt',
  manaCost: '{R}',
  typeLine: 'Instant',
  oracleText: 'Lightning Bolt deals 3 damage to any target.',
})

const TORMENT_OF_HAILFIRE = card({
  name: 'Torment of Hailfire',
  manaCost: '{X}{B}{B}',
  typeLine: 'Sorcery',
  oracleText:
    'Repeat the following process X times. Each opponent loses 3 life unless that player sacrifices a nonland permanent of their choice or discards a card.',
})

const SOL_RING = card({
  name: 'Sol Ring',
  manaCost: '{1}',
  typeLine: 'Artifact',
  oracleText: '{T}: Add {C}{C}.',
})

const RHYSTIC_STUDY = card({
  name: 'Rhystic Study',
  manaCost: '{2}{U}',
  typeLine: 'Enchantment',
  oracleText:
    'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
})

const GRIZZLY_BEARS = card({
  name: 'Grizzly Bears',
  manaCost: '{1}{G}',
  typeLine: 'Creature — Bear',
  oracleText: '',
})

const VIRIDIAN_ZEALOT = card({
  name: 'Viridian Zealot',
  manaCost: '{1}{G}',
  typeLine: 'Creature — Elf Warrior',
  oracleText:
    '{1}{G}, Sacrifice this creature: Destroy target artifact or enchantment.\nRegenerate this creature.',
})

const CRATERHOOF = card({
  name: 'Craterhoof Behemoth',
  manaCost: '{5}{G}{G}{G}',
  typeLine: 'Creature — Beast',
  oracleText:
    'Haste\nWhen this creature enters, creatures you control gain trample and get +X/+X until end of turn, where X is the number of creatures you control.',
})

describe('cardImpact', () => {
  describe('a card with no rules text', () => {
    it('scores exactly zero, not the floor tier', () => {
      // Not a rounding convenience. `efficiency.ts` calibrates against vanilla
      // creatures, and a measuring stick with a nonzero reading at zero cannot
      // calibrate anything.
      expect(cardImpact(GRIZZLY_BEARS).score).toBe(0)
    })

    it('treats whitespace-only text as no text', () => {
      expect(cardImpact(card({ oracleText: '  \n ' })).score).toBe(0)
    })
  })

  describe('breadth', () => {
    it('reads "all creatures" as unbounded', () => {
      expect(cardImpact(WRATH_OF_GOD).breadth).toBe('unbounded')
    })

    it('reads "each opponent" as unbounded', () => {
      expect(cardImpact(TORMENT_OF_HAILFIRE).breadth).toBe('unbounded')
    })

    it('reads a bare plural you control as unbounded', () => {
      // Craterhoof has no quantifier at all. Under the scoped "all / each"
      // signal it landed in `none` and scored 0.5 — as would every anthem,
      // every lord and every Overrun variant (doc 18 §18.10 item 3).
      expect(cardImpact(CRATERHOOF).breadth).toBe('unbounded')
    })

    it('reads overload as unbounded even though the sentence targets one thing', () => {
      // The unbounded mode is in the keyword, not in the sentence.
      expect(cardImpact(CYCLONIC_RIFT).breadth).toBe('unbounded')
    })

    it('does NOT read the word "each" out of reminder text', () => {
      // Cyclonic Rift's own reminder text contains `change "target" in its text
      // to "each."`. Without stripping parentheticals this fires on hundreds of
      // cards that are not mass effects at all.
      const withoutOverload = card({
        name: 'Reminder Only',
        typeLine: 'Instant',
        oracleText: 'Draw a card. (Then change "target" in its text to "each.")',
      })
      expect(cardImpact(withoutOverload).breadth).toBe('none')
    })

    it('reads one target', () => {
      expect(cardImpact(LIGHTNING_BOLT).breadth).toBe('one')
    })

    it('reads "up to two target" as few and "up to three" as several', () => {
      const two = card({ typeLine: 'Instant', oracleText: 'Destroy up to two target creatures.' })
      const three = card({
        typeLine: 'Instant',
        oracleText: 'Destroy up to three target creatures.',
      })
      expect(cardImpact(two).breadth).toBe('few')
      expect(cardImpact(three).breadth).toBe('several')
    })

    it('reads "X target" as variable rather than as a count', () => {
      const fireball = card({
        name: 'Rolling Thunder',
        manaCost: '{X}{R}{R}',
        typeLine: 'Sorcery',
        oracleText: 'Rolling Thunder deals X damage divided as you choose among X targets.',
      })
      expect(cardImpact(fireball).breadth).toBe('variable')
      expect(cardImpact(fireball).scales).toBe(true)
    })

    it('orders the tiers superlinearly, with unbounded a step of its own', () => {
      // Four sentences with identical stakes (`opposing`) and no symmetry
      // discount, so the only thing varying between them is breadth.
      const at = (text: string): number =>
        cardImpact(card({ typeLine: 'Instant', oracleText: text })).score
      const one = at('Destroy target creature.')
      const few = at('Destroy up to two target creatures.')
      const several = at('Destroy up to three target creatures.')
      const unbounded = at('Destroy all creatures an opponent controls.')
      expect(few / one).toBeGreaterThan(2)
      expect(several / one).toBeGreaterThan(3)
      // The step to unbounded is the height of the whole counted ladder.
      expect(unbounded - several).toBeCloseTo(several - one, 5)
    })
  })

  describe('persistence', () => {
    it('calls an instant or sorcery one-shot however its text reads', () => {
      expect(cardImpact(WRATH_OF_GOD).persistence).toBe('one-shot')
    })

    it('reads an activated ability', () => {
      expect(cardImpact(SOL_RING).persistence).toBe('activated')
    })

    it('reads a triggered ability', () => {
      expect(cardImpact(RHYSTIC_STUDY).persistence).toBe('triggered')
    })

    it('reads an upkeep trigger above a conditional one', () => {
      const upkeep = card({
        typeLine: 'Enchantment',
        oracleText: 'At the beginning of your upkeep, draw a card.',
      })
      expect(cardImpact(upkeep).persistence).toBe('upkeep')
      expect(cardImpact(upkeep).score).toBeGreaterThan(cardImpact(RHYSTIC_STUDY).score)
    })

    it('forces a self-sacrificing ability back to one-shot', () => {
      // Viridian Zealot is a Naturalize with a body, not a repeating ability.
      expect(cardImpact(VIRIDIAN_ZEALOT).fragile).toBe(true)
      expect(cardImpact(VIRIDIAN_ZEALOT).persistence).toBe('one-shot')
    })

    it('detects self-sacrifice written with the card name, not just "this creature"', () => {
      // Cards printed before the 2024 templating change name themselves.
      const old = card({
        name: 'Masticore',
        typeLine: 'Artifact Creature — Masticore',
        oracleText:
          'At the beginning of your upkeep, sacrifice Masticore unless you discard a card.\n{2}: Masticore deals 1 damage to any target.',
      })
      expect(cardImpact(old).fragile).toBe(true)
      expect(cardImpact(old).persistence).toBe('one-shot')
    })
  })

  describe('stakes', () => {
    it('reads "any target" as reaching a player', () => {
      expect(cardImpact(LIGHTNING_BOLT).stakes).toBe('player')
    })

    it('reads an unrestricted target creature as opposing, not as its own tier', () => {
      // Scoring Swords to Plowshares below a card that may only hit an
      // opponent's creatures would rank a strictly worse card higher.
      const swords = card({
        name: 'Swords to Plowshares',
        typeLine: 'Instant',
        oracleText: 'Exile target creature. Its controller gains life equal to its power.',
      })
      expect(cardImpact(swords).stakes).toBe('opposing')
    })

    it('reads a pump spell on your own board as own', () => {
      expect(cardImpact(CRATERHOOF).stakes).toBe('own')
    })

    it('reads a card that names nobody as self', () => {
      expect(cardImpact(SOL_RING).stakes).toBe('self')
    })
  })

  describe('symmetry', () => {
    it('marks a wrath that hits your board as symmetric', () => {
      expect(cardImpact(WRATH_OF_GOD).symmetry).toBe('symmetric')
    })

    it('marks an each-opponent effect as one-sided', () => {
      expect(cardImpact(TORMENT_OF_HAILFIRE).symmetry).toBe('one-sided')
    })

    it('is none for anything that is not a mass effect', () => {
      // A third symmetry value rather than reusing `one-sided`: "not board-wide"
      // and "board-wide and spares you" are different claims.
      expect(cardImpact(LIGHTNING_BOLT).symmetry).toBe('none')
    })

    it('discounts the symmetric one below the one-sided one at equal breadth', () => {
      // Both are "destroy all creatures"; only the restriction differs. This is
      // the `each opponent` vs `all creatures` distinction the card-intrinsic
      // decision forbids resolving against the deck, resolved against the caster
      // instead (doc 18 §18.5).
      const symmetric = card({ typeLine: 'Sorcery', oracleText: 'Destroy all creatures.' })
      const oneSided = card({
        typeLine: 'Sorcery',
        oracleText: "Destroy all creatures you don't control.",
      })
      expect(cardImpact(symmetric).symmetry).toBe('symmetric')
      expect(cardImpact(oneSided).symmetry).toBe('one-sided')
      expect(cardImpact(symmetric).score).toBeLessThan(cardImpact(oneSided).score)
    })
  })

  describe('scales', () => {
    it('marks an {X} cost', () => {
      expect(cardImpact(TORMENT_OF_HAILFIRE).scales).toBe(true)
    })

    it('marks "for each"', () => {
      const each = card({
        typeLine: 'Sorcery',
        oracleText: 'Draw a card for each creature you control.',
      })
      expect(cardImpact(each).scales).toBe(true)
    })

    it('does not mark a card whose effect is a constant', () => {
      expect(cardImpact(LIGHTNING_BOLT).scales).toBe(false)
    })
  })

  describe('the ordering a Magic player would check', () => {
    it('puts the mass effects above the spot removal above the mana rock', () => {
      const score = (c: ImpactInput): number => cardImpact(c).score
      expect(score(TORMENT_OF_HAILFIRE)).toBeGreaterThan(score(CYCLONIC_RIFT))
      expect(score(CYCLONIC_RIFT)).toBeGreaterThan(score(WRATH_OF_GOD))
      expect(score(WRATH_OF_GOD)).toBeGreaterThan(score(LIGHTNING_BOLT))
      expect(score(LIGHTNING_BOLT)).toBeGreaterThan(score(RHYSTIC_STUDY))
      expect(score(RHYSTIC_STUDY)).toBeGreaterThan(score(SOL_RING))
      expect(score(SOL_RING)).toBeGreaterThan(score(GRIZZLY_BEARS))
    })

    it('pins the measured values, so a tier change cannot pass silently', () => {
      expect(cardImpact(TORMENT_OF_HAILFIRE).score).toBe(8.4)
      expect(cardImpact(CYCLONIC_RIFT).score).toBe(7.2)
      expect(cardImpact(WRATH_OF_GOD).score).toBe(6.12)
      expect(cardImpact(LIGHTNING_BOLT).score).toBe(1.4)
      expect(cardImpact(RHYSTIC_STUDY).score).toBe(0.808)
      expect(cardImpact(SOL_RING).score).toBe(0.68)
      expect(cardImpact(GRIZZLY_BEARS).score).toBe(0)
    })
  })
})
