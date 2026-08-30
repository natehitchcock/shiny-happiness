/**
 * Emit the elements of one named array from a large JSON document, without
 * holding the document in memory.
 *
 * Spellbook's bulk file is a single 645 MB object whose `variants` array is the
 * payload. `JSON.parse` on that needs gigabytes of heap, and there is no line
 * structure to exploit the way Scryfall's JSONL has. So the array is scanned:
 * find the key, then emit each balanced top-level element.
 *
 * A brace counter alone is not enough — a combo's `description` can contain
 * `{`, `}` or `"` characters, and `\"` inside a string must not end it. String
 * and escape state are therefore tracked explicitly. That is the whole reason
 * this is hand-written rather than a regex.
 */

export interface ScanState {
  /** Depth relative to the start of the array's first element. */
  depth: number
  inString: boolean
  escaped: boolean
  buffer: string
  started: boolean
  finished: boolean
}

export const initialScanState = (): ScanState => ({
  depth: 0,
  inString: false,
  escaped: false,
  buffer: '',
  started: false,
  finished: false,
})

/**
 * Feed one chunk; get back whatever complete elements it finished.
 *
 * `state` is mutated so a caller can stream chunk after chunk without
 * re-scanning what it has already consumed.
 */
export const scanChunk = (state: ScanState, chunk: string): string[] => {
  const out: string[] = []
  if (state.finished) return out

  for (const char of chunk) {
    if (!state.started) {
      // Everything before the array opens is envelope (`timestamp`, `version`).
      if (char === '[') state.started = true
      continue
    }

    if (state.depth === 0) {
      if (char === '{' || char === '[') {
        state.depth = 1
        state.buffer = char
      } else if (char === ']') {
        state.finished = true
        break
      }
      // Commas and whitespace between elements are skipped.
      continue
    }

    state.buffer += char

    if (state.escaped) {
      state.escaped = false
      continue
    }
    if (char === '\\') {
      // Only meaningful inside a string, but harmless outside — JSON has no
      // backslash elsewhere.
      state.escaped = true
      continue
    }
    if (char === '"') {
      state.inString = !state.inString
      continue
    }
    if (state.inString) continue

    if (char === '{' || char === '[') state.depth += 1
    else if (char === '}' || char === ']') {
      state.depth -= 1
      if (state.depth === 0) {
        out.push(state.buffer)
        state.buffer = ''
      }
    }
  }

  return out
}

/**
 * Stream `arrayKey`'s elements as parsed objects.
 *
 * The key is located first so the scanner does not mistake an earlier array in
 * the envelope for the payload.
 */
export async function* streamJsonArray<T>(
  chunks: AsyncIterable<string>,
  arrayKey: string,
): AsyncGenerator<T> {
  const needle = `"${arrayKey}"`
  const state = initialScanState()
  let pending = ''
  let foundKey = false

  for await (const chunk of chunks) {
    let text = chunk

    if (!foundKey) {
      pending += text
      const at = pending.indexOf(needle)
      if (at === -1) {
        // Keep only enough tail to catch a key split across a chunk boundary.
        pending = pending.slice(-needle.length)
        continue
      }
      foundKey = true
      text = pending.slice(at + needle.length)
      pending = ''
    }

    for (const item of scanChunk(state, text)) yield JSON.parse(item) as T
    if (state.finished) return
  }
}
