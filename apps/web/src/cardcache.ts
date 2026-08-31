/**
 * What the client already knows about a card, kept between recomputes.
 *
 * The app re-asks the server for the same cards constantly. Every accept, every
 * reject, every filter change and every auto-query tick runs the same pipeline,
 * and that pipeline ended with `setCards(hydrated.cards)` — a REPLACE. So a
 * user panning through a 99-card deck re-downloaded the whole deck's names,
 * type lines, oracle text, mana costs, synergy tags, art URLs and prices on
 * every single click, to be told the same thing each time.
 *
 * ## Why this is safe
 *
 * A `Card` is oracle identity (doc 02 §2.1) and everything hanging off it here
 * is derived from the corpus, so for a given corpus it is immutable. The corpus
 * has a version already on the wire — `Recommendations.datasetSnapshotId` — and
 * it changes exactly when the ingest writes. That makes the snapshot id the
 * whole invalidation policy: no interval to tune, no window in which stale text
 * is served, and no clock. `apps/api/src/snapshot-cache.ts` reaches the same
 * conclusion one layer down for the same reason; this is that argument applied
 * to the browser, not that code moved.
 *
 * It is deliberately NOT that code. The lifetimes have nothing in common: the
 * server's cache lives for the length of a warm serverless instance and is
 * shared by every user on it, this one lives for the length of a tab and is one
 * person's working set. Sharing an implementation across that seam would mean
 * one set of bounds tuned for neither.
 *
 * ## One entry, three fields — not three caches
 *
 * `apps/api/src/corpus-cache.ts` keeps a cache per concern because its three
 * reads have different keys, different sizes and different scopes. Here the
 * opposite holds: card, price and art arrive together from one `/cards/batch`
 * call, are asked for together, and expire together. Three independently
 * evicting maps would let a card survive while its art was dropped, and an
 * absent art entry is not a miss — the primitives read it as "this printing has
 * no art" and draw a text panel (doc 10 §10.2). Splitting them would invent a
 * way to render a wrong answer.
 *
 * ## Prices are cached with everything else, on purpose
 *
 * Prices are estimates that Scryfall calls "dangerously stale after 24 hours"
 * (ADR-0009 Q7) and the UI labels them "est.", so the instinct is to give them
 * a shorter lifetime. Three things say otherwise, and the first is decisive:
 *
 * 1. There is no request that fetches a price on its own. `/cards/batch`
 *    returns cards, prices and art in one body, so a shorter price lifetime
 *    would re-issue the exact request this cache exists to avoid, and re-fetch
 *    the immutable 90% to refresh the mutable 10%.
 * 2. The server already serves prices from a snapshot-keyed cache of its own —
 *    `/cards/batch` reads `cachedPrintingFacts(pool, snapshotId)`. Re-asking a
 *    warm instance under the same snapshot returns the byte-identical price. A
 *    "fresh" fetch would mostly be an illusion.
 * 3. The snapshot id IS the retrieval date the product already shows: the
 *    analysis route sends `prices.estimatedAt = snapshotId`. Holding a price
 *    for exactly as long as that label is unchanged is the same promise the
 *    screen is already making, so cached and uncached prices cannot disagree
 *    with what the user is being told.
 *
 * The rejected alternative was a second, short-TTL price map with a wall clock.
 * It would have added the one thing the snapshot key removes — a window in
 * which the app is knowingly wrong — in exchange for a freshness the wire
 * cannot actually deliver.
 *
 * ## Held by reference
 *
 * Entries are handed out by reference and shared between renders, so what goes
 * in here must be treated as frozen. Nothing in the app mutates an `api.Card`;
 * the maps are rebuilt rather than edited.
 */
import * as api from './api'

/**
 * One card's row data, as `/cards/batch` answers for it.
 *
 * `price` and `image` are optional for the same reason they are optional on the
 * wire: a server from before ADR-0021 sends no `images` map at all, and absent
 * has to stay absent so the caller sees what it would have seen uncached.
 */
interface Held {
  readonly card: api.Card
  readonly price?: number | null
  readonly image?: api.ImageUris
}

