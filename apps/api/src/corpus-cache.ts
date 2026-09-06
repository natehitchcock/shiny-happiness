import type { Pool } from 'pg'
import {
  combosInIdentity,
  commanderDrawPools,
  findEligibleCards,
  gameChangerOracleIds,
  printingFactsForAll,
  semanticCensus,
  type CommanderDrawPools,
} from '@roundtable/db'
import type { PrintingFacts } from '@roundtable/db'
import type { Card, Color, Combo, OracleId, SemanticCensusEntry } from '@roundtable/domain'
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
 *
 * ## The fourth one is here for a different reason
 *
 * `cachedGameChangerOracleIds` moves a few kilobytes and would never have
 * earned a place on the list above. It is cached because ADR-0063 measured this
 * path and found the cost was not bytes at all: `recommend()` — the actual
 * scoring — was 9-16 ms of a 381 ms request, and every other line in that table
 * was a multiple of the ~36 ms a single round trip costs. Once the other three
 * reads in `loadDeckContext`'s `Promise.all` are served from memory, an
 * uncached fourth is the whole wall-clock cost of that wave. Size is what
 * selected the first three; it is not what selects this one.
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
/**
 * Not scoped by anything either — Wizards publish one list, so one entry.
 *
 * The same reasoning as `facts` and for the same reason: the query is
 * `SELECT oracle_id FROM cards WHERE game_changer` with no parameter to vary.
 * Nothing about a deck — not its identity, not its Universes Beyond setting —
 * can select a different answer, so a second slot could only ever hold a
 * duplicate of the first.
 */
const gameChangers = createSnapshotCache<readonly OracleId[]>(1)

/**
 * The two start-screen reads (ADR-0067). One entry each, for `facts`' reason:
 * neither query takes a parameter that anything on that screen can vary.
 *
 * These are here for a THIRD reason, which is neither ADR-0017's bytes nor
 * ADR-0064's round trips. `semanticCensus` is a full pass over 31,782 rows
 * unnested into ~108,000 (tag, card) pairs and re-aggregated — the most
 * expensive single read in this file by CPU, and by some way the cheapest by
 * payload, at about fifteen kilobytes for the whole vocabulary. It is also the
 * FIRST thing the application does for a visitor who has not chosen a commander,
 * which is the worst possible moment to spend a hundred milliseconds. Cached, it
 * is paid once per ingest.
 *
 * `commanderDrawPools` is 3,411 uuids, and is cached because a reroll is a
 * button somebody clicks repeatedly and idly. The pools do not change between
 * clicks; only the seed does.
 */
const census = createSnapshotCache<readonly SemanticCensusEntry[]>(1)
const drawPools = createSnapshotCache<CommanderDrawPools>(1)

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

/**
 * Wizards' Game Changers list, as oracle ids (DATA-05).
 *
 * The whole list is dozens of uuids behind a partial index — cheap to read and
 * cheaper to hold. What it is not is free to ASK for, which is the point: it
 * shares `loadDeckContext`'s `Promise.all` with the three above, so uncached it
 * set the floor for that whole wave (ADR-0064).
 *
 * Returned `readonly`, unlike the `OracleId[]` the repository hands back. The
 * array is now shared between requests, and `snapshot-cache` only holds what
 * callers treat as frozen.
 */
export const cachedGameChangerOracleIds = async (
  pool: Pool,
  snapshotId: string | null,
): Promise<readonly OracleId[]> =>
  gameChangers.get(snapshotId, 'all', () => gameChangerOracleIds(pool))

/** How many cards stand behind every semantic tag (ADR-0067). */
export const cachedSemanticCensus = async (
  pool: Pool,
  snapshotId: string | null,
): Promise<readonly SemanticCensusEntry[]> =>
  census.get(snapshotId, 'all', () => semanticCensus(pool))

/** The commander id pools a quickdraw hand is dealt from (ADR-0067). */
export const cachedCommanderDrawPools = async (
  pool: Pool,
  snapshotId: string | null,
): Promise<CommanderDrawPools> =>
  drawPools.get(snapshotId, 'all', () => commanderDrawPools(pool))

/** Drop everything held. For tests, and for anything that rewrites the corpus. */
export const clearCorpusCache = (): void => {
  combos.clear()
  eligible.clear()
  facts.clear()
  gameChangers.clear()
  census.clear()
  drawPools.clear()
}
