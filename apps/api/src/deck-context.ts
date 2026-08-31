import type { Pool } from 'pg'
import { getCards, liveSnapshotId, type PrintingFacts } from '@roundtable/db'
import { cachedCombosInIdentity, cachedEligibleCards, cachedPrintingFacts } from './corpus-cache.js'
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
  readonly printingFacts: ReadonlyMap<OracleId, PrintingFacts>
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
 * Printing facts come from one aggregate query over the whole `printings` table
 * rather than a lookup per card. Before ADR-0011 these were hardcoded null,
 * which silently disabled budget scoring, `price:` and `is:reserved` — all three
 * were implemented and all three were dead.
 *
 * `power` and `toughness` stay null: they are not stored on the oracle row, and
 * `/cards/search` still rejects queries that use them (doc 10 §10.9).
 */
const toPoolCard = (card: Card, facts: PrintingFacts | undefined): PoolCard => ({
  card,
  roles: card.roles,
  bracketFlags: [],
  priceUsd: facts?.priceUsd ?? null,
  rarity: facts?.rarity ?? null,
  setCode: facts?.setCode ?? null,
  power: null,
  toughness: null,
  reserved: facts?.reserved ?? false,
})

export const loadDeckContext = async (pool: Pool, deck: Deck): Promise<DeckContext> => {
  const missing: { source: string; reason: string }[] = []

  /*
   * The snapshot id is read FIRST, on its own, because it is the combo cache's
   * freshness key — the other three cannot start until it is known.
   *
   * It is one small row, and the alternative is fetching combos before knowing
   * whether the held set is still good, which is the whole cost this avoids.
   */
  const snapshotId = await liveSnapshotId(pool)

  // All three are corpus reference data: identical for every request with the
  // same key, and changing only when the ingest runs. See `corpus-cache` — the
  // uncached versions moved ~86 MB per request and took production down.
  const [eligible, combos, printingFacts] = await Promise.all([
    cachedEligibleCards(pool, deck.colorIdentity, deck.excludeUniversesBeyond, snapshotId),
    cachedCombosInIdentity(pool, deck.colorIdentity, snapshotId),
    cachedPrintingFacts(pool, snapshotId),
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
    pool: eligible.map((c) => toPoolCard(c, printingFacts.get(c.oracleId))),
    comboIndex: index,
    counts,
    targets,
    snapshotId,
    printingFacts,
    missing,
  }
}
