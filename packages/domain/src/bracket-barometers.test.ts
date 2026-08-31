import { describe, expect, it } from 'vitest'
import type { Card } from './card.js'
import type { Combo } from './combo.js'
import { comboId, oracleId, printingId } from './ids.js'
import {
  BAROMETER_BASIS,
  bracketFindings,
  deniesLand,
  destroysLand,
  grantsExtraTurn,
  mutatesLand,
} from './bracket-barometers.js'

/**
 * The rules here are read from rules text, which is a heuristic — so, like
 * `entersTapped` in `fixing.ts`, they are checked against hand-picked cards
 * chosen to be hard rather than against invented text.
 *
 * Every `oracleText` below is VERBATIM from the corpus. That matters: the
 * defects these rules exist to avoid are all cases where real wording differs
 * from remembered wording, and a paraphrase would test the paraphrase.
 *
 * The full run is in the commit message — 58/58 hand-picked extra-turn cases and
 * 151/151 hand-picked land-denial cases against the 31,782 Commander-legal cards
 * in the corpus. What is pinned here is the subset that would silently rot.
 */
const card = (name: string, oracleText: string): Card => ({
  oracleId: oracleId(name),
  name,
  manaCost: '{2}',
  manaValue: 2,
  colorIdentity: [],
  colors: [],
  typeLine: 'Sorcery',
  types: ['sorcery'],
  oracleText,
  power: null,
  toughness: null,
  loyalty: null,
  keywords: [],
  legalities: { commander: 'legal' },
  edhrecRank: null,
  defaultPrinting: printingId(name),
  roles: ['synergy'],
  primaryRole: 'synergy',
  universesBeyond: false,
  gameChanger: false,
  synergyProduces: [],
  synergyWants: [],
})

describe('grantsExtraTurn', () => {
  it('matches the wordings that actually grant a turn', () => {
    const grants = [
      card('Time Warp', 'Target player takes an extra turn after this one.'),
      card('Temporal Manipulation', 'Take an extra turn after this one.'),
      card(
        'Teferi, Master of Time',
        "You may activate loyalty abilities of Teferi on any player's turn any time you " +
          'could cast an instant.\n+1: Draw a card, then discard a card.\n' +
          '−10: Take two extra turns after this one.',
      ),
      card('Time Stretch', 'Target player takes two extra turns after this one.'),
      card(
        'Savor the Moment',
        'Take an extra turn after this one. Skip the untap step of that turn.',
      ),
    ]
    for (const c of grants) expect(grantsExtraTurn(c), c.name).toBe(true)
  })

  /*
   * The card the naive `/extra turn/` gets backwards, and the reason the rule
   * matches on `take` rather than on the phrase.
   *
   * These three are the ANTI-extra-turn cards. Flagging them for granting extra
   * turns would be the exact reverse of what they do, and it is the only error
   * the naive pattern makes across all 64 corpus cards whose text says "extra
   * turn" — which is what makes it worth a test of its own.
   */
  it('does not match the cards that DENY extra turns', () => {
    const denials = [
      card(
        'Stranglehold',
        "Your opponents can't search libraries.\nIf an opponent would begin an extra turn, " +
          'that player skips that turn instead.',
      ),
      card(
        'Trouble in Pairs',
        'If an opponent would begin an extra turn, that player skips that turn instead.',
      ),
      card(
        "Gerrard's Hourglass Pendant",
        'Flash\nIf a player would begin an extra turn, that player skips that turn instead.',
      ),
    ]
    for (const c of denials) expect(grantsExtraTurn(c), c.name).toBe(false)
  })

  /*
   * Ugin's Nexus says both. It denies everyone an extra turn while it is on the
   * battlefield and then takes one itself when it dies, so it belongs in the
   * count — a rule written as "denies, therefore not a grant" would miss it.
   */
  it('matches a card that denies extra turns and then takes one', () => {
    expect(
      grantsExtraTurn(
        card(
          "Ugin's Nexus",
          'If a player would begin an extra turn, that player skips that turn instead.\n' +
            "If Ugin's Nexus would be put into a graveyard from the battlefield, instead " +
            'exile it and take an extra turn after this one.',
        ),
      ),
    ).toBe(true)
  })

  /*
   * "after this one" is not required, because Emrakul does not say it. This is
   * the case that rules out the tighter and more obvious `/take an extra turn
   * after this one/`.
   */
  it('matches Emrakul, the Promised End, which never says "after this one"', () => {
    expect(
      grantsExtraTurn(
        card(
          'Emrakul, the Promised End',
          'When you cast this spell, you gain control of target opponent during that ' +
            "player's next turn. After that turn, that player takes an extra turn.\n" +
            'Flying, trample, protection from instants',
        ),
      ),
    ).toBe(true)
  })

  it('does not match an extra COMBAT phase', () => {
    expect(
      grantsExtraTurn(
        card(
          'Aggravated Assault',
          '{3}{R}{R}: Untap all creatures you control. After this main phase, there is an ' +
            'additional combat phase followed by an additional main phase. Activate only as ' +
            'a sorcery.',
        ),
      ),
    ).toBe(false)
  })
})

