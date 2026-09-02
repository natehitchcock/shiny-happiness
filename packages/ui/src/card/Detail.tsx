/**
 * L3 — detail. One card, everything about it (doc 06 §6.5).
 *
 * The requirement that shapes this component is Pillar P4: every recommendation
 * carries a non-empty `reasons` list, and this is where the user reads it. So
 * `reasons` is not an optional flourish rendered when present — an empty or
 * missing list renders a visible statement that the reasons are missing, because
 * silently omitting the section would hide exactly the bug P4 exists to prevent.
 *
 * "Accept and exclude stay reachable without closing it" is why `actions` is a
 * prop and why it renders above the scrolling body rather than at its end.
 */

import type { JSX } from 'react'
import { CARD_ASPECT, imageFor, levelSpec } from './presentation.js'
import { faceName } from './flip.js'
import { FaceNoArt, FlipButton, useCardSide } from './FlipButton.js'
import { ComboBadge, IdentityStrip, ManaValue, Price, RoleDot } from './Badges.js'
import { ManaCost } from './ManaCost.js'
import { CardMetrics } from './CardMetrics.js'
import { OracleText } from './OracleText.js'
import type { CardView } from './types.js'

export interface ComboLine {
  readonly comboId: string
  /** Every piece, including the ones already in the deck. */
  readonly pieces: readonly string[]
  /** Pieces the deck is missing. Empty when the combo is assembled. */
  readonly missing: readonly string[]
  readonly result: string
}

export interface DetailProps {
  readonly card: CardView
  readonly width?: number
  /**
   * The combos this card is in, as far as the CALLER knows.
   *
   * Three states, not two, and the third is the one that was being lost. `[]`
   * is a caller that looked and found none — printed, because it is a finding.
   * Absent is a caller that never asked, and there is NO DEFAULT that can be
   * substituted for it: `[]` would put a negative claim on screen that nothing
   * on this component's inputs supports.
   *
   * That was not hypothetical. Quickbuild rendered every card with no `combos`
   * prop, so every card in the panel read "completes 1 combo" under WHY THIS IS
   * HERE and "Not part of any combo we know about" an inch below it.
   */
  readonly combos?: readonly ComboLine[]
  readonly actions?: JSX.Element
  readonly onCorrectRole?: (oracleId: string) => void
}

