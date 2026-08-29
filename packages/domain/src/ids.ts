/**
 * Branded identifiers (doc 02 §2.1).
 *
 * A bare `string` id is a bug waiting to be a wrong lookup: nothing stops you
 * passing a `PrintingId` where an `OracleId` belongs, and both are UUIDs, so the
 * mistake surfaces as an empty result rather than a type error. Branding costs a
 * cast at the boundary and buys a compile error everywhere else.
 */

declare const brand: unique symbol

type Brand<T, B extends string> = T & { readonly [brand]: B }

/** Scryfall `oracle_id` — the identity a Commander deck actually cares about. */
export type OracleId = Brand<string, 'OracleId'>
/** Scryfall `id` — one specific printing. Only the UI needs these. */
export type PrintingId = Brand<string, 'PrintingId'>
export type DeckId = Brand<string, 'DeckId'>
export type ComboId = Brand<string, 'ComboId'>
export type SnapshotId = Brand<string, 'SnapshotId'>

/**
 * Brand a raw string at a trust boundary — parsing input, reading a fixture,
 * hydrating from the database. Never call these to paper over a type error in
 * code that already has the right id to hand.
 */
export const oracleId = (value: string): OracleId => value as OracleId
export const printingId = (value: string): PrintingId => value as PrintingId
export const deckId = (value: string): DeckId => value as DeckId
export const comboId = (value: string): ComboId => value as ComboId
export const snapshotId = (value: string): SnapshotId => value as SnapshotId
