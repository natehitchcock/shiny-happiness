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
import { CARD_ASPECT, levelSpec } from './presentation.js'
import { ComboBadge, IdentityStrip, ManaValue, Price, RoleDot } from './Badges.js'
import { ManaCost } from './ManaCost.js'
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
  readonly combos?: readonly ComboLine[]
  readonly actions?: JSX.Element
  readonly onCorrectRole?: (oracleId: string) => void
}

export const Detail = ({
  card,
  width,
  combos = [],
  actions,
  onCorrectRole,
}: DetailProps): JSX.Element => {
  const spec = levelSpec(3)
  const w = width ?? spec.width
  const image = card.imageUris?.normal
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
        {image === undefined ? null : (
          <img
            className="rt-detail-image"
            src={image}
            alt={card.name}
            width={w}
            height={Math.round(w * CARD_ASPECT)}
          />
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
      </div>
    </section>
  )
}
