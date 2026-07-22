# 07 — Implementation Plan

Concrete path from empty folder to working app, for the PC-side Claude session.

## 0. Prerequisites
- Install the **Connect IQ SDK** + **SDK Manager**; download the SDK version that
  supports the **Venu 4** and install the Venu 4 device.
- **VS Code** + **Monkey C** extension (Garmin). It scaffolds projects, builds, and
  launches the simulator.
- Confirm the Venu 4's **API level** and **resolution** on the
  [Compatible Devices](https://developer.garmin.com/connect-iq/compatible-devices/)
  page; set `minApiLevel` / device targets accordingly.
- A **developer key** (`.der`) — the extension can generate one.
- A **test emitter**: ideally a beacon you control that advertises a **fixed service
  UUID** (an iBeacon/Eddystone dongle, or flash an ESP32/nRF52). This makes results
  repeatable (see `09`).

## 1. Project layout

```
manifest.xml
monkey.jungle
resources/
  drawables/            (icons, launcher)
  strings/strings.xml
  layouts/              (optional; we mostly draw custom)
  settings/             (properties for env preset, orientation, units)
source/
  RadarApp.mc
  core/       SessionController.mc  Settings.mc  Log.mc
  radio/      BleScanner.mc  DeviceRegistry.mc
  sensors/    GeoProvider.mc  MotionProvider.mc  HeadingSource.mc
  fusion/     SampleBuilder.mc  SampleBuffer.mc  Sample.mc
  localize/   Geo.mc  PathLoss.mc  GradientEstimator.mc  GridFilter.mc
              ShadowBearing.mc  Estimate.mc
  views/      ScanListView.mc  RadarView.mc  CoachOverlay.mc  SettingsView.mc
              (+ matching *Delegate.mc)
  test/       MockSignalSource.mc  SyntheticTracks.mc   (see 08)
```

`monkey.jungle`:
```
project.manifest = manifest.xml
base.sourcePath = source
# device-specific overrides if needed:
# venu4.sourcePath = $(base.sourcePath);source-venu4
```

`manifest.xml` essentials:
```xml
<iq:application id="..." type="watch-app" name="@Strings.AppName"
                entry="RadarApp" minApiLevel="X.Y.Z">
  <iq:products><iq:product id="venu4"/></iq:products>
  <iq:permissions>
    <iq:uses-permission id="BluetoothLowEnergy"/>
    <iq:uses-permission id="Positioning"/>
    <iq:uses-permission id="Sensor"/>
  </iq:permissions>
  <iq:languages><iq:language>eng</iq:language></iq:languages>
</iq:application>
```

## 2. Milestones (each ends in something runnable)

### M0 — Scaffold + scan list (proves BLE works)
- `RadarApp` (AppBase) → `ScanListView`.
- `BleScanner` scanning; `DeviceRegistry` builds the list; render names + RSSI bars.
- **Done when:** on real hardware (BLE can't be fully simulated — see `08`) you see
  live devices and can select one. This de-risks the single biggest unknown early.

### M1 — Sampling + sensor fusion (data pipeline)
- `GeoProvider`, `HeadingSource`, `MotionProvider`, `Geo` (ENU), `SampleBuilder`,
  `SampleBuffer`.
- On target selection, start producing `Sample`s at ~2 Hz with spatial gating (`04`).
- Add `Log`: dump samples (t, e, n, rssi, hdg) for offline inspection & replay.
- **Done when:** walking around produces a clean, bounded stream of spatially-diverse
  samples (inspect via log).

### M2 — Gradient guidance + Radar view (MVP is usable)
- `PathLoss`, `GradientEstimator`, `Estimate`, `SessionController` state machine.
- `RadarView`: center, rings, arrow (heading-up), distance, signal bar,
  warmer/colder, ACQUIRING/LOST/ARRIVED chrome. `CoachOverlay`.
- **Done when:** you can select a beacon and the arrow + warmer/colder reliably lead
  you toward it in the open. **This is the shippable MVP.**

### M3 — Grid Bayesian localization (the triangulation promise)
- `GridFilter` (occupancy grid, incremental updates, MAP centroid, confidence,
  multimodality flag).
- Fuse grid ↔ gradient in `SessionController` (`05` policy).
- Self-calibrate `n` (`PathLoss`).
- **Done when:** the arrow points at an actual estimated *location* (not just
  up-gradient), distance shrinks meaningfully on approach, confidence tracks reality.

### M4 — Polish & assists
- `ShadowBearing` (rotate-in-place) + coaching + fusion.
- Settings (orientation, env preset, units). Arrival/proximity mode. Angle EMA /
  hysteresis. AMOLED low-power draw path.

### M5 — Validation & tuning
- Field-test protocol (`08`); tune `alpha`, `sigma`, cell size, thresholds, buffer
  policy. Measure battery. Lock in defaults.

### Stretch (post-M5)
- Heatmap overlay; multi-target; breadcrumb; persistence; **WiFi phone companion**
  (`02`/`09`).

## 3. Key skeletons

`RadarApp.mc`:
```monkeyc
using Toybox.Application;
using Toybox.WatchUi;

class RadarApp extends Application.AppBase {
    hidden var _controller;
    function initialize() { AppBase.initialize(); }
    function onStart(state) { _controller = new SessionController(); }
    function onStop(state) { _controller.shutdown(); }
    function getInitialView() {
        return [ new ScanListView(_controller),
                 new ScanListDelegate(_controller) ];
    }
}
```

`SessionController.tick()` (the heartbeat):
```monkeyc
function tick() {
    var s = _sampleBuilder.buildIfReady();   // may return null
    if (s != null) {
        _buffer.add(s);
        _grid.applySample(s);                 // incremental (M3)
    }
    var est = _fuse(                          // 05 fusion policy
        _gradient.estimate(_buffer),
        _grid.estimate(),
        _shadow.latest());
    _estimate = _smooth(est);
    _advanceState(_estimate);                 // 03 state machine
    WatchUi.requestUpdate();
}
```

Timer wiring:
```monkeyc
_timer = new Timer.Timer();
_timer.start(method(:tick), 500, true);   // 2 Hz
```

Keep providers' callbacks thin (just store latest); all synthesis happens in `tick`.

## 4. Memory / performance budget
- Bound `SampleBuffer` (e.g. 128 samples). Bound grid (start 48×48–64×64 Int/Float).
- Reuse arrays in `onUpdate`; avoid allocation in hot paths.
- Filter at 1–2 Hz, render on request only. Profile with the simulator's memory
  viewer; if tight, shrink grid before anything else.
- Prefer integer/log-domain math in the grid to avoid float churn.

## 5. Build / run
- Build + launch simulator from VS Code (`Monkey C: Build and Run`) or
  `monkeyc -f monkey.jungle -o out/app.prg -d venu4 -y developer_key.der`.
- **BLE limitation in sim** → keep a `MockSignalSource` (`08`) behind an interface so
  M1–M5 logic runs in the simulator; validate real BLE on hardware at M0 and each
  field test.
- Sideload to the watch for field testing (see `08`).
