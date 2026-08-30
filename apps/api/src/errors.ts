import type { FastifyReply } from 'fastify'

/**
 * RFC 9457 `application/problem+json` (doc 10 §10.1).
 *
 * One error shape for every route. The offline queue (doc 12 §12.7) has to tell
 * "retry this" from "this will never succeed", and it cannot do that against a
 * different ad-hoc body per endpoint.
 */

const BASE = 'https://roundtable.invalid/problems'

export interface Problem {
  readonly type: string
  readonly title: string
  readonly status: number
  readonly detail?: string
  /** RFC 9457 §3.2 extension members. Clients read these. */
  readonly [key: string]: unknown
}

export const PROBLEM_CONTENT_TYPE = 'application/problem+json'

export const sendProblem = (reply: FastifyReply, problem: Problem): FastifyReply =>
  reply.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem)

export const notFound = (detail: string): Problem => ({
  type: `${BASE}/not-found`,
  title: 'Not found',
  status: 404,
  detail,
})

export const badRequest = (detail: string, extensions: Record<string, unknown> = {}): Problem => ({
  type: `${BASE}/validation`,
  title: 'Invalid request',
  status: 400,
  detail,
  ...extensions,
})

/**
 * 422, not 400: the request parsed and validated fine, but what it asks for
 * cannot be done — the schema cannot know whether a commander exists.
 */
export const unprocessable = (
  detail: string,
  extensions: Record<string, unknown> = {},
): Problem => ({
  type: `${BASE}/unprocessable`,
  title: 'Unprocessable request',
  status: 422,
  detail,
  ...extensions,
})
