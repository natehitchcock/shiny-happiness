# BLE Radar — Garmin Venu 4

A Connect IQ watch app that turns the Venu 4 into a handheld **radar for Bluetooth
Low Energy devices**. It scans nearby BLE emitters, lets you pick a target, then
fuses **RSSI signal samples** with **GPS + compass + accelerometer** to estimate the
target's location and render **directional guidance on a 2D radar screen**.

- **Planning docs:** [`docs/`](docs/README.md) — the full design (product, platform
  constraints, architecture, algorithms, UI, testing, risks).
- **Build & status:** [`BUILD.md`](BUILD.md) — how to build/run, what's implemented,
  and what's stubbed.

## How it works (short version)

A single wrist antenna is omnidirectional — one reading tells you signal *strength*,
never *direction*. This app derives direction from **motion**: it records RSSI at
many GPS-stamped positions as you walk and fuses those noisy range estimates in a
**Bayesian occupancy-grid filter** to converge on the emitter's likely location. A
simpler **gradient ("hot/cold")** method provides guaranteed guidance even before the
grid converges. Expect meters-scale accuracy outdoors, with **confidence shown
honestly** rather than faked when physics won't cooperate (see `docs/09`).

## Status

Implemented: **M0–M3** from `docs/07-implementation-plan.md` — scan list, sampling +
sensor fusion, gradient guidance + radar UI, and the Bayesian grid filter, plus a
mock/replay layer for simulator testing and a minimal settings menu. Body-shadow
bearing (`ShadowBearing`) is implemented but not yet wired into a rotate-gesture flow.

> ⚠️ **Not built or tested in this environment.** Needs Garmin's Connect IQ SDK to
> compile and a physical Venu 4 to exercise BLE. See `BUILD.md`.

## Repository layout

```
manifest.xml              Connect IQ app manifest (permissions, product, icon)
monkey.jungle             build configuration
resources/                strings, drawables (launcher icon), settings properties
source/
  RadarApp.mc             entry point
  core/                   Const, MathUtil, Settings, SessionController (the brain)
  radio/                  BleScanner, DeviceRegistry
  sensors/                GeoProvider, MotionProvider, HeadingSource
  fusion/                 Sample, SampleBuffer, SampleBuilder
  localize/               Geo, PathLoss, GradientEstimator, GridFilter,
                          ShadowBearing, Estimate
  views/                  ScanListView, RadarView, SettingsMenu
  test/                   MockSignalSource, SyntheticTracks (simulator harness)
docs/                     design & planning documents
```
