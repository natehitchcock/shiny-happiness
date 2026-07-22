# Garmin Venu 4 — BLE Radar App: Planning Docs

A set of implementation-ready design documents for a **Connect IQ watch app** that
turns the Garmin Venu 4 into a handheld **radar for Bluetooth Low Energy (BLE)
devices**. The app scans nearby BLE emitters, lets you pick a target, then uses
**multiple spatial signal samples** (RSSI) fused with **GPS + compass +
accelerometer** to estimate the target's position and render **directional guidance
on a 2D radar screen**.

> **Purpose of these docs:** hand this folder to a separate Claude Code session on
> your PC (with the Connect IQ SDK installed) to build the app. Each doc is written
> to be actionable on its own. Start with `01` and `02`, then implement along the
> milestones in `07`.

## Scope decisions baked into this plan (change if you disagree)

These were chosen as sensible defaults. Each is revisited in the doc noted.

| Decision | Default chosen | Where discussed |
|---|---|---|
| **Target model** | Scan → pick a device from a list → home in on it | `01`, `04` |
| **WiFi radar** | **Out of scope on-watch.** Connect IQ exposes **no public WiFi-scan API** to third-party apps. Documented as a future *phone-companion* extension. | `02`, `09` |
| **Form factor** | Full launchable **watch app** with a dedicated radar view (not a glance/widget) | `02`, `06` |
| **Localization core** | Bayesian **occupancy grid** filter (robust, gives confidence + heatmap), with a simpler **gradient "hot/cold"** mode as the guaranteed-shippable MVP | `05` |

## Document index

1. **[01-product-spec.md](01-product-spec.md)** — vision, user stories, screens, feature scope (MVP → stretch), success criteria.
2. **[02-platform-constraints.md](02-platform-constraints.md)** — what the Venu 4 / Connect IQ can and cannot do; BLE API surface; the WiFi reality; permissions; SDK setup.
3. **[03-architecture.md](03-architecture.md)** — module breakdown, data flow, app state machine, class responsibilities.
4. **[04-signal-sampling.md](04-signal-sampling.md)** — how to scan, what a "sample" is, sensor fusion, sampling strategy, data model, buffering.
5. **[05-localization-algorithms.md](05-localization-algorithms.md)** — the math: path-loss model, gradient/hot-cold, multilateration, body-shadow bearing, the grid filter, smoothing & confidence.
6. **[06-ui-radar-design.md](06-ui-radar-design.md)** — the 2D radar view, rendering on AMOLED, heading-up vs north-up, screens & interactions.
7. **[07-implementation-plan.md](07-implementation-plan.md)** — project layout, milestones, Monkey C skeletons, build/run, memory budget.
8. **[08-testing-validation.md](08-testing-validation.md)** — simulator limits, a mock/replay signal layer, field-test protocol, honest accuracy expectations.
9. **[09-risks-open-questions.md](09-risks-open-questions.md)** — RSSI noise, MAC randomization, heading reliability, battery, privacy/legal, open questions to resolve.

## The one-paragraph summary

A single wrist-worn antenna is **omnidirectional** — one reading tells you *how
strong*, never *which way*. This app manufactures direction from **motion**: it
records RSSI at many GPS-stamped positions as you walk (and optionally as you
rotate, using your own body as a directional shield), converts signal strength to
rough distance via a path-loss model, and fuses those noisy range estimates in a
probabilistic filter to converge on the emitter's likely location. The radar view
then draws an arrow and distance to it. Expect **meters-scale accuracy outdoors in
the open** and graceful degradation (shown as low confidence) amid multipath.
