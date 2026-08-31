import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { PROBLEM_CONTENT_TYPE, badRequest } from './errors.js'
import { registerCardRoutes } from './routes/cards.js'
import { registerDeckRoutes } from './routes/decks.js'
import { registerRecommendationRoutes } from './routes/recommendations.js'
import { registerAnalysisRoutes } from './routes/analysis.js'
import { registerHealthRoutes } from './routes/health.js'

export interface ServerOptions {
  readonly pool: Pool
  readonly logger?: boolean
}

/**
 * The API-01 surface (doc 10 §10.2, §10.3).
 *
 * Takes a pool rather than building one: the contract tests run against a
 * throwaway database per file, and a server that reaches for `DATABASE_URL`
 * itself cannot be pointed anywhere else.
 */
export const buildServer = async (options: ServerOptions): Promise<FastifyInstance> => {
  const app = Fastify({
    logger: options.logger ?? false,
    ajv: {
      customOptions: {
        // Fastify defaults this to true, which is actively wrong for a `oneOf`
        // union: ajv strips properties absent from EVERY branch it tries, so an
        // `accept` command loses `origin` while the `exclude` branch is tested,
        // and the handler receives a command the client never sent. Off, the
        // `additionalProperties: false` in each branch rejects unknown fields
        // loudly instead of silently deleting known ones.
        removeAdditional: false,
        allErrors: true,
      },
    },
  })

  // Fastify's default validation error is its own shape. Every error this API
  // emits is RFC 9457 (doc 10 §10.1), schema failures included.
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error.validation !== undefined) {
      return reply
        .status(400)
        .type(PROBLEM_CONTENT_TYPE)
        .send(
          badRequest(error.message, {
            errors: error.validation.map((v) => ({
              path: v.instancePath,
              message: v.message ?? 'invalid',
            })),
          }),
        )
    }
    reply.log.error(error)
    return reply
      .status(error.statusCode ?? 500)
      .type(PROBLEM_CONTENT_TYPE)
      .send({
        type: 'about:blank',
        title: 'Internal Server Error',
        status: error.statusCode ?? 500,
      })
  })

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).type(PROBLEM_CONTENT_TYPE).send({
      type: 'about:blank',
      title: 'Not found',
      status: 404,
      detail: 'No such route',
    }),
  )

  // Registered first so it stays reachable even if a later registration is
  // what is broken — a health check that only works on a healthy server is not
  // one. Like the others it names its own `/api/v1/...` path; there is no
  // prefix to inherit.
  registerHealthRoutes(app, options.pool)
  registerCardRoutes(app, options.pool)
  registerDeckRoutes(app, options.pool)
  registerRecommendationRoutes(app, options.pool)
  registerAnalysisRoutes(app, options.pool)

  return app
}
