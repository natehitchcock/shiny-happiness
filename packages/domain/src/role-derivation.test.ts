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
    [
      'ramp',
      'Sorcery',
      'Search your library for a basic land card, put it onto the battlefield tapped.',
    ],
    ['ramp', 'Creature — Goblin', 'When this creature enters, create a Treasure token.'],
    ['draw', 'Instant', 'Draw a card.'],
    ['draw', 'Enchantment', 'Whenever a creature dies, you draw two cards.'],
    ['spot-removal', 'Instant', 'Destroy target creature.'],
    ['counterspell', 'Instant', 'Counter target spell.'],
    ['spot-removal', 'Sorcery', 'This spell deals 3 damage to any target.'],
    ['board-wipe', 'Sorcery', 'Destroy all creatures.'],
    ['board-wipe', 'Sorcery', 'All creatures get -5/-5 until end of turn.'],
    [
      'protection',
      'Instant',
      'Target creature you control gains hexproof and indestructible until end of turn.',
    ],
    ['recursion', 'Sorcery', 'Return target creature card from your graveyard to the battlefield.'],
    [
      'sac-outlet',
      'Enchantment',
      'Sacrifice a creature: This enchantment deals 1 damage to any target.',
    ],
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
    expect(rolesOf('Land', '{T}: Add {C}. {2}, {T}, Sacrifice this land: Draw a card.')).toEqual([
      'land',
    ])
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

  it('lists every member of the Role union, so no role is uncountable', () => {
    // `ROLE_PRECEDENCE`'s own docblock claims it is exhaustive over `Role`, and
    // until now nothing checked it. A role missing from the list is invisible
    // rather than broken: `primaryRole` can never return it, so it is never
    // counted, never gets a `fills-` group and never gets a meter, and `isRole`
    // rejects it at the client boundary — all without a compile error, because
    // the list is typed `readonly Role[]` and a subset satisfies that.
    //
    // Written as a literal rather than derived from the union (which TypeScript
    // cannot enumerate at runtime): the point is that adding a union member
    // fails HERE, loudly, in the one place that lists the consequences.
    const everyRole: readonly Role[] = [
      'land',
      'ramp',
      'draw',
      'tutor',
      'spot-removal',
      'counterspell',
      'bounce',
      'board-wipe',
      'graveyard-hate',
      'protection',
      'recursion',
      'wincon',
      'synergy',
      'stax',
      'sac-outlet',
      'token-maker',
      'anthem',
      'equipment',
      'aura',
      'evasion',
    ]
    expect([...ROLE_PRECEDENCE].sort()).toEqual([...everyRole].sort())
  })

  it('counts graveyard removal as graveyard hate rather than as spot removal', () => {
    // Report 5. Both roles are derived for Tormod's Crypt; precedence decides
    // which one the composition meters see, and it used to be spot-removal —
    // which is why `graveyard-hate` had 107 members in the corpus and zero
    // primaries, i.e. it was a role no deck could ever be shown as holding.
    expect(primaryRole(['spot-removal', 'graveyard-hate'])).toBe('graveyard-hate')
  })

  it('counts a counterspell as a counterspell, not as removal', () => {
    expect(primaryRole(['spot-removal', 'counterspell'])).toBe('counterspell')
  })

  it('prefers the permanent answer when a card both bounces and removes', () => {
    // Bounce is the weaker answer — the permanent comes back — so a card that
    // does both is better described by the one that does not.
    expect(primaryRole(['bounce', 'spot-removal'])).toBe('spot-removal')
    expect(primaryRole(['bounce', 'draw'])).toBe('bounce')
  })

  describe('the answer band outranks what a card leaves behind (ADR-0054)', () => {
    it('counts removal that leaves a body as removal', () => {
      // Rapid Hybridization, Pongify and Beast Within. `role.ts`'s own comment
      // named Beast Within as "spot-removal AND makes a token" and then ordered
      // it the other way, so none of the three ever counted against the
      // spot-removal target they are the best answer to.
      expect(primaryRole(['spot-removal', 'token-maker'])).toBe('spot-removal')
      expect(primaryRole(['token-maker', 'board-wipe'])).toBe('board-wipe')
      expect(primaryRole(['token-maker', 'counterspell'])).toBe('counterspell')
      expect(primaryRole(['token-maker', 'graveyard-hate'])).toBe('graveyard-hate')
      expect(primaryRole(['token-maker', 'bounce'])).toBe('bounce')
    })

    it('counts removal that leaves a Treasure or a land as removal', () => {
      // The same shape one rider over: Deadly Derision, Contract Killing,
      // Crack Open and Deathsprout are removal that pays you back a little,
      // and a deck short of ramp does not fix it with Deadly Derision.
      expect(primaryRole(['ramp', 'spot-removal'])).toBe('spot-removal')
      expect(primaryRole(['ramp', 'board-wipe'])).toBe('board-wipe')
      expect(primaryRole(['ramp', 'counterspell'])).toBe('counterspell')
    })

    it('counts a modal spell whose land mode is not why it is played', () => {
      // Kayla's Command, Jeskai Monument, Nurturing Bristleback. Their `tutor`
      // comes from landcycling reminder text, which is a fetch and not a
      // threat — and either way it is not the job the deck would replace.
      expect(primaryRole(['tutor', 'spot-removal'])).toBe('spot-removal')
      expect(primaryRole(['tutor', 'board-wipe'])).toBe('board-wipe')
    })

    it('does NOT move the sacrifice outlet, and that is the argued half', () => {
      // Goblin Bombardment, Blasting Station, Attrition, Stronghold Assassin.
      // Their removal is not a rider — it IS the outlet, one ability wearing
      // two roles — and a deck has many ways to kill a creature and few
      // repeatable ways to make one of its own die on demand. 54 cards.
      expect(primaryRole(['sac-outlet', 'spot-removal'])).toBe('sac-outlet')
      expect(primaryRole(['sac-outlet', 'board-wipe'])).toBe('sac-outlet')
      expect(primaryRole(['sac-outlet', 'counterspell'])).toBe('sac-outlet')
    })

    it('counts an altar as an outlet rather than as ramp', () => {
      // Ashnod's Altar, Phyrexian Altar, Krark-Clan Ironworks, Skirk
      // Prospector. 26 cards, and every one of them is named for the outlet.
      expect(primaryRole(['ramp', 'sac-outlet'])).toBe('sac-outlet')
    })

    it('leaves ramp above the engine roles it used to sit beside', () => {
      // Only the answer band moved past them. Cultivate is still ramp.
      expect(primaryRole(['ramp', 'token-maker'])).toBe('ramp')
      expect(primaryRole(['ramp', 'draw'])).toBe('ramp')
      expect(primaryRole(['ramp', 'recursion'])).toBe('ramp')
      expect(primaryRole(['token-maker', 'tutor'])).toBe('token-maker')
    })

    it('keeps the answer block in ADR-0037 order', () => {
      // The band moved; its internal order did not.
      expect(primaryRole(['board-wipe', 'graveyard-hate'])).toBe('board-wipe')
      expect(primaryRole(['graveyard-hate', 'spot-removal'])).toBe('graveyard-hate')
      expect(primaryRole(['counterspell', 'spot-removal'])).toBe('counterspell')
      expect(primaryRole(['spot-removal', 'bounce'])).toBe('spot-removal')
      expect(primaryRole(['bounce', 'stax'])).toBe('bounce')
    })

    it('keeps land first, whatever else the card does', () => {
      expect(primaryRole(['spot-removal', 'land'])).toBe('land')
      expect(primaryRole(['sac-outlet', 'land'])).toBe('land')
    })
  })
})

