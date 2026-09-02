import { describe, expect, it } from 'vitest'
import {
  ABILITY_PREFIX,
  SEMANTIC_TAGS,
  SEMANTIC_VOCABULARY,
  SUBTYPE_PREFIX,
  deriveSemanticTokens,
  pluralOfSubtype,
  semanticTagWords,
  subtypesOfTypeLine,
  type SemanticVocabulary,
} from './semantic-tokens.js'

const card = (
  typeLine: string,
  oracleText: string,
  keywords: readonly string[] = [],
): {
  typeLine: string
  oracleText: string
  keywords: readonly string[]
  name: string
} => ({ name: 'Test Card', typeLine, oracleText, keywords })

const named = (
  name: string,
  typeLine: string,
  oracleText: string,
  keywords: readonly string[] = [],
): {
  name: string
  typeLine: string
  oracleText: string
  keywords: readonly string[]
} => ({ name, typeLine, oracleText, keywords })

// A vocabulary of my own, so the derivation tests do not silently change
// meaning when the generated one is regenerated. The committed vocabulary has
// its own tests, further down.
const VOCAB: SemanticVocabulary = {
  subtypes: ['Elf', 'Druid', 'Forest', 'Soldier', 'Vehicle', 'Ape', 'Saga', 'Equipment', 'Wolf'],
  abilities: ['Flying', 'First strike', 'Trample'],
}

describe('subtypesOfTypeLine', () => {
  it('reads the words after the em dash', () => {
    expect(subtypesOfTypeLine('Legendary Creature — Elf Druid')).toEqual(['Elf', 'Druid'])
  })

  it('gives nothing for a type line with no subtypes at all', () => {
    // Sol Ring is an Artifact and nothing more. `[]` is the answer, not a guess.
    expect(subtypesOfTypeLine('Artifact')).toEqual([])
  })

  it('reads BOTH faces of a double-faced type line', () => {
    // Scryfall gives one joined type line per card and no per-face split, so
    // the two halves have to be read out of the one string.
    expect(subtypesOfTypeLine('Creature — Bat // Creature — Vampire')).toEqual(['Bat', 'Vampire'])
  })

  it('never returns the card TYPES or supertypes, which live left of the dash', () => {
    const words = subtypesOfTypeLine('Legendary Snow Artifact Creature — Elf')

    expect(words).not.toContain('Creature')
    expect(words).not.toContain('Legendary')
    expect(words).not.toContain('Artifact')
    expect(words).not.toContain('Snow')
  })
})

describe('pluralOfSubtype', () => {
  it('adds an s to the ordinary case', () => {
    expect(pluralOfSubtype('Soldier')).toBe('Soldiers')
  })

  it('knows the irregulars Magic actually prints', () => {
    // "Elves you control get +1/+1" is the single most common tribal sentence
    // in the format, and a naive `+s` reads it as nothing.
    expect(pluralOfSubtype('Elf')).toBe('Elves')
    expect(pluralOfSubtype('Wolf')).toBe('Wolves')
    expect(pluralOfSubtype('Dwarf')).toBe('Dwarves')
    expect(pluralOfSubtype('Fungus')).toBe('Fungi')
  })

  it('adds es after a sibilant', () => {
    expect(pluralOfSubtype('Fox')).toBe('Foxes')
    expect(pluralOfSubtype('Leech')).toBe('Leeches')
  })

  it('turns a consonant-y into ies', () => {
    expect(pluralOfSubtype('Ally')).toBe('Allies')
  })
})

describe('deriveSemanticTokens — the subtype a card IS', () => {
  it('produces every subtype on its own type line', () => {
    const { produces } = deriveSemanticTokens(card('Creature — Elf Druid', ''), VOCAB)

    expect(produces).toContain('subtype:elf')
    expect(produces).toContain('subtype:druid')
  })

  it('spells the tag lowercase and kebab, which is what the filter normalises to', () => {
    // `normaliseTag` lowercases and hyphenates every value the search box takes,
    // so a tag stored in any other spelling is a tag `produces:` cannot reach.
    const { produces } = deriveSemanticTokens(card('Creature — Elf', ''), VOCAB)

    expect(produces).toContain('subtype:elf')
    expect(produces).not.toContain('subtype:Elf')
  })

  it('refuses a subtype that is not in the vocabulary', () => {
    // 153 subtype words are named by no card in the corpus. A tag nothing wants
    // cannot appear in any of the three match directions, so emitting it is
    // storage spent on a claim that can never be read.
    const { produces } = deriveSemanticTokens(card('Creature — Elf Brushwagg', ''), VOCAB)

    expect(produces).toContain('subtype:elf')
    expect(produces).not.toContain('subtype:brushwagg')
  })

  it('never emits a card TYPE as a tag', () => {
    // 17,751 commander-legal cards are creatures. A tag on 56% of the corpus
    // pairs with everything and distinguishes nothing — ADR-0029 §6's ground.
    const { produces, wants } = deriveSemanticTokens(
      card('Legendary Creature — Elf', 'Destroy target creature.'),
      VOCAB,
    )

    for (const tag of [...produces, ...wants]) {
      expect(tag).not.toBe('subtype:creature')
      expect(tag).not.toBe('subtype:legendary')
    }
  })
})

