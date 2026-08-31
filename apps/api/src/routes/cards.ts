import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import {
  combosContaining,
  getCard,
  getCards,
  listCardsAfter,
  liveSnapshotId,
  printingsFor,
  searchCardsByName,
  type PrintingFacts,
} from '@roundtable/db'
import { cachedPrintingFacts } from '../corpus-cache.js'
import type {
  AnnotatedCandidate,
  Card,
  Color,
  OracleId,
  QueryField,
  QueryNode,
} from '@roundtable/domain'
import { COLORS, isOk, matchesQuery, oracleId, parseQuery } from '@roundtable/domain'
import { badRequest, notFound, sendProblem } from '../errors.js'
import { cardBatchBody, cardSearchQuery, oracleIdParams } from '../schemas.js'

/**
 * Fields `/cards/search` cannot answer, and why.
 *
 * `combo`, `near`, `flag` and `group` are computed against a deck's accepted set
 * (doc 05 §5.8) and are meaningless without one — they belong to the candidate
 * endpoint in API-02. `power` and `toughness` are not stored on the oracle row.
 *
 * `price`, `rarity`, `set` and `is:reserved` used to be here too. ADR-0011's
 * printings ingest gave them real data, so they are answered now rather than
 * rejected.
 *
 * Rejecting is deliberate. Accepting them and evaluating against absent data
 * would return an empty page that looks like "no cards match" rather than "this
 * endpoint cannot answer that", which is the silent-wrong-answer failure the
 * whole codebase is written to avoid.
 */
const UNSUPPORTED_FIELDS: ReadonlyMap<QueryField, string> = new Map([
  ['combo', 'needs a deck; use the candidates endpoint'],
  ['near', 'needs a deck; use the candidates endpoint'],
  ['flag', 'needs a deck; use the candidates endpoint'],
  ['group', 'needs a deck; use the candidates endpoint'],
  ['power', 'not stored on the oracle row'],
  ['toughness', 'not stored on the oracle row'],
])

/**
 * `is:` predicates this endpoint cannot decide.
 *
 * These are values, not fields, so the field guard above never sees them: `is`
 * is a supported field, and `evaluateIs` reads them from `AnnotatedCandidate`
 * members that `asCandidate` has no data for.
 *
 * `is:gamechanger` used to be listed here, and was the dangerous one, because
 * `-is:gamechanger` returned every Game Changer as though it were clean. It is
 * answerable now: DATA-05 put the flag on the card row, so `asCandidate` has
 * real data and the negation is honest.
 */
const UNSUPPORTED_IS: ReadonlyMap<string, string> = new Map([
  ['reprint', 'printing-level, not decidable from oracle identity'],
  ['firstprint', 'printing-level, not decidable from oracle identity'],
])

/** Every `is:` value in the tree, lowercased. */
const isPredicatesUsed = (node: QueryNode | null, into: Set<string> = new Set()): Set<string> => {
  if (node === null) return into
  switch (node.kind) {
    case 'term':
      if (node.field === 'is') into.add(node.value.toLowerCase())
      return into
    case 'not':
      return isPredicatesUsed(node.child, into)
    case 'and':
    case 'or':
      for (const child of node.children) isPredicatesUsed(child, into)
      return into
  }
}

const fieldsUsed = (node: QueryNode | null, into: Set<QueryField> = new Set()): Set<QueryField> => {
  if (node === null) return into
  switch (node.kind) {
    case 'term':
      into.add(node.field)
      return into
    case 'not':
      return fieldsUsed(node.child, into)
    case 'and':
    case 'or':
      for (const child of node.children) fieldsUsed(child, into)
      return into
  }
}

/**
 * A card lifted to the shape the domain predicate expects.
 *
 * The deck-relative fields are zeroed, which is safe only because a query
 * mentioning any of them is rejected before it gets here. Printing facts are
 * real (ADR-0011), so `price:`, `rarity:`, `set:` and `is:reserved` answer.
 */
const asCandidate = (card: Card, facts: PrintingFacts | undefined): AnnotatedCandidate => ({
  card,
  comboDegree: 0,
  nearCombosAt1: 0,
  roles: card.roles,
  // Only the Game Changers flag is derivable from one card: the other
  // `BracketFlag` values are deck-relative (mass land denial and two-card
  // infinites are properties of what the deck assembles, not of a card sitting
  // alone in the corpus). Before DATA-05 this was `[]`, which made
  // `is:gamechanger` answer false for every card in the corpus.
  bracketFlags: card.gameChanger ? ['game-changer'] : [],
  priceUsd: facts?.priceUsd ?? null,
  rarity: facts?.rarity ?? null,
  setCode: facts?.setCode ?? null,
  power: null,
  toughness: null,
  reserved: facts?.reserved ?? false,
  group: null,
})

/**
 * Where a card's art lives on the wire.
 *
 * Beside the cards, never on them — the same arrangement `prices` already uses
 * and for the same reason: an image URL belongs to a printing, and the domain
 * `Card` is oracle identity (doc 02 §2.1). Putting `imageUris` on `Card` would
 * make every consumer of the domain type carry a field that only the browser
 * has any use for, and would need an ADR to change the contract; a second map
 * needs neither.
 *
 * The URLs are Scryfall's own CDN, sent through unaltered. ADR-0021 records why
 * that diverges from doc 04 §4.1's "no client request ever hits a third-party
 * image host", and why `ING-04` is still the gated project it always was.
 */
