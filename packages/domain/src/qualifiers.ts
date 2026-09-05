import type { Card, CardType, Color } from './card.js'
import type { SynergyTag } from './synergy.js'

/**
 * Semantic qualifiers (ADR-0057).
 *
 * A want says WHICH EVENT a card pays off. It does not say which cards can
 * cause that event for it, and for some cards that gap is the difference
 * between a true claim and a false one:
 *
 *   Y'shtola, Night's Blessed
 *     "Whenever you cast a noncreature spell with mana value 3 or greater…"
 *     wants = ["spell-cast"]
 *
 * Counterspell produces `spell-cast` and costs two, so the model scored it as
 * an enabler for her and the reason chip said "enables your spell-cast". The
 * card does not trigger her at all.
 *
 * ------------------------------------------------------------ the measurement
 *
 * Over the 31,782 commander-legal cards, attributing each want to the sentence
 * that produced it (derive with one sentence as the text, subtract what the
 * type line alone gives) there are 16,845 want clauses on the curated events.
 * 2,098 of them — 12.5% — carry a qualifier on the TRIGGER.
 *
 * The trigger, not the sentence, and the distinction is most of the number.
 * Classifying the whole sentence says 44.8%, and 3,478 of those are "you
 * control" — which is not a qualifier but the SUBJECT question, and ADR-0022
 * and ADR-0054 already model it.
 *
 *   1,045  zone                  960  card-type            133  subtype
 *     118  ordinal-count          62  colour                57  timing
 *      47  mana-value             40  keyword-restriction   28  power/toughness
 *
 * ---------------------------------------------------------------- the honoured
 *
 * Three kinds, and the test is the same for all three: can it be evaluated
 * against a CANDIDATE CARD's own columns? `mana_value`, `types` and `colors`
 * are all in the eligible read already, so no producer has to advertise
 * anything — the matcher reads the candidate. That asymmetry is what makes this
 * affordable.
 *
 *   mana-value   47 clauses, removes 68.0% of the pairs it touches
 *   card-type   987 clauses, removes  4.1% of the pairs it touches
 *   colour       57 clauses, removes 74.8% of the pairs it touches
 *
 * Corpus-wide that is 570,255 of 20,896,723 currently-scoring want→supply
 * pairs: **2.73%**. The model gets sharper; the feed does not go quiet.
 *
 * THE SURPRISE, and it is the reason this file exists in the shape it does.
 * Y'shtola is over-broad on two axes and only one of them bites. Every
 * `spell-cast` producer is an instant or a sorcery by type line, so 7,025 of
 * the 7,211 suppliers (97.4%) are ALREADY noncreature: her "noncreature" clause
 * removes 2.6% of them and her mana-value floor removes 41.2%. The type axis is
 * kept anyway, for two reasons — it is what the reason chip has to say to be
 * honest, and the 186 exceptions are real: an adventure or MDFC creature whose
 * other half is an instant produces `spell-cast` from the joined type line and
 * triggers nothing when the creature half is cast.
 *
 * ---------------------------------------------------------------- the refused
 *
 * ORDINAL-COUNT (118), TIMING (57) and ACCUMULATED-THRESHOLD (51). "Your second
 * spell each turn", "during your turn", "if a player lost 4 or more life this
 * turn" — Y'shtola's own first line is the third of these. Every one is a fact
 * about GAME STATE, and no property of a candidate card can satisfy or fail it.
 * A qualifier that cannot be evaluated is not a qualifier, it is a note.
 *
 * ZONE (1,045), and this is the correction worth stating loudest. 1,001 of them
 * are `graveyard-creature`, whose tag IS "a creature card in a graveyard". The
 * zone is the tag's own definition. Reading it as a constraint would have the
 * tag exclude the only thing it means.
 *
 * SUBTYPE (133) and KEYWORD-RESTRICTION (40). "Whenever an Elf you control
 * dies", "whenever a creature with flying attacks". Both are ALREADY CARRIED:
 * ADR-0046's `subtype:*` and `ability:*` families fire on exactly these clauses,
 * and the same relation — same tag, opposite direction — already scores them.
 * Re-expressing them here would be two names for one claim, which is the ground
 * `semantic-tokens.ts` refused `subtype:treasure` on.
 *
 * PAYOFF-ONLY TAGS. `creature-cast` carries 114 qualified clauses and every one
 * removes exactly ZERO pairs, because ADR-0054 refused its producer side
 * deliberately: a tag with no suppliers has no pairs for a qualifier to cut.
 * Same for `extra-turns`.
 *
 * POWER/TOUGHNESS (28) and COUNTER-THRESHOLD (4) are evaluable and are DEFERRED
 * rather than refused. The populations are too small to earn the machinery, and
 * `power`/`toughness` are in the read whenever someone wants to add them.
 *
 * ------------------------------------------------------------------- the shape
 *
 * EXCLUDE, not reduce, and the reason is what a tag qualifier IS. It is a game
 * rule, and a trigger has no partial state: Counterspell does not half-trigger
 * Y'shtola. ADR-0058 makes the opposite ruling one level over, for roles, and
 * the difference is exactly that a role qualifier is a judgement about coverage
 * — Disenchant really is removal — where this is a fact about the rules.
 *
 * DERIVED, NOT STORED (ADR-0048's rule, applied again): "store a derivation
 * whose inputs the read does not need; derive one whose inputs it already
 * carries." The input here is the wanter's own `oracle_text`, which is column
 * ten of the twenty-four the eligible read already ships. So `synergy_wants`
 * stays `text[]`, there is no column, no migration and no re-ingest, and the
 * `wants:spell-cast` filter keeps working unchanged because the stored array is
 * untouched — the qualifier rides BESIDE the tag, never inside the string.
 *
 * Encoding it in the string was considered and refused on two concrete
 * breakages rather than on taste: `evaluate.ts` matches `wants:` by exact
 * string equality, so `spell-cast?mv>=3` is a tag `wants:spell-cast` cannot
 * reach; and `SYNERGY_TAGS` is an append-only persisted contract that migration
 * 0014 sorts stored deck emphasis into, so a new spelling silently reorders
 * scoring ties for decks that already exist.
 */

