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
  /**
   * The two card-intrinsic metrics (doc 18), which the suggestion table already
   * offers as columns.
   *
   * They were deliberately NOT queries while they were display-only, on the
   * reasoning that a metric is something a column draws rather than something
   * the parser reads. That reasoning stopped holding the moment a builder could
   * see 6.12 on a row and had no way to ask for the rows like it — `impact>=6
   * -t:land` is the query that was impossible.
   *
   * Numeric, and on their OWN SCALES: impact runs 0–18.48 (its ceiling is
   * breadth 6.0 × persistence 2.2 × stakes 1.4) and efficiency is a small ratio
   * — measured to 6.03 over a real mono-red pool. No rescaling happens
   * anywhere, so the number a user types is the number the column shows them
   * (§18.8, and the comment on `AnnotatedCandidate.impact`). Normalising either
   * to a shared 0–10 was rejected for exactly that: it would make every
   * threshold on screen a translation.
   *
   * `impact.ts` used to say "roughly 0–13" in its own docblock, which
   * understated it — 93 of 1,448 candidates in that pool score above 13. It now
   * exports `IMPACT_MAX`, derived from the three tier tables, and the card
   * detail pane draws every score against it.
   */
  | 'impact'
  | 'efficiency'

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
  // Short spelling first, long spelling canonical — the shape `mv`/`cmc` and
  // `price`/`usd` already have. `imp` and `eff` are what a repeat user types;
  // the full word is what the chip and the error message read back.
  ['imp', 'impact'],
  ['impact', 'impact'],
  ['eff', 'efficiency'],
  ['efficiency', 'efficiency'],
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
  /*
   * The FULL word, not `imp`/`eff`. The abbreviated canonicals above are the
   * ones Scryfall taught users (`t`, `o`, `mv`); every field this project
   * invented — `combo`, `near`, `price`, `role`, `group`, `tag` — formats back
   * as the word it is, because the chip row and the screen-reader description
   * are the things that read it.
   */
  impact: 'impact',
  efficiency: 'efficiency',
}

export const NUMERIC_FIELDS: ReadonlySet<QueryField> = new Set<QueryField>([
  'manaValue',
  'power',
  'toughness',
  'price',
  'combo',
  'near',
  // Fractional, unlike every other member: `eff>=1.5` and `impact>=6.12` are
  // both ordinary queries. The validator's number pattern already allows a
  // decimal part, so nothing else has to change for that.
  'impact',
  'efficiency',
])

export const IS_PREDICATES: ReadonlySet<string> = new Set([
  'permanent',
  'spell',
  'creature',
  'commander',
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
