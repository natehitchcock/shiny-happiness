# 04 — Signal Sampling & Sensor Fusion

How raw radio + sensor events become clean, spatially-tagged **Samples** that the
localization engine (`05`) can consume.

## What we sample, and why

The target advertises; each sighting gives an **RSSI** (dBm). RSSI alone is
directionless. Its value is that it changes with **distance** (weaker as you move
away). By pairing many RSSI readings with the **GPS position** where each was taken,
we get a scatter of "at this spot, signal was this strong" — the raw material for
inferring where the emitter is.

## Acquiring BLE readings

`BleScanner` extends `Ble.BleDelegate`:

```monkeyc
using Toybox.BluetoothLowEnergy as Ble;

class BleScanner extends Ble.BleDelegate {
    hidden var _targetKey;      // stable key of selected device, or null while listing
    hidden var _onObservation;  // callback(rssi, tMs)
    hidden var _registry;       // DeviceRegistry for the list view

    function initialize(registry, onObservation) {
        BleDelegate.initialize();
        _registry = registry;
        _onObservation = onObservation;
    }

    function start() {
        Ble.setDelegate(self);
        Ble.setScanState(Ble.SCAN_STATE_SCANNING);
    }
    function stop() { Ble.setScanState(Ble.SCAN_STATE_OFF); }

    function setTarget(key) { _targetKey = key; }

    function onScanResults(scanResults) {
        var now = Toybox.System.getTimer(); // ms
        for (var r = scanResults.next(); r != null; r = scanResults.next()) {
            var key = DeviceRegistry.stableKey(r);   // see below
            var rssi = r.getRssi();
            _registry.observe(key, r, rssi, now);      // feeds the list
            if (_targetKey != null && key.equals(_targetKey)) {
                _onObservation.invoke(rssi, now);      // feeds the sampler
            }
        }
    }

    function onScanStateChange(scanState, status) { /* log / surface errors */ }
}
```

### Stable device key (dedup / tracking)
`ScanResult` gives no raw MAC. Build a **best-effort stable key** from the most
persistent advertised fields, in priority order:
1. First **service UUID** (`getServiceUuids()`), if present.
2. **Manufacturer id + a stable prefix** of `getManufacturerSpecificData(id)`.
3. **Device name** (`getDeviceName()`), if present.
4. Fallback: appearance + a coarse RSSI bucket (weak; flag as "may not be
   trackable").

`DeviceRegistry.stableKey(scanResult)` returns a short string. Devices that rotate
all of the above are inherently untrackable — surface that at selection (see `09`).

### RSSI smoothing (per target)
Raw RSSI is jumpy. Maintain a smoothed value the rest of the app uses:
- **EMA:** `rssiSmooth = alpha*raw + (1-alpha)*rssiSmooth`, `alpha ≈ 0.3`.
- Optionally a **median-of-last-5** before the EMA to kill single-sample spikes.
- Track advertisement **rate**; if it drops to ~0 for N s → LOST state.

## Acquiring position & heading

`GeoProvider` wraps `Toybox.Position`:

```monkeyc
using Toybox.Position;

Position.enableLocationEvents(Position.LOCATION_CONTINUOUS, method(:onPos));

function onPos(info) {
    // info.position (Location), info.accuracy, info.heading (rad, motion-derived),
    // info.speed, info.altitude
    var deg = info.position.toDegrees();   // [lat, lon]
    // store latest fix + accuracy + motion-heading
}
```

`HeadingSource` produces an **absolute heading + reliability flag**:
- If moving (speed above ~0.5 m/s): use motion heading (`info.heading` /
  `Activity.Info.currentHeading`), reliability = high.
- If stationary: read magnetometer compass via `Activity.Info.currentHeading` if the
  device provides it; reliability = medium/low (mark `hdgOk=false` if the device
  can't supply a stationary compass heading — verify per device, see `02`).

## Motion state

`MotionProvider` wraps `Toybox.Sensor` accel:
- **Stationary vs walking:** variance of accel magnitude over a ~1 s window above a
  threshold ⇒ walking. Gates the gradient method (needs motion) and confirms GPS
  displacement is real.
- **Rotate-in-place gesture:** sustained low translational motion + changing heading
  ⇒ user is spinning for a body-shadow bearing (`05`). Detect and switch coaching.

Do **not** integrate accel for position. GPS is position truth (see `02`).

## Local coordinate frame (`Geo`)

Pick a **session reference** = the first good GPS fix `(lat0, lon0)`. Convert every
fix to local meters with an equirectangular approximation (fine over the hundreds of
meters this app operates in):

```
metersPerDegLat = 111320
metersPerDegLon = 111320 * cos(lat0_rad)
n = (lat  - lat0) * metersPerDegLat      // north meters
e = (lon  - lon0) * metersPerDegLon      // east meters
```

Bearing from your position `(e,n)` to a point `(ep,np)`:
```
bearingRad = atan2(ep - e, np - n)   // 0 = North, clockwise
distance   = hypot(ep - e, np - n)
```
All estimators output in this ENU frame; convert to lat/lon only if persisting.

## Building a Sample (`SampleBuilder`)

On each ~2 Hz tick, if there's a fresh RSSI and a fresh GPS fix, emit one Sample:

```
Sample = {
  t, rssi(smoothed), rawRssi,
  e, n            // from latest fix via Geo
  posAcc          // GPS accuracy
  heading, hdgOk  // from HeadingSource
  moving          // from MotionProvider
}
```

### Sampling strategy (quality over quantity)
- **Space samples, don't spam them.** Two Samples within < ~1 m of each other and
  < ~1 s apart add noise, not information. Enforce a **minimum spatial/temporal
  gap** before committing a new Sample to the buffer (e.g. moved ≥ 1–2 m *or* 2 s
  elapsed). This gives the filter genuine spatial diversity and bounds buffer growth.
- **Weight by GPS accuracy.** Samples taken with poor `posAcc` get down-weighted in
  the filter (`05`).
- **Prefer recency for a moving emitter**, but for a *stationary* target keep a wide
  spatial spread — decay old samples slowly.

### `SampleBuffer` (bounded ring buffer)
- Fixed capacity (e.g. 128–256 Samples) to respect memory.
- When full, evict the sample that contributes least spatial diversity (or simply
  oldest) rather than always oldest, so you keep a good geometric spread.
- Provides iteration for the filter and the debug/heatmap overlay.

## Time alignment
BLE, GPS, and sensor events arrive asynchronously at different rates. The 2 Hz tick
is the synchronization point: each Sample pairs the **most recent** smoothed RSSI
with the **most recent** GPS fix and heading. Reject a tick if either the RSSI or the
fix is stale beyond a threshold (e.g. RSSI older than 3 s ⇒ skip; don't pair a fresh
position with a dead signal).

## Output of this layer
A continuously growing (bounded), spatially-diverse, quality-weighted stream of
`Sample`s in a local meters frame — exactly what `05` needs to triangulate.
