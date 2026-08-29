import { Pool, type PoolClient, type PoolConfig } from 'pg'

/**
 * Connection handling for `packages/db`.
 *
 * The connection string comes from the environment, never from a literal: this
 * package is the only place that talks to Postgres, and a hardcoded DSN is how a
 * test suite ends up pointed at production.
 */

export interface DbConfig extends PoolConfig {
  readonly connectionString: string
}

export const configFromEnv = (env: NodeJS.ProcessEnv = process.env): DbConfig | null => {
  const connectionString = env['DATABASE_URL']
  if (connectionString === undefined || connectionString === '') return null
  return { connectionString, max: Number(env['DATABASE_POOL_MAX'] ?? 10) }
}

export const createPool = (config: DbConfig): Pool => new Pool(config)

/**
 * Run `fn` inside a transaction, rolling back on any throw.
 *
 * Every multi-statement write goes through this. A batched command apply that
 * half-succeeds would leave a deck in a state no user asked for (doc 10 §10.3).
 */
export const withTransaction = async <T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    client.release()
    return result
  } catch (error) {
    // A failed ROLLBACK must not replace the error that caused it — the original
    // is the one worth reading. And a connection whose rollback failed is in an
    // unknown state, so it is destroyed rather than returned to the pool, where
    // it would poison the next caller's transaction.
    try {
      await client.query('ROLLBACK')
      client.release()
    } catch {
      client.release(true)
    }
    throw error
  }
}
