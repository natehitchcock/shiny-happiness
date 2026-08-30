import { describe, expect, it } from 'vitest'
import { streamJsonArray } from './json-array-stream.js'

/**
 * The scanner exists because the payload is too large to `JSON.parse`, so these
 * tests are mostly about the ways a naive brace-counter gets it wrong.
 */
const chunked = async function* (text: string, size: number): AsyncGenerator<string> {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size)
}

const collect = async <T>(text: string, key: string, chunkSize: number): Promise<T[]> => {
  const out: T[] = []
  for await (const item of streamJsonArray<T>(chunked(text, chunkSize), key)) out.push(item)
  return out
}

describe('streamJsonArray', () => {
  const doc = '{"version":"1","variants":[{"id":"a"},{"id":"b"},{"id":"c"}]}'

  it('emits every element', async () => {
    expect(await collect<{ id: string }>(doc, 'variants', 1024)).toEqual([
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ])
  })

  it('gives the same answer at every chunk boundary', async () => {
    // A boundary can fall inside a key, a string, an escape, or a brace pair.
    for (const size of [1, 2, 3, 5, 7, 13, 64]) {
      expect(await collect<{ id: string }>(doc, 'variants', size)).toHaveLength(3)
    }
  })

  it('does not end an element on a brace inside a string', async () => {
    const braces = '{"variants":[{"text":"gain {G}{G}, then }} happens"},{"id":"z"}]}'

    const items = await collect<Record<string, string>>(braces, 'variants', 3)

    expect(items).toHaveLength(2)
    expect(items[0]?.['text']).toBe('gain {G}{G}, then }} happens')
  })

  it('does not end a string on an escaped quote', async () => {
    const escaped = String.raw`{"variants":[{"t":"a \" b {"},{"id":"z"}]}`

    const items = await collect<Record<string, string>>(escaped, 'variants', 2)

    expect(items).toHaveLength(2)
    expect(items[0]?.['t']).toBe('a " b {')
  })

  it('handles a trailing backslash before the closing quote', async () => {
    const escaped = String.raw`{"variants":[{"t":"ends with a backslash \\"},{"id":"z"}]}`

    const items = await collect<Record<string, string>>(escaped, 'variants', 4)

    expect(items).toHaveLength(2)
    expect(items[0]?.['t']).toBe('ends with a backslash \\')
  })

  it('handles nested objects and arrays', async () => {
    const nested = '{"variants":[{"uses":[{"card":{"id":1}},{"card":{"id":2}}]}]}'

    const items = await collect<{ uses: { card: { id: number } }[] }>(nested, 'variants', 5)

    expect(items).toHaveLength(1)
    expect(items[0]?.uses.map((u) => u.card.id)).toEqual([1, 2])
  })

  it('ignores an array that appears before the wanted key', async () => {
    // A naive "first [" scanner would emit the envelope's array instead.
    const withEnvelope = '{"sources":[{"id":"wrong"}],"variants":[{"id":"right"}]}'

    const items = await collect<{ id: string }>(withEnvelope, 'variants', 6)

    expect(items).toEqual([{ id: 'right' }])
  })

  it('stops at the end of the array and ignores what follows', async () => {
    const trailing = '{"variants":[{"id":"a"}],"after":[{"id":"ignored"}]}'

    expect(await collect<{ id: string }>(trailing, 'variants', 3)).toEqual([{ id: 'a' }])
  })

  it('yields nothing for an empty array', async () => {
    expect(await collect('{"variants":[]}', 'variants', 4)).toEqual([])
  })

  it('yields nothing when the key is absent', async () => {
    expect(await collect('{"other":[{"id":"a"}]}', 'variants', 4)).toEqual([])
  })

  it('survives a key split across a chunk boundary', async () => {
    const doc2 = '{"padding":"xxxxxxxxxx","variants":[{"id":"a"}]}'

    // Chunk size 1 puts every character on its own boundary.
    expect(await collect<{ id: string }>(doc2, 'variants', 1)).toEqual([{ id: 'a' }])
  })
})
