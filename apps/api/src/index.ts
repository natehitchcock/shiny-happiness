/**
 * @roundtable/api — Fastify HTTP service (doc 10).
 *
 * API-01 implements the cards and decks surface (doc 10 §10.2, §10.3) including
 * the batched command endpoint. Recommendations and analysis are API-02; auth
 * and per-user rate limiting are API-03; the deck library is API-05.
 *
 * `main.ts` is the runnable entry point; this module is the importable surface.
 */
export { buildServer, type ServerOptions } from './server.js'
export { handler } from './serverless.js'
export { DEV_OWNER_ID } from './routes/decks.js'
export type { Problem } from './errors.js'
