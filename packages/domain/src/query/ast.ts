import type { Role } from '../role.js'
import { SYNERGY_TAGS } from '../synergy.js'

/**
 * The candidate query language (doc 13, DOM-08).
 *
 * A Scryfall-familiar filter over the candidate pool, extended with fields that
 * reach our own annotations — `combo>=2` is the one Scryfall structurally cannot
 * express, because it is computed against the current accepted set.
 *
 * Deliberately NO regular expressions in v1 (doc 13 §13.2): user-supplied regex
 * evaluated server-side over ~30k cards is a denial-of-service surface.
 */

export type ComparisonOp = ':' | '=' | '!=' | '<' | '<=' | '>' | '>='

export type QueryField =
  | 'name'
  | 'type'
  | 'oracle'
  | 'keyword'
  | 'color'
  | 'identity'
  | 'manaValue'
  | 'power'
  | 'toughness'
  | 'rarity'
  | 'set'
  | 'is'
  | 'price'
  | 'role'
  | 'combo'
  | 'near'
  | 'flag'
  | 'group'
  /**
   * The mechanical synergy tags (ADR-0011), which the UI already shows as chips
   * on every row. `produces` is what the card CAUSES, `wants` is what it
   * benefits from, and `tag` matches either side.
   */
  | 'produces'
  | 'wants'
  | 'tag'

export type QueryNode =
  | { readonly kind: 'and'; readonly children: readonly QueryNode[] }
  | { readonly kind: 'or'; readonly children: readonly QueryNode[] }
  | { readonly kind: 'not'; readonly child: QueryNode }
  | {
      readonly kind: 'term'
      readonly field: QueryField
      readonly op: ComparisonOp
      readonly value: string
      /** True when the source spelled the value in quotes; preserved for formatting. */
      readonly quoted: boolean
    }

export interface QueryParseError {
  readonly position: number
  readonly length: number
  readonly message: string
  readonly suggestion: string | null
}

/** Field spellings accepted in source text, mapped to the canonical field. */
export const FIELD_ALIASES: ReadonlyMap<string, QueryField> = new Map([
  ['t', 'type'],
  ['type', 'type'],
  ['o', 'oracle'],
  ['oracle', 'oracle'],
  ['kw', 'keyword'],
  ['keyword', 'keyword'],
  ['c', 'color'],
  ['color', 'color'],
  ['colour', 'color'],
  ['id', 'identity'],
  ['identity', 'identity'],
  ['mv', 'manaValue'],
  ['cmc', 'manaValue'],
  ['pow', 'power'],
  ['power', 'power'],
  ['tou', 'toughness'],
  ['toughness', 'toughness'],
  ['r', 'rarity'],
  ['rarity', 'rarity'],
  ['set', 'set'],
  ['e', 'set'],
  ['is', 'is'],
  ['price', 'price'],
  ['usd', 'price'],
  ['role', 'role'],
  ['combo', 'combo'],
  ['near', 'near'],
  ['flag', 'flag'],
  ['group', 'group'],
  ['produces', 'produces'],
  ['causes', 'produces'],
  ['wants', 'wants'],
  ['benefits', 'wants'],
  ['tag', 'tag'],
  ['synergy', 'tag'],
])

/** Canonical spelling used by `formatQuery`, so formatting round-trips. */
export const CANONICAL_FIELD: Readonly<Record<QueryField, string>> = {
  name: '',
  type: 't',
  oracle: 'o',
  keyword: 'kw',
  color: 'c',
  identity: 'id',
  manaValue: 'mv',
  power: 'pow',
  toughness: 'tou',
  rarity: 'r',
  set: 'set',
  is: 'is',
  price: 'price',
  role: 'role',
  combo: 'combo',
  near: 'near',
  flag: 'flag',
  group: 'group',
  produces: 'produces',
  wants: 'wants',
  tag: 'tag',
}

export const NUMERIC_FIELDS: ReadonlySet<QueryField> = new Set<QueryField>([
  'manaValue',
  'power',
  'toughness',
  'price',
  'combo',
  'near',
])

export const IS_PREDICATES: ReadonlySet<string> = new Set([
  'permanent',
  'spell',
  'creature',
  'land',
  'vanilla',
  'modal',
  'dfc',
  'split',
  'adventure',
  'reserved',
  'gamechanger',
  'reprint',
  'firstprint',
])

/**
 * A tag as the user is likely to type it.
 *
 * The tags are kebab-case internally (`artifact-etb`) but the UI renders them
 * with spaces (`artifact etb`), which is the spelling a user copies off the
 * chip they just read. Both are accepted, and so is `tag:"artifact etb"` with
 * the quotes the space would otherwise need.
 */
export const normaliseTag = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')

export const SYNERGY_TAG_VALUES: ReadonlySet<string> = new Set(SYNERGY_TAGS)

export const ROLE_VALUES: ReadonlySet<string> = new Set<Role>([
  'land',
  'ramp',
  'draw',
  'tutor',
  'spot-removal',
  'board-wipe',
  'graveyard-hate',
  'protection',
  'recursion',
  'wincon',
  'synergy',
  'stax',
  'sac-outlet',
  'token-maker',
  'anthem',
  'equipment',
  'aura',
  'evasion',
])