describe('destroysLand', () => {
  it('matches destruction, forced sacrifice, exile and mass bounce', () => {
    const denial = [
      card('Armageddon', 'Destroy all lands.'),
      card('Strip Mine', '{T}: Add {C}.\n{T}, Sacrifice this land: Destroy target land.'),
      card(
        'Pox',
        'Each player loses a third of their life, then discards a third of the cards in ' +
          'their hand, then sacrifices a third of the creatures they control of their ' +
          'choice, then sacrifices a third of the lands they control of their choice. ' +
          'Round up each time.',
      ),
      card(
        'Decree of Annihilation',
        'Exile all artifacts, creatures, and lands from the battlefield, all cards from ' +
          'all graveyards, and all cards from all hands.\nCycling {5}{R}{R} ({5}{R}{R}, ' +
          'Discard this card: Draw a card.)\nWhen you cycle this card, destroy all lands.',
      ),
      card('Sunder', "Return all lands to their owners' hands."),
      card(
        'Boseiju, Who Endures',
        '{T}: Add {G}.\nChannel — {1}{G}, Discard this card: Destroy target artifact, ' +
          'enchantment, or nonbasic land an opponent controls. That player may search ' +
          'their library for a land card with a basic land type, put it onto the ' +
          'battlefield, then shuffle.',
      ),
    ]
    for (const c of denial) expect(destroysLand(c), c.name).toBe(true)
  })

  /*
   * The defect the whole module is shaped around: `nonland` CONTAINS `land`.
   *
   * `oracle_text ILIKE '%destroy%land%'` scores 307 cards in the corpus and
   * these two are in it. Both destroy nonland permanents — the opposite of land
   * denial — and Ruinous Ultimatum is a card people actually play. `\b` on both
   * sides of `land` is the entire fix and this is the test that holds it.
   */
  it('does not match cards that destroy NONLAND permanents', () => {
    expect(
      destroysLand(
        card('Ruinous Ultimatum', 'Destroy all nonland permanents your opponents control.'),
      ),
    ).toBe(false)
    expect(
      destroysLand(
        card('Void Rend', "This spell can't be countered.\nDestroy target nonland permanent."),
      ),
    ).toBe(false)
  })

  /*
   * The second big false-positive class: 631 corpus cards say "sacrifice" and
   * "land" together, and most are a utility land sacrificing ITSELF for value.
   * The rule reads the third-person `sacrificeS`, so a cost you pay in the
   * imperative never counts.
   */
  it('does not match a land that sacrifices itself for value', () => {
    const selfSacrifice = [
      card(
        'Evolving Wilds',
        '{T}, Sacrifice this land: Search your library for a basic land card, put it onto ' +
          'the battlefield tapped, then shuffle.',
      ),
      card(
        'Mouth of Ronom',
        '{T}: Add {C}.\n{4}{S}, {T}, Sacrifice this land: It deals 4 damage to target creature.',
      ),
      card(
        'Waterfront District',
        'This land enters tapped.\n{T}: Add {U} or {B}.\n{2}{U}{B}, {T}, Sacrifice this ' +
          'land: Draw a card.',
      ),
    ]
    for (const c of selfSacrifice) expect(destroysLand(c), c.name).toBe(false)
  })

  it('does not match destruction that spares lands by name', () => {
    expect(
      destroysLand(
        card(
          'Scourglass',
          '{T}, Sacrifice this artifact: Destroy all permanents except for artifacts and ' +
            'lands. Activate only during your upkeep.',
        ),
      ),
    ).toBe(false)
  })

  /*
   * The land is a COUNT here, not a target: Invasion of Lorwyn destroys a
   * creature whose power is compared against a land count. Found by reading the
   * corpus matches, not predicted.
   */
  it('does not match a clause where the land is only being counted', () => {
    expect(
      destroysLand(
        card(
          'Invasion of Lorwyn',
          'When this Siege enters, destroy target non-Elf creature an opponent controls ' +
            'with power X or less, where X is the number of lands you control.',
        ),
      ),
    ).toBe(false)
  })
})

