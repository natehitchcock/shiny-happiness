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

/**
 * Hydration carries three things now, and the third one is new (ADR-0021).
 *
 * Everything above the seam mocks this module wholesale, so these are the only
 * tests that see the real mapping from the wire shape to the maps the workspace
 * holds. Without them the art could be dropped here and every component test
 * would still be green — which is exactly how the app ran for four sessions
 * with the URLs ingested and no picture anywhere on screen.
 */
describe('hydrate', () => {
  const ART = 'https://cards.scryfall.io/art_crop/front/1/2/krenko.jpg?1'
  const NORMAL = 'https://cards.scryfall.io/normal/front/1/2/krenko.jpg?1'

  it('keeps the art beside the cards, keyed by oracle id', async () => {
    respond(200, {
      items: [{ oracleId: 'o1', name: 'Krenko, Mob Boss' }],
      prices: { o1: 1.5 },
      images: { o1: { artCrop: ART, normal: NORMAL } },
    })

    const hydrated = await api.hydrate(['o1'])

    expect(hydrated.images.get('o1')).toEqual({ artCrop: ART, normal: NORMAL })
    // Beside, not on: a `Card` is oracle identity and an image belongs to a
    // printing (doc 02 §2.1).
    expect(hydrated.cards.get('o1')).not.toHaveProperty('imageUris')
  })

  it('keeps "this card has no art" as an answer rather than a gap', async () => {
    // A printing whose art is unresolved sends two nulls. Dropping the entry
    // would make that indistinguishable from art that has not arrived yet.
    // 501 real cards took this path until the double-faced art fix; the corpus
    // is now 34,492 of 34,492 (doc 17 §17.2) and the state remains expressible.
    respond(200, {
      items: [{ oracleId: 'o1', name: 'Krenko, Mob Boss' }],
      prices: { o1: null },
      images: { o1: { artCrop: null, normal: null } },
    })

    const hydrated = await api.hydrate(['o1'])

    expect(hydrated.images.get('o1')).toEqual({ artCrop: null, normal: null })
  })

  it('survives a server that predates the images map', async () => {
    // A deployment running an older API sends no `images` key at all. That must
    // read as "no art known", not as a crash on the way in.
    respond(200, { items: [{ oracleId: 'o1', name: 'Krenko' }], prices: { o1: 1 } })

    const hydrated = await api.hydrate(['o1'])

    expect(hydrated.images.size).toBe(0)
    expect(hydrated.cards.size).toBe(1)
  })

  it('asks for nothing when there is nothing to ask about', async () => {
    // The empty-input short circuit returns all three maps, and a caller that
    // destructured `images` off it would otherwise get `undefined`.
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const hydrated = await api.hydrate([])

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(hydrated.images).toEqual(new Map())
  })
})
