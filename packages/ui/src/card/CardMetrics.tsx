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
 * READ-ONLY, therefore no controls. AGENTS.md R4 governs anything interactive;
 * there is nothing here to tap, focus or activate, so there is nothing to give
 * a keyboard equivalent or a focus ring to. The one thing that could have been
 * a control — a "what is this?" disclosure over the explanations — was rejected
 * in favour of simply printing them: a metric a reader has never seen has to
 * explain itself on first sight, and an explanation behind a button is an
 * explanation for people who already suspect they need it.
 */

import type { JSX } from 'react'
import {
  EFFICIENCY_CAVEAT,
  IMPACT_MAX,
  efficiencyWorking,
  impactFraction,
  impactNotes,
  impactRows,
  metricValue,
  type EfficiencyView,
  type ImpactView,
} from './metrics.js'

export interface CardMetricsProps {
  /** Absent while detail is still in flight, and for any surface that has none. */
  readonly impact?: ImpactView | undefined
  readonly efficiency?: EfficiencyView | undefined
}

export const CardMetrics = ({ impact, efficiency }: CardMetricsProps): JSX.Element | null => {
  // Nothing at all rather than a heading over two blanks. Detail arrives after
  // the card does, and a section that flashes empty reads as a broken panel.
  if (impact === undefined && efficiency === undefined) return null

  return (
    <section className="rt-metrics" aria-label="Impact and efficiency">
      {impact === undefined ? null : (
        <div className="rt-metric">
          <p className="rt-metric-head">
            <span className="rt-metric-label">Impact</span>
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
          {impactNotes(impact).map((note) => (
            <p className="rt-metric-note" key={note}>
              {note}
            </p>
          ))}
        </div>
      )}

      {efficiency === undefined ? null : (
        <div className="rt-metric">
          <p className="rt-metric-head">
            <span className="rt-metric-label">Efficiency</span>
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
