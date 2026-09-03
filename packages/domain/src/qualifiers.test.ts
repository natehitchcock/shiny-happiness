import { describe, expect, it } from 'vitest'
import type { Card } from './card.js'
import {
  QUALIFIABLE_TAGS,
  deriveWantQualifiers,
  qualifierWords,
  satisfiesQualifiers,
} from './qualifiers.js'

/** Oracle text as Scryfall prints it, for the cards named in the ADR. */
const card = (
  name: string,
  typeLine: string,
  oracleText: string,
  extra: Partial<Card> = {},
): Pick<Card, 'name' | 'typeLine' | 'oracleText'> & Partial<Card> => ({
  name,
  typeLine,
  oracleText,
  ...extra,
})

const YSHTOLA = card(
  "Y'shtola, Night's Blessed",
  'Legendary Creature — Cat Warlock',
  'Vigilance\n' +
    'At the beginning of each end step, if a player lost 4 or more life this turn, you draw a card.\n' +
    'Whenever you cast a noncreature spell with mana value 3 or greater, ' +
    "Y'shtola deals 2 damage to each opponent and you gain 2 life.",
)

const candidate = (
  manaValue: number,
  types: Card['types'],
  colors: Card['colors'] = [],
): Pick<Card, 'manaValue' | 'types' | 'colors'> => ({ manaValue, types, colors })

const forTag = (
  subject: Parameters<typeof deriveWantQualifiers>[0],
  tag: string,
): ReturnType<typeof deriveWantQualifiers>[number]['qualifiers'] =>
  deriveWantQualifiers(subject).find((q) => q.tag === tag)?.qualifiers ?? []