/**
 * The five taxonomy corrections from the product owner, each pinned to real
 * oracle text taken from the corpus rather than recalled.
 *
 * Every card named here was checked against the 34,493-card corpus before and
 * after the change; the counts quoted in the comments are that measurement.
 */
describe('taxonomy corrections', () => {
  describe('report 1 — a board wipe destroys the board', () => {
    it.each([
      ['Wrath of God', "Destroy all creatures. They can't be regenerated."],
      ['Damnation-style exile', 'Exile all creatures.'],
      ['Jokulhaups-style', 'Destroy all nonland permanents.'],
      // Mass damage — report 1's false negative. Neither of these was caught by
      // ANY rule before; both derived to `synergy`, the "we could not classify
      // this" bucket.
      ['Blasphemous Act', 'Blasphemous Act deals 13 damage to each creature.'],
      ['Fiery Cannonade', 'Fiery Cannonade deals 2 damage to each non-Pirate creature.'],
      ['Pyroclasm', 'Pyroclasm deals 2 damage to each creature.'],
      ['Fault Line', 'Fault Line deals X damage to each creature without flying and each player.'],
    ])('%s is a board wipe', (_name, text) => {
      expect(rolesOf('Sorcery', text)).toContain('board-wipe')
    })

    it.each([
      // "Making each opponent sac one creature is not a board wipe." The old
      // rule read `sacrifices (all|\w+) creatures?`, and `\w+` matched "a".
      // 70 of the 86 cards that rule caught were edicts like this one.
      ['Agent of the Fates', 'Each opponent sacrifices a creature of their choice.'],
      ['Barter in Blood', 'Each player sacrifices two creatures of their choice.'],
      // "Ending the turn is not a board wipe." All eight cards in the corpus
      // that end the turn were board wipes, and board-wipe was their ONLY role.
      // The reminder text — not the effect — matched `exile all`.
      [
        'Time Stop',
        'End the turn. (Exile all spells and abilities, including this spell. The player ' +
          'whose turn it is discards down to their maximum hand size.)',
      ],
      // A 1-damage ping clears 21% of the corpus's creatures. See the threshold
      // note on the mass-damage heuristic.
      ['Shrivel-as-damage', 'This spell deals 1 damage to each creature.'],
      // `exile all` against a zone that is not the battlefield.
      ['Paradigm Shift', 'Exile all cards from your library. Then shuffle your graveyard.'],
      ['Bottled Cloister', 'Exile all cards from your hand face down.'],
      ['Relic of Progenitus', 'Exile all graveyards.'],
    ])('%s is not a board wipe', (_name, text) => {
      expect(rolesOf('Sorcery', text)).not.toContain('board-wipe')
    })

    it('wipes when the sweep is keyed off a spell rather than aimed at the stack', () => {
      // Celestial Kirin. The guard list must not contain "spells": "abilities"
      // already excludes every end-the-turn card, and "spells" excluded only
      // this one, which is a real wipe.
      expect(
        rolesOf(
          'Creature — Kirin Spirit',
          'Whenever you cast a Spirit or Arcane spell, destroy all permanents with that ' +
            "spell's mana value.",
        ),
      ).toContain('board-wipe')
    })

    it('still wipes when a later sentence mentions a zone', () => {
      // The zone guard is scoped to the sentence, not the card. Settle the
      // Wreckage exiles a board and then talks about a library.
      expect(
        rolesOf(
          'Instant',
          'Exile all attacking creatures target player controls. That player may search ' +
            'their library for that many basic land cards.',
        ),
      ).toContain('board-wipe')
    })

    it('does not read a blocker punisher as a sweeper', () => {
      // Trailblazer's Torch. Caught only by diffing the corpus — it reads as a
      // textbook match and is a combat trick.
      expect(
        rolesOf(
          'Artifact — Equipment',
          'Whenever equipped creature becomes blocked, it deals 2 damage to each creature ' +
            'blocking it.',
        ),
      ).not.toContain('board-wipe')
    })

    it('reads a mass -X/-X the same way it reads mass damage', () => {
      // Same mechanic, same line: a number against toughness. -1/-1 kills what
      // 1 damage kills, and `-\d+` used to match `-0`, which kills nothing.
      expect(rolesOf('Sorcery', 'All creatures get -2/-2 until end of turn.')).toContain(
        'board-wipe',
      )
      expect(rolesOf('Sorcery', 'All creatures get -1/-1 until end of turn.')).not.toContain(
        'board-wipe',
      )
      expect(rolesOf('Sorcery', 'All creatures get -3/-0 until end of turn.')).not.toContain(
        'board-wipe',
      )
    })
  })

  describe('report 2 — countering is not spot removal', () => {
    it('gives Counterspell its own role', () => {
      const roles = rolesOf('Instant', 'Counter target spell.')
      expect(roles).toContain('counterspell')
      expect(roles).not.toContain('spot-removal')
    })

    it('still calls destroying a creature spot removal', () => {
      expect(rolesOf('Instant', 'Exile target creature. Its controller gains life.')).toContain(
        'spot-removal',
      )
    })

    it('leaves the protection reading of a targeted counter alone', () => {
      // A counter that only answers what targets you is protection as well —
      // that rule predates this change and is not a duplicate count, because
      // precedence still picks one.
      expect(rolesOf('Instant', 'Counter target spell that targets you.')).toContain('protection')
    })
  })

  describe('report 3 — interaction is counterspells and bounce, not an umbrella', () => {
    it('derives bounce for a card that answers a permanent by returning it', () => {
      expect(
        rolesOf(
          'Instant',
          "Return target nonland permanent you don't control to its owner's hand.",
        ),
      ).toContain('bounce')
    })

    it('derives bounce for mass return-to-hand', () => {
      expect(rolesOf('Instant', "Return all creatures to their owners' hands.")).toContain('bounce')
    })

    it('does not call returning your own permanent interaction', () => {
      // Self-bounce is a blink/value effect, not an answer.
      expect(
        rolesOf('Creature — Spirit', "Return target Spirit you control to its owner's hand."),
      ).not.toContain('bounce')
    })

    it('reads "you don\'t control" as the opposite of "you control"', () => {
      expect(
        rolesOf('Instant', "Return target creature you don't control to its owner's hand."),
      ).toContain('bounce')
    })
  })

  describe('a blink is not removal (ADR-0048)', () => {
    it('does not call exiling your own permanent spot removal', () => {
      // Teferi's Time Twist, verbatim, and the card the report named. It is a
      // blink: `deriveSynergy` already reads it as `creature-etb`, which is the
      // flicker semantic and needed no new tag. Only the ROLE was wrong.
      expect(
        rolesOf(
          'Instant',
          "Exile target permanent you control. Return that card to the battlefield under its owner's control at the beginning of the next end step.",
        ),
      ).not.toContain('spot-removal')
    })

    it('does not call Cloudshift removal either', () => {
      expect(
        rolesOf(
          'Instant',
          'Exile target creature you control, then return that card to the battlefield under your control.',
        ),
      ).not.toContain('spot-removal')
    })

    it("still calls exiling an opponent's permanent removal", () => {
      // The guard must not cost the 346 cards that are the real thing.
      expect(rolesOf('Instant', 'Exile target creature an opponent controls.')).toContain(
        'spot-removal',
      )
    })

    it('reads "you don\'t control" as the opposite of "you control"', () => {
      // The same trap the bounce rule documents: the exclusion is a substring
      // of its own negation, and Cyclonic Rift depends on the lookahead not
      // being fooled by it.
      expect(rolesOf('Instant', "Exile target creature you don't control.")).toContain(
        'spot-removal',
      )
    })

    it('still keeps graveyard hate out of removal', () => {
      // The older guard on the same rule, kept and re-asserted because the two
      // lookaheads now sit side by side and one could be lost editing the other.
      expect(rolesOf('Instant', "Exile target player's graveyard.")).not.toContain('spot-removal')
    })
  })

  describe('report 4 — a land tutor is ramp', () => {
    it.each([
      ['Sylvan Scrying', 'Search your library for a land card, reveal it, put it into your hand.'],
      [
        "Traveler's Amulet",
        'Search your library for a basic land card, reveal it, put it into your hand, then shuffle.',
      ],
    ])('%s is ramp and not a tutor', (_name, text) => {
      const roles = rolesOf('Sorcery', text)
      expect(roles).toContain('ramp')
      expect(roles).not.toContain('tutor')
    })

    it('still calls a real tutor a tutor', () => {
      const roles = rolesOf(
        'Sorcery',
        'Search your library for a card, put that card into your hand, then shuffle.',
      )
      expect(roles).toContain('tutor')
    })

    /*
     * THE WORD "BASIC" WAS THE WHOLE GAP (ADR-0058).
     *
     * The rule read `search your library for (a|up to N) BASIC LAND CARD …
     * onto the battlefield`, and the format's best ramp spells say neither
     * word: they name a Forest. 145 non-land cards search out a land and put it
     * onto the battlefield or into hand without holding the `ramp` role, and
     * the ones below are four-ofs in half the green decks in the format.
     *
     * Every one of the 38 corpus matches for the named-type rule was read by
     * hand and all 38 are genuine ramp -- there is no false positive to report,
     * which is why the rule is admitted as written.
     */
    it.each([
      ["Nature's Lore", 'Search your library for a Forest card, put that card onto the battlefield.'],
      ['Three Visits', 'Search your library for a Forest card, put it onto the battlefield.'],
      [
        'Farseek',
        'Search your library for a Plains, Island, Swamp, or Mountain card, put it onto the battlefield tapped, then shuffle.',
      ],
      [
        'Skyshroud Claim',
        'Search your library for up to two Forest cards, put them onto the battlefield, then shuffle.',
      ],
      [
        'Aerial Surveyor',
        'Whenever this Vehicle attacks, search your library for a basic Plains card, put it onto the battlefield tapped, then shuffle.',
      ],
    ])('%s is ramp, though it never says "basic land card"', (_name, text) => {
      expect(rolesOf('Sorcery', text)).toContain('ramp')
    })

    /*
     * The same gap one wording over: "a land card" onto the battlefield, which
     * the old rule refused because it demanded "basic". 16 further cards, also
     * hand-checked, also all ramp.
     */
    it.each([
      ['Crop Rotation', 'Sacrifice a land: Search your library for a land card, put it onto the battlefield, then shuffle.'],
      [
        'Knight of the Reliquary',
        'Sacrifice a Forest or Plains: Search your library for a land card, put it onto the battlefield, then shuffle.',
      ],
    ])('%s is ramp without the word "basic"', (_name, text) => {
      expect(rolesOf('Sorcery', text)).toContain('ramp')
    })

    /*
     * THE LINE. A land going to HAND by way of a named type is deliberately NOT
     * admitted, and the population is why: it is 84 more cards and 51 of them
     * are landcycling, whose text is a discard ability on a Dragon. Calling
     * Timeless Dragon ramp would be the ADR-0031 defect this rule exists to fix,
     * pointed the other way.
     *
     * `land card … into your hand` stays ramp, unchanged -- that rule was
     * argued in this file for Traveler's Amulet and is not what this touches.
     */
    it('does not call landcycling ramp', () => {
      const roles = rolesOf(
        'Creature — Dragon',
        'Flying\nPlainscycling {2} ({2}, Discard this card: Search your library for a Plains card, reveal it, put it into your hand, then shuffle.)',
      )
      expect(roles).not.toContain('ramp')
    })

    /*
     * The capital is what marks a land type, exactly as it marks a subtype in
     * `semantic-tokens.ts`. Without it "search your library for a mountain of
     * cards" would be ramp.
     */
    it('reads the land type by its capital, not by the word', () => {
      expect(
        rolesOf(
          'Sorcery',
          'Search your library for a card that shares a name with a mountain range and put it onto the battlefield.',
        ),
      ).not.toContain('ramp')
    })

    it('does not read "nonland card" as a land search', () => {
      expect(
        rolesOf(
          'Enchantment',
          'Search your library for a nonland card with mana value X, reveal it, put it into ' +
            'your hand, then shuffle.',
        ),
      ).toContain('tutor')
    })
  })

  describe('report 5 — graveyard removal is its own semantic', () => {
    it.each([
      ["Tormod's Crypt", "Exile target player's graveyard."],
      ['Purify the Grave', 'Exile target card from a graveyard.'],
      ['Relic of Progenitus', 'Exile all graveyards.'],
    ])('%s is graveyard hate and not spot removal', (_name, text) => {
      const roles = rolesOf('Artifact', text)
      expect(roles).toContain('graveyard-hate')
      expect(roles).not.toContain('spot-removal')
    })

    it('does not call emptying a hand or a library graveyard hate', () => {
      // `all cards from` used to be bare. Latent while the role had no
      // primaries; a visible mislabel the moment precedence gave it some.
      expect(
        rolesOf(
          'Creature — Nightmare',
          'When this creature enters, exile all cards from your hand.',
        ),
      ).not.toContain('graveyard-hate')
      expect(rolesOf('Sorcery', 'Exile all cards from your library.')).not.toContain(
        'graveyard-hate',
      )
    })

    it('catches the replacement-effect phrasing the old rule missed', () => {
      // The old second rule, /graveyards? .{0,30}exiled instead/, matched zero
      // cards in the corpus. This is how the effect is actually worded.
      expect(
        rolesOf(
          'Enchantment',
          'If a card would be put into a graveyard from anywhere, exile it instead.',
        ),
      ).toContain('graveyard-hate')
      expect(
        rolesOf(
          'Enchantment',
          "If a card would be put into an opponent's graveyard from anywhere, exile it instead.",
        ),
      ).toContain('graveyard-hate')
      // A generic subject that is not literally the words "a card". Requiring
      // those two words dropped all of these.
      expect(
        rolesOf(
          'Legendary Creature — Human Soldier',
          "If a creature card would be put into an opponent's graveyard from anywhere, exile " +
            'it instead.',
        ),
      ).toContain('graveyard-hate')
      expect(
        rolesOf(
          'Enchantment',
          'If a card or token would be put into a graveyard from anywhere, exile it instead.',
        ),
      ).toContain('graveyard-hate')
    })

    it('does not read a Disturb back face exiling itself as graveyard hate', () => {
      // The Disturb/Aura backs name themselves, and that is the only thing that
      // tells them apart from Rest in Peace.
      expect(
        rolesOf(
          'Enchantment — Aura',
          'If Spectral Binding would be put into a graveyard from anywhere, exile it instead.',
        ),
      ).not.toContain('graveyard-hate')
    })

    it('does not read the flashback self-exile rider as graveyard hate', () => {
      // Toshiro Umezawa. A card exiling ITSELF after being cast from a graveyard
      // is the opposite of hating on one, and it shares most of its wording.
      expect(
        rolesOf(
          'Legendary Creature — Human Samurai',
          'Whenever a creature an opponent controls dies, you may cast target instant card ' +
            'from your graveyard. If that spell would be put into a graveyard, exile it instead.',
        ),
      ).not.toContain('graveyard-hate')
    })
  })
})