/**
 * Two thousand cards.
 *
 * The working set is small and knowable: a Commander deck is 100 cards, a
 * suggestion page is eight rows across nine headings, and an expanded group
 * adds 32. Even with everything expanded that is roughly 500 cards on screen at
 * once. Every id a caller asks for is promoted on the way past, so the whole
 * of the current page sits at the most-recent end and eviction can only ever
 * reach cards from an EARLIER filter — the tail, which is exactly what needs
 * bounding.
 *
 * 2,000 is four times that working set. Measured against the corpus, a card is
 * about 350 bytes on the wire (12.1 MB for 34,492 in `corpus-cache.ts`); call
 * it 1.5 KB once it is objects and arrays in a JS heap, so the ceiling here is
 * a few megabytes. That is affordable on a phone and it buys roughly 25
 * distinct filter pages before anything rolls off.
 *
 * Not unbounded, though the hit rate would be better: 34,492 cards exist and a
 * session that pages through filters has no natural stopping point. Unbounded
 * memory fails in the way that is hardest to see coming — fine in testing, fine
 * for a light session, and worst on the oldest phone belonging to the user who
 * likes the tool most.
 *
 * Not 500 either. A bound at the size of the working set thrashes precisely
 * when the user pans back and forth between two filters, which turns a cache
 * into a constant overhead. It would also break the promise above: promotion
 * only protects a page that FITS, and a page larger than the bound would evict
 * its own opening entries — the commanders — as it was being stored.
 */
const MAX_CARDS = 2_000

/**
 * A hundred and twenty-eight card details.
 *
 * Much smaller, because an entry is much bigger and the working set is one: the
 * preview shows a single card, and `getCardDetail` carries every printing of it
 * plus its combos. The point of caching it at all is that re-previewing the
 * same card is common — the user clicks along a row of suggestions and back —
 * and each of those was a fresh request for printings that cannot have changed.
 */
const MAX_DETAILS = 128

/** Insertion-ordered, so the first key is the least recently used. */
const cards = new Map<string, Held>()
/**
 * Promises, not details.
 *
 * A single mouse click on a suggestion opens the preview TWICE — the name
 * button calls `open` and the cell wrapping it calls `open` again as the event
 * bubbles (see the `name-cell` span in `App.tsx`), which is harmless for the
 * state it sets and was two identical `/cards/:oracleId` requests every time.
 * Caching the resolved value cannot help there, because neither call has
 * resolved when the other starts. Caching the promise collapses them into one
 * request, and does the same for a user double-clicking a row.
 */
const details = new Map<string, Promise<api.CardDetail>>()

/**
 * The snapshot every held entry describes.
 *
 * `undefined` means nothing has been held yet, which is NOT the same as `null`.
 * `null` is a real answer from the server — "the corpus has never been
 * ingested" — and the two must be distinguishable or the first load under a
 * null snapshot would look like a snapshot change.
 */
let heldSnapshot: string | null | undefined

/**
 * Drop everything if the corpus moved, and report whether anything may be
 * served.
 *
 * A null snapshot is not cacheable for the same reason it is not cacheable on
 * the server: caching against it would be caching "we do not know when this
 * changes". Entries are still dropped when it arrives, because going from a
 * real snapshot to none is a change like any other.
 */
const usable = (snapshotId: string | null): boolean => {
  if (snapshotId !== heldSnapshot) {
    // Every entry describes the old corpus, so every one is stale — not only
    // the ids being asked for. Card text after an ingest is the case that has
    // to be got right: showing yesterday's oracle text is worse than a refetch.
    cards.clear()
    details.clear()
    heldSnapshot = snapshotId
  }
  return snapshotId !== null
}

/** Re-insert to move a key to the back — a Map iterates in insertion order. */
const promote = <T>(held: Map<string, T>, key: string): void => {
  const hit = held.get(key)
  if (hit === undefined) return
  held.delete(key)
  held.set(key, hit)
}

const evict = <T>(held: Map<string, T>, max: number): void => {
  while (held.size > max) {
    const oldest = held.keys().next()
    if (oldest.done === true) break
    held.delete(oldest.value)
  }
}