describe('deriveSemanticTokens — the subtype a card WANTS', () => {
  it('reads "Untap all Forests" as wanting Forests', () => {
    // The worked example. Llanowar Druid, verbatim.
    const llanowar = named(
      'Llanowar Druid',
      'Creature — Elf Druid',
      '{T}, Sacrifice this creature: Untap all Forests.',
    )
    const { produces, wants } = deriveSemanticTokens(llanowar, VOCAB)

    expect(wants).toContain('subtype:forest')
    expect(produces).toContain('subtype:elf')
    expect(produces).toContain('subtype:druid')
  })

  it('reads a tribal lord as wanting the tribe it also is', () => {
    // Elvish Archdruid produces Elf by being one and wants Elf by paying one
    // off. Both, and kept — the same reading Tergrid already gets.
    const archdruid = named(
      'Elvish Archdruid',
      'Creature — Elf Druid',
      'Other Elf creatures you control get +1/+1.',
    )
    const { produces, wants } = deriveSemanticTokens(archdruid, VOCAB)

    expect(produces).toContain('subtype:elf')
    expect(wants).toContain('subtype:elf')
  })

  it('reads the plural, which is how a lord is actually written', () => {
    const { wants } = deriveSemanticTokens(
      card('Enchantment', 'Elves you control get +1/+1.'),
      VOCAB,
    )

    expect(wants).toContain('subtype:elf')
  })

  it('reads a token maker as PRODUCING the subtype, not wanting it', () => {
    // Direction inversion is the worst error this model can make. A card that
    // makes Soldiers is the enabler; calling it the payoff would report the
    // reason backwards, and pillar P4 says the reason carries the why.
    const { produces, wants } = deriveSemanticTokens(
      card(
        'Creature — Human Soldier',
        'When this creature enters, create two 1/1 white Soldier creature tokens.',
      ),
      VOCAB,
    )

    expect(produces).toContain('subtype:soldier')
    expect(wants).not.toContain('subtype:soldier')
  })

  it('does not read a card naming ITSELF as wanting its own subtype', () => {
    // Pre-2024 templating spells the card's own name in its rules text, so
    // Kogla, the Titan Ape would otherwise ask to be paired with Apes because
    // it said its own name.
    const kogla = named(
      'Kogla, the Titan Ape',
      'Legendary Creature — Ape',
      'When Kogla, the Titan Ape enters, destroy target artifact or enchantment.',
    )

    expect(deriveSemanticTokens(kogla, VOCAB).wants).not.toContain('subtype:ape')
  })

  it('does not read "this Vehicle" or "this Saga" as wanting one', () => {
    // A Vehicle's own text names its own type line. Naive matching made every
    // Vehicle a Vehicle payoff — 263 cards, of which 85 were only this.
    const vehicle = card('Artifact — Vehicle', 'Whenever this Vehicle attacks, draw a card.')
    const saga = card('Enchantment — Saga', 'III — This Saga deals 5 damage to each opponent.')

    expect(deriveSemanticTokens(vehicle, VOCAB).wants).not.toContain('subtype:vehicle')
    expect(deriveSemanticTokens(saga, VOCAB).wants).not.toContain('subtype:saga')
  })

  it('still reads a Vehicle that talks about OTHER Vehicles', () => {
    // The self-reference refusal above must not cost the real payoff.
    const mech = card(
      'Artifact — Vehicle',
      'Whenever this Vehicle becomes crewed, up to one other target Vehicle you control becomes an artifact creature until end of turn.',
    )

    expect(deriveSemanticTokens(mech, VOCAB).wants).toContain('subtype:vehicle')
  })

  it('ignores reminder text, which is about the rules and not about this deck', () => {
    // Reach prints "(This creature can block creatures with flying.)" — 417
    // cards, every one of which read as a flying payoff before this.
    const spider = card(
      'Creature — Spider',
      'Reach (This creature can block creatures with flying.)',
      ['Reach'],
    )

    expect(deriveSemanticTokens(spider, VOCAB).wants).not.toContain('ability:flying')
  })
})

