import { configFromEnv, createPool } from '@roundtable/db'
import { buildServer } from './server.js'

/**
 * Runnable entry point.
 *
 * Fails fast on a missing `DATABASE_URL` rather than starting and 500ing on the
 * first request — a service that accepts connections it cannot serve is harder
 * to diagnose than one that refuses to start.
 */
const main = async (): Promise<void> => {
  const config = configFromEnv()
  if (config === null) {
    console.error('DATABASE_URL is not set')
    process.exit(1)
  }

  const pool = createPool(config)
  const app = await buildServer({ pool, logger: true })

  const port = Number(process.env['PORT'] ?? 3000)
  const host = process.env['HOST'] ?? '127.0.0.1'

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down')
    await app.close()
    await pool.end()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  await app.listen({ port, host })
}

await main()
