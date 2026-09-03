import type { Card, CardType } from './card.js'

/**
 * What an answer can actually answer (ADR-0058).
 *
 * `spot-removal` is one role and it is not one job. Disenchant, Naturalize,
 * Krosan Grip, Vandalblast and Return to Dust are all counted under it, and not
 * one of them can kill a creature. The composition meter counts copies, so a
 * deck holding six Naturalizes reads "6 / 6 removal" and cannot answer a
 * creature — which is ADR-0031's defect ("a card counted under a job it does
 * not do") one level finer, and ADR-0054's principle applied to the object of
 * the verb rather than to the verb.
 *
 * ------------------------------------------------------------ the measurement
 *
 * Over the 31,782 commander-legal cards, by primary role:
 *
 *   spot-removal    2,563   446 (17.4%) cannot answer a creature
 *   board-wipe        509    53 (10.4%)
 *   bounce            259     8  (3.1%)
 *   counterspell      431   120 (27.8%) restricted by type, mana value or colour
 *   graveyard-hate    108     — the graveyard IS the role
 *
 * The restricted spot-removal, by what it CAN hit: artifact+enchantment 149,
 * artifact 99, land 93, enchantment 66, artifact+land 19, other 20.
 *
 * AND IT IS A COLOUR STORY, which is what makes it worth building. Creature-
 * capable spot-removal per mono-colour identity:
 *
 *   R  853 → 709      B  444 → 420      W  436 → 335
 *   C  141 → 134      U   46 →  40      G  207 →  63
 *
 * Green's removal is 70% Naturalize effects. A green deck's removal meter reads
 * satisfied out of a pool that mostly cannot kill anything.
 *
 * ------------------------------------------------------------------ the shape
 *
 * PARTIAL, NOT BINARY — the opposite ruling to ADR-0057 one level up, and the
 * difference is what the two things are. A tag qualifier is a GAME RULE:
 * Counterspell does not half-trigger Y'shtola, so it is excluded. A role
 * qualifier is a JUDGEMENT ABOUT COVERAGE: Disenchant really is removal, a deck
 * needs some, and refusing to count it would be a worse error than counting it
 * fully. **Nothing here removes a card from a role or from a count.**
 *
 * What it does instead is decide WHICH of several real answers to offer first.
 * That is a ranking change inside a group, which pillar P5 permits — grouping
 * is the product's opinion and the score orders within it — and it needs no new
 * composition dimension, no new curated number and no reach into
 * `archetype-targets.ts`.
 *
 * A SUB-TARGET WAS CONSIDERED AND DEFERRED, on a reason worth recording: it
 * requires someone to answer "of your 6 removal, how many must be creature-
 * capable?" for every archetype and every restricted role, and that number has
 * no source. It is not in `archetype-targets.ts`, it is not derivable from the
 * corpus, and inventing twenty of them is what ADR-0006 forbids.
 *
 * FRACTIONAL COUNTING WAS ALSO REFUSED, and the evidence is two strings rather
 * than a principle: `App.tsx` renders `{r.actual} / {r.ideal}` raw, so a
 * half-counted Disenchant reads "5.5 / 6" to a screen reader, and
 * `quickbuild.ts` computes `short: want - actual` and calls it a number of
 * cards, so a deck would be told it is 1.5 cards short.
 */

const PERMANENT_TYPES: readonly CardType[] = [
  'creature',
  'artifact',
  'enchantment',
  'land',
  'planeswalker',
  'battle',
]

/**
 * The verbs that answer something, and the object phrase each takes.
 *
 * Deliberately the SAME verbs `role-derivation.ts` reads to award the role. A
 * second list of removal verbs that disagreed with the first would mean a card
 * counted under a role whose scope this file could not read — the exact shape
 * of bug this file exists to close, one layer down.
 *
 * The object runs to the next comma or full stop, because past it the sentence
 * has moved on: "Destroy target creature. Its controller gains life" names a
 * creature and then a player. The clause is the unit, which is the ruling
 * `synergy.ts` makes three times.
 */
const OBJECTS: readonly RegExp[] = [
  /\bdestroy target ([^.;,\n]{0,70})/gi,
  /\bexile target ([^.;,\n]{0,70})/gi,
  /\breturn target ([^.;,\n]{0,70})/gi,
  /\bcounter target ([^.;,\n]{0,70})/gi,
  /\b(?:destroy|exile) all ([^.;,\n]{0,70})/gi,
]

/**
 * Answers that reach a creature without ever naming one in an object phrase.
 *
 * Mass damage and a mass -X/-X kill creatures by arithmetic, and "any target"
 * can always be pointed at one. Without these three the whole burn half of
 * `board-wipe` and every Lightning Bolt would read as answering nothing, which
 * would make the ordering below prefer a Naturalize over a Bolt in a deck short
 * of creature removal — the exact inversion of the point.
 *
 * The thresholds are `role-derivation.ts`'s own, not new ones: 2 damage, -X/-2.
 */