describe('mutatesLand', () => {
  it('matches a land type overwritten', () => {
    expect(mutatesLand(card('Blood Moon', 'Nonbasic lands are Mountains.'))).toBe(true)
    expect(mutatesLand(card('Magus of the Moon', 'Nonbasic lands are Mountains.'))).toBe(true)
    expect(
      mutatesLand(
        card(
          'Spreading Seas',
          'Enchant land\nWhen this Aura enters, draw a card.\nEnchanted land is an Island.',
        ),
      ),
    ).toBe(true)
  })

  /*
   * `in addition to` is what separates a mana fixer from land denial, and the
   * card says which it is. Urborg and Yavimaya are in a great many decks and
   * calling either of them mass land denial would discredit the whole finding.
   */
  it('does not match a type ADDED rather than replaced', () => {
    const additive = [
      card('Urborg, Tomb of Yawgmoth', 'Each land is a Swamp in addition to its other land types.'),
      card(
        'Yavimaya, Cradle of Growth',
        'Each land is a Forest in addition to its other land types.',
      ),
      card(
        'Prismatic Omen',
        'Lands you control are every basic land type in addition to their other types.',
      ),
    ]
    for (const c of additive) expect(mutatesLand(c), c.name).toBe(false)
  })

  it('does not match a land that becomes a creature', () => {
    expect(
      mutatesLand(
        card(
          'Treetop Village',
          'This land enters tapped.\n{T}: Add {G}.\n{1}{G}: This land becomes a 3/3 green ' +
            "Ape creature with trample until end of turn. It's still a land.",
        ),
      ),
    ).toBe(false)
  })

  /*
   * A landfall payoff READS a type; it does not set one. All five corpus cards
   * of this shape say "If that land is a <type>", which is why the exclusion is
   * written around the conditional rather than around the type name.
   */
  it("does not match a card that merely checks a land's type", () => {
    expect(
      mutatesLand(
        card(
          'Emeria Shepherd',
          'Flying\nLandfall — Whenever a land you control enters, you may return target ' +
            'nonland permanent card from your graveyard to your hand. If that land is a ' +
            'Plains, you may return that nonland permanent card to the battlefield instead.',
        ),
      ),
    ).toBe(false)
  })

  /*
   * Word order is the rule, not mere co-occurrence.
   *
   * Both of these name a land and a basic land type in one clause and neither
   * mutates a land: Song of the Dryads turns a CREATURE into a land, which is
   * removal, and Kormus Bell turns Swamps into creatures while leaving them
   * lands. A rule that only asked "does this clause mention a land, a verb and a
   * basic type" would call Song of the Dryads mass land denial.
   */
  it('does not match when the land is what a permanent BECOMES', () => {
    expect(
      mutatesLand(
        card(
          'Song of the Dryads',
          'Enchant permanent\nEnchanted permanent is a colorless Forest land.',
        ),
      ),
    ).toBe(false)
    expect(
      mutatesLand(card('Kormus Bell', 'All Swamps are 1/1 black creatures that are still lands.')),
    ).toBe(false)
  })

  it('reads land denial as destruction or mutation', () => {
    expect(deniesLand(card('Blood Moon', 'Nonbasic lands are Mountains.'))).toBe(true)
    expect(deniesLand(card('Armageddon', 'Destroy all lands.'))).toBe(true)
    expect(deniesLand(card('Sol Ring', '{T}: Add {C}{C}.'))).toBe(false)
  })
})

const combo = (id: string, pieces: string[], produces: Combo['produces']): Combo => ({
  id: comboId(id),
  pieces: pieces.map(oracleId),
  produces,
})

