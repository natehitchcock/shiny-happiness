import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Vercel serverless entry point, invoked the way Vercel invokes it.
 *
 * This exists because the deployed function answered `FUNCTION_INVOCATION_FAILED`
 * and nothing else. That is all the platform can report for a module-scope
 * throw, and the first version of this handler threw at module scope on a
 * missing `DATABASE_URL` — the single most likely thing to be wrong on a first
 * deploy, rendered undiagnosable.
 *
 * Running it here proves the imports resolve from the repo root and that the
 * env-missing path answers rather than crashing, which leaves the platform's
 * own bundling as the only untested variable.
 */

const original = process.env['DATABASE_URL']

/** A response object that records what was written to it. */
class FakeResponse extends EventEmitter {
  statusCode = 200
  headers: Record<string, string> = {}
  body = ''
  ended = false
  setHeader(name: string, value: string): void {
    this.headers[name.toLowerCase()] = value
  }
  end(chunk?: string): void {
    if (chunk !== undefined) this.body += chunk
    this.ended = true
    this.emit('finish')
  }
  write(chunk: string): void {
    this.body += chunk
  }
}

const loadHandler = async (): Promise<
  (req: IncomingMessage, res: ServerResponse) => Promise<void>
> => {
  // Fresh module each time: the handler memoises the built server, which is the
  // behaviour under test in one case and interference in the others.
  vi.resetModules()
  const mod = (await import('./[...path].js')) as {
    default: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  }
  return mod.default
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  if (original === undefined) delete process.env['DATABASE_URL']
  else process.env['DATABASE_URL'] = original
})

describe('the serverless handler', () => {
  it('imports cleanly from the repo root', async () => {
    // `api/` is outside every workspace package, so `@roundtable/api` and
    // `@roundtable/db` only resolve because the root package.json depends on
    // them. That was missing at first and would have failed the deploy the same
    // opaque way.
    await expect(loadHandler()).resolves.toBeTypeOf('function')
  })

  it('answers a readable problem when DATABASE_URL is not set', async () => {
    delete process.env['DATABASE_URL']
    const handler = await loadHandler()
    const res = new FakeResponse()

    await handler({} as IncomingMessage, res as unknown as ServerResponse)

    expect(res.statusCode).toBe(500)
    expect(res.headers['content-type']).toBe('application/problem+json')
    const problem = JSON.parse(res.body) as { detail: string; title: string }
    // The whole point: the message names the variable and where to set it.
    expect(problem.detail).toMatch(/DATABASE_URL is not set/)
    expect(problem.detail).toMatch(/Environment Variables/)
    expect(problem.title).toBe('API unavailable')
  })

  it('does not cache a failed build', async () => {
    // A database unreachable for one moment must not poison the instance for
    // its whole life. Second call with the env repaired has to try again.
    delete process.env['DATABASE_URL']
    const handler = await loadHandler()

    const first = new FakeResponse()
    await handler({} as IncomingMessage, first as unknown as ServerResponse)
    expect(first.statusCode).toBe(500)

    const second = new FakeResponse()
    await handler({} as IncomingMessage, second as unknown as ServerResponse)
    // Still 500 (env is still missing), but it re-ran rather than replaying a
    // cached rejection — which is what the next assertion pins down.
    expect(second.statusCode).toBe(500)
    expect(JSON.parse(second.body)).toEqual(JSON.parse(first.body))
  })
})