/**
 * A constraint on which cards can cause a wanted event.
 *
 * A discriminated union rather than a bag of optional fields (AGENTS.md §7), so
 * adding a fourth kind is a compile error everywhere it matters.
 */
export type WantQualifier =
  | { readonly kind: 'mana-value'; readonly bound: 'at-least' | 'at-most'; readonly value: number }
  /**
   * `include` is a DISJUNCTION and `exclude` a conjunction of negations, which
   * is how the cards are worded: "an instant or sorcery spell" is one predicate
   * and reading it as two would exclude every sorcery. An empty `include` means
   * "any type", so `noncreature` is `{ include: [], exclude: ['creature'] }`.
   */
  | {
      readonly kind: 'card-type'
      readonly include: readonly CardType[]
      readonly exclude: readonly CardType[]
    }
  | { readonly kind: 'colour'; readonly colors: readonly Color[] }

export interface QualifiedWant {
  readonly tag: SynergyTag
  /** Empty is impossible here — an unqualified want emits no entry at all. */
  readonly qualifiers: readonly WantQualifier[]
}

/**
 * The tags a qualifier may be attached to.
 *
 * Deliberately ONE. `spell-cast` carries 471 of the ~1,090 honoured clauses and
 * is the only tag where a card-property qualifier both occurs often and removes
 * a measurable number of pairs. The rest of the honoured population is spread
 * across `token|colour` (37 clauses), `artifact-etb|card-type` (43) and a long
 * tail of ones and twos, and every one of those tags has a producer rule whose
 * own wording already narrows it.
 *
 * A set rather than a bare constant so the refusal is checkable from a test,
 * and so the next tag is one entry rather than a refactor.
 */