const REACHES_CREATURE: readonly RegExp[] = [
  /\bdeals? (?:\d+|X) damage to (?:target|any target)/i,
  /\bdeals? (?:X|[2-9]|\d{2,}) damage to each (?:(?!target)[a-z-]+ ){0,3}creature\b/i,
  /\ball creatures get -\d+\/-([2-9]|\d{2,})/i,
  /\beach (?:player|opponent) sacrifices (?:all|X|a) creatures?/i,
  /\btarget (?:player|opponent) sacrifices a creature/i,
]

/**
 * The head of an object phrase — everything before the qualifier that follows
 * it. "target artifact you don't control" is an artifact answer; the "you don't
 * control" is about whose, which ADR-0022 and ADR-0054 already model.
 */
const head = (phrase: string): string =>
  (phrase.split(/\b(?:you |an opponent|that |with |whose |if |unless |except )/i)[0] ?? phrase).trim()

/**
 * The card types this card's answers can be pointed at.
 *
 * Empty for a card that answers nothing, and that is a GAP rather than a claim:
 * a Grizzly Bears answers nothing and is not thereby a bad card. Every consumer
 * below treats an empty scope as "says nothing", never as "covers nothing".
 */
export const answerScope = (card: Pick<Card, 'oracleText'>): ReadonlySet<CardType> => {
  const found = new Set<CardType>()
  const text = card.oracleText

  for (const pattern of OBJECTS) {
    // `matchAll` on a `g` regex is stateless per call, so the shared literals
    // above are safe to reuse across cards.
    for (const match of text.matchAll(pattern)) {
      const phrase = head(match[1] ?? '')
      /*
       * ADD, THEN SUBTRACT, and the order is the whole of it.
       *
       * A `non-` prefix is a negation over a WIDER word: "nonland permanent"
       * says permanent and then takes lands out of it, so the two claims cannot
       * be evaluated in one pass — skipping the type when the phrase says
       * `nonland` would leave `permanent` to put it straight back.
       *
       * A single subtraction pass after every addition is also why no positive
       * test needs a `non` guard: "nonland" has no word boundary before `land`,
       * so `\bland\b` never matches inside it in the first place.
       */
      for (const type of PERMANENT_TYPES) {
        if (new RegExp(`\\b${type}s?\\b`, 'i').test(phrase)) found.add(type)
      }
      if (/\bpermanents?\b/i.test(phrase)) for (const type of PERMANENT_TYPES) found.add(type)
      for (const type of PERMANENT_TYPES) {
        if (new RegExp(`\\bnon${type}\\b`, 'i').test(phrase)) found.delete(type)
      }
    }
  }
  if (REACHES_CREATURE.some((pattern) => pattern.test(text))) found.add('creature')
  return found
}

/** How many of a deck's cards can answer each type. */
export const answerCoverage = (
  cards: readonly Pick<Card, 'oracleText'>[],
): ReadonlyMap<CardType, number> => {
  const counts = new Map<CardType, number>()
  for (const card of cards) {
    for (const type of answerScope(card)) counts.set(type, (counts.get(type) ?? 0) + 1)
  }
  return counts
}

/**
 * A quarter, and the threshold is the whole rule.
 *
 * It has to be a SHARE rather than a count, because a deck with two answers is
 * short of everything and a deck with twelve is not, and one number cannot mean
 * both. A quarter is where the green case sits: 207 of green's spot-removal
 * cards exist and 63 answer a creature, so a deck drawing from that pool lands
 * near 30% by accident and near 0% when it is built badly. Set it at a half and
 * every deck is under-covered and the ordering says nothing; set it at a tenth
 * and the green deck this exists for passes.
 *
 * Named rather than inlined because it is a judgement, and a judgement with a
 * number in it should be findable.
 */
const COVERAGE_FLOOR = 0.25

/**
 * The types this deck's own answers under-cover.
 *
 * ONE TYPE IS ASKED ABOUT, and the restriction is measured rather than lazy.
 * The corpus says the harm runs one way: 446 of the 2,563 cards counted as
 * spot-removal cannot kill a creature, and in green it is 144 of 207. There is
 * no equivalent number for the other direction — a deck full of Swords to
 * Plowshares and short of artifact removal is a real gap, but I have not
 * measured how often it happens or what it costs, and asking about all six
 * permanent types would mean five thresholds nobody has evidence for. That is
 * what ADR-0006 forbids and what the deferred sub-target was deferred for.
 *
 * Widening this is one line plus a measurement, in that order.
 *
 * SILENT FOR A DECK WITH NO ANSWERS AT ALL, which is the case that looks like
 * it should shout loudest. A deck holding nothing is short of everything, and
 * naming a type would be this file inventing a target. `findDeficits` already
 * says "you are six short of removal"; this only ever splits a tie between two
 * cards that both fill that gap.
 *
 * The denominator is the deck's BEST-covered type, not its card count: the
 * question is whether the answers this deck holds are lopsided, and a deck of
 * three answers can be as lopsided as a deck of twelve.
 */
export const underCovered = (coverage: ReadonlyMap<CardType, number>): readonly CardType[] => {
  let best = 0
  for (const count of coverage.values()) best = Math.max(best, count)
  if (best === 0) return []
  const creature = coverage.get('creature') ?? 0
  return creature / best < COVERAGE_FLOOR ? ['creature'] : []
}
