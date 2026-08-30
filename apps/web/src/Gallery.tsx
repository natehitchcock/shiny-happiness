/**
 * The UI-01 gallery — every card primitive at every level, in isolation.
 *
 * This is what the work breakdown calls "Storybook entries". It is not
 * Storybook, deliberately: Storybook is ~40 packages and asserts nothing, and
 * the assertable half of that DoD ("each meets its size and a11y requirements")
 * is already covered by the tests in `packages/ui/src/card/`. What Storybook
 * would still have given is a place a human can LOOK at each primitive without
 * building a deck first, and that is a page.
 *
 * Reached at `#gallery`. Fixture cards only — no API, so it renders offline and
 * against an empty database.
 */

import { useState } from 'react'
import type { JSX } from 'react'
import {
  CardFace,
  Detail,
  IDENTITY_COLORS,
  LEVELS,
  PIP_CVD_NOTE,
  Tile,
  levelSpec,
  pipColor,
  pipSummary,
} from '@roundtable/ui'
import type { CardView, PipEncoding, PipScale } from '@roundtable/ui'

const SCALE: PipScale = {
  maxManaValue: 8,
  maxComboDegree: 4,
  roleOrder: ['ramp', 'draw', 'removal', 'engine', 'wincon'],
}

/**
 * Fixtures chosen to exercise the cases that break primitives, not to look
 * pretty: no art, no price, a name too long for the strip, and a recommendation
 * that arrived with no reasons.
 */
const FIXTURES: readonly CardView[] = [
  {
    oracleId: 'f1',
    name: 'Thassa, Deep-Dwelling',
    manaCost: '{3}{U}',
    manaValue: 4,
    colorIdentity: ['U'],
    typeLine: 'Legendary Creature — God',
    oracleText:
      'At the beginning of your end step, exile up to one other target creature you control, then return it to the battlefield under its owner control.',
    primaryRole: 'engine',
    comboDegree: 2,
    priceUsd: 4.2,
    reasons: ['Blinks your enter-the-battlefield creatures every turn', 'Completes 2 combos'],
  },
  {
    oracleId: 'f2',
    name: 'Sol Ring',
    manaCost: '{1}',
    manaValue: 1,
    colorIdentity: [],
    typeLine: 'Artifact',
    oracleText: '{T}: Add {C}{C}.',
    primaryRole: 'ramp',
    nearCombosAt1: 3,
    priceUsd: 1.75,
    reasons: ['Two mana ahead on turn one, in every deck that can cast it'],
  },
  {
    oracleId: 'f3',
    name: 'Rankle and Torbran, Reckless and Ruthless Wanderers',
    manaCost: '{2}{B}{R}',
    manaValue: 4,
    colorIdentity: ['B', 'R'],
    typeLine: 'Legendary Creature — Faerie Dwarf',
    oracleText: 'Flying, haste.',
    primaryRole: 'wincon',
    bracketFlags: ['game changer'],
    priceUsd: null,
    reasons: [],
  },
  {
    oracleId: 'f4',
    name: 'Unresolved Import',
    manaValue: 0,
    colorIdentity: ['W', 'U', 'B', 'R', 'G'],
    typeLine: 'Land',
    oracleText: '',
    primaryRole: 'removal',
    priceUsd: null,
  },
  {
    // Not a real card. Every mana symbol shape in one cost, including one the
    // parser cannot read — the point of this page is to be able to LOOK at the
    // awkward cases, and a hybrid that renders wrong is invisible in a test that
    // only checks it renders.
    oracleId: 'f5',
    name: 'Every Symbol At Once',
    manaCost: '{X}{15}{2/B}{W/U}{G/P}{W/U/P}{C}{S}{Q}',
    manaValue: 21,
    colorIdentity: ['W', 'U', 'B', 'G'],
    typeLine: 'Sorcery — Fixture',
    oracleText: 'Exists so the symbol renderer can be inspected by eye.',
    primaryRole: 'removal',
    priceUsd: 0,
    reasons: ['Fixture only'],
  },
]

const ENCODINGS: readonly PipEncoding[] = ['colorIdentity', 'manaValue', 'role', 'comboDegree']

