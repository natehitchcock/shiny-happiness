# Build, Run & Status

## Prerequisites

1. **Connect IQ SDK** (via Garmin's SDK Manager). Install the SDK version that lists
   the **Venu 4** as a supported device, and install the Venu 4 device files.
2. **VS Code** + the **Monkey C** extension (Garmin), or the CLI `monkeyc`.
3. A **developer key** (`.der`). The VS Code extension can generate one
   (`Monkey C: Generate a Developer Key`).

## Verify before first build (device specifics)

These couldn't be confirmed while the code was written — check them on Garmin's
[Compatible Devices](https://developer.garmin.com/connect-iq/compatible-devices/)
page and adjust:

- **`manifest.xml` → `minApiLevel`** and the **`venu4` product id** string. The
  value in the manifest (`3.3.0`) is the minimum for BLE central scanning; set it to
  what the Venu 4 actually reports if the build complains.
- **Screen resolution** — the UI uses relative coordinates, but confirm layout looks
  right in the simulator at the Venu 4's real resolution.
- **Stationary compass heading** — `HeadingSource` falls back to
  `Activity.getActivityInfo().currentHeading`; verify it returns a usable heading
  while standing still on hardware (affects heading-up mode and body-shadow bearing).

## Build & run

VS Code: **Monkey C: Build and Run** (pick the Venu 4 simulator).

CLI:
```bash
monkeyc -f monkey.jungle -o out/BleRadar.prg -d venu4 -y /path/to/developer_key.der
# then open out/BleRadar.prg in the Connect IQ simulator, or sideload to the watch
```

## Testing in the simulator (no real BLE)

BLE scanning cannot be simulated. To exercise the **whole pipeline** (sampling →
grid → gradient → radar UI → state machine) against a synthetic emitter and walking
track:

1. In `source/core/Const.mc` set `MOCK_ENABLED = true`.
2. Build & run. A **"MOCK Beacon"** appears in the scan list; select it.
3. Pick a scenario with `MOCK_SCENARIO` in `Const.mc`:
   - `0` **walk-past** — the synthetic user walks a track (`SyntheticTracks.walkPast()`;
     switch to `homeIn()` in `MockSignalSource.initialize` to test ARRIVED). Watch the
     arrow, distance, confidence, and warmer/colder cue respond as they "walk."
   - `1` **stand-and-rotate** — fixed position, heading sweeps a full turn, and RSSI is
     modulated by a body-shadow term (emitter due east). Exercises `ShadowBearing`:
     after roughly one rotation the arrow should point east (clearest in **north-up**
     mode — tap the radar to toggle orientation). The hint reads "rotate slowly" until
     a bearing locks.
4. Set `MOCK_ENABLED = false` again before shipping.

See `docs/08-testing-validation.md` for the field-test protocol and tuning table.

## What's implemented (milestones from docs/07)

| Milestone | Status | Notes |
|---|---|---|
| M0 Scan list | ✅ | `BleScanner`, `DeviceRegistry`, `ScanListView`. Validate real BLE on hardware. |
| M1 Sampling + fusion | ✅ | `GeoProvider`, `MotionProvider`, `HeadingSource`, `SampleBuilder`, `SampleBuffer`, `Geo` (ENU). |
| M2 Gradient + radar UI | ✅ | `GradientEstimator`, `PathLoss`, `RadarView`, state machine in `SessionController`. Shippable MVP. |
| M3 Bayesian grid | ✅ | `GridFilter` (occupancy grid, MAP centroid, confidence), fused with gradient. `PathLoss.calibrate` for self-tuning n. |
| M4 Assists/polish | ◐ | Settings menu + orientation toggle done. `ShadowBearing` **wired**: `SessionController` detects a stand-and-rotate sweep, feeds it, and fuses the bearing (confirms the grid, or fills the standing-still gap). Testable in-sim via `MOCK_SCENARIO = 1`. |
| M5 Validation | ☐ | Field testing + tuning is on-device work (docs/08). |

## Known gaps / next steps for the PC session

- **Validate `ShadowBearing` on hardware.** It is wired (`SessionController.updateShadow`
  detects a stationary heading sweep, accumulates it, and `populateEstimate` fuses the
  result), but it depends on a usable **stationary compass heading** — confirm that
  works on the Venu 4, and tune the sweep gates in `Const.mc` (`SHADOW_*`) against real
  rotations. The sweep requires ~6 of 8 heading sectors and ~258° of cumulative
  rotation before trusting a bearing, so standing still never fabricates one.
- **Confirm the accel path** on hardware — `MotionProvider` reads `Sensor.Info.accel`;
  some devices need `Sensor.registerSensorDataListener` instead. The app still works
  if motion state is unavailable (the `moving` flag is currently advisory).
- **Tune constants** in `Const.mc` against real traces (grid size/cell, `sigma`,
  RSSI `alpha`, thresholds) — see the table in `docs/08`.
- **Battery**: measure a real session; consider coarser GPS when stationary or a
  1 Hz tick if drain is high.
- **Grid recentring**: the grid is fixed on the first-fix reference (±72 m). If you
  start a hunt and the target is far/you walk a long way, add recentring (documented
  in `docs/05`).

## Caveats baked into the design (see docs/09)

- RSSI is noisy (±6–10 dB); accuracy is meters-scale outdoors and worse indoors — the
  app surfaces **confidence** rather than faking precision.
- Devices that randomize their BLE identity (phones, some trackers) can't be tracked
  reliably. **A beacon you control (fixed service UUID) gives the best results.**
- No on-watch WiFi scanning exists in Connect IQ; this app is BLE-only.
