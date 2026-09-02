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

/**
 * One clause wins, and it brings its whole tuple with it (ADR-0043).
 *
 * The rule, from the product owner: *"when it comes to choosing one tier per
 * card, choose all the tiers from the highest impact effect."* Score every
 * ability line as a complete `breadth × persistence × stakes × symmetry`, then
 * the card reports the winning line's tiers TOGETHER — never the maximum of
 * each axis taken independently.
 *
 * The defect it removes was named and deferred by the previous audit. Diregraf
 * Captain took `unbounded` off its anthem line and `player` off its drain line
 * and reported the product, 15.96, for a three-mana lord — a combination
 * corresponding to nothing the card does. No line of Diregraf Captain is a
 * board-wide effect aimed at a player's life total.
 *
 * The unit is the ABILITY LINE, newline-separated, and that is ADR-0038's
 * reasoning reused rather than a fresh invention: every pattern here is written
 * `.` or `[^...\n]`, and JavaScript's `.` does not match a newline, so each rule
 * is already confined to one line by construction. A line scored in isolation
 * therefore gives exactly the answer it gave in card context. Splitting on
 * sentences could promise no such thing — Wrath of God's two sentences share a
 * line, and "They can't be regenerated" alone is not a board wipe.
 *
 * Splitting happens AFTER reminder text is stripped, so a parenthetical can
 * never become a clause of its own.
 */
describe('the winning clause brings its whole tuple (ADR-0043)', () => {
  const DIREGRAF_CAPTAIN = card({
    name: 'Diregraf Captain',
    manaCost: '{1}{U}{B}',
    typeLine: 'Creature — Zombie Soldier',
    oracleText:
      'Deathtouch\nOther Zombie creatures you control get +1/+1.\nWhenever another Zombie you control dies, target opponent loses 1 life.',
  })

  it('reports the lord clause wholesale, not a tuple assembled from two clauses', () => {
    const at = cardImpact(DIREGRAF_CAPTAIN)
    expect(at.breadth).toBe('unbounded')
    expect(at.stakes).toBe('own')
    expect(at.persistence).toBe('one-shot')
    expect(at.symmetry).toBe('one-sided')
  })

  it('prices the three-mana lord as a lord', () => {
    // 6.0 is what every other anthem scores — Glorious Anthem and Knight
    // Exemplar both sit there. 15.96 put it above Wrath of God.
    expect(cardImpact(DIREGRAF_CAPTAIN).score).toBe(6.0)
    expect(cardImpact(DIREGRAF_CAPTAIN).score).toBeLessThan(cardImpact(WRATH_OF_GOD).score)
  })

  it('never combines a breadth and a stakes that no single clause had', () => {
    // The general property, stated so it cannot regress quietly: whatever tuple
    // the card reports, some ONE line must produce it on its own.
    const lines = [
      'Other Zombie creatures you control get +1/+1.',
      'Whenever another Zombie you control dies, target opponent loses 1 life.',
      'Deathtouch',
    ]
    const at = cardImpact(DIREGRAF_CAPTAIN)
    const alone = lines.map((l) =>
      cardImpact(
        card({ name: 'Diregraf Captain', typeLine: 'Creature — Zombie Soldier', oracleText: l }),
      ),
    )
    expect(
      alone.some(
        (a) =>
          a.breadth === at.breadth && a.stakes === at.stakes && a.persistence === at.persistence,
      ),
    ).toBe(true)
  })

  it('leaves a single-line card exactly where it was', () => {
    // Wrath of God is one line carrying two sentences. If the splitter ever
    // cut on sentences instead, "They can't be regenerated." would score alone
    // and the wipe would lose its board.
    expect(cardImpact(WRATH_OF_GOD).score).toBe(6.12)
    expect(cardImpact(WRATH_OF_GOD).breadth).toBe('unbounded')
  })

  it('holds the six regression anchors', () => {
    // Quoted in doc 18 and in prior ADRs. None of them may move without a
    // reason written down beside it, and none of them moved.
    const swords = card({
      name: 'Swords to Plowshares',
      manaCost: '{W}',
      typeLine: 'Instant',
      oracleText: 'Exile target creature. Its controller gains life equal to its power.',
    })
    expect(cardImpact(WRATH_OF_GOD).score).toBe(6.12)
    expect(cardImpact(CRATERHOOF).score).toBe(6.0)
    expect(cardImpact(SOL_RING).score).toBe(0.68)
    expect(cardImpact(FOREST).score).toBe(0)
    expect(cardImpact(CYCLONIC_RIFT).score).toBe(7.2)
    expect(cardImpact(swords).score).toBe(1.2)
  })

  it('keeps Cyclonic Rift on its overload line, which is a line of its own', () => {
    // The two lines score 1.2 and 7.2. The overload keyword is the winner and
    // it carries `unbounded`, so the card still reports the mass mode.
    const at = cardImpact(CYCLONIC_RIFT)
    expect(at.breadth).toBe('unbounded')
    expect(at.stakes).toBe('opposing')
  })

  it('keeps fragility a fact about the card, not about one clause', () => {
    // When the card sacrifices itself EVERY clause stops, so this one stays
    // card-level and pins every line to one-shot. Viridian Zealot is a
    // Naturalize with a body however you split it.
    expect(cardImpact(VIRIDIAN_ZEALOT).fragile).toBe(true)
    expect(cardImpact(VIRIDIAN_ZEALOT).persistence).toBe('one-shot')
  })

  it('does not move IMPACT_MAX — no tier VALUE changed, only which tier a clause lands in', () => {
    expect(IMPACT_MAX).toBe(18.48)
  })
})

