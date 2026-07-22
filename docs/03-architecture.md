# 03 — Architecture

## Guiding principles

- **Separate signal acquisition from math from UI.** The localization engine must be
  pure and testable with synthetic data (no live radio), so it can be validated in
  the simulator and iterated fast (see `08`).
- **One coordinate world:** convert everything to a **local ENU (East-North-Up)
  meters** plane centered on a session reference point. Do all math there; only
  convert back to lat/lon at the edges.
- **Bounded resources:** ring-buffered samples, a coarse fixed-size grid, work
  throttled to a fixed tick.
- **Confidence is a first-class output**, not an afterthought.

## Module map

```
app/
  RadarApp            (Toybox.Application.AppBase)  — lifecycle, wiring
  views/
    ScanListView      — device discovery + selection
    RadarView         — the 2D radar (core screen)
    CoachOverlay      — transient guidance prompts
    SettingsView      — minimal settings
    *Delegate         — WatchUi input delegates for each view
  radio/
    BleScanner        (extends Ble.BleDelegate) — scanning, ScanResult → observations
    DeviceRegistry    — tracks discoverable devices, stable-key dedup
  sensors/
    GeoProvider       — wraps Position; emits GPS fixes + heading + quality
    MotionProvider    — wraps Sensor accel; stationary/walking + rotate gesture
    HeadingSource     — abstracts absolute heading + reliability flag
  fusion/
    SampleBuilder     — time-aligns RSSI + position + heading → Sample
    SampleBuffer      — bounded ring buffer of Samples
  localize/
    Geo               — lat/lon <-> local ENU meters, bearings, distances
    PathLoss          — RSSI <-> distance model (+ self-calibration)
    GradientEstimator — MVP hot/cold direction from motion
    GridFilter        — Bayesian occupancy-grid localization (V1 core)
    ShadowBearing     — body-shadow standing-still bearing (assist)
    Estimate          — {bearing, distance, confidence, mode, hint}
  core/
    SessionController — the state machine; owns providers, engine, current Estimate
    Settings          — persisted config
    Log               — debug/replay logging (see 08)
```

> Monkey C has no folders enforced by the compiler — `monkey.jungle` globs
> `source/**`. The paths above are organizational; use matching class names /
> file names.

## Data flow (happy path)

```
BleScanner.onScanResults ─► DeviceRegistry (list for ScanListView)
                              │ (after user picks target)
                              ▼
BleScanner (filtered to target key) ─┐
GeoProvider (GPS fix + heading)      ├─► SampleBuilder ─► SampleBuffer
MotionProvider (state, gesture)      ┘         │
                                               ▼
                                   SessionController.tick() @ ~2 Hz
                                               │
                        ┌──────────────────────┼───────────────────────┐
                        ▼                       ▼                        ▼
                 GradientEstimator          GridFilter             ShadowBearing
                        └──────────► fuse into single Estimate ◄────────┘
                                               │
                                               ▼
                                 RadarView.onUpdate(dc)  (arrow, distance, confidence)
                                 CoachOverlay (if low confidence / needs samples)
```

## The `Sample` (the atomic unit — detail in `04`)

```
Sample {
  t         : Number   // ms timestamp
  rssi      : Number   // smoothed dBm for the target at this moment
  rawRssi   : Number   // last raw reading (debug)
  e, n      : Float    // local ENU meters from session reference
  posAcc    : Number   // GPS accuracy enum/estimate (meters)
  heading   : Float    // radians, absolute (may be null)
  hdgOk     : Boolean  // heading reliability flag
  moving    : Boolean  // from MotionProvider
}
```

## App state machine (owned by `SessionController`)

```
        ┌─────────────┐  pick device   ┌───────────────┐
        │  SCANNING   │───────────────►│  ACQUIRING     │
        │ (list view) │                │ (few samples)  │
        └─────────────┘                └──────┬─────────┘
              ▲                                │ enough spatially-diverse samples
              │ back / reset                   ▼
              │                         ┌───────────────┐  signal strong & converged
              │                         │  TRACKING     │───────────────► ARRIVED
              │                         │ (radar live)  │◄───────────────
              │                         └──────┬────────┘   signal drops / diverges
              │        target lost (timeout)   │
              └────────────────────────────────┘
```

State meanings:
- **SCANNING** — showing device list; BLE scan unfiltered.
- **ACQUIRING** — target chosen; collecting the first samples; UI shows "collecting…"
  and coaches the user to move. GradientEstimator/GridFilter not yet confident.
- **TRACKING** — enough spatial diversity; radar shows a real arrow + distance +
  confidence, updating live.
- **ARRIVED** — RSSI above a "very close" threshold and estimate converged tight →
  celebratory "you're here" state (still updates).
- **LOST** — no advertisements for N seconds → warn, hold last estimate dimmed,
  offer rescan.

## Threading / timing model

Connect IQ is single-threaded, event/callback-driven. Structure as:
- **Event callbacks** (BLE results, GPS fixes, sensor events) just *record* into
  providers/buffer — do minimal work.
- **A timer tick** (`Toybox.Timer` at ~2 Hz) runs `SessionController.tick()`: builds
  any new Sample, updates the estimator(s), updates the Estimate, and calls
  `WatchUi.requestUpdate()`.
- **`RadarView.onUpdate`** is pure rendering from the latest Estimate + buffer. No
  math beyond drawing.

Decoupling the filter tick from rendering keeps the UI smooth and makes the heavy
math rate-limited and predictable for the memory/CPU budget.

## Error / degradation handling
- No BLE permission / BLE off → explain, exit gracefully.
- No GPS fix yet → stay in ACQUIRING, show "waiting for GPS"; gradient/grid need
  position.
- Heading unreliable → hide north-up option, force heading-up-via-motion, lean on
  gradient method, coach "walk to get a bearing."
- Target uses randomized identity → DeviceRegistry can't hold it stable → warn at
  selection time ("this device may not be trackable; pick one with a stable id").
