import {
  COMMANDER_WEIGHT,
  SYNERGY_TAGS,
  type SynergyMatch,
  type SynergyProfile,
} from './synergy.js'
import type { SynergyTag } from './synergy.js'

/**
 * Per-deck semantic emphasis.
 *
 * A builder picks a commander and, before laying a single card down, says which
 * of that commander's semantics the deck is actually ABOUT. Tergrid causes five
 * events and benefits from three; a deck built around opponents throwing their
 * own permanents away is a different deck from one built around untapping her
 * Lantern, and until now the app could not tell the two apart — both read as
 * "Tergrid" and got the same suggestions in the same order.
 *
 * A SET OF TAGS, NOT A WEIGHT PER TAG. The user's request is a click, not a
 * slider: "add it as a focus", "de-emphasise if I wish". A per-tag strength
 * would be a second control nobody asked for, a second thing to render, and a
 * second thing to get wrong — and the moment a number exists, the honest UI has
 * to explain what 0.6 means, which is a question this feature does not have an
 * answer to. Two states, both reachable in one click, is the whole model.
 *
 * REVERSIBLE BY CONSTRUCTION. The stored value is the complete set, replaced
 * wholesale, and the empty set is a legal value that means "no emphasis". There
 * is no accumulate-only path and nothing to undo through: de-emphasising is
 * saving the same list one shorter. `null` on the wire clears it outright, for
 * the same reason `targetOverrides` accepts `null` (doc 16) — an emphasis the
 * user cannot get rid of is a trap.
 *
 * NOT A FILTER, EVER. Emphasis reorders; it never removes. See `emphasisScore`
 * and `recommend` — the term is additive, so a deck that emphasises a tag no
 * card in its colours supports gets exactly the suggestions it would have got
 * anyway, plus a report saying the emphasis found nothing. "You emphasised
 * landfall and now there are no suggestions" would be a bug wearing a feature's
 * clothes.
 */

/** The emphasised tags. Deduplicated and in `SYNERGY_TAGS` order — see `parse`. */
export type SemanticEmphasis = readonly SynergyTag[]

/** No emphasis. The state every deck starts in and can return to. */
export const NO_EMPHASIS: SemanticEmphasis = Object.freeze([])

/**
 * Whether the deck actually emphasises anything.
 *
 * `[]` and absent are the same deck. A UI that treated the first as "customised"
 * would offer a clear button that does nothing.
 */
export const hasEmphasis = (emphasis: SemanticEmphasis | undefined): boolean =>
  emphasis !== undefined && emphasis.length > 0

const ORDER = new Map(SYNERGY_TAGS.map((tag, index) => [tag, index]))

/**
 * Read an emphasis out of untrusted JSON, dropping anything that is not a tag.
 *
 * The column is `jsonb` and will hold whatever an older or newer build wrote to
 * it. Parsing rather than casting means a tag this build does not know costs
 * that one tag, not the deck's whole emphasis — the same discipline
 * `parseTargetOverrides` applies, and for the same reason: throwing would make
 * one bad entry un-openable, and an emphasis the user cannot clear is exactly
 * the trap this feature must not set.
 *
 * SORTED INTO `SYNERGY_TAGS` ORDER, not the order the user clicked. Doc 05
 * requires the same deck and dataset to produce the same ordering every time,
 * and the emphasis feeds scoring; two decks emphasising the same two tags must
 * serialise identically or a round trip through the database could reorder a
 * tie. Click order carries no meaning here anyway — emphasis is a set, and the
 * first tag clicked is not weighted above the second.
 *
 * No length cap. Deduplication already bounds the value at `SYNERGY_TAGS.length`
 * (19 today), so an arbitrary "at most five" would only be a rule to explain.
 * Emphasising every tag is degenerate rather than dangerous: it adds the same
 * constant to every card that has any tag at all and changes almost nothing,
 * which is the honest outcome of saying everything matters.
 *
 * Pure and total: every input returns a `SemanticEmphasis`, possibly empty.
 */