describe('deriveSemanticTokens — keywords', () => {
  it('produces a keyword the card has', () => {
    const { produces } = deriveSemanticTokens(card('Creature — Bird', 'Flying', ['Flying']), VOCAB)

    expect(produces).toContain('ability:flying')
  })

  it('kebabs a two-word keyword', () => {
    const { produces } = deriveSemanticTokens(
      card('Creature — Knight', 'First strike', ['First strike']),
      VOCAB,
    )

    expect(produces).toContain('ability:first-strike')
  })

  it('refuses a keyword outside the vocabulary', () => {
    // 490 of 813 Scryfall keywords sit on exactly one card, because Scryfall
    // files one-off ability words ("Bad Wolf", "Allons-y!") under `keywords`.
    // Only 25 keywords in the whole corpus have any payoff card at all.
    const { produces } = deriveSemanticTokens(
      card('Sorcery', 'Buyback {3}', ['Buyback', 'Flying']),
      VOCAB,
    )

    expect(produces).toContain('ability:flying')
    expect(produces).not.toContain('ability:buyback')
  })

  it('reads an anthem for a keyword as wanting it', () => {
    // Favorable Winds, verbatim. Every flier in the deck enables it.
    const { wants } = deriveSemanticTokens(
      card('Enchantment', 'Creatures you control with flying get +1/+1.'),
      VOCAB,
    )

    expect(wants).toContain('ability:flying')
  })

  it('reads a trigger conditioned on a keyword as wanting it', () => {
    const { wants } = deriveSemanticTokens(
      card(
        'Creature — Human Warrior',
        'Whenever a creature you control with trample attacks, it gets +2/+2 until end of turn.',
      ),
      VOCAB,
    )

    expect(wants).toContain('ability:trample')
  })

  it('reads GRANTING a keyword as producing it, never as wanting it', () => {
    // "Target creature gains flying" causes flying; it does not pay it off.
    // 495 cards grant flying, and a bare word match called every one a payoff.
    const { wants } = deriveSemanticTokens(
      card('Instant', 'Target creature gains flying until end of turn.'),
      VOCAB,
    )

    expect(wants).not.toContain('ability:flying')
  })

  it('does not read a token made WITH a keyword as wanting it', () => {
    const { wants } = deriveSemanticTokens(
      card('Sorcery', 'Create a 1/1 colorless Thopter artifact creature token with flying.'),
      VOCAB,
    )

    expect(wants).not.toContain('ability:flying')
  })

  it('does not let a token clause hand its abilities to a payoff template', () => {
    // Moogles' Valor, verbatim but for the keyword. Stopping the token clause
    // at the word "token" left " with trample" in the sentence, and the
    // `for each … with X` template then read the token maker as the payoff.
    // Two keywords were in the vocabulary on nothing but this.
    const { wants } = deriveSemanticTokens(
      card(
        'Instant',
        'For each creature you control, create a 1/2 white Moogle creature token with trample.',
      ),
      VOCAB,
    )

    expect(wants).not.toContain('ability:trample')
  })

  it('still reads an anthem that FOLLOWS a token clause in the same sentence', () => {
    // The comma is where the token clause ends. "Create a 2/1 Villain token
    // with trample, then creatures you control with flying get +1/+0" is two
    // claims, and swallowing the second would be the opposite mistake.
    const { produces, wants } = deriveSemanticTokens(
      card(
        'Instant',
        'Create a 2/1 black Soldier creature token with trample, then creatures you control with flying get +1/+0 until end of turn.',
      ),
      VOCAB,
    )

    expect(produces).toContain('subtype:soldier')
    expect(wants).toContain('ability:flying')
    expect(wants).not.toContain('ability:trample')
  })
})

