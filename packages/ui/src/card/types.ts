/**
 * What the card primitives need to render — a view model, not the domain type.
 *
 * `@roundtable/ui` deliberately does NOT depend on `@roundtable/domain`. Two
 * reasons, and the second is the load-bearing one:
 *
 *   - the domain `Card` carries no image URL and no price, on purpose (doc 02
 *     §2.1) — those are printing-level, and every level above L0 needs them, so
 *     the primitives would need a second parameter anyway
 *   - a primitive that takes a `Card` can only ever draw a card. Taking a view
 *     model means a tile can render a search result, a preview, or a card from
 *     an import that has not been resolved yet — all of which have a name and a
 *     mana value and none of which are a `Card`
 *
 * Everything past `name` is optional, so a half-resolved card still renders
 * rather than throwing. What a primitive must never do is render a *blank* where
 * a value is missing; each one states what it falls back to.
 *
 * The optional fields are written `?: T | undefined` rather than plain `?: T`,
 * which under `exactOptionalPropertyTypes` are different types. Callers build
 * these by mapping an API response — `imageUris: printing?.imageUris` — and that
 * produces an explicit `undefined`, not an absent key. A type that only accepted
 * absence would push every caller into a conditional spread to say the thing it
 * already means.
 */

export type Color = 'W' | 'U' | 'B' | 'R' | 'G'

export interface CardView {
  readonly oracleId: string
  readonly name: string
  /** Scryfall mana cost string, e.g. `{2}{R}`. Null for lands. */
  readonly manaCost?: string | null | undefined
  readonly manaValue?: number | undefined
  readonly colorIdentity?: readonly Color[] | undefined
  readonly typeLine?: string | undefined
  readonly oracleText?: string | undefined
  /**
   * `oracleText` split by card face, for a card that has more than one.
   *
   * Carried separately because the split cannot be recovered from the joined
   * string: faces are joined with the same newline that separates two abilities
   * of one face. Absent for a single-faced card, and for one hydrated before the
   * field existed — both of which render as one face.
   */
  readonly oracleTextFaces?: readonly string[] | undefined
  readonly primaryRole?: string | undefined
  /** How many combos this card completes in the current deck. 0 for none. */
  readonly comboDegree?: number | undefined
  /** Combos it would complete if one more piece arrived. */
  readonly nearCombosAt1?: number | undefined
  readonly priceUsd?: number | null | undefined
  /** Bracket concerns this card raises — flagged, never filtered (doc 03). */
  readonly bracketFlags?: readonly string[] | undefined
  readonly imageUris?:
    | {
        readonly artCrop?: string | undefined
        readonly normal?: string | undefined
      }
    | undefined
  /**
   * Why this card was recommended. Pillar P4 — a recommendation with no reasons
   * is a bug, and `Detail` renders this as the answer to "why is this here".
   */
  readonly reasons?: readonly string[] | undefined
}
