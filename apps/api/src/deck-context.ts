import type { Pool } from 'pg'
import { allCombos, findEligibleCards, getCards, liveSnapshotId } from '@roundtable/db'
import type {
  Card,
  ComboIndex,
  CompositionCounts,
  CompositionTarget,
  Deck,
  OracleId,
  PoolCard,
} from '@roundtable/domain'
import {
  buildComboIndex,
  compositionTargets,
  countComposition,
  primaryRole,
} from '@roundtable/domain'

/**
 * Everything both the recommendation and analysis endpoints need, loaded once.
 *
 * Assembled here rather than in each route because the two endpoints must agree:
 * an analysis saying the deck is four lands short, next to recommendations
 * computed from a different pool, is worse than either alone.
 */
export interface DeckContext {
  readonly deck: Deck
  readonly cards: ReadonlyMap<OracleId, Card>
  readonly pool: readonly PoolCard[]
  readonly comboIndex: ComboIndex
  readonly counts: CompositionCounts
  readonly targets: readonly CompositionTarget[]
  readonly snapshotId: string | null
  /**
   * Why a data source is missing, if it is. Reported to the client rather than
   * silently degrading (doc 05 §5.3): "no combos loaded" and "no combos apply"
   * look identical in the output otherwise.
   */
  readonly missing: readonly { readonly source: string; readonly reason: string }[]
}

/**
 * A card lifted into the shape the scoring engine takes.
 *
 * Printing-level fields (`priceUsd`, `rarity`, `setCode`, `reserved`) are loaded
 * only for the accepted deck, not for the whole candidate pool — hydrating
 * printings for 30k candidates to price a hundred of them is the kind of thing
 * that only hurts at real data volume.
 */
const toPoolCard = (card: Card): PoolCard => ({
  card,
  roles: card.roles,
  bracketFlags: [],
  priceUsd: null,
  rarity: null,
  setCode: null,
  power: null,
  toughness: null,
  reserved: false,
})

export const loadDeckContext = async (pool: Pool, deck: Deck): Promise<DeckContext> => {
  const missing: { source: string; reason: string }[] = []

  const [eligible, combos, snapshotId] = await Promise.all([
    findEligibleCards(pool, deck.colorIdentity),
    allCombos(pool),
    liveSnapshotId(pool),
  ])

  if (combos.length === 0) {
    missing.push({ source: 'combos', reason: 'no combo data ingested (ING-02 has not run)' })
  }
  if (snapshotId === null) {
    missing.push({ source: 'dataset-snapshot', reason: 'no live dataset snapshot (ING-01)' })
  }
  // Corpus statistics have no source and will not get one from a third party
  // (ADR-0008). Reported every time rather than quietly omitting groups 6-7.
  missing.push({
    source: 'statistics',
    reason: 'no corpus statistics: the project does not query third-party aggregates (ADR-0008)',
  })

  // The deck's own cards are needed even when outside the candidate pool — a
  // card already accepted is not an eligible candidate, but the composition
  // count and the legality check both need it.
  const deckOracleIds = [...new Set([...deck.commanders, ...deck.entries.map((e) => e.oracleId)])]
  const deckCards = await getCards(pool, deckOracleIds)

  const cards = new Map<OracleId, Card>()
  for (const card of eligible) cards.set(card.oracleId, card)
  for (const card of deckCards) cards.set(card.oracleId, card)

  const counts = countComposition(deck, cards, (card) => primaryRole(card.roles))
  const targets = compositionTargets(deck.archetype, deck.archetypeSecondary, {
    bracket: deck.targetBracket,
    averageManaValue: counts.averageManaValue,
  })

  const index = buildComboIndex(combos)

  return {
    deck,
    cards,
    pool: eligible.map(toPoolCard),
    comboIndex: index,
    counts,
    targets,
    snapshotId,
    missing,
  }
}