describe('deriveSemanticTokens — degenerate and boundary inputs', () => {
  it('gives an empty profile for a card with no text and no subtypes', () => {
    const { produces, wants } = deriveSemanticTokens(card('Artifact', ''), VOCAB)

    expect(produces).toEqual([])
    expect(wants).toEqual([])
  })

  it('reads each face separately rather than the joined text', () => {
    // The reason `deriveSynergy` reads faces: a gap that crosses the join reads
    // a subject on the front face against a verb on the back, and those two
    // abilities never share a game state.
    const { produces } = deriveSemanticTokens(
      {
        name: 'Two Sides',
        typeLine: 'Creature — Elf // Sorcery',
        oracleText: 'Flying\nCreate a 1/1 white Soldier creature token.',
        oracleTextFaces: ['Flying', 'Create a 1/1 white Soldier creature token.'],
        keywords: ['Flying'],
      },
      VOCAB,
    )

    expect(produces).toContain('subtype:elf')
    expect(produces).toContain('subtype:soldier')
  })

  it('never emits the same tag twice', () => {
    const { produces } = deriveSemanticTokens(
      card('Creature — Elf Elf', 'Create a 1/1 green Elf Warrior creature token.'),
      VOCAB,
    )

    expect(produces.filter((t) => t === 'subtype:elf')).toHaveLength(1)
  })

  it('does not fall over on a type line whose dash has no subtypes after it', () => {
    expect(() =>
      deriveSemanticTokens(card('Creature — ', 'Flying', ['Flying']), VOCAB),
    ).not.toThrow()
  })
})

describe('semanticTagWords — derived, never hand-written', () => {
  it('names a subtype by its own plural', () => {
    // The whole reason the display table can stay 21 entries long: a subtype's
    // words ARE the subtype. "This card benefits from Elves."
    expect(semanticTagWords('subtype:elf')).toBe('Elves')
    expect(semanticTagWords('subtype:equipment')).toBe('Equipment')
  })

  it('names an ability by its own word', () => {
    expect(semanticTagWords('ability:flying')).toBe('flying')
    expect(semanticTagWords('ability:first-strike')).toBe('first strike')
  })

  it('gives null for a tag that is not a semantic token, so the caller can fall back', () => {
    expect(semanticTagWords('creature-death')).toBeNull()
    expect(semanticTagWords('treasure')).toBeNull()
  })

  it('gives null for a namespaced tag outside the vocabulary rather than inventing words', () => {
    // Camarid is a real subtype that no card in the corpus refers to, so it is
    // refused as inert. Asserted rather than assumed, because if a set ever
    // prints a card that wants Camarids this test should say why it changed
    // rather than fail on a word nobody recognises.
    expect(SEMANTIC_VOCABULARY.subtypes).not.toContain('Camarid')
    expect(semanticTagWords('subtype:camarid')).toBeNull()
  })
})

describe('the committed vocabulary', () => {
  it('names both families and nothing else', () => {
    for (const tag of SEMANTIC_TAGS) {
      expect(tag.startsWith(SUBTYPE_PREFIX) || tag.startsWith(ABILITY_PREFIX)).toBe(true)
    }
  })

  it('is spelled the way the filter normalises, all the way through', () => {
    for (const tag of SEMANTIC_TAGS) {
      expect(tag).toBe(tag.toLowerCase())
      expect(tag).not.toMatch(/[\s_]/)
    }
  })

  it('has words for every tag in it', () => {
    // The counterpart of `tags.test.ts`, and the reason 292 phrases do not have
    // to be typed: every one is derived from the tag's own name.
    const missing = SEMANTIC_TAGS.filter((tag) => semanticTagWords(tag) === null)

    expect(missing).toEqual([])
  })

  it('holds no card type or supertype', () => {
    const REFUSED = [
      'creature',
      'instant',
      'sorcery',
      'artifact',
      'enchantment',
      'land',
      'planeswalker',
      'battle',
      'kindred',
      'legendary',
      'basic',
      'snow',
      'world',
    ]

    for (const word of REFUSED) expect(SEMANTIC_TAGS).not.toContain(`${SUBTYPE_PREFIX}${word}`)
  })

  it('does not re-name an event the curated tags already own', () => {
    // `treasure` is an event tag already. A `subtype:treasure` beside it would
    // be two tags for one claim, and the deck would count it twice.
    expect(SEMANTIC_TAGS).not.toContain('subtype:treasure')
  })

  it('has no duplicate entries', () => {
    expect(new Set(SEMANTIC_TAGS).size).toBe(SEMANTIC_TAGS.length)
  })

  it('is derived from the same words the derivation looks for', () => {
    // The vocabulary file carries the words in Scryfall's own casing, because
    // that is what the text rules match on; the tags are those words normalised.
    // If the two ever disagree, a tag exists that nothing can produce.
    const fromWords = new Set([
      ...SEMANTIC_VOCABULARY.subtypes.map((w) => `${SUBTYPE_PREFIX}${w.toLowerCase()}`),
      ...SEMANTIC_VOCABULARY.abilities.map(
        (w) => `${ABILITY_PREFIX}${w.toLowerCase().replace(/\s+/g, '-')}`,
      ),
    ])

    expect(new Set(SEMANTIC_TAGS)).toEqual(fromWords)
  })
})