describe('a sacrifice outlet that names a creature TYPE (ADR-0047)', () => {
  /*
   * The same defect ADR-0038 fixed in `synergy.ts`, one file over and found by
   * the same report. Both `sac-outlet` heuristics demanded the literal word
   * "creature", so Ambush Commander and Skirk Prospector fell through to the
   * `synergy` catch-all — and a role is louder than a tag, because roles feed
   * the composition meters and Quickbuild's gap selection.
   */
  it('reads the reported card', () => {
    expect(
      rolesOf(
        'Creature — Elf',
        'Forests you control are 1/1 green Elf creatures that are still lands.\n{1}{G}, Sacrifice an Elf: Target creature gets +3/+3 until end of turn.',
      ),
    ).toContain('sac-outlet')
  })

  it('reads the archetypal tribal outlet', () => {
    expect(rolesOf('Creature — Goblin', 'Sacrifice a Goblin: Add {R}.')).toContain('sac-outlet')
  })

  it('reads a count and a second type', () => {
    expect(
      rolesOf('Creature — Human Soldier', 'Sacrifice two Humans: Destroy target creature.'),
    ).toContain('sac-outlet')
    expect(
      rolesOf('Legendary Creature — Vampire', 'Sacrifice another Vampire or Zombie: Draw a card.'),
    ).toContain('sac-outlet')
  })

  it('requires the sacrifice to be a COST, not an effect', () => {
    /*
     * This is where the role rule and the synergy rule part company, and it is
     * deliberate. `creature-death` asks only whether a creature dies, so
     * ADR-0038's rule reads Goblin Grenade's "as an additional cost to cast
     * this spell, sacrifice a Goblin". A sac OUTLET is a repeatable engine you
     * feed on demand, which is what the colon says — so the one-shot spell is a
     * creature death and is not an outlet.
     */
    expect(
      rolesOf(
        'Sorcery',
        'As an additional cost to cast this spell, sacrifice a Goblin.\nGoblin Grenade deals 5 damage to any target.',
      ),
    ).not.toContain('sac-outlet')
  })

  it('does not read sacrificing a Food, a Clue or a land as an outlet', () => {
    // The same deny list as `synergy.ts`, and the same measured trap: 45 cards
    // sacrifice a Food and none of them is a sacrifice outlet for creatures.
    expect(rolesOf('Creature — Plant Druid', 'Sacrifice a Food: You gain 3 life.')).not.toContain(
      'sac-outlet',
    )
    expect(rolesOf('Artifact', 'Sacrifice a Clue: Draw a card.')).not.toContain('sac-outlet')
    expect(
      rolesOf('Creature — Human', 'Sacrifice a Mountain: This creature gets +2/+0.'),
    ).not.toContain('sac-outlet')
  })

  it('leaves the lowercase nouns to the rule that already owns them', () => {
    /*
     * The capital marks a TYPE. Read case-insensitively the tribal rule matches
     * "Sacrifice an artifact:", which is the first heuristic's job.
     *
     * This assertion was written expecting Krark-Clan Ironworks to be a
     * `sac-outlet` already and it FAILED, which is how the second defect in
     * this file was found: the first heuristic listed `(a|another)` and not
     * `an`, and "artifact" is the one noun it takes. 81 cards — Arcbound
     * Ravager, Atog, Bosh — were catch-all `synergy` on one missing article.
     */
    expect(rolesOf('Artifact', 'Sacrifice an artifact: Add {C}{C}.')).toContain('sac-outlet')
    expect(rolesOf('Creature — Human', 'Sacrifice another creature: Draw a card.')).toContain(
      'sac-outlet',
    )
  })

  it('still lets a land be a land', () => {
    // `deriveRoles` short-circuits every land to `['land']`, so the three lands
    // that match this rule — Seaside Haven, Springjack Pasture, Starlit
    // Sanctum — keep the role the deck counts them under. Measured: the rule
    // reaches 95 cards and moves 92.
    expect(rolesOf('Land', '{T}, Sacrifice a Bird: Draw a card.')).toEqual(['land'])
  })
})

