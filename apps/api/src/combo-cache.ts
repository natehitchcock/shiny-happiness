import type { Pool } from 'pg'
import { combosInIdentity } from '@roundtable/db'
import type { Color, Combo } from '@roundtable/domain'

/**
 * The deck's combo set, held across requests on a warm instance.
 *
 * Every recommendation and every analysis request needs the combos castable in
 * the deck's colours, and that set changes only when the ingest runs. Fetching
 * it per request moved 72 MB against the real corpus for a five-colour deck —
 * which is not merely slow: on a metered managed database it exhausted a 5 GB
 * monthly transfer quota in about sixty requests and took the deployment down.
 *
 * Scoping to colour identity (`combosInIdentity`) fixes the narrow decks —
 * mono-red drops to 2.1 MB — but a WUBRG commander is legal for every combo in
 * the corpus, so for those the filter returns the whole table and only a cache
 * helps.
 *
 * ONE entry, deliberately. A warm instance overwhelmingly serves one deck being
 * worked on, so a single slot hits on nearly every request while bounding what
 * this holds to a single combo set. A cache of many identities would multiply
 * the worst case by the number of decks that happened to touch the instance,
 * and a serverless function that grows its memory with traffic fails in a way
 * that is very hard to see coming.
 *
 * The SNAPSHOT ID is the freshness key, not a clock. It changes when the ingest
 * writes, which is exactly when this data changes, so there is no interval to
 * tune and no window in which stale combos are served. A time-based expiry
 * would be both too eager (nothing changed) and too slow (an ingest lands and
 * the old set is still served) at once.
 */

interface Entry {
  readonly snapshotId: string
  readonly key: string
  readonly combos: readonly Combo[]
}

let entry: Entry | null = null

/** Colour identity as a stable string, so `{R,W}` and `{W,R}` are one key. */
const identityKey = (identity: readonly Color[]): string => [...identity].sort().join('')

export const cachedCombosInIdentity = async (
  pool: Pool,
  identity: readonly Color[],
  snapshotId: string | null,
): Promise<readonly Combo[]> => {
  const key = identityKey(identity)

  /*
   * With no snapshot the corpus has never been ingested, or the row is missing.
   * Caching against a null key would mean caching "we do not know when this
   * changes", so this path always re-reads. It is also the empty-database case,
   * where the read costs nothing.
   */
  if (snapshotId === null) return combosInIdentity(pool, identity)

  if (entry !== null && entry.snapshotId === snapshotId && entry.key === key) return entry.combos

  const combos = await combosInIdentity(pool, identity)
  entry = { snapshotId, key, combos }
  return combos
}

/** Drop the held set. For tests, and for anything that rewrites the corpus. */
export const clearComboCache = (): void => {
  entry = null
}
