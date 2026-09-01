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
 *
 * Three of the six carry real art and three carry none, on purpose. This page
 * exists to be LOOKED at, and both halves need looking at: the art path, which
 * is what the app spends most of its pixels on, and the no-art fallback, which
 * no amount of test-passing proves is legible.
 *
 * The fallback is drawn here even though no card in the corpus takes it any
 * more — 501 did until the double-faced art fix, and coverage is now 34,492 of
 * 34,492 (doc 17 §17.2). A printing whose art has not been resolved is still a
 * state the API can send, and a path with no picture of it is a path nobody
 * will notice has gone ugly.
 *
 * The URLs are Scryfall's own CDN, unaltered and at the sizes Scryfall
 * publishes — ADR-0021. They are addresses, not assets: nothing about them is
 * card data committed to this repository, which AGENTS.md §5 forbids.
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
    imageUris: {
      artCrop:
        'https://cards.scryfall.io/art_crop/front/c/8/c83ed3e0-82d0-4410-a6ca-b0f923eadf83.jpg?1783931576',
      normal:
        'https://cards.scryfall.io/normal/front/c/8/c83ed3e0-82d0-4410-a6ca-b0f923eadf83.jpg?1783931576',
    },
    reasons: ['Blinks your enter-the-battlefield creatures every turn', 'Completes 2 combos'],
    /*
     * Real `cardImpact` / `cardEfficiency` output for this exact oracle text,
     * not invented numbers. This page exists to be LOOKED at, and a metrics
     * block drawn from made-up tiers would look fine while showing a
     * combination the classifier cannot produce.
     *
     * Three fixtures, three readings worth looking at side by side: a mid
     * scorer here, the documented blind spot on Sol Ring below, and a card that
     * is almost all body on `f3`.
     */
    impact: {
      score: 2.64,
      breadth: 'one',
      persistence: 'upkeep',
      stakes: 'opposing',
      symmetry: 'none',
      scales: false,
      fragile: false,
    },
    efficiency: { score: 1.081, statSurplus: 4.219, effectValue: 1.184, baseline: 6.781, cost: 5 },
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
    imageUris: {
      artCrop:
        'https://cards.scryfall.io/art_crop/front/9/1/91fdb56b-54d5-4272-8319-505ff987fe9b.jpg?1783903215',
      normal:
        'https://cards.scryfall.io/normal/front/9/1/91fdb56b-54d5-4272-8319-505ff987fe9b.jpg?1783903215',
    },
    reasons: ['Two mana ahead on turn one, in every deck that can cast it'],
    // 0.68 — the blind spot `impact.ts` names in its own docblock and declined
    // to patch. On the page on purpose: it is the reading most likely to make
    // someone think the metric is broken, and the "effects only" line under it
    // is the answer.
    impact: {
      score: 0.68,
      breadth: 'none',
      persistence: 'activated',
      stakes: 'self',
      symmetry: 'none',
      scales: false,
      fragile: false,
    },
    efficiency: { score: 0.152, statSurplus: 0, effectValue: 0.305, baseline: 2.966, cost: 2 },
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
    // Two keywords and no effect: 0.425, the floor for a card that has text the
    // model cannot count. Next to a 2.64 and a 0.68 it shows the bottom of the
    // meter is a real position and not a loading state.
    impact: {
      score: 0.425,
      breadth: 'none',
      persistence: 'one-shot',
      stakes: 'self',
      symmetry: 'none',
      scales: false,
      fragile: false,
    },
    efficiency: { score: 0.038, statSurplus: 0, effectValue: 0.191, baseline: 6.781, cost: 5 },
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
    /*
     * A real split card, because it is the case the joined text cannot express.
     * Ice has two abilities and Fire has one, so the string is three chunks with
     * only the first boundary a face change — the whole reason the faces are
     * carried separately. Here to be looked at: a face rule drawn in the wrong
     * place still passes a test that only counts the rules.
     */
    oracleId: 'f6',
    name: 'Fire // Ice',
    manaCost: '{1}{R}',
    manaValue: 4,
    colorIdentity: ['U', 'R'],
    typeLine: 'Instant // Instant',
    oracleText:
      'Fire deals 2 damage divided as you choose among one or two targets.\nTap target permanent.\nDraw a card.',
    oracleTextFaces: [
      'Fire deals 2 damage divided as you choose among one or two targets.',
      'Tap target permanent.\nDraw a card.',
    ],
    primaryRole: 'removal',
    priceUsd: 1.1,
    // A split card's art crop is the LEFT half only, which is the sort of thing
    // that is obvious on screen and invisible in a test.
    imageUris: {
      artCrop:
        'https://cards.scryfall.io/art_crop/front/1/8/18303862-4726-4136-814f-157aa7006579.jpg?1783918420',
      normal:
        'https://cards.scryfall.io/normal/front/1/8/18303862-4726-4136-814f-157aa7006579.jpg?1783918420',
    },
    reasons: ['Two spells on one card'],
  },
  {
    // Not a real card. Every mana symbol shape in one cost, including one the
    // parser cannot read — the point of this page is to be able to LOOK at the
    // awkward cases, and a hybrid that renders wrong is invisible in a test that
    // only checks it renders.
    oracleId: 'f5',
    name: 'Every Symbol At Once',
    manaCost: '{X}{15}{2/B}{W/U}{G/P}{W/U/P}{C}{S}{T}{ZZZ9}',
    manaValue: 21,
    colorIdentity: ['W', 'U', 'B', 'G'],
    typeLine: 'Sorcery — Fixture',
    oracleText: 'Exists so the symbol renderer can be inspected by eye.',
    primaryRole: 'removal',
    priceUsd: 0,
    reasons: ['Fixture only'],
  },
  {
    /*
     * A real `transform` card, and the reason `Fire // Ice` sits two entries
     * above it. Both have a `//` in their names and two entries in
     * `oracleTextFaces`; only this one is printed on two pieces of cardboard,
     * and only this one gets a flip control (ADR-0027). Seeing them on the same
     * page is the check that the rule is the back ART being present and not the
     * name or the text.
     *
     * The two URLs differ by one path segment — `/front/` against `/back/` —
     * which is what makes "the picture changed" and "the picture is the other
     * side" two different things to look at.
     */
    oracleId: 'f7',
    name: 'Delver of Secrets // Insectile Aberration',
    manaCost: '{U}',
    manaValue: 1,
    colorIdentity: ['U'],
    typeLine: 'Creature — Human Wizard',
    oracleText:
      'At the beginning of your upkeep, look at the top card of your library. You may reveal that card. If an instant or sorcery card is revealed this way, transform Delver of Secrets.\nFlying',
    oracleTextFaces: [
      'At the beginning of your upkeep, look at the top card of your library. You may reveal that card. If an instant or sorcery card is revealed this way, transform Delver of Secrets.',
      'Flying',
    ],
    primaryRole: 'wincon',
    priceUsd: 0.35,
    imageUris: {
      artCrop:
        'https://cards.scryfall.io/art_crop/front/6/9/6904ea20-e504-47da-95a0-08739fdde260.jpg?1783908173',
      normal:
        'https://cards.scryfall.io/normal/front/6/9/6904ea20-e504-47da-95a0-08739fdde260.jpg?1783908173',
    },
    backImageUris: {
      artCrop:
        'https://cards.scryfall.io/art_crop/back/6/9/6904ea20-e504-47da-95a0-08739fdde260.jpg?1783908173',
      normal:
        'https://cards.scryfall.io/normal/back/6/9/6904ea20-e504-47da-95a0-08739fdde260.jpg?1783908173',
    },
    reasons: ['A one-mana 3/2 flier, on a good day'],
  },
  {
    /*
     * Two physical faces and no picture of either — ADR-0027's third state.
     *
     * No card in the corpus takes this path today: all 1,393 printings with a
     * back face have resolved art. It is drawn here for the same reason the
     * no-art fallback two entries up is, and more urgently: this is the state
     * that a design collapsing "no picture" into "no second face" would render
     * as an ordinary card, and the only way to see that it has not been
     * collapsed is to look at it. The control must still be here, and pressing
     * it must change the panel.
     */
    oracleId: 'f8',
    name: "Tergrid, God of Fright // Tergrid's Lantern",
    manaCost: '{3}{B}{B}',
    manaValue: 5,
    colorIdentity: ['B'],
    typeLine: 'Legendary Creature — God',
    oracleText:
      'Menace\nWhenever an opponent sacrifices a nontoken permanent or discards a permanent card, you may put that card onto the battlefield under your control.\n{T}: Each opponent loses 1 life unless they sacrifice a nonland permanent or discards a card.',
    oracleTextFaces: [
      'Menace\nWhenever an opponent sacrifices a nontoken permanent or discards a permanent card, you may put that card onto the battlefield under your control.',
      '{T}: Each opponent loses 1 life unless they sacrifice a nonland permanent or discards a card.',
    ],
    primaryRole: 'engine',
    priceUsd: 12.5,
    imageUris: {
      artCrop:
        'https://cards.scryfall.io/art_crop/front/1/4/14dc88ee-bba9-4625-af0d-89f3762a0ead.jpg?1783928244',
      normal:
        'https://cards.scryfall.io/normal/front/1/4/14dc88ee-bba9-4625-af0d-89f3762a0ead.jpg?1783928244',
    },
    // Present and empty. ABSENT would mean one face; this means two faces whose
    // back art has not resolved, which is a different claim and a different
    // panel. The front resolving and the back not is the realistic shape of it:
    // they are two separate assets on Scryfall's CDN.
    backImageUris: {},
    reasons: ['Takes what the table throws away'],
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
              {/* The first three, plus the two double-faced ones at the end —
                  the flip control only exists at this level and at L2, and a
                  page that could not show it here would be the wrong page to
                  check it on. */}
              {[...FIXTURES.slice(0, 3), ...FIXTURES.slice(-2)].map((card) => (
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
