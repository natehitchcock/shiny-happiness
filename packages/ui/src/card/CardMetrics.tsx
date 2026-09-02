/**
 * Impact and efficiency, on the card detail pane (doc 18 §18.8).
 *
 * ONE COMPONENT, TWO MOUNTS. The L3 `Detail` primitive renders it, and so does
 * the workspace's own preview panel in `apps/web/src/App.tsx` — which is a
 * separate renderer of the same idea and is the one a builder actually looks
 * at. A second implementation for the second mount is how the two surfaces
 * start disagreeing about a number that doc 18 §18.8 put on one wire precisely
 * so they could not.
 *
 * EVERY FINDING IS PRINTED; ONLY THE METHOD IS BEHIND A DISCLOSURE. The tier
 * rows, the role comparison and the "effects only" caveat are all unconditional
 * text, and the reason is the same for all three: a metric a reader has never
 * seen has to explain itself on first sight. `impactRole` is the case that
 * tested it. The app has a `Hint` popover — top-layer, unclipped, keyboard and
 * touch-equivalent — and the obvious move was to hang the role figures off it.
 * Rejected twice over. The pane is 21rem and a bottom sheet on a phone, but it
 * is showing ONE card, so it never needed the eighteen-row table that width
 * would have forced behind a disclosure; one row fits in two lines of prose.
 * And the reader who most needs that line is the one looking at Sol Ring's 0.68
 * and quietly concluding the app rates it badly — they have no reason to press
 * anything, because they do not yet know they have been misled. Help that only
 * opens on request cannot reach them.
 *
 * `explain` is the ONE thing that goes behind a button, and it is admitted on
 * exactly the argument that excluded the others rather than in spite of it
 * (doc 18 §18.14). "How is this worked out?" fails the other way round: a
 * reader who wants the method knows they want it and goes looking, so a
 * disclosure reaches them. And the answer is seven lines per metric, which in
 * 21rem would bury the three tier rows it exists to explain. Nothing that was
 * printed before is now hidden.
 *
 * AGENTS.md R4 stays satisfied in one place: the disclosure is a SLOT, and the
 * app fills it with `Hint`, which is already a real button with a focus ring, a
 * name and a touch target. Nothing in this package is tappable. (`Hint` also
 * lives in `apps/web` and `@roundtable/ui` does not import from an app — but
 * that is a consequence of the layering, not the reason.)
 */

import type { JSX } from 'react'
import {
  EFFICIENCY_ALGORITHM_LABEL,
  EFFICIENCY_CAVEAT,
  IMPACT_ALGORITHM_LABEL,
  IMPACT_MAX,
  efficiencyAlgorithm,
  efficiencyWorking,
  impactAlgorithm,
  impactFraction,
  impactNotes,
  impactRoleLine,
  impactRows,
  metricValue,
  type EfficiencyView,
  type ImpactRoleView,
  type ImpactView,
} from './metrics.js'

/**
 * Renders one algorithm explanation as a disclosure — supplied by the app.
 *
 * A SLOT, NOT AN IMPORT. The explanation belongs behind the app's `Hint`: it
 * is eight lines, the pane is 21rem and a bottom sheet on a phone, and `Hint`
 * is already the top-layer, unclipped, keyboard-and-touch-equivalent popover
 * this app uses for on-demand help. But `Hint` lives in `apps/web` and
 * `@roundtable/ui` does not import from an app, so the app passes a renderer in
 * and this file only decides WHERE it goes and WHAT it says.
 *
 * That also puts AGENTS.md R4 where it can be satisfied once: `Hint` already
 * has the button, the focus ring, the touch target and the escape key, and
 * nothing interactive is added here.
 *
 * Optional, so the L3 `Detail` primitive — which has no `Hint` to give — draws
 * exactly what it drew before.
 */
export type MetricExplainer = (explanation: {
  /** Accessible name for the trigger. */
  readonly label: string
  /** The explanation, one line per row. */
  readonly lines: readonly string[]
}) => JSX.Element