/**
 * A standing modification to a class of your FUTURE spells is repeat, not reach.
 *
 * The report was Quandrix, the Proof: *"gives spells cascade, shouldn't that
 * mean that his reach is every spell cast? Or he repeats every spell cast?"* —
 * and it is the second one.
 *
 * Breadth counts what one effect touches AT ONCE. A cascade grant touches one
 * spell at a time; it is the same effect happening again on the next spell,
 * which is the persistence axis by its own definition — "none of the cost
 * recurs, conditional on an event" — and casting a spell is the event.
 *
 * The model already agreed and could not say so. Teval, Arbiter of Virtue
 * carries BOTH phrasings — the static "Spells you cast have delve" and the
 * triggered "Whenever you cast a spell, you lose life equal to its mana value" —
 * and scored `none/triggered/self` off the second clause alone. Breadth and
 * stakes already matched between the two forms. Persistence was the ONLY axis
 * that differed, and it differed because the static spelling never says the
 * word `whenever`, so the ladder fell through to `one-shot`.
 *
 * The ordering that proves it was broken: Yidris, Maelstrom Wielder grants
 * cascade only after connecting in combat and only for that turn, and scored
 * 0.808. Quandrix grants it unconditionally, every turn, for the rest of the
 * game, and scored 0.425 — the model's absolute floor, the same number as a
 * creature whose only text is a keyword. The strictly conditional card
 * outranked the unconditional one and the whole difference was one word.
 */
