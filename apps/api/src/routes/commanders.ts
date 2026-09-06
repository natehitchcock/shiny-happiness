import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { commandersBySemantics, getCards, liveSnapshotId } from '@roundtable/db'
import type { OracleId, SynergyTag } from '@roundtable/domain'
import {
  SYNERGY_TAGS,
  qualifyingSemantics,
  quickdraw,
  rankBySemanticMatches,
} from '@roundtable/domain'
import {
  cachedCommanderDrawPools,
  cachedPrintingFacts,
  cachedSemanticCensus,
} from '../corpus-cache.js'
import { badRequest, sendProblem } from '../errors.js'
import { imagesFor } from './cards.js'
import { commanderSemanticsQuery, quickdrawQuery } from '../schemas.js'

/**
 * Two more ways into a deck (ADR-0067, doc 10 §10.6).
 *
 * The start screen had one door — a search box that answers a name you already
 * know — and these are the other two. Route 1 asks what the deck is ABOUT and
 * shows the commanders that carry it; Route 2 deals three commanders and lets
 * one of them be a stranger.
 *
 * ## Nothing in this file is random
 *
 * `ORDER BY random()` is the obvious way to write the quickdraw endpoint and is
 * not written here, because an endpoint whose answer nobody can predict is an
 * endpoint no contract test can assert. The alternative usually reached for is
 * to mock the generator, which tests everything except the sampling — the one
 * part that is new.
 *
 * So the entropy lives in exactly one place, and it is not on this side of the
 * wire: the client calls `crypto.randomUUID()` when the builder clicks, sends it
 * as `seed`, and every layer below that — this route, the sampler in
 * `packages/domain`, the SQL — is a deterministic function of that string.
 * `seed` is REQUIRED rather than optional-with-a-fallback, which is the whole
 * point: an optional seed would leave two code paths of which only one is ever
 * tested, and the untested one is the one that ships.
 *
 * Route 1 does not sample at all here. There are 48 qualifying tags in the live
 * corpus and the whole census is about fifteen kilobytes, so the endpoint serves
 * all of them in a stable order and the CLIENT draws its eight with the same
 * pure sampler. Sampling server-side would have meant a seed on that endpoint
 * too, for no benefit: the pool is small enough to send.
 */

const TAG_SET: ReadonlySet<string> = new Set<string>(SYNERGY_TAGS)

/** `?tags=landfall,subtype:elf`. A tag never contains a comma. */
const parseTags = (raw: string): readonly SynergyTag[] | null => {
  const wanted = raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '')
  if (wanted.length === 0) return null
  // Rejected, not filtered. A tag this build does not know is a client and a
  // server that disagree about the vocabulary, and quietly dropping it would
  // answer a narrower question than the one asked while looking like a success
  // — the same silent-wrong-answer failure `/cards/search` refuses.
  if (wanted.some((t) => !TAG_SET.has(t))) return null
  return [...new Set(wanted)] as SynergyTag[]
}

export const registerCommanderRoutes = (app: FastifyInstance, pool: Pool): void => {
  /**
   * Every semantic worth offering, and how many cards stand behind each.
   *
   * The whole qualifying set, not a sample. The counts ride along because the
   * screen can then say what a tag is worth without a second call, and because
   * a client that disagreed with the thresholds could apply its own — the
   * numbers are the evidence, not a secret.
   */
  app.get('/api/v1/commanders/semantics', async (_req, rep) => {
    const snapshotId = await liveSnapshotId(pool)
    const offers = qualifyingSemantics(await cachedSemanticCensus(pool, snapshotId))
    return rep.send({ offers, datasetSnapshotId: snapshotId })
  })

  /**
   * The commanders that carry the picked semantics, best match first.
   *
   * `matches` rides BESIDE the cards rather than on them, the way `prices` and
   * `images` do (doc 10 §10.2), and for the same reason: "how many of YOUR
   * picks this matched" is a fact about this request, not about the card. A
   * `Card` with a `matched` field on it would be a different `Card` depending on
   * who asked.
   */
  app.get(
    '/api/v1/commanders/by-semantics',
    { schema: { querystring: commanderSemanticsQuery } },
    async (req, rep) => {
      const { tags: raw, limit = 60 } = req.query as { tags?: string; limit?: number }
      const tags = parseTags(raw ?? '')
      if (tags === null) {
        return sendProblem(
          rep,
          badRequest('`tags` must be one or more known semantic tags, comma separated'),
        )
      }

      const snapshotId = await liveSnapshotId(pool)
      const [{ items, total }, facts] = await Promise.all([
        commandersBySemantics(pool, tags, { limit }),
        cachedPrintingFacts(pool, snapshotId),
      ])

      /*
       * Ranked HERE and not in SQL. The repository narrows to the commanders
       * that carry at least one pick and cuts the page on the same measure; the
       * rule that decides two-of-two leads one-of-two is the domain's, so there
       * is one implementation of it and it is the one under unit test.
       *
       * The filter inside `rankBySemanticMatches` is not redundant with the
       * overlap in SQL. It is what guarantees the 307 commanders carrying no
       * `produces`/`wants` semantic at all can never appear here even if the
       * query were later loosened.
       */
      const ranked = rankBySemanticMatches(items, tags)
      const ids = ranked.map((r) => r.card.oracleId)
      const matches: Record<string, number> = {}
      for (const r of ranked) matches[r.card.oracleId] = r.matched

      return rep.send({
        items: ranked.map((r) => r.card),
        matches,
        total,
        images: imagesFor(ids, facts),
        datasetSnapshotId: snapshotId,
      })
    },
  )

  /**
   * Three commanders: two a Commander player can probably place, one from
   * anywhere.
   *
   * The wildcard is named by id rather than by position, so a client is not
   * required to know that it is the last one. It is the last one, and it is
   * marked as such on screen — but a contract that says "the third" would break
   * the moment anybody wanted to shuffle the hand.
   *
   * `wildcard` may be null (a corpus too small to deal a third distinct card),
   * and `items` is then two long. Never three familiar cards with one of them
   * relabelled: the label is a claim about where the card came from.
   */
  app.get(
    '/api/v1/commanders/quickdraw',
    { schema: { querystring: quickdrawQuery } },
    async (req, rep) => {
      const { seed } = req.query as { seed: string }

      const snapshotId = await liveSnapshotId(pool)
      const pools = await cachedCommanderDrawPools(pool, snapshotId)
      const hand = quickdraw(pools, seed)

      const ids: OracleId[] = [...hand.familiar, ...(hand.wildcard === null ? [] : [hand.wildcard])]
      const [cards, facts] = await Promise.all([
        getCards(pool, ids),
        cachedPrintingFacts(pool, snapshotId),
      ])

      /*
       * `getCards` returns whatever the table had, in whatever order it had it.
       * The hand's ORDER is the contract — familiar first, wildcard last — so it
       * is reimposed here rather than hoped for.
       */
      const byId = new Map(cards.map((c) => [c.oracleId, c]))
      const items = ids.flatMap((id) => {
        const card = byId.get(id)
        return card === undefined ? [] : [card]
      })

      return rep.send({
        items,
        wildcard: hand.wildcard,
        seed,
        images: imagesFor(ids, facts),
        datasetSnapshotId: snapshotId,
      })
    },
  )
}