describe('a card cleaning up after itself is not a board wipe (ADR-0054)', () => {
  it('refuses a card that destroys the tokens it made', () => {
    // Latent until the answer block moved above `token-maker`: all nine of
    // these were counted as token makers, which they are, and the wrong role
    // underneath was invisible.
    expect(
      rolesOf(
        'Enchantment',
        'When this enchantment enters, create six 1/1 green Saproling creature tokens.\nWhen this enchantment leaves the battlefield, destroy all tokens created with this enchantment.',
      ),
    ).not.toContain('board-wipe')
    expect(
      rolesOf(
        'Creature — Human',
        'When this creature enters, create three 0/1 black Serf creature tokens.\nWhen this creature leaves the battlefield, exile all Serf tokens.',
      ),
    ).not.toContain('board-wipe')
  })

  it('keeps a sweep that takes everyone’s tokens', () => {
    // Aether Snap. The bare clause is the whole distinction: it is not
    // cleaning up after itself, it is answering a token deck.
    expect(
      rolesOf('Sorcery', 'Remove all counters from all permanents and players. Exile all tokens.'),
    ).toContain('board-wipe')
  })

  it('keeps a real wipe that merely mentions tokens later', () => {
    // Elspeth Tirel names tokens as an EXCEPTION, forty characters away.
    expect(
      rolesOf(
        'Legendary Planeswalker — Elspeth',
        'Destroy all other permanents except for lands and tokens.',
      ),
    ).toContain('board-wipe')
  })
})

