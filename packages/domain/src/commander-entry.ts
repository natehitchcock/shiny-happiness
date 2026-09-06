import type { Card } from './card.js'
import type { OracleId } from './ids.js'
import { semanticCategory, type SemanticCategory, type SynergyTag } from './synergy.js'
import { sampleWithSeed } from './seeded-random.js'

/**
 * The two ways into a deck that are not typing a commander's name (ADR-0067).
 *
 * The start screen has exactly one door: a search box that answers a name you
 * already know. That is the wrong question for someone who has not chosen yet —
 * it asks the builder to name the answer before the tool will help them look
 * for it. This file is the deterministic core of two more doors:
 *
 *   ROUTE 1, semantics. Offer a handful of the things a deck can be ABOUT, take
 *     one or more, and show the commanders that carry them.
 *   ROUTE 2, quickdraw. Deal three commanders and let one of them be a stranger.
 *
 * Everything here is a pure function of its arguments and a seed. The corpus
 * counts arrive from the database, the seed arrives from one `randomUUID()` at
 * the click, and no layer in between holds any entropy of its own — see
 * `seeded-random.ts` for why the entropy is pushed that far out.
 */

/* -------------------------------------------------------------- route 1 --- */

/**
 * How many cards stand behind one tag, counted over the commander-legal corpus.
 *
 * `commanders` is how many commander-legal COMMANDERS carry the tag;
 * `supporting` is how many commander-legal CARDS carry it at all. A tag needs
 * both to be worth offering, and they fail in different directions: a tag with
 * 400 supporting cards and 3 commanders is a deck nobody can lead, and one with
 * 40 commanders and 60 supporting cards is a deck nobody can fill.
 *
 * COUNTED OVER `produces` AND `wants` ONLY, NEVER `has`. That is the decision
 * ADR-0067 §3 exists for and it is not a performance shortcut: `has` is
 * membership derived from the type line, so every commander is a Legendary
 * Creature and every one of them carries something. Counting it makes
 * `subtype:human` a semantic on 1,409 commanders because they ARE Human, which
 * is not what "what is this deck about" asks.
 */
export interface SemanticCensusEntry {
  readonly tag: SynergyTag
  readonly commanders: number
  readonly supporting: number
}

export interface SemanticOfferThresholds {
  readonly minCommanders: number
  readonly minSupporting: number
}

/**
 * 10 commanders and 70 supporting cards.
 *
 * Measured against the live corpus — 31,782 commander-legal cards, 3,411 of
 * them commander-legal commanders — and chosen off a PLATEAU rather than a
 * cliff, which is the evidence they are not fitted to a number somebody liked:
 *
 *    8 / 60 → 69 tags       10 / 70 → 66 tags  ← chosen
 *   10 / 60 → 68 tags       10 / 75 → 65 tags
 *   10 / 65 → 67 tags       10 / 80 → 62 tags
 *                           12 / 70 → 64 tags
 *                           15 / 70 → 56 tags
 *
 * The 66 split 26 mechanics, 13 keyword, 27 type.
 *
 * ## Why this is not the number that shipped (ADR-0068)
 *
 * It was 20 / 150, on its own plateau (49 / 48 / 47 / 42 at 15 / 20 / 25 / 30
 * commanders) — sound arithmetic about the question it was asking, and the
 * question was wrong. A supporting-card floor asks how many cards are ABOUT the
 * theme; what decides whether a deck can be built is whether it can be FILLED,
 * and most of a Commander deck is staples and lands regardless of what it is
 * about. An Angel deck is fourteen Angels plus ramp, removal and thirty-odd
 * lands. The 150 floor excluded it for having too few Angels.
 *
 * The 18 tags the drop admits are almost entirely tribal, which is the evidence
 * the old floor was measuring the wrong thing: vampire (24 commanders / 125
 * supporting), ally (20/115), bird (19/98), wizard (17/98), angel (14/76),
 * dinosaur (14/84), knight (14/100), phyrexian (14/85), merfolk (12/77),
 * saproling (12/92), wolf (11/77), hero (35/72), plus creature-cast (27/100),
 * land-creature (19/192), protection (16/148), forest (13/194), arcane (12/90)
 * and reach (11/108). The offer becomes markedly more tribal, which is the
 * point rather than a side effect.
 *
 * Two admitted tags are worth a reader's scepticism and neither is excluded
 * here, because a curated exclusion list is a separate decision from a
 * threshold: `subtype:hero` (35/72) is almost certainly noise — Theros
 * hero's-path cards rather than a deck anybody builds — and `subtype:forest`
 * (13/194) and `subtype:arcane` (12/90) are real but odd answers to "what is
 * this deck about".
 */