describe('deriveWantQualifiers', () => {
  it("reads both of Y'shtola's axes off one trigger", () => {
    const qualifiers = forTag(YSHTOLA, 'spell-cast')
    expect(qualifiers).toContainEqual({ kind: 'mana-value', bound: 'at-least', value: 3 })
    expect(qualifiers).toContainEqual({ kind: 'card-type', include: [], exclude: ['creature'] })
  })

  /*
   * The acceptance case. Counterspell is mana value 2, so her floor rejects it;
   * it is an instant, so her type test would have kept it. The floor is the
   * whole of the case and the type clause is nearly free -- 97.4% of the
   * corpus's `spell-cast` suppliers are already noncreature.
   */
  it('rejects Counterspell and accepts a three-mana noncreature spell', () => {
    const qualifiers = forTag(YSHTOLA, 'spell-cast')
    expect(satisfiesQualifiers(candidate(2, ['instant']), qualifiers)).toBe(false)
    expect(satisfiesQualifiers(candidate(3, ['sorcery']), qualifiers)).toBe(true)
    expect(satisfiesQualifiers(candidate(4, ['instant']), qualifiers)).toBe(true)
  })

  it('rejects a five-mana creature on the type axis alone', () => {
    const qualifiers = forTag(YSHTOLA, 'spell-cast')
    expect(satisfiesQualifiers(candidate(5, ['creature']), qualifiers)).toBe(false)
  })

  /*
   * The 186 suppliers the type clause is actually for: an adventure or MDFC
   * whose other half is an instant. The type line puts `Instant` on the card so
   * it produces `spell-cast`, and casting the creature half triggers nothing.
   */
  it('rejects an adventure creature, which is why the type axis is kept at all', () => {
    const qualifiers = forTag(YSHTOLA, 'spell-cast')
    expect(satisfiesQualifiers(candidate(4, ['creature', 'instant']), qualifiers)).toBe(false)
  })

  it('reads a disjunction as one predicate, not two', () => {
    const guttersnipe = card(
      'Guttersnipe',
      'Creature — Goblin Shaman',
      'Whenever you cast an instant or sorcery spell, this creature deals 2 damage to each opponent.',
    )
    const qualifiers = forTag(guttersnipe, 'spell-cast')
    expect(qualifiers).toEqual([
      { kind: 'card-type', include: ['instant', 'sorcery'], exclude: [] },
    ])
    expect(satisfiesQualifiers(candidate(1, ['instant']), qualifiers)).toBe(true)
    expect(satisfiesQualifiers(candidate(1, ['sorcery']), qualifiers)).toBe(true)
    expect(satisfiesQualifiers(candidate(1, ['artifact']), qualifiers)).toBe(false)
  })

  it('reads the qualifier out of reminder text, because prowess only says it there', () => {
    const swiftspear = card(
      'Monastery Swiftspear',
      'Creature — Human Monk',
      'Haste\nProwess (Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.)',
    )
    expect(forTag(swiftspear, 'spell-cast')).toEqual([
      { kind: 'card-type', include: [], exclude: ['creature'] },
    ])
  })

  it('reads a colour restriction', () => {
    const subject = card(
      'Fixture',
      'Creature — Elemental',
      'Whenever you cast a red spell, this creature gets +1/+1 until end of turn.',
    )
    const qualifiers = forTag(subject, 'spell-cast')
    expect(qualifiers).toEqual([{ kind: 'colour', colors: ['R'] }])
    expect(satisfiesQualifiers(candidate(1, ['instant'], ['R']), qualifiers)).toBe(true)
    expect(satisfiesQualifiers(candidate(1, ['instant'], ['U']), qualifiers)).toBe(false)
  })

  it('reads an at-most bound as well as an at-least one', () => {
    const subject = card(
      'Fixture',
      'Creature — Elemental',
      'Whenever you cast a spell with mana value 2 or less, draw a card.',
    )
    const qualifiers = forTag(subject, 'spell-cast')
    expect(qualifiers).toEqual([{ kind: 'mana-value', bound: 'at-most', value: 2 }])
    expect(satisfiesQualifiers(candidate(2, ['instant']), qualifiers)).toBe(true)
    expect(satisfiesQualifiers(candidate(3, ['instant']), qualifiers)).toBe(false)
  })

  /*
   * THE REFUSALS, each measured rather than chosen. See ADR-0057.
   */
  it('refuses an ordinal count, because no card property can answer it', () => {
    const tomb = card(
      'Tomb of Horrors Adventurer',
      'Creature — Elf Monk',
      'When this creature enters, you take the initiative.\n' +
        'Whenever you cast your second spell each turn, copy it.',
    )
    expect(forTag(tomb, 'spell-cast')).toEqual([])
  })

  /*
   * The 13 clauses that state an evaluable qualifier AND an unevaluable one.
   * The evaluable half is kept, because keeping it is sound -- a creature spell
   * can never turn Dovin's Acuity on, in any phase -- and dropping the whole
   * trigger would cost precision for nothing.
   */
  it('keeps the evaluable half of a trigger whose other half is a timing window', () => {
    const acuity = card(
      "Dovin's Acuity",
      'Enchantment',
      'When this enchantment enters, you gain 2 life and draw a card.\n' +
        'Whenever you cast an instant spell during your main phase, ' +
        "you may return this enchantment to its owner's hand.",
    )
    expect(forTag(acuity, 'spell-cast')).toEqual([
      { kind: 'card-type', include: ['instant'], exclude: [] },
    ])
  })

  it('keeps the type when the ordinal sits in front of it', () => {
    const fantasticar = card(
      'The Fantasticar',
      'Legendary Artifact — Vehicle',
      'Flying\n' +
        'Whenever you cast a noncreature spell, you may have The Fantasticar become an artifact creature until end of turn.\n' +
        'Whenever you cast your fourth noncreature spell each turn, you may sacrifice The Fantasticar.',
    )
    expect(forTag(fantasticar, 'spell-cast')).toEqual([
      { kind: 'card-type', include: [], exclude: ['creature'] },
    ])
  })

  /*
   * ONE BARE TRIGGER UNQUALIFIES THE CARD, however many qualified ones sit
   * beside it. Cori-Steel Cutter's Flurry fires on your second spell of ANY
   * kind, and its token's prowess reminder names a noncreature spell; reading
   * only the reminder would have the Equipment claim it ignores creature
   * spells, which is false of the ability that matters.
   */
  it('drops every qualifier when one trigger on the card is bare', () => {
    const cutter = card(
      'Cori-Steel Cutter',
      'Artifact — Equipment',
      'Equipped creature gets +1/+1 and has trample and haste.\n' +
        'Flurry — Whenever you cast your second spell each turn, create a 1/1 white Monk creature token with prowess. ' +
        'You may attach this Equipment to it. ' +
        '(Whenever you cast a noncreature spell, the token gets +1/+1 until end of turn.)\n' +
        'Equip {1}{R}',
    )
    expect(deriveWantQualifiers(cutter)).toEqual([])
  })

  it('refuses an accumulated-event threshold, for the same reason', () => {
    // The line one above the trigger this file exists for. "A player lost 4 or
    // more life this turn" is a fact about the turn, not about a card.
    const qualifiers = deriveWantQualifiers(YSHTOLA)
    expect(qualifiers.map((q) => q.tag)).toEqual(['spell-cast'])
  })

  it('refuses a qualifier on a payoff-only tag, which could remove nothing', () => {
    const whisperer = card(
      'Beast Whisperer',
      'Creature — Elf Druid',
      'Whenever you cast a creature spell, draw a card.',
    )
    expect(QUALIFIABLE_TAGS).not.toContain('creature-cast')
    expect(deriveWantQualifiers(whisperer).map((q) => q.tag)).not.toContain('creature-cast')
  })

  it('says nothing at all for a card with no qualified want', () => {
    expect(deriveWantQualifiers(card('Counterspell', 'Instant', 'Counter target spell.'))).toEqual(
      [],
    )
    expect(deriveWantQualifiers(card('Blank', 'Instant', ''))).toEqual([])
  })

  /*
   * An unqualified want must stay unqualified, and this is the boundary that
   * keeps the change to 2.73% of pairs rather than all of them: 246 cards read
   * "whenever you cast a spell" and every one of them means any spell.
   */
  it('leaves a bare cast trigger unconstrained', () => {
    const conduit = card(
      'Aetherflux Conduit',
      'Artifact',
      'Whenever you cast a spell, you get {E}.',
    )
    expect(deriveWantQualifiers(conduit)).toEqual([])
  })

  /*
   * Two qualified triggers are a DISJUNCTION -- a candidate satisfying either
   * one turns the card on -- and a flat conjunction cannot say that. 45 cards,
   * refused rather than merged, because the merge is a guess: Primeval Bounty
   * triggers on "a creature spell" and on "a noncreature spell", which
   * intersects to nothing and unions to every spell.
   *
   * Refusing is the SAFE direction. It fails to sharpen those 45; it never
   * wrongly excludes.
   */
  it('refuses to qualify a card whose two triggers disagree', () => {
    const bounty = card(
      'Primeval Bounty',
      'Enchantment',
      'Whenever you cast a creature spell, put a +1/+1 counter on it.\n' +
        'Whenever you cast a noncreature spell, you gain 3 life.',
    )
    expect(deriveWantQualifiers(bounty)).toEqual([])
    const twoAxes = card(
      'Fixture',
      'Creature — Elemental',
      'Whenever you cast a spell with mana value 4 or greater, draw a card.\n' +
        'Whenever you cast an instant or sorcery spell, this creature gets +1/+1.',
    )
    expect(deriveWantQualifiers(twoAxes)).toEqual([])
    // And the consequence: nothing is excluded, which is the direction that
    // cannot report a card as useless when it is not.
    expect(satisfiesQualifiers(candidate(1, ['enchantment']), forTag(twoAxes, 'spell-cast'))).toBe(
      true,
    )
  })

  it('still qualifies a card whose two triggers say the same thing', () => {
    // Seeker of the Way and Jeskai Ascendancy both print "a noncreature spell"
    // twice. Two identical constraints are one constraint.
    const seeker = card(
      'Seeker of the Way',
      'Creature — Human Monk',
      'Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.\n' +
        'Whenever you cast a noncreature spell, this creature gains lifelink until end of turn.',
    )
    expect(forTag(seeker, 'spell-cast')).toEqual([
      { kind: 'card-type', include: [], exclude: ['creature'] },
    ])
  })
})