interface ImageUris {
  readonly artCrop: string | null
  readonly normal: string | null
}

/**
 * Absence stated, not implied.
 *
 * Every id the caller asked about gets an entry, exactly as `prices` does. A
 * missing key and a card with no art would otherwise be the same thing on the
 * wire, and they are not: a client that cannot tell "there is none" from "not
 * loaded yet" will show a spinner forever. The art-less case was 501 cards
 * until the double-faced art fix in `packages/clients` (a mapping defect, not
 * a gap in Scryfall's pictures); the distinction it forced is still the
 * contract, because an unresolved printing is a real state.
 */
const NO_IMAGES: ImageUris = { artCrop: null, normal: null }

const imagesFor = (
  ids: readonly OracleId[],
  facts: ReadonlyMap<OracleId, PrintingFacts>,
): Record<string, ImageUris> => {
  const images: Record<string, ImageUris> = {}
  for (const id of ids) images[id] = facts.get(id)?.imageUris ?? NO_IMAGES
  return images
}

interface Cursor {
  readonly name: string
  readonly oracleId: string
}

const encodeCursor = (card: Card): string =>
  Buffer.from(JSON.stringify({ name: card.name, oracleId: card.oracleId })).toString('base64url')

const decodeCursor = (raw: string): Cursor | null => {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Cursor).name === 'string' &&
      typeof (parsed as Cursor).oracleId === 'string'
    ) {
      return parsed as Cursor
    }
    return null
  } catch {
    return null
  }
}

/**
 * `undefined` = no filter; `null` = supplied but meaningless.
 *
 * The distinction matters: an empty colour list is a VALID filter meaning
 * "colourless only", so silently reducing a typo like `?colors=Z` to `[]`
 * returns a plausible page of colourless cards instead of reporting the typo.
 */
const parseColors = (raw: string | undefined): readonly Color[] | undefined | null => {
  if (raw === undefined || raw === '') return undefined
  const wanted = raw.toUpperCase().split('')
  const colors = wanted.filter((c): c is Color => (COLORS as readonly string[]).includes(c))
  return colors.length === wanted.length ? colors : null
}

