import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as api from './api'
import { cardDetail, hydrateCards } from './cardcache'
import { usePipeline, type Phase } from './pipeline'
import { AUTO_QUERY_MS, useAutoQuery } from './autoquery'
import {
  archetypeTolerance,
  COLORS,
  CURVE_REFERENCE_SPELLS,
  dimensionKeysOf,
  formatDecklist,
  // The two charts' slice order, from the package that also decides what goes
  // in each slice. A hand-written `['W','U','B','R','G','M','C']` here would be
  // a second copy of the server's bucket list, free to drift the day a key is
  // added — which is exactly how `C` came to be missing from the first pie.
  IDENTITY_BUCKETS,
  interactsWith,
  MANA_LETTERS,
  rebaseCommands,
} from '@roundtable/domain'
// Aliased: `oracleId` is a parameter name a dozen times in this file, and a
// brander shadowed by a local of the same name reads as a bug even when it is
// not one.
import { oracleId as asOracleId } from '@roundtable/domain'
// `IDENTITY_COLORS` rather than a hex in this file: Magic's five colours are
// data the design system owns, and a second copy here is how the pie and the
// mana symbols come to disagree about what blue is.
import { CardFace, IDENTITY_COLORS, ManaCost, OracleText, levelSpec } from '@roundtable/ui'
import type { CardView, Color } from '@roundtable/ui'
import type { DeckCommand, SynergyTag } from '@roundtable/domain'
import { DeckMenu } from './DeckMenu'
import { Boundary } from './Boundary'
import { Hint } from './Hint'
import { DeckWeb } from './deckweb/DeckWeb'
import { enterDeckWeb, leaveDeckWeb, useDeckWebMode } from './deckweb/route'
import { readable } from './tags'
import type { Card } from './api'

/** Human-readable label for a composition dimension. */
/**
 * The wire form of a dimension, as a key.
 *
 * `dimensionKey` in the domain takes a branded `CompositionDimension`; the
 * analysis response carries the same two shapes as plain optional strings, so
 * this reads them without a cast through the brand. The FORMAT is the domain's
 * and must stay in step with it — `role:x` / `type:x`.
 */
const dimensionKeyOf = (d: { role?: string; type?: string }): string =>
  d.role === undefined ? `type:${d.type ?? ''}` : `role:${d.role}`

const dimensionName = (d: { role?: string; type?: string }): string => d.role ?? d.type ?? '—'

/**
 * The auto-query wait in whole seconds, for the one control that names it.
 *
 * Derived, never typed: the checkbox and its tooltip both read "four seconds"
 * against a two-second constant, so the control that exists to tell you how
 * long you have was wrong by a factor of two.
 */
const AUTO_QUERY_SECONDS = Math.round(AUTO_QUERY_MS / 1000)

/** Prices are estimates, and the interface has to say so (ADR-0009 Q7). */
const usd = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `$${value.toFixed(2)}`

/**
 * The wire form of a card's art, as `CardView` wants it.
 *
 * The conversion is null-to-undefined and nothing else, but it is not cosmetic.
 * `CardView.imageUris.normal` is `string | undefined`, so a `null` arriving from
 * the API is neither a URL nor the absence the primitives test for, and
 * `<img src={null}>` draws a broken image exactly where the no-art fallback was
 * meant to draw a readable panel. A card with neither asset collapses to
 * `undefined` outright, which is the shape a card whose printing has no
 * resolved art takes.
 *
 * Here rather than in `api.ts` because it is a view-model mapping, not part of
 * the HTTP seam — `api.ts` is where the wire types live and this is where they
 * stop being wire types.
 */
const viewImageUris = (
  images: api.ImageUris | undefined,
): { artCrop?: string; normal?: string } | undefined => {
  if (images === undefined) return undefined
  if (images.artCrop === null && images.normal === null) return undefined
  return {
    ...(images.artCrop === null ? {} : { artCrop: images.artCrop }),
    ...(images.normal === null ? {} : { normal: images.normal }),
  }
}

/**
 * An API card as the `@roundtable/ui` primitives want it.
 *
 * The primitives take a view model rather than a `Card` on purpose (see
 * `packages/ui/src/card/types.ts`), so somebody has to do this mapping; doing it
 * once here is what stops three call sites each inventing a slightly different
 * one. Price and art come in as separate arguments because on the wire they are
 * separate maps — a printing-level fact never rides on an oracle-level card.
 *
 * `colorIdentity` is filtered rather than cast. The API types it as `string[]`,
 * and a letter outside WUBRG reaching `identityKey` would be read as a
 * single-colour identity and painted the wrong colour, which is a wrong answer
 * drawn confidently.
 */
const cardView = (
  card: api.Card,
  price: number | null | undefined,
  images: api.ImageUris | undefined,
): CardView => ({
  oracleId: card.oracleId,
  name: card.name,
  manaCost: card.manaCost,
  manaValue: card.manaValue,
  colorIdentity: card.colorIdentity.filter((c): c is Color =>
    (COLORS as readonly string[]).includes(c),
  ),
  typeLine: card.typeLine,
  oracleText: card.oracleText,
  oracleTextFaces: card.oracleTextFaces,
  primaryRole: card.primaryRole,
  priceUsd: price,
  imageUris: viewImageUris(images),
})

/**
 * The cheapest price across a card's printings.
 *
 * The fallback for a card the hydration maps never covered — a name-match
 * result is not in the deck and not in the suggestion feed, so `prices` has no
 * entry for it and the preview printed a bare em dash beside "est. cheapest of
 * 53 printings". The panel was reading the printings to COUNT them and not to
 * answer the question the count was decorating.
 *
 * `null` only when no printing carries a price at all, which is a real answer:
 * the estimate does not exist rather than being unknown.
 */
export const cheapestPrinting = (
  printings: readonly { priceUsd: number | null }[],
): number | null => {
  let best: number | null = null
  for (const p of printings) {
    if (p.priceUsd === null) continue
    if (best === null || p.priceUsd < best) best = p.priceUsd
  }
  return best
}

/**
 * Art from the first printing that has any.
 *
 * First rather than cheapest, deliberately: `printingsFor` orders by set code
 * and collector number, so "first" is the earliest printing, which is the one
 * most people picture. Pairing the art with the CHEAPEST printing was the other
 * option and was rejected — it would put a different card on screen depending
 * on the day's prices, and the note under it already says the price is for a
 * printing that may not be the one shown (ADR-0021).
 *
 * Empty strings are absence, not URLs: `packages/db` writes `''` for a printing
 * with no cached image, and `<img src="">` re-requests the page itself.
 */
export const artFromPrintings = (
  printings: readonly { imageUris?: { artCrop: string; normal: string } }[],
): api.ImageUris | undefined => {
  for (const p of printings) {
    const artCrop = p.imageUris?.artCrop ?? ''
    const normal = p.imageUris?.normal ?? ''
    if (artCrop === '' && normal === '') continue
    return { artCrop: artCrop === '' ? null : artCrop, normal: normal === '' ? null : normal }
  }
  return undefined
}

/**
 * An enum key as a phrase, for a `kind` or a source key this build has no
 * sentence for.
 *
 * The point is that a NEW kind from a newer server degrades to readable English
 * instead of to `not-legal-in-commander`. It is a fallback and never the first
 * choice: every kind the domain declares today has a real sentence below.
 */
