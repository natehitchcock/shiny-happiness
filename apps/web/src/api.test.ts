// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'

/**
 * The failure seam, not the happy path.
 *
 * `ApiError` used to reduce every failure to a message string, which is why the
 * 409 handler could only re-read the deck and re-send blindly: the body it
 * needed — the deck plus the commands it had missed (doc 10 §10.3) — had
 * already been thrown away by the time the handler saw the error.
 */
const respond = (status: number, body: unknown): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
      }),
    ),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ApiError', () => {
  it('keeps the whole 409 body, not just a message', async () => {
    const conflict = {
      deck: { id: 'd1', version: 7 },
      since: [{ type: 'exclude', oracleId: 'o1' }],
      sinceComplete: true,
    }
    respond(409, conflict)

    const error = await api.getDeck('d1').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(api.ApiError)
    expect((error as api.ApiError).status).toBe(409)
    expect((error as api.ApiError).body).toEqual(conflict)
  })

  it('still surfaces `detail` from a problem document (doc 10 §10.1)', async () => {
    respond(404, { type: 'about:blank', title: 'Not found', status: 404, detail: 'No deck' })

    const error = (await api.getDeck('d1').catch((e: unknown) => e)) as api.ApiError

    expect(error.message).toBe('No deck')
    expect(error.status).toBe(404)
  })

  it('falls back to the status when the body is not JSON at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 502,
          json: () => Promise.reject(new Error('not json')),
        }),
      ),
    )

    const error = (await api.getDeck('d1').catch((e: unknown) => e)) as api.ApiError

    expect(error.message).toContain('502')
    expect(error.body).toBeNull()
  })
})