describe('token-maker asks whose tokens they are (ADR-0054)', () => {
  it('refuses a clause that names an opponent as the creator', () => {
    // The role feeds the composition meters, so `token-maker` is a claim about
    // how many token makers THIS deck holds. Hunted Horror makes none of them.
    expect(
      rolesOf(
        'Creature — Horror',
        'Trample\nWhen this creature enters, target opponent creates two 3/3 green Centaur creature tokens.',
      ),
    ).not.toContain('token-maker')
  })

  it('refuses the copy clause on the same ground', () => {
    expect(
      rolesOf(
        'Creature — Elemental',
        "When this creature enters, if it's not a token, each opponent creates a token that's a copy of it.",
      ),
    ).not.toContain('token-maker')
  })

  it('still reads the imperative and the symmetric clause', () => {
    expect(rolesOf('Sorcery', 'Create a 1/1 green Squirrel creature token.')).toContain(
      'token-maker',
    )
    expect(
      rolesOf('Sorcery', 'Each player creates X 1/1 white Soldier creature tokens.'),
    ).toContain('token-maker')
  })

  it('reads the clause and not the card', () => {
    // Rasputin makes Knights for himself and Goblins for everyone else. He is
    // a token maker.
    expect(
      rolesOf(
        'Legendary Creature — Human Wizard',
        'When Rasputin enters, put a dream counter on it for each opponent you have. Each opponent creates a 1/1 red Goblin creature token.\n{T}, Remove a dream counter from Rasputin: Create a 2/2 white Knight creature token with protection from red.',
      ),
    ).toContain('token-maker')
  })

  it('reads an opponent in the object position as the attack target', () => {
    // "attacks one of your opponents, that attacking player creates" — the
    // attacker is usually you, and the tokens are why the card is played.
    expect(
      rolesOf(
        'Creature — Bird Cleric',
        "Flying\nWhenever a player attacks one of your opponents, that attacking player creates a tapped 2/1 white and black Inkling creature token with flying that's attacking that opponent.",
      ),
    ).toContain('token-maker')
  })

  it('leaves the removal shell a token maker, which is measured not assumed', () => {
    // "Its controller creates" was tried and refused — 54 further cards, at
    // least 14 of which hand the token to you. See `token-subject.ts`.
    expect(
      rolesOf(
        'Instant',
        'Destroy target permanent. Its controller creates a 3/3 green Beast creature token.',
      ),
    ).toContain('token-maker')
  })
})