const humanise = (key: string): string => {
  const words = key.replace(/[-_]/g, ' ').trim()
  return words === '' ? 'Unknown' : words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * A legality problem in words, naming the card it is about.
 *
 * Two defects in one line of JSX before this: the panel rendered `{p.kind}`, so
 * a builder read `wrong-card-count`; and a problem carries an `oracleId` and no
 * name, so `color-identity` reported an illegal card WITHOUT SAYING WHICH. The
 * name is in the hydrated `cards` map — the same map the deck list draws from —
 * so the only card that cannot be named is one this view has never loaded, and
 * that is said in words rather than as a truncated uuid. A uuid is not an
 * identifier to anybody holding a pile of cardboard.
 */
export const legalityText = (
  p: api.LegalityProblem,
  cards: ReadonlyMap<string, api.Card>,
): string => {
  const name = p.oracleId === undefined ? undefined : cards.get(p.oracleId)?.name
  // Never the uuid. "A card" plus the rule broken is less information than a
  // name and more than a 36-character string nobody can act on.
  const subject = name ?? 'A card this view has not loaded'
  switch (p.kind) {
    case 'wrong-card-count': {
      const actual = p.actual ?? 0
      const expected = p.expected ?? 100
      const off = expected - actual
      if (off === 0) return `The deck has ${String(actual)} cards.`
      return off > 0
        ? `${String(off)} cards short of ${String(expected)} — the deck has ${String(actual)}.`
        : `${String(-off)} cards over ${String(expected)} — the deck has ${String(actual)}.`
    }
    case 'not-singleton':
      return `${subject}: ${String(p.copies ?? 0)} copies, and Commander allows ${String(p.allowed ?? 1)}.`
    case 'banned':
      return `${subject} is banned in Commander.`
    case 'not-legal-in-commander':
      return `${subject} is not legal in Commander.`
    case 'color-identity': {
      const off = p.offending ?? []
      return off.length === 0
        ? `${subject} is outside your commander's colour identity.`
        : `${subject} is outside your commander's colour identity (${off.join('')}).`
    }
    case 'no-commander':
      return 'This deck has no commander.'
    case 'too-many-commanders':
      return `${String(p.count ?? 0)} commanders — Commander allows one, or two that partner.`
    case 'invalid-commander':
      return `${subject} cannot lead a deck${p.reason === undefined ? '' : ` — ${p.reason}`}.`
    case 'invalid-partnership':
      return `These commanders cannot be paired${p.reason === undefined ? '' : ` — ${p.reason}`}.`
    case 'unknown-card':
      return `${subject} is not in the card corpus.`
    default:
      // A kind added after this build. Readable, and it still names the card.
      return name === undefined ? humanise(p.kind) : `${humanise(p.kind)} — ${name}`
  }
}

/**
 * A command the server refused, in words.
 *
 * The client used to throw the whole `rejected` array away. The consequence was
 * a silent failure at the one place it hurts most: the optimistic overlay put
 * the card in the deck on the click, the server refused it, the next response
 * carried a deck without it, and `setPending([])` swept the overlay away. The
 * card simply was not there, and nothing anywhere said why. That is reachable
 * from the ordinary feed (a stale tab, a card banned since the last ingest) and
 * it is reachable ON PURPOSE from the "Cards named like…" list, which exists to
 * show cards that are NOT candidates for this deck.
 *
 * Named from the hydrated cards, exactly as `legalityText` does — a rejection
 * that says "36 characters of uuid was refused" is not a reason.
 *
 * `kind` stays a plain string for the reason `LegalityProblem.kind` does: a
 * newer server may reject for a reason this build has never heard of, and that
 * has to degrade to readable English rather than to silence.
 */
export const rejectionText = (
  r: { command: { type: string; oracleId?: string }; reason: { kind: string } },
  cards: ReadonlyMap<string, api.Card>,
): string => {
  const name = r.command.oracleId === undefined ? undefined : cards.get(r.command.oracleId)?.name
  const subject = name ?? 'That card'
  switch (r.reason.kind) {
    case 'color-identity':
      return `${subject} was not added — it is outside your commander's colour identity.`
    case 'not-singleton':
      return `${subject} was not added — it is already in the deck, and Commander allows one copy.`
    case 'banned':
      return `${subject} was not added — it is banned in Commander.`
    case 'not-legal-in-commander':
      return `${subject} was not added — it is not legal in Commander.`
    case 'previously-excluded':
      // The one with a way out, so it says what the way out is (pillar P6 says
      // we never re-suggest it; it does not say the user may never change
      // their mind).
      return `${subject} was not added — you rejected it. Put it back from the Rejected list.`
    case 'unknown-card':
      return `${subject} was not added — it is not in the card corpus.`
    case 'is-commander':
      return `${subject} is your commander, so it cannot be added again.`
    case 'locked':
      return `${subject} is locked, so it was left alone. Unlock it first.`
    case 'not-in-deck':
      return `${subject} is not in the deck, so there was nothing to change.`
    case 'already-excluded':
      return `${subject} was already rejected.`
    case 'not-excluded':
      return `${subject} was not rejected, so there was nothing to restore.`
    default:
      return `${subject}: the server refused that (${humanise(r.reason.kind).toLowerCase()}).`
  }
}

/**
 * A whole batch's refusals, as the one line the banner shows. `null` for a
 * batch nothing was refused in — which is nearly every batch.
 *
 * The ONLY reader of `rejected`, and therefore the only place that has to
 * tolerate its absence. `undefined` arrives from a run with no commands in it,
 * and from a server that does not send the field; reading `.length` off it
 * threw inside the pipeline's apply callback, which is an uncaught exception on
 * a timer — nothing catches that, and it left the page part-way through a
 * recompute with no error on screen.
 *
 * Only the first, plus a count. A batch can be a whole import, and forty
 * sentences in a banner is a banner nobody reads: the first explains the SHAPE
 * of the problem and the count says how much of it there is.
 */
export const rejectionNotice = (
  rejected:
    | readonly { command: { type: string; oracleId?: string }; reason: { kind: string } }[]
    | undefined,
  cards: ReadonlyMap<string, api.Card>,
): string | null => {
  const list = rejected ?? []
  const first = list[0]
  if (first === undefined) return null
  const sentence = rejectionText(first, cards)
  return list.length === 1
    ? sentence
    : `${sentence} (${plural(list.length - 1, 'other card')} too.)`
}

/**
 * What a name-match row can actually do about this card.
 *
 * The "Cards named like…" list is the ONE place in the app that deliberately
 * shows cards which are not candidates for this deck. Giving every row a plain
 * Add would therefore give some of them a button that cannot work, and the
 * server's refusal would arrive after the optimistic overlay had already shown
 * the card landing in the deck. So the row decides up front what it can offer,
 * and says why when the answer is "nothing".
 *
 * This is NOT a second copy of the legality rules. The server stays the
 * authority and `rejectionText` reports anything this misses — a card banned
 * since the last ingest, say, which nothing on the client can know. What is
 * duplicated here is only the part that is cheap, local and certain: whether
 * the card is already in this deck, and whether its colour identity fits inside
 * the commander's. Getting either of those wrong costs a round trip and a
 * banner, not a wrong deck.
 *
 * Order matters. A rejected card that is also outside the identity reports the
 * identity, because that is the one the user cannot do anything about.
 */
export type NameMatchStatus = 'commander' | 'in-deck' | 'off-identity' | 'rejected' | 'addable'

export const nameMatchStatus = (
  card: { oracleId: string; colorIdentity: readonly string[] },
  deck: { commanders: readonly string[]; colorIdentity: readonly string[] },
  accepted: ReadonlySet<string>,
  excluded: ReadonlySet<string>,
): NameMatchStatus => {
  if (deck.commanders.includes(card.oracleId)) return 'commander'
  if (accepted.has(card.oracleId)) return 'in-deck'
  // Colour identity is a subset test, not an intersection: a card is legal iff
  // every colour it carries is one the commander carries (doc 02 §2.2).
  if (card.colorIdentity.some((c) => !deck.colorIdentity.includes(c))) return 'off-identity'
  if (excluded.has(card.oracleId)) return 'rejected'
  return 'addable'
}

/** The same, as the phrase the row shows beside the name. */
export const nameMatchNote = (
  status: NameMatchStatus,
  card: { colorIdentity: readonly string[] },
  deck: { colorIdentity: readonly string[] },
): string | null => {
  switch (status) {
    case 'commander':
      return 'your commander'
    case 'in-deck':
      return 'already in your deck'
    case 'off-identity': {
      const off = card.colorIdentity.filter((c) => !deck.colorIdentity.includes(c))
      // The offending letters, not just the verdict: "outside your colours" is
      // a conclusion, and {B} is the fact that produced it.
      return `outside your colour identity (${off.join('')})`
    }
    case 'rejected':
      return 'you rejected this — Add puts it back'
    case 'addable':
      return null
  }
}

/**
 * The name of a thing the server could not compute.
 *
 * `top-<type>` is a PLACEHOLDER the domain uses because the real key is one per
 * card type, and the "Not computed" list printed it literally — angle brackets
 * and all — as though it were the name of a feature. Mapped here rather than
 * renamed in `packages/domain`: the key is a contract (AGENTS.md R2) and it is
 * the right key, it was only ever the wrong thing to show a person.
 */
export const unavailableLabel = (key: string): string => {
  switch (key) {
    case 'top-<type>':
      return 'Most-played, by card type'
    case 'high-synergy':
      return 'High synergy'
    case 'statistics':
      return 'Play statistics'
    case 'combos':
      return 'Combo data'
    case 'dataset-snapshot':
      return 'Dataset snapshot'
    case 'bracket-assessment':
      return 'Bracket assessment'
    case 'commander-eligibility':
      return 'Commander eligibility'
    case 'commander-partnership':
      return 'Commander partnership'
    default:
      return humanise(key)
  }
}

/** A cut reason, in words. The badge never shows a bare kind. */
const cutText = (r: {
  kind: string
  dimension?: { role?: string; type?: string }
  over?: number
  manaValue?: number
  limit?: number
}): string => {
  switch (r.kind) {
    case 'role-over-target':
      return `${String(r.over ?? 0)} over on ${dimensionName(r.dimension ?? {})}`
    case 'curve-crowded':
      return `crowded at ${String(r.manaValue ?? 0)}`
    case 'no-combos':
      return 'no combo line'
    case 'no-synergy':
      return 'no synergy'
    case 'unknown-synergy':
      // Deliberately not "no synergy": we derived no tags for this card, which
      // is a statement about our reading of it, not about the card.
      return 'synergy unknown'
    case 'over-budget':
      return `over $${String(r.limit ?? 0)}`
    default:
      return r.kind
  }
}

/** Hover help for the composition filter, spelled out rather than implied. */
const HIDE_SETTLED_HELP =
  'A role disappears from this list once every card in it is locked — there is ' +
  'nothing left to decide there. Tick this to also hide roles that already meet ' +
  'their target but are not locked yet, so only the roles still missing cards remain.'

const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? '' : 's'}`

/**
 * A reason, said in words. The UI never shows a bare reason kind.
 *
 * `near-combo` takes its count from the recommendation rather than the reason:
 * the domain emits `combos: []` for it deliberately (`recommend.ts`), since
 * listing the ids for every near miss would cost far more than the count, and
 * the count is what the row needs. Reading the empty array instead printed
 * "1 card away from 0 combos", which is worse than saying nothing.
 */
const reasonText = (r: api.Reason, item: api.Recommendation): string => {
  switch (r.kind) {
    case 'completes-combos':
      return `completes ${plural(r.combos?.length ?? item.comboDegree, 'combo')}`
    case 'near-combo':
      return `one card from ${plural(item.nearCombosAt1, 'combo')}`
    case 'fills-deficit':
      // Two different claims, and pillar P4 says the reason has to make the one
      // that is true. A card suggested against a number the builder typed is
      // being suggested on their authority, not the archetype's, and reading
      // "fills ramp gap" there hides the fact that THEY chose the gap — which
      // is exactly the thing they would want to re-examine when the suggestions
      // look wrong.
      return r.source === 'custom'
        ? `fills the ${dimensionName(r.dimension ?? {})} target you set`
        : `fills ${dimensionName(r.dimension ?? {})} gap`
    case 'curve-fit': {
      const mv = String(r.manaValue ?? 0)
      if (r.direction === 'short' && (r.delta ?? 0) > 0) {
        return `${plural(r.delta ?? 0, 'card')} short at ${mv}`
      }
      if (r.direction === 'over' && (r.delta ?? 0) < 0) {
        return `${plural(-(r.delta ?? 0), 'card')} too many at ${mv}`
      }
      return `curve fit at ${mv}`
    }
    case 'keyword-synergy': {
      // Said as a mechanism, not a score: "why" is what P4 asks the reason for.
      const tag = (r.tag ?? '').replace(/-/g, ' ')
      // Three directions, three different claims. 'theme' is the weak one —
      // the card wants what other cards in the deck want — and it says so
      // rather than borrowing the language of an enable.
      return r.direction === 'payoff'
        ? `benefits from your ${tag}`
        : r.direction === 'theme'
          ? `shares your ${tag} theme`
          : `enables your ${tag}`
    }
    case 'mana-fixing': {
      // The whole point of the reason: for a land, "fills a gap" is true of
      // every land, and what it taps for is the thing that tells them apart.
      const n = r.coloursCovered ?? 0
      const of = r.of ?? 0
      if (n === 0) return 'taps for colourless'
      if (of <= 1) return 'taps for your colour'
      return `taps for ${String(n)} of your ${String(of)} colours`
    }
    case 'corpus-inclusion':
      return 'played in similar decks'
    case 'top-by-type':
      return 'top by type'
    case 'bracket-warning':
      return 'bracket warning'
    default:
      return r.kind
  }
}

/**
 * The combo degree pip.
 *
 * The one genuinely hard-won number on the screen, so it gets the only brass.
 * Filled means the card completes a combo outright; outlined means it is one
 * card away; hollow means neither, and it is still shown so the absence reads
 * as a measured zero rather than missing data.
 */
/**
 * Which combos, not just how many.
 *
 * A number told you a card completed three combos and gave you no way to find
 * out which three — so the only way to check the app's headline claim was to go
 * looking for it elsewhere. Both the badge and the "completes N combos" reason
 * open the same list, because a reader will reach for whichever they are
 * nearest.
 *
 * Named from the client's own hydrated cards: every piece of a COMPLETED combo
 * is by definition already in the deck.
 */
const ComboList = ({
  combos,
  cards,
  lockedIds,
  self,
}: {
  combos: readonly api.Recommendation['combos'][number][]
  cards: ReadonlyMap<string, api.Card>
  lockedIds: ReadonlySet<string>
  self: string
}): React.JSX.Element => {
  if (combos.length === 0) return <span className="hint-line">No combo detail available.</span>
  return (
    <>
      {combos.slice(0, 6).map((c) => (
        <span className="hint-line" key={c.id}>
          <span className="combo-pieces">
            {c.pieces
              .filter((piece) => piece !== self)
              .map((piece) => (
                <span className="partner" data-locked={lockedIds.has(piece)} key={piece}>
                  {cards.get(piece)?.name ?? 'a card in your deck'}
                </span>
              ))}
          </span>
          <span className="combo-produces">{c.produces.join(', ')}</span>
        </span>
      ))}
      {combos.length > 6 ? (
        <span className="hint-line dim">and {combos.length - 6} more.</span>
      ) : null}
    </>
  )
}

const Degree = ({
  degree,
  near,
  combos = [],
  cards,
  lockedIds,
  self,
}: {
  degree: number
  near: number
  combos?: readonly api.Recommendation['combos'][number][]
  cards?: ReadonlyMap<string, api.Card>
  lockedIds?: ReadonlySet<string>
  self?: string
}): React.JSX.Element => {
  const value = degree > 0 ? degree : near
  const label =
    degree > 0
      ? `Completes ${String(degree)} combos`
      : near > 0
        ? `One card away from ${String(near)} combos`
        : 'No combos'

  const badge = (
    <span className="degree" data-completes={degree > 0} data-empty={value === 0}>
      {value === 0 ? '·' : value}
    </span>
  )

  // Nothing to open unless we actually hold the combos. A hint that says
  // "no detail" on every row would be worse than the plain badge.
  if (combos.length === 0 || cards === undefined) {
    return (
      <span className="degree-wrap" title={label} aria-label={label}>
        {badge}
      </span>
    )
  }

  return (
    <Hint
      className="degree-hint"
      label={label}
      content={
        <>
          <strong>{label}</strong>
          <ComboList
            combos={combos}
            cards={cards}
            lockedIds={lockedIds ?? new Set()}
            self={self ?? ''}
          />
        </>
      }
    >
      {badge}
    </Hint>
  )
}

/**
 * The two costs a card has: what it costs to cast, and what it costs to buy.
 *
 * Fixed-width columns so both read straight down the list rather than jittering
 * with each card's name length. Mana cost is drawn as symbols by `ManaCost`
 * (ADR-0015), which carries its own screen-reader text — the `title` that used
 * to be the only label here would not have survived that change.
 */
const Costs = ({
  manaCost,
  price,
}: {
  manaCost: string | null | undefined
  price: number | null | undefined
}): React.JSX.Element => (
  <>
    <span className="mana">
      <ManaCost cost={manaCost} />
    </span>
    <span className="cash" title="Cheapest printing — an estimate">
      {usd(price)}
    </span>
  </>
)

const CardRow = ({
  card,
  item,
  actions,
}: {
  card: api.Card | undefined
  item?: api.Recommendation
  actions: { label: string; kind: string; onClick: () => void }[]
}): React.JSX.Element => {
  const degree = item?.comboDegree
  const near = item?.nearCombosAt1
  const reasons = item?.reasons
  return (
    <div className="card-row">
      {degree !== undefined ? <Degree degree={degree} near={near ?? 0} /> : null}
      <span className="name">
        {card?.name ?? 'Loading…'}
        {reasons !== undefined && reasons.length > 0 ? (
          <span className="reasons">
            {reasons.map((r, i) => (
              <span className="reason" data-kind={r.kind} key={i}>
                {item === undefined ? r.kind : reasonText(r, item)}
              </span>
            ))}
          </span>
        ) : null}
      </span>
      <span className="cost">
        <ManaCost cost={card?.manaCost} />
      </span>
      {actions.map((a) => (
        <button
          key={a.label}
          className={`act ${a.kind}`}
          onClick={a.onClick}
          aria-label={card === undefined ? a.label : `${a.label} ${card.name}`}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Deck sections, in the order the rail shows them.
 *
 * `enchantment` and `other` are here although they were not asked for: the
 * domain has eight card types, and without them every enchantment would vanish
 * from the rail — a silent drop, which is the one thing this codebase will not
 * do. `other` catches Battles and anything a future set invents.
 */
const DECK_SECTIONS = [
  { key: 'commander', label: 'Commander' },
  { key: 'planeswalker', label: 'Planeswalkers' },
  { key: 'creature', label: 'Creatures' },
  { key: 'sorcery', label: 'Sorceries' },
  { key: 'instant', label: 'Instants' },
  { key: 'enchantment', label: 'Enchantments' },
  { key: 'artifact', label: 'Artifacts' },
  { key: 'land', label: 'Lands' },
  { key: 'other', label: 'Other' },
] as const

/**
 * One home per card, most-specific first.
 *
 * An Artifact Creature is both; decklists file it under Creatures, so Creature
 * wins. Land wins outright because a creature-land is counted as a land by
 * everyone. Mirrors `ROLE_PRECEDENCE` in the domain, for the same reason.
 */
const SECTION_PRECEDENCE = [
  'land',
  'creature',
  'planeswalker',
  'artifact',
  'enchantment',
  'instant',
  'sorcery',
] as const

const sectionOf = (card: Card | undefined): string => {
  if (card === undefined) return 'other'
  for (const type of SECTION_PRECEDENCE) {
    if (card.types.includes(type)) return type
  }
  return 'other'
}

const ARCHETYPES = [
  'aggro',
  'midrange',
  'control',
  'combo',
  'ramp',
  'aristocrats',
  'voltron',
  'tokens',
  'stax',
]

const Start = ({ onCreated }: { onCreated: (deck: api.Deck) => void }): React.JSX.Element => {
  const [term, setTerm] = useState('')
  /**
   * What was actually searched for, as opposed to what is typed.
   *
   * The two were the same thing when every keystroke fired a request. They are
   * separate now because the search is committed — by the countdown, by the
   * button, or by Enter — which is the same arrangement the suggestion filter
   * uses, and for the same reason: a search is expensive and half a commander's
   * name is not a question worth asking.
   */
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<api.Card[]>([])
  /**
   * Art for the search results, keyed by oracle id.
   *
   * Only the chosen commander is drawn from it — eight thumbnails in a result
   * list would be eight images fetched to answer a question the names already
   * answer — but it is kept for the whole page of results because the choice
   * happens from that page and re-fetching on click would put a blank frame
   * where the confirmation is supposed to be.
   */
  const [resultImages, setResultImages] = useState<Map<string, api.ImageUris>>(new Map())
  const [chosen, setChosen] = useState<api.Card | null>(null)
  /**
   * What the search is doing, so the box is never silently empty.
   *
   * "Nothing on screen" was the same picture for four different situations:
   * still typing, request in flight, no matches, and the API failing. That is
   * how an empty database presents as a broken text box — there is nothing to
   * read and nothing to try next.
   */
  const [search, setSearch] = useState<'idle' | 'searching' | 'done' | 'failed'>('idle')
  const [searchError, setSearchError] = useState<string | null>(null)
  const [archetype, setArchetype] = useState('midrange')
  const [bracket, setBracket] = useState(3)
  const [noUB, setNoUB] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /*
   * No countdown here. The commander search is committed by Enter or by the
   * button, and by nothing else.
   *
   * This screen ran the same two-second auto-query the suggestion filter has,
   * and it behaved badly for the reason the two screens differ: a commander
   * name is long and is typed in bursts, so the countdown expired mid-name
   * over and over. Each expiry fired a search for a PREFIX, and because the
   * result list below was never cleared, the page then showed a full list of
   * matches for "Kren" while the box said "Krenko, Mob" — an answer to a
   * question the user had already moved past, indistinguishable from an answer
   * to the one they were asking.
   *
   * The suggestion filter keeps the countdown (it is a short query language,
   * and the box is beside the list it filters). Here it is removed rather than
   * defaulted off: there is no setting on this screen, so an off-by-default
   * checkbox would have nowhere to live and the landing page would be the one
   * place the preference could not be honoured.
   */

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([])
      setSearch('idle')
      setSearchError(null)
      return
    }
    let cancelled = false
    setSearch('searching')
    /*
     * Drop the previous query's matches before asking for the next.
     *
     * Kept, they made the list read as the answer to whatever is in the box
     * now. The button carries the spinner, so an empty list during the request
     * is not a silent state — and `search === 'done'` gates the "Nothing found"
     * line, so an in-flight search cannot flash it either.
     */
    setResults([])
    setResultImages(new Map())
    void api
      /*
       * `is:commander`, not `type:legendary type:creature`.
       *
       * The old pair was both too narrow and too wide. Too narrow: Rowan
       * Kenrith and the twenty other planeswalkers whose text says they can
       * lead a deck were unreachable, as were Backgrounds. Too wide: the type
       * filter is a substring test over the whole line, so Westvale Abbey —
       * `Land // Legendary Creature — Demon` — was offered as a commander, and
       * so were ten `Invasion of …` battles.
       *
       * `is:commander` reads the flag the ingest derives, so this list and the
       * server's 422 are the same rule and cannot disagree.
       */
      .searchCards(`${query} is:commander`, {
        excludeUniversesBeyond: noUB,
      })
      .then((r) => {
        if (cancelled) return
        setResults(r.items)
        // `?? {}` because a server from before ADR-0021 does not send this, and
        // the page has to keep working against one — with no art, not with a
        // crash on a property of undefined.
        setResultImages(new Map(Object.entries(r.images ?? {})))
        setSearch('done')
        setSearchError(null)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        // Surfaced, not swallowed. The old version discarded the error and
        // rendered an empty list, so an unreachable or empty API looked
        // exactly like a commander that does not exist.
        setResults([])
        setResultImages(new Map())
        setSearch('failed')
        setSearchError(e instanceof Error ? e.message : 'Could not reach the card search')
      })
    return () => {
      cancelled = true
    }
  }, [query, noUB])

  const create = (): void => {
    if (chosen === null) return
    setBusy(true)
    setError(null)
    void api
      .createDeck({
        name: `${chosen.name} deck`,
        commanders: [chosen.oracleId],
        targetBracket: bracket,
        archetype,
        excludeUniversesBeyond: noUB,
      })
      .then(onCreated)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Could not create the deck')
        setBusy(false)
      })
  }

  return (
    <>
      {/* The same wordmark, in the same corner, as the workspace masthead.
          Arriving at a page with no name on it and then finding one after the
          first click reads as two different products. */}
      <header className="start-masthead">
        <h1 className="wordmark">
          Lotus <span>Wizard</span>
        </h1>
      </header>
      <div className="start">
        {/* h2, not h1: the wordmark above is the page's heading, exactly as it
            is in the workspace. Two h1s would be two answers to "what is this
            page". */}
        <h2>Build a Commander deck around combos and synergies</h2>
        <p>Pick a commander to begin.</p>

        <div className="field">
          <label htmlFor="commander">Commander</label>
          <div className="filter-bar">
            <input
              id="commander"
              type="text"
              value={chosen?.name ?? term}
              placeholder="Search cards that can lead a deck…"
              onChange={(e) => {
                setChosen(null)
                setTerm(e.target.value)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setQuery(term)
              }}
            />
            {/* `remaining={null}`: nothing counts down here, so the button is
                a magnifying glass and never a ring. */}
            <SearchButton
              what="search"
              onRun={() => setQuery(term)}
              remaining={null}
              restartKey={term}
              busy={search === 'searching'}
            />
          </div>
        </div>

        {chosen === null ? (
          <div className="start-results">
            {/* No "searching…" line here: the button IS the spinner, and saying
              it in two places is one place too many. */}
            {search === 'failed' ? (
              <p className="problem">
                {searchError} — the card search is not answering, so no commander can be picked yet.
              </p>
            ) : null}

            {search === 'done' && results.length === 0 ? (
              <p className="problem">
                Nothing found.
                <span className="note">
                  {' '}
                  No card that can be a commander matches “{query}”.
                  {noUB ? ' Universes Beyond cards are excluded — try unchecking that.' : ''}
                </span>
              </p>
            ) : null}

            {/*
             * The results stay text rows, deliberately.
             *
             * Eight art crops here would be eight image requests to help pick
             * between candidates that are already distinguished by the thing
             * the reader typed — a name. Art earns its space at the moment the
             * choice is MADE, below, where there is one card and getting it
             * wrong means building a deck around the wrong legend.
             */}
            {results.slice(0, 8).map((c) => (
              <CardRow
                key={c.oracleId}
                card={c}
                actions={[{ label: 'Choose', kind: 'accept', onClick: () => setChosen(c) }]}
              />
            ))}
          </div>
        ) : (
          /*
           * The commander, as a card, once one is chosen.
           *
           * "Krenko" is four different legends and "Kenrith" is two; a name in
           * a text field does not confirm which one this deck is being built
           * around, and every later screen assumes the choice was right. The
           * card face answers it at a glance, and `CardFace` carries the
           * fallback for a commander with no art rather than leaving a hole.
           *
           * No `onActivate`: there is nothing to open here, so the frame is not
           * a button and does not take focus.
           */
          <div className="start-chosen">
            <CardFace card={cardView(chosen, undefined, resultImages.get(chosen.oracleId))} />
            <p className="note">
              Building around <strong>{chosen.name}</strong>. Search again to change it.
            </p>
          </div>
        )}

        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="archetype">Archetype</label>
            <select id="archetype" value={archetype} onChange={(e) => setArchetype(e.target.value)}>
              {ARCHETYPES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="bracket">Bracket</label>
            <select
              id="bracket"
              value={bracket}
              onChange={(e) => setBracket(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5].map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="check">
          <input type="checkbox" checked={noUB} onChange={(e) => setNoUB(e.target.checked)} />
          Exclude Universes Beyond cards
        </label>

        <button
          className="primary"
          disabled={chosen === null || busy}
          onClick={create}
          // A disabled button with no explanation is a dead end. This one is
          // disabled for exactly one reason, so it can say so.
          title={chosen === null ? 'Pick a commander first' : 'Create this deck'}
        >
          {busy ? 'Creating…' : 'Start building'}
        </button>
        {chosen === null ? <p className="note">Pick a commander to continue.</p> : null}
        {error !== null ? <p className="problem">{error}</p> : null}
      </div>
    </>
  )
}

/** Cards the deck holds, collapsed to one row per card with a count. */
interface DeckLine {
  oracleId: string
  copies: number
}

/**
 * What this card is keyed to, and what that pairs with.
 *
 * The scoring already reasons in these events — `enables your sacrifice fodder`
 * is a reason it gives — but they were only ever visible as the conclusion, one
 * tag at a time. This is the whole set, on the card itself.
 *
 * `produces` and `wants` are kept apart because the difference is the entire
 * model: a sacrifice outlet PRODUCES creature-death, a death trigger WANTS it,
 * and a list that merged them would say both cards were "about" the same thing
 * while hiding that one is the other's answer.
 */
/*
 * The table itself now lives in `./tags`, because the deck web (doc 17) names
 * the same events in its edge descriptions and two vocabularies for one model
 * is how "a creature dying" here becomes "creature death" there.
 */

const TagChip = ({
  tag,
  direction,
}: {
  tag: string
  direction: 'produces' | 'wants'
}): React.JSX.Element => {
  const partners = interactsWith(tag as SynergyTag)
  const opposite = direction === 'produces' ? 'wants' : 'produces'
  return (
    <Hint
      className="tag-hint"
      content={
        <>
          <strong>{readable(tag)}</strong>
          <span className="hint-line">
            {direction === 'produces'
              ? `This card causes it. It pairs with cards that benefit from ${readable(tag)}.`
              : `This card benefits from ${readable(tag)}. It pairs with cards that cause it.`}
          </span>
          {partners.length === 0 ? null : (
            <span className="hint-line">
              Benefits, and benefits from: {partners.map(readable).join(', ')}.
            </span>
          )}
          {/* The tag is a filter field as well as a label, and nothing else on
              screen says so. Both spellings are given because both work, and
              because `tag:` — either side — is usually what someone reading a
              chip actually wants. */}
          <span className="hint-line">
            Filter by it:{' '}
            <code>
              {direction}:{tag}
            </code>
            , or <code>tag:{tag}</code> for cards on either side.
          </span>
          <span className="hint-line dim">
            Derived from the rules text, so it is sometimes wrong — {opposite} is the other half of
            the same question.
          </span>
        </>
      }
    >
      <span className="tag" data-direction={direction}>
        {tag.replace(/-/g, ' ')}
      </span>
    </Hint>
  )
}

const Semantics = ({
  produces,
  wants,
}: {
  produces: readonly string[]
  wants: readonly string[]
}): React.JSX.Element => {
  if (produces.length === 0 && wants.length === 0) {
    // Half the corpus derives no tags at all (ADR-0013). Saying so beats an
    // empty heading, which would read as "this card interacts with nothing".
    return (
      <>
        <h4>Semantics</h4>
        <p className="note">
          None derived. Our rules-text reading misses about half of Magic, so this is a gap in what
          we can see rather than a card that does nothing.
        </p>
      </>
    )
  }
  return (
    <>
      <h4>Semantics</h4>
      {produces.length > 0 ? (
        <p className="tags">
          <span className="tags-label">Causes</span>
          {produces.map((t) => (
            <TagChip key={t} tag={t} direction="produces" />
          ))}
        </p>
      ) : null}
      {wants.length > 0 ? (
        <p className="tags">
          <span className="tags-label">Benefits from</span>
          {wants.map((t) => (
            <TagChip key={t} tag={t} direction="wants" />
          ))}
        </p>
      ) : null}
    </>
  )
}

/**
 * Who this card actually works with, in the deck the user has.
 *
 * The preview already said "in 114 combos" and "causes: token", both of which
 * are facts about the card in the abstract. Neither answers the question a
 * person opens a preview to ask, which is "does this do anything for MY deck".
 *
 * Everything here is computed on the client. The deck, the hydrated cards and
 * their synergy tags are all already in memory, and the combo pieces arrive
 * named with the card detail — so opening a preview costs one request and the
 * answer is drawn from what is already known, rather than a second round trip.
 */
interface Partner {
  readonly oracleId: string
  readonly name: string
  readonly locked: boolean
  /** Not in the deck — the piece you would have to add. */
  readonly missing?: boolean
  readonly why?: string
}

const PartnerName = ({ p }: { p: Partner }): React.JSX.Element => (
  <span
    className="partner"
    data-locked={p.locked}
    data-missing={p.missing === true}
    title={
      p.missing === true
        ? `${p.name} is not in your deck yet`
        : p.locked
          ? `${p.name} — locked`
          : p.name
    }
  >
    {p.name}
    {p.why === undefined ? null : <span className="partner-why"> {p.why}</span>}
  </span>
)

const Works = ({
  detail,
  accepted,
  lockedIds,
  cards,
}: {
  detail: api.CardDetail
  accepted: ReadonlySet<string>
  lockedIds: ReadonlySet<string>
  cards: ReadonlyMap<string, api.Card>
}): React.JSX.Element | null => {
  const self = detail.oracleId

  const partner = (oracleId: string, name: string | null, why?: string): Partner => ({
    oracleId,
    name: name ?? cards.get(oracleId)?.name ?? 'Unknown card',
    locked: lockedIds.has(oracleId),
    missing: !accepted.has(oracleId),
    ...(why === undefined ? {} : { why }),
  })

  // Combos this card completes with cards already accepted.
  const assembled: Partner[] = []
  // Combos needing exactly one more card — the near miss worth showing.
  const oneAway: { readonly needs: Partner; readonly with: readonly Partner[] }[] = []

  for (const combo of detail.combos) {
    const others = combo.pieces.filter((p) => p.oracleId !== self)
    if (others.length === 0) continue
    const missing = others.filter((p) => !accepted.has(p.oracleId))
    if (missing.length === 0) {
      for (const p of others) assembled.push(partner(p.oracleId, p.name))
    } else if (missing.length === 1 && oneAway.length < 6) {
      const need = missing[0]!
      oneAway.push({
        needs: partner(need.oracleId, need.name),
        with: others
          .filter((p) => p.oracleId !== need.oracleId)
          .map((p) => partner(p.oracleId, p.name)),
      })
    }
  }

  // Deck cards whose synergy tags pair with this card's, strongest first.
  const produces = new Set(detail.synergyProduces)
  const wants = new Set(detail.synergyWants)
  const synergy: Partner[] = []
  for (const oracleId of accepted) {
    if (oracleId === self) continue
    const other = cards.get(oracleId)
    if (other === undefined) continue
    const benefits = other.synergyWants.filter((t) => produces.has(t))
    const causes = other.synergyProduces.filter((t) => wants.has(t))
    const tag = benefits[0] ?? causes[0]
    if (tag === undefined) continue
    // Said of the OTHER card, in the same two words the Semantics headings use.
    // "wants creature death" was the odd one out and the vaguest of the three.
    synergy.push(
      partner(
        oracleId,
        other.name,
        `— ${benefits[0] !== undefined ? 'benefits from' : 'causes'} ${tag.replace(/-/g, ' ')}`,
      ),
    )
  }

  const dedupe = (list: readonly Partner[]): Partner[] => {
    const seen = new Set<string>()
    return list.filter((p) => (seen.has(p.oracleId) ? false : (seen.add(p.oracleId), true)))
  }
  const combosWith = dedupe(assembled).slice(0, 8)
  // Locked first: those are cards the user has committed to, so a pairing with
  // one is worth more than a pairing with a card they may still cut.
  const synergyWith = dedupe(synergy)
    .sort((a, b) => Number(b.locked) - Number(a.locked))
    .slice(0, 8)

  if (combosWith.length === 0 && oneAway.length === 0 && synergyWith.length === 0) return null

  return (
    <>
      <h4>Works with your deck</h4>

      {combosWith.length > 0 ? (
        <p className="partners">
          <span className="partners-label">Combos with</span>
          {combosWith.map((p) => (
            <PartnerName key={p.oracleId} p={p} />
          ))}
        </p>
      ) : null}

      {combosWith.length === 0 && oneAway.length > 0 ? (
        <>
          <p className="partners-note">
            No combo assembled yet — these need one more card, shown in rust:
          </p>
          {oneAway.map((line) => (
            <p className="partners" key={line.needs.oracleId}>
              <PartnerName p={line.needs} />
              {line.with.length === 0 ? null : (
                <>
                  <span className="partners-label">with</span>
                  {line.with.map((p) => (
                    <PartnerName key={p.oracleId} p={p} />
                  ))}
                </>
              )}
            </p>
          ))}
        </>
      ) : null}

      {synergyWith.length > 0 ? (
        <p className="partners">
          <span className="partners-label">Synergises with</span>
          {synergyWith.map((p) => (
            <PartnerName key={p.oracleId} p={p} />
          ))}
        </p>
      ) : null}
    </>
  )
}

/**
 * The width at which `.workspace` collapses to a single column.
 *
 * Duplicated from `styles.css` on purpose and pinned by `sheet.test.tsx`: the
 * sheet's box is CSS and its focus behaviour is JavaScript, and a viewport
 * where only one of the two believes it is narrow is worse than either — a
 * panel that grabs focus but never appears, or one that appears and cannot be
 * reached.
 */
export const SINGLE_COLUMN = '(max-width: 900px)'

/** Whether the workspace is currently stacked into one column. */
const useSingleColumn = (): boolean => {
  const [narrow, setNarrow] = useState(() => window.matchMedia(SINGLE_COLUMN).matches)
  useEffect(() => {
    const mq = window.matchMedia(SINGLE_COLUMN)
    const onChange = (): void => setNarrow(mq.matches)
    // Read once more here, not just in the initialiser: a rotate between the
    // first render and this effect would otherwise leave the flag stale until
    // the next resize, and phones rotate during load more often than desktops
    // are resized at all.
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return narrow
}

/**
 * The widest card the preview can draw without overflowing its column.
 *
 * `CardFace` sets width AND height inline to reserve the box before the art
 * loads, so a stylesheet cannot cap it — `max-width` clips the width and leaves
 * the inline height, which stretches the card. The container has to be measured
 * and a width it can honour passed in.
 *
 * The analysis rail is a resizable column, not a fixed one, so `ResizeObserver`
 * rather than a breakpoint: dragging the divider has to move the picture too.
 */
const Preview = ({
  card,
  detail,
  price,
  images,
  onClose,
  accepted,
  lockedIds,
  cards,
  sheet,
}: {
  /** The hydrated card, already in memory. Everything readable comes from here. */
  card: api.Card | undefined
  /** Printings and combos. Arrives second; the panel does not wait for it. */
  detail: api.CardDetail | null
  price: number | null | undefined
  /** Art for the default printing. Absent when it has none resolved. */
  images: api.ImageUris | undefined
  onClose: () => void
  accepted: ReadonlySet<string>
  lockedIds: ReadonlySet<string>
  cards: ReadonlyMap<string, api.Card>
  /**
   * The workspace is one column, so this panel is a bottom sheet over the feed
   * rather than the top of the right-hand rail.
   */
  sheet: boolean
}): React.JSX.Element | null => {
  // `detail` is the fallback, not the source: a card reached from somewhere that
  // never hydrated it still previews once its detail lands.
  const shown = card ?? detail
  // L3 "Detail", not L2 "Card". Doc 07 sizes L2 for "12-24 cards" on screen and
  // L3 for "one", and this panel shows exactly one — the card being decided
  // about. It was on L2 and on the wrong half of it: `sheet` is true only on
  // the narrow single-column layout, so the phone got the 220 px desktop width
  // and the desktop got the 160 px `mobileWidth`. The picture was smaller on
  // the bigger screen.
  const shownId = shown?.oracleId ?? null
  const ref = useRef<HTMLElement>(null)

  /*
   * Read `sheet` through a ref inside the focus effect.
   *
   * Crossing the breakpoint — a rotate, a dragged window edge — must not by
   * itself move focus; only opening a card may. Putting `sheet` in the effect's
   * dependency list would yank focus into the panel the moment a phone turned
   * sideways, which is exactly the sort of surprise that makes people distrust
   * a page.
   */
  const sheetRef = useRef(sheet)
  useEffect(() => {
    sheetRef.current = sheet
  }, [sheet])

  /*
   * Bring focus into the sheet as it appears, and again when a different card
   * replaces the one it is showing.
   *
   * On the rail this would be theft — the panel is already on screen beside
   * what the user was reading — so it is confined to the sheet, where the panel
   * has just covered the bottom of the viewport and is the thing they asked for.
   */
  useEffect(() => {
    if (shownId === null || !sheetRef.current) return
    ref.current?.focus()
  }, [shownId])

  /*
   * Escape closes it, at every width.
   *
   * It used to be bound only when `sheet` was true, which was defensible while
   * the panel was a block at the top of the rail: it covered nothing, so there
   * was nothing to dismiss. It is an OVERLAY over the suggestion feed now, and
   * a thing that covers your work has to have a keyboard way out — the Close
   * button is a tab away from wherever you are, and Escape is the key everybody
   * already presses.
   *
   * Bound to the document rather than to the panel because it is deliberately
   * not modal: nothing behind it is inert, so focus can legitimately be outside
   * it when the user gives up on it.
   */
  useEffect(() => {
    if (shownId === null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [shownId, onClose])

  if (shown === null || shown === undefined) return null
  /*
   * Art and price, from the hydration maps FIRST and the detail's printings
   * second.
   *
   * The maps only hold cards in the deck or in the current suggestion feed, so
   * a card reached from "Cards named like…" — the one route that deliberately
   * shows cards that are NOT candidates — had no entry in either and previewed
   * with no image and a bare em dash, directly under a line saying it had 53
   * printings. The detail was already in hand and already being counted; it
   * simply was never read for anything else.
   *
   * The maps stay first because they are the answer the rest of the app agrees
   * with: `images` is the DEFAULT printing (ADR-0021) and `prices` is the
   * server's own cheapest, so a hydrated card must not change appearance or
   * price the moment its detail lands.
   */
  const printings = detail?.printings ?? []
  // `viewImageUris` is the test for "is there art here at all": a hydrated
  // entry with both members null is a card whose DEFAULT printing has no
  // resolved art, and falling through to the printings is what gives it a
  // picture when a non-default printing has one.
  const art = viewImageUris(images) === undefined ? artFromPrintings(printings) : images
  const shownPrice = price ?? cheapestPrinting(printings)
  // Built once and read twice — the face draws from it, and the note line asks
  // it whether there is a face at all before deciding where the price goes.
  const view = cardView(shown, shownPrice, art)
  return (
    <aside
      ref={ref}
      className={sheet ? 'preview preview-sheet' : 'preview'}
      aria-label={`${shown.name} details`}
      /*
       * `dialog`, but never `aria-modal`. The sheet covers the lower part of a
       * phone screen and leaves the candidate feed above it live and tappable,
       * so claiming the rest of the page is inert would be a lie to a screen
       * reader — and a focus trap on top of that lie would strand anyone who
       * wanted the list back.
       */
      role={sheet ? 'dialog' : undefined}
      tabIndex={sheet ? -1 : undefined}
    >
      <div className="preview-head">
        <h3>{shown.name}</h3>
        <button className="act" onClick={onClose} aria-label="Close preview">
          Close
        </button>
      </div>
      <p className="type-line">
        {shown.typeLine}
        {shown.manaCost === null ? null : (
          <span className="cost">
            <ManaCost cost={shown.manaCost} />
          </span>
        )}
        {/* Power/toughness for a creature, loyalty for a planeswalker. Printed
            as text because Magic prints `*` and `1+*`, and a card whose power
            is `*` has a power — it is simply not a number.

            `??` and not `!== null`: a card hydrated before this field existed
            has `undefined`, which is not null and so passed the old guard —
            rendering an empty box with a lone slash in it. */}
        {(shown.power ?? null) !== null && (shown.toughness ?? null) !== null ? (
          <span className="pt" aria-label={`power ${shown.power}, toughness ${shown.toughness}`}>
            {shown.power}/{shown.toughness}
          </span>
        ) : (shown.loyalty ?? null) !== null ? (
          <span className="pt" aria-label={`starting loyalty ${shown.loyalty}`}>
            {shown.loyalty}
          </span>
        ) : null}
      </p>
      {/*
       * The card itself, at L2, through the primitive that owns that level.
       *
       * This is the one surface in the workspace where art earns its space
       * outright: it shows one card, it is where somebody decides whether this
       * is the Krenko they meant, and half of that question — the art, the
       * frame, the set symbol — is answered by looking rather than by reading.
       *
       * Only when there IS art, which is the one place this deliberately does
       * not use `CardFace`'s no-art fallback. That fallback is a card-shaped
       * panel carrying the name, the cost, the type line and the rules text,
       * which is exactly right in a grid where nothing else says them — and
       * exactly wrong here, where the panel around it says all four already.
       * Nothing is lost by omitting it: a card with no art still reads in full.
       *
       * The badge row comes with the primitive, and its price is why the note
       * below drops the number when the face is on screen.
       *
       * Width: the L2 nominal 220 px only fits the sheet. The rail is
       * `minmax(230px, 1fr)` and at its floor leaves about 168 px inside the
       * region, the scroll gutter and the panel's own padding — so the rail
       * gets the narrow-column width from `presentation.ts`. It is named
       * `mobileWidth` because that is where a narrow column usually comes from;
       * a 230 px rail is the same narrow column on a wider screen.
       */}
      {view.imageUris === undefined ? null : (
        <div className="preview-art">
          {/*
            L3 "Detail", not L2 "Card".
             
            Doc 07 sizes L2 for "12-24 cards" on screen and L3 for "one", and
            this panel shows exactly one — the card you are deciding about. It
            was on L2 and, worse, on the wrong half of it: `sheet` is true only
            on the narrow single-column layout, so the phone got the 220 px
            desktop width and the desktop got the 160 px `mobileWidth`. The
            picture was smaller on the bigger screen.
          */}
          <CardFace card={view} width={levelSpec(3).width} />
        </div>
      )}
      {/* Oracle text is the card. Newlines are meaningful — they separate
          abilities — and the faces are meaningful too, so both are handed to
          the component: it spaces the abilities and rules a line between the
          faces. `oracleTextFaces` is absent for a single-faced card and for one
          ingested before the field existed, which both render as one face.

          Repeated here although the image above shows it, for the reason L3
          repeats it and L2 does not: an image cannot be selected, translated,
          resized or read aloud, and this is the panel where someone is reading
          rather than scanning. */}
      <p className="oracle">
        <OracleText text={shown.oracleText} faces={shown.oracleTextFaces} />
      </p>
      <p className="note">
        {/* ADR-0009 Q7: a price is an estimate and the interface has to say so.
            The number moves to the card's badge row when there is a card face
            above to carry it — the same figure twice in one small panel is
            noise — and comes back here when there is not, because the price
            must never be the thing that goes missing.

            What this line adds either way is WHICH printing the estimate is
            for. The art above is the default printing and the price is the
            cheapest one, and for about a third of the corpus those are two
            different cards (ADR-0021). */}
        {view.imageUris === undefined ? `${usd(shownPrice)} ` : ''}
        <span className="estimate">est.</span>{' '}
        {detail === null
          ? 'cheapest printing'
          : `cheapest of ${String(detail.printings.length)} printing${detail.printings.length === 1 ? '' : 's'}`}
        {shown.universesBeyond ? ' · Universes Beyond' : ''}
      </p>
      {detail !== null && detail.combos.length > 0 ? (
        <>
          <h4>In {plural(detail.combos.length, 'combo')}</h4>
          <p className="note">
            {[...new Set(detail.combos.flatMap((c) => c.produces))].slice(0, 6).join(', ')}
          </p>
        </>
      ) : null}

      {detail === null ? (
        <p className="note">Looking up combos…</p>
      ) : (
        <Works detail={detail} accepted={accepted} lockedIds={lockedIds} cards={cards} />
      )}

      <Semantics produces={shown.synergyProduces} wants={shown.synergyWants} />
    </aside>
  )
}

/* ------------------------------------------------------------ bracket check */

/**
 * The bracket surface (doc 03 §3.2, ADR-0018).
 *
 * Wizards publishes a per-bracket number for ONE of the five bracket
 * barometers — Game Changers. The tutor restriction was withdrawn in October
 * 2025, and mass land denial, extra turns and two-card infinites are named in
 * prose with no permitted/forbidden value. So `assessed` is null and will stay
 * null, and nothing here may render a verdict.
 *
 * That leaves two ways to be wrong, and both were rejected:
 *
 *   "Bracket 3 ✓"  — a lie. It would report one fifth of a check as the whole.
 *   nothing at all — throws away the fifth that IS checkable, and leaves the
 *                    Bracket selector on the landing page still doing nothing.
 *
 * What is drawn instead is arithmetic and an absence, side by side: the count
 * the deck holds over the allowance the source publishes, then the four
 * barometers BY NAME each marked as having no rule to check against. The four
 * are rendered from the server's own nulls rather than from a list in this
 * file — a client-side table of barometers would be the retired ruleset
 * AGENTS.md §8 rejects, and would keep saying "no published rule" for a
 * barometer Wizards had since published.
 *
 * Every claim opens (P4): the count expands into the card names, each of which
 * opens the card; the allowance carries the URL it was read from and the date.
 */

/**
 * The four barometers, in the order the source names them.
 *
 * LABELS only. Every value is read from `rules.targetBracket`, so this list
 * cannot assert what any bracket permits — which is the point.
 */
const BAROMETERS = [
  { key: 'twoCardInfinites', label: 'Two-card infinites' },
  { key: 'extraTurnChaining', label: 'Extra turns' },
  { key: 'massLandDenial', label: 'Mass land denial' },
  { key: 'tutorDensity', label: 'Tutors' },
] as const

/**
 * What the target bracket allows, or `null` when we cannot say.
 *
 * Preference order matters. `rules.targetBracket` is the published entry and is
 * present whatever the deck holds. A violation names the allowance too, but
 * ONLY when the deck has broken it — reading it alone would leave a legal deck
 * able to say how many Game Changers it holds and not how many it may.
 *
 * There is deliberately no third fallback. A table of allowances in this file
 * is a rejected PR (AGENTS.md §8), and "0" would be a fabricated rule.
 */
const gameChangerAllowance = (bracket: api.BracketReport): number | 'unlimited' | null =>
  bracket.rules?.targetBracket?.gameChangersAllowed ?? bracket.violations?.[0]?.allowed ?? null

/** `Bracket 3 (Upgraded)`, or just `Bracket 3` when the name was not sent. */
const bracketNoun = (bracket: api.BracketReport): string => {
  const name = bracket.rules?.targetBracket?.name
  return name === undefined || name === null
    ? `Bracket ${String(bracket.target)}`
    : `Bracket ${String(bracket.target)} (${name})`
}

/**
 * The chip in the masthead.
 *
 * Doc 03 §3.2 asks the header chip to carry the overage. It carries the count
 * in every state, not only the failing one, because a chip that appears only
 * when something is wrong makes its own absence read as a pass — which is the
 * verdict this feature is not allowed to give.
 *
 * The over state is rust AND a marker glyph AND the numbers themselves. Rust
 * and sage are not separable under deuteranopia (`packages/ui/src/tokens.ts`),
 * so colour is never the only signal here.
 */
const BracketChip = ({
  bracket,
  onOpen,
}: {
  bracket: api.BracketReport
  onOpen: () => void
}): React.JSX.Element => {
  // `?? []` at every read: these arrive from the wire, where a server that
  // predates them omits them entirely. Reading `.length` off the absent one
  // threw and unmounted the whole app rather than just this chip.
  const held = (bracket.gameChangers ?? []).length
  const allowed = gameChangerAllowance(bracket)
  const over = (bracket.violations ?? []).length > 0

  const shown =
    bracket.rules === null
      ? 'NOT CHECKED'
      : allowed === null
        ? `${String(held)} GAME CHANGERS`
        : allowed === 'unlimited'
          ? `${String(held)} GAME CHANGERS · NO LIMIT`
          : `${String(held)}/${String(allowed)} GAME CHANGERS`

  // Spelled out rather than read as the abbreviation on screen: "3/3" is a
  // date to a screen reader, and "BRACKET" in capitals can be spelled letter
  // by letter.
  const spoken =
    bracket.rules === null
      ? 'the Game Changers check is unavailable'
      : allowed === null
        ? plural(held, 'Game Changer')
        : allowed === 'unlimited'
          ? `${plural(held, 'Game Changer')}, and this bracket sets no limit`
          : `${plural(held, 'Game Changer')} of ${String(allowed)} allowed`

  return (
    <button
      className="bracket-chip"
      data-over={over}
      onClick={onOpen}
      aria-label={`Bracket ${String(bracket.target)}: ${spoken}. Open the bracket check.`}
    >
      {over ? (
        <span className="bracket-mark" aria-hidden="true">
          !
        </span>
      ) : null}
      <span className="meta">
        BRACKET {bracket.target} · {shown}
      </span>
    </button>
  )
}

/**
 * The "Bracket check" panel in the analysis rail.
 *
 * `reason` is the server's own `bracket-assessment` sentence, not a paragraph
 * written here. Two copies of the same disclaimer drift, and the server's is
 * the one that changes when the check does — it also swaps itself for the
 * loader's error when the corpus carries no Game Changers, which is a
 * different missing thing and needs a different sentence.
 */
const BracketCheck = ({
  bracket,
  reason,
  cards,
  onInspect,
  open,
  onOpenChange,
  headingRef,
}: {
  bracket: api.BracketReport
  reason: string | undefined
  cards: ReadonlyMap<string, Card>
  onInspect: (oracleId: string) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  headingRef: React.RefObject<HTMLHeadingElement | null>
}): React.JSX.Element => {
  const held = (bracket.gameChangers ?? []).length
  const allowed = gameChangerAllowance(bracket)
  const published = bracket.rules?.targetBracket
  const toggleRef = useRef<HTMLButtonElement>(null)

  return (
    <div
      className="bracket-check"
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !open) return
        // Consumed here so the innermost open thing is the one that closes:
        // without this the same keypress also reaches the document listeners
        // that dismiss the deck menu and any pinned hint.
        e.stopPropagation()
        onOpenChange(false)
        // Focus would otherwise be left on a list item that no longer exists,
        // which drops a keyboard user back at the top of the document.
        toggleRef.current?.focus()
      }}
    >
      <h2 style={{ marginTop: '1.25rem' }} tabIndex={-1} ref={headingRef}>
        Bracket check
      </h2>

      {bracket.rules === null ? (
        <p className="note">
          The Game Changers allowance could not be read, so nothing is checked.
        </p>
      ) : (
        <>
          {/* The server's sentence, not one assembled here: it already reads
              "Bracket 3 (Upgraded) allows 3 Game Changers; this deck has 4."
              and re-deriving it would put the arithmetic in two places. */}
          {(bracket.violations ?? []).map((v) => (
            <p className="problem" key={v.flag}>
              {v.message}
            </p>
          ))}
          {(bracket.violations ?? []).length === 0 ? (
            <p className="note">
              {allowed === null
                ? `This deck holds ${plural(held, 'Game Changer')}.`
                : allowed === 'unlimited'
                  ? `${bracketNoun(bracket)} sets no limit on Game Changers; this deck holds ${String(held)}.`
                  : `${bracketNoun(bracket)} allows ${plural(allowed, 'Game Changer')}; this deck holds ${String(held)}.`}
            </p>
          ) : null}
        </>
      )}

      {/* "3 Game Changers" that cannot be expanded into WHICH three is an
          unopenable claim (P4). The list opens by default when the deck is
          over its allowance — a problem should arrive with its evidence. */}
      {held > 0 ? (
        <>
          <button
            className="bracket-toggle"
            ref={toggleRef}
            aria-expanded={open}
            aria-controls="bracket-changers"
            onClick={() => onOpenChange(!open)}
          >
            <span className="bracket-caret" aria-hidden="true">
              {open ? '▾' : '▸'}
            </span>
            {plural(held, 'Game Changer')} in this deck
          </button>
          {open ? (
            <ul className="bracket-changers" id="bracket-changers">
              {(bracket.gameChangers ?? []).map((id) => (
                <li key={id}>
                  <button className="as-link" onClick={() => onInspect(id)}>
                    {cards.get(id)?.name ?? id.slice(0, 8)}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {/*
       * The four-fifths that is not checkable, named rather than omitted.
       *
       * Rendered only when the published entry actually arrived. Drawing these
       * rows from an absent `targetBracket` would be asserting "no published
       * rule" from having received no data, which is the same mistake as
       * asserting a pass.
       */}
      {published === undefined || published === null ? null : (
        <ul className="bracket-barometers">
          {BAROMETERS.map(({ key, label }) => {
            const value = published[key]
            return (
              <li key={key}>
                <span className="bracket-barometer">{label}</span>
                <span className="bracket-nil">
                  {/* A value here would mean Wizards had published one — and
                      this app still has no check for it, so it says so rather
                      than letting a rule imply the deck was measured. */}
                  {value === null ? 'no published rule' : `${value}, not checked here`}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {reason === undefined ? null : (
        <p className="note bracket-why">
          {/* Joined with a dash, not a full stop: the server's reason is a
              sentence FRAGMENT and begins lower-case, so "No bracket assessed.
              only the Game Changers…" reads as a typo rather than a clause. */}
          <strong>No bracket assessed</strong> — {reason}
        </p>
      )}

      {bracket.rules === null ? null : (
        <p className="note bracket-source">
          Allowance read from{' '}
          <a href={bracket.rules.sourceUrl} target="_blank" rel="noreferrer">
            {hostOf(bracket.rules.sourceUrl)}
          </a>{' '}
          on {bracket.rules.retrievedAt}.
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------- what is in a bar */

/**
 * The cards behind one bar, counted by the SERVER'S OWN RULE.
 *
 * The trap this exists to avoid, measured before it was written: the count in
 * the bar and the list under the cursor have to agree, and the obvious
 * client-side filter makes them disagree in two different ways.
 *
 *   DUPLICATES. `countComposition` iterates `acceptedSet(deck)`, which is a
 *   `Set` of oracle ids — so thirty Mountains count ONCE. A filter over the
 *   deck's entries would list thirty rows beside a bar reading 1. `ids` is
 *   therefore the deduplicated set, and the caller passes `acceptedIds`, which
 *   is built the same way and includes the commanders exactly as `acceptedSet`
 *   does.
 *
 *   TWO DIMENSIONS AT ONCE. A composition dimension is a role OR a type, and a
 *   creature that ramps is counted under both — so a card can legitimately
 *   appear in two lists. `dimensionKeysOf` is imported from the domain rather
 *   than reimplemented here, for the reason `lockedByDimension` already gives:
 *   a second copy of the rule is a second answer to the same question.
 *
 * A card the client has not hydrated cannot be named, so it is omitted and the
 * caller reports the shortfall rather than quietly showing a shorter list.
 */
export const cardsInDimension = (
  ids: Iterable<string>,
  cards: ReadonlyMap<string, api.Card>,
  dimensionKey: string,
): readonly api.Card[] => {
  const out: api.Card[] = []
  for (const id of ids) {
    const card = cards.get(id)
    if (card === undefined) continue
    if (dimensionKeysOf(card).includes(dimensionKey)) out.push(card)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The same, for one mana-value bucket.
 *
 * Lands are excluded and bucket 7 is "7 or more", both because
 * `countComposition` does exactly that — the curve is a count of SPELLS, and a
 * deck's 36 lands at mana value 0 would otherwise be the tallest bar on it.
 */
export const cardsInBucket = (
  ids: Iterable<string>,
  cards: ReadonlyMap<string, api.Card>,
  bucket: number,
): readonly api.Card[] => {
  const out: api.Card[] = []
  for (const id of ids) {
    const card = cards.get(id)
    if (card === undefined || card.types.includes('land')) continue
    if (Math.min(7, Math.max(0, Math.floor(card.manaValue))) === bucket) out.push(card)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * What to say when the list and the bar do not agree. `null` when they do.
 *
 * They can legitimately differ. The bar is the last analysis the server
 * computed and the list is the deck on screen right now, and between an accept
 * and the recompute that follows it those are different decks; separately, a
 * card this page has never hydrated has no name to show. Neither is a reason to
 * show a number we cannot defend, so the honest thing is to show the count we
 * CAN stand behind — the length of the list, which is the thing being looked
 * at — and say what the other number is and why it differs.
 */
export const countCaveat = (listed: number, bar: number): string | null => {
  if (listed === bar) return null
  return listed < bar
    ? `The bar counts ${String(bar)}. The ${String(bar - listed)} not listed are cards this page has not loaded, or were removed since the last recompute.`
    : `The bar counts ${String(bar)} — it is from the last recompute, and these ${String(listed)} are the deck as it stands now.`
}

/** The host of a URL, for link text. The full URL stays on the `href`. */
const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    // Not a URL we can parse; show it whole rather than an empty link.
    return url
  }
}

/**
 * The cards behind one bar, as the panel a hover opens.
 *
 * Names only, as plain text. Buttons would be better if you could reach them,
 * and on hover you cannot — moving the pointer off the trigger to click a name
 * closes the panel it is in. `ComboList` made the same call for the same
 * reason. The preview is a click away on the deck rail, which is where a reader
 * who wants the card itself already goes.
 *
 * The COUNT IN THE HEADING is the length of this list, never the bar's number.
 * They are usually the same and `countCaveat` says so when they are not; what
 * must never happen is a heading claiming 12 above a list of 11, which is the
 * failure this whole panel was written to avoid.
 */
const Breakdown = ({
  title,
  cards,
  bar,
}: {
  title: string
  cards: readonly api.Card[]
  /** What the bar itself says, for the caveat. */
  bar: number
}): React.JSX.Element => {
  const caveat = countCaveat(cards.length, bar)
  return (
    <>
      <strong>
        {title} — {plural(cards.length, 'card')}
      </strong>
      {cards.length === 0 ? (
        <span className="hint-line dim">Nothing here yet.</span>
      ) : (
        cards.slice(0, 24).map((c) => (
          <span className="hint-line" key={c.oracleId}>
            {c.name}
          </span>
        ))
      )}
      {cards.length > 24 ? (
        <span className="hint-line dim">and {cards.length - 24} more.</span>
      ) : null}
      {caveat === null ? null : <span className="hint-line dim">{caveat}</span>}
    </>
  )
}

/* ------------------------------------------------------------ colour pie */

/**
 * Full names, for the accessible summary. A lone "W" read aloud is a letter.
 *
 * Seven, not five: `M` and `C` are slices here too, and a chart that named the
 * five colours and left its colourless wedge to be read as the letter "C" would
 * be doing the thing this map exists to prevent.
 */
const COLOR_NAMES: Readonly<Record<string, string>> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
  M: 'multicolour',
  C: 'colourless',
}

/** One slice's wedge, from the centre. Angles in radians, 0 at three o'clock. */
const wedge = (cx: number, cy: number, r: number, from: number, to: number): string => {
  const at = (angle: number): string =>
    `${(cx + r * Math.cos(angle)).toFixed(2)} ${(cy + r * Math.sin(angle)).toFixed(2)}`
  const large = to - from > Math.PI ? 1 : 0
  return `M ${String(cx)} ${String(cy)} L ${at(from)} A ${String(r)} ${String(r)} 0 ${String(large)} 1 ${at(to)} Z`
}

/**
 * The deck's colour, as two pies: what it IS, and what it MAKES.
 *
 * WHY TWO. They are different questions and one chart was answering neither.
 * "How much of my deck is blue" is about the cards; "can I pay for it" is about
 * the mana base, and a Boros deck of Plains and a Boros deck of Signets have
 * the same identity and nothing else in common. Drawn side by side because the
 * interesting reading is the GAP between them — a deck two-thirds green whose
 * generation chart is one-third green is a deck that will not cast its spells.
 *
 * WHY A PIE AT ALL. Each is a part-to-whole with at most seven categories that
 * sum to a meaningful total, which is the one case a pie answers better than a
 * bar: a share, not a magnitude. That is the whole of the justification and it
 * does not generalise — nothing else on this dashboard should become one. What
 * each total MEANS differs between the two, and each says so in its own words
 * under the figure; a pie whose reader cannot name its whole is a decoration.
 *
 * WHY THE COLOURS ARE NOT FIXED, AND WHAT IT COSTS.
 *
 * `IDENTITY_COLORS` fails a categorical-palette check, and the failures were
 * measured rather than guessed:
 *
 *     [FAIL] Lightness band   #ede2c0 at L 0.913
 *     [FAIL] Chroma floor     #ede2c0 (0.046), #a274ae (0.099) — read as grey
 *     [WARN] CVD separation   #a274ae ↔ #2f74c8  ΔE 6.3 (protan)
 *
 * They are shipped anyway, because a player looking for their white pips needs
 * the white slice to be white. Recolouring Magic's own five would fix the
 * validator and break the chart: the reader's entire prior about what these
 * colours mean is the thing that makes the picture instant.
 *
 * The codebase made this call once before, in `PIP_CVD_NOTE`, and justified it
 * on the grounds that "L0 is a shape view, not a decision surface". That
 * justification does NOT extend here — a pie read to decide a mana base is
 * exactly a decision surface — so the cost is paid the other way the validator
 * permits, with a secondary encoding that does not depend on hue at all:
 *
 *   * every slice is labelled with its colour LETTER and its COUNT, outside the
 *     wedge where the page's own text contrast applies rather than the slice's;
 *   * the slices are separated by a stroke in the page background, so adjacent
 *     wedges have an edge and not just a hue change;
 *   * the whole figure states every colour and count in its accessible name.
 *
 * Read the letters and the chart works with no colour vision at all. The hues
 * are then a fast path for the readers who have them, which is what a secondary
 * encoding is for.
 *
 * That bargain now covers seven letters rather than five. `M` (gold) and `C`
 * (colourless) come from the same `IDENTITY_COLORS` map and were measured in
 * the same run — colourless is the cool grey that run forced, after the first
 * draft sat at ΔE 13.9 against blue — and they get the letter, the count, the
 * stroke and the spoken name exactly as the five do. Grey next to a pale gold
 * is precisely the pair a letter has to carry.
 */
interface Slice {
  /** `W`–`G`, `M` or `C`. The key into `IDENTITY_COLORS` and `COLOR_NAMES`. */
  readonly key: string
  readonly count: number
}

/**
 * One pie, its key, and the sentence saying what its slices sum to.
 *
 * Shared by both charts rather than written twice. They differ in what they
 * count and in nothing else, and two copies of the wedge maths is how one of
 * them would come to draw the single-slice case as a whole circle and the other
 * would draw a blank square.
 */
const Pie = ({
  title,
  slices,
  summary,
  caption,
}: {
  readonly title: string
  readonly slices: readonly Slice[]
  /** The accessible name: what is counted, named in words, and its total. */
  readonly summary: string
  /**
   * What the slices add up to, on screen and in the reader's own terms.
   *
   * Required, not optional. The two charts sum to different things — one to the
   * deck's card count, one to more than it — and a pie whose reader cannot name
   * its whole is a decoration. Making it a prop means a third chart cannot be
   * added without answering the question.
   */
  readonly caption: React.ReactNode
}): React.JSX.Element => {
  const total = slices.reduce((sum, s) => sum + s.count, 0)
  const cx = 62
  const cy = 62
  const r = 44
  let angle = -Math.PI / 2
  return (
    <figure className="pie-figure">
      <h3 className="pie-title">{title}</h3>
      <div className="pie-block">
        <svg className="pie" viewBox="0 0 124 124" role="img" aria-label={summary}>
          {slices.map((s) => {
            const from = angle
            const to = angle + (s.count / total) * Math.PI * 2
            angle = to
            return (
              // One category, one slice, and a single-category deck is a whole
              // circle: the arc command degenerates at exactly 2π — start and
              // end point are the same — and would draw nothing at all.
              slices.length === 1 ? (
                <circle key={s.key} cx={cx} cy={cy} r={r} fill={IDENTITY_COLORS[s.key]} />
              ) : (
                <path
                  key={s.key}
                  d={wedge(cx, cy, r, from, to)}
                  fill={IDENTITY_COLORS[s.key]}
                  /* The gap. In the page's own ground colour rather than a
                     transparent stroke, so adjacent wedges are separated by an
                     edge and not only by a hue change — which is the half of
                     the figure a protan reader is relying on. */
                  stroke="var(--ink)"
                  strokeWidth={2}
                />
              )
            )
          })}
        </svg>
        {/*
          The letter and the count for every slice, in reading order.
          Beside the pie rather than on it: at a 230 px rail a thin wedge has no
          room for text, and text ON a slice inherits that slice's contrast —
          the white one is L 0.913 and would need a dark glyph while the blue
          needs a light one. Out here the page's own parchment-on-ink contrast
          applies to all seven.
        */}
        <ul className="pie-key">
          {slices.map((s) => (
            <li key={s.key}>
              <span className="pie-swatch" style={{ background: IDENTITY_COLORS[s.key] }} />
              <span className="pie-letter">{s.key}</span>
              <span className="pie-count">{s.count}</span>
            </li>
          ))}
        </ul>
      </div>
      <figcaption className="note">{caption}</figcaption>
    </figure>
  )
}

/**
 * Both charts, from one `colorBalance`.
 *
 * The two are computed by the server over the SAME accepted copies, which is
 * what makes reading one against the other legitimate; splitting them across
 * two requests, or counting one here and one there, would eventually put two
 * different decks on the same row.
 */
const ColorPies = ({
  balance,
}: {
  balance: NonNullable<api.Analysis['colorBalance']>
}): React.JSX.Element => {
  /*
   * `?? {}` because the wire is not the type. A server from between API-02 and
   * ADR-0024 sends `{ pips, sources }` and neither key here exists on it; that
   * draws the "nothing yet" line, which is wrong but harmless, rather than
   * throwing on a property of undefined inside the render.
   */
  const identityCounts: Record<string, number> = balance.identity ?? {}
  const generationCounts: Record<string, number> = balance.generation ?? {}
  const identity = (IDENTITY_BUCKETS as readonly string[])
    .map((key) => ({ key, count: identityCounts[key] ?? 0 }))
    .filter((s) => s.count > 0)
  const generation = (MANA_LETTERS as readonly string[])
    .map((key) => ({ key, count: generationCounts[key] ?? 0 }))
    .filter((s) => s.count > 0)

  const names = (slices: readonly Slice[]): string =>
    slices.map((s) => `${COLOR_NAMES[s.key] ?? s.key} ${String(s.count)}`).join(', ')
  const madeSlices = generation.reduce((sum, s) => sum + s.count, 0)

  return (
    <div className="pie-pair">
      {identity.length === 0 ? (
        // An empty deck is a real answer and an empty circle is not one.
        <p className="note">Nothing accepted yet, so there is no colour identity to show.</p>
      ) : (
        <Pie
          title="Identity"
          slices={identity}
          summary={`Colour identity of the deck's cards: ${names(identity)}. Every card is in exactly one, ${plural(balance.cards, 'card')} in total.`}
          caption={
            <>
              {/* `plural`, not the bare number: a one-card deck is a real state — a
                  commander chosen and nothing accepted yet — and "add up to your 1"
                  is the sentence that state would otherwise produce. */}
              What the deck <em>is</em>. Every card sits in exactly one slice, so these add up to
              your {plural(balance.cards, 'card')}. A card of two or more colours is in <b>M</b>,
              not in each of its colours &mdash; otherwise the slices would total more than the deck
              holds and the circle would mean nothing.
            </>
          }
        />
      )}
      {generation.length === 0 ? (
        <p className="note">Nothing in the deck makes mana yet.</p>
      ) : (
        <Pie
          title="Generation"
          slices={generation}
          summary={`Cards that make each kind of mana: ${names(generation)}. Counted once per kind, over ${plural(balance.producers, 'card')} that make mana.`}
          caption={
            <>
              What the deck <em>makes</em> &mdash; lands, rocks and dorks alike, not lands only. A
              card is counted once for <em>each</em> kind of mana it makes, so a dual is in two
              slices and these total {madeSlices} across {plural(balance.producers, 'card')}. Every
              copy counts: twelve Mountains are twelve.
            </>
          }
        />
      )}
    </div>
  )
}

/**
 * The mana curve, actual against the archetype's target.
 *
 * A bar per mana value with the target drawn ON the column as a hairline, so
 * the comparison needs no second axis. Colour is diverging, not categorical:
 * sage where the deck is short, rust where it is over-full, muted where it sits
 * on target. Identity never rests on colour alone — every column states its
 * numbers in its `aria-label` and its tooltip.
 */
const Curve = ({
  curve,
  locked,
  cardsAt,
}: {
  curve: api.Analysis['curve']
  /**
   * Locked cards per bucket, from the client rather than from `curve.locked`.
   *
   * The server's copy is a snapshot from the last recompute, and locking no
   * longer triggers one — so the gold has to come from the deck on screen.
   */
  locked: readonly number[]
  /**
   * Which cards are in a bucket, asked for only when a bar is opened.
   *
   * A function rather than eight precomputed arrays: seven of the eight are
   * never looked at, and the deck is walked once per open instead of eight
   * times per render.
   */
  cardsAt: (bucket: number) => readonly api.Card[]
}): React.JSX.Element => {
  const peak = Math.max(1, ...curve.histogram, ...curve.deltas.map((d) => d.max))

  return (
    <>
      {/* No `role="img"` any more. It made every descendant presentational,
          which was right for eight decorative divs and is a lie now that each
          column is a button that opens the cards behind it — a screen reader
          would be told the whole chart is one picture and never reach them. The
          per-column accessible names carry the same numbers the image label
          used to summarise. */}
      <div className="curve">
        {curve.deltas.map((d) => {
          // The band decides, not the ideal: inside it the bucket is fine.
          const direction = d.withinRange ? 'balanced' : d.delta > 0 ? 'short' : 'over'
          // Said in the label, not only drawn: a bucket the builder pinned is
          // not the archetype's claim any more, and colour alone never carries
          // identity here (see the key below).
          const pinned = curve.target[d.bucket]?.source === 'custom' ? ', target you set' : ''
          const label = d.withinRange
            ? `in range (${String(d.min)}–${String(d.max)})`
            : direction === 'short'
              ? `${plural(d.delta, 'card')} short of ${String(d.min)}`
              : `${plural(-d.delta, 'card')} over ${String(d.max)}`
          const mv = `Mana value ${String(d.bucket)}${d.bucket === 7 ? ' or more' : ''}`
          return (
            /*
             * The bar opens the cards in it.
             *
             * Through the existing `Hint`, not a second tooltip: it already has
             * hover, tap-to-pin and Escape, and it is what the tag chips and
             * the combo counts use. A `title` would have been a desktop-only
             * feature wearing the costume of a general one, which is the exact
             * mistake `Hint` was written to correct.
             *
             * The content is a thunk, so hovering one bar does not walk the
             * deck for the other seven.
             */
            <Hint
              key={d.bucket}
              className="curve-hint"
              label={`${mv}: ${String(d.actual)} cards (${String(locked[d.bucket] ?? 0)} locked), target range ${String(d.min)} to ${String(d.max)}, ${label}${pinned}. Show them.`}
              content={<Breakdown title={mv} cards={cardsAt(d.bucket)} bar={d.actual} />}
            >
              <span className="curve-col" data-custom={curve.target[d.bucket]?.source === 'custom'}>
                {/* The acceptable range, drawn as a band rather than a line —
                    anywhere inside it is fine, which is what a range means. */}
                <span
                  className="curve-band"
                  style={{
                    bottom: `${String((d.min / peak) * 100)}%`,
                    height: `${String(((d.max - d.min) / peak) * 100)}%`,
                  }}
                />
                <span
                  className="curve-bar"
                  data-direction={direction}
                  style={{ height: `${String((d.actual / peak) * 100)}%` }}
                >
                  {/* The committed portion. Gold is the colour of a decision
                      everywhere in this app, so a locked card reads the same
                      way in the curve as it does in the deck. */}
                  <span
                    className="curve-locked"
                    style={{
                      height: `${String(Math.min(100, ((locked[d.bucket] ?? 0) / Math.max(1, d.actual)) * 100))}%`,
                    }}
                  />
                </span>
              </span>
            </Hint>
          )
        })}
      </div>
      <div className="curve-axis" aria-hidden="true">
        {curve.deltas.map((d) => (
          <span key={d.bucket}>{d.bucket === 7 ? '7+' : d.bucket}</span>
        ))}
      </div>
      <p className="curve-key">
        {/* All three states named, not just the two problems. The colours sit
            in the 6–8 CVD band (see tokens.ts), so the key is not a nicety —
            it is the second signal that makes them tellable apart. */}
        <i className="balanced">in range</i>
        <i className="short">short</i>
        <i className="over">too many</i>
        <span>— band is the target range</span>
      </p>
    </>
  )
}

/**
 * The archetype customiser (doc 16).
 *
 * The composition panel made editable, in place, with the preset visible behind
 * every field. Three things a naive form would not do, all three of them the
 * reason this is a component rather than a row of inputs:
 *
 *   * THE PRESET IS ALWAYS SHOWN. The value you are overriding is the context
 *     for the number you are typing. A box reading 36 cannot tell you the
 *     archetype wanted 34.
 *   * IT TOTALS AS YOU TYPE, and going over is a WARNING, not a block. A
 *     builder may knowingly aim high while cutting, exactly as they may
 *     knowingly cross a bracket line (doc 03 §3.2).
 *   * EVERY OVERRIDE HAS A WAY OUT. A per-row reset appears on a changed row,
 *     and "Reset all" clears the lot. An override you cannot clear is a trap,
 *     and typing a row back to its preset removes it from the sparse set rather
 *     than pinning the same number — otherwise a deck would silently stop
 *     inheriting preset revisions for a row the user never meant to freeze.
 *
 * Keyboard throughout (AGENTS.md R4): every control is a native input or
 * button, Escape closes, and focus lands in the first field on open.
 */

/** Sum of the ROLE ideals only. Types overlap roles and must not be added in. */
const roleBudget = (rows: readonly { key: string; value: number }[]): number =>
  rows.reduce((sum, r) => (r.key.startsWith('role:') ? sum + r.value : sum), 0)

interface TargetRow {
  readonly key: string
  readonly name: string
  /** What the archetype asked for, or null where it has no opinion. */
  readonly preset: number | null
}

const TargetSheet = ({
  analysis,
  archetypePreset,
  onSave,
  onClose,
}: {
  analysis: api.Analysis
  /** The archetype's own tolerance, from the domain's own table. */
  archetypePreset: number
  onSave: (overrides: api.TargetOverrides) => void
  onClose: () => void
}): React.JSX.Element => {
  const saved = analysis.targetOverrides ?? {}
  const [roles, setRoles] = useState<Record<string, number>>({ ...(saved.roles ?? {}) })
  const [curve, setCurve] = useState<Record<string, number>>({ ...(saved.curve ?? {}) })
  const [tolerance, setTolerance] = useState<number | null>(saved.tolerance ?? null)
  const firstFieldRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    firstFieldRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const roleRows: TargetRow[] = analysis.targets.map((t) => ({
    key: dimensionKeyOf(t.dimension),
    name: dimensionName(t.dimension),
    // `preset` is absent on a server that predates doc 16, and null for a
    // dimension the override invented. Both mean "the archetype said nothing".
    preset: t.preset ?? (t.source === 'custom' ? null : t.ideal),
  }))

  /** Preset counts per bucket, from the share the archetype asked for. */
  const curvePreset = (analysis.curve.preset ?? analysis.curve.target).map((b) =>
    Math.round(b.ideal * CURVE_REFERENCE_SPELLS),
  )

  const roleValue = (row: TargetRow): number => roles[row.key] ?? row.preset ?? 0
  const curveValue = (bucket: number): number => curve[String(bucket)] ?? curvePreset[bucket] ?? 0

  /*
   * Setting a row back to its preset DELETES the override rather than storing
   * the same number. Sparse is the whole design: a deck that pins 34 lands
   * because 34 was already the preset stops inheriting every later revision of
   * that preset, silently, and would have no way to tell it had.
   */
  const setRole = (row: TargetRow, next: number): void =>
    setRoles((prev) => {
      const out = { ...prev }
      if (next === row.preset) delete out[row.key]
      else out[row.key] = next
      return out
    })

  const setCurveBucket = (bucket: number, next: number): void =>
    setCurve((prev) => {
      const out = { ...prev }
      if (next === curvePreset[bucket]) delete out[String(bucket)]
      else out[String(bucket)] = next
      return out
    })

  const roleTotal = roleBudget(roleRows.map((r) => ({ key: r.key, value: roleValue(r) })))
  const curveTotal = curvePreset.reduce((sum, _p, bucket) => sum + curveValue(bucket), 0)
  const dirty = Object.keys(roles).length > 0 || Object.keys(curve).length > 0 || tolerance !== null

  const numberBox = (
    label: string,
    value: number,
    preset: number | null,
    changed: boolean,
    onChange: (next: number) => void,
    onReset: () => void,
    ref?: React.RefObject<HTMLInputElement | null>,
  ): React.JSX.Element => (
    <div className="target-row" key={label}>
      <label className="target-name" htmlFor={`target-${label}`}>
        {label}
      </label>
      <input
        id={`target-${label}`}
        ref={ref}
        className="target-box"
        type="number"
        inputMode="numeric"
        min={0}
        max={99}
        step={1}
        value={value}
        data-custom={changed}
        onChange={(e) => {
          const next = Number(e.target.value)
          // A cleared box is not zero. Ignoring an unparseable value leaves the
          // row where it was rather than pinning it to nothing mid-keystroke.
          if (Number.isFinite(next)) onChange(Math.max(0, Math.min(99, Math.round(next))))
        }}
        aria-label={`${label} target, currently ${String(value)}${preset === null ? '' : `, archetype wants ${String(preset)}`}`}
      />
      <span className="target-preset">{preset === null ? 'new' : preset}</span>
      {changed ? (
        <button className="act target-reset" onClick={onReset} aria-label={`Reset ${label}`}>
          {'↺'}
        </button>
      ) : (
        // A placeholder, so the columns do not jump as rows change.
        <span className="target-reset" aria-hidden="true" />
      )}
    </div>
  )

  return (
    <div className="sheet targets-sheet" role="dialog" aria-label="Adjust targets">
      <div className="sheet-head">
        <h3>Targets</h3>
        <button
          className="act"
          onClick={() => {
            setRoles({})
            setCurve({})
            setTolerance(null)
          }}
          disabled={!dirty}
        >
          Reset all
        </button>
        <button className="act" onClick={onClose} aria-label="Close targets">
          Close
        </button>
      </div>

      <p className="note">
        Counts, not percentages. A row you leave alone keeps following the archetype, including
        every later revision of it — only what you type here is stored.
      </p>

      <div className="targets-cols">
        <div className="targets-col">
          <h4>Roles</h4>
          {roleRows.map((row) =>
            numberBox(
              row.name,
              roleValue(row),
              row.preset,
              roles[row.key] !== undefined,
              (next) => setRole(row, next),
              () =>
                setRoles((prev) => {
                  const out = { ...prev }
                  delete out[row.key]
                  return out
                }),
              row === roleRows[0] ? firstFieldRef : undefined,
            ),
          )}
          <p className="note target-total" data-over={roleTotal > 99}>
            {/* Roles only. A creature that ramps is counted once as ramp and
                once as a creature, so adding the type rows in would produce a
                budget no deck could ever satisfy. */}
            Roles total {roleTotal} of 99
            {roleTotal > 99 ? ' — over, and buildable only if you cut' : ''}
          </p>
        </div>

        <div className="targets-col">
          <h4>Mana curve</h4>
          {curvePreset.map((preset, bucket) =>
            numberBox(
              bucket === 7 ? '7+' : String(bucket),
              curveValue(bucket),
              preset,
              curve[String(bucket)] !== undefined,
              (next) => setCurveBucket(bucket, next),
              () =>
                setCurve((prev) => {
                  const out = { ...prev }
                  delete out[String(bucket)]
                  return out
                }),
            ),
          )}
          <p className="note target-total" data-over={curveTotal > CURVE_REFERENCE_SPELLS}>
            {/* Against the nonland-spell count a curve is a count of, not
                against 99 — the curve excludes lands, so totalling it against a
                whole deck would read as room the deck does not have. */}
            Curve total {curveTotal} of {CURVE_REFERENCE_SPELLS} spells
            {curveTotal > CURVE_REFERENCE_SPELLS ? ' — over; the shape still applies' : ''}
          </p>
        </div>
      </div>

      <div className="target-tolerance">
        <label htmlFor="target-tolerance">How strict</label>
        <input
          id="target-tolerance"
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round((tolerance ?? archetypePreset) * 100)}
          onChange={(e) => setTolerance(Number(e.target.value) / 100)}
          aria-label={`Tolerance, currently ${String(Math.round((tolerance ?? archetypePreset) * 100))} per cent, archetype wants ${String(Math.round(archetypePreset * 100))}`}
        />
        <span className="target-preset">{Math.round(archetypePreset * 100)}%</span>
        {tolerance === null ? (
          <span className="target-reset" aria-hidden="true" />
        ) : (
          <button
            className="act target-reset"
            onClick={() => setTolerance(null)}
            aria-label="Reset tolerance"
          >
            {'↺'}
          </button>
        )}
      </div>
      <p className="note">
        Tighter bands flag smaller misses. Every band stays at least one card wide, whatever this
        says — a target you can only hit exactly is one every deck fails.
      </p>

      <div className="row" style={{ marginTop: '0.5rem' }}>
        <button
          className="primary"
          onClick={() => {
            // Sparse on the wire, exactly as it is held: only what was typed.
            const next: api.TargetOverrides = {}
            if (Object.keys(roles).length > 0) next.roles = roles
            if (Object.keys(curve).length > 0) next.curve = curve
            if (tolerance !== null) next.tolerance = tolerance
            onSave(next)
          }}
        >
          Save targets
        </button>
        <button className="act" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/**
 * Send a command batch, retrying a transient failure.
 *
 * Four attempts, the delay doubling to a one-second ceiling. Losing a batch
 * means the user's clicks silently disappear, so a blip on the wire should not
 * cost them work — but a 400 will not become a 200 by being repeated, and a 409
 * needs a new version rather than patience, so only network faults and 5xx are
 * retried.
 *
 * Shared by the accept batch and the lock, which want the same behaviour for
 * the same reason.
 */
const BACKOFF_MS = [100, 200, 400, 800]

const sendWithRetry = async (
  deckId: string,
  body: Parameters<typeof api.sendCommands>[1],
  version: number,
): ReturnType<typeof api.sendCommands> => {
  /*
   * One key for the whole retry loop, minted before the first attempt.
   *
   * This is the point of an idempotency key and it was being thrown away: a
   * fresh uuid per attempt makes every retry a new batch to the server, so a
   * 5xx that had actually committed got applied a second time. Generated here
   * because this is the scope a retry spans.
   */
  const idempotencyKey = crypto.randomUUID()
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await api.sendCommands(deckId, body, version, idempotencyKey)
    } catch (error) {
      const status = error instanceof api.ApiError ? error.status : 0
      const transient = status === 0 || status >= 500
      if (!transient || attempt >= BACKOFF_MS.length) throw error
      await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt]))
    }
  }
}

interface PendingCommand {
  readonly type: 'accept' | 'exclude' | 'remove' | 'lock' | 'restore'
  readonly oracleId: string
  readonly locked?: boolean
}

/**
 * Fetch the extra rows for every group the user has expanded.
 *
 * One request for all of them, narrowed to those keys. `combo` is a client-side
 * merge of the three `combo-N` keys the server actually emits (see
 * `shownGroups`), so it is translated on the way out and re-merged on the way
 * back — the merge is a heading decision and does not belong in the request.
 */
const expansionsFor = async (
  deckId: string,
  keys: ReadonlySet<string>,
  query = '',
  columns: readonly string[] = [],
): Promise<ReadonlyMap<string, readonly api.Recommendation[]>> => {
  if (keys.size === 0) return new Map()
  const wanted = [...keys].flatMap((k) => (k === 'combo' ? ['combo-2', 'combo-3', 'combo-4'] : [k]))
  const more = await api.getRecommendations(deckId, {
    limitPerGroup: 32,
    groups: wanted,
    ...(query === '' ? {} : { query }),
    ...(columns.length > 0 ? { columns } : {}),
  })
  const out = new Map<string, readonly api.Recommendation[]>()
  for (const key of keys) {
    out.set(
      key,
      key === 'combo'
        ? more.groups.filter((g) => g.key.startsWith('combo-')).flatMap((g) => g.items)
        : (more.groups.find((g) => g.key === key)?.items ?? []),
    )
  }
  return out
}

interface QueryResult {
  readonly deck: api.Deck
  readonly recs: api.Recommendations
  readonly analysis: api.Analysis
  readonly hydrated: api.Hydrated
  /**
   * Extra rows for groups the user has expanded, keyed by group.
   *
   * Re-fetched with every recompute rather than kept from the expand click.
   * An expansion held across a recompute is stale in the worst way: the rows
   * were chosen for a deck that no longer exists, so a card the user had just
   * added came straight back into the list — the same defect as the superseded
   * run, arriving by a different route.
   */
  readonly extra: ReadonlyMap<string, readonly api.Recommendation[]>
  /**
   * Commands the server refused, carried back so the UI can say so.
   *
   * `sendCommands` has always returned these and the client has always dropped
   * them. Dropping them is what made an illegal add SILENT: the optimistic
   * overlay showed the card in the deck, the server said no, and the overlay
   * was swept away by the response with nothing to explain the disappearance.
   *
   * Optional, because the WIRE is not the type — the same reason `images` is
   * optional on `hydrate`. A run with no commands in it has nothing to report,
   * and a server that omits the field must leave the client saying nothing
   * rather than throwing inside the apply. `rejectionNotice` is the one place
   * that reads it, and it is the one place that has to tolerate the absence.
   */
  readonly rejected?: readonly api.CommandResult['rejected'][number][] | undefined
}

/**
 * What an empty suggestion heading means, in words.
 *
 * One badge, five states, and the whole point is that they are not the same
 * badge. `satisfied` was previously shown for all of them, so a filter that
 * matched nothing and a request that failed both reported the deck's needs as
 * met — the second of those while the app held no information whatsoever.
 *
 * The words go in the badge and the arithmetic goes in the `title`, because the
 * heading is a flex row that already carries a name, a count, a rationale and
 * two buttons; a sentence in it wraps the row on a phone. The badge text alone
 * is never a lie, which is the property that matters — the tooltip only adds
 * detail, it does not correct the label.
 */
const GroupBadge = ({
  state,
  gap,
  total,
}: {
  state: 'rows' | 'stale' | 'filtered' | 'short' | 'decided' | 'satisfied'
  /** How many cards short this heading's dimension is, if it names one. */
  gap: number | null
  total: number
}): React.JSX.Element | null => {
  if (state === 'rows') return null
  const shortfall =
    gap === null || gap === 0 ? '' : ` The deck is still ${plural(gap, 'card')} short here.`
  const badge = {
    stale: {
      text: 'not updated',
      title: `The last refresh did not finish, so this list is out of date. Nothing here has been checked against your deck.${shortfall}`,
    },
    filtered: {
      text: 'no match',
      title: `Nothing in this group matches your filter. That is a fact about the query, not about the deck.${shortfall}`,
    },
    short: {
      text: gap === null ? 'still short' : `still short ${String(gap)}`,
      title: `Nothing left to show under this heading, and the gap it names is still open.${shortfall}`,
    },
    decided: {
      text: 'all rejected',
      title: `You rejected every suggestion offered here. ${plural(total, 'candidate')} matched — ask for more to see the rest.`,
    },
    satisfied: { text: 'satisfied', title: 'This need is met. Nothing is missing here.' },
  }[state]
  return (
    <span className="satisfied" data-state={state} title={badge.title}>
      {badge.text}
    </span>
  )
}

/**
 * The progress bar in the masthead.
 *
 * Two halves that mean different things, which is why it is one bar and not a
 * spinner: the left half is work the server is doing, the right half is time
 * being handed back to the user before the list moves under them. The label
 * says which half we are in, because a bar alone cannot.
 */
const ProgressBar = ({
  phase,
  progress,
  label,
}: {
  phase: Phase
  progress: number
  label: string
}): React.JSX.Element => (
  <div
    className="progress"
    data-active={phase !== 'idle'}
    role="status"
    aria-live="polite"
    aria-label={label}
  >
    <span className="progress-label">{label}</span>
    <div className="progress-track">
      <div
        className="progress-fill"
        data-phase={phase}
        style={{ width: `${String(Math.round(progress * 100))}%` }}
      />
      {/* The halfway mark is meaningful — it is where the server's answer
          arrives and the user's grace period begins — so it is drawn. */}
      <span className="progress-half" aria-hidden="true" />
    </div>
  </div>
)

/**
 * One basic land, with its count.
 *
 * A number box AND a pair of steppers, because both gestures are wanted: +1
 * repeatedly while eyeballing the curve, or type 34 when you already know. The
 * box commits on blur and on Enter so a half-typed "3" of "34" never fires.
 */
const BasicRow = ({
  card,
  count,
  onSet,
}: {
  card: api.Card
  count: number
  onSet: (next: number) => void
}): React.JSX.Element => {
  const [draft, setDraft] = useState(String(count))
  const commit = (raw: string): void => {
    const parsed = Number.parseInt(raw, 10)
    // A deck cannot hold a negative number of Mountains; anything unreadable
    // falls back to what is already there rather than to zero.
    const next = Number.isFinite(parsed) ? Math.max(0, parsed) : count
    setDraft(String(next))
    if (next !== count) onSet(next)
  }

  // Follow the deck when it changes underneath us (a batch landing, say).
  useEffect(() => setDraft(String(count)), [count])

  return (
    <div className="card-row basic-row">
      <span className="name">{card.name}</span>
      <button
        className="act step"
        onClick={() => onSet(Math.max(0, count - 1))}
        disabled={count === 0}
        aria-label={`One fewer ${card.name}`}
      >
        −
      </button>
      <input
        className="basic-count"
        type="text"
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
        }}
        aria-label={`Number of ${card.name}`}
      />
      <button
        className="act step"
        onClick={() => onSet(count + 1)}
        aria-label={`One more ${card.name}`}
      >
        +
      </button>
    </div>
  )
}

/**
 * Paste a decklist, see what it resolved to, then commit.
 *
 * The preview is not optional politeness: doc 15 §15.3 requires that nothing
 * applies before the user confirms, so a typo costs one line rather than the
 * whole paste. Unresolved lines are listed, never silently dropped.
 */
const ImportDialog = ({
  deckId,
  onCommit,
  onClose,
}: {
  deckId: string
  onCommit: (cards: { oracleId: string; quantity: number }[]) => void
  onClose: () => void
}): React.JSX.Element => {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<api.ImportPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const check = (): void => {
    setBusy(true)
    setError(null)
    void api
      .importPreview(deckId, text)
      .then((p) => {
        setPreview(p)
        setBusy(false)
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Could not read that list')
        setBusy(false)
      })
  }

  const total = (preview?.resolved ?? []).reduce((n, r) => n + r.quantity, 0)

  return (
    <div className="sheet" role="dialog" aria-label="Import a decklist">
      <div className="sheet-head">
        <h3>Import a decklist</h3>
        <button className="act" onClick={onClose} aria-label="Close import">
          Close
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setPreview(null)
        }}
        placeholder={'1 Sol Ring\n1 Rhystic Study\n34 Mountain'}
        aria-label="Decklist text"
        rows={8}
      />

      {error !== null ? <p className="problem">{error}</p> : null}

      {preview === null ? (
        <button className="primary" onClick={check} disabled={busy || text.trim() === ''}>
          {busy ? 'Reading…' : 'Preview'}
        </button>
      ) : (
        <>
          <p className="note">
            {plural(total, 'card')} across {plural(preview.resolved.length, 'line')} resolved.
          </p>
          {preview.unresolved.length > 0 ? (
            <div className="unavailable">
              <strong>Not recognised — these will not be added:</strong>
              {preview.unresolved.map((u, i) => (
                <div key={i}>
                  {u.name} — {u.reason}
                </div>
              ))}
            </div>
          ) : null}
          <div className="row" style={{ marginTop: '0.5rem' }}>
            <button
              className="primary"
              onClick={() => {
                onCommit(preview.resolved)
                onClose()
              }}
              disabled={preview.resolved.length === 0}
            >
              Add {plural(total, 'card')}
            </button>
            <button className="act" onClick={() => setPreview(null)}>
              Back
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * The magnifying glass, with the auto-query countdown drawn around it.
 *
 * The ring is a CSS animation rather than a JavaScript-driven redraw: ten
 * seconds at 60 fps is six hundred renders to move one circle, and the browser
 * interpolates it for free. `key` restarts the animation whenever the draft
 * changes, which is what makes "any adjustment resets the clock" visible.
 *
 * Colour is not the signal here, and neither is the ring on its own — the
 * button's accessible name counts down in words, so someone who cannot see the
 * ring still knows a query is coming and how long they have to stop it.
 */
/**
 * One column of the suggestion table.
 *
 * A union rather than the bare query string this used to be, because a column
 * is about to stop always being a query: `impact` and `efficiency` are arriving
 * as NAMED METRICS that are present by default and removable like any other
 * column. They take part in the sort chain on exactly the same terms — no
 * special tier, no exemption — so the difference has to live in the value and
 * not in a second code path beside it.
 *
 * `metric` is a seam and nothing more. Nothing in this build creates one, and
 * the numbers behind it are being computed in `packages/domain`; what is here
 * is the shape that stops the sort, the legend and the request from each
 * assuming a column is a string.
 */
export type Column =
  | { readonly kind: 'query'; readonly query: string }
  | { readonly kind: 'metric'; readonly metric: string; readonly label: string }

/**
 * The identity of a column, for React keys and for `columnMatches`.
 *
 * A query column keys on its own text, which is what the server echoes back on
 * `Recommendations.columns[].query`. A metric keys under a prefix so a metric
 * called `impact` and someone's query `impact` cannot collide.
 */
export const columnKey = (c: Column): string =>
  c.kind === 'query' ? c.query : `metric:${c.metric}`

/** What the legend chip says. */
export const columnLabel = (c: Column): string => (c.kind === 'query' ? c.query : c.label)

/**
 * The subset the RECOMMENDATIONS REQUEST can carry.
 *
 * `columns` on the wire is a list of query strings the server evaluates per
 * candidate (doc 10). A metric is not a query and the server does not evaluate
 * it — its values ride on the recommendation itself — so sending its name would
 * be asking the parser to read `impact` as a filter. One function, so the three
 * places that build a request cannot each answer this differently.
 */
export const queryColumnsOf = (columns: readonly Column[]): readonly string[] =>
  columns.filter((c) => c.kind === 'query').map((c) => c.query)

/**
 * Where one card sorts on one column. Lower is earlier.
 *
 * For a query the answer is binary and the ordering is "matches first", which
 * is what promoting a filter to a column is asking for: keep everything, and
 * bring the ones I asked about to the top.
 *
 * Ties are not broken here. That is the caller's job and it is the whole point
 * of the feature — see `sortByColumns`.
 */
export const columnRank = (
  column: Column,
  oracleId: string,
  matches: ReadonlyMap<string, ReadonlySet<string>>,
): number => {
  if (column.kind === 'query') {
    return matches.get(column.query)?.has(oracleId) === true ? 0 : 1
  }
  /*
   * A metric column has no ranking in this build.
   *
   * Deliberately 0 for every card rather than a guess: a metric whose values
   * have not arrived must contribute NOTHING to the order, so the columns after
   * it decide. Inventing an order from data we do not have would be worse than
   * a column that does not sort yet — it would look like it worked.
   */
  return 0
}

/**
 * Sort one group's rows by the columns, in the order they were added.
 *
 * Three rules, and the first outranks the other two:
 *
 *   GROUP ORDER IS UNTOUCHED (doc 05 §5.3, pillar P5). The groups are the app's
 *   argument about what this deck needs, in the order it wants to make it, and
 *   a sort that could move a row from "completes a combo" into "fills ramp"
 *   would be re-deciding that argument on the strength of a text query. So this
 *   sorts WITHIN a group and is never applied across them.
 *
 *   COLUMNS COMPOSE. The first column added is the primary sort, the second
 *   breaks its ties, and so on — which is the only reading of "as a secondary
 *   sort, maintaining the ordering of previous sorts" that survives a third
 *   column being added.
 *
 *   SCORE IS THE LAST WORD. Two rows that every column agrees about keep the
 *   order the server sent them in, which is descending score. Carried as an
 *   explicit index rather than leaning on `Array.prototype.sort` being stable:
 *   the guarantee holds in every engine this ships to, but a deterministic
 *   order is the thing being promised and it should be visible in the code
 *   that promises it.
 */
export const sortByColumns = <T extends { readonly oracleId: string }>(
  items: readonly T[],
  columns: readonly Column[],
  matches: ReadonlyMap<string, ReadonlySet<string>>,
): readonly T[] => {
  if (columns.length === 0) return items
  return items
    .map((item, at) => ({ item, at }))
    .sort((a, b) => {
      for (const column of columns) {
        const delta =
          columnRank(column, a.item.oracleId, matches) -
          columnRank(column, b.item.oracleId, matches)
        if (delta !== 0) return delta
      }
      return a.at - b.at
    })
    .map((x) => x.item)
}

/**
 * The column queries, under the filter bar, each sitting over its own column.
 *
 * A chip that just says `mv<=3` in a row of chips makes you count ticks to work
 * out which column it names. Aligning it removes that step: the label is
 * directly above the column it describes.
 *
 * Measured from the DOM rather than reconstructed in CSS. The columns sit in a
 * flex row after a flexible name and before the costs and the buttons, so their
 * position depends on text that only the browser knows the width of. Mirroring
 * that with a second set of spacers would be a copy that silently drifts the
 * first time a button's label changes; asking where the column actually IS
 * cannot drift.
 *
 * Each chip gets its own line, right-aligned to its column's centre, because
 * columns are 1.6rem apart and the queries are not.
 */
const ColumnLegend = ({
  columns,
  onRemove,
  measureRoot,
}: {
  columns: readonly Column[]
  /** By `columnKey`, so a metric and a query of the same text cannot collide. */
  onRemove: (key: string) => void
  measureRoot: React.RefObject<HTMLElement | null>
}): React.JSX.Element | null => {
  const barRef = useRef<HTMLDivElement>(null)
  /** Distance from the bar's right edge to each column's centre, in px. */
  const [insets, setInsets] = useState<readonly number[] | null>(null)

  useLayoutEffect(() => {
    if (columns.length === 0) {
      setInsets(null)
      return
    }
    const measure = (): void => {
      const bar = barRef.current
      const root = measureRoot.current
      if (bar === null || root === null) return
      const cells = [...root.querySelectorAll('.card-row .col-cell')].slice(0, columns.length)
      // Before the first result lands there is nothing to align to. Falling
      // back to the plain row is better than pinning chips to a guess.
      if (cells.length !== columns.length) {
        setInsets(null)
        return
      }
      const barRight = bar.getBoundingClientRect().right
      setInsets(
        cells.map((cell) => {
          const box = cell.getBoundingClientRect()
          return barRight - (box.left + box.width / 2)
        }),
      )
    }
    measure()

    // The columns move whenever the pane is resized or the rows reflow, and
    // neither fires a React render.
    const observer = new ResizeObserver(measure)
    if (barRef.current !== null) observer.observe(barRef.current)
    if (measureRoot.current !== null) observer.observe(measureRoot.current)
    return () => observer.disconnect()
  }, [columns, measureRoot])

  if (columns.length === 0) return null
  const aligned = insets !== null

  return (
    <div
      className="columns"
      ref={barRef}
      data-aligned={aligned}
      style={aligned ? { height: `${String(columns.length * 1.4)}rem` } : undefined}
      aria-label="Columns"
    >
      {columns.map((c, i) => {
        const label = columnLabel(c)
        // The chips are already in priority order, but "the order they happen
        // to be in" is not something a reader can be expected to infer from a
        // stack of chips — and it now decides what the list is sorted by. So
        // the position is stated.
        const rank = i === 0 ? 'sorts first' : `then by this${i > 1 ? ` (${String(i + 1)})` : ''}`
        return (
          <span
            className="column-chip"
            key={columnKey(c)}
            style={
              aligned
                ? { right: `${String(insets[i] ?? 0)}px`, top: `${String(i * 1.4)}rem` }
                : undefined
            }
          >
            <span className="column-rank" aria-hidden="true">
              {i + 1}
            </span>
            <code>{label}</code>
            <button
              className="act"
              onClick={() => onRemove(columnKey(c))}
              aria-label={`Remove the ${label} column — ${rank}`}
              title={`Matches sort to the top; ${rank}. Remove this column.`}
            >
              ×
            </button>
          </span>
        )
      })}
    </div>
  )
}

/**
 * A search button that can be counting down, or working.
 *
 * Shared by the suggestion filter and the commander search so the two are the
 * same object rather than two things that look alike. The countdown ring is a
 * CSS animation restarted by `key`; ten seconds redrawn from JavaScript would
 * be six hundred renders to move one circle.
 *
 * Three states, and only one is ever on screen: idle (a magnifying glass),
 * counting down (a ring filling around it), and busy (a spinner). Busy wins,
 * because a query already in flight cannot also be pending.
 */
const SearchButton = ({
  onRun,
  remaining,
  restartKey,
  busy = false,
  what = 'filter',
}: {
  readonly onRun: () => void
  readonly remaining: number | null
  readonly restartKey: string
  readonly busy?: boolean
  /** The noun in the label — "filter" or "search". */
  readonly what?: string
}): React.JSX.Element => {
  const verb = what === 'filter' ? 'Run this filter' : `Run this ${what}`
  const label = busy
    ? `Searching…`
    : remaining === null
      ? verb
      : `${verb} — runs on its own in ${String(remaining)} second${remaining === 1 ? '' : 's'}`
  return (
    <button className="act search" onClick={onRun} disabled={busy} aria-label={label} title={label}>
      {busy || remaining === null ? null : (
        <svg className="ring" viewBox="0 0 28 28" aria-hidden="true">
          <circle className="ring-track" cx="14" cy="14" r="12" />
          <circle
            key={restartKey}
            className="ring-fill"
            cx="14"
            cy="14"
            r="12"
            style={{ animationDuration: `${String(AUTO_QUERY_MS)}ms` }}
          />
        </svg>
      )}
      {busy ? (
        <span className="spinner" aria-hidden="true" />
      ) : (
        <span aria-hidden="true">{'⌕'}</span>
      )}
      {/* Announced politely so a screen reader hears the countdown start
          without it interrupting whatever is being read. */}
      <span className="sr" role="status">
        {busy
          ? 'Searching'
          : remaining === null
            ? ''
            : `Runs on its own in ${String(remaining)} seconds`}
      </span>
    </button>
  )
}

export const Workspace = ({
  deck: initial,
  onSwitch,
  onNew,
}: {
  deck: api.Deck
  /** Open another deck on this device. */
  onSwitch?: (id: string) => void
  /** Back to the start screen to build a new one. */
  onNew?: () => void
}): React.JSX.Element => {
  const [deck, setDeck] = useState(initial)
  /** Doc 17 §17.1 — the deck web is a mode at `#web`, not a panel. */
  const webMode = useDeckWebMode()
  const [groups, setGroups] = useState<api.Group[]>([])
  const [unavailable, setUnavailable] = useState<api.Unavailable[]>([])
  const [analysis, setAnalysis] = useState<api.Analysis | null>(null)
  const [cards, setCards] = useState<Map<string, api.Card>>(new Map())
  const [prices, setPrices] = useState<Map<string, number | null>>(new Map())
  /**
   * Card art, keyed the same way and filled from the same hydration.
   *
   * A separate map rather than a field on the cached `api.Card` for the reason
   * doc 02 §2.1 gives: an image belongs to a printing and a `Card` is oracle
   * identity. It is also what lets the art arrive late without invalidating a
   * card the rest of the interface is already drawing from.
   */
  const [images, setImages] = useState<Map<string, api.ImageUris>>(new Map())
  const [query, setQuery] = useState('')
  const [queryError, setQueryError] = useState<string | null>(null)
  const [detail, setDetail] = useState<api.CardDetail | null>(null)
  /** Which card the preview is showing, known before its detail arrives. */
  const [inspect, setInspect] = useState<string | null>(null)
  /** The control that opened the preview, so closing it can hand focus back. */
  const previewOpener = useRef<HTMLElement | null>(null)
  /*
   * On one column the right-hand rail is at the bottom of a very long page, so
   * the preview renders as a bottom sheet over the feed instead.
   *
   * The alternative considered and rejected was scrolling the rail into view on
   * open: it puts the panel on screen once, then every requery, every accepted
   * card and every stray scroll takes it away again, and it drags the whole
   * composition dashboard along with it. Rejected too was rendering a second
   * copy of the panel in a portal — two Previews is two things to keep in step,
   * and they would drift. Moving the existing element in the DOM at this
   * breakpoint would remount it, throwing away the in-flight `/cards/{id}`
   * request and reordering the page for a screen reader. So the element stays
   * exactly where it is and only its box changes, which also makes a rotate
   * across the breakpoint a repaint rather than a remount.
   */
  const singleColumn = useSingleColumn()
  /** Locks the server has not answered yet — these rows show a spinner. */
  const [locking, setLocking] = useState<ReadonlySet<string>>(new Set())
  /**
   * How many faults a card needs before its cut hints are shown.
   *
   * Two by default, because one is usually not a signal. The roles are close to
   * mutually exclusive in practice: a card that completes a combo often has no
   * derived synergy, and a card with strong synergy is often in no combo. Each
   * of those cards has exactly one flaw, and flagging them all buries the card
   * that has three.
   *
   * Per browser, not per deck — it is a reading preference about how much noise
   * to tolerate, not a property of the deck.
   */
  /**
   * Groups the user has collapsed, and the extra rows an expand has fetched.
   *
   * Collapsing is purely visual and purely local — "I am done with this one for
   * now" is not a fact about the deck and has no business going to the server.
   * Expanding is the opposite: it asks for MORE rows in one group, which only
   * the server can answer.
   */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [extraItems, setExtraItems] = useState<ReadonlyMap<string, readonly api.Recommendation[]>>(
    new Map(),
  )
  const [expanding, setExpanding] = useState<string | null>(null)

  const [cutThreshold, setCutThreshold] = useState<number>(() => {
    const saved = Number(localStorage.getItem('lw.cutThreshold'))
    return Number.isInteger(saved) && saved >= 1 && saved <= 4 ? saved : 2
  })
  useEffect(() => {
    localStorage.setItem('lw.cutThreshold', String(cutThreshold))
  }, [cutThreshold])
  /**
   * Clicks the server has not seen yet.
   *
   * The deck view is rendered from `deck` PLUS this, so a card lands the instant
   * it is clicked — long before the buffer closes. It is also what drives the
   * per-card spinner, so a card in flight cannot be clicked twice.
   */
  const [pending, setPending] = useState<readonly PendingCommand[]>([])
  const [basics, setBasics] = useState<api.Card[]>([])
  const [importing, setImporting] = useState(false)
  const [tuningTargets, setTuningTargets] = useState(false)
  /**
   * Whether the Game Changers list is expanded.
   *
   * `null` is "the user has not said", which is not the same as closed: the
   * list then follows the deck and opens itself when the deck is over its
   * allowance, so the offending cards arrive with the complaint. Once the user
   * has toggled it, their choice wins — including closing it while over.
   */
  const [bracketOpen, setBracketOpen] = useState<boolean | null>(null)
  const bracketHeadingRef = useRef<HTMLHeadingElement>(null)
  /**
   * The chip's "why", opened.
   *
   * A claim the reader cannot interrogate is not a reason (P4), and on a phone
   * the panel is a screen and a half below the masthead. Focus moves, not just
   * the scroll position — a keyboard user who activates the chip and is left
   * at the top of the document has been told nothing.
   */
  const revealBracket = (): void => {
    setBracketOpen(true)
    const heading = bracketHeadingRef.current
    if (heading === null) return
    // Deliberately not `behavior: 'smooth'`: an instant jump needs no
    // prefers-reduced-motion guard and there is nothing to watch on the way.
    // Optional call because jsdom does not implement `scrollIntoView`, and the
    // focus move below is the half a keyboard user actually depends on.
    heading.scrollIntoView?.({ block: 'nearest' })
    heading.focus()
  }
  const [hideSettledRoles, setHideSettledRoles] = useState(false)
  /**
   * What saving a target actually did, in words (doc 16).
   *
   * "Say what changes" — tuning a target with no visible consequence is how a
   * user stops trusting the numbers. Both halves are read off the SAME analysis
   * response, so the summary can never describe a state that did not exist:
   * which roles crossed into or out of being short (that is exactly the set of
   * `fills-` groups that appear or disappear, since a group exists iff its role
   * is short), and how many cut hints there now are.
   */
  const targetsBaselineRef = useRef<{ short: string[]; cuts: number } | null>(null)
  const [targetsChange, setTargetsChange] = useState<string | null>(null)
  /**
   * The columns, in priority order. The ONLY copy of this list.
   *
   * A column still does not FILTER — every suggestion stays on screen and the
   * column says which ones match, which is the difference between "show me only
   * X" and "which of these are X". What it now also does is SORT: matches come
   * first within each group, the second column breaks the first's ties, and the
   * server's score has the last word. See `sortByColumns` for why the sort
   * never crosses a group boundary.
   *
   * Every add and every remove goes through `addColumn` / `removeColumn` rather
   * than calling the setter in place. That is not tidiness: this list is about
   * to become a persisted field on the deck, and the two functions are where
   * the PATCH will go. Scattered setters would be four places to remember.
   */
  const [columns, setColumns] = useState<readonly Column[]>([])
  const [columnMatches, setColumnMatches] = useState<Map<string, Set<string>>>(new Map())
  const [draftQuery, setDraftQuery] = useState('')
  /**
   * Run the filter on its own if the box sits untouched.
   *
   * Kept in localStorage rather than on the deck. It changes nothing about what
   * the deck IS or what gets recommended — it is a preference about this
   * browser, and putting it on the deck record would mean a domain contract
   * change and a round-trip for a checkbox. It sits under Deck options because
   * that is where the other filter-shaping controls are, not because it is
   * deck state.
   */
  const [autoQuery, setAutoQuery] = useState<boolean>(
    /*
     * OFF by default, and only on if the user turned it on.
     *
     * It used to default on, on the argument that "absent" is not "off" and
     * that a feature nobody switches on is a feature nobody sees. Playtesting
     * settled it the other way: a query is expensive, the countdown fires while
     * you are still reading the list it is about to replace, and a list that
     * rearranges itself under the cursor is worse than one that waits. The
     * button and Enter are both right there, and the ring around the button is
     * what advertises the setting to anyone who wants it.
     *
     * Absent is still not the same as 'off' — it is "never expressed a view",
     * and that now reads as the default rather than as a decision. Anyone who
     * has ALREADY ticked the box has 'on' stored and keeps it.
     */
    () => localStorage.getItem('lw.autoQuery') === 'on',
  )
  useEffect(() => {
    localStorage.setItem('lw.autoQuery', autoQuery ? 'on' : 'off')
  }, [autoQuery])

  const auto = useAutoQuery({ enabled: autoQuery, draft: draftQuery, committed: query }, () =>
    setQuery(draftQuery),
  )
  const [notice, setNotice] = useState<string | null>(null)
  const deckRef = useRef(deck)
  const queryRef = useRef(query)
  const columnsRef = useRef<readonly Column[]>([])
  /** Groups the user has asked for more of. Read by `load` on every recompute. */
  const expandedRef = useRef<ReadonlySet<string>>(new Set())
  /**
   * The newest deck the server has acknowledged, applied to the UI or not.
   *
   * `deckRef` is what the user is looking at; this is what the server believes.
   * They diverge for the length of a settle, and every write has to use this
   * one or it will be arguing with a version that moved on.
   */
  const serverDeckRef = useRef<api.Deck | null>(null)
  /**
   * The dataset snapshot the last recommendations answer described.
   *
   * The client-side card cache is keyed on it (`cardcache.ts`), and two callers
   * need it without issuing a request that carries it: the preview, and the
   * expand button's follow-up hydrate. A ref rather than state because reading
   * it must not cause a render and it is written inside `load`.
   */
  const snapshotRef = useRef<string | null>(null)
  /**
   * The cards the name search last found, by id.
   *
   * Read by the pipeline's apply, which runs long after the click and holds
   * only `hydrated.cards` — the deck and the suggestion feed. A card reached
   * from "Cards named like…" is in neither, and if the server refuses it, it
   * never joins the deck either. Without this the one route that reaches a
   * rejection on purpose is the one route with no name to print.
   *
   * A ref, not state: it is read inside a callback and writing it must not
   * cause a render.
   */
  const nearbyRef = useRef<ReadonlyMap<string, api.Card>>(new Map())
  /** The suggestions region, so the column legend can find the columns in it. */
  const suggestionsRef = useRef<HTMLElement>(null)
  /** The filter box — the last resort for focus when the feed empties out. */
  const filterRef = useRef<HTMLInputElement>(null)
  /**
   * The suggestion row focus should land on once the current render settles.
   *
   * A ref rather than state: setting it must not itself cause a render, and it
   * is written during an event and read in the layout effect of the very render
   * that event caused. Held by oracle id, not by element — the element the user
   * pressed is on its way out of the document, which is the whole problem.
   */
  const focusAfterAct = useRef<string | null>(null)
  /**
   * What just happened, for a screen reader.
   *
   * Its own region rather than reusing `notice`: `notice` is a visible banner
   * across the top of the workspace, and a banner for every one of 98 accepts
   * would be noise everybody learns to ignore. This one is only ever announced.
   */
  const [announcement, setAnnouncement] = useState('')

  /**
   * Locks the user has set that no server response has confirmed yet.
   *
   * A requery reads the deck when it STARTS and writes it back when it lands,
   * seconds later. Anything set in between was overwritten — lock a card during
   * a recompute and the icon sprang back open when the answer arrived. Accepts
   * never had this problem because they go through the pipeline's own buffer;
   * locks deliberately do not any more, so they need their own overlay.
   *
   * A ref, not state: it is read while applying a server response, and having
   * that read schedule another render would be a loop.
   */
  const pendingLocks = useRef(new Map<string, boolean>())

  /** Re-assert unconfirmed locks over any deck the server hands back. */
  const withPendingLocks = useCallback((d: api.Deck): api.Deck => {
    if (pendingLocks.current.size === 0) return d
    return {
      ...d,
      entries: d.entries.map((e) => {
        const locked = pendingLocks.current.get(e.oracleId)
        return locked === undefined || e.zone !== 'accepted' ? e : { ...e, locked }
      }),
    }
  }, [])
  deckRef.current = deck
  queryRef.current = query
  // This assignment was missing, and nothing caught it: columns were added to
  // the UI, the request never carried them, and every cell rendered the "no"
  // dot. Kept beside the other two so the set reads as one block.
  columnsRef.current = columns

  const load = useCallback(async (commands: readonly PendingCommand[]): Promise<QueryResult> => {
    /*
     * The version the SERVER last confirmed — not the one on screen.
     *
     * During the settle a result is deliberately held back and not applied, so
     * `deck` state still carries the version from before the batch while the
     * server has already moved on. Adding another card in that window is
     * exactly what the settle exists to allow, and it was sending the stale
     * version and getting a 409 for it. The bug was a direct consequence of
     * holding the result: the UI's version stopped being the truth the moment
     * the settle was introduced.
     */
    let current = serverDeckRef.current ?? deckRef.current
    /** What the server refused this round, so the UI can say what happened. */
    let rejected: readonly api.CommandResult['rejected'][number][] | undefined

    /*
     * Retry a failed send before giving up on the user's clicks.
     *
     * Losing a batch means the cards the user added silently disappear, so a
     * blip on the wire should not cost them work. Four attempts with the delay
     * doubling to a one-second ceiling — long enough to ride out a cold start
     * or a dropped connection, short enough that a genuine outage is reported
     * rather than hidden behind a spinner.
     *
     * The run stays unresolved for the whole of it, which is what keeps the
     * progress bar pinned at its halfway mark: the second half of the bar means
     * "the answer is in hand", and during a retry it is not.
     *
     * Only transient failures. A 400 will not become a 200 by being repeated,
     * and a 409 is handled separately — it needs a new version, not patience.
     */
    const wire = (c: PendingCommand): DeckCommand =>
      c.type === 'accept'
        ? { type: 'accept', oracleId: asOracleId(c.oracleId), origin: 'manual' }
        : c.type === 'lock'
          ? { type: 'lock', oracleId: asOracleId(c.oracleId), locked: c.locked ?? true }
          : { type: c.type, oracleId: asOracleId(c.oracleId) }

    // Commands first, as ONE batch — four accepts are one round trip, and one
    // atomic unit the server can reject or apply as a whole (doc 10 §10.3).
    if (commands.length > 0) {
      const body = commands.map(wire)
      try {
        const result = await sendWithRetry(current.id, body, current.version)
        current = result.deck
        rejected = result.rejected
      } catch (error) {
        // A 409 means only that our version is behind — the clicks are still
        // valid. Re-read the deck and send them again, rather than dropping
        // work the user did and making them click it a second time.
        if (!(error instanceof api.ApiError) || error.status !== 409) throw error
        const conflict = error.body as api.CommandConflict | null
        const fresh = await api.getDeck(current.id)

        /*
         * Rebase rather than re-send blindly (API-06, doc 12 §12.7).
         *
         * `since` is what the server accepted while we were behind. Without it
         * this could only re-send the same batch and hope: a card another
         * client had just excluded came back with no record, and a card it had
         * just added came back as a spurious `not-singleton` the user never
         * caused. `rebaseCommands` drops only the commands whose intent is
         * ALREADY TRUE — which is not discarding a user action, because the
         * state they asked for exists — and replays everything else, conflicts
         * included, since our intent is the more recent one.
         *
         * `sinceComplete === false` means the log does not cover the gap, so
         * `since` is a partial account of it. Rebasing against a partial
         * account is worse than not rebasing at all: it would drop a command
         * on the strength of history it cannot see. In that case fall back to
         * the old behaviour and re-send everything — the server still judges
         * each command, so the outcome is no worse than it was before API-06.
         */
        const rebased =
          conflict?.sinceComplete === true
            ? rebaseCommands(body, conflict.since)
            : { replay: body, superseded: [], overrides: [] }

        if (rebased.replay.length === 0) {
          // Everything we queued had already happened. Sending an empty batch
          // would be a round trip that can only answer "nothing to do".
          current = fresh
        } else {
          const result = await sendWithRetry(fresh.id, rebased.replay, fresh.version)
          current = result.deck
          // The rebase path rejects for exactly the same reasons the first
          // attempt does, and a user whose card was refused after a conflict
          // is owed the same sentence as one whose card was refused outright.
          rejected = result.rejected
        }
      }
      serverDeckRef.current = current
    }

    const [recs, ana] = await Promise.all([
      api.getRecommendations(current.id, {
        limitPerGroup: 8,
        ...(queryRef.current === '' ? {} : { query: queryRef.current }),
        ...(queryColumnsOf(columnsRef.current).length > 0
          ? { columns: queryColumnsOf(columnsRef.current) }
          : {}),
      }),
      api.getAnalysis(current.id),
    ])
    /*
     * The corpus version this answer describes, kept for the paths that have no
     * `Recommendations` of their own: the preview's card detail and the expand
     * button's own hydrate. If an ingest lands between this and one of those,
     * the worst case is that data from the NEW snapshot is briefly filed under
     * the old one — and the next recompute passes the new id, which drops it.
     * Never the reverse, so nothing older than the screen can be served.
     */
    snapshotRef.current = recs.datasetSnapshotId

    // Expansions are re-asked against the deck the recompute just produced, so
    // every row on screen describes the same deck. One extra request, and only
    // when the user has actually expanded something.
    const extra = await expansionsFor(
      current.id,
      expandedRef.current,
      queryRef.current,
      queryColumnsOf(columnsRef.current),
    )

    /*
     * Only the cards this client has never seen actually cross the wire.
     *
     * The list below is the whole page — commanders, every deck entry, every
     * suggestion, every expanded row — and it is rebuilt on EVERY recompute:
     * every accept, every reject, every filter change, every auto-query tick.
     * Sent straight to `api.hydrate` it re-downloaded a 99-card deck's names,
     * oracle text and art each time, to be told the same thing. The cache
     * filters it against what is already held at this dataset snapshot, so a
     * page nothing has changed on asks for nothing at all.
     */
    const hydrated = await hydrateCards(
      [
        ...current.commanders,
        ...current.entries.map((e) => e.oracleId),
        ...recs.groups.flatMap((g) => g.items.map((i) => i.oracleId)),
        ...[...extra.values()].flatMap((items) => items.map((i) => i.oracleId)),
      ],
      recs.datasetSnapshotId,
    )
    return { deck: current, recs, analysis: ana, hydrated, extra, rejected }
  }, [])

  const pipeline = usePipeline<PendingCommand>({
    /**
     * Say what is actually being done.
     *
     * The default said "Adding 1 card" for everything, including a rejection —
     * which told the user the opposite of what they had just clicked. A count
     * cannot tell those apart, so the label reads the commands.
     */
    describe: (queued) => {
      // Nothing queued is nothing to describe. Returning a string here — it
      // said "Preparing…" — overrode the phase-derived label for every run
      // with no clicks behind it, so the masthead's live region announced
      // "Preparing…" while idle and again through every filter recompute.
      if (queued.length === 0) return undefined
      const words: Record<PendingCommand['type'], string> = {
        accept: 'Adding',
        exclude: 'Rejecting',
        remove: 'Removing',
        restore: 'Restoring',
        lock: 'Locking',
      }
      const kinds = new Set(queued.map((c) => c.type))
      const verb = kinds.size === 1 ? words[queued[0]!.type] : 'Updating'
      const n = queued.length
      return `${verb} ${String(n)} card${n === 1 ? '' : 's'}…`
    },
    run: (commands) => load(commands),
    apply: (value) => {
      const r = value as QueryResult | null
      if (r === null) {
        // The run failed; its error is already on the bar. Drop the optimistic
        // overlay rather than leaving cards that were never saved.
        setPending([])
        return
      }
      /*
       * Never write a deck older than the one the server has confirmed.
       *
       * A run captures the deck when it STARTS. Anything written in between —
       * a lock, a deck option — produces a newer server deck, and applying the
       * captured one would undo it. `withPendingLocks` covers the case where
       * the write has not landed yet; this covers the case where it HAS, which
       * the pending overlay cannot see because a confirmed lock is no longer
       * pending.
       *
       * Version is the right comparison: it is the server's own ordering, and
       * it is what the optimistic-concurrency check uses (doc 12 §12.7).
       */
      const known = serverDeckRef.current
      const freshest = known !== null && known.version > r.deck.version ? known : r.deck
      setDeck(withPendingLocks(freshest))
      setGroups(r.recs.groups)
      setUnavailable(r.recs.unavailable)
      setAnalysis(r.analysis)
      setQueryError(r.recs.query.errors[0]?.message ?? null)
      /*
       * A plain set, and it is still an accumulate.
       *
       * `hydrateCards` returns everything the cache holds, not just what this
       * run asked about, so writing the maps through keeps every card hydrated
       * earlier in the session — and drops them all in the one case that
       * matters, when the dataset snapshot moves. Merging here instead would
       * put that rule in a second place, and the copy that forgot it would be
       * the one rendering yesterday's oracle text after an ingest.
       */
      setCards(r.hydrated.cards)
      setPrices(r.hydrated.prices)
      setImages(r.hydrated.images)
      setColumnMatches(new Map(r.recs.columns.map((c) => [c.query, new Set(c.matched)])))
      setExtraItems(r.extra)
      setPending([])
      /*
       * Say what the server refused, before the overlay that showed it working
       * disappears.
       *
       * `setPending([])` on the line above is what removes the card the user
       * watched land in their deck. Without a sentence here that removal is the
       * ONLY feedback a refusal produces, and it reads as the app losing the
       * card rather than as the app declining to break a rule.
       *
       * Named from `r.hydrated.cards`, which is this run's own hydration and
       * therefore holds the card that was just refused.
       *
       * Only the first, plus a count. A batch can be a whole import and a
       * banner of forty sentences is a banner nobody reads; the first is the
       * one that explains the SHAPE of the problem, and the count says how much
       * of it there is.
       */
      /*
       * The name-match cards are in the lookup too, and they are the ones that
       * matter most.
       *
       * Measured in a browser: adding Black Lotus from "Cards named like…"
       * produced "THAT CARD was not added — it is banned in Commander", because
       * `hydrated.cards` only ever holds the deck and the suggestion feed. A
       * card that came from `searchCards` is not in either, and a refused card
       * never joins the deck — so the one route that reaches a rejection on
       * purpose was the one route with no name to print.
       *
       * Hydration wins on a collision: it is the authority, and a name-match
       * result is a snapshot of a search that may be several queries old.
       */
      const named = new Map<string, api.Card>([...nearbyRef.current, ...r.hydrated.cards])
      const refused = rejectionNotice(r.rejected, named)
      if (refused !== null) setNotice(refused)
    },
  })

  // Initial load, and whenever the filter changes. No settle on this path —
  // there is nothing to keep adding to, so holding the result back would be lag.
  const { refresh } = pipeline
  useEffect(() => {
    // A new filter is a new question, so "more of that group" is spent — those
    // rows were the answer to the old one.
    expandedRef.current = new Set()
    setExtraItems(new Map())
    refresh()
    // `columns` belongs here for the same reason `query` does: adding one
    // changes what the server must compute. Without it a new column showed no
    // ticks until something else happened to trigger a recompute.
  }, [query, columns, refresh])

  /*
   * The two ways the column list changes, and the only two.
   *
   * Everything that adds or removes a column goes through these. They do
   * nothing today that an inline `setColumns` would not — the point is that the
   * list is becoming a persisted deck field, and when it does, the PATCH goes
   * here rather than in each of the call sites that would otherwise exist.
   */
  const addColumn = useCallback((column: Column): void => {
    setColumns((current) =>
      // Adding a column that is already there would give it two positions in
      // the sort chain, which is two different answers to "what sorts first".
      current.some((c) => columnKey(c) === columnKey(column)) ? current : [...current, column],
    )
  }, [])

  const removeColumn = useCallback((key: string): void => {
    // The survivors keep their relative order, so removing the primary sort
    // promotes the second rather than reshuffling the rest.
    setColumns((current) => current.filter((c) => columnKey(c) !== key))
  }, [])

  // Basics never change for a deck — its colour identity is fixed by its
  // commanders — so this is fetched once rather than with every recompute.
  useEffect(() => {
    void api
      .basicLands(deck.id)
      .then((r) => setBasics(r.items))
      .catch(() => setBasics([]))
  }, [deck.id])

  const act = (oracleId: string, type: PendingCommand['type']): void => {
    // A new decision supersedes the last complaint. Leaving "X was not added"
    // on screen while a different card lands successfully attaches the failure
    // to the wrong action.
    setNotice(null)
    // Applied to the view immediately. This is the whole point of the buffer:
    // the click is instant and the recompute catches up.
    setPending((current) => [...current, { type, oracleId }])
    pipeline.schedule({ type, oracleId })
  }

  /**
   * The suggestion row after this one, by oracle id.
   *
   * Read off the DOM rather than recomputed from `visibleGroups`, because the
   * destination has to be the row the user can SEE below the one they just
   * acted on — across group boundaries, past rows a decision has already
   * removed, and in whatever order the feed actually rendered. Deriving it from
   * the data would mean restating the render's own filtering and flattening,
   * and the two would drift apart the first time either changed.
   *
   * Scoped to `suggestionsRef`: the deck rail uses `.card-row` too, and landing
   * focus over there would be worse than landing it nowhere.
   *
   * Falls back to the row ABOVE for the last row in the feed, which is the only
   * remaining neighbour.
   */
  const rowAfter = (oracleId: string): string | null => {
    const root = suggestionsRef.current
    if (root === null) return null
    const rows = [...root.querySelectorAll<HTMLElement>('.card-row[data-row-id]')]
    const at = rows.findIndex((r) => r.dataset['rowId'] === oracleId)
    if (at < 0) return null
    return (rows[at + 1] ?? rows[at - 1])?.dataset['rowId'] ?? null
  }

  /**
   * Accept or reject from the suggestion feed (AGENTS.md R4, pillar P1).
   *
   * `act` alone is what the button used to call, and it left a keyboard user
   * stranded: Enter on "Add" replaced that button with a spinner — or, for
   * Reject, removed the whole row — the focused element left the document, and
   * focus fell to `<body>`. The next Tab restarted at the masthead, so
   * accepting the second of 98 suggestions cost seven tabs, the third cost
   * seven more, and so on. Nothing said the card had been added, either: the
   * only live region on the page was the progress bar.
   *
   * The fix is the pattern already in this file for the preview, which stores
   * `previewOpener` and hands focus back on close. The destination differs
   * because the situation does: there is nothing to hand focus BACK to — the
   * control is gone and its row may be gone with it — so focus goes forward, to
   * the row that has taken its place. That is also where the user is looking.
   */
  const decide = (oracleId: string, type: 'accept' | 'exclude'): void => {
    // Captured BEFORE the state change, while the feed still holds the row we
    // are acting on; afterwards its neighbours have shifted under us.
    focusAfterAct.current = rowAfter(oracleId)
    const name = cards.get(oracleId)?.name ?? 'Card'
    const size =
      optimistic.commanders.length + optimistic.entries.filter((e) => e.zone === 'accepted').length
    // The count is not decoration: it is what makes two adds in a row two
    // distinct announcements. A live region with identical text is silent the
    // second time, which is exactly when a user most needs the confirmation.
    setAnnouncement(
      type === 'accept'
        ? `${name} added. ${plural(size + 1, 'card')} in the deck.`
        : `${name} rejected. ${plural(size, 'card')} in the deck.`,
    )
    act(oracleId, type)
  }

  /**
   * Put focus on the row that replaced the one just acted on.
   *
   * A layout effect, not an effect: it runs before the browser paints, so focus
   * never visibly rests on `<body>` and a screen reader is not told about a
   * document-level focus it is about to lose again.
   *
   * Only when focus has actually been dropped. A user who tabbed away, or
   * clicked into the filter box, while the row was unmounting must not have
   * focus yanked back into the feed — so the effect claims focus only from
   * `<body>` or from an element that has left the document, which are the two
   * ways the browser signals "the thing you were on is gone".
   */
  useLayoutEffect(() => {
    const target = focusAfterAct.current
    if (target === null) return
    focusAfterAct.current = null
    const active = document.activeElement
    if (active !== null && active !== document.body && active.isConnected) return
    const root = suggestionsRef.current
    if (root === null) return
    const row = [...root.querySelectorAll<HTMLElement>('.card-row[data-row-id]')].find(
      (r) => r.dataset['rowId'] === target,
    )
    // `Add` by preference — it is the action the user is repeating. A row whose
    // own command is still in flight has a spinner where its buttons were, so
    // any focusable control in it is better than none.
    const next =
      row?.querySelector<HTMLElement>('button.accept') ??
      row?.querySelector<HTMLElement>('button') ??
      null
    // Nothing left in the feed to land on: back to the control that produced
    // it, which is a real place to be rather than the top of the document.
    ;(next ?? filterRef.current)?.focus()
  })

  /**
   * Move a basic to an exact count.
   *
   * Emitted as N discrete commands rather than a "set count" verb: the batch is
   * already atomic (doc 10 §10.3), and `remove` means one copy (ADR-0012), so
   * the difference IS the command list. Decrement uses `remove`, never
   * `exclude` — reducing Mountains must not ban Mountains.
   */
  const setBasicCount = (oracleId: string, next: number): void => {
    const current = optimistic.entries.filter(
      (e) => e.oracleId === oracleId && e.zone === 'accepted',
    ).length
    const delta = next - current
    if (delta === 0) return

    const type: PendingCommand['type'] = delta > 0 ? 'accept' : 'remove'
    const commands = Array.from({ length: Math.abs(delta) }, () => ({ type, oracleId }))
    setPending((queued) => [...queued, ...commands])
    for (const c of commands) pipeline.schedule(c)
  }

  /**
   * Lock or unlock a card — applied at once, and NOT through the pipeline.
   *
   * Locking changes nothing the suggestions are computed from. It does not add
   * or remove a card, so the pool, the composition counts, the curve and every
   * score are identical either side of it. Running the staged requery for a
   * lock spent a round trip and up to four seconds of settle to arrive at the
   * list already on screen.
   *
   * What it DOES change — the gold overlays, and whether this card shows a cut
   * hint — is derived on the client from the deck itself, so it lands on the
   * click. The command still goes to the server, because the lock has to
   * survive a reload; it just does not hold anything up.
   */
  const toggleLock = (oracleId: string, locked: boolean): void => {
    const before = serverDeckRef.current ?? deckRef.current
    pendingLocks.current.set(oracleId, locked)
    // Marks the row as in flight, which is what draws its spinner.
    setLocking((current) => new Set(current).add(oracleId))
    setDeck((d) => ({
      ...d,
      entries: d.entries.map((e) =>
        e.oracleId === oracleId && e.zone === 'accepted' ? { ...e, locked } : e,
      ),
    }))

    const finish = (): void => {
      pendingLocks.current.delete(oracleId)
      setLocking((current) => {
        const next = new Set(current)
        next.delete(oracleId)
        return next
      })
    }

    void sendWithRetry(
      before.id,
      [{ type: 'lock', oracleId: asOracleId(oracleId), locked }],
      before.version,
    )
      .then((r) => {
        finish()
        serverDeckRef.current = r.deck
        setDeck(r.deck)
        // The lock worked, so whatever failed before it is no longer the state
        // of the world. Leaving a stale error next to a control that just
        // succeeded teaches people to ignore errors.
        setNotice(null)
        pipeline.clearError()
      })
      .catch(() => {
        finish()
        /*
         * Reconcile against the server rather than guessing.
         *
         * The old code restored the deck it had captured before the click,
         * which is only right if nothing else changed in between — and an
         * accept batch may well have landed while this was retrying. Re-reading
         * gives the actual state; falling back to the captured deck is for when
         * even that fails, which means the network is gone and a stale view is
         * the best available answer.
         */
        void api
          .getDeck(before.id)
          .then((fresh) => {
            serverDeckRef.current = fresh
            setDeck(withPendingLocks(fresh))
          })
          .catch(() => setDeck(before))
        setNotice('That lock did not save.')
      })
  }

  /**
   * Take a card out of the excluded list and put it straight into the deck.
   *
   * Two commands in one batch, in order. The domain folds a batch one command
   * at a time, so `restore` lands first and leaves the card absent, and the
   * `accept` that follows is then a legal move on a card that is no longer
   * excluded — which it would not be the other way round, and would not be at
   * all if these were sent as two separate batches with a recompute between.
   */
  const restoreIntoDeck = (oracleId: string): void => {
    setPending((queued) => [...queued, { type: 'restore', oracleId }, { type: 'accept', oracleId }])
    pipeline.schedule({ type: 'restore', oracleId })
    pipeline.schedule({ type: 'accept', oracleId })
  }

  /** The roles the analysis says are short — one `fills-` group each. */
  const shortRoles = (a: api.Analysis): string[] =>
    a.targets.filter((t) => t.actual < t.min).map((t) => dimensionName(t.dimension))

  /*
   * Fires on the FIRST analysis to arrive after a target save, and only then.
   *
   * The dependency is `analysis` alone: setting the baseline does not change
   * it, so this cannot run against the response that was already on screen, and
   * the ref is cleared on the way through so a later unrelated refresh does not
   * re-announce a change nobody just made.
   */
  useEffect(() => {
    const baseline = targetsBaselineRef.current
    if (baseline === null || analysis === null) return
    targetsBaselineRef.current = null

    const now = shortRoles(analysis)
    const appeared = now.filter((r) => !baseline.short.includes(r))
    const gone = baseline.short.filter((r) => !now.includes(r))
    const cutDelta = analysis.cuts.length - baseline.cuts

    const parts: string[] = []
    if (appeared.length > 0) parts.push(`${appeared.join(', ')} now needs cards`)
    if (gone.length > 0) parts.push(`${gone.join(', ')} no longer does`)
    if (cutDelta !== 0) {
      parts.push(`${cutDelta > 0 ? '+' : ''}${String(cutDelta)} cut hints`)
    }
    setTargetsChange(
      parts.length === 0
        ? 'Targets saved. Nothing else moved.'
        : `Targets saved — ${parts.join('; ')}.`,
    )
  }, [analysis])

  const setDeckOption = (body: Parameters<typeof api.patchDeck>[1]): void => {
    void api
      .patchDeck(deck.id, body)
      .then((d) => {
        /*
         * The patched deck is now what the server holds, so `serverDeckRef` has
         * to learn it too.
         *
         * Without this, ticking "Exclude Universes Beyond" appeared to work and
         * then undid itself: the refresh that follows reads `serverDeckRef` for
         * the deck it returns, that ref still held the deck from before the
         * PATCH, and applying the result wrote the old flag straight back over
         * the new one. Every write that changes the server's deck has to update
         * this — the lock path does, and this one did not.
         */
        serverDeckRef.current = d
        setDeck(withPendingLocks(d))
        pipeline.refresh()
      })
      .catch(() => undefined)
  }

  /**
   * Export the deck as plain text, formatted by the DOMAIN's own formatter.
   *
   * No endpoint for it: `web` and `api` share `packages/domain`, so the client
   * formats the list itself and the two cannot produce different files. Copy
   * first, because copying is what people actually do with a decklist
   * (doc 15 §15.4).
   */
  const exportDeck = (): void => {
    const counts = new Map<string, number>()
    for (const e of optimistic.entries) {
      if (e.zone !== 'accepted') continue
      counts.set(e.oracleId, (counts.get(e.oracleId) ?? 0) + 1)
    }
    const nameOf = (id: string): string =>
      cards.get(id)?.name ?? basics.find((b) => b.oracleId === id)?.name ?? 'Unknown card'

    const text = formatDecklist(
      {
        name: deck.name,
        entries: [
          ...deck.commanders.map((id) => ({
            oracleId: id as never,
            name: nameOf(id),
            quantity: 1,
            isCommander: true,
            category: null,
            setCode: null,
            collectorNumber: null,
          })),
          ...[...counts].map(([id, quantity]) => ({
            oracleId: id as never,
            name: nameOf(id),
            quantity,
            isCommander: false,
            category: null,
            setCode: null,
            collectorNumber: null,
          })),
        ],
      },
      'text',
    )

    void navigator.clipboard
      .writeText(text)
      .then(() => setNotice(`Copied ${plural(counts.size + deck.commanders.length, 'line')}`))
      .catch(() => setNotice('Could not copy — the browser blocked clipboard access'))
  }

  /**
   * Open the preview NOW, from what is already in memory.
   *
   * `/cards/batch` returns whole cards and every deck card and suggestion has
   * already been hydrated, so the client is holding the name, type line, mana
   * cost, oracle text and synergy tags before the click happens — eight of the
   * ten things the preview renders. Waiting on a request to show text we
   * downloaded minutes ago is latency we invented.
   *
   * Only printings and combos have to come from the server; they arrive second
   * and slot in. That also means a card whose fetch fails still previews.
   */
  const open = (oracleId: string): void => {
    // Remember what the user was on so closing can put them back. Nothing that
    // calls `open` lives inside the preview, so this is always a row in the
    // deck, the suggestions or a name-match list, never the panel itself.
    const active = document.activeElement
    previewOpener.current = active instanceof HTMLElement ? active : null
    setInspect(oracleId)
    setDetail(null)
    // Through the cache: printings and combos are corpus data like everything
    // else, and clicking along a row of suggestions and back re-asked for each
    // one. This is the only combo payload that IS its own request — the ones on
    // a recommendation and on the analysis already ride inside responses the
    // app fetches anyway.
    void cardDetail(oracleId, snapshotRef.current)
      .then((d) => {
        // Ignore a response for a card the user has already navigated away
        // from — two quick clicks otherwise race, and the loser wins.
        setInspect((current) => {
          if (current === d.oracleId) setDetail(d)
          return current
        })
      })
      .catch(() => undefined)
  }

  /*
   * Closing puts focus back on the card that opened the panel.
   *
   * Without this the Close button unmounts under the caret and focus falls to
   * `<body>`, which on a long deck list means the next Tab starts again from
   * the masthead. That was already true on the rail; it becomes unusable once
   * the panel is a sheet that opening moved focus into.
   */
  const closePreview = useCallback((): void => {
    setInspect(null)
    setDetail(null)
    const opener = previewOpener.current
    previewOpener.current = null
    // A card removed from the deck while its preview was open leaves a detached
    // button behind; focusing it would silently drop focus to nowhere.
    if (opener !== null && opener.isConnected) opener.focus()
  }, [])

  /** The deck as the user sees it: saved entries plus what is still in flight. */
  const optimistic = useMemo(() => {
    let entries = [...deck.entries]
    for (const p of pending) {
      if (p.type === 'accept') {
        entries.push({ oracleId: p.oracleId, zone: 'accepted', locked: false })
      } else if (p.type === 'lock') {
        entries = entries.map((e) =>
          e.oracleId === p.oracleId && e.zone === 'accepted'
            ? { ...e, locked: p.locked ?? true }
            : e,
        )
      } else if (p.type === 'restore') {
        // excluded -> absent, which makes it a candidate again. Matching the
        // domain's fold exactly, so the optimistic view and the server agree.
        entries = entries.filter((e) => !(e.oracleId === p.oracleId && e.zone === 'excluded'))
      } else if (p.type === 'remove') {
        // One copy, and nothing recorded — the card stays suggestible.
        const at = entries.findIndex((e) => e.oracleId === p.oracleId && e.zone === 'accepted')
        if (at >= 0) entries.splice(at, 1)
      } else {
        const at = entries.findIndex((e) => e.oracleId === p.oracleId && e.zone === 'accepted')
        if (at >= 0) entries.splice(at, 1)
        entries = entries.filter((e) => e.oracleId !== p.oracleId)
        entries.push({ oracleId: p.oracleId, zone: 'excluded', locked: false })
      }
    }
    return { ...deck, entries }
  }, [deck, pending])

  const inFlight = useMemo(() => new Set(pending.map((p) => p.oracleId)), [pending])

  const lockedIds = useMemo(
    () =>
      new Set(
        optimistic.entries.filter((e) => e.zone === 'accepted' && e.locked).map((e) => e.oracleId),
      ),
    [optimistic],
  )
  /**
   * Cut hints by card — with locked cards removed here, not on the server.
   *
   * The server already omits locked cards from `analysis.cuts`, but that
   * analysis is only as fresh as the last recompute, and locking deliberately
   * no longer triggers one. So the hint sat there after the click that was
   * supposed to dismiss it, which is the whole point of the lock: it is how the
   * user says "stop asking about this one", and it has to be obeyed on the
   * click rather than whenever the server next agrees.
   */
  const cutBy = useMemo(
    () =>
      new Map(
        (analysis?.cuts ?? [])
          .filter((c) => !lockedIds.has(c.oracleId))
          // One fault is usually not a signal — see `cutThreshold`.
          .filter((c) => c.reasons.length >= cutThreshold)
          .map((c) => [c.oracleId, c]),
      ),
    [analysis, lockedIds, cutThreshold],
  )

  const basicIds = useMemo(() => new Set(basics.map((b) => b.oracleId)), [basics])

  /**
   * The three "Completes N combos" groups, shown as one.
   *
   * The split was a ranking device that leaked into the layout: three headers,
   * three counts, and the same answer to the same question — "this card
   * finishes something". The degree is already on every row as a brass badge,
   * so merging loses nothing and the rows still sort hardest-won first.
   *
   * Done here rather than in `recommend`, which keeps its three keys. They are
   * how the domain ORDERS candidates, and collapsing them there would throw
   * away the ordering to change a heading.
   *
   * "One card away" stays separate — it is a different claim, about a combo the
   * deck cannot make yet.
   */
  const shownGroups = useMemo(() => {
    const combo = groups.filter((g) => g.key.startsWith('combo-'))
    if (combo.length === 0) return groups
    const merged: api.Group = {
      ...combo[0]!,
      key: 'combo',
      label: 'Completes combos',
      total: combo.reduce((n, g) => n + g.total, 0),
      rationale: 'Adding one of these finishes a combo using only cards already in your deck.',
      /*
       * Half the rows the three groups would have shown between them.
       *
       * Merging tripled the region: three groups of eight became a wall of
       * twenty-four, all making the same claim, pushing every other group off
       * the screen. Halved, the strongest combo cards still lead the list and
       * the gaps below them are reachable without scrolling past them.
       */
      items: combo
        .flatMap((g) => g.items)
        .sort((a, b) => b.comboDegree - a.comboDegree || b.score - a.score)
        .slice(0, Math.ceil(combo.reduce((n, g) => n + g.items.length, 0) / 2)),
    }
    const rest = groups.filter((g) => !g.key.startsWith('combo-'))
    // Back where the strongest of the three sat, not appended to the end.
    const at = groups.findIndex((g) => g.key.startsWith('combo-'))
    return [...rest.slice(0, at), merged, ...rest.slice(at)]
  }, [groups])

  /**
   * Every group, with any rows an expand fetched folded in.
   *
   * A group with nothing in it is KEPT and drawn collapsed rather than removed.
   * A category the deck has satisfied is a result worth seeing — "you have
   * enough removal" is the answer to a question the user is asking — and
   * deleting its heading turns that answer into silence, so the group appears
   * to have been lost rather than finished.
   *
   * The one case where empty headings really are noise is a filter that matches
   * nothing, and that is handled separately by the empty-search panel below,
   * which replaces the whole list rather than showing nine "(0)"s.
   */
  const visibleGroups = useMemo(
    () =>
      shownGroups.map((g) => {
        const extra = extraItems.get(g.key)
        if (extra === undefined) return g
        const seen = new Set(g.items.map((i) => i.oracleId))
        return { ...g, items: [...g.items, ...extra.filter((i) => !seen.has(i.oracleId))] }
      }),
    [shownGroups, extraItems],
  )

  /**
   * The same groups, with each one's rows put in column order.
   *
   * The groups themselves are NOT reordered and no row moves between them
   * (doc 05 §5.3, pillar P5) — the sort happens inside each heading, because
   * the headings are the app's argument about what this deck needs and a text
   * query does not get to re-decide that.
   *
   * Rows an expand fetched are folded in above, so they sort with everything
   * else rather than sitting in a block at the end.
   */
  const sortedGroups = useMemo(
    () =>
      columns.length === 0
        ? visibleGroups
        : visibleGroups.map((g) => ({
            ...g,
            items: [...sortByColumns(g.items, columns, columnMatches)],
          })),
    [visibleGroups, columns, columnMatches],
  )

  /** Whether anything is left to show under a heading, filters applied. */
  const rowsIn = (g: api.Group): number =>
    g.items.filter((item) => {
      const decided = optimistic.entries.find((e) => e.oracleId === item.oracleId)
      return decided === undefined || decided.zone !== 'excluded'
    }).length

  /**
   * The gap a `fills-<dimension>` heading names, as the last analysis measured
   * it. `null` for a heading that names no gap at all — a combo group is not
   * short of anything, so "satisfied" is not a thing that can be true of it.
   *
   * The key's suffix IS the dimension name: `labelFor` in the domain builds
   * `fills-<dimensionLabel(d)>` and looks the deficit up by exactly that
   * string, so reading it back the same way is not a guess. Read from
   * `analysis.deficits` rather than parsed out of the label text — the label
   * already prints the number, and two readings of one fact drift.
   */
  const gapIn = (g: api.Group): number | null => {
    if (analysis === null || !g.key.startsWith('fills-')) return null
    const name = g.key.slice('fills-'.length)
    const deficit = analysis.deficits.find((d) => dimensionName(d.dimension) === name)
    return deficit === undefined ? 0 : Math.max(0, -deficit.delta)
  }

  /**
   * Why a heading has no rows under it.
   *
   * This used to be one test — `rowsIn(g) === 0` — driving one badge that said
   * SATISFIED, and it conflated four situations that call for four different
   * reactions from the user. The worst of them was the third: with the API
   * down, every heading claimed the deck's every need was met, at the exact
   * moment the app knew nothing at all, with a small `Request failed (502)` as
   * the only contradiction.
   *
   *   stale     the last run failed. We do not know what is in this group, so
   *             nothing may be claimed about it — including that it is fine.
   *   filtered  the server had candidates here and the FILTER took every one.
   *             `total` is the count matching the query before `limitPerGroup`
   *             (see `CandidateGroup` in the domain), and the server only emits
   *             a group at all if it has members or withheld some — so with a
   *             query active, `total === 0` means precisely "your query, not
   *             your deck". The gap is untouched and is still reported.
   *   short     nothing to show, and the gap this heading names is still open.
   *             The one the repro caught: `Fills gap · land -27` and SATISFIED
   *             on the same line.
   *   decided   rows were offered here and you acted on all of them.
   *   satisfied no filter, no failure, no measurable gap left. The honest one,
   *             and the only case that keeps the badge.
   *
   * Order matters and is from least to most knowledge: a failure outranks a
   * filter because a failed run's `total` describes a question we no longer
   * know the answer to.
   */
  const emptinessOf = (
    g: api.Group,
  ): 'rows' | 'stale' | 'filtered' | 'short' | 'decided' | 'satisfied' => {
    if (rowsIn(g) > 0) return 'rows'
    // No analysis is not "no gap" either: without it the deficit is unreadable,
    // so the honest answer is the same one a failed run gets.
    if (pipeline.error !== null || analysis === null) return 'stale'
    if (query.trim() !== '' && g.total === 0) return 'filtered'
    const gap = gapIn(g)
    if (gap !== null && gap > 0) return 'short'
    return g.total > 0 ? 'decided' : 'satisfied'
  }

  /** Collapsed by choice, or because there is nothing under the heading. */
  const isCollapsed = (g: api.Group): boolean => collapsed.has(g.key) || rowsIn(g) === 0

  const toggleCollapsed = (key: string): void =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  /**
   * Ask the server for more rows, in one group and only that group.
   *
   * The default eight per group is a budget shared across nine headings. When
   * the user says "more of THIS", the budget is no longer the right shape, so
   * the request narrows to the one key rather than raising the limit
   * everywhere and quadrupling a recompute the user did not ask for.
   */
  const expandGroup = (key: string): void => {
    setExpanding(key)
    setCollapsed((current) => {
      if (!current.has(key)) return current
      const next = new Set(current)
      next.delete(key)
      return next
    })
    // Recorded so every later recompute re-asks for it. Without this the rows
    // would be frozen at the deck they were chosen for.
    const keys = new Set([...expandedRef.current, key])
    expandedRef.current = keys
    void expansionsFor(
      deckRef.current.id,
      new Set([key]),
      queryRef.current,
      queryColumnsOf(columnsRef.current),
    )
      .then(async (fetched) => {
        const items = fetched.get(key) ?? []
        // These are cards nothing has hydrated, so their rows would read
        // "Loading…" for good — no later recompute asks for them by name.
        // Through the cache: an expansion re-opened after a recompute is the
        // commonest case there is, and it should cost nothing the second time.
        const hydrated = await hydrateCards(
          items.map((i) => i.oracleId),
          snapshotRef.current,
        )
        // Merged, not written through, because this path is also taken when
        // the snapshot is null — the corpus has never been ingested, nothing is
        // cacheable, and `hydrateCards` then returns ONLY these rows. Writing
        // that through would blank the deck.
        setCards((current) => new Map([...current, ...hydrated.cards]))
        setPrices((current) => new Map([...current, ...hydrated.prices]))
        setImages((current) => new Map([...current, ...hydrated.images]))
        setExtraItems((current) => new Map(current).set(key, items))
      })
      .catch(() => undefined)
      .finally(() => setExpanding(null))
  }

  /** Headings that still have rows — what "the list is empty" actually means. */
  const groupsWithRows = visibleGroups.filter((g) => rowsIn(g) > 0)

  /**
   * When a search finds nothing, say whether the card exists at all.
   *
   * "No results" is two different answers wearing one face: the card is not in
   * Magic, or the card is real and simply not a candidate for THIS deck —
   * already in it, excluded, or outside the commander's colours. Those need
   * different reactions from the user, and the app knows which is which.
   *
   * `searchCards` is a name search over the whole corpus, so it answers the
   * first question directly. If the exact text finds nothing, progressively
   * shorter prefixes are tried — that is what turns a typo into "did you mean
   * Sekki, Seasons' Guide?" without needing fuzzy matching in the database.
   */
  const [nearby, setNearby] = useState<{ term: string; items: api.Card[] } | null>(null)

  /*
   * Kept in a ref as well, so a rejection can name a card that only ever came
   * from the name search. ACCUMULATED rather than replaced: the user may search
   * again while the batch for the previous search's Add is still in flight, and
   * the name they need is the one from the search they clicked in.
   */
  useEffect(() => {
    if (nearby === null) return
    nearbyRef.current = new Map([
      ...nearbyRef.current,
      ...nearby.items.map((c): [string, api.Card] => [c.oracleId, c]),
    ])
  }, [nearby])

  useEffect(() => {
    const term = query.trim()
    // A bare name, not a fielded query. `t:creature` is a filter and has no
    // "matching cards" to list; a name does.
    const isName = term !== '' && !/[:<>=]/.test(term)
    if (!isName) {
      setNearby(null)
      return
    }
    let cancelled = false
    // One call. `searchCards` falls back to trigram similarity itself when the
    // literal search finds nothing, so a typo is the server's problem, not a
    // ladder of guesses from the client.
    void api
      .searchCards(term, { limit: 5 })
      .then((found) => {
        if (!cancelled) setNearby({ term, items: found.items })
      })
      .catch(() => {
        if (!cancelled) setNearby(null)
      })
    return () => {
      cancelled = true
    }
  }, [query])

  /** Accepted cards by id, for the preview's "works with your deck" pass. */
  const acceptedIds = useMemo(
    () =>
      new Set([
        ...optimistic.commanders,
        ...optimistic.entries.filter((e) => e.zone === 'accepted').map((e) => e.oracleId),
      ]),
    [optimistic],
  )

  /**
   * Rejected cards by id, for the name-match rows.
   *
   * From the OPTIMISTIC deck, like `acceptedIds`: a card rejected a moment ago
   * has to offer "Add it back" rather than a plain Add on the very next render,
   * or the click that follows is refused for `previously-excluded`.
   */
  const excludedIds = useMemo(
    () => new Set(optimistic.entries.filter((e) => e.zone === 'excluded').map((e) => e.oracleId)),
    [optimistic],
  )

  /**
   * The gold overlays, derived here rather than read from the analysis.
   *
   * The server sends `locked` counts too, but they only change when a recompute
   * lands — so locking a card left the gold untouched for seconds, or until the
   * next accept. These come from the deck the user is looking at, so they move
   * on the click.
   *
   * `dimensionKeysOf` is imported from the domain rather than reimplemented:
   * the keys have to match the ones the server put on its targets, and an
   * overlay counted by a second rule can exceed the bar under it.
   */
  const lockedByDimension = useMemo(() => {
    const counts = new Map<string, number>()
    for (const entry of optimistic.entries) {
      if (entry.zone !== 'accepted' || !entry.locked) continue
      if (optimistic.commanders.includes(entry.oracleId)) continue
      const card = cards.get(entry.oracleId)
      if (card === undefined) continue
      for (const key of dimensionKeysOf(card)) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [optimistic, cards])

  /** The same, for the curve. Lands have no bucket, exactly as on the server. */
  const lockedByBucket = useMemo(() => {
    const buckets = new Array<number>(8).fill(0)
    for (const entry of optimistic.entries) {
      if (entry.zone !== 'accepted' || !entry.locked) continue
      if (optimistic.commanders.includes(entry.oracleId)) continue
      const card = cards.get(entry.oracleId)
      if (card === undefined || card.types.includes('land')) continue
      const bucket = Math.min(7, Math.max(0, Math.floor(card.manaValue)))
      buckets[bucket] = (buckets[bucket] ?? 0) + 1
    }
    return buckets
  }, [optimistic, cards])

  const accepted = optimistic.entries.filter((e) => e.zone === 'accepted')
  const excluded = optimistic.entries.filter((e) => e.zone === 'excluded')
  const deckSize = accepted.length + optimistic.commanders.length

  /** Group the deck by card type, collapsing duplicates to a count. */
  const sections = useMemo(() => {
    const byKey = new Map<string, Map<string, number>>()
    const put = (key: string, oracleId: string): void => {
      const lines = byKey.get(key) ?? new Map<string, number>()
      lines.set(oracleId, (lines.get(oracleId) ?? 0) + 1)
      byKey.set(key, lines)
    }
    for (const id of deck.commanders) put('commander', id)
    for (const e of accepted) {
      // Basics have their own section with its own controls; listing them twice
      // would make the counts disagree with each other.
      if (basicIds.has(e.oracleId)) continue
      put(sectionOf(cards.get(e.oracleId)), e.oracleId)
    }

    return DECK_SECTIONS.map((section) => ({
      ...section,
      lines: [...(byKey.get(section.key) ?? new Map<string, number>())]
        .map(([oracleId, copies]): DeckLine => ({ oracleId, copies }))
        .sort((a, b) =>
          (cards.get(a.oracleId)?.name ?? '').localeCompare(cards.get(b.oracleId)?.name ?? ''),
        ),
    })).filter((section) => section.lines.length > 0)
  }, [deck.commanders, accepted, cards])

  /**
   * The order `Tab` walks the deck web's nodes in (doc 17 §17.6).
   *
   * Derived from `sections` — the very array the rail renders — rather than
   * re-sorted in the web module. Doc 17 says tab order is DECK order because
   * layout order is a physics accident, and "the order the user already knows
   * from the list" is only true by construction if it is literally the list's
   * own order. Two sorts agreeing today is two sorts drifting tomorrow.
   */
  const deckWebOrder = useMemo(
    () => sections.flatMap((section) => section.lines.map((line) => line.oracleId)),
    [sections],
  )

  /**
   * Which composition bars to show.
   *
   * A role drops out once it is FULLY LOCKED — every card counted toward it has
   * been committed, so there is nothing left to decide there. The checkbox
   * additionally hides roles that merely meet their target but are not locked,
   * which is what you want late in a build when only the shortfalls matter.
   */
  const compositionRows = useMemo(() => {
    const rows = (analysis?.targets ?? []).map((t) => {
      const name = dimensionName(t.dimension)
      // The client's count, not the server's — the server's is a snapshot from
      // the last recompute, and a lock has to show up before the next one.
      const locked = lockedByDimension.get(dimensionKeyOf(t.dimension)) ?? t.locked
      const settled = locked >= t.actual && t.actual >= t.min
      const filled = t.actual >= t.min
      return { ...t, locked, name, settled, filled }
    })
    return rows
      .filter((r) => !r.settled)
      .filter((r) => !(hideSettledRoles && r.filled))
      .sort((a, b) => a.actual / Math.max(1, a.ideal) - b.actual / Math.max(1, b.ideal))
      .slice(0, 12)
  }, [analysis, hideSettledRoles, lockedByDimension])

  const budget = deck.budget
  const overCard =
    budget?.maxCardUsd !== null && budget?.maxCardUsd !== undefined
      ? accepted.filter((e) => (prices.get(e.oracleId) ?? 0) > budget.maxCardUsd!).length
      : 0

  return (
    <>
      <header className="masthead">
        <h1 className="wordmark">
          Lotus <span>Wizard</span>
        </h1>
        <DeckMenu
          deck={deck}
          cardCount={deckSize}
          onSwitch={(id) => onSwitch?.(id)}
          onNew={() => onNew?.()}
          onRename={(body) => setDeckOption(body)}
        />
        <ProgressBar phase={pipeline.phase} progress={pipeline.progress} label={pipeline.label} />
        <span className="meta deck-count">{deckSize} / 100 CARDS</span>
        {/* The bracket the builder chose was printed here as a bare number and
            connected to nothing. It now carries the one check the format
            publishes a rule for, and opens the panel that says what the other
            four are (doc 03 §3.2). */}
        {analysis?.bracket === undefined ? null : (
          // Isolated: this chip reads fields a server may not send, and an
          // unguarded read here used to unmount the entire workspace. The `??`
          // guards are the fix for that field; the boundary is the fix for the
          // class, because the next missing field is one nobody has thought of.
          <Boundary name="The bracket chip">
            <BracketChip bracket={analysis.bracket} onOpen={revealBracket} />
          </Boundary>
        )}
        <button className="act" onClick={() => setImporting(true)}>
          Import
        </button>
        <button className="act" onClick={exportDeck}>
          Export
        </button>
        {/* Doc 17 §17.1: the mode is entered from a control in the masthead and
            left the same way. `aria-pressed` rather than two buttons, because
            it is one thing being turned on and off.

            Labelled "Graph", not "Web": on a page served over the web, in an
            app whose other masthead controls are Import and Export, "Web" reads
            as a destination rather than as a view of the deck. The ROUTE stays
            `#web` and so do the module and the class names — a bookmark that
            stopped working would be a real cost for a wording change. */}
        <button
          className="act"
          aria-pressed={webMode}
          title={webMode ? 'Back to the deck list' : "See the deck as a graph of what it's doing"}
          onClick={() => (webMode ? leaveDeckWeb() : enterDeckWeb())}
        >
          Graph
        </button>
      </header>

      {tuningTargets && analysis !== null ? (
        <TargetSheet
          analysis={analysis}
          // From the domain's own table, so the preset the sheet shows is the
          // one `curveTarget` would have used — not a number retyped here.
          archetypePreset={archetypeTolerance(
            deck.archetype as Parameters<typeof archetypeTolerance>[0],
          )}
          onClose={() => setTuningTargets(false)}
          onSave={(overrides) => {
            targetsBaselineRef.current = { short: shortRoles(analysis), cuts: analysis.cuts.length }
            setTuningTargets(false)
            // Wholesale, and through the ordinary deck-option path: a target is
            // a property of the deck, not an operation on its contents, so it
            // does NOT go through the command batch (doc 16).
            setDeckOption({ targetOverrides: overrides })
          }}
        />
      ) : null}

      {importing ? (
        <ImportDialog
          deckId={deck.id}
          onClose={() => setImporting(false)}
          onCommit={(resolved) => {
            // Straight through the ordinary command path, so an import is one
            // batch and is undone exactly like any other (doc 10 §10.3).
            const commands = resolved.flatMap((r) =>
              Array.from({ length: r.quantity }, () => ({
                type: 'accept' as const,
                oracleId: r.oracleId,
              })),
            )
            setPending((queued) => [...queued, ...commands])
            for (const c of commands) pipeline.schedule(c)
          }}
        />
      ) : null}

      {/* Accepting a card is a change to the deck with no visible confirmation
          of its own — the row grows a spinner and the count in the masthead
          ticks over, neither of which a screen reader is watching. This says it.
          Always mounted: a live region only announces text that changes INSIDE
          an already-present region, so one that appears with its message is
          routinely missed. */}
      <p className="sr" role="status" aria-live="polite">
        {announcement}
      </p>

      {notice !== null ? (
        <p className="banner note" role="status">
          {notice}
          {/* A banner with no way out is a banner that becomes furniture. The
              other one — `pipeline.error` — is cleared by the next successful
              run, but this one can outlive the thing it is about. */}
          <button className="act" onClick={() => setNotice(null)} aria-label="Dismiss this message">
            OK
          </button>
        </p>
      ) : null}

      {pipeline.error !== null ? (
        <p className="banner problem" role="status">
          {pipeline.error}
        </p>
      ) : null}

      {/* Doc 17. A MODE: it replaces everything below the masthead, entered and
          left at `#web`. The workspace below is hidden rather than unmounted —
          remounting it would drop the in-flight recommendation request and
          re-run the whole pipeline to redraw data the web already holds. */}
      {webMode ? (
        <DeckWeb
          deckId={deck.id}
          deckName={deck.name}
          order={deckWebOrder}
          accepted={accepted.map((e) => e.oracleId)}
          commanders={optimistic.commanders}
          cards={cards}
          combos={analysis?.deckCombos ?? []}
          images={images}
          onLeave={leaveDeckWeb}
        />
      ) : null}

      <div className="workspace" hidden={webMode}>
        <section className="region" aria-label="Deck">
          <h2>Deck · {deckSize}</h2>

          {/* How noisy the cut hints are allowed to be. Sits with the deck
              because that is the list it changes. */}
          <label className="cut-threshold">
            <span>
              Cut hints at{' '}
              <strong>
                {cutThreshold}+ {cutThreshold === 1 ? 'fault' : 'faults'}
              </strong>
            </span>
            <input
              type="range"
              min={1}
              max={4}
              step={1}
              value={cutThreshold}
              onChange={(e) => setCutThreshold(Number(e.target.value))}
              aria-label="How many faults a card needs before its cut hints are shown"
              title="A card that completes a combo often has no derived synergy, and vice versa — so a single fault is usually not a signal."
            />
          </label>
          {sections.map((section) => (
            <div className="deck-section" key={section.key}>
              <h3>
                {section.label}
                <span className="count">{section.lines.reduce((n, l) => n + l.copies, 0)}</span>
              </h3>
              {section.lines.map((line) => (
                <div className="card-row" key={line.oracleId}>
                  {line.copies > 1 ? <span className="copies">{line.copies}×</span> : null}
                  <button
                    className="name as-link"
                    onClick={() => open(line.oracleId)}
                    aria-label={`Preview ${cards.get(line.oracleId)?.name ?? 'card'}`}
                  >
                    {cards.get(line.oracleId)?.name ?? 'Loading…'}
                    {/* Only ever on an unlocked card: locking is how the user
                        says "stop asking about this one". */}
                    {cutBy.has(line.oracleId) ? (
                      <span className="reasons">
                        {cutBy
                          .get(line.oracleId)!
                          .reasons.slice(0, 2)
                          .map((r, i) => (
                            <span className="reason cut" key={i}>
                              {cutText(r)}
                            </span>
                          ))}
                      </span>
                    ) : null}
                  </button>
                  <Costs
                    manaCost={cards.get(line.oracleId)?.manaCost}
                    price={prices.get(line.oracleId)}
                  />
                  {section.key === 'commander' ? null : (
                    <>
                      {/* A lock in flight shows a spinner instead of the
                          diamond: the click already changed the icon, so
                          without this there is no way to tell a saved lock from
                          one still being retried. */}
                      {locking.has(line.oracleId) ? (
                        <span
                          className="spinner"
                          role="status"
                          aria-label={`Saving lock for ${cards.get(line.oracleId)?.name ?? 'card'}`}
                        />
                      ) : (
                        <button
                          className="act lock"
                          data-locked={lockedIds.has(line.oracleId)}
                          onClick={() => toggleLock(line.oracleId, !lockedIds.has(line.oracleId))}
                          aria-label={
                            lockedIds.has(line.oracleId)
                              ? `Unlock ${cards.get(line.oracleId)?.name ?? 'card'}`
                              : `Lock ${cards.get(line.oracleId)?.name ?? 'card'}, hiding its cut hint`
                          }
                          title={
                            lockedIds.has(line.oracleId)
                              ? 'Locked — this card is staying, so it is never suggested as a cut'
                              : 'Lock this card to keep it and hide its cut hint'
                          }
                        >
                          {lockedIds.has(line.oracleId) ? '\u25C6' : '\u25C7'}
                        </button>
                      )}
                      <button
                        className="act exclude"
                        onClick={() => act(line.oracleId, 'exclude')}
                        aria-label={`Remove ${cards.get(line.oracleId)?.name ?? 'card'}`}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          ))}
          {accepted.length === 0 ? (
            <p className="note">Nothing accepted yet. Suggestions are in the middle.</p>
          ) : null}

          {basics.length > 0 ? (
            <div className="deck-section">
              <h3>
                Basic lands
                <span className="count">
                  {accepted.filter((e) => basicIds.has(e.oracleId)).length}
                </span>
              </h3>
              {basics.map((b) => (
                <BasicRow
                  key={b.oracleId}
                  card={b}
                  count={accepted.filter((e) => e.oracleId === b.oracleId).length}
                  onSet={(next) => setBasicCount(b.oracleId, next)}
                />
              ))}
            </div>
          ) : null}

          {excluded.length > 0 ? (
            <div className="deck-section">
              <h3>
                Rejected<span className="count">{excluded.length}</span>
              </h3>
              <p className="note">Not suggested again — until you put one back.</p>
              {excluded.map((e) => (
                <div className="card-row" key={e.oracleId}>
                  <button
                    className="name as-link"
                    onClick={() => open(e.oracleId)}
                    aria-label={`Preview ${cards.get(e.oracleId)?.name ?? 'card'}`}
                  >
                    {cards.get(e.oracleId)?.name ?? 'Loading…'}
                  </button>
                  {inFlight.has(e.oracleId) ? (
                    <span
                      className="spinner"
                      role="status"
                      aria-label={`${cards.get(e.oracleId)?.name ?? 'Card'} restored, updating suggestions`}
                    />
                  ) : (
                    <>
                      {/* "Never" is a strong word and people change their minds.
                          Two ways back, because they are different intentions:
                          one says "let me see it again", the other says "I was
                          wrong, put it in". */}
                      <button
                        className="act"
                        onClick={() => act(e.oracleId, 'restore')}
                        aria-label={`Suggest ${cards.get(e.oracleId)?.name ?? 'card'} again`}
                        title="Put this back in the suggestion pool"
                      >
                        Suggest again
                      </button>
                      <button
                        className="act accept"
                        onClick={() => restoreIntoDeck(e.oracleId)}
                        aria-label={`Add ${cards.get(e.oracleId)?.name ?? 'card'} to the deck`}
                        title="Put this straight into the deck"
                      >
                        Add
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="region" aria-label="Suggestions" ref={suggestionsRef}>
          <h2>Deck options</h2>
          <div className="options" aria-label="Deck options">
            <label className="check">
              <input
                type="checkbox"
                checked={deck.excludeUniversesBeyond}
                onChange={(e) => setDeckOption({ excludeUniversesBeyond: e.target.checked })}
              />
              Exclude Universes Beyond
            </label>

            {/* The delay is written from `AUTO_QUERY_MS`, not typed in.
                Both of these said "four seconds" against a two-second constant
                — the label had been left behind when the wait was shortened,
                so the one control that tells you how long you have was lying
                about it by a factor of two. */}
            <label
              className="check"
              title={`Stop typing and the filter runs by itself after ${AUTO_QUERY_SECONDS} seconds. The ring around the magnifying glass shows how long is left; typing anything resets it. Off by default — the button and Enter run it immediately.`}
            >
              <input
                type="checkbox"
                checked={autoQuery}
                onChange={(e) => setAutoQuery(e.target.checked)}
              />
              Auto query after {AUTO_QUERY_SECONDS} seconds
            </label>

            <label className="option-field">
              <span>Max per card</span>
              <input
                type="text"
                inputMode="decimal"
                defaultValue={budget?.maxCardUsd ?? ''}
                placeholder="any"
                onBlur={(e) => {
                  const value = e.target.value.trim()
                  setDeckOption({
                    budget: {
                      maxCardUsd: value === '' ? null : Number(value),
                      maxTotalUsd: budget?.maxTotalUsd ?? null,
                    },
                  })
                }}
              />
            </label>

            <label className="option-field">
              <span>Max deck total</span>
              <input
                type="text"
                inputMode="decimal"
                defaultValue={budget?.maxTotalUsd ?? ''}
                placeholder="any"
                onBlur={(e) => {
                  const value = e.target.value.trim()
                  setDeckOption({
                    budget: {
                      maxCardUsd: budget?.maxCardUsd ?? null,
                      maxTotalUsd: value === '' ? null : Number(value),
                    },
                  })
                }}
              />
            </label>

            {analysis !== null ? (
              <p
                className="option-total"
                title="Scryfall prices are daily estimates and go stale within a day. Not a purchase price."
              >
                Deck total {usd(analysis.prices.deckTotalUsd)}{' '}
                <span className="estimate">est.</span>
                {analysis.prices.unpricedCards > 0
                  ? ` · ${String(analysis.prices.unpricedCards)} unpriced`
                  : ''}
                {budget?.maxTotalUsd !== null &&
                budget?.maxTotalUsd !== undefined &&
                analysis.prices.deckTotalUsd > budget.maxTotalUsd
                  ? ' · over budget'
                  : ''}
                {overCard > 0 ? ` · ${String(overCard)} over the per-card limit` : ''}
              </p>
            ) : null}
          </div>

          <p className="note estimate-note">
            Prices are daily estimates from Scryfall and go stale within a day. Not a purchase
            price.
          </p>

          <h2>Suggestions</h2>
          <div className="field">
            <div className="filter-bar">
              <input
                ref={filterRef}
                type="text"
                value={draftQuery}
                placeholder="Filter — try  t:creature  or  mv<=3  or  tag:treasure"
                onChange={(e) => setDraftQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setQuery(draftQuery)
                }}
                aria-label="Filter suggestions"
              />
              {/* Explicit, because a query is expensive: typing no longer fires
                  a recompute on its own. Enter does the same thing, and so does
                  the countdown when Deck options has it switched on. */}
              <SearchButton
                onRun={() => setQuery(draftQuery)}
                remaining={auto.remaining}
                restartKey={draftQuery}
              />
              <button
                className="act"
                disabled={
                  draftQuery.trim() === '' ||
                  columns.some((c) => c.kind === 'query' && c.query === draftQuery.trim())
                }
                onClick={() => {
                  addColumn({ kind: 'query', query: draftQuery.trim() })
                  // Promoting a query to a column means "keep showing me
                  // everything, just sort the ones that match to the top", so
                  // the filter itself is cleared.
                  setDraftQuery('')
                  setQuery('')
                }}
                aria-label="Show this query as a column, and sort by it, instead of filtering by it"
                title={
                  columns.length === 0
                    ? 'Add as a column: keeps every suggestion, ticks the ones that match, and sorts them to the top of their group'
                    : 'Add as a column: sorts within each group after the columns already here'
                }
              >
                + column
              </button>
            </div>

            <ColumnLegend columns={columns} onRemove={removeColumn} measureRoot={suggestionsRef} />

            {queryError !== null ? <p className="problem">{queryError}</p> : null}
          </div>

          {/*
            Name matches, always, directly under the box.
            Searching a name is asking "is this card here", and that question
            deserves an answer whether or not the card is also a suggestion —
            the suggestion list is filtered by what the deck NEEDS, so a card can
            be perfectly real and simply not offered.
          */}
          {nearby !== null && nearby.items.length > 0 ? (
            <div className="name-matches">
              <p className="note">
                {nearby.items.some((c) => c.name.toLowerCase().includes(nearby.term.toLowerCase()))
                  ? `Cards named like “${nearby.term}”`
                  : `No card is named “${nearby.term}”. Did you mean:`}
              </p>
              {/*
                Ordinary rows, not a list of names.
                These were a `<ul>` of text buttons that could only open a
                preview, so finding the card you were looking for left you with
                nowhere to go: the one thing you wanted to do with it — put it
                in the deck — was the one thing the list would not let you do.
                They are `.card-row` now, so they carry the same name, type
                line, cost, price and Add as a suggestion, and they sort into
                the reader's existing habits rather than being a second idiom.
                A row that CANNOT be added says so where the button would be
                (`nameMatchStatus`), because this list deliberately contains
                cards that are not candidates.
              */}
              {nearby.items.slice(0, 5).map((c) => {
                const status = nameMatchStatus(c, deck, acceptedIds, excludedIds)
                const note = nameMatchNote(status, c, deck)
                return (
                  <div className="card-row" data-row-id={c.oracleId} key={c.oracleId}>
                    <span
                      className="name-cell"
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('.hint') === null) open(c.oracleId)
                      }}
                    >
                      <button
                        className="name as-link"
                        onClick={() => open(c.oracleId)}
                        aria-label={`Preview ${c.name}`}
                      >
                        {c.name}
                        <span className="row-type">{c.typeLine}</span>
                      </button>
                      {note === null ? null : (
                        <span className="reasons">
                          <span className="reason" data-kind="not-a-candidate">
                            {note}
                          </span>
                        </span>
                      )}
                    </span>
                    {/* No price for these: they were found by `searchCards`,
                        which is not a hydration, so `prices` has no entry and
                        `usd` renders the em dash that means "not known". The
                        preview reads it off the card's own printings. */}
                    <Costs manaCost={c.manaCost} price={prices.get(c.oracleId)} />
                    {inFlight.has(c.oracleId) ? (
                      <span
                        className="spinner"
                        role="status"
                        aria-label={`${c.name} added, updating suggestions`}
                      />
                    ) : status === 'addable' ? (
                      <button
                        className="act accept"
                        onClick={() => act(c.oracleId, 'accept')}
                        aria-label={`Add ${c.name}`}
                      >
                        Add
                      </button>
                    ) : status === 'rejected' ? (
                      // Restore then accept, in one batch, exactly as the
                      // Rejected list does — an `accept` on its own is refused
                      // for `previously-excluded`, which is the silent failure
                      // this whole change exists to remove.
                      <button
                        className="act accept"
                        onClick={() => restoreIntoDeck(c.oracleId)}
                        aria-label={`Add ${c.name} back to the deck`}
                        title="You rejected this. Adding it puts it straight back into the deck."
                      >
                        Add
                      </button>
                    ) : (
                      // Not a disabled button: a disabled control is unreachable
                      // by keyboard and carries no explanation on touch, so it
                      // is a dead end wearing the costume of an action. The row
                      // states the reason beside the name instead, and this is
                      // only the shape that keeps the columns lined up.
                      <span className="act-void" aria-hidden="true">
                        —
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ) : null}

          {groupsWithRows.length === 0 && query.trim() !== '' ? (
            <div className="empty-search">
              <p className="problem">Nothing in your suggestions matches “{query.trim()}”.</p>
              {nearby !== null && nearby.items.length > 0 ? (
                /*
                 * This used to name three reasons and imply they were the whole
                 * list: "already in it, excluded, or outside your colour
                 * identity". None of them is usually the reason. A card is in
                 * the suggestion feed only once the scorer ranks it into one of
                 * the groups above, and the commonest reason a real card is
                 * missing is simply that nothing did — it is a fine card that
                 * this deck has no particular use for. Stating three legal
                 * disqualifications instead told the reader their deck or their
                 * colours were at fault when neither was.
                 *
                 * The three are still worth naming, because each of them IS
                 * sometimes the answer — and now every row above says which of
                 * them applies to it, so this line only has to give the general
                 * rule.
                 */
                <p className="note">
                  The cards above are real. They are missing from the suggestions because nothing
                  ranked them into a group — a card has to earn a place there. Each row says whether
                  it can be added, and why not when it cannot.
                </p>
              ) : nearby !== null ? (
                <p className="note">No card with that name exists in the corpus either.</p>
              ) : null}
            </div>
          ) : null}

          {sortedGroups.map((g) => (
            <div className={`group${isCollapsed(g) ? ' collapsed' : ''}`} key={g.key}>
              <div className="group-head">
                <button
                  type="button"
                  className="group-toggle"
                  onClick={() => toggleCollapsed(g.key)}
                  aria-expanded={!isCollapsed(g)}
                  aria-controls={`group-${g.key}`}
                  // The glyph is the whole label, so the name has to be given
                  // rather than read off the content: "−" tells a screen reader
                  // nothing about which list it hides.
                  aria-label={`${isCollapsed(g) ? 'Show' : 'Hide'} ${g.label.toLowerCase()}`}
                  title={isCollapsed(g) ? 'Show these suggestions' : 'Hide these suggestions'}
                >
                  {isCollapsed(g) ? '+' : '−'}
                </button>
                <h3>{g.label}</h3>
                <span className="count">{g.total}</span>
                {/* A heading with no rows is kept, not deleted — but WHY it has
                    no rows is four different answers and it used to give one.
                    `satisfied` is now reserved for the case that is actually
                    satisfied; see `emptinessOf`. */}
                <GroupBadge state={emptinessOf(g)} gap={gapIn(g)} total={g.total} />
                <span className="rationale">{g.rationale}</span>
                <button
                  type="button"
                  className="group-more"
                  onClick={() => expandGroup(g.key)}
                  disabled={expanding !== null}
                  aria-label={`Ask for more ${g.label.toLowerCase()}`}
                  title={`Ask for more ${g.label.toLowerCase()}`}
                >
                  {expanding === g.key ? '…' : 'More'}
                </button>
                {/* No column marker here on purpose.
                    A group head holds a title, a count and a rationale; a card
                    row holds costs and two buttons after its columns. The two
                    rows therefore end at different places, and the marker sat
                    251 px right of the cells it claimed to head — measured, not
                    guessed. Matching it would mean mirroring every trailing
                    width, which is a copy that drifts. The columns are named
                    once instead, in the legend under the filter bar, which
                    aligns by measuring where the cells actually are. */}
              </div>
              {isCollapsed(g)
                ? null
                : g.items
                    /*
                     * Drop anything the user has just decided on.
                     *
                     * The groups come from the server and are only as fresh as the
                     * last recompute, so a rejected card sat in the list until the
                     * requery landed — several seconds during which the app was
                     * still offering something the user had just refused. Pillar P6
                     * says an excluded card is never suggested again; that has to
                     * be true on the click, not on the next round trip.
                     */
                    .filter((item) => {
                      const decided = optimistic.entries.find((e) => e.oracleId === item.oracleId)
                      return decided === undefined || decided.zone !== 'excluded'
                    })
                    .map((item) => (
                      // `data-row-id` is what `rowAfter` walks: after an accept
                      // or a reject, focus has to find the row that took this
                      // one's place, and the key alone is not in the DOM.
                      <div className="card-row" data-row-id={item.oracleId} key={item.oracleId}>
                        <Degree
                          degree={item.comboDegree}
                          near={item.nearCombosAt1}
                          combos={item.combos}
                          cards={cards}
                          lockedIds={lockedIds}
                          self={item.oracleId}
                        />
                        {/* The reasons sit BESIDE the name button, not inside it.
                      One of them opens a panel of its own, and a button nested
                      in a button is invalid and unreachable by keyboard. */}
                        {/* The whole cell opens the preview, not just the text.
                      Splitting the name from its reasons left a dead strip
                      under the name where a click landed on nothing. The button
                      inside stays the accessible control; this is a mouse
                      convenience layered over it. */}
                        <span
                          className="name-cell"
                          onClick={(e) => {
                            // A reason chip that opens its own panel must not also
                            // open the preview behind it.
                            if ((e.target as HTMLElement).closest('.hint') === null)
                              open(item.oracleId)
                          }}
                        >
                          <button
                            className="name as-link"
                            onClick={() => open(item.oracleId)}
                            aria-label={`Preview ${cards.get(item.oracleId)?.name ?? 'card'}`}
                          >
                            {cards.get(item.oracleId)?.name ?? 'Loading…'}
                            {/* The type line, in the same dim grey the preview uses.
                            A name alone does not say whether a suggestion is a
                            creature or a land, which is the first thing anyone
                            checks before deciding on it. */}
                            {cards.get(item.oracleId)?.typeLine === undefined ? null : (
                              <span className="row-type">{cards.get(item.oracleId)?.typeLine}</span>
                            )}
                          </button>
                          <span className="reasons">
                            {item.reasons.map((r, i) =>
                              r.kind === 'completes-combos' && item.combos.length > 0 ? (
                                <Hint
                                  key={i}
                                  className="reason-hint"
                                  label={`${reasonText(r, item)} — show which`}
                                  content={
                                    <>
                                      <strong>{reasonText(r, item)}</strong>
                                      <ComboList
                                        combos={item.combos}
                                        cards={cards}
                                        lockedIds={lockedIds}
                                        self={item.oracleId}
                                      />
                                    </>
                                  }
                                >
                                  <span className="reason" data-kind={r.kind} data-openable="true">
                                    {reasonText(r, item)}
                                  </span>
                                </Hint>
                              ) : (
                                <span className="reason" data-kind={r.kind} key={i}>
                                  {reasonText(r, item)}
                                </span>
                              ),
                            )}
                          </span>
                        </span>
                        {columns.map((c) => {
                          const matched =
                            c.kind === 'query' &&
                            columnMatches.get(c.query)?.has(item.oracleId) === true
                          return (
                            <span
                              className="col-cell"
                              key={columnKey(c)}
                              data-match={matched}
                              title={`${columnLabel(c)}: ${matched ? 'yes' : 'no'}`}
                              aria-label={`${columnLabel(c)}: ${matched ? 'yes' : 'no'}`}
                            >
                              {matched ? '\u2713' : '\u00B7'}
                            </span>
                          )
                        })}
                        <Costs
                          manaCost={cards.get(item.oracleId)?.manaCost}
                          price={prices.get(item.oracleId)}
                        />
                        {inFlight.has(item.oracleId) ? (
                          // Already in the deck as far as the user is concerned; the
                          // spinner says the suggestions have not caught up yet, and
                          // it stops the same card being clicked twice.
                          <span
                            className="spinner"
                            role="status"
                            aria-label={`${cards.get(item.oracleId)?.name ?? 'Card'} added, updating suggestions`}
                          />
                        ) : (
                          <>
                            <button
                              className="act accept"
                              onClick={() => decide(item.oracleId, 'accept')}
                              aria-label={`Add ${cards.get(item.oracleId)?.name ?? 'card'}`}
                            >
                              Add
                            </button>
                            {/* "Reject", not "Never". The action is the same and
                          undoable from the Rejected list, and "Never" read as a
                          harsher commitment than it actually is. */}
                            <button
                              className="act exclude"
                              onClick={() => decide(item.oracleId, 'exclude')}
                              aria-label={`Reject ${cards.get(item.oracleId)?.name ?? 'card'}`}
                              title="Stop suggesting this card. You can undo it from the Rejected list."
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                    ))}
            </div>
          ))}
          {groups.length === 0 ? <p className="note">Working…</p> : null}
        </section>

        <section className="region analysis" aria-label="Analysis">
          {/*
            A sibling of the scroller, not the first thing inside it.
            The preview used to sit at the top of the rail's scrolling body,
            which meant opening a card pushed Composition, the bracket check and
            the combo list off the screen — the dashboard you keep an eye on
            while deciding disappeared at the exact moment you were deciding.
            It is anchored to this rail's LEFT edge instead and overlays the
            suggestion feed, so the rail can stay what it is for.

            The move is in the SOURCE, once, and is never conditional on the
            breakpoint. Moving an element at runtime would remount it — throwing
            away the in-flight `/cards/{id}` request and reordering the document
            for a screen reader — which is the same reason the sheet is a change
            of box and not a change of parent.
          */}
          <Preview
            card={inspect === null ? undefined : cards.get(inspect)}
            detail={detail}
            price={prices.get(inspect ?? '')}
            images={images.get(inspect ?? '')}
            onClose={closePreview}
            accepted={acceptedIds}
            lockedIds={lockedIds}
            cards={cards}
            sheet={singleColumn}
          />
          <div className="analysis-scroll">
            <h2 style={{ marginTop: '1.25rem' }}>
              Composition
              {/* The handle for doc 16's sheet, on the panel it edits rather
                  than in the masthead: this list IS the thing being tuned, and
                  a control for it two regions away has to be found first. */}
              {analysis === null ? null : (
                <button
                  className="act"
                  style={{ marginLeft: '0.5rem' }}
                  onClick={() => setTuningTargets(true)}
                  aria-haspopup="dialog"
                  aria-expanded={tuningTargets}
                >
                  Adjust targets
                </button>
              )}
            </h2>
            {targetsChange === null ? null : (
              <p className="note target-change" role="status">
                {targetsChange}{' '}
                <button
                  className="act"
                  onClick={() => setTargetsChange(null)}
                  aria-label="Dismiss target change summary"
                >
                  OK
                </button>
              </p>
            )}
            <label className="check" title={HIDE_SETTLED_HELP}>
              <input
                type="checkbox"
                checked={hideSettledRoles}
                onChange={(e) => setHideSettledRoles(e.target.checked)}
              />
              Only show roles that still need cards
              <span className="help" aria-hidden="true">
                ?
              </span>
            </label>

            {compositionRows.map((r) => {
              const pct = Math.min(100, (r.actual / Math.max(1, r.ideal)) * 100)
              const lockedPct = Math.min(100, (r.locked / Math.max(1, r.ideal)) * 100)
              return (
                // Same treatment as a curve bar, through the same `Hint`: "which
                // cards are these?" is one question, and answering it two
                // different ways in one rail would be two idioms for one idea.
                // The `title` that used to sit on the track has moved into the
                // trigger's accessible name, because a `title` is invisible on
                // every touch device.
                <Hint
                  key={r.name}
                  className="comp-hint"
                  label={`${r.name}: ${String(r.actual)} of a target ${String(r.ideal)} (range ${String(r.min)} to ${String(r.max)}), ${String(r.locked)} locked${r.source === 'custom' ? `; you set this, the archetype wanted ${r.preset === null || r.preset === undefined ? 'nothing here' : String(r.preset)}` : ''}. Show them.`}
                  content={
                    <Breakdown
                      title={r.name}
                      cards={cardsInDimension(acceptedIds, cards, dimensionKeyOf(r.dimension))}
                      bar={r.actual}
                    />
                  }
                >
                  {/* Spans, not divs: this is inside the hint's button now, and
                      a div in a button is invalid and gets reparented by the
                      parser. The layout is unchanged, `.meter` and its parts
                      carry their own `display`. */}
                  <span className="meter">
                    <span className="meter-label">
                      <span>
                        {r.name}
                        {/* Marked, because this bar is no longer the
                            archetype's opinion: a builder has to be able to see
                            which of these numbers are their own before trusting
                            either. */}
                        {r.source === 'custom' ? (
                          <span className="target-mark" title="You set this target">
                            {' \u270E'}
                          </span>
                        ) : null}
                      </span>
                      <span className="delta">
                        {r.locked > 0 ? `${String(r.locked)}\u25C6 ` : ''}
                        {r.actual} / {r.ideal}
                      </span>
                    </span>
                    <span className="meter-track">
                      <span
                        className="meter-fill"
                        data-short={!r.filled}
                        style={{ width: `${pct}%` }}
                      />
                      {/* The committed part, in the same gold the curve uses. */}
                      <span className="meter-locked" style={{ width: `${lockedPct}%` }} />
                    </span>
                  </span>
                </Hint>
              )
            })}
            {compositionRows.length === 0 && analysis !== null ? (
              <p className="note">
                {hideSettledRoles ? 'Nothing short.' : 'Every role is locked in.'}
              </p>
            ) : null}

            {/* Under the composition bars, because they answer the same shape
                of question about a different axis: those say how the deck
                divides by ROLE, these say how it divides by COLOUR — and then
                whether its mana agrees. Guarded on the field rather than on
                `analysis`, so a server from before API-02 renders the panel
                without them instead of an empty box. */}
            {analysis?.colorBalance === undefined ? null : (
              <>
                <h2 style={{ marginTop: '1.25rem' }}>Mana colours</h2>
                <Boundary name="The colour pies">
                  <ColorPies balance={analysis.colorBalance} />
                </Boundary>
              </>
            )}

            {analysis !== null ? (
              <>
                <h2 style={{ marginTop: '1.25rem' }}>Reads as</h2>
                <p className="note">
                  {analysis.archetype.assessed} ({Math.round(analysis.archetype.confidence * 100)}%
                  confidence) · avg mana value {analysis.curve.averageManaValue.toFixed(2)}
                </p>

                {analysis.bracket === undefined ? null : (
                  <Boundary name="The bracket check">
                    <BracketCheck
                      bracket={analysis.bracket}
                      // The server's own account of what is missing. Looked up by
                      // key rather than by position — `unavailable` also carries
                      // data-source entries, and which of them are present varies
                      // per deck (doc 10 §10.9).
                      reason={
                        analysis.unavailable.find((u) => u.key === 'bracket-assessment')?.reason
                      }
                      cards={cards}
                      onInspect={open}
                      // Open by default while the deck is over its allowance, and
                      // whatever the user last chose after that.
                      open={bracketOpen ?? (analysis.bracket.violations ?? []).length > 0}
                      onOpenChange={setBracketOpen}
                      headingRef={bracketHeadingRef}
                    />
                  </Boundary>
                )}

                {analysis.deckCombos.length > 0 ? (
                  <>
                    <h2 style={{ marginTop: '1.25rem' }}>
                      Combos assembled
                      <span className="count">{analysis.deckCombos.length}</span>
                    </h2>
                    {/* Its own scroller: a deck can assemble dozens, and letting
                      them push the rest of the rail off-screen would bury the
                      things next to them. No slice — every combo the deck
                      actually has is listed. */}
                    <div className="combo-list">
                      {analysis.deckCombos.map((c) => (
                        <p className="note" key={c.comboId}>
                          {c.pieces.map((p) => cards.get(p)?.name ?? p.slice(0, 6)).join(' + ')} →{' '}
                          {c.produces.join(', ')}
                        </p>
                      ))}
                    </div>
                  </>
                ) : null}
              </>
            ) : null}

            {unavailable.length > 0 ? (
              <div className="unavailable">
                <strong>Not computed:</strong>
                {/* The NAME of the thing, not its key. `top-<type>` is a
                    placeholder the domain uses for a family of keys, and it was
                    being printed literally, angle brackets and all. */}
                {unavailable.map((u) => (
                  <div key={u.key}>
                    {unavailableLabel(u.key)} — {u.reason}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* Pinned to the bottom of the rail. The curve and the legality
              verdict are the two things a builder checks constantly, so they
              stay on screen however far the notes above them scroll. */}
          {analysis !== null ? (
            <div className="analysis-pinned">
              <h2>Mana curve</h2>
              <Curve
                curve={analysis.curve}
                locked={lockedByBucket}
                // `acceptedIds` is the client's copy of the domain's
                // `acceptedSet` — deduplicated, commanders included — so the
                // list under a bar is counted by the rule that produced the bar.
                cardsAt={(bucket) => cardsInBucket(acceptedIds, cards, bucket)}
              />
              <p className="note">
                Average mana value {analysis.curve.averageManaValue.toFixed(2)}
              </p>

              <h2 style={{ marginTop: '0.75rem' }}>Legality</h2>
              {analysis.legality.problems.length === 0 ? (
                <p className="note">No problems found.</p>
              ) : (
                analysis.legality.problems
                  .slice(0, 4)
                  // In words, and naming the card. `{p.kind}` used to be
                  // rendered raw, so the rail read `wrong-card-count` and a
                  // colour-identity problem named no card at all.
                  .map((p, i) => (
                    <p className="problem" key={i}>
                      {legalityText(p, cards)}
                    </p>
                  ))
              )}
            </div>
          ) : null}
        </section>
      </div>
    </>
  )
}

export const App = (): React.JSX.Element => {
  const [deck, setDeck] = useState<api.Deck | null>(null)
  const [loading, setLoading] = useState(true)

  const open = useCallback((d: api.Deck): void => {
    localStorage.setItem('roundtable.deck', d.id)
    setDeck(d)
  }, [])

  useEffect(() => {
    // Which deck was last open. The DECKS themselves live on the server, keyed
    // by this browser's device id (ADR-0014) — this is only the bookmark.
    const saved = localStorage.getItem('roundtable.deck')
    if (saved === null) {
      setLoading(false)
      return
    }
    void api
      .getDeck(saved)
      .then(setDeck)
      .catch(() => localStorage.removeItem('roundtable.deck'))
      .finally(() => setLoading(false))
  }, [])

  // Without this the Start screen flashes for a moment on every reload, before
  // the saved deck arrives — which reads as having lost it.
  if (loading) return <p className="boot">Loading…</p>

  if (deck === null) return <Start onCreated={open} />

  return (
    <Workspace
      deck={deck}
      key={deck.id}
      onSwitch={(id) => {
        void api.getDeck(id).then(open).catch(noop)
      }}
      onNew={() => {
        localStorage.removeItem('roundtable.deck')
        setDeck(null)
      }}
    />
  )
}

const noop = (): void => undefined
