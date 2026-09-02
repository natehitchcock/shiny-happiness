import { describe, expect, it } from 'vitest'
import { IMPACT_MAX, cardImpact, type ImpactInput } from './impact.js'

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

const FOREST = card({
  name: 'Forest',
  manaCost: null,
  typeLine: 'Basic Land — Forest',
  oracleText: '({T}: Add {G}.)',
})

const NEVINYRRALS_DISK = card({
  name: "Nevinyrral's Disk",
  manaCost: '{4}',
  typeLine: 'Artifact',
  oracleText:
    'This artifact enters tapped.\n{1}, {T}: Destroy all artifacts, creatures, and enchantments.',
})

const AGATHAS_SOUL_CAULDRON = card({
  name: "Agatha's Soul Cauldron",
  manaCost: '{2}',
  typeLine: 'Legendary Artifact',
  oracleText:
    "You may spend mana as though it were mana of any color to activate abilities of creatures you control.\nCreatures you control with +1/+1 counters on them have all activated abilities of all creature cards exiled with Agatha's Soul Cauldron.\n{T}: Exile target card from a graveyard. When a creature card is exiled this way, put a +1/+1 counter on target creature you control.",
})

const EMIEL = card({
  name: 'Emiel the Blessed',
  manaCost: '{2}{G}{W}',
  typeLine: 'Legendary Creature — Unicorn',
  oracleText:
    "{3}: Exile another target creature you control, then return it to the battlefield under its owner's control.\nWhenever another creature you control enters, you may pay {G/W}. If you do, put a +1/+1 counter on it. If it's a Unicorn, put two +1/+1 counters on it instead. ({G/W} can be paid with either {G} or {W}.)",
})

const REGAL_BUNNICORN = card({
  name: 'Regal Bunnicorn',
  manaCost: '{1}{W}',
  typeLine: 'Creature — Rabbit Unicorn',
  oracleText:
    "Regal Bunnicorn's power and toughness are each equal to the number of nonland permanents you control.",
})

const ZANAM_DJINN = card({
  name: 'Zanam Djinn',
  manaCost: '{4}{U}{U}',
  typeLine: 'Creature — Djinn',
  oracleText:
    'Flying\nThis creature gets -2/-2 as long as blue is the most common color among all permanents or is tied for most common.',
})

const JOKULHAUPS = card({
  name: 'Jokulhaups',
  manaCost: '{4}{R}{R}',
  typeLine: 'Sorcery',
  oracleText: "Destroy all artifacts, creatures, and lands. They can't be regenerated.",
})

