# 01 — Product Spec

## Vision

A wrist-worn "radar" that helps you **find a physical BLE device** — a beacon, a
tag, a speaker, an earbud case, a tracker — by walking toward it while the watch
shows a live 2D display of estimated **direction, distance, and confidence**.

Think "Hot / Cold" as a child's game, upgraded with real signal processing: the
watch samples the radio field from many points in space, and turns the pattern of
signal strengths into a best-guess location and a pointing arrow.

## Who it's for / how it's used

- **You**, wanting to locate a specific device you can see in a scan list (your own
  beacon, a misplaced tracked item, an advertising gadget).
- Usage loop: open app → app scans → pick a device → start walking → follow the
  arrow / warmer-colder feedback → arrive.

## Primary user stories

1. *As a user, I open the app and see a list of nearby BLE devices sorted by signal
   strength, with names where available.*
2. *As a user, I select a device and the app begins guiding me toward it.*
3. *As a user, while I walk the arrow updates to point at the estimated location and
   a distance estimate shrinks as I approach.*
4. *As a user, when the estimate is uncertain the app tells me so (low confidence)
   and coaches me to "walk 10 m" or "rotate slowly" to gather better samples.*
5. *As a user, I get a clear "you're very close" state when signal is strong and the
   estimate has converged.*

## Screens (see `06` for visual detail)

1. **Scan / Device list** — live list: name (or MAC/short id), RSSI bar, last-seen.
2. **Radar** — the core 2D view: you at center, range rings, direction arrow to
   target, distance + confidence, warmer/colder cue, signal bar.
3. **Calibration / coaching overlay** — transient prompts ("collecting samples…",
   "walk a short distance", "rotate slowly to get a bearing").
4. **Settings** (minimal) — heading-up vs north-up, path-loss preset
   (indoor/outdoor), units, reset target.

## Feature scope

### MVP (must ship — the guaranteed-achievable slice)
- BLE scan + device selection list.
- Continuous RSSI sampling of the selected device, smoothed.
- GPS + heading capture, time-aligned with RSSI.
- **Gradient "hot/cold" guidance**: arrow derived from *which recent movement
  direction increased signal the most*, plus a warmer/colder indicator.
- Coarse distance estimate from a fixed path-loss model.
- Radar view with arrow, distance, signal bar, confidence.

### V1 (the "triangulation" promise)
- **Occupancy-grid Bayesian localization** fusing all (position, RSSI) samples into
  a live probability field; arrow points to the field's peak; confidence from field
  spread.
- Optional **body-shadow bearing** assist for standing-still direction finding.
- Auto path-loss exponent estimation from data (self-calibration).
- Sample-quality coaching driven by real filter state.

### Stretch
- Radar **heatmap** overlay (render the probability field as a dim gradient).
- Multi-device tracking / switch targets without rescanning.
- Track breadcrumb of where you've walked.
- **WiFi via phone companion** (separate app pushing WiFi AP RSSI to the watch over
  BLE/ANT/Connect IQ messaging) — see `02` and `09`.
- Persist last-known emitter location to resume a hunt.

### Explicitly out of scope
- On-watch WiFi scanning (no public API — see `02`).
- Sub-meter indoor accuracy / RF fingerprint maps.
- Connecting to / controlling target devices (we only read advertisements).

## Success criteria

- **Functional:** From ~30–50 m in an open area, following the app reliably leads you
  to within a few meters of a cooperating beacon within a couple of minutes.
- **Honest UX:** When physics won't cooperate (multipath, weak/irregular
  advertiser), the app *shows low confidence* rather than pointing confidently in a
  wrong direction.
- **Battery:** A location session (BLE scan + GPS + compute) is usable for tens of
  minutes without alarming drain (quantify during `08`).
- **Responsiveness:** Radar view updates at ≥1 Hz; UI stays smooth.

## Non-functional notes
- AMOLED display → dark UI, avoid static bright elements (burn-in), animate
  economically.
- Keep memory footprint within Connect IQ app limits (see `02`/`07`).
- Degrade gracefully if heading is unavailable while stationary (see `05`, `09`).