describe('a static grant to a class of your future spells (the Quandrix report)', () => {
  const QUANDRIX = card({
    name: 'Quandrix, the Proof',
    manaCost: '{4}{G}{U}',
    typeLine: 'Legendary Creature — Elder Dragon',
    oracleText:
      'Flying, trample\nCascade (When you cast this spell, exile cards from the top of your library until you exile a nonland card that costs less. You may cast it without paying its mana cost. Put the exiled cards on the bottom in a random order.)\nInstant and sorcery spells you cast from your hand have cascade.',
  })

  const FLAMEKIN_HERALD = card({
    name: 'Flamekin Herald',
    manaCost: '{2}{R}',
    typeLine: 'Creature — Elemental Shaman',
    oracleText:
      'Commander spells you cast have cascade. (Whenever you cast a commander, exile cards from the top of your library until you exile a nonland card with lesser mana value. You may cast it without paying its mana cost. Put the exiled cards on the bottom in a random order.)',
  })

  it('reads the grant as triggered though the card never says "whenever"', () => {
    expect(cardImpact(QUANDRIX).persistence).toBe('triggered')
  })

  it('leaves breadth alone — one spell at a time is not every spell at once', () => {
    // This is the ruling. Handing an open-ended SERIAL class `unbounded`
    // breadth would put Flamekin Herald — a three-mana 1/1 whose grant reaches
    // only commander spells — level with Craterhoof Behemoth at 6.0.
    expect(cardImpact(QUANDRIX).breadth).toBe('none')
    expect(cardImpact(FLAMEKIN_HERALD).breadth).toBe('none')
    expect(cardImpact(FLAMEKIN_HERALD).score).toBeLessThan(cardImpact(CRATERHOOF).score)
  })

  it('is not fooled by the cascade REMINDER TEXT the grant carries', () => {
    // Quandrix's own reminder says "When you cast this spell" and Flamekin
    // Herald's says "Whenever you cast a commander". A classifier reading
    // either would be right here for entirely the wrong reason and wrong on
    // every card that carries a cascade reminder and grants nothing. The
    // trample reminder that once made Colossal Dreadmaw a burn payoff is the
    // same trap. A card whose only parenthetical is a trigger word must still
    // come out one-shot.
    const reminderOnly = card({
      name: 'Reminder Only',
      typeLine: 'Creature — Dinosaur',
      oracleText:
        'Cascade (When you cast this spell, exile cards from the top of your library until you exile a nonland card that costs less.)',
    })
    expect(cardImpact(reminderOnly).persistence).toBe('one-shot')
    expect(cardImpact(reminderOnly).score).toBe(0.425)
  })

  it('no longer ranks the conditional one-turn grant above the permanent one', () => {
    const yidris = card({
      name: 'Yidris, Maelstrom Wielder',
      manaCost: '{2}{B}{G}{U}{R}',
      typeLine: 'Legendary Creature — Human Wizard',
      oracleText:
        'Trample\nWhenever Yidris deals combat damage to a player, as you cast spells from your hand this turn, they gain cascade.',
    })
    expect(cardImpact(QUANDRIX).score).toBeGreaterThanOrEqual(cardImpact(yidris).score)
  })

  it('covers cost reduction, the same clause with a different payload', () => {
    // "Spells you cast cost {1} less" applies once per spell cast, on an event,
    // with nothing recurring. Same shape as the cascade grant; no principled
    // reason to separate them.
    const jetMedallion = card({
      name: 'Jet Medallion',
      manaCost: '{2}',
      typeLine: 'Artifact',
      oracleText: 'Black spells you cast cost {1} less to cast.',
    })
    expect(cardImpact(jetMedallion).persistence).toBe('triggered')
  })

  it('does not promote a grant that lasts only one turn', () => {
    // A STANDING modification is the shape. "Spells you cast this turn cost {1}
    // less" is a one-turn effect hung off an attack or landfall trigger, and 28
    // commander-legal cards say exactly that. Promoting them would price a Saga
    // chapter as a permanent engine.
    const oneTurn = card({
      name: 'One Turn Only',
      typeLine: 'Enchantment',
      oracleText: 'Spells you cast this turn cost {1} less to cast.',
    })
    expect(cardImpact(oneTurn).persistence).toBe('one-shot')
  })

  it('leaves an instant or sorcery one-shot whatever it grants', () => {
    const sorcery = card({
      name: 'Sorcery Grant',
      typeLine: 'Sorcery',
      oracleText: 'Spells you cast cost {1} less to cast.',
    })
    expect(cardImpact(sorcery).persistence).toBe('one-shot')
  })

  it('does not let the grant outrank an upkeep clause on the same card', () => {
    // The winning-clause rule still decides. An upkeep trigger scores above a
    // spell grant, so it is the upkeep line's tuple that is reported.
    const both = card({
      name: 'Both',
      typeLine: 'Enchantment',
      oracleText:
        'Spells you cast cost {1} less to cast.\nAt the beginning of your upkeep, each opponent loses 1 life.',
    })
    expect(cardImpact(both).persistence).toBe('upkeep')
  })
})

/**
 * A class of spells you cast is SERIAL, and a serial class is never board-wide.
 *
 * Found while hunting counter-examples for the ruling above, and it is the
 * BREADTH reading of the same report — already implemented by accident, and
 * already producing wrong numbers.
 *
 * `MASS_QUANTIFIED` lists `spell` among the nouns a mass quantifier may take.
 * That is right for `counter all other spells`: those spells are on the stack
 * together and one effect touches all of them at once. It is wrong for `each
 * spell you cast`, where the spells arrive one at a time across the whole game
 * and no effect ever touches two.
 *
 * The cost, measured: Threefold Signal — *"each spell you cast that's exactly
 * three colors has replicate {3}"* — took `unbounded` breadth, fell through the
 * stakes ladder to `opposing`, and scored 7.2. That is Cyclonic Rift's number,
 * on a card that cannot touch an opponent at all. Goblin Anarchomancer, a
 * two-mana 2/2 making your red and green spells cost {1} less, scored the same
 * 7.2. This is the Colossal Dreadmaw shape: a false positive at the top of the
 * scale, invisible until the whole corpus was diffed.
 *
 * Five commander-legal cards say `each/every/all spell(s) you cast`. The eleven
 * genuine mass effects on the stack say no such thing and do not move.
 */
