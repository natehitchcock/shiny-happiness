import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { MIGRATIONS_DIR, appliedMigrations, liveSnapshot, migrationVersions } from '@roundtable/db'

/**
 * `GET /api/v1/health` — what a deployment is actually running.
 *
 * It exists because of a failure that produced no error at all. Production sat
 * four migrations behind for weeks: `0006` adds `power`/`toughness` and `0005`
 * adds the name-similarity index, so every creature rendered with no printed
 * power or toughness and fuzzy search matched nothing. A schema that is merely
 * OLD serves nulls, and a null reads as *absent* rather than as *broken* — no
 * `500`, no log line, nothing to alert on. Finding it needed the database
 * credentials and a CLI, which is a high bar for "is this deploy current?".
 *
 * Three constraints shaped it.
 *
 * **Cheap.** Three trivial queries and no corpus read. The corpus counts come
 * from the live `dataset_snapshots` row rather than `count(*)`, and nothing
 * here touches `corpus-cache.ts` — that file exists because ~86 MB per request
 * exhausted a metered transfer allowance in about sixty requests, and a health
 * endpoint is the one route that gets polled.
 *
 * **Never leaks a secret.** The connection string is never read, never echoed
 * and never parsed for a hostname. When the database cannot be reached the
 * response carries the driver's `code` (`ENOTFOUND`, `28P01`, `3D000`) and the
 * NAMES of the Postgres-ish environment variables that are set — the same
 * precedent, and the same reason, as `serverless.ts`. The driver's `message` is
 * deliberately NOT passed through: it is the one field that can contain a user
 * name, a host or, for some failures, the URL it was given.
 *
 * **Answers when the database is down.** A `500` from the generic handler says
 * "Internal Server Error" and nothing else, which is precisely the diagnosis
 * problem this endpoint was added to solve. The body below is returned either
 * way; only the status code changes.
 */

export type HealthStatus = 'ok' | 'degraded' | 'unavailable'

export interface Health {
  readonly status: HealthStatus
  readonly schema: {
    /** The newest APPLIED migration, or null if none have been applied. */
    readonly applied: string | null
    /** The newest migration this BUILD ships, or null if unreadable. */
    readonly expected: string | null
    /** Shipped but not applied, in order. Non-empty ⇒ the deploy is behind. */
    readonly pending: readonly string[]
    readonly upToDate: boolean
    /** Present only when something could not be determined, and says what. */
    readonly detail?: string
  }
  readonly corpus: {
    readonly loaded: boolean
    readonly snapshotId: string | null
    readonly cardCount: number | null
    readonly comboCount: number | null
    readonly ingestedAt: string | null
  }
  readonly database: {
    readonly reachable: boolean
    /** Driver error code. Short and opaque — never a message, never a URL. */
    readonly code?: string
    readonly detail?: string
  }
}

/**
 * Name the Postgres-ish variables that ARE set, values omitted.
 *
 * Lifted from `serverless.ts` for the same reason it exists there: the usual
 * cause of an unreachable database is a near miss (`POSTGRES_URL` set,
 * `DATABASE_URL` not), and that is invisible from an error code alone. Names
 * only — a connection string carries a password and this text reaches a
 * browser.
 */
const postgresVarNames = (): readonly string[] =>
  Object.keys(process.env)
    .filter((key) => /^(POSTGRES|DATABASE|PG)/i.test(key))
    .sort()

/**
 * A sentence for the codes that actually come up, and nothing invented for the
 * ones that do not.
 *
 * Rejected alternative: pass through `error.message`. It is more informative
 * and it is the single most likely place for a credential or a host to escape
 * into a public response, which is not a trade worth making on an unauthenticated
 * endpoint.
 */
const reachabilityDetail = (code: string | undefined): string => {
  const known: Record<string, string> = {
    ENOTFOUND: 'The database host does not resolve.',
    ECONNREFUSED: 'Nothing is listening at the configured host and port.',
    ETIMEDOUT: 'The connection attempt timed out.',
    ECONNRESET: 'The database closed the connection.',
    '28P01': 'The database rejected the credentials.',
    '28000': 'The database rejected the connection for this user.',
    '3D000': 'The database named in the connection string does not exist.',
    '53300': 'The database is out of connections.',
    '57P03': 'The database is starting up and not accepting connections yet.',
  }
  const named = code === undefined ? undefined : known[code]
  const vars = postgresVarNames()
  const which =
    vars.length === 0
      ? ' No Postgres-related environment variables are set at all.'
      : ` Variables that ARE set: ${vars.join(', ')} — this app reads DATABASE_URL only.`
  return `${named ?? 'The database could not be reached.'}${which}`
}

const errorCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null) return undefined
  const code = (error as { code?: unknown }).code
  // A code is a short token. Anything else is a message wearing the field's
  // name, and messages are exactly what must not be echoed.
  return typeof code === 'string' && code.length <= 32 ? code : undefined
}

export const buildHealth = async (pool: Pool): Promise<Health> => {
  /*
   * The shipped list is read from disk and is allowed to fail.
   *
   * On Vercel the `.sql` files are only in the bundle if the tracer kept them,
   * and a health endpoint that throws because it could not find its own
   * migrations would be a worse outage than the one it diagnoses. When the list
   * is unreadable, `applied` is still reported — which is the number an
   * operator compares against `git log` — and `detail` says why the comparison
   * could not be made here.
   */
  let shipped: readonly string[] | null = null
  let shippedDetail: string | undefined
  try {
    shipped = await migrationVersions(MIGRATIONS_DIR)
  } catch {
    shippedDetail =
      'The migration files are not readable from this build, so `pending` cannot be computed. ' +
      'Compare `applied` against packages/db/migrations in the deployed commit.'
  }

  let applied: readonly string[] | null
  let snapshot: Awaited<ReturnType<typeof liveSnapshot>> = null
  try {
    applied = await appliedMigrations(pool)
    // Guarded on the schema existing. `dataset_snapshots` is created by
    // `0001`, so on a database that has never been migrated this query would
    // raise `undefined_table` — and a missing TABLE would then be reported as
    // an unreachable DATABASE, sending the operator after the connection
    // string instead of after `migrate up`. The snapshot read is separate from
    // the schema read on purpose: an empty corpus and a stale schema are
    // different faults with different fixes (DEPLOYING.md step 4 versus 3).
    if (applied !== null) snapshot = await liveSnapshot(pool)
  } catch (error) {
    const code = errorCode(error)
    return {
      status: 'unavailable',
      schema: {
        applied: null,
        expected: shipped === null ? null : (shipped[shipped.length - 1] ?? null),
        pending: [],
        upToDate: false,
        detail: 'The database could not be read, so the applied schema is unknown.',
      },
      corpus: {
        loaded: false,
        snapshotId: null,
        cardCount: null,
        comboCount: null,
        ingestedAt: null,
      },
      database: {
        reachable: false,
        ...(code === undefined ? {} : { code }),
        detail: reachabilityDetail(code),
      },
    }
  }

  const appliedSet = new Set(applied ?? [])
  const pending = shipped === null ? [] : shipped.filter((v) => !appliedSet.has(v))

  // A database that has never been migrated is behind, not up to date, even
  // when the shipped list is unreadable and `pending` is therefore empty.
  const upToDate = applied !== null && applied.length > 0 && pending.length === 0

  const detail =
    shippedDetail ??
    (applied === null
      ? 'No `schema_migrations` table: this database has never been migrated.'
      : undefined)

  return {
    // `degraded` rather than `unavailable`: the API is serving, it is just
    // serving from a schema or a corpus that will make answers look wrong
    // rather than fail. That distinction is the entire point of the endpoint.
    status: upToDate && snapshot !== null ? 'ok' : 'degraded',
    schema: {
      applied: applied === null ? null : (applied[applied.length - 1] ?? null),
      expected: shipped === null ? null : (shipped[shipped.length - 1] ?? null),
      pending,
      upToDate,
      ...(detail === undefined ? {} : { detail }),
    },
    corpus: {
      loaded: snapshot !== null,
      snapshotId: snapshot?.id ?? null,
      cardCount: snapshot?.cardCount ?? null,
      comboCount: snapshot?.comboCount ?? null,
      ingestedAt: snapshot?.createdAt ?? null,
    },
    database: { reachable: true },
  }
}

export const registerHealthRoutes = (app: FastifyInstance, pool: Pool): void => {
  app.get('/api/v1/health', async (_req, rep) => {
    const health = await buildHealth(pool)
    /*
     * 503 only when the database is unreachable; 200 for `degraded`.
     *
     * A monitor has to be able to alert on "down", and a 200 that says
     * `unavailable` in its body is a 200 to everything that watches status
     * codes. `degraded` stays 200 because the deployment IS serving requests —
     * failing its health check would take a working site out of a load
     * balancer over a missing migration, which is worse than the missing
     * migration. The body says `upToDate: false` either way, and that is the
     * field to assert on.
     *
     * Deliberately NOT RFC 9457 (doc 10 §10.1), which every other error here
     * is: a problem document replaces the body with `title`/`detail`, and on
     * this endpoint the body IS the diagnosis. Losing `schema` and `corpus`
     * precisely when the deployment is broken would invert the point.
     */
    return rep.status(health.status === 'unavailable' ? 503 : 200).send(health)
  })
}