/**
 * Hydrate `oracleIds`, asking the server only for the ones not already held.
 *
 * Returns everything the cache holds, not just what was asked for. That is what
 * makes the accumulation a property of one file instead of a rule every call
 * site has to remember: `App` can keep writing `setCards(hydrated.cards)` and
 * get accumulate-not-replace, and there is a single place where "drop it all"
 * happens when the snapshot moves. The rejected alternative — merging at each
 * call site — puts the snapshot rule in two places, and the site that forgets
 * it is the one that renders yesterday's oracle text.
 *
 * A fully-held page therefore issues no request at all: the miss list is empty
 * and `api.hydrate([])` already short-circuits without touching the network.
 */
export const hydrateCards = async (
  oracleIds: readonly string[],
  snapshotId: string | null,
): Promise<api.Hydrated> => {
  if (!usable(snapshotId)) return api.hydrate([...oracleIds])

  const missing = oracleIds.filter((id) => !cards.has(id))
  if (missing.length > 0) {
    const fetched = await api.hydrate([...new Set(missing)])
    /*
     * Only ids that came back as a CARD are stored.
     *
     * `prices` and `images` carry an entry for every id asked about (doc 10
     * §10.2), so an id the corpus does not know still gets two nulls — but
     * storing that as "the answer" would pin it. `api.hydrate` truncates at 500
     * ids, so a large page can legitimately come back short, and negative
     * caching would turn a truncated batch into a permanently blank row. Left
     * out, the id is simply asked for again next time, which is what happens
     * today.
     */
    for (const [id, card] of fetched.cards) {
      // `undefined` from either map means the server sent no entry for this id
      // at all, which is distinct from the `null` it sends for "no price" and
      // for "this printing has no art". Both distinctions have to survive the
      // round trip through the cache or a cached read would answer differently
      // from an uncached one.
      const price = fetched.prices.get(id)
      const image = fetched.images.get(id)
      cards.set(id, {
        card,
        ...(price === undefined ? {} : { price }),
        ...(image === undefined ? {} : { image }),
      })
    }
  }

  // Promote AFTER the fetch so hits and misses alike land at the recent end:
  // everything on this page is now protected from eviction by the next one.
  for (const id of oracleIds) promote(cards, id)
  evict(cards, MAX_CARDS)

  const out: api.Hydrated = { cards: new Map(), prices: new Map(), images: new Map() }
  for (const [id, held] of cards) {
    out.cards.set(id, held.card)
    if (held.price !== undefined) out.prices.set(id, held.price)
    if (held.image !== undefined) out.images.set(id, held.image)
  }
  return out
}

/**
 * The preview's per-card detail — printings and combos — held per snapshot.
 *
 * This is the one combo payload that IS a separate request. `Recommendation.combos`
 * and `Analysis.deckCombos` already ride inside responses the app fetches
 * anyway, so there is nothing extra to cache for those; but the preview asks
 * `/cards/:oracleId` afresh every time a card is opened, and that answer
 * carries the combos with their piece NAMES. Clicking along a row of
 * suggestions and back re-fetched each one.
 */
export const cardDetail = (
  oracleId: string,
  snapshotId: string | null,
): Promise<api.CardDetail> => {
  if (!usable(snapshotId)) return api.getCardDetail(oracleId)

  const hit = details.get(oracleId)
  if (hit !== undefined) {
    promote(details, oracleId)
    return hit
  }

  const pending = api.getCardDetail(oracleId).catch((error: unknown) => {
    // A failure is not an answer. Left in place it would make the card
    // un-previewable for the life of the tab on the strength of one blip —
    // and the preview is deliberately built to survive a failed detail fetch
    // (it opens from what is already hydrated), so a retry has to be possible.
    // Guarded on identity so a later fetch's entry is not deleted by an
    // earlier one's failure.
    if (details.get(oracleId) === pending) details.delete(oracleId)
    throw error
  })
  details.set(oracleId, pending)
  evict(details, MAX_DETAILS)
  return pending
}

/**
 * Drop everything held.
 *
 * For tests. Module state outlives a test file's `beforeEach`, and a cache that
 * leaks one test's cards into the next is a test suite that lies.
 */
export const clearCardCache = (): void => {
  cards.clear()
  details.clear()
  heldSnapshot = undefined
}
