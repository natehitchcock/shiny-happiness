import { createGunzip } from 'node:zlib'
import { Readable } from 'node:stream'

/**
 * A response body as decoded UTF-8 text, gunzipping only when the runtime has
 * not already done it.
 *
 * The distinction is not cosmetic and both real sources sit on opposite sides:
 *
 * - Scryfall serves `Content-Type: application/gzip` with NO `Content-Encoding`,
 *   so `fetch` hands back the raw gzip bytes and the caller must inflate them.
 * - Commander Spellbook serves `Content-Encoding: gzip`, which `fetch`
 *   transparently decodes, so inflating again fails with `Z_DATA_ERROR`.
 *
 * Deciding from the headers rather than the file extension is what makes one
 * code path work for both — `variants.json.gz` is already decompressed by the
 * time we see it, despite the name.
 */
export const textStreamOf = (response: Response): AsyncIterable<string> => {
  if (response.body === null) throw new Error('response has no body')

  const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])

  const contentEncoding = response.headers.get('content-encoding') ?? ''
  const contentType = response.headers.get('content-type') ?? ''
  const alreadyDecoded = contentEncoding.toLowerCase().includes('gzip')
  const isGzip = !alreadyDecoded && (contentType.includes('gzip') || contentType.includes('octet'))

  const stream = isGzip ? source.pipe(createGunzip()) : source
  stream.setEncoding('utf8')
  return stream as unknown as AsyncIterable<string>
}