export const registerCardRoutes = (app: FastifyInstance, pool: Pool): void => {
  app.get(
    '/api/v1/cards/search',
    { schema: { querystring: cardSearchQuery } },
    async (req, rep) => {
      const {
        q,
        colors,
        limit = 50,
        cursor,
        excludeUniversesBeyond = false,
      } = req.query as {
        q?: string
        colors?: string
        limit?: number
        cursor?: string
        excludeUniversesBeyond?: boolean
      }

      // A query with errors is NOT applied at all (doc 10 §10.4). Half a filter is
      // a wrong answer that looks right.
      const parsed = parseQuery(q ?? '')
      const parseErrors = isOk(parsed) ? parsed.value.errors : parsed.error
      if (parseErrors.length > 0) {
        const first = parseErrors[0]!
        return sendProblem(
          rep,
          badRequest(first.message, {
            position: first.position,
            length: first.length,
            suggestion: first.suggestion,
          }),
        )
      }
      const ast = isOk(parsed) ? parsed.value.ast : null

      for (const field of fieldsUsed(ast)) {
        const why = UNSUPPORTED_FIELDS.get(field)
        if (why !== undefined) {
          return sendProblem(
            rep,
            badRequest(`\`${field}\` is not supported here: ${why}`, { field }),
          )
        }
      }

      for (const predicate of isPredicatesUsed(ast)) {
        const why = UNSUPPORTED_IS.get(predicate)
        if (why !== undefined) {
          return sendProblem(
            rep,
            badRequest(`\`is:${predicate}\` is not supported here: ${why}`, {
              field: 'is',
              predicate,
            }),
          )
        }
      }

      let after = cursor === undefined ? null : decodeCursor(cursor)
      if (cursor !== undefined && after === null) {
        return sendProblem(rep, badRequest('cursor is not a cursor this endpoint issued'))
      }

      const facts = await cachedPrintingFacts(pool, await liveSnapshotId(pool))
      const colorIdentity = parseColors(colors)
      if (colorIdentity === null) {
        return sendProblem(rep, badRequest('colors must be a string of WUBRG letters', { colors }))
      }

      const items: Card[] = []
      let exhausted = false

      // Page through the table until the query has produced enough matches. SQL
      // narrows on the indexed columns; the domain predicate decides, so `web` and
      // `api` cannot disagree about what a query means (AGENTS.md R1).
      while (items.length <= limit && !exhausted) {
        const batch = await listCardsAfter(pool, {
          ...(after !== null
            ? { afterName: after.name, afterOracleId: oracleId(after.oracleId) }
            : {}),
          ...(colorIdentity !== undefined ? { colorIdentity } : {}),
          excludeUniversesBeyond,
          limit: 500,
        })
        if (batch.length === 0) {
          exhausted = true
          break
        }
        for (const card of batch) {
          if (matchesQuery(ast, asCandidate(card, facts.get(card.oracleId)))) items.push(card)
        }
        const last = batch[batch.length - 1]!
        after = { name: last.name, oracleId: last.oracleId }
        if (batch.length < 500) exhausted = true
      }

      /*
       * Nothing matched, and the query was just a name — try for a near miss.
       *
       * `searchCardsByName` falls back to trigram similarity, which finds
       * "Ashnod's Altar" from "Ashnods" where no LIKE or query predicate can:
       * the wrong character is in the middle of the word.
       *
       * Only for a bare name query, and only when the strict answer was empty.
       * A query with fields in it — `t:creature mv<=3` — means something exact,
       * and quietly widening THAT would be the silent-wrong-answer failure this
       * endpoint refuses everywhere else. `nameFallback` says on the way out
       * that this happened, so a caller can tell a match from a suggestion.
       */
      const bareName = ast !== null && ast.kind === 'term' && ast.field === 'name' && ast.op === ':'
      if (items.length === 0 && bareName && cursor === undefined) {
        const near = (await searchCardsByName(pool, String(ast.value), limit * 4))
          /*
           * The near miss widens the NAME and nothing else.
           *
           * `searchCardsByName` knows only about names, so the caller's other
           * constraints have to be re-applied here — an existing test caught
           * this by asking for a search with Universes Beyond excluded and
           * getting a Universes Beyond card back through the fallback. Widening
           * one axis must not quietly widen the rest.
           */
          .filter((c) => !(excludeUniversesBeyond && c.universesBeyond))
          .filter(
            (c) =>
              colorIdentity === undefined ||
              c.colorIdentity.every((color) => colorIdentity.includes(color)),
          )
          .slice(0, limit)
        if (near.length > 0) {
          return {
            items: near,
            images: imagesFor(
              near.map((c) => c.oracleId),
              facts,
            ),
            nextCursor: null,
            nameFallback: true,
          }
        }
      }

      // One more than asked for tells us whether another page exists without a
      // second count query.
      const page = items.slice(0, limit)
      const more = items.length > limit || !exhausted
      const lastOfPage = page[page.length - 1]
      return {
        items: page,
        // Art for the page only, not for everything the scan touched. The facts
        // map is already in hand, so this costs a lookup per returned card.
        images: imagesFor(
          page.map((c) => c.oracleId),
          facts,
        ),
        nextCursor: more && lastOfPage !== undefined ? encodeCursor(lastOfPage) : null,
      }
    },
  )

  app.post('/api/v1/cards/batch', { schema: { body: cardBatchBody } }, async (req) => {
    const { oracleIds } = req.body as { oracleIds: string[] }
    const ids = oracleIds.map(oracleId)
    // `/cards/batch` is how the client hydrates names after EVERY recompute, so
    // the uncached facts map ran at least twice per user action for 1.9 MB a
    // time. The snapshot read is one small row and is what makes it cacheable.
    const snapshotId = await liveSnapshotId(pool)
    const [items, facts] = await Promise.all([
      getCards(pool, ids),
      cachedPrintingFacts(pool, snapshotId),
    ])

    // Prices ride ALONGSIDE the cards rather than on them. `Card` is oracle
    // identity and deliberately carries no price (doc 02) — a price belongs to a
    // printing and goes stale in a day (ADR-0009 Q7).
    const prices: Record<string, number | null> = {}
    for (const id of ids) prices[id] = facts.get(id)?.priceUsd ?? null

    // Art rides the same way, for the same reason (see `ImageUris`). This is the
    // route that puts card imagery on screen at all: the client hydrates every
    // card it draws through here, so art arriving with the hydration means no
    // second round trip and no second cache to keep in step.
    return { items, prices, images: imagesFor(ids, facts) }
  })

  app.get('/api/v1/cards/:oracleId', { schema: { params: oracleIdParams } }, async (req, rep) => {
    const id = oracleId((req.params as { oracleId: string }).oracleId)
    const card = await getCard(pool, id)
    if (card === null) return sendProblem(rep, notFound(`No card with oracle id ${id}`))

    const [printings, combos] = await Promise.all([
      printingsFor(pool, id),
      combosContaining(pool, [id]),
    ])

    /*
     * Combo pieces carry their names, not just their ids.
     *
     * The client cross-references pieces against the deck to show what a card
     * combos WITH, and the interesting case is the piece that is NOT in the
     * deck yet — which is therefore not in the client's hydrated card map and
     * has no name there. Without this the preview would have to fetch again to
     * render the one thing it is trying to say.
     */
    const pieceIds = [...new Set(combos.flatMap((c) => c.pieces))]
    const names = new Map((await getCards(pool, pieceIds)).map((c) => [c.oracleId, c.name]))
    const withNames = combos.map((combo) => ({
      ...combo,
      pieces: combo.pieces.map((oracle) => ({ oracleId: oracle, name: names.get(oracle) ?? null })),
    }))

    return { ...card, printings, combos: withNames }
  })
}
