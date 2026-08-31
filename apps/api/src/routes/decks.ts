import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Pool, PoolClient } from 'pg'
import {
  allCardNames,
  appendCommandLog,
  applyBatch,
  commandsSince,
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
  DeckCommandBatch,
  DeckEntry,
  OracleId,
  SemanticEmphasis,
  TargetOverrides,
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

/**
 * The body of a `409` (doc 10 §10.3, doc 12 §12.7).
 *
 * `since` is flat because that is the shape doc 10 §10.3 pins and other agents
 * are coding against. `sinceBatches` is the same data grouped the way the
 * server actually applied it — one entry per version, each with the wall clock
 * doc 12 §12.7's conflict rule needs. Both are derived from ONE read, so they
 * cannot disagree; a second query for the flat view could observe a newer log.
 *
 * `sinceComplete: false` means the log does not cover the whole gap and the
 * client must refetch rather than replay. Without it an empty `since` is a lie
 * by omission — "nothing changed" and "I cannot tell you what changed" are the
 * same three characters.
 */
interface ConflictBody {
  readonly deck: Deck | null
  readonly since: readonly DeckCommand[]
  readonly sinceBatches: readonly DeckCommandBatch[]
  readonly sinceComplete: boolean
}

const conflictBody = async (
  pool: Pool,
  id: string,
  deck: Deck | null,
  baseVersion: number,
): Promise<ConflictBody> => {
  // A deck that vanished between the version check and here has no history to
  // report. `sinceComplete: false` sends the client to a refetch, which is
  // where it will find the 404 for itself.
  if (deck === null) return { deck, since: [], sinceBatches: [], sinceComplete: false }

  const { batches, complete } = await commandsSince(pool, deckId(id), baseVersion, deck.version)
  return {
    deck,
    since: batches.flatMap((b) => b.commands),
    sinceBatches: batches,
    sinceComplete: complete,
  }
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
      semanticEmphasis?: SemanticEmphasis | null
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
      /*
       * NOT checked against the commanders' own tags.
       *
       * The start screen offers the commander's semantics, so in practice this
       * is always a subset of them — but the user's first sentence is about
       * clicking a semantic anywhere, and a deck may legitimately be built
       * toward something its commander does not do yet. Rejecting that here
       * would refuse a true statement about the deck; `recommend` reports how
       * much of the pool actually supports each emphasised tag instead, which
       * tells the builder the same thing without overruling them.
       */
      semanticEmphasis: body.semanticEmphasis ?? [],
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
        targetOverrides?: TargetOverrides | null
        semanticEmphasis?: SemanticEmphasis | null
      }

      /*
       * Targets are replaced WHOLESALE, never merged (doc 16).
       *
       * The object is small and the client always holds all of it — the sheet
       * renders every row before it can change one. A merge protocol would be a
       * second thing to get wrong, and it has no way to express a deletion:
       * "reset the ramp row" and "leave the ramp row alone" are both an absent
       * key, so a merging endpoint could never clear an override. Clearing is
       * the requirement doc 16 leans hardest on — an override you cannot get
       * rid of is a trap — so `null` and `{}` both mean "back to the preset".
       *
       * Note this deliberately does NOT reset on an archetype change: the two
       * are independent columns in one statement and neither clears the other.
       * See doc 16's answer to its own second open question.
       */
      const overrides =
        'targetOverrides' in body ? JSON.stringify(body.targetOverrides ?? {}) : null

      /*
       * The emphasis is replaced WHOLESALE too, and that is the de-emphasise
       * button (P4, and the half of the request that says "I should be able to
       * de emphasise if I wish").
       *
       * There is deliberately no add/remove protocol. A `POST .../emphasis/:tag`
       * pair would need its own idempotency story, and it could not express
       * "clear all" without a third verb. Sending the whole list makes removing
       * a tag the same operation as adding one — the client always holds the
       * complete set, because it drew every chip before one could be clicked —
       * so an emphasis the user cannot get rid of is unrepresentable rather than
       * merely unlikely. `null` and `[]` both mean no emphasis.
       */
      const emphasis =
        'semanticEmphasis' in body ? JSON.stringify(body.semanticEmphasis ?? []) : null

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
         -- COALESCE, not a CASE flag: $13 is already null exactly when the key
         -- is absent, because an explicit JSON null was turned into '{}' above.
         target_overrides    = COALESCE($13::jsonb, target_overrides),
         -- Same COALESCE shape as the line above, and for the same reason: $14
         -- is null exactly when the key is absent, because an explicit JSON
         -- null was already turned into '[]'.
         semantic_emphasis   = COALESCE($14::jsonb, semantic_emphasis),
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
          overrides,
          emphasis,
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

      // One instant for the whole batch: the entries it writes and the log row
      // that explains them carry the same `addedAt`/`applied_at`, so a client
      // reading `since` can line a command up with the entry it produced.
      // `now()` in SQL would be transaction-start and would not match.
      const now = new Date().toISOString()
      const decided = applyCommands(current, body.commands, { cards, now })

      // A batch that applied nothing changes nothing. `deck.ts` defines version
      // as "bumped server-side per accepted command batch" — bumping for an
      // all-rejected batch invalidates every other client's baseVersion, moves
      // `updated_at` so the deck jumps up a `sort=updated` library, and churns
      // every `deck_entries` row for a no-op. `applyCorePackage` is rejected
      // unconditionally today, so this is the common case, not a corner one.
      if (decided.applied.length === 0) {
        if (current.version !== body.baseVersion) {
          return rep.status(409).send(await conflictBody(pool, id, current, body.baseVersion))
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
        // Same transaction, same reason (API-06): a version bump the log cannot
        // explain is a hole in `since`, and `commandsSince` would then report
        // the whole gap as incomplete — every later client silently downgraded
        // to a refetch, with nothing saying why.
        //
        // `baseVersion + 1` is the version this batch takes the deck TO;
        // `applyBatch` bumps it after this callback returns, so reading it back
        // here would give the version being left behind.
        await appendCommandLog(client, deckId(id), body.baseVersion + 1, decided.applied, now)
        return decided
      })

      switch (outcome.kind) {
        case 'not-found':
          return sendProblem(rep, notFound(`No deck with id ${id}`))

        case 'stale': {
          // The batch was applied to nothing: `applyBatch` checks the version under
          // `FOR UPDATE` before calling us, so a stale request cannot half-write.
          //
          // `since` carries what the client missed, read from `deck_command_log`
          // (API-06). The deck is re-read first and its version is what the gap
          // is measured against, so the history and the deck in this response
          // describe the same instant.
          const latest = await getDeck(pool, deckId(id))
          return rep.status(409).send(await conflictBody(pool, id, latest, body.baseVersion))
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