export const QUALIFIABLE_TAGS: ReadonlySet<SynergyTag> = new Set<SynergyTag>(['spell-cast'])

const TYPE_WORDS: readonly CardType[] = [
  'creature',
  'instant',
  'sorcery',
  'artifact',
  'enchantment',
  'planeswalker',
  'battle',
  'land',
]

const COLOUR_WORDS: ReadonlyMap<string, Color> = new Map([
  ['white', 'W'],
  ['blue', 'U'],
  ['black', 'B'],
  ['red', 'R'],
  ['green', 'G'],
])

/**
 * The cast trigger, and the sentence it opens.
 *
 * Runs to the end of the SENTENCE, not to the first comma, and `objectPhrase`
 * below finds the end of the trigger inside it. That split is ADR-0057's
 * correction: `[^,.)\n]` was both too long and too short at once — it ran past
 * the trigger into a second event, and it stopped inside a list.
 *
 * `casts?` and `copy|copies` because magecraft says "cast or copy", and the
 * closing `)` still ends the run because prowess only ever states its qualifier
 * inside reminder text: Monastery Swiftspear's rules text is the word "Prowess"
 * and a parenthesis. `semantic-tokens.ts` strips reminder text and is right to
 * — a Reach reminder made 417 Spiders look like flying payoffs — but here the
 * reminder is the only place the qualifier is written down.
 */
const CAST_TRIGGER =
  /\b[Ww]henever (?:you|a player|an opponent) (?:casts?|copy|copies)(?: or (?:casts?|copy|copies))? ([^.)\n]{0,200})/g

/**
 * A SERIAL comma, which continues the object phrase rather than ending it.
 *
 * The trigger's own comma is followed by a clause; a list's comma is followed by
 * another item. The difference this reads is the serial comma itself — the `+`
 * requires at least one interior `word,` — and it is load-bearing rather than
 * decorative. With `*` the phrase "a noncreature spell, and create a 1/1 white
 * Spirit creature token" continues through the effect and the card claims to
 * want white creature spells.
 *
 * Two commander-legal cards state one, and both were the whole of the damage it
 * did: "a spell that's white, blue, black, or red" was read as `white`, and
 * Quirion Dryad and Questing Druid were the only two cards the qualifier
 * silenced to zero candidates.
 */
const SERIAL_LIST = /^,(?:\s+[a-z]+,)+\s+(?:or|and)\s+[a-z]+(?![a-z])/

/**
 * The relative clause that describes the TARGET, not the spell.
 *
 * "Whenever you cast a spell that targets this creature" — `creature` is what
 * the spell points at. Reading it as the spell's own type inverts the filter
 * exactly, because every `spell-cast` supplier is an instant or a sorcery by
 * construction: `include: ['creature']` keeps only the 186 adventure and MDFC
 * creature-halves, which are the only suppliers that CANNOT trigger it.
 */
const TARGET_CLAUSE = /\s+that targets?\b/

/**
 * A second trigger event, sharing the "whenever" but not the "cast".
 *
 * "Whenever you cast a spell from exile OR A LAND YOU CONTROL ENTERS from
 * exile" is two triggers. The capture ran through both and derived `land`,
 * which no instant or sorcery can be, so Faldorn's payoff set became the eleven
 * MDFCs with a land back face.
 *
 * The marker is a VERB, and that is the whole distinction: a disjunct naming
 * another kind of spell is a bare noun phrase ("a noncreature spell or a Dragon
 * spell"), where a disjunct that is its own event has to say what happens.
 * `ELIDED` is the shape that reuses the subject — "cast a spell or ACTIVATE an
 * ability" — and `OWN` the shape that brings its own.
 *
 * Scanned per disjunct rather than over the tail, and that is why Unbound
 * Flourishing survives: "an instant or sorcery spell or activate an ability"
 * must end at the SECOND `or`, and a search over everything after the first one
 * would find `activate` and cost the card its `sorcery`.
 */
