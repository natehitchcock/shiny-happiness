# 02 — Platform Constraints (Connect IQ / Venu 4)

This is the reality-check doc. Read it before designing anything, because it draws
the hard line between *what the app can do* and *what physics + Garmin's SDK forbid*.

> **Verify version specifics.** The Venu 4 is a recent device. Before coding,
> confirm its **Connect IQ System version / API level** and its exact **screen
> resolution** on Garmin's
> [Compatible Devices](https://developer.garmin.com/connect-iq/compatible-devices/)
> page, and target that API level in `manifest.xml`. The API names below are stable
> across recent CIQ, but the *device* must be listed as supporting each module.

## Language & tooling

- **Language:** Monkey C (Garmin's proprietary, statically-typed-ish, GC'd).
- **SDK:** Connect IQ SDK + `monkeyc` compiler + Connect IQ **simulator**.
- **IDE:** VS Code with the official **Monkey C extension** (recommended), or the
  CLI. Project is defined by `manifest.xml` + `monkey.jungle`.
- **App type:** a **watch-app** (`<iq:application ... type="watch-app">`) so it gets
  a full launchable UI, foreground run time, and access to BLE/GPS/sensors.

## ✅ Bluetooth Low Energy — supported (this is the whole app)

Module: **`Toybox.BluetoothLowEnergy`** (alias `Ble`). The watch acts as a BLE
**central**. For a radar we only need **scanning of advertisements**, not
connections — advertisements carry the RSSI we need.

Key surface (confirm against API docs for your SDK version):

- `Ble.setDelegate(delegate)` — register a `Ble.BleDelegate` subclass.
- `Ble.setScanState(Ble.SCAN_STATE_SCANNING | Ble.SCAN_STATE_OFF)` — start/stop
  scanning.
- Delegate callbacks:
  - `onScanResults(scanResults)` — called with an **iterator** of `ScanResult`.
  - `onScanStateChange(scanState, status)` — scan started/stopped/errored.
- **`Ble.ScanResult`** (one advertisement sighting) exposes:
  - `getRssi()` → Number (dBm, typically ~ -30 near, ~ -100 far). **This is the
    signal we sample.**
  - `getDeviceName()` → String or null (often null; many devices don't advertise a
    name).
  - `getManufacturerSpecificData(companyId)` → iterator of ByteArray.
  - `getServiceUuids()` → iterator of Uuid.
  - `getServiceData(uuid)`, `getRawData()` — *note: community bug reports flag
    parsing issues on some data; don't hard-depend on raw payload structure. RSSI is
    reliable.*
  - `getAppearance()`, `isConnectable()`.

### BLE gotchas that shape the design
- **No stable identity guaranteed.** Many modern devices (phones, AirTags, some
  trackers) **randomize their MAC / rotate identifiers** periodically. `ScanResult`
  does **not** hand you a raw MAC anyway. To *track one device over time* you must
  key on the most stable thing it advertises: a **service UUID**, a **manufacturer
  data prefix**, or a **device name** if present. **For reliable results, target a
  beacon you control** that advertises a fixed service UUID / manufacturer id (e.g.
  an iBeacon/Eddystone-style beacon, or an ESP32/nRF you flash). See `09`.
- **Advertisement cadence varies.** Some emitters advertise many times/sec, others
  every 1–2 s. Your sampler must tolerate irregular, bursty updates.
- **RSSI is noisy:** ±6–10 dB swings from multipath, body position, antenna
  orientation, and hand movement — even when standing still. All algorithms in `05`
  are built around this.
- **Concurrency limits.** CIQ caps concurrent BLE operations/connections. We stay in
  scan-only mode, which sidesteps most of it, but don't assume unlimited registered
  profiles.
- **Permission required:** `<uses-permission id="BluetoothLowEnergy" />` in the
  manifest; the user grants it on install.

## ✅ Position / GPS — supported

Module: **`Toybox.Position`**.
- `Position.enableLocationEvents(Position.LOCATION_CONTINUOUS, callback)`.
- Callback receives a `Position.Info`: `.position` (a `Position.Location`),
  `.accuracy` (quality enum), `.heading` (radians, **derived from motion**),
  `.speed`, `.altitude`.
- `Location.toDegrees()` / `.toRadians()` → `[lat, lon]`.
- **GPS accuracy** outdoors is typically a few meters; this is the *spatial ruler*
  for our samples. Indoors GPS is poor/absent → localization degrades (show it).
- Permission: `<uses-permission id="Positioning" />`.

## ⚠️ Heading / compass — supported but nuanced (critical for the arrow)

Absolute heading (which way the watch is pointing) is what lets us rotate the arrow
into the real world.

- **While moving:** `Position.Info.heading` and `Activity.Info.currentHeading`
  give a course over ground from GPS.
- **While standing still:** you need the **magnetometer compass**. The Venu 4 has a
  3-axis compass. Query heading via `Activity.Info.currentHeading` (radians); on
  compass-equipped devices this reflects the magnetometer when stationary.
  **Verify on-device**: on some watches magnetometer heading is only surfaced in
  certain activity/sensor states, and can be noisy/uncalibrated.
- **Design implication:** treat "absolute heading source" as an **abstraction with a
  reliability flag** (see `03`/`05`). If heading is unreliable while stationary, the
  app leans on the **motion-gradient** method (which needs no compass) and asks the
  user to walk.
- Permission for sensors: `<uses-permission id="Sensor" />`.

## ✅ Accelerometer / motion — supported

Module: **`Toybox.Sensor`** (and `Sensor.registerSensorDataListener` for raw,
high-rate accel; `Sensor.Info.accel` for periodic `[x,y,z]` mG).
- Uses in this app: detect **stationary vs walking** (gate the gradient method),
  detect the **rotate-in-place** gesture for body-shadow bearing, and count rough
  motion. **Do not** attempt precise accelerometer dead-reckoning between GPS
  fixes — double-integration drift makes it unreliable; GPS is our position truth.

## ❌ WiFi scanning — NOT available to third-party apps

There is **no public Connect IQ API** for scanning WiFi access points / reading WiFi
RSSI. WiFi on the watch is used internally (sync) and is not exposed to apps. **Do
not plan an on-watch WiFi radar.**

Paths if WiFi is important (all deferred — see `09`):
1. **Phone companion app** (iOS/Android) does WiFi scanning and pushes AP RSSI to
   the watch via **Connect IQ mobile SDK messaging** (`Communications` /
   `Toybox.Communications` `transmit`, or the Connect IQ Mobile SDK's message
   channel). Note iOS restricts WiFi scanning heavily for third parties; Android
   allows it with location permission and throttling.
2. Note that **many WiFi devices also expose BLE** (phones, printers, smart-home
   gear) — the BLE radar already covers a lot of "find that device" cases.

## Display / graphics

- **AMOLED, round.** Confirm resolution (Venu-class devices are round, high-res —
  e.g. 390×390 / 416×416 / 454×454 depending on model; **check the device**).
- Render with `Toybox.WatchUi.View.onUpdate(dc)` and `Toybox.Graphics.Dc` primitives
  (arcs, lines, filled polygons, text, bitmaps). No general-purpose GPU; keep draws
  cheap.
- **Burn-in / power:** AMOLED → dark backgrounds, avoid large static bright regions,
  animate sparingly, respect always-on/low-power draw path.

## Memory & runtime

- CIQ apps run under a **memory budget** (device-dependent; newer devices are more
  generous but still constrained vs a phone). Keep the sample buffer **bounded**
  (ring buffer) and the grid **coarse** (see `05`). Watch the simulator's memory
  profiler.
- Foreground app has real CPU time but you still want per-frame work small. Heavy
  filter updates can run at 1–5 Hz, decoupled from the render loop.

## Manifest permissions summary

```xml
<uses-permission id="BluetoothLowEnergy" />
<uses-permission id="Positioning" />
<uses-permission id="Sensor" />
<!-- If persisting data / settings: Storage is available without permission via Toybox.Application.Storage -->
```

## The load-bearing takeaways
1. **BLE scan RSSI + GPS + heading are all available** → the app is feasible.
2. **A single antenna gives no direction** → we *derive* direction from spatial
   diversity (motion) and optionally body-shadowing. This is the core insight of
   `05`.
3. **RSSI is noisy and identity can be unstable** → target a controllable beacon for
   best results; always surface confidence.
4. **WiFi is off the table on-watch** → BLE-only MVP; WiFi is a future companion.
