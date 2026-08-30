import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Pool, PoolClient } from 'pg'
import { applyBatch, createDeck, getCards, getDeck } from '@roundtable/db'
import type {
  ArchetypeKey,
  Bracket,
  Card,
  Deck,
  DeckCommand,
  DeckEntry,
  OracleId,
} from '@roundtable/domain'
import { applyCommands, deckColorIdentity, deckId, oracleId } from '@roundtable/domain'
import { badRequest, notFound, sendProblem, unprocessable } from '../errors.js'
import { commandsBody, createDeckBody, deckIdParams, patchDeckBody } from '../schemas.js'

/**
 * Deck ownership is API-03's job.
 *
 * Until it lands every deck belongs to one fixed development owner. This is a
 * seam, not a stub of API-03: the owner is read from one place, so adding auth
 * means changing this resolver rather than hunting for `owner_id` in queries.
 */
export const DEV_OWNER_ID = '00000000-0000-0000-0000-000000000001'

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
      commanders: string[]
      targetBracket: Bracket
      archetype: ArchetypeKey
      archetypeSecondary?: ArchetypeKey | null
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

    const deck = await createDeck(pool, {
      id: deckId(randomUUID()),
      ownerId: DEV_OWNER_ID,
      name: body.name,
      commanders,
      targetBracket: body.targetBracket,
      archetype: body.archetype,
      archetypeSecondary: body.archetypeSecondary ?? null,
      // Derived from the commanders, never taken from the request: the client
      // does not get to declare a colour identity the cards disagree with.
      colorIdentity: deckColorIdentity(commanders, cards),
    })
    return rep.status(201).send(deck)
  })

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
        targetBracket?: Bracket
        archetype?: ArchetypeKey
        archetypeSecondary?: ArchetypeKey | null
        budget?: { maxTotalUsd?: number | null; maxCardUsd?: number | null } | null
        status?: Deck['status']
      }

      // COALESCE keeps every unsupplied column as it was. Changing archetype moves
      // targets only — no statement here touches `deck_entries` (doc 14 §14.4).
      const { rowCount } = await pool.query(
        `UPDATE decks SET
         name                = COALESCE($2, name),
         target_bracket      = COALESCE($3, target_bracket),
         archetype           = COALESCE($4, archetype),
         archetype_secondary = CASE WHEN $5::boolean THEN $6 ELSE archetype_secondary END,
         budget_max_total    = CASE WHEN $7::boolean THEN $8 ELSE budget_max_total END,
         budget_max_card     = CASE WHEN $7::boolean THEN $9 ELSE budget_max_card END,
         status              = COALESCE($10, status),
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