describe('a serial class of spells is measured on repeat, never on reach', () => {
  const THREEFOLD_SIGNAL = card({
    name: 'Threefold Signal',
    manaCost: '{2}{U}',
    typeLine: 'Artifact',
    oracleText:
      "When this artifact enters, scry 3.\nEach spell you cast that's exactly three colors has replicate {3}. (When you cast it, copy it for each time you paid its replicate cost.)",
  })

  const SWIFT_SILENCE = card({
    name: 'Swift Silence',
    manaCost: '{1}{W}{U}{U}',
    typeLine: 'Instant',
    oracleText: 'Counter all other spells. Draw a card for each spell countered this way.',
  })

  it('does not call a grant to your own spells a board-wide effect', () => {
    expect(cardImpact(THREEFOLD_SIGNAL).breadth).not.toBe('unbounded')
  })

  it('does not report a grant to your own spells as reaching an opponent', () => {
    // The stakes ladder sends anything `unbounded` to `opposing` by default, so
    // the breadth error and the stakes error always arrive together.
    expect(cardImpact(THREEFOLD_SIGNAL).stakes).not.toBe('opposing')
  })

  it('scores it far below Cyclonic Rift, which it used to equal exactly', () => {
    expect(cardImpact(THREEFOLD_SIGNAL).score).toBeLessThan(cardImpact(CYCLONIC_RIFT).score / 2)
  })

  it('still calls "counter all other spells" board-wide — those share a stack', () => {
    // The counter-example that bounds the fix, and it must not move.
    expect(cardImpact(SWIFT_SILENCE).breadth).toBe('unbounded')
    expect(cardImpact(SWIFT_SILENCE).score).toBe(7.2)
  })

  it('still calls a tax on every player board-wide', () => {
    // Trinisphere says "each spell", not "each spell you cast", and it really
    // does apply to everybody.
    const trinisphere = card({
      name: 'Trinisphere',
      manaCost: '{3}',
      typeLine: 'Artifact',
      oracleText:
        'As long as this artifact is untapped, each spell that would cost less than three mana to cast costs three mana to cast.',
    })
    expect(cardImpact(trinisphere).breadth).toBe('unbounded')
  })

  it('reads the TYPE-QUALIFIED spelling of the serial class', () => {
    // "each CREATURE spell you cast" is the same serial class with a type word
    // wedged in. Without the gap Herigast and Henzie kept an unbounded reach,
    // and the new `triggered` reading multiplied it instead of replacing it.
    const herigast = card({
      name: 'Herigast, Erupting Nullkite',
      manaCost: '{4}{R}{R}',
      typeLine: 'Legendary Creature — Dragon',
      oracleText: 'Flying\nEach creature spell you cast has emerge.',
    })
    expect(cardImpact(herigast).breadth).not.toBe('unbounded')
    expect(cardImpact(herigast).persistence).toBe('triggered')
  })

  it('treats a "for each" rider on a spell grant as scaling, not as a second reach', () => {
    // Locket of Yesterdays' whole text. The subject is a serial class of
    // spells; the trailing count says how big the discount is. Read as a mass
    // effect it scored 7.2, and reading the grant as `triggered` would have
    // multiplied that to 13.68 rather than replacing it.
    const locket = card({
      name: 'Locket of Yesterdays',
      manaCost: '{1}',
      typeLine: 'Artifact',
      oracleText:
        'Spells you cast cost {1} less to cast for each card with the same name as that spell in your graveyard.',
    })
    expect(cardImpact(locket).breadth).not.toBe('unbounded')
    expect(cardImpact(locket).score).toBeLessThan(cardImpact(SWIFT_SILENCE).score)
  })

  it('leaves a "for each" count alone on a card with no spell grant', () => {
    // The rider strip is scoped to clauses the grant rule already claimed. The
    // wider gap — a bare `for each <noun>` taking unbounded reach off a clause
    // that only counts — is real and is NOT fixed here; widening the head list
    // was measured at 2,377 cards moved with false negatives among them. Storm
    // Entity documents the untouched state so the follow-up has an anchor.
    const stormEntity = card({
      name: 'Storm Entity',
      manaCost: '{1}{R}',
      typeLine: 'Creature — Elemental',
      oracleText:
        'Haste\nThis creature enters with a +1/+1 counter on it for each other spell cast this turn.',
    })
    expect(cardImpact(stormEntity).breadth).toBe('unbounded')
  })
})