const ELIDED_EVENT = /^(?:activates?|plays?|copy|copies|cycles?|discards?|sacrifices?)\b/
const OWN_EVENT = /\b(?:enters?|dies?|leaves?|attacks?|blocks?|becomes?|is put|are put)\b/

/**
 * Where the trigger ends inside the sentence it opened.
 *
 * Three boundaries, taken at the EARLIEST of them, so the order they are
 * written in cannot change the answer. Everything past the boundary is either
 * the effect, the target, or a different event — and in all three cases its
 * words are not about the spell that was cast.
 */
const objectPhrase = (sentence: string): string => {
  // 1. The comma that ends the trigger, stepping over serial commas.
  let phrase = ''
  let rest = sentence
  for (;;) {
    const comma = rest.indexOf(',')
    if (comma < 0) {
      phrase += rest
      break
    }
    phrase += rest.slice(0, comma)
    const tail = rest.slice(comma)
    const list = SERIAL_LIST.exec(tail)
    if (list === null) break
    phrase += list[0]
    rest = tail.slice(list[0].length)
  }

  // 2. The target clause, and 3. the second event. Earliest wins.
  const ends: number[] = [phrase.length]
  const target = TARGET_CLAUSE.exec(phrase)
  if (target !== null) ends.push(target.index)
  for (const or of phrase.matchAll(/ or /g)) {
    const after = phrase.slice(or.index + ' or '.length)
    const disjunct = after.split(' or ')[0] ?? after
    if (ELIDED_EVENT.test(after) || OWN_EVENT.test(disjunct)) {
      ends.push(or.index)
      break
    }
  }
  return phrase.slice(0, Math.min(...ends))
}

const uniq = <T>(values: readonly T[]): readonly T[] => [...new Set(values)]

/**
 * The qualifiers stated by one trigger's object phrase.
 *
 * THERE IS NO GUARD AGAINST THE UNEVALUABLE KINDS, and its absence is a
 * decision rather than an omission. An ordinal, a timing window or an
 * accumulated threshold contributes no type, colour or mana-value word, so it
 * simply matches nothing here and the clause comes back empty — the refusal is
 * structural.
 *
 * A guard was written first and it made the model WORSE on the 13 clauses that
 * state both, because it dropped the whole trigger rather than the offending
 * half. "Whenever you cast an instant spell during your main phase" (Dovin's
 * Acuity) and "whenever you cast your fourth noncreature spell each turn" (The
 * Fantasticar) each carry one qualifier that is perfectly evaluable, and
 * keeping it is SOUND: a creature spell can never turn Dovin's Acuity on, in
 * any phase. What is dropped is the extra narrowing the timing would add, which
 * costs precision and never costs correctness.
 *
 * The direction matters more than the rule. Everything refused here is refused
 * by being over-inclusive, so no candidate is ever excluded on a qualifier the
 * model only half understands.
 */
const parseObject = (phrase: string): readonly WantQualifier[] => {
  const out: WantQualifier[] = []

  const mana = /\b(?:mana value|converted mana cost) (\d+) or (greater|less)\b/i.exec(phrase)
  if (mana !== null) {
    out.push({
      kind: 'mana-value',
      bound: mana[2]!.toLowerCase() === 'greater' ? 'at-least' : 'at-most',
      value: Number(mana[1]),
    })
  }

  const include: CardType[] = []
  const exclude: CardType[] = []
  for (const word of TYPE_WORDS) {
    if (new RegExp(`\\bnon${word}\\b`, 'i').test(phrase)) exclude.push(word)
    else if (new RegExp(`(?<!non)\\b${word}\\b`, 'i').test(phrase)) include.push(word)
  }
  if (include.length > 0 || exclude.length > 0) {
    out.push({ kind: 'card-type', include: uniq(include), exclude: uniq(exclude) })
  }

  const colors: Color[] = []
  for (const [word, letter] of COLOUR_WORDS) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(phrase)) colors.push(letter)
  }
  if (colors.length > 0) out.push({ kind: 'colour', colors: uniq(colors) })

  return out
}

