import type { Pool } from 'pg'
import { combosInIdentity } from '@roundtable/db'
import type { Color, Combo } from '@roundtable/domain'

/**
 * The deck's combo set, held across requests on a warm instance.
 *
 * Every recommendation and every analysis request needs the combos castable in
 * the deck's colours, and that set changes only when the ingest runs. Fetching
 * it per request moved 79.7 MB against the real corpus — which is not merely
 * slow: on a metered managed database it exhausted a 5 GB monthly transfer
 * allowance in about sixty requests and took the deployment down.
 *
 * Trimming the columns and scoping to colour identity (`combosInIdentity`,
 * ADR-0017) takes mono-red to 0.5 MB, but a WUBRG commander is legal for every
 * combo in the corpus, so for those the filter returns the whole table and only
 * a cache helps.
 *
 * ## Why colour identity is the session key
 *
 * The obvious key for "do not re-read for one user doing lots of operations" is
 * the session or the deck. Colour identity is strictly better and it is not
 * close:
 *
 *   - A deck's identity is fixed by its commanders, so it cannot change for the
 *     length of a session. Keying on the deck would give the same hit rate.
 *   - Two people building different mono-red decks share an entry, where a
 *     per-deck key would hold two identical copies of the same 0.5 MB.
 *   - There are 32 possible identities and no bound at all on decks or
 *     sessions, so this key cannot be made to grow without limit by traffic.
 *
 * A session key would be a worse cache that also had to be invalidated when a
 * session ended, which nothing here would ever observe.
 *
 * ## Bounds
 *
 * `MAX_ENTRIES` sets how many identities are held at once, evicting the least
 * recently used. Four, because the worst case is what matters: five colours is
 * 19.6 MB, so four entries is ~78 MB held, which is comfortable in a serverless
 * function and small next to what the per-request read was moving. A cache that
 * grew with the decks an instance happened to see would multiply its worst case
 * by traffic, and a function whose memory tracks its popularity fails in a way
 * that is very hard to see coming.
 *
 * ## Freshness
 *
 * The SNAPSHOT ID is the key, not a clock. It changes when the ingest writes,
 * which is exactly when this data changes, so there is no interval to tune and
 * no window in which stale combos are served. A time-based expiry would be both
 * too eager (nothing changed) and too slow (an ingest lands and the old set is
 * still served) at the same time. A new snapshot drops every entry, because
 * every one of them describes the old corpus.
 */

/** How many colour identities to hold. See the note on bounds above. */
const MAX_ENTRIES = 4

/** Insertion-ordered, so the first key is the least recently used. */
const held = new Map<string, readonly Combo[]>()
let heldSnapshot: string | null = null

/** Colour identity as a stable string, so `{R,W}` and `{W,R}` are one key. */
const identityKey = (identity: readonly Color[]): string =>
  [...identity].sort().join('') || 'colorless'

export const cachedCombosInIdentity = async (
  pool: Pool,
  identity: readonly Color[],
  snapshotId: string | null,
): Promise<readonly Combo[]> => {
  /*
   * With no snapshot the corpus has never been ingested, or the row is missing.
   * Caching against a null key would be caching "we do not know when this
   * changes". It is also the empty-database case, where the read costs nothing.
   */
  if (snapshotId === null) return combosInIdentity(pool, identity)

  if (snapshotId !== heldSnapshot) {
    held.clear()
    heldSnapshot = snapshotId
  }

  const key = identityKey(identity)
  const hit = held.get(key)
  if (hit !== undefined) {
    // Re-insert to move it to the back: a Map iterates in insertion order, so
    // deleting and setting is how "most recently used" is expressed.
    held.delete(key)
    held.set(key, hit)
    return hit
  }

  const combos = await combosInIdentity(pool, identity)
  held.set(key, combos)
  while (held.size > MAX_ENTRIES) {
    const oldest = held.keys().next()
    if (oldest.done === true) break
    held.delete(oldest.value)
  }
  return combos
}

/** Drop everything held. For tests, and for anything that rewrites the corpus. */
export const clearComboCache = (): void => {
  held.clear()
  heldSnapshot = null
}
