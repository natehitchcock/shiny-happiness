# 08 — Testing & Validation

The hard truth: **BLE and real GPS movement can't be meaningfully faked in the
Connect IQ simulator.** So we split testing into (a) *algorithm correctness* against
synthetic data (fast, in simulator/CI-like loop) and (b) *real-world behavior* on
hardware (the only place BLE + GPS + multipath are real).

## 1. Make the engine testable — the mock signal layer

Design the pipeline so the localization engine consumes an **interface**, not the
radio directly:

```
interface SignalSource {
    // returns latest observation(s): rssi + timestamp for the target
}
```
- **`BleScanner`** implements it for real hardware.
- **`MockSignalSource`** implements it from a scripted scenario: a known emitter
  position + a synthetic user track; it computes "true" distance, applies the
  path-loss model, and adds Gaussian noise + optional multipath spikes to produce
  realistic RSSI. Feed synthetic GPS positions to `GeoProvider`'s inputs similarly.

With this, **M1–M5 logic runs entirely in the simulator** against
`SyntheticTracks` (straight walk-past, L-shaped path, spiral-in, stand-and-rotate),
and you can assert:
- Gradient bearing points roughly at the true emitter once the track has diversity.
- Grid MAP converges toward the true position as samples accumulate; error shrinks.
- Confidence rises as spread shrinks; multimodality flagged for ambiguous geometry.
- Self-calibrated `n` approaches the value used to synthesize the data.

Keep synthetic scenarios + expected-outcome assertions in `source/test/` and run them
via a debug menu / a test entry view (Monkey C has no first-class unit runner;
a "run self-tests" screen that logs PASS/FAIL is the pragmatic approach).

## 2. Simulator checks (what the sim *is* good for)
- UI layout at the real device resolution; round safe-area clipping; light/dark.
- State machine transitions (drive with mock source).
- Memory profiler + peak memory under full grid + full buffer.
- Position simulation: the sim can play back a GPS track (use it to exercise
  `GeoProvider` + ENU conversion), though it won't couple to RSSI — the mock source
  closes that loop.
- Sensor simulation for accel/heading where supported.

## 3. Hardware bring-up (do early — M0)
- Sideload the `.prg`; grant BLE/Position/Sensor permissions.
- Confirm **real scan results** appear and RSSI updates live. Confirm your test
  beacon is selectable with a **stable key** across minutes (`04`).
- Confirm GPS fixes + accuracy outdoors; confirm heading source behavior **while
  stationary vs walking** (this determines how much you can rely on north-up /
  ShadowBearing — see `02`/`09`).

## 4. Field-test protocol (repeatable)
Run each with the debug logger on; export/inspect logs.

1. **Walk-past** (open field): place beacon; start ~40 m away; walk a straight line
   past it at ~10 m offset. *Expect:* warmer→colder flip near closest approach; grid
   peak lands near true position.
2. **Home-in**: start ~30 m away; follow the arrow. *Metric:* final distance to
   beacon, time-to-find, path efficiency (walked / straight-line).
3. **Stand-and-rotate**: stand ~15 m away, do the rotate gesture. *Expect:*
   ShadowBearing points within a sensible error; note compass dependence.
4. **Multipath/indoor**: repeat indoors or near buildings/cars. *Expect:* degraded
   accuracy — verify the app **shows low confidence** rather than confidently wrong.
5. **Close-range**: approach to < 2 m. *Expect:* ARRIVED/proximity mode engages;
   arrow stops spinning.
6. **Untrackable device**: pick a phone with MAC randomization. *Expect:* the app
   warns and/or the target key churns — validates the `09` handling.

Record for each: beacon type, environment, GPS accuracy, samples collected,
final error (pace it off / use a second GPS), subjective usability.

## 5. Tuning knobs (defaults to lock in during M5)
| Knob | Where | Start | Notes |
|---|---|---|---|
| RSSI EMA `alpha` | `04` | 0.3 | lower = smoother, laggier |
| Median window | `04` | 5 | spike rejection |
| Sample spatial gate | `04` | 1–2 m | diversity vs count |
| Buffer capacity | `04`/`07` | 128 | memory bound |
| Path-loss `n` presets | `05` | 2.2 / 2.7 / 3.2 | outdoor/mixed/indoor |
| `RSSI_1m` | `05` | -59 dBm | or beacon-advertised |
| Grid extent / cell | `05` | ±64 m / 2 m | shrink cell if memory ok |
| Measurement `sigma` | `05` | 6 dB | widen for bad GPS |
| Confidence spread threshold | `05` | few m | ACQUIRING↔TRACKING |
| "Very close" RSSI | `05`/`06` | ~ -50 dBm | ARRIVED trigger (calibrate) |
| Filter tick rate | `03`/`07` | 2 Hz | vs battery |

## 6. Accuracy targets (accept these, don't over-promise)
- Open field, cooperative beacon, decent GPS: **converge to within a few meters**;
  correct "which way" the large majority of the time after ~20–30 m of walking.
- Urban/indoor: expect **larger, biased error**; success = the app communicates
  uncertainty and still trends the user closer, not pinpoint accuracy.
- These are consistent with the physics of RSSI localization from a single moving
  omnidirectional antenna — see `09` for why.

## 7. Battery / thermal
- Measure a continuous 20–30 min session (BLE scan + continuous GPS + 2 Hz filter).
  Record % drain. If heavy: lower GPS to a coarser mode when stationary, drop tick to
  1 Hz, or duty-cycle scanning. Note results in `09`/README for the user.

## 8. Regression discipline
- Keep the synthetic scenarios + PASS/FAIL self-tests green as the engine changes.
- After each field session, add any surprising real trace to the replay set (log →
  synthetic scenario) so fixes are reproducible without going back outside.
