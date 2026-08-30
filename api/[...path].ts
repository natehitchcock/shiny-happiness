/**
 * The whole API as one Vercel serverless function.
 *
 * Vercel routes `/api/*` here (see `vercel.json`), and Fastify does its own
 * routing from there. One function rather than a file per endpoint because the
 * routes share a connection pool, a schema compiler and an error handler —
 * splitting them would mean building all three per endpoint per cold start.
 *
 * The pool and the server are module-scope on purpose: a warm invocation reuses
 * both, and building Fastify per request would put schema compilation on the
 * critical path of every call.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { configFromEnv, createPool } from '@roundtable/db'
import { buildServer } from '@roundtable/api'

const config = configFromEnv()
if (config === null) throw new Error('DATABASE_URL is not set')

/**
 * The pool size is `DATABASE_POOL_MAX`, and on Vercel it must be SMALL.
 *
 * Every warm serverless instance holds its own pool, so the live connection
 * count is (instances × max). The default of 10 is right for one long-running
 * server and wrong here: Neon's free tier allows far fewer than Vercel will
 * happily scale to, and exhausting them does not fail for the request that did
 * it — it fails for somebody else's. `DEPLOYING.md` sets it to 3.
 */
const pool = createPool(config)

const ready = buildServer({ pool, logger: false }).then(async (app) => {
  await app.ready()
  return app
})

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await ready
  app.server.emit('request', req, res)
}
