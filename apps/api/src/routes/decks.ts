import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Pool, PoolClient } from 'pg'
import {
  allCardNames,
  applyBatch,
  createDeck,
  findBasicLands,
  getCards,
  getDeck,
  listDeckSummaries,
} from '@roundtable/db'
import type {
  ArchetypeKey,
  Bracket,
  Card,
  Deck,
  DeckCommand,
  DeckEntry,
  OracleId,
} from '@roundtable/domain'
import {
  applyCommands,
  buildNameIndex,
  deckColorIdentity,
  deckId,
  oracleId,
  parseDecklist,
  resolveDecklist,
} from '@roundtable/domain'
import { badRequest, notFound, sendProblem, unprocessable } from '../errors.js'
import {
  commandsBody,
  createDeckBody,
  deckIdParams,
  importPreviewBody,
  patchDeckBody,
} from '../schemas.js'

/**
 * A deck belongs to a DEVICE, not to a person (ADR-0014).
 *
 * The browser generates a uuid once, keeps it in localStorage and sends it as
 * `X-Device-Id`. There is no account, no password and nothing to sign in to,
 * which is the whole point: the fastest path to a usable tool is not asking
 * anyone to register.
 *
 * What it is not: security. Anyone who knows a device id can read that device's
 * decks. That is acceptable because a deck list is not a secret, and the id is
 * a random v4 uuid that never appears in a URL. It is NOT acceptable for
 * anything else, so nothing else should ever be scoped by it.
 *
 * A missing header falls back to the old fixed id rather than erroring, so the
 * decks built before this existed are still reachable.
 */
export const DEV_OWNER_ID = '00000000-0000-0000-0000-000000000001'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const ownerOf = (req: { headers: Record<string, unknown> }): string => {
  const header = req.headers['x-device-id']
  const value = Array.isArray(header) ? header[0] : header
  // Validated, not trusted: it goes straight into a uuid column, and an
  // unparseable one would be a 500 from the driver rather than a 400 from here.
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : DEV_OWNER_ID
}

const cardMap = async (pool: Pool, ids: readonly OracleId[]): Promise<Map<OracleId, Card>> =>
  new Map((await getCards(pool, ids)).map((c) => [c.oracleId, c]))

/**
 * Rewrite a deck's entries to match what the domain decided.
 *
 * A full replace rather than a per-command diff: the domain has already folded
 * the batch into one final entry list, and replaying its intermediate steps
 * against SQL would be a second implementation of the same logic — the two would
 * drift, and the drift would be silent. Runs inside the batch transaction, so a
 * partial write is impossible (doc 10 §10.3).
 */
const writeEntries = async (
  client: PoolClient,
  id: string,
  entries: readonly DeckEntry[],
): Promise<void> => {
  await client.query('DELETE FROM deck_entries WHERE deck_id = $1', [id])
  if (entries.length === 0) return

  const payload = entries.map((e) => ({
    oracle_id: e.oracleId,
    zone: e.zone,
    origin: e.origin,
    locked: e.locked,
    role_override: e.roleOverride,
    tags: e.tags,
    added_at: e.addedAt,
  }))
  await client.query(
    `INSERT INTO deck_entries (deck_id, oracle_id, zone, origin, locked, role_override, tags, added_at)
     SELECT $1, oracle_id, zone, origin, locked, role_override, tags, added_at
       FROM jsonb_to_recordset($2::jsonb) AS x(
         oracle_id uuid, zone text, origin text, locked boolean,
         role_override text[], tags text[], added_at timestamptz)`,
    [id, JSON.stringify(payload)],
  )
}

/**
 * Record that an idempotency key has been honoured.
 *
 * Takes a `Pool | PoolClient` so the caller can put it inside the batch
 * transaction — which is the only place it belongs when the batch wrote
 * anything. `ON CONFLICT DO NOTHING` covers the race where two identical
 * requests arrive together; the loser's version check has already rejected it.
 */
const recordReceipt = async (
  client: Pool | PoolClient,
  idempotencyKey: string,
  deckIdValue: string,
  result: unknown,
): Promise<void> => {
  await client.query(
    `INSERT INTO command_receipts (idempotency_key, deck_id, result)
     VALUES ($1, $2, $3::jsonb) ON CONFLICT (idempotency_key) DO NOTHING`,
    [idempotencyKey, deckIdValue, JSON.stringify(result)],
  )
}

