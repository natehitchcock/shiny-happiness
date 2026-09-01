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

import type { EfficiencyView, ImpactRoleView, ImpactView } from './metrics.js'

export type Color = 'W' | 'U' | 'B' | 'R' | 'G'

/**
 * Which PHYSICAL face of a card a surface is drawing (ADR-0027).
 *
 * Not the same thing as `oracleTextFaces`, which counts HALVES: `Fire // Ice`
 * has two of those and one face, and offering to flip it would be offering to
 * show its own right-hand side. A `CardSide` of `'back'` is only ever reachable
 * for a card whose `backImageUris` is present.
 */
export type CardSide = 'front' | 'back'

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
  /**
   * Where the art is, at the two sizes anything above L0 draws.
   *
   * These are Scryfall's own CDN URLs, used exactly as published and never
   * rewritten, resized or re-encoded — ADR-0021 has the reasoning and ADR-0009
   * Q4 has the terms that constrain it. Read them through `imageFor`, which
   * pairs a zoom level with the asset that level is allowed to load and treats
   * an empty string as absence.
   */
  readonly imageUris?:
    | {
        readonly artCrop?: string | undefined
        readonly normal?: string | undefined
      }
    | undefined
  /**
   * The BACK face's art, for a card printed on two PHYSICAL faces (ADR-0027).
   *
   * `imageUris` above is the front, and the front is the card — it is what a
   * tile, a deck-web crop and the first paint of every detail surface draw.
   * This never replaces it; it is the other side, carried so a flip control has
   * something to show.
   *
   * THE KEY IS THE STRUCTURAL FACT AND THE URLS ARE ONLY THE CONTENT, which is
   * the whole reason this is a separate optional member rather than two more
   * entries inside `imageUris`:
   *
   *   - absent — one physical face. Nine cards in ten. No flip control.
   *   - present, with URLs — two faces, and we have the picture.
   *   - present, with nothing usable in it — two faces, no picture. The control
   *     still has to be drawn, over an honest panel rather than a broken image.
   *
   * Nesting it under `imageUris` was the rejected shape: `apps/web` collapses a
   * front pair with no URLs in it to `undefined` outright (see `viewImageUris`),
   * so a two-faced card whose FRONT art had not resolved would have lost its
   * back face along with it — the third state silently becoming the first.
   *
   * The members are individually optional, matching `imageUris`, because the
   * mapping from the wire drops a null rather than forwarding it: `''` and
   * `null` both mean "no cached asset", and `<img src="">` re-requests the page
   * and draws it broken. `imageFor(card, level, 'back')` is the reader.
   */
  readonly backImageUris?:
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
  /**
   * How much the card does, and what it costs to do it (doc 18).
   *
   * Whole objects, not bare scores: the tiers behind the number are what make
   * it readable, and the card-detail route already sends them (`cardImpact(card)`
   * rather than `cardImpact(card).score`). Optional because they ride on card
   * detail and on recommendation items only — a half-resolved card, a search
   * result, or an unresolved import has neither, and `CardMetrics` draws
   * nothing rather than a heading over two blanks.
   */
  readonly impact?: ImpactView | undefined
  readonly efficiency?: EfficiencyView | undefined
  /**
   * What impact looks like for the cards that share this one's `primaryRole`
   * (doc 18 §18.12), so `0.68` reads as "the median ramp card" rather than as
   * "a twenty-seventh of the best card in Magic".
   *
   * Separate from `impact` although it is drawn beside it: `impact` is on the
   * wire from the server and `impactRole` is a lookup the client does against a
   * table baked into `@roundtable/domain`. Folding it into `ImpactView` would
   * make a field the API never sends look as though it did.
   */
  readonly impactRole?: ImpactRoleView | undefined
}