describe('satisfiesQualifiers', () => {
  it('is true for an empty qualifier list, which is what an unqualified want is', () => {
    expect(satisfiesQualifiers(candidate(1, ['instant']), [])).toBe(true)
  })

  it('requires EVERY qualifier on one trigger, not any', () => {
    const qualifiers = forTag(YSHTOLA, 'spell-cast')
    expect(qualifiers).toHaveLength(2)
    // mana value passes, type fails.
    expect(satisfiesQualifiers(candidate(6, ['creature']), qualifiers)).toBe(false)
  })
})

describe('qualifierWords', () => {
  /*
   * Pillar P4: the reason may not claim more than the qualifier supports. The
   * chip used to read "benefits from your spell-cast" for a card that only
   * pays off half of them.
   */
  it("puts Y'shtola's two axes into one honest phrase", () => {
    expect(qualifierWords(forTag(YSHTOLA, 'spell-cast'))).toBe('noncreature, costing 3 or more')
  })

  it('names a disjunction as the card names it', () => {
    expect(
      qualifierWords([{ kind: 'card-type', include: ['instant', 'sorcery'], exclude: [] }]),
    ).toBe('instant or sorcery')
  })

  it('is empty for no qualifier, so the caller prints the unqualified sentence', () => {
    expect(qualifierWords([])).toBe('')
  })

  it('names an at-most bound differently from an at-least one', () => {
    expect(qualifierWords([{ kind: 'mana-value', bound: 'at-most', value: 2 }])).toBe(
      'costing 2 or less',
    )
  })

  it('names a colour', () => {
    expect(qualifierWords([{ kind: 'colour', colors: ['R'] }])).toBe('red')
  })
})