export const registerDeckRoutes = (app: FastifyInstance, pool: Pool): void => {
  app.post('/api/v1/decks', { schema: { body: createDeckBody } }, async (req, rep) => {
    const body = req.body as {
      name: string
      description?: string
      commanders: string[]
      targetBracket: Bracket
      archetype: ArchetypeKey
      archetypeSecondary?: ArchetypeKey | null
      excludeUniversesBeyond?: boolean
    }
    const commanders = body.commanders.map(oracleId)

    const cards = await cardMap(pool, commanders)
    const unknown = commanders.filter((id) => !cards.has(id))
    if (unknown.length > 0) {
      return sendProblem(
        rep,
        unprocessable('One or more commanders are not in the card corpus', { unknown }),
      )
    }

    /*
     * A commander has to be able to BE one.
     *
     * Until this check existed the endpoint took any card in the corpus, and a
     * deck was created on production with Sol Ring in the command zone. The
     * damage is not the bad row: every recommendation afterwards is scored
     * against a colour identity derived from a card that cannot legally be
     * there, so the whole deck is quietly built to the wrong shape.
     *
     * `=== false` rather than a falsy test, and the difference is the entire
     * design of the column. `undefined` means the ingest has not decided yet
     * (migration 0010 applied, re-ingest not run), and rejecting on that would
     * refuse every commander in the corpus during the window between the two.
     * Unknown eligibility lets the deck through and is reported as a gap on
     * `GET /decks/:id/analysis` rather than being silently ruled on.
     */
    const ineligible = commanders.filter((id) => cards.get(id)?.canBeCommander === false)
    if (ineligible.length > 0) {
      // Named in `detail`, not only in the extension members: the web client
      // renders `detail` verbatim, and "Sol Ring cannot be a commander" is
      // something a builder can act on where a bare uuid is not.
      const names = ineligible.map((id) => cards.get(id)?.name ?? String(id))
      return sendProblem(
        rep,
        unprocessable(
          `${names.join(' and ')} cannot be a commander: a commander must be a legendary creature, or a card whose text says it can be your commander`,
          { ineligible, names },
        ),
      )
    }

    const deck = await createDeck(pool, {
      id: deckId(randomUUID()),
      ownerId: ownerOf(req),
      name: body.name,
      description: body.description ?? '',
      commanders,
      targetBracket: body.targetBracket,
      archetype: body.archetype,
      archetypeSecondary: body.archetypeSecondary ?? null,
      // Derived from the commanders, never taken from the request: the client
      // does not get to declare a colour identity the cards disagree with.
      colorIdentity: deckColorIdentity(commanders, cards),
      excludeUniversesBeyond: body.excludeUniversesBeyond ?? false,
    })
    return rep.status(201).send(deck)
  })

  /**
   * The basic lands this deck may run (ADR-0012 / doc 05 §5.2).
   *
   * Its own endpoint rather than part of the candidate pool: basics are never
   * suggested, so they are not candidates, but the deck still needs them.
   */
  app.get(
    '/api/v1/decks/:id/basic-lands',
    { schema: { params: deckIdParams } },
    async (req, rep) => {
      const id = (req.params as { id: string }).id
      const deck = await getDeck(pool, deckId(id))
      if (deck === null) return sendProblem(rep, notFound(`No deck with id ${id}`))
      return { items: await findBasicLands(pool, deck.colorIdentity) }
    },
  )

  /**
   * Resolve a pasted decklist. Applies NOTHING.
   *
   * Doc 15 §15.3 and AGENTS.md §8 are explicit that an import must be previewed
   * before it lands — "a typo costs one line, never the paste". The client shows
   * what resolved and what did not, and only then sends accepts through the
   * ordinary command endpoint, so an import is undone the same way any other
   * batch is.
   *
   * This is a slice of API-04, not API-04: there is no in-place fixing of
   * unresolved lines yet, and illegal/previously-excluded are not reported.
   */
  app.post(
    '/api/v1/decks/:id/import/preview',
    { schema: { params: deckIdParams, body: importPreviewBody } },
    async (req, rep) => {
      const id = (req.params as { id: string }).id
      const { text } = req.body as { text: string }

      const deck = await getDeck(pool, deckId(id))
      if (deck === null) return sendProblem(rep, notFound(`No deck with id ${id}`))

      const parsed = parseDecklist(text)
      const index = buildNameIndex(await allCardNames(pool))
      const { resolved, unresolved } = resolveDecklist(parsed.entries, index)

      const names = new Map(
        (
          await getCards(
            pool,
            resolved.map((r) => r.oracleId),
          )
        ).map((c) => [c.oracleId, c.name]),
      )

      return {
        resolved: resolved.map((r) => ({
          oracleId: r.oracleId,
          name: names.get(r.oracleId) ?? r.entry.name,
          quantity: r.entry.quantity,
        })),
        // Reported, never dropped: an unresolved line is the user's to fix.
        unresolved: unresolved.map((u) => ({ name: u.entry.name, reason: u.reason })),
        problems: parsed.problems,
      }
    },
  )

  /**
   * Every deck on this device, newest-opened first.
   *
   * Summaries, never full decks: the switcher needs a name, a commander and a
   * card count, and loading twelve decks' worth of entries to draw a menu is
   * the mistake `DeckSummaryRow` exists to prevent (doc 12 §12.2).
   */
  app.get('/api/v1/decks', async (req) => ({
    items: await listDeckSummaries(pool, ownerOf(req), { limit: 50 }),
  }))

  app.get('/api/v1/decks/:id', { schema: { params: deckIdParams } }, async (req, rep) => {
    const id = (req.params as { id: string }).id
    const deck = await getDeck(pool, deckId(id))
    if (deck === null) return sendProblem(rep, notFound(`No deck with id ${id}`))
    return deck
  })

  app.patch(
    '/api/v1/decks/:id',
    {
      schema: { params: deckIdParams, body: patchDeckBody },
    },
    async (req, rep) => {
      const id = (req.params as { id: string }).id
      const body = req.body as {
        name?: string
        description?: string
        targetBracket?: Bracket
        archetype?: ArchetypeKey
        archetypeSecondary?: ArchetypeKey | null
        budget?: { maxTotalUsd?: number | null; maxCardUsd?: number | null } | null
        status?: Deck['status']
        excludeUniversesBeyond?: boolean
      }

      // COALESCE keeps every unsupplied column as it was. Changing archetype moves
      // targets only — no statement here touches `deck_entries` (doc 14 §14.4).
      const { rowCount } = await pool.query(
        `UPDATE decks SET
         name                = COALESCE($2, name),
         description         = COALESCE($12, description),
         target_bracket      = COALESCE($3, target_bracket),
         archetype           = COALESCE($4, archetype),
         archetype_secondary = CASE WHEN $5::boolean THEN $6 ELSE archetype_secondary END,
         budget_max_total    = CASE WHEN $7::boolean THEN $8 ELSE budget_max_total END,
         budget_max_card     = CASE WHEN $7::boolean THEN $9 ELSE budget_max_card END,
         status              = COALESCE($10, status),
         exclude_universes_beyond = COALESCE($11, exclude_universes_beyond),
         updated_at          = now()
       WHERE id = $1 AND deleted_at IS NULL`,
        [
          id,
          body.name ?? null,
          body.targetBracket ?? null,
          body.archetype ?? null,
          'archetypeSecondary' in body,
          body.archetypeSecondary ?? null,
          'budget' in body,
          body.budget?.maxTotalUsd ?? null,
          body.budget?.maxCardUsd ?? null,
          body.status ?? null,
          body.excludeUniversesBeyond ?? null,
          body.description ?? null,
        ],
      )
      if ((rowCount ?? 0) === 0) return sendProblem(rep, notFound(`No deck with id ${id}`))

      const deck = await getDeck(pool, deckId(id))
      if (deck === null) return sendProblem(rep, notFound(`No deck with id ${id}`))
      return deck
    },
  )

  app.post(
    '/api/v1/decks/:id/commands',
    {
      schema: { params: deckIdParams, body: commandsBody },
    },
    async (req, rep) => {
      const id = (req.params as { id: string }).id
      const body = req.body as {
        commands: DeckCommand[]
        idempotencyKey: string
        baseVersion: number
      }

      // Idempotency first (doc 10 §10.1): the offline client retries a queued batch
      // it never saw the answer to, and a replay must return the original result
      // rather than applying the batch a second time.
      const { rows: receipts } = await pool.query<{ deck_id: string; result: unknown }>(
        'SELECT deck_id, result FROM command_receipts WHERE idempotency_key = $1',
        [body.idempotencyKey],
      )
      const receipt = receipts[0]
      if (receipt !== undefined) {
        // Postgres renders `uuid` lowercase, but ajv's uuid format is
        // case-insensitive, so an uppercase id in the path reaches here intact.
        // Comparing raw would turn a legitimate replay into a 400 — which the
        // offline queue reads as "never going to work" and drops the batch.
        if (receipt.deck_id.toLowerCase() !== id.toLowerCase()) {
          return sendProblem(
            rep,
            badRequest('idempotencyKey has already been used for a different deck'),
          )
        }
        // The stored half is the decision; the deck is re-read so a replay does
        // not hand back a snapshot that later batches have already moved past.
        const stored = receipt.result as { applied: unknown; rejected: unknown }
        return { deck: await getDeck(pool, deckId(id)), ...stored }
      }

      const current = await getDeck(pool, deckId(id))
      if (current === null) return sendProblem(rep, notFound(`No deck with id ${id}`))

      const referenced = body.commands.flatMap((c) => ('oracleId' in c ? [c.oracleId] : []))
      const cards = await cardMap(pool, [...referenced, ...current.commanders])

      const decided = applyCommands(current, body.commands, {
        cards,
        now: new Date().toISOString(),
      })

      // A batch that applied nothing changes nothing. `deck.ts` defines version
      // as "bumped server-side per accepted command batch" — bumping for an
      // all-rejected batch invalidates every other client's baseVersion, moves
      // `updated_at` so the deck jumps up a `sort=updated` library, and churns
      // every `deck_entries` row for a no-op. `applyCorePackage` is rejected
      // unconditionally today, so this is the common case, not a corner one.
      if (decided.applied.length === 0) {
        if (current.version !== body.baseVersion) {
          return rep.status(409).send({ deck: current, since: [] })
        }
        const result = { deck: current, applied: [], rejected: decided.rejected }
        await recordReceipt(pool, body.idempotencyKey, id, result)
        return result
      }

      const outcome = await applyBatch(pool, deckId(id), body.baseVersion, async (client) => {
        await writeEntries(client, id, decided.deck.entries)
        // The receipt is written INSIDE the transaction, so the deck change and
        // the record of it commit together. Written after the commit instead,
        // a crash in the window between leaves a deck that moved with no key to
        // say so — and the client's retry then applies the whole batch twice.
        await recordReceipt(client, body.idempotencyKey, id, {
          applied: decided.applied,
          rejected: decided.rejected,
        })
        return decided
      })

      switch (outcome.kind) {
        case 'not-found':
          return sendProblem(rep, notFound(`No deck with id ${id}`))

        case 'stale': {
          // The batch was applied to nothing: `applyBatch` checks the version under
          // `FOR UPDATE` before calling us, so a stale request cannot half-write.
          //
          // `since` is empty and stays empty until API-06. Doc 10 §10.3 defines it
          // as the commands the client has not seen, which needs an ordered
          // per-deck command log keyed by version; the schema has no such table,
          // and API-06 owns exactly this ("optimistic concurrency: baseVersion,
          // 409 with since"). Returning the current deck is enough for a client to
          // refetch and rebuild — it just cannot replay incrementally yet.
          const latest = await getDeck(pool, deckId(id))
          return rep.status(409).send({ deck: latest, since: [] })
        }

        case 'applied': {
          // The deck is re-read rather than returned from `decided`, so the
          // response carries the server's own `version` and `updatedAt`.
          const deck = await getDeck(pool, deckId(id))
          return {
            deck,
            applied: outcome.result.applied,
            rejected: outcome.result.rejected,
          }
        }
      }
    },
  )
}