export const parseSemanticEmphasis = (value: unknown): SemanticEmphasis => {
  if (!Array.isArray(value)) return NO_EMPHASIS
  const kept = new Set<SynergyTag>()
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    if (!ORDER.has(entry as SynergyTag)) continue
    kept.add(entry as SynergyTag)
  }
  if (kept.size === 0) return NO_EMPHASIS
  return [...kept].sort((a, b) => (ORDER.get(a) ?? 0) - (ORDER.get(b) ?? 0))
}

/**
 * How much a tag the deck does not do yet is worth once the user emphasises it.
 *
 * One accepted card's worth of presence — `deckSynergy` gives an accepted card
 * weight 1 and the commander weight 4 — so an emphasis on a tag nothing in the
 * deck touches still orders its supporters above cards with no relation to it,
 * and still cannot out-shout a real commander-level match.
 *
 * This is what stops emphasis being silently inert. Without it, emphasising a
 * tag the deck neither produces nor wants multiplies zero: every candidate
 * scores zero on it, nothing moves, and the click the user made had no effect
 * they could observe. That happens the moment they emphasise something read off
 * a card in the feed rather than off their commander, which is the first
 * sentence of the request.
 */
export const EMPHASIS_FLOOR = 1

/**
 * How the candidate relates to each emphasised tag, strongest first.
 *
 * Computed from the matches `synergyMatches` already produced, NOT by a second
 * pass over the deck. `synergyMatches` is untouched by this feature on purpose:
 * its output feeds `synergyScore`, `synergyScore` feeds the
 * `MECHANICAL_SYNERGY_THRESHOLD` that decides whether a card lands in the
 * `high-synergy` GROUP, and grouping is the product's opinion — scoring only
 * orders within it (pillar P5, doc 05 §5.3). A multiplier applied inside
 * `synergyMatches` would let a user preference reclassify a card as high
 * synergy, which is emphasis crossing from "order these differently" into
 * "relabel these", and that is the one thing it must not do.
 *
 * A tag the candidate carries but the deck has no weight for gets a synthetic
 * `theme` match at `EMPHASIS_FLOOR`. `theme` is the weak "this card is about
 * the same thing the deck is about" reading, and a declared emphasis is exactly
 * that — the deck's intent, stated by the user instead of inferred from its
 * neighbours. The reason carries `emphasised: true` so the rendered claim is
 * about the emphasis and not about a synergy the deck does not have.
 *
 * Ties break on `SYNERGY_TAGS` order, so the result is total and never
 * reshuffles between renders (doc 05).
 */
export const emphasisMatches = (
  candidate: SynergyProfile,
  matches: readonly SynergyMatch[],
  emphasis: SemanticEmphasis,
): readonly SynergyMatch[] => {
  if (emphasis.length === 0) return []
  const wanted = new Set(emphasis)

  const best = new Map<SynergyTag, SynergyMatch>()
  for (const match of matches) {
    if (!wanted.has(match.tag)) continue
    const held = best.get(match.tag)
    if (held === undefined || match.weight > held.weight) best.set(match.tag, match)
  }

  // Produces first, then wants, so a card doing both is still one entry: `best`
  // is keyed by tag and a real match always beats the floor.
  for (const tag of [...candidate.produces, ...candidate.wants]) {
    if (!wanted.has(tag) || best.has(tag)) continue
    best.set(tag, { tag, direction: 'theme', weight: EMPHASIS_FLOOR })
  }

  return [...best.values()].sort(
    (a, b) => b.weight - a.weight || (ORDER.get(a.tag) ?? 0) - (ORDER.get(b.tag) ?? 0),
  )
}

/**
 * A 0..1 score from the emphasised matches.
 *
 * Saturating on the same curve as `synergyScore`, and for the same reason: the
 * third emphasised tag a card touches matters far less than the first, and
 * without this a card that brushes every tag the user picked would outrank one
 * that genuinely enables the tag they care most about.
 *
 * Sharing the curve also keeps the two terms comparable, which matters because
 * they are added together in `recommend`. A linear emphasis term next to a
 * saturating synergy term would mean the same card scored differently depending
 * on which of the two happened to name its tag.
 */
export const emphasisScore = (matches: readonly SynergyMatch[]): number => {
  if (matches.length === 0) return 0
  const total = matches.reduce((sum, m) => sum + m.weight, 0)
  return total / (total + COMMANDER_WEIGHT)
}
