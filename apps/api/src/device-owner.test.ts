import { describe, expect, it } from 'vitest'
import { DEV_OWNER_ID, ownerOf } from './routes/decks.js'

const req = (headers: Record<string, unknown>) => ({ headers })

/**
 * ADR-0014: a deck belongs to a device, and the device is a header.
 *
 * The header goes straight into a uuid column, so what is NOT accepted matters
 * as much as what is.
 */
describe('ownerOf', () => {
  it('uses a valid device id', () => {
    const id = 'a3f1c2d4-5e6b-4a8c-9d0e-1f2a3b4c5d6e'
    expect(ownerOf(req({ 'x-device-id': id }))).toBe(id)
  })

  it('lower-cases it, so one device is not two owners', () => {
    expect(ownerOf(req({ 'x-device-id': 'A3F1C2D4-5E6B-4A8C-9D0E-1F2A3B4C5D6E' }))).toBe(
      'a3f1c2d4-5e6b-4a8c-9d0e-1f2a3b4c5d6e',
    )
  })

  it('falls back when the header is absent, so older decks stay reachable', () => {
    expect(ownerOf(req({}))).toBe(DEV_OWNER_ID)
  })

  it('rejects anything that is not a uuid rather than passing it to the driver', () => {
    // An unparseable value would surface as a 500 from pg, not a 400 from us.
    for (const bad of [
      'not-a-uuid',
      "'; DROP TABLE decks; --",
      '00000000-0000-0000-0000-00000000000',
      '',
      '../../etc/passwd',
    ]) {
      expect(ownerOf(req({ 'x-device-id': bad })), bad).toBe(DEV_OWNER_ID)
    }
  })

  it('rejects a non-string header rather than coercing it', () => {
    expect(ownerOf(req({ 'x-device-id': 42 }))).toBe(DEV_OWNER_ID)
    expect(ownerOf(req({ 'x-device-id': null }))).toBe(DEV_OWNER_ID)
  })

  it('reads the first value when a header is sent twice', () => {
    const id = 'a3f1c2d4-5e6b-4a8c-9d0e-1f2a3b4c5d6e'
    expect(ownerOf(req({ 'x-device-id': [id, 'other'] }))).toBe(id)
  })
})