export const Detail = ({
  card,
  width,
  combos,
  actions,
  onCorrectRole,
}: DetailProps): JSX.Element => {
  const spec = levelSpec(3)
  const w = width ?? spec.width
  const { side, touched, hasBack, flip } = useCardSide(card)
  const image = imageFor(card, 3, side)
  const reasons = card.reasons ?? []

  return (
    <section className="rt-detail" aria-label={`${card.name}, details`} style={{ width: w }}>
      <header className="rt-detail-head">
        <h2 className="rt-detail-name">{card.name}</h2>
        <span className="rt-detail-cost">
          <ManaCost cost={card.manaCost} />
        </span>
      </header>

      {actions}

      <div className="rt-detail-body">
        {/*
         * The picture, the face it is of, and the way to the other one.
         *
         * The guard is `image === null && !hasBack`, not `image === null`.
         * Rendering nothing whenever `imageFor` came back null was right while
         * every card had one face; for a two-faced card whose art has not
         * resolved it collapses ADR-0027's third state into its first — the
         * card silently reads as having no other side, which is the exact
         * failure the database CHECK constraint and the layout gate were built
         * to make unspellable.
         *
         * A single-faced card with no art still draws nothing at all, which is
         * unchanged: its name, cost, type line and rules text are all in this
         * panel already, and a card-shaped "no picture" box would be a hole
         * where nothing is missing.
         */}
        {image === null && !hasBack ? null : (
          <>
            {image === null ? (
              // Two faces, no picture of this one. Never `<img src="">`, which
              // re-requests the page and draws it broken.
              <FaceNoArt card={card} side={side} />
            ) : (
              /*
               * `aspectRatio` as well as the width and height attributes.
               *
               * The attributes alone would be enough in a browser that leaves
               * the image's intrinsic sizing alone, but `.rt-detail-image` sets
               * `height: auto` so the panel can be narrower than `w` — and the
               * moment a stylesheet touches the height, whether the box is
               * still reserved depends on the UA rule that derives a ratio from
               * the attributes. Stating the ratio makes it not depend on that:
               * the space is held from first paint, and the rules text below
               * does not jump up the panel while the art is still in flight.
               *
               * `1 / CARD_ASPECT` because CSS wants width-over-height and
               * `CARD_ASPECT` is height-over-width.
               */
              <img
                className="rt-detail-image"
                src={image}
                // The FACE's name, not the card's. Once the picture can change
                // under a fixed heading, an `alt` that always said "Delver of
                // Secrets // Insectile Aberration" would be the one part of the
                // panel that could not tell a reader which side they are on.
                alt={faceName(card, side)}
                loading="lazy"
                decoding="async"
                width={w}
                height={Math.round(w * CARD_ASPECT)}
                style={{ aspectRatio: 1 / CARD_ASPECT }}
              />
            )}
            {hasBack ? (
              <FlipButton card={card} side={side} touched={touched} onFlip={flip} />
            ) : null}
          </>
        )}

        <p className="rt-detail-type">{card.typeLine ?? ''}</p>
        {card.oracleText === undefined || card.oracleText === '' ? null : (
          // Repeated from the image on purpose at this level, unlike L2: the
          // image is not selectable, translatable, or resizable by the reader,
          // and this is the level where someone is reading rather than scanning.
          <p className="rt-detail-oracle">
            <OracleText text={card.oracleText} faces={card.oracleTextFaces} />
          </p>
        )}

        <div className="rt-detail-badges">
          <IdentityStrip colorIdentity={card.colorIdentity ?? []} />
          <ManaValue manaValue={card.manaValue ?? 0} />
          <Price priceUsd={card.priceUsd} />
          <ComboBadge degree={card.comboDegree ?? 0} near={card.nearCombosAt1 ?? 0} />
        </div>

        {card.primaryRole === undefined ? null : (
          <p className="rt-detail-role">
            <RoleDot role={card.primaryRole} showLabel />
            {onCorrectRole === undefined ? null : (
              // doc 02 §2.4: roles are derived, imperfect, and overridable. The
              // correction control lives next to the claim it corrects.
              <button
                type="button"
                className="rt-detail-correct"
                onClick={() => onCorrectRole(card.oracleId)}
              >
                Not right?
              </button>
            )}
          </p>
        )}

        {(card.bracketFlags ?? []).length === 0 ? null : (
          <ul className="rt-detail-flags" aria-label="Bracket flags">
            {(card.bracketFlags ?? []).map((flag) => (
              <li key={flag}>{flag}</li>
            ))}
          </ul>
        )}

        {/*
         * Above "Why this is here", because the two answer different questions
         * and the intrinsic one comes first. Impact and efficiency are true of
         * this card in every deck that has ever existed (doc 18 §18.8);
         * `reasons` is why it surfaced in THIS one. Reading the deck-relative
         * argument before knowing what the card does is reading the verdict
         * before the evidence.
         */}
        <CardMetrics
          impact={card.impact}
          efficiency={card.efficiency}
          impactRole={card.impactRole}
        />

        <h3 className="rt-detail-h">Why this is here</h3>
        {reasons.length === 0 ? (
          <p className="rt-detail-noreasons">
            No reasons were supplied for this suggestion. That is a bug — every recommendation is
            required to explain itself.
          </p>
        ) : (
          <ul className="rt-detail-reasons">
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}

        {/*
         * Silence when nothing was passed, and only then.
         *
         * The asymmetry with `reasons` immediately above is the point rather
         * than an oversight. P4 makes an absent `reasons` list a BUG, so the
         * absence is stated loudly — hiding it would hide the defect the pillar
         * exists to catch. Nothing guarantees a caller knows this card's
         * combos, so an absent `combos` is ignorance and not a defect, and the
         * honest rendering of ignorance is to say nothing. An empty list is
         * still a claim someone made and is still printed.
         */}
        {combos === undefined ? null : (
          <>
            <h3 className="rt-detail-h">Combos</h3>
            {combos.length === 0 ? (
              <p className="rt-detail-nocombos">Not part of any combo we know about.</p>
            ) : (
              <ul className="rt-detail-combos">
                {combos.map((combo) => (
                  <li key={combo.comboId} data-assembled={combo.missing.length === 0}>
                    <span className="rt-combo-pieces">{combo.pieces.join(' + ')}</span>
                    <span className="rt-combo-result">{combo.result}</span>
                    {combo.missing.length === 0 ? (
                      <span className="rt-combo-state">assembled</span>
                    ) : (
                      <span className="rt-combo-state">needs {combo.missing.join(', ')}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  )
}