export const SEMANTIC_OFFER_THRESHOLDS: SemanticOfferThresholds = {
  minCommanders: 10,
  minSupporting: 70,
}

/**
 * How many of the qualifying tags one draw puts in front of the builder.
 *
 * THREE, and it was eight (ADR-0068). Eight chips is a wall of vocabulary in
 * front of somebody who has not chosen anything yet and is being asked the
 * vaguest question on the screen; three is a prompt. Nothing is lost by
 * narrowing it — the redraw is still free and still deals a fresh sample, and
 * the whole qualifying set is now one press away rather than unreachable.
 */
export const SEMANTIC_OFFER_SAMPLE = 3

export interface SemanticOffer {
  readonly tag: SynergyTag
  readonly category: SemanticCategory
  readonly commanders: number
  readonly supporting: number
}

/**
 * Category order for display, and the reason it is not alphabetical.
 *
 * The same order `App.tsx`'s `OFFER_CATEGORIES` already uses, for the same
 * reason ADR-0065 gave: the three kinds are unequal, and the curated behaviours
 * — the things a deck is usually about — lead.
 */
const CATEGORY_ORDER: readonly SemanticCategory[] = ['mechanics', 'keyword', 'type']

/**
 * Sortable by category and tag, which is all the ordering needs.
 *
 * Structural rather than `SemanticOffer`, so the CLIENT can sort the shape it
 * received off the wire — where `tag` is a plain `string`, because JSON has no
 * branded types — without a cast at the seam. A cast there would be a place the
 * compiler stops checking, on the one boundary where the two sides can actually
 * drift.
 */
interface Sortable {
  readonly tag: string
  readonly category: SemanticCategory
}

const byCategoryThenTag = (a: Sortable, b: Sortable): number => {
  const rank = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
  return rank !== 0 ? rank : a.tag.localeCompare(b.tag, 'en')
}

/**
 * The tags worth offering, in a STABLE order.
 *
 * Sorted rather than left in whatever order the census arrived in, because this
 * is what the endpoint serves and the sample below is taken from it: an unstable
 * input would make a seeded draw un-reproducible for a reason the seed cannot
 * see, which is exactly the flake this whole design is built to avoid.
 */
export const qualifyingSemantics = (
  census: readonly SemanticCensusEntry[],
  thresholds: SemanticOfferThresholds = SEMANTIC_OFFER_THRESHOLDS,
): readonly SemanticOffer[] =>
  census
    .filter(
      (entry) =>
        entry.commanders >= thresholds.minCommanders &&
        entry.supporting >= thresholds.minSupporting,
    )
    .map((entry) => ({
      tag: entry.tag,
      category: semanticCategory(entry.tag),
      commanders: entry.commanders,
      supporting: entry.supporting,
    }))
    .sort(byCategoryThenTag)

/**
 * One draw of `count` offers.
 *
 * Sampled uniformly and then RE-SORTED into category order. The draw decides
 * which eight, not where they sit: a list that reorders itself on every redraw
 * would make the redraw look like it had changed more than it did, and the
 * headings ADR-0065 introduced only work if the tags under them are in an order
 * a reader can predict.
 */
export const drawSemanticOffers = <T extends Sortable>(
  offers: readonly T[],
  seed: string,
  count: number = SEMANTIC_OFFER_SAMPLE,
): readonly T[] => sampleWithSeed(offers, count, seed).sort(byCategoryThenTag)

/**
 * How many of `picks` this card carries, over `produces` and `wants` only.
 *
 * `synergyHas` is deliberately not read, and this is the same refusal the
 * census makes one layer up. It has to be made in both places: a commander
 * ranked by a count that included membership would jump above a commander that
 * actually cares about the tag, purely for being the creature type in question.
 *
 * A tag carried in BOTH directions counts once. The question is "does this
 * commander answer to landfall", not "how many ways".
 */
export const semanticMatchCount = (card: Card, picks: readonly SynergyTag[]): number => {
  if (picks.length === 0) return 0
  const carried = new Set<string>([...card.synergyProduces, ...card.synergyWants])
  let matched = 0
  for (const pick of new Set(picks)) if (carried.has(pick)) matched += 1
  return matched
}

export interface RankedCommander {
  readonly card: Card
  /** How many of the builder's picks this commander carries. Never 0 here. */
  readonly matched: number
}