/* ---------------------------------------------------------------- ADR-0060 */

describe('the article audit (ADR-0060 §1)', () => {
  describe('a tutor whose object takes "an"', () => {
    it.each([
      [
        'Idyllic Tutor',
        'Search your library for an enchantment card, reveal it, put it into your hand, then shuffle.',
      ],
      [
        'Stoneforge Mystic',
        'When this creature enters, you may search your library for an Equipment card, reveal it, put it into your hand, then shuffle.',
      ],
      [
        'Fabricate',
        'Search your library for an artifact card, reveal it, put it into your hand, then shuffle.',
      ],
      [
        'Spellseeker',
        'When this creature enters, search your library for an instant or sorcery card with mana value 2 or less, reveal it, put it into your hand, then shuffle.',
      ],
      [
        'Open the Armory',
        'Search your library for an Aura or Equipment card, reveal it, put it into your hand, then shuffle.',
      ],
      [
        "Heliod's Pilgrim",
        'When this creature enters, you may search your library for an Aura card, reveal it, put it into your hand, then shuffle.',
      ],
    ])('%s is a tutor', (_name, text) => {
      expect(rolesOf('Creature', text)).toContain('tutor')
    })

    it('still reads "a" and "any", which the list already had', () => {
      expect(
        rolesOf(
          'Sorcery',
          'Search your library for a creature card, reveal it, put it into your hand, then shuffle.',
        ),
      ).toContain('tutor')
      expect(
        rolesOf('Sorcery', 'Search your library for any card, put it into your hand, then shuffle.'),
      ).toContain('tutor')
    })
  })

  describe('a tutor that fetches SEVERAL', () => {
    it.each([
      [
        'Tooth and Nail',
        'Search your library for up to two creature cards, reveal them, put them into your hand, then shuffle.',
      ],
      [
        'Diabolic Revelation',
        'Search your library for up to X cards, put those cards into your hand, then shuffle.',
      ],
      [
        'Behold the Beyond',
        'Search your library for three cards, put them into your hand, then discard your hand.',
      ],
    ])('%s is a tutor', (_name, text) => {
      expect(rolesOf('Sorcery', text)).toContain('tutor')
    })
  })

  describe('a draw spell whose numeral the list stopped short of', () => {
    it.each([
      ['Wheel of Fortune', 'Each player discards their hand, then draws seven cards.'],
      [
        'Timetwister',
        'Each player shuffles their hand and graveyard into their library, then draws seven cards.',
      ],
      ['Covenant of Minds', 'Reveal the top five cards of your library. Draw five cards.'],
    ])('%s draws', (_name, text) => {
      expect(rolesOf('Sorcery', text)).toContain('draw')
    })
  })

  describe('a sacrifice outlet that eats MORE THAN ONE', () => {
    it.each([
      [
        'Kuldotha Forgemaster',
        '{T}, Sacrifice three artifacts: Search your library for an artifact card and put it onto the battlefield.',
      ],
      [
        'Time Sieve',
        '{T}, Sacrifice five artifacts: Take an extra turn after this one.',
      ],
      [
        'Whisper, Blood Liturgist',
        '{T}, Sacrifice two creatures: Return target creature card from your graveyard to the battlefield.',
      ],
    ])('%s is a sac outlet', (_name, text) => {
      expect(rolesOf('Artifact', text)).toContain('sac-outlet')
    })

    it('leaves a card sacrificing ITSELF out, which is not an outlet', () => {
      // "Sacrifice this creature:" is a one-shot, not a repeatable engine, and
      // 702 cards in the corpus say it. The quantifier list keeps them out.
      expect(rolesOf('Creature', 'Sacrifice this creature: Draw a card.')).not.toContain(
        'sac-outlet',
      )
    })
  })
})