/**
 * A qualifier between `target` and its noun does not make the target yours.
 *
 * Caught by `impact-roles.test.ts`'s CONTROL assertion — `spot-removal` must
 * have `noCountableEffect === 0`, because the model reads every removal spell —
 * which went to 1 once clauses were scored separately. The card was Shadowborn
 * Demon:
 *
 * ```
 * Flying
 * When this creature enters, destroy target non-Demon creature.
 * At the beginning of your upkeep, if there are fewer than six creature cards
 * in your graveyard, sacrifice a creature.
 * ```
 *
 * The tempting diagnosis — that `TARGET` cannot see past a qualifier — is
 * WRONG. `TARGET` is a bare `\btarget\b` and matched fine; the removal clause
 * did get `breadth: 'one'`. What actually happened is that the removal clause
 * scored 0.85 and the upkeep DRAWBACK scored 0.935, so the drawback won the
 * card and brought its own `none` with it.
 *
 * The removal clause scored 0.85 because `OPPOSING` required the noun to sit
 * immediately after `target`. "target non-Demon creature" has a word in
 * between, so it fell through to `self` — 0.85 instead of 1.2 — and lost a
 * comparison it should have won. Fixing the STAKES axis fixes the breadth
 * symptom, because the right clause wins again.
 *
 * 1,472 commander-legal cards contain `target <qualifier> <noun>` and take no
 * `opposing` reading from anywhere in their text. One defect, not one card.
 */
describe('a qualifier between "target" and its noun', () => {
  const SHADOWBORN_DEMON = card({
    name: 'Shadowborn Demon',
    manaCost: '{4}{B}{B}',
    typeLine: 'Creature — Demon',
    oracleText:
      'Flying\nWhen this creature enters, destroy target non-Demon creature.\nAt the beginning of your upkeep, if there are fewer than six creature cards in your graveyard, sacrifice a creature.',
  })

  it('reads "target non-Demon creature" as landing on an opponent', () => {
    const clause = card({
      name: 'Clause',
      typeLine: 'Creature — Demon',
      oracleText: 'When this creature enters, destroy target non-Demon creature.',
    })
    expect(cardImpact(clause).stakes).toBe('opposing')
  })

  it('lets the removal clause win its own card again', () => {
    // The control assertion in impact-roles.test.ts is what this protects: a
    // removal spell must never report `breadth: none`.
    expect(cardImpact(SHADOWBORN_DEMON).breadth).toBe('one')
  })

  it('reads the other common qualifiers the same way', () => {
    for (const text of [
      'Destroy target attacking creature.',
      'Destroy target nonland permanent.',
      'Exile target legendary creature.',
      'Counter target noncreature spell.',
      'Destroy target attacking or blocking creature.',
    ]) {
      expect(cardImpact(card({ typeLine: 'Instant', oracleText: text })).stakes).toBe('opposing')
    }
  })

  it('still refuses a target the text scopes to you', () => {
    // The trailing `you control` lookahead has to survive the widening, or the
    // 1,070 cards ADR-0025's pass rescued go back to being reported as
    // attacking their own caster's board. 162 cards in the widened population
    // say exactly this.
    for (const text of [
      'Exile target legendary creature you control, then return it to the battlefield.',
      'Untap target artifact creature you control.',
      'Copy target instant or sorcery spell you control.',
    ]) {
      expect(cardImpact(card({ typeLine: 'Instant', oracleText: text })).stakes).not.toBe(
        'opposing',
      )
    }
  })

  it('does not read "the target of a spell" as a targeting clause', () => {
    // `of` is excluded from the qualifier run. "becomes the target of a spell"
    // is a trigger condition, not a thing being targeted, and 69 cards say it.
    const bare = card({
      name: 'Bare',
      typeLine: 'Creature — Human Shaman',
      oracleText: 'Whenever this creature becomes the target of a spell, draw a card.',
    })
    expect(cardImpact(bare).stakes).not.toBe('opposing')
  })

  it('leaves the six anchors exactly where they were', () => {
    const swords = card({
      name: 'Swords to Plowshares',
      manaCost: '{W}',
      typeLine: 'Instant',
      oracleText: 'Exile target creature. Its controller gains life equal to its power.',
    })
    expect(cardImpact(WRATH_OF_GOD).score).toBe(6.12)
    expect(cardImpact(CRATERHOOF).score).toBe(6.0)
    expect(cardImpact(SOL_RING).score).toBe(0.68)
    expect(cardImpact(FOREST).score).toBe(0)
    expect(cardImpact(CYCLONIC_RIFT).score).toBe(7.2)
    expect(cardImpact(swords).score).toBe(1.2)
  })
})
