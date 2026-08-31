/**
 * A small LRU held across requests on a warm instance, invalidated by the
 * dataset snapshot.
 *
 * Three reads dominate this API's data transfer, and all three share a shape:
 * they are reference data derived from the corpus, they are identical for every
 * request with the same key, and they change exactly when the ingest runs. That
 * last property is what makes caching them safe without inventing a policy —
 * the snapshot id IS the version, so there is no interval to tune and no window
 * in which stale data is served.
 *
 * Written once and used three times rather than copied, because the subtle
 * parts — LRU promotion on hit, dropping every entry when the snapshot moves,
 * and refusing to cache at all when there is no snapshot — are exactly the
 * parts that rot when duplicated.
 *
 * ## Bounded on purpose
 *
 * `maxEntries` is small and each caller picks its own. Memory that tracks an
 * instance's popularity fails in a way that is very hard to see coming: the
 * function works in testing, works under light traffic, and is OOM-killed at
 * the moment it becomes useful. A bounded cache with a modest hit rate is a
 * better failure mode than an unbounded one with a perfect hit rate.
 *
 * ## Not for anything a caller may mutate
 *
 * Entries are handed out by reference and shared between requests, so what goes
 * in here must be treated as frozen. Everything cached today is either a
 * `readonly` array or a `ReadonlyMap` at the type level, which is what makes
 * that safe rather than merely intended.
 */

export interface SnapshotCache<T> {
  /**
   * The value for `key` at `snapshotId`, loading it if it is not held.
   *
   * A null `snapshotId` means the corpus has never been ingested, or the row is
   * missing. That path always loads: caching against a null key would be
   * caching "we do not know when this changes". It is also the empty-database
   * case, where the load costs nothing.
   */
  readonly get: (snapshotId: string | null, key: string, load: () => Promise<T>) => Promise<T>
  /** Drop everything held. For tests, and for anything that rewrites the corpus. */
  readonly clear: () => void
}

export const createSnapshotCache = <T>(maxEntries: number): SnapshotCache<T> => {
  /** Insertion-ordered, so the first key is the least recently used. */
  const held = new Map<string, T>()
  let heldSnapshot: string | null = null

  return {
    get: async (snapshotId, key, load) => {
      if (snapshotId === null) return load()

      if (snapshotId !== heldSnapshot) {
        // Every entry describes the old corpus, so every one of them is stale —
        // not only the key being asked for.
        held.clear()
        heldSnapshot = snapshotId
      }

      const hit = held.get(key)
      if (hit !== undefined) {
        // Re-insert to move it to the back: a Map iterates in insertion order,
        // so deleting and setting is how "most recently used" is expressed.
        held.delete(key)
        held.set(key, hit)
        return hit
      }

      const value = await load()
      held.set(key, value)
      while (held.size > maxEntries) {
        const oldest = held.keys().next()
        if (oldest.done === true) break
        held.delete(oldest.value)
      }
      return value
    },
    clear: () => {
      held.clear()
      heldSnapshot = null
    },
  }
}

/**
 * Colour identity as a stable key, so `{R,W}` and `{W,R}` are one entry.
 *
 * Identity is the right key for anything scoped to what a deck may play. It is
 * fixed by the commanders, so it cannot change for the length of a session;
 * two people building different mono-red decks share an entry where a per-deck
 * key would hold two identical copies; and there are 32 possible identities
 * against no bound at all on decks or sessions, so it cannot be made to grow by
 * traffic.
 */
export const identityKey = (identity: readonly string[]): string =>
  [...identity].sort().join('') || 'colorless'
