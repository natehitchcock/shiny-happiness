import { ARCHETYPES, BRACKETS, COLORS, ROLE_PRECEDENCE, SYNERGY_TAGS } from '@roundtable/domain'
import type { ArchetypeKey, Bracket, Color, Origin, Role } from '@roundtable/domain'

/**
 * JSON Schema for request validation (doc 10 §10.1).
 *
 * The enum members come from `packages/domain`'s own exported vocabularies, not
 * from lists retyped here — doc 10 is explicit that request types are derived
 * from the domain rather than maintained as a parallel definition. Where the
 * domain exports no array (`Origin`, `Zone`), the list is built from a
 * `Record<T, true>`, which is a compile error if a member is added, removed or
 * misspelled. A drifting enum is otherwise invisible until a valid request 400s.
 */

const membersOf = <T extends string>(record: Record<T, true>): T[] => Object.keys(record) as T[]

export const ORIGINS: readonly Origin[] = membersOf<Origin>({
  core: true,
  manual: true,
  recommended: true,
  imported: true,
})

export const ROLES: readonly Role[] = ROLE_PRECEDENCE
export const ARCHETYPE_KEYS: readonly ArchetypeKey[] = ARCHETYPES
export const BRACKET_VALUES: readonly Bracket[] = BRACKETS
export const COLOR_VALUES: readonly Color[] = COLORS

const uuid = { type: 'string', format: 'uuid' } as const

export const deckIdParams = {
  type: 'object',
  required: ['id'],
  properties: { id: uuid },
} as const

export const oracleIdParams = {
  type: 'object',
  required: ['oracleId'],
  properties: { oracleId: uuid },
} as const

/**
 * The semantics a deck is about (`semantic-emphasis.ts`).
 *
 * `null` is accepted and means "clear it", exactly as `targetOverrides` does:
 * the user asked in as many words to be able to de-emphasise, and `[]` alone
 * would leave a client unable to say "back to no focus" in a body whose other
 * fields all treat absence as "leave alone".
 *
 * The enum comes from the domain's own `SYNERGY_TAGS`, not a list retyped here
 * — two tags were added this morning (ADR-0022) and a parallel copy would have
 * 400'd them. `maxItems` is the vocabulary size because the value is a SET;
 * duplicates are dropped on read, so a longer array carries no more meaning.
 */
const semanticEmphasis = {
  type: ['array', 'null'],
  items: { type: 'string', enum: [...SYNERGY_TAGS] },
  maxItems: SYNERGY_TAGS.length,
} as const

export const createDeckBody = {
  type: 'object',
  required: ['name', 'commanders', 'targetBracket', 'archetype'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string', maxLength: 4000 },
    // One, or two under a partner rule (doc 03 §3.1). The database enforces the
    // same bound, but a 400 here beats a 500 from a CHECK constraint.
    commanders: { type: 'array', items: uuid, minItems: 1, maxItems: 2 },
    targetBracket: { type: 'integer', enum: [...BRACKET_VALUES] },
    archetype: { type: 'string', enum: [...ARCHETYPE_KEYS] },
    archetypeSecondary: { type: ['string', 'null'], enum: [...ARCHETYPE_KEYS, null] },
    // A taste filter, not a legality rule (ADR-0011). Per deck, so it survives
    // reopening; defaults off so the corpus stays whole until asked.
    excludeUniversesBeyond: { type: 'boolean' },
    // Accepted at creation because that is when the builder is asked: the start
    // screen offers the commander's own semantics before the deck exists.
    semanticEmphasis,
  },
} as const

/**
 * The per-deck target sheet (doc 16).
 *
 * `null` is accepted and means "clear it". That is not decoration: an override
 * the user cannot get rid of is a trap, and `{}` alone would leave a client
 * unable to say "back to the archetype" in a body whose other fields all treat
 * absence as "leave alone".
 *
 * Counts are integers 0–99 because they are CARDS. A share would have to be
 * multiplied by a deck size the sheet does not know, and doc 16 argues the
 * point at length: builders think in "36 lands", not "34.2% of nonland spells".
 *
 * `roles` keys are unconstrained strings — they are `dimensionKey` values, and
 * the vocabulary is `Role` × `CardType`, which is too large to enumerate here
 * without restating two domain unions. `parseTargetOverrides` drops anything
 * outside the key space on read, so a nonsense key costs itself and nothing
 * more; enumerating it here would only move the same rejection earlier.
 */
const targetCount = { type: 'integer', minimum: 0, maximum: 99 } as const