/**
 * The qualifiers on a card's wants, read from its own oracle text.
 *
 * Read on the WHOLE text rather than per face, unlike `deriveSynergy`. A cast
 * trigger is bounded by its own comma and cannot reach across a face boundary,
 * so the per-face split that ADR-0011 needs for gap-crossing rules buys nothing
 * here — and it was measured there too: 0 of the 825 multi-faced commander-legal
 * cards derive differently split than joined.
 *
 * Returns NOTHING for a card with no qualified want, and that is the boundary
 * that keeps this to 2.73% of pairs: 246 cards read "whenever you cast a spell"
 * and every one of them means any spell.
 */
export const deriveWantQualifiers = (card: Pick<Card, 'oracleText'>): readonly QualifiedWant[] => {
  if (!QUALIFIABLE_TAGS.has('spell-cast')) return []
  const found: (readonly WantQualifier[])[] = []
  for (const match of card.oracleText.matchAll(CAST_TRIGGER)) {
    const qualifiers = parseObject(objectPhrase(match[1] ?? ''))
    // A bare "whenever you cast a spell" states no constraint, and a trigger
    // that states none makes every other trigger on the card irrelevant: the
    // card is turned on by anything. Reported as an empty list, which
    // `satisfiesQualifiers` reads as "no constraint".
    if (qualifiers.length === 0) return []
    found.push(qualifiers)
  }
  if (found.length === 0) return []
  /*
   * TWO QUALIFIED TRIGGERS ARE A DISJUNCTION, and a flat list of qualifiers is
   * a conjunction. 45 commander-legal cards state two, and they are REFUSED
   * rather than merged, because every merge rule that fits some of them breaks
   * the rest:
   *
   *   Primeval Bounty triggers on "a creature spell" AND on "a noncreature
   *     spell" — the intersection is empty and the union is every spell;
   *   Ardbert, Warrior of Darkness wants "a white spell" or "a black spell",
   *     which unions correctly because `colour` is already a disjunction;
   *   Niblis of Frost wants "a noncreature spell" or "an instant or sorcery
   *     spell", where one is a strict subset of the other.
   *
   * Three different right answers. Inventing a fourth rule to cover them is
   * exactly the guess ADR-0006 forbids, so the card keeps its unqualified want.
   *
   * That is the SAFE direction and the reason the refusal is cheap: it fails to
   * sharpen 45 cards and can never wrongly exclude one. The commonest case is
   * not a disagreement at all — Seeker of the Way and Jeskai Ascendancy print
   * "a noncreature spell" twice — so identical triggers are collapsed first and
   * only a genuine disagreement is dropped.
   */
  const distinct = new Set(found.map((qualifiers) => JSON.stringify(qualifiers)))
  if (distinct.size > 1) return []
  return [{ tag: 'spell-cast', qualifiers: found[0]! }]
}

/**
 * Whether a candidate card can cause the event the qualifiers constrain.
 *
 * EVERY qualifier from one trigger must hold — Y'shtola wants a noncreature
 * spell AND one costing three or more. An empty list is true, which is what an
 * unqualified want is.
 *
 * Reads the candidate's own columns and asks the producer for nothing. That is
 * the asymmetry the whole design rests on: `manaValue`, `types` and `colors` are
 * already on the wire for every eligible card, so honouring a qualifier costs
 * one predicate and no new data.
 */
export const satisfiesQualifiers = (
  candidate: Pick<Card, 'manaValue' | 'types' | 'colors'>,
  qualifiers: readonly WantQualifier[],
): boolean =>
  qualifiers.every((qualifier) => {
    switch (qualifier.kind) {
      case 'mana-value':
        return qualifier.bound === 'at-least'
          ? candidate.manaValue >= qualifier.value
          : candidate.manaValue <= qualifier.value
      case 'card-type': {
        if (qualifier.exclude.some((type) => candidate.types.includes(type))) return false
        if (qualifier.include.length === 0) return true
        return qualifier.include.some((type) => candidate.types.includes(type))
      }
      case 'colour':
        return qualifier.colors.some((color) => candidate.colors.includes(color))
    }
  })

