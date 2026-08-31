import type { Pool } from 'pg'
import {
  combosInIdentity,
  findEligibleCards,
  printingFactsForAll,
  type PrintingFacts,
} from '@roundtable/db'
import type { Card, Color, Combo, OracleId } from '@roundtable/domain'
import { createSnapshotCache, identityKey } from './snapshot-cache.js'

/**
 * The three corpus reads that dominate this API's data transfer.
 *
 * Every recommendation and every analysis request needs all three, and the
 * client issues a request on every filter change, every accept and every
 * auto-query tick. Measured against the real corpus before any of this:
 *
 *   combos (all)          108,046 rows   71.9 MB
 *   eligible cards         34,492 rows   12.1 MB   (five-colour deck)
 *   printing facts         34,492 rows    1.9 MB
 *
 * The last line is bigger now. ADR-0021 put the Scryfall image URLs on the
 * facts map, which took the row payload from 4.28 MB to 12.05 MB measured as
 * JSON — call it 5 MB on the wire against the 1.9 MB above. It is still the
 * cheapest place for them, because this map is read once per snapshot and the
 * routes that need art (`/cards/batch`, `/cards/search`) were already loading
 * it on every request.
 *
 * ~86 MB per request. On a metered managed database that exhausted a 5 GB
 * monthly transfer allowance in about sixty requests and took the deployment
 * down with `500`s on every route that reads the database.
 *
 * Trimming and scoping the combo read (ADR-0017) took the first line from
 * 71.9 MB to 0.5 MB for a mono-red deck — but to 19.6 MB for a five-colour
 * commander, who is legal for every combo there is. The other two do not scope
 * at all: the eligible pool for a five-colour deck IS the corpus. For those
 * decks only a cache helps, and none of the three has any reason to be re-read
 * between ingests.
 */

/**
 * Four identities each, evicting the least recently used.
 *
 * Worst case is what sets this: five colours is 19.6 MB of combos and 12.1 MB
 * of cards, so four entries of each is around 130 MB held, plus one 1.9 MB
 * facts map. Comfortable in a serverless function, and small beside what a
 * single uncached request was moving.
 *
 * One slot would be worse than it looks: two people on one warm instance with
 * different commanders would evict each other on every request, turning a cache
 * into a small constant overhead.
 */
const MAX_IDENTITIES = 4

const combos = createSnapshotCache<readonly Combo[]>(MAX_IDENTITIES)
const eligible = createSnapshotCache<readonly Card[]>(MAX_IDENTITIES)
/** Not scoped by anything — one map for the whole corpus, so one entry. */
const facts = createSnapshotCache<ReadonlyMap<OracleId, PrintingFacts>>(1)

/** Combos castable in this identity (ADR-0017). */
export const cachedCombosInIdentity = async (
  pool: Pool,
  identity: readonly Color[],
  snapshotId: string | null,
): Promise<readonly Combo[]> =>
  combos.get(snapshotId, identityKey(identity), () => combosInIdentity(pool, identity))

/**
 * The candidate pool for a deck.
 *
 * Keyed on the Universes Beyond flag as well as the identity, because that one
 * IS a deck option the user can toggle mid-session (ADR-0011) — unlike colour
 * identity, which is fixed by the commanders. Two entries for one deck is the
 * correct answer there: the pools genuinely differ.
 */
export const cachedEligibleCards = async (
  pool: Pool,
  identity: readonly Color[],
  excludeUniversesBeyond: boolean,
  snapshotId: string | null,
): Promise<readonly Card[]> =>
  eligible.get(
    snapshotId,
    `${identityKey(identity)}:${excludeUniversesBeyond ? 'no-ub' : 'all'}`,
    () => findEligibleCards(pool, identity, { excludeUniversesBeyond }),
  )

/**
 * Price, rarity, set, reserved-list status and art URLs for every card.
 *
 * Cached hardest of the three. It is the smallest read but the most frequent:
 * the deck context needs it, and so do `/cards/batch` and the card detail
 * route — and the client calls `/cards/batch` to hydrate names after every
 * single recompute, so an uncached one ran at least twice per user action.
 */
export const cachedPrintingFacts = async (
  pool: Pool,
  snapshotId: string | null,
): Promise<ReadonlyMap<OracleId, PrintingFacts>> =>
  facts.get(snapshotId, 'all', () => printingFactsForAll(pool))

/** Drop everything held. For tests, and for anything that rewrites the corpus. */
export const clearCorpusCache = (): void => {
  combos.clear()
  eligible.clear()
  facts.clear()
}