export interface CardMetricsProps {
  /** Absent while detail is still in flight, and for any surface that has none. */
  readonly impact?: ImpactView | undefined
  readonly efficiency?: EfficiencyView | undefined
  /**
   * Where the card's own role sits, so `6.12` and `0.68` can be read correctly
   * (doc 18 §18.12).
   *
   * Optional, and absent wherever the card's role is: a search result, an
   * unresolved import. The pane then reads exactly as it did before.
   */
  readonly impactRole?: ImpactRoleView | undefined
  /**
   * How to draw "how is this worked out?" (report 5).
   *
   * Absent on any surface with no popover to put it in, and the pane is
   * unchanged when it is.
   */
  readonly explain?: MetricExplainer | undefined
}

export const CardMetrics = ({
  impact,
  efficiency,
  impactRole,
  explain,
}: CardMetricsProps): JSX.Element | null => {
  // Nothing at all rather than a heading over two blanks. Detail arrives after
  // the card does, and a section that flashes empty reads as a broken panel.
  if (impact === undefined && efficiency === undefined) return null

  const roleLine = impact === undefined ? null : impactRoleLine(impact, impactRole)

  return (
    <section className="rt-metrics" aria-label="Impact and efficiency">
      {impact === undefined ? null : (
        <div className="rt-metric">
          <p className="rt-metric-head">
            <span className="rt-metric-label">
              Impact
              {explain === undefined
                ? null
                : explain({ label: IMPACT_ALGORITHM_LABEL, lines: impactAlgorithm() })}
            </span>
            {/*
             * The range is printed, not implied. "6.12" alone is unreadable —
             * this is the whole reason the meter and the "of 18.48" are here.
             *
             * Rejected: a percentile against the corpus. It is the more useful
             * number and the client does not have it; producing it would mean a
             * server-side distribution, a second thing to keep in step with the
             * model, and a figure that changes when the card pool does. The
             * model's own ceiling is a fact about the model, needs nothing, and
             * cannot drift.
             */}
            <span className="rt-metric-value">
              {metricValue(impact.score)}
              <span className="rt-metric-of"> of {metricValue(IMPACT_MAX)}</span>
            </span>
          </p>
          {/*
           * `aria-hidden`, and no `role="meter"`.
           *
           * The bar restates the line directly above it, which already says
           * "6.12 of 18.48" in text. A meter role would make a screen reader
           * announce the same two numbers a second time, and a second reading
           * of a number is not a second piece of information. Sighted readers
           * get the shape; everyone gets the value.
           */}
          <div className="rt-metric-meter" aria-hidden="true">
            <span
              className="rt-metric-fill"
              style={{ inlineSize: `${String(impactFraction(impact.score))}%` }}
            />
          </div>
          {impactRows(impact).length === 0 ? null : (
            <dl className="rt-metric-rows">
              {impactRows(impact).map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {/*
           * WHERE THE NUMBER BECOMES READABLE (doc 18 §18.12).
           *
           * Directly under the tier rows, because it is the answer to the
           * question those rows raise but cannot settle — "everything at once,
           * once, on an opponent's side" tells a reader what the card does and
           * still leaves 6.12 floating against a ceiling of 18.48. This is the
           * sentence that says whether 6.12 is a lot. It sits above the notes
           * because the notes qualify it.
           *
           * Its own paragraph rather than a fourth `dl` row: Reach, Repeats and
           * Falls on are three facts about THIS card's text, and a corpus
           * comparison is a different kind of statement that should not be
           * dressed as a fourth tier.
           */}
          {roleLine === null ? null : <p className="rt-metric-role">{roleLine}</p>}
          {impactNotes(impact, impactRole).map((note) => (
            <p className="rt-metric-note" key={note}>
              {note}
            </p>
          ))}
        </div>
      )}

      {efficiency === undefined ? null : (
        <div className="rt-metric">
          <p className="rt-metric-head">
            <span className="rt-metric-label">
              Efficiency
              {explain === undefined
                ? null
                : explain({ label: EFFICIENCY_ALGORITHM_LABEL, lines: efficiencyAlgorithm() })}
            </span>
            {/* "per mana" rather than a bare float: the unit is what stops this
                being read as a second score on the same scale as impact. */}
            <span className="rt-metric-value">
              {metricValue(efficiency.score)}
              <span className="rt-metric-of"> per mana</span>
            </span>
          </p>
          <p className="rt-metric-note">{efficiencyWorking(efficiency)}</p>
          <p className="rt-metric-note">{EFFICIENCY_CAVEAT}</p>
        </div>
      )}
    </section>
  )
}