/**
 * The tags one supplier actually supplies to one wanter (ADR-0057 §11).
 *
 * ONE PAIR, ONE ANSWER, and it exists because the ADR's caller count was wrong.
 * It said "both production callers pass it" and there were four. `recommend.ts`
 * and `cut.ts` go through `synergyMatches` and were right; `deckweb/model.ts`
 * and the card panel's "Synergises with" list each wrote the intersection out
 * by hand —
 *
 *   fromSupplies.filter((t) => to.synergyWants.includes(t))
 *
 * — and printed "Pongify causes casting spells; Y'shtola, Night's Blessed
 * benefits from it" on the deck web's own table, for a one-mana instant, on the
 * commander the ADR is named after.
 *
 * `synergyMatches` cannot serve those two. It answers about a DECK: `deck.wants`
 * is a weight per tag, deliberately, and both surfaces need the answer for a
 * named pair of cards. So the shared thing is this, which is the smallest claim
 * both can be built from, and `eslint.config.js` bans the raw intersection in
 * `apps/web` so a fifth caller is a lint error rather than a fifth report.
 *
 * Generic over the tag type because the two callers hold different ones: the
 * domain has `SynergyTag`, and `apps/web` carries `string[]` off the wire.
 *
 * ABSENT `candidate` MEANS "THE CALLER DID NOT ASK", never "this supplier
 * satisfies the qualifier" — the same fallback and the same direction as
 * `synergyMatches`: over-inclusive, which can waste a row and can never report a
 * real payoff as no use.
 */
export const suppliedWants = <Tag extends string>(
  supplied: readonly Tag[],
  wanter: {
    readonly wants: readonly Tag[]
    readonly qualifiers?: readonly QualifiedWant[]
  },
  options: { readonly candidate?: Pick<Card, 'manaValue' | 'types' | 'colors'> } = {},
): readonly Tag[] => {
  /*
   * ARRAYS, NOT SETS, and it is measured rather than preferred. This runs once
   * per PAIR inside the deck web's O(n²) loop — 10,000 calls on a hundred
   * nodes, against a 16 ms budget for the whole build — and a card carries a
   * handful of tags. Building two Sets per call to search three elements cost
   * the budget outright: the first version of this measured 16.04 ms where the
   * raw intersection it replaced measured 15.2, and `deckweb/model.test.ts`
   * failed on it. `includes` over a three-element array is faster than
   * allocating the Set that would search it.
   */
  const out: Tag[] = []
  for (const tag of supplied) {
    if (!wanter.wants.includes(tag) || out.includes(tag)) continue
    const qualified = wanter.qualifiers?.find((q) => (q.tag as string) === tag)
    const facts = options.candidate
    if (qualified !== undefined && facts !== undefined) {
      if (!satisfiesQualifiers(facts, qualified.qualifiers)) continue
    }
    out.push(tag)
  }
  return out
}

const LIST = (words: readonly string[], joiner: string): string =>
  words.length <= 1
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')} ${joiner} ${words[words.length - 1]!}`

const COLOUR_NAMES: ReadonlyMap<Color, string> = new Map([
  ['W', 'white'],
  ['U', 'blue'],
  ['B', 'black'],
  ['R', 'red'],
  ['G', 'green'],
])

/**
 * The qualifier in words, for the reason chip (pillar P4).
 *
 * The sentence a reason may say is bounded by what the qualifier supports.
 * "Benefits from your spell-cast" was a claim about every instant in the deck;
 * "benefits from your noncreature spells costing 3 or more" is a claim about
 * the ones that actually trigger the card. Returns `''` when there is nothing
 * to add, so the caller prints its existing unqualified sentence rather than
 * this file inventing a second one.
 *
 * "Costing 3 or more" rather than "with mana value 3 or greater": the chip is
 * one line under a card and the rules-text spelling is four words longer for
 * the same fact. `readable()` already makes this trade for every tag.
 */