const Constellation = ({ encoding }: { readonly encoding: PipEncoding }): JSX.Element => {
  const size = levelSpec(0).width
  const gap = 4
  const perRow = 24
  const pool = Array.from({ length: 240 }, (_, i) => FIXTURES[i % FIXTURES.length]!)
  return (
    <div>
      <svg
        width={perRow * (size + gap)}
        height={Math.ceil(pool.length / perRow) * (size + gap)}
        role="presentation"
      >
        {pool.map((card, i) => (
          <circle
            key={i}
            cx={(i % perRow) * (size + gap) + size / 2}
            cy={Math.floor(i / perRow) * (size + gap) + size / 2}
            r={size / 2}
            fill={pipColor(card, encoding, SCALE)}
          />
        ))}
      </svg>
      {/* The parallel accessibility path, shown here rather than hidden so it
          can be reviewed. In the app proper it is visually hidden. */}
      <p className="gal-summary">{pipSummary('Candidates', pool, encoding)}</p>
    </div>
  )
}

export const Gallery = (): JSX.Element => {
  const [encoding, setEncoding] = useState<PipEncoding>('colorIdentity')

  return (
    <main className="gal">
      <header className="gal-head">
        <h1>Card primitives</h1>
        <p>
          UI-01. Every representation at its specified size, with the fixtures that break them: a
          card with no art, one with no price, a name too long for the strip, and a recommendation
          with no reasons.
        </p>
      </header>

      {LEVELS.map((level) => (
        <section className="gal-level" key={level.level}>
          <h2>
            L{level.level} — {level.name}
          </h2>
          <p className="gal-spec">
            {level.width} px ({level.minWidth}–{level.maxWidth}), {level.mobileWidth} px on a 360 px
            phone · {level.asset ?? 'no image'} · {level.onScreen}
          </p>

          {level.level === 0 ? (
            <>
              <div className="gal-encodings" role="group" aria-label="Pip encoding">
                {ENCODINGS.map((e) => (
                  <button
                    type="button"
                    key={e}
                    onClick={() => setEncoding(e)}
                    aria-pressed={encoding === e}
                    data-on={encoding === e}
                  >
                    {e}
                  </button>
                ))}
              </div>
              <Constellation encoding={encoding} />
              <p className="gal-note">{PIP_CVD_NOTE}</p>
              <div className="gal-swatches">
                {Object.entries(IDENTITY_COLORS).map(([key, hex]) => (
                  <span key={key}>
                    <span style={{ background: hex }} aria-hidden="true" />
                    {key} {hex}
                  </span>
                ))}
              </div>
            </>
          ) : null}

          {level.level === 1 ? (
            <div className="gal-row">
              {FIXTURES.map((card) => (
                <Tile key={card.oracleId} card={card} />
              ))}
              {FIXTURES.map((card) => (
                <Tile key={`m-${card.oracleId}`} card={card} width={level.mobileWidth} />
              ))}
            </div>
          ) : null}

          {level.level === 2 ? (
            <div className="gal-row">
              {FIXTURES.map((card) => (
                <CardFace
                  key={card.oracleId}
                  card={card}
                  actions={
                    <div className="gal-actions">
                      <button type="button">Add</button>
                      <button type="button">Never</button>
                    </div>
                  }
                />
              ))}
            </div>
          ) : null}

          {level.level === 3 ? (
            <div className="gal-row">
              {FIXTURES.slice(0, 3).map((card) => (
                <Detail
                  key={card.oracleId}
                  card={card}
                  combos={
                    card.oracleId === 'f1'
                      ? [
                          {
                            comboId: 'c1',
                            pieces: ['Thassa, Deep-Dwelling', 'Peregrine Drake'],
                            missing: [],
                            result: 'Infinite mana',
                          },
                          {
                            comboId: 'c2',
                            pieces: ['Thassa, Deep-Dwelling', 'Deadeye Navigator'],
                            missing: ['Deadeye Navigator'],
                            result: 'Infinite blinks',
                          },
                        ]
                      : []
                  }
                  onCorrectRole={() => undefined}
                  actions={
                    <div className="gal-actions">
                      <button type="button">Add to deck</button>
                    </div>
                  }
                />
              ))}
            </div>
          ) : null}
        </section>
      ))}
    </main>
  )
}