describe('landcycling is a discard ability, not a search (ADR-0060 §2)', () => {
  const PLAINSCYCLING =
    'Flying\nPlainscycling {2} ({2}, Discard this card: Search your library for a Plains card, reveal it, put it into your hand, then shuffle.)'

  it('does not make a Dragon a tutor', () => {
    expect(rolesOf('Creature — Dragon', PLAINSCYCLING)).not.toContain('tutor')
  })

  it('does not make a Dragon ramp', () => {
    expect(rolesOf('Creature — Dragon', PLAINSCYCLING)).not.toContain('ramp')
  })

  it('reads the same clause as ramp when it is the card and not the reminder', () => {
    expect(
      rolesOf(
        'Sorcery',
        'Search your library for a basic Plains card, reveal it, put it into your hand, then shuffle.',
      ),
    ).toContain('ramp')
  })
})

describe('a land search names a type as often as it says "land" (ADR-0060 §2)', () => {
  it.each([
    [
      "Archaeomancer's Map",
      'When this artifact enters, search your library for up to two basic Plains cards, reveal them, put them into your hand, then shuffle.',
    ],
    [
      "Kayla's Command",
      'Search your library for a basic Plains card, reveal it, put it into your hand, then shuffle.',
    ],
    [
      'Gift of Estates',
      'Search your library for up to three Plains cards, reveal them, put them into your hand, then shuffle.',
    ],
  ])('%s is ramp', (_name, text) => {
    expect(rolesOf('Enchantment', text)).toContain('ramp')
  })

  it('is not also a tutor, because a land tutor is ramp', () => {
    // The product owner's ruling, and the guard that enforced it read the
    // literal words "land card" — so "a Plains card" walked straight past it.
    expect(
      rolesOf(
        'Creature',
        'When this creature enters, search your library for a basic Plains card, reveal it, put it into your hand, then shuffle.',
      ),
    ).not.toContain('tutor')
  })

  it('keeps Land Tax, which says "land" and always worked', () => {
    expect(
      rolesOf(
        'Enchantment',
        "At the beginning of each opponent's upkeep, if that player controls more lands than you, you may search your library for up to three basic land cards, reveal them, put them into your hand, then shuffle.",
      ),
    ).toContain('ramp')
  })
})