export const qualifierWords = (qualifiers: readonly WantQualifier[]): string => {
  const parts: string[] = []
  /*
   * ADJECTIVE ORDER, which English fixes and the parse order does not. The
   * qualifiers come out of `parseObject` in the order the regexes run — mana
   * value first, because it is the cheapest test — and "costing 3 or more,
   * noncreature spells" is not a sentence. What a card says is "a noncreature
   * spell with mana value 3 or greater", so the kind that reads as an adjective
   * leads and the one that reads as a trailing clause follows.
   */
  const ORDER: Readonly<Record<WantQualifier['kind'], number>> = {
    colour: 0,
    'card-type': 1,
    'mana-value': 2,
  }
  for (const qualifier of [...qualifiers].sort((a, b) => ORDER[a.kind] - ORDER[b.kind])) {
    switch (qualifier.kind) {
      case 'card-type':
        parts.push(
          [
            ...qualifier.exclude.map((type) => `non${type}`),
            ...qualifier.include.map((type) => String(type)),
          ].join(' or '),
        )
        break
      case 'mana-value':
        parts.push(
          `costing ${String(qualifier.value)} or ${qualifier.bound === 'at-least' ? 'more' : 'less'}`,
        )
        break
      case 'colour':
        parts.push(
          LIST(
            qualifier.colors.map((c) => COLOUR_NAMES.get(c) ?? c),
            'or',
          ),
        )
        break
    }
  }
  return parts.join(', ')
}

/**
 * The restriction a SURFACE may print over a set of wanters, or `null` (ADR-0062).
 *
 * `qualifierWords` says what one wanter's restriction is. This says whether a
 * restriction is true of the whole of the thing being described — the deck, or
 * the pair of partner commanders whose semantics a chip is offering — and
 * pillar P4 makes that a different question, because the sentence is bounded by
 * the check behind it. There are two ways one wanter's restriction is not the
 * set's:
 *
 *   - SOME WANTER IS UNQUALIFIED. Y'shtola and Guttersnipe in one deck: the
 *     deck genuinely wants any spell, because Guttersnipe takes any instant.
 *     The qualified weight is less than the total, and printing Y'shtola's
 *     restriction would describe half the deck as the whole of it.
 *   - THE QUALIFIED WANTERS DISAGREE. Two partners with different floors have
 *     no one restriction, and picking either would be a claim about a card the
 *     reader is not looking at.
 *
 * Both come back `null`, which leaves the caller printing the bare, WIDER,
 * true claim — the safe direction, and the same direction every other refusal
 * in this file takes.
 *
 * The weights are a COMPARISON and never a display, which is what lets the two
 * callers hold different units: `recommend.ts` passes ADR-0057's per-wanter
 * deck weights, and `apps/web` passes one per commander, because "did every
 * wanter carry a qualifier" has the same answer either way.
 *
 * Structurally typed rather than taking `QualifiedDeckWant`, so `synergy.ts`
 * does not have to be imported to call it — the shape IS that interface, and
 * the import would be a cycle back into the module that imports this one.
 */
export const agreedRestriction = (
  totalWeight: number,
  qualified: readonly {
    readonly weight: number
    readonly qualifiers: readonly WantQualifier[]
  }[],
): string | null => {
  if (qualified.length === 0) return null
  const covered = qualified.reduce((sum, want) => sum + want.weight, 0)
  if (covered < totalWeight) return null
  const distinct = new Set(qualified.map((want) => qualifierWords(want.qualifiers)))
  const only = [...distinct]
  return distinct.size === 1 && only[0] !== undefined && only[0] !== '' ? only[0] : null
}