const targetOverrides = {
  type: ['object', 'null'],
  additionalProperties: false,
  properties: {
    roles: { type: 'object', additionalProperties: targetCount },
    curve: {
      type: 'object',
      // Buckets 0–7 only, named one by one: `additionalProperties` cannot
      // constrain a key's NUMERIC range, and an `8` silently kept here would be
      // an override the curve never applies and the sheet cannot show.
      additionalProperties: false,
      properties: {
        '0': targetCount,
        '1': targetCount,
        '2': targetCount,
        '3': targetCount,
        '4': targetCount,
        '5': targetCount,
        '6': targetCount,
        '7': targetCount,
      },
    },
    tolerance: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const

export const patchDeckBody = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string', maxLength: 4000 },
    targetBracket: { type: 'integer', enum: [...BRACKET_VALUES] },
    archetype: { type: 'string', enum: [...ARCHETYPE_KEYS] },
    archetypeSecondary: { type: ['string', 'null'], enum: [...ARCHETYPE_KEYS, null] },
    budget: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        maxTotalUsd: { type: ['number', 'null'], minimum: 0 },
        maxCardUsd: { type: ['number', 'null'], minimum: 0 },
      },
    },
    status: { type: 'string', enum: ['active', 'archived'] },
    excludeUniversesBeyond: { type: 'boolean' },
    targetOverrides,
    semanticEmphasis,
  },
} as const

/** ≤ 500 per call (doc 10 §10.2). The client hydrates grids with this. */
export const cardBatchBody = {
  type: 'object',
  required: ['oracleIds'],
  additionalProperties: false,
  properties: {
    oracleIds: { type: 'array', items: uuid, minItems: 1, maxItems: 500 },
  },
} as const

/**
 * Note the absent `additionalProperties: false`.
 *
 * `removeAdditional` is off globally (see `server.ts`), so a strict querystring
 * would 400 on any stray parameter a browser, share link or analytics layer
 * appends — `?q=sol&utm_source=x` is not a malformed request. Bodies stay
 * strict; a querystring is not under the client's sole control.
 */
export const cardSearchQuery = {
  type: 'object',
  properties: {
    q: { type: 'string', maxLength: 500 },
    colors: { type: 'string', maxLength: 10 },
    excludeUniversesBeyond: { type: 'boolean' },
    limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
    cursor: { type: 'string', maxLength: 500 },
  },
} as const

const acceptCommand = {
  type: 'object',
  required: ['type', 'oracleId', 'origin'],
  additionalProperties: false,
  properties: {
    type: { const: 'accept' },
    oracleId: uuid,
    origin: { type: 'string', enum: [...ORIGINS] },
    lock: { type: 'boolean' },
  },
} as const

const oracleOnlyCommand = (type: 'exclude' | 'restore' | 'remove') =>
  ({
    type: 'object',
    required: ['type', 'oracleId'],
    additionalProperties: false,
    properties: { type: { const: type }, oracleId: uuid },
  }) as const

const lockCommand = {
  type: 'object',
  required: ['type', 'oracleId', 'locked'],
  additionalProperties: false,
  properties: { type: { const: 'lock' }, oracleId: uuid, locked: { type: 'boolean' } },
} as const

const setRoleCommand = {
  type: 'object',
  required: ['type', 'oracleId', 'roles'],
  additionalProperties: false,
  properties: {
    type: { const: 'setRole' },
    oracleId: uuid,
    roles: { type: 'array', items: { type: 'string', enum: [...ROLES] } },
  },
} as const

const corePackageCommand = (type: 'applyCorePackage' | 'removeCorePackage') =>
  ({
    type: 'object',
    required: ['type', 'bracket'],
    additionalProperties: false,
    properties: { type: { const: type }, bracket: { type: 'integer', enum: [...BRACKET_VALUES] } },
  }) as const

export const commandsBody = {
  type: 'object',
  required: ['commands', 'idempotencyKey', 'baseVersion'],
  additionalProperties: false,
  properties: {
    commands: {
      type: 'array',
      minItems: 1,
      // A core package is ~24 changes (doc 06 §6.6); the cap is well clear of
      // that while still bounding a single transaction.
      maxItems: 200,
      items: {
        oneOf: [
          acceptCommand,
          oracleOnlyCommand('remove'),
          oracleOnlyCommand('exclude'),
          oracleOnlyCommand('restore'),
          lockCommand,
          setRoleCommand,
          corePackageCommand('applyCorePackage'),
          corePackageCommand('removeCorePackage'),
        ],
      },
    },
    idempotencyKey: { type: 'string', minLength: 8, maxLength: 200 },
    baseVersion: { type: 'integer', minimum: 1 },
  },
} as const

/**
 * Recommendation request (doc 10 §10.4). Every field is optional: an empty body
 * means "all groups, default limit, no filter", which is the common call.
 */
export const recommendationsBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    groups: { type: 'array', items: { type: 'string' }, maxItems: 40 },
    limitPerGroup: { type: 'integer', minimum: 1, maximum: 200 },
    query: { type: 'string', maxLength: 500 },
    // Queries shown as per-row columns rather than applied as filters.
    columns: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 6 },
    // Weights are a partial override of ScoringWeights; the domain fills the
    // rest from the archetype's defaults, so any subset is valid.
    weights: { type: 'object', additionalProperties: { type: 'number' } },
  },
} as const

/** A pasted decklist. Generous but bounded — 100 cards is ~4 KB. */
export const importPreviewBody = {
  type: 'object',
  required: ['text'],
  additionalProperties: false,
  properties: { text: { type: 'string', minLength: 1, maxLength: 100_000 } },
} as const