const SPLENDID_RECLAMATION = card({
  name: 'Splendid Reclamation',
  manaCost: '{3}{G}',
  typeLine: 'Sorcery',
  oracleText: 'Return all land cards from your graveyard to the battlefield tapped.',
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

    it('treats text that is ENTIRELY reminder text as no text', () => {
      // A basic Forest prints `({T}: Add {G}.)` — a parenthetical restating a
      // rule the land has by virtue of its type, not rules text. doc 18 §18.10
      // item 6 already strips reminder text before anything is matched; the
      // empty check simply ran before the strip, so 22 commander-legal cards —
      // every basic, every original dual, Icehide Golem, Dryad Arbor — took the
      // `none` floor of 0.425 instead of the 0 they earn.
      expect(cardImpact(FOREST).score).toBe(0)
      expect(cardImpact(FOREST).breadth).toBe('none')
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

/**
 * WHAT THE EFFECT ACTUALLY TOUCHES, AND WHOSE SIDE IT LANDS ON.
 *
 * Four rule classes, each found by scoring the whole corpus and reading the
 * cards the model most likely got wrong, rather than by inspecting the regexes.
 * Every fixture below is a real card with its real oracle text.
 */
describe('reach is the set the effect touches, not every plural in the sentence', () => {
  it('does not read reach out of a clause that COUNTS a group', () => {
    // Regal Bunnicorn's power counts your permanents; it does not affect them.
    // Read as a mass effect it scored 6.0 — the same reach as Craterhoof
    // Behemoth, off a two-mana creature that does nothing at all.
    expect(cardImpact(REGAL_BUNNICORN).breadth).toBe('none')
  })

  it('does not read reach out of a COMPARISON across the board', () => {
    // "the most common color among all permanents" is a condition on a
    // creature's own stats. Zanam Djinn scored 7.2, above Wrath of God.
    expect(cardImpact(ZANAM_DJINN).breadth).toBe('none')
  })

  it('still reads a bare plural that the effect really does touch', () => {
    // The counter-example that bounds the rule above. Craterhoof's text
    // contains BOTH — "creatures you control gain trample" is the effect, "the
    // number of creatures you control" is the count — and stripping the count
    // must leave the effect standing.
    expect(cardImpact(CRATERHOOF).breadth).toBe('unbounded')
    expect(cardImpact(CRATERHOOF).score).toBe(6)
  })

  it('leaves the effect that FOLLOWS a count standing', () => {
    /*
     * The counter-example the whole-corpus diff caught, and the reason the
     * measured span stops at the noun it counts instead of running to the end
     * of the clause. "…equal to the number of +1/+1 counters on it TO EACH
     * OPPONENT" carries the count in the middle and the effect at the end;
     * eating the clause ate "each opponent" with it, and Hallar fell from 15.96
     * to 0.808. Armageddon Clock and Dáin of the Ancient Halls failed the same
     * way. None of the three is caught by any assertion above — only by diffing
     * all 31,782 cards and reading what moved.
     */
    const hallar = card({
      name: 'Hallar, the Firefletcher',
      manaCost: '{1}{B}{R}{G}',
      typeLine: 'Legendary Creature — Elf Archer',
      oracleText:
        'Trample\nWhenever you cast a spell, if that spell was kicked, put a +1/+1 counter on Hallar, then Hallar deals damage equal to the number of +1/+1 counters on it to each opponent.',
    })
    expect(cardImpact(hallar).breadth).toBe('unbounded')
    expect(cardImpact(hallar).stakes).toBe('player')
  })

  it('still reads X targets as variable, because "among" is not always counting', () => {
    // "divided as you choose among X targets" is a targeting clause wearing the
    // same preposition. Only a measuring HEAD — number of, most common, mana
    // value among — makes a clause a count.
    const fireball = card({
      name: 'Rolling Thunder',
      manaCost: '{X}{R}{R}',
      typeLine: 'Sorcery',
      oracleText: 'Rolling Thunder deals X damage divided as you choose among X targets.',
    })
    expect(cardImpact(fireball).breadth).toBe('variable')
  })
})

describe('falls on — whose side the effect lands on', () => {
  it('reads "target creature you control" as your own side, not an opponent\'s', () => {
    // The OPPOSING pattern matched the bare `target creature` inside
    // `target creature you control` and never reached the `you control` branch.
    // 1,070 commander-legal cards were told they hit an opponent's board while
    // exiling, untapping or pumping the caster's own creature.
    expect(cardImpact(EMIEL).stakes).toBe('own')
  })

  it('still reads an unrestricted target creature as opposing', () => {
    // The counter-example. Only ` you control` is excluded; a bare target is
    // still chosen by the caster and still points at an opponent (doc 18 §18.5).
    const swords = card({
      name: 'Swords to Plowshares',
      typeLine: 'Instant',
      oracleText: 'Exile target creature. Its controller gains life equal to its power.',
    })
    expect(cardImpact(swords).stakes).toBe('opposing')
    expect(cardImpact(swords).score).toBe(1.2)
  })

  it('does not send a mass effect scoped entirely to your own side to an opponent', () => {
    // `breadth === 'unbounded'` short-circuited to `opposing` before the
    // `you control` branch was ever consulted, and `yoursOnly` only rescued a
    // card whose plural carried NO quantifier. Agatha's Soul Cauldron says
    // "creatures you control" three times and named an opponent nowhere.
    const agatha = cardImpact(AGATHAS_SOUL_CAULDRON)
    expect(agatha.stakes).toBe('own')
    expect(agatha.symmetry).toBe('one-sided')
    expect(agatha.breadth).toBe('unbounded')
  })

  it('reads "creatures your opponents control" as a board, not as the players', () => {
    /*
     * The second thing the corpus diff caught, and it was invisible until the
     * scope test above was fixed. `opponents` was read as "this reaches
     * people", which is true of "each opponent loses 3 life" and false of
     * "creatures your opponents control get -1/-1" — where the possessive is
     * doing nothing but naming whose board. The broken `yoursOnly` used to
     * claim these cards first and call them `own`, which was also wrong; with
     * that gone they fell through to `player`, and Doomwake Giant went from
     * 11.4 to 15.96 for shrinking the opposing team by one. 48 cards moved.
     */
    const doomwake = card({
      name: 'Doomwake Giant',
      manaCost: '{4}{B}',
      typeLine: 'Creature — Giant',
      oracleText:
        'Constellation — Whenever this creature or another enchantment you control enters, creatures your opponents control get -1/-1 until end of turn.',
    })
    expect(cardImpact(doomwake).stakes).toBe('opposing')
    expect(cardImpact(doomwake).breadth).toBe('unbounded')
  })

  it('still reads "each opponent" as reaching the people', () => {
    // The counter-example that bounds it. Torment of Hailfire takes life and
    // cards from a person, and `player` is exactly right for it.
    expect(cardImpact(TORMENT_OF_HAILFIRE).stakes).toBe('player')
    expect(cardImpact(TORMENT_OF_HAILFIRE).score).toBe(8.4)
  })

  it('still sends an unrestricted wrath to the whole board', () => {
    // The counter-example that bounds it: a card may say "you control"
    // somewhere and still wipe everything, so an unrestricted mass effect
    // overrides the scope test rather than losing to it.
    expect(cardImpact(WRATH_OF_GOD).stakes).toBe('opposing')
    expect(cardImpact(WRATH_OF_GOD).symmetry).toBe('symmetric')
    expect(cardImpact(WRATH_OF_GOD).score).toBe(6.12)
  })
})

describe('symmetry — a wipe that names a list of types still hits your board', () => {
  it("marks Nevinyrral's Disk symmetric", () => {
    // The symmetric signal only ever looked for `all creatures`, so
    // "Destroy all artifacts, creatures, and enchantments" — where `all` is
    // followed by `artifacts` — read as one-sided, and the pane told a builder
    // the Disk spares their board.
    const disk = cardImpact(NEVINYRRALS_DISK)
    expect(disk.symmetry).toBe('symmetric')
    expect(disk.stakes).toBe('opposing')
    expect(disk.score).toBe(9.792)
  })

  it('marks a wipe over every permanent type symmetric', () => {
    expect(cardImpact(JOKULHAUPS).symmetry).toBe('symmetric')
  })

  it('does NOT mark a mass effect on CARDS IN A ZONE symmetric', () => {
    // The counter-example that bounds it. "all land cards from your graveyard"
    // is a zone, not a board, and the caster is the only one it touches — the
    // `cards` exclusion is what keeps every graveyard recursion spell out of
    // the wrath population.
    expect(cardImpact(SPLENDID_RECLAMATION).symmetry).toBe('one-sided')
  })

  it('still spares the caster where the text restricts the wipe', () => {
    const oneSided = card({
      typeLine: 'Sorcery',
      oracleText: "Destroy all artifacts, creatures, and enchantments you don't control.",
    })
    expect(cardImpact(oneSided).symmetry).toBe('one-sided')
  })
})

/**
 * The ceiling a renderer divides by.
 *
 * Two claims, and both have to hold or the proportion an interface draws is a
 * lie: the number is 18.48, and it is a score a card can actually reach.
 */
describe('IMPACT_MAX', () => {
  it('is the product of the three top rungs', () => {
    expect(IMPACT_MAX).toBe(18.48)
  })

  it('is reachable — an upkeep trigger over every opponent scores exactly it', () => {
    // Not a bound nobody touches. `unbounded` breadth plus `each opponent`
    // takes `player` stakes and the `one-sided` symmetry branch, so no discount
    // applies and the product stands.
    const ceiling = card({
      name: 'Ceiling',
      typeLine: 'Enchantment',
      oracleText: 'At the beginning of your upkeep, each opponent loses 1 life.',
    })
    const at = cardImpact(ceiling)
    expect(at.breadth).toBe('unbounded')
    expect(at.persistence).toBe('upkeep')
    expect(at.stakes).toBe('player')
    expect(at.symmetry).toBe('one-sided')
    expect(at.score).toBe(IMPACT_MAX)
  })

  it('bounds every fixture, so nothing can draw past the end of a meter', () => {
    for (const c of [
      TORMENT_OF_HAILFIRE,
      CYCLONIC_RIFT,
      WRATH_OF_GOD,
      LIGHTNING_BOLT,
      RHYSTIC_STUDY,
      SOL_RING,
      GRIZZLY_BEARS,
    ]) {
      expect(cardImpact(c).score).toBeLessThanOrEqual(IMPACT_MAX)
    }
  })
})