/**
 * The commanders that carry the picks, best match first.
 *
 * TWO OF TWO LEADS ONE OF TWO, which is the whole ordering rule the builder was
 * promised, and the tiebreak is the NAME.
 *
 * Not `edhrecRank`, and that omission is deliberate rather than an oversight —
 * ADR-0067 §5 argues it at length. Route 2 uses popularity because a random
 * draw has to stay recognisable; Route 1 must not, because the builder is here
 * asking what is interesting and letting popularity break the ties would answer
 * a different question in the same list. Alphabetical is the order that adds
 * nothing, which is what a tiebreak should do.
 *
 * A commander carrying NONE of the picks is dropped rather than ranked last.
 * 307 of the 3,411 legal commanders carry no `produces`/`wants` semantic at all
 * and can never match anything; a zero-match tail would be those 307 plus every
 * commander about something else, under a heading that says these carry the
 * semantics.
 */
export const rankBySemanticMatches = (
  cards: readonly Card[],
  picks: readonly SynergyTag[],
): readonly RankedCommander[] =>
  cards
    .map((card) => ({ card, matched: semanticMatchCount(card, picks) }))
    .filter((ranked) => ranked.matched > 0)
    .sort((a, b) =>
      b.matched !== a.matched
        ? b.matched - a.matched
        : a.card.name.localeCompare(b.card.name, 'en'),
    )

/* -------------------------------------------------------------- route 2 --- */

/** Two familiar, one from anywhere. */
export const QUICKDRAW_FAMILIAR = 2

/**
 * What counts as familiar enough to anchor a draw.
 *
 * 791 of the 3,411 legal commanders sit at `edhrec_rank <= 5000`. The floor was
 * not picked for roundness: 216 commanders are under rank 2000 and 393 under
 * 3000, so a stricter cut deals the same few dozen faces over and over, and a
 * uniform draw over all 3,411 is almost always three cards nobody has heard of.
 * 791 is wide enough that a reroll is a genuinely different hand and narrow
 * enough that two of the three are cards a Commander player can place.
 *
 * YES, THIS IS POPULARITY, AND ROUTE 1 REFUSES IT. Both are deliberate.
 * Popularity is not allowed to decide what is INTERESTING — that is Route 1's
 * job and its ordering has no rank in it — but it is allowed to keep a random
 * draw RECOGNISABLE, which is all it does here.
 */
export const QUICKDRAW_FAMILIAR_RANK = 5000

export interface QuickdrawPools {
  /** Commanders at or under `QUICKDRAW_FAMILIAR_RANK`. */
  readonly familiar: readonly OracleId[]
  /** Every commander-legal commander, the familiar ones included. */
  readonly all: readonly OracleId[]
}

export interface QuickdrawHand {
  readonly familiar: readonly OracleId[]
  /**
   * The card drawn from the whole pool, or `null` when the pool had nothing
   * left to draw.
   *
   * Null rather than omitted, and never silently replaced by a third familiar
   * card: the wildcard is MARKED on screen, and a hand whose third card claims
   * to be a stranger while having been drawn from the same 791 would be a
   * label that lies. A test corpus of four cards is allowed to deal two.
   */
  readonly wildcard: OracleId | null
}

/**
 * Two commanders somebody might recognise and one that could be anything.
 *
 * The wildcard is drawn from the WHOLE pool, not from the pool minus the
 * familiar 791 — it is allowed to be a popular card, because "one card from
 * everywhere" is the honest description of the draw and excluding the top of
 * the list would make the wildcard slot systematically obscure rather than
 * uniformly random. What it may not be is a DUPLICATE of a card already in the
 * hand, so the two already dealt are removed from the pool it is drawn from and
 * nothing else is.
 *
 * The hand is not shuffled. The wildcard is the last card and is marked as one,
 * so its position and its label agree; hiding it in the middle would make the
 * label the only way to find it, which buys a surprise nobody asked for at the
 * cost of a reader having to check three cards to find the one they were told
 * about.
 */
export const quickdraw = (pools: QuickdrawPools, seed: string): QuickdrawHand => {
  const familiar = sampleWithSeed(pools.familiar, QUICKDRAW_FAMILIAR, `${seed}:familiar`)
  const drawn = new Set<string>(familiar)
  const rest = pools.all.filter((id) => !drawn.has(id))
  const wildcard = sampleWithSeed(rest, 1, `${seed}:wildcard`)[0]
  return { familiar, wildcard: wildcard ?? null }
}
