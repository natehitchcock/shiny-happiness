/**
 * The whole API as one serverless function.
 *
 * One function rather than a file per endpoint because the routes share a
 * connection pool, a schema compiler and an error handler; splitting them would
 * rebuild all three per endpoint per cold start.
 *
 * The logic lives here, in the package, rather than in the platform's `api/`
 * directory — so it is typechecked, linted and tested alongside the routes it
 * serves, and so the deployment entry point is three lines that cannot hide a
 * bug. `api/index.ts` is that entry point.
 *
 * **Nothing throws at module scope.** A module-level throw in a serverless
 * function is reported by the platform as `FUNCTION_INVOCATION_FAILED` and
 * nothing else — no message, no stack, and nothing the person deploying can act
 * on without log access. The first version did exactly that on a missing
 * `DATABASE_URL`, which is the single most likely thing to be wrong on a first
 * deploy. Everything is therefore built lazily, inside the request, where a
 * failure can be described.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { FastifyInstance } from 'fastify'
import { configFromEnv, createPool } from '@roundtable/db'
import { buildServer } from './server.js'

/**
 * Built once per warm instance, not per request.
 *
 * A rejected promise is not cached: if the first request fails because the
 * database was unreachable for a moment, the next one should try again rather
 * than serving the same error for the lifetime of the instance.
 */
let building: Promise<FastifyInstance> | null = null

const getApp = async (): Promise<FastifyInstance> => {
  building ??= (async () => {
    const config = configFromEnv()
    if (config === null) {
      throw new Error(
        'DATABASE_URL is not set on this deployment. Set it in Project Settings > ' +
          'Environment Variables (see DEPLOYING.md), then redeploy.',
      )
    }
    // The pool size is DATABASE_POOL_MAX and on Vercel it must be small: every
    // warm instance holds its own, so live connections are (instances x max).
    const pool = createPool(config)
    const app = await buildServer({ pool, logger: false })
    await app.ready()
    return app
  })().catch((error: unknown) => {
    building = null
    throw error
  })
  return building
}

export const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  let app: FastifyInstance
  try {
    app = await getApp()
  } catch (error) {
    // RFC 9457, like every other error this API emits (doc 10 §10.1) — and
    // carrying the actual reason, because the alternative is a bare platform
    // 500 that says only that something went wrong.
    const detail = error instanceof Error ? error.message : 'The API failed to start'
    res.statusCode = 500
    res.setHeader('content-type', 'application/problem+json')
    res.end(
      JSON.stringify({
        type: 'about:blank',
        title: 'API unavailable',
        status: 500,
        detail,
      }),
    )
    return
  }

  // Resolve only once the response is finished. Returning early would let the
  // platform freeze the instance mid-write.
  await new Promise<void>((resolve) => {
    res.on('close', resolve)
    res.on('finish', resolve)
    app.server.emit('request', req, res)
  })
}