describe('bracketFindings', () => {
  it('reports nothing for a deck that trips no barometer', () => {
    expect(
      bracketFindings({ cards: [card('Sol Ring', '{T}: Add {C}{C}.')], assembled: [] }),
    ).toEqual([])
  })

  /*
   * The user's own reasoning, kept in the severity: only an EARLY infinite
   * breaks a bracket's turn-count expectation, and a decklist cannot say how
   * early. So a two-card infinite warns and never errors.
   */
  it('warns rather than errors on a two-card infinite', () => {
    const findings = bracketFindings({
      cards: [],
      assembled: [combo('c1', ['A', 'B'], ['infinite-mana'])],
    })
    expect(findings).toHaveLength(1)
    expect(findings[0]?.barometer).toBe('two-card-infinites')
    expect(findings[0]?.severity).toBe('warn')
    expect(findings[0]?.count).toBe(1)
    expect(findings[0]?.combos).toEqual([comboId('c1')])
    expect(findings[0]?.cards).toEqual([oracleId('A'), oracleId('B')])
  })

  /*
   * Both halves of `isTwoCardInfinite` matter and neither is redundant: a
   * three-card infinite is not the shape the barometer names, and a two-card
   * combo that only produces value is not infinite. Counting either would
   * inflate the number the user reads.
   */
  it('counts only combos that are BOTH two cards and infinite', () => {
    const findings = bracketFindings({
      cards: [],
      assembled: [
        combo('two-value', ['A', 'B'], ['value']),
        combo('three-infinite', ['A', 'B', 'C'], ['infinite-mana']),
        combo('two-infinite', ['D', 'E'], ['infinite-turns']),
      ],
    })
    expect(findings.map((f) => f.combos)).toEqual([[comboId('two-infinite')]])
  })

  it('errors on cards that take an extra turn, and counts them', () => {
    const findings = bracketFindings({
      cards: [
        card('Time Warp', 'Target player takes an extra turn after this one.'),
        card('Temporal Manipulation', 'Take an extra turn after this one.'),
        card('Sol Ring', '{T}: Add {C}{C}.'),
      ],
      assembled: [],
    })
    expect(findings).toHaveLength(1)
    expect(findings[0]?.barometer).toBe('extra-turns')
    expect(findings[0]?.severity).toBe('error')
    expect(findings[0]?.count).toBe(2)
    expect(findings[0]?.cards).toEqual([oracleId('Time Warp'), oracleId('Temporal Manipulation')])
    expect(findings[0]?.message).toContain('2 cards')
  })

  it('warns on land denial, and counts it', () => {
    const findings = bracketFindings({
      cards: [
        card('Armageddon', 'Destroy all lands.'),
        card('Blood Moon', 'Nonbasic lands are Mountains.'),
        card('Ruinous Ultimatum', 'Destroy all nonland permanents your opponents control.'),
      ],
      assembled: [],
    })
    expect(findings).toHaveLength(1)
    expect(findings[0]?.barometer).toBe('mass-land-denial')
    expect(findings[0]?.severity).toBe('warn')
    expect(findings[0]?.count).toBe(2)
    expect(findings[0]?.cards).toEqual([oracleId('Armageddon'), oracleId('Blood Moon')])
  })

  it('reports all three at once, each with its own severity', () => {
    const findings = bracketFindings({
      cards: [
        card('Time Warp', 'Target player takes an extra turn after this one.'),
        card('Armageddon', 'Destroy all lands.'),
      ],
      assembled: [combo('c1', ['A', 'B'], ['win-the-game'])],
    })
    expect(findings.map((f) => [f.barometer, f.severity])).toEqual([
      ['two-card-infinites', 'warn'],
      ['extra-turns', 'error'],
      ['mass-land-denial', 'warn'],
    ])
  })
})

/*
 * ADR-0018 in one assertion.
 *
 * The findings are ours, and the only thing standing between "this deck has
 * three extra-turn cards" and "Wizards says bracket 2 forbids this" is the
 * sentence that says so. If it stops saying it, the product starts asserting a
 * bracket ruleset the format retired — which is the failure ADR-0006 exists to
 * prevent, so it is pinned rather than left to review.
 */
describe('BAROMETER_BASIS', () => {
  it('says the findings are ours and that no bracket is assessed from them', () => {
    expect(BAROMETER_BASIS).toContain('not a Wizards bracket verdict')
    expect(BAROMETER_BASIS).toContain('no per-bracket allowance')
    expect(BAROMETER_BASIS).toContain('no bracket is assessed')
  })
})