describe('stax names whose spells it taxes (ADR-0060 §3)', () => {
  describe('the tax rule reads a subject', () => {
    it.each([
      [
        'Grand Arbiter Augustin IV',
        'White spells you cast cost {1} less to cast.\nBlue spells you cast cost {1} less to cast.\nSpells your opponents cast cost {1} more to cast.',
      ],
      ['God-Pharaoh’s Statue', 'Spells your opponents cast cost {2} more to cast.'],
      [
        'Reidane, God of the Worthy',
        'Noncreature spells your opponents cast with mana value 4 or greater cost {2} more to cast.',
      ],
      ['Defense Grid', 'Each spell costs {3} more to cast except during its caster’s own turn.'],
      [
        'Eidolon of Obstruction',
        'Loyalty abilities of planeswalkers your opponents control cost {1} more to activate.',
      ],
    ])('%s holds stax', (_name, text) => {
      expect(rolesOf('Creature', text)).toContain('stax')
    })

    it('keeps Thalia, whose subject is nobody in particular', () => {
      expect(rolesOf('Creature — Human Soldier', 'First strike\nNoncreature spells cost {1} more to cast.')).toContain('stax')
    })

    it('is not a ward — a tax on spells that TARGET this creature is protection', () => {
      // 12 cards, every one a pseudo-ward stapled to a fatty: Icefall Regent,
      // Sphinx of New Prahv, Boreal Elemental, Pursued Whale, Esior. A deck
      // told those are prison pieces will cut a real one to make room.
      expect(
        rolesOf(
          'Creature — Dragon',
          'Flying\nSpells your opponents cast that target this creature cost {2} more to cast.',
        ),
      ).not.toContain('stax')
    })

    it('is not a card taxing ITSELF', () => {
      expect(
        rolesOf('Sorcery', 'This spell costs {1} more to cast for each target beyond the first.'),
      ).not.toContain('stax')
      expect(rolesOf('Artifact', 'This ability costs {1} more to activate for each card in your hand.')).not.toContain('stax')
    })
  })

  describe('split second is a reminder about the stack, not a prison', () => {
    const SPLIT_SECOND =
      "Split second (As long as this spell is on the stack, players can't cast spells or activate abilities that aren't mana abilities.)\nYou can't lose the game this turn."

    it('does not make Angel’s Grace a stax piece', () => {
      expect(rolesOf('Instant', SPLIT_SECOND)).not.toContain('stax')
    })

    it('still reads a real "players can\'t" clause', () => {
      expect(rolesOf('Enchantment', "Players can't play lands.")).toContain('stax')
      expect(rolesOf('Artifact', "Players can't search libraries.")).toContain('stax')
    })
  })

  describe('the prison pieces the role could not see', () => {
    it.each([
      ['Back to Basics', 'Enchantment', "Nonbasic lands don't untap during their controllers' untap steps."],
      ['Meekstone', 'Artifact', "Creatures with power 3 or greater don't untap during their controllers' untap steps."],
      ['Stasis', 'Enchantment', 'Players skip their untap steps.'],
      [
        'Ghostly Prison',
        'Enchantment',
        "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.",
      ],
      ['Null Rod', 'Artifact', "Activated abilities of artifacts can't be activated."],
      ['Cursed Totem', 'Artifact', "Activated abilities of creatures can't be activated."],
      ['Drannith Magistrate', 'Creature — Human Wizard', "Your opponents can't cast spells from anywhere other than their hands."],
      ['Torpor Orb', 'Artifact', "Creatures entering don't cause abilities to trigger."],
      ['Silent Arbiter', 'Artifact Creature — Construct', 'No more than one creature can attack each combat.\nNo more than one creature can block each combat.'],
    ])('%s holds stax', (_name, typeLine, text) => {
      expect(rolesOf(typeLine, text)).toContain('stax')
    })
  })
})
