# 09 — Risks, Constraints & Open Questions

The honest register of what can bite this project, with mitigations and the decisions
left to make.

## A. Physics & signal risks

### 1. RSSI is inherently noisy (±6–10 dB)
Multipath, body position, hand orientation, and antenna nulls swing RSSI even when
nothing moves. A few dB of error is a large *distance* error (see `05`).
**Mitigation:** smoothing + median (`04`); the grid filter fuses many samples instead
of trusting any one; surface confidence; never show false precision.

### 2. A single omnidirectional antenna gives no bearing
The whole app is a workaround for this. Direction only emerges from **motion**
(spatial diversity) or **body shadowing**.
**Mitigation:** gradient method + grid filter both exploit motion; ShadowBearing for
standing still; coaching that tells the user to move when the field is uninformative.
**Residual risk:** a stationary user with an unreliable compass gets weak direction —
by design the app asks them to walk.

### 3. Multipath / indoor
Reflections create false peaks and nulls; RSSI can *increase* as you move the "wrong"
way.
**Mitigation:** grid handles multimodality (shows ambiguity); indoor path-loss
preset; confidence honestly drops. **Accept** degraded indoor accuracy (`08`).

### 4. Close-range breakdown
Within ~1–2 m RSSI saturates/oscillates; bearing is meaningless.
**Mitigation:** ARRIVED/proximity mode (`06`) replaces the arrow with "you're here."

### 5. Unknown transmit power / path-loss exponent
Absolute distance depends on `RSSI_1m` and `n`, which vary per device/environment.
**Mitigation:** presets + self-calibration (`05`); the gradient MVP needs neither
(uses only the gradient). Prefer beacons that advertise measured power.

## B. Platform / API risks

### 6. Device identity instability (BIG one for target tracking)
`ScanResult` exposes no raw MAC; many devices **rotate identifiers / randomize MAC**
(phones, AirTags, privacy-conscious trackers), so you can't reliably track them over
a multi-minute hunt.
**Mitigation:** build a best-effort stable key from service UUID / manufacturer data
/ name (`04`); **warn** when a target looks unstable; **recommend a beacon you
control** (fixed service UUID) for reliable results.
**Open question:** which specific devices does the user actually want to find? If
they're privacy-randomized, the app fundamentally can't lock on — decide whether to
constrain scope to cooperative beacons. *(This was one of the clarifying questions;
default assumes pick-from-scan, ideally a stable emitter.)*

### 7. Heading reliability while stationary
Absolute heading is essential for heading-up arrow and ShadowBearing; the
magnetometer compass while standing still may be noisy, need calibration, or not be
surfaced the same on every device.
**Mitigation:** `HeadingSource` abstraction with a reliability flag; fall back to
north-up + motion-gradient; coach a figure-8 compass calibration if needed.
**Verify on real Venu 4 hardware early (M0).**

### 8. BLE not simulatable
Can't validate real scanning in the simulator.
**Mitigation:** mock signal source + hardware bring-up at M0 (`08`).

### 9. Advertisement cadence & scan throttling
Some emitters advertise slowly; the OS may throttle scan callbacks.
**Mitigation:** tolerate irregular updates; timestamp everything; LOST state on
signal gaps; don't assume a fixed sample rate.

### 10. Memory / CPU budget
Grid + buffer + rendering must fit device limits.
**Mitigation:** coarse fixed grid, bounded ring buffer, incremental updates,
throttled tick, reuse buffers; profile early; shrink grid first if tight (`07`).

### 11. Battery drain
Continuous BLE scan + GPS + compute is power-hungry on a watch.
**Mitigation:** measure (`08`); offer coarser GPS when stationary, 1 Hz tick option,
scan duty-cycling; set user expectations.

### 12. Version specifics unverified here
Exact Venu 4 API level, screen resolution, and stationary-compass behavior were not
verifiable from these docs (Garmin dev pages block automated fetch).
**Action for implementer:** confirm on the
[Compatible Devices](https://developer.garmin.com/connect-iq/compatible-devices/)
page and on-device at M0; adjust `manifest.xml` and UI metrics.

## C. WiFi (explicitly deferred)

### 13. No on-watch WiFi scan API
Connect IQ does **not** expose WiFi scanning to third-party apps (`02`). An on-watch
WiFi radar is **not buildable**.
**Options (all future):**
- **Phone companion app** scans WiFi and pushes AP RSSI to the watch over Connect IQ
  messaging. Note: **iOS heavily restricts** third-party WiFi scanning; **Android**
  allows it with location permission + scan throttling. This roughly doubles project
  scope (a second app + a comms protocol + sync UX).
- Rely on the fact that **many WiFi devices also advertise BLE** — often the BLE
  radar already finds "that device."
**Open question:** is WiFi important enough to justify a companion app later, or is
BLE-only sufficient? *(Default: BLE-only; WiFi documented as a stretch.)*

## D. Legal / privacy / ethics
### 14. Scanning & locating radios
Passively reading BLE advertisements is generally permissible, but **locating
devices/people** can raise privacy and (jurisdiction-dependent) legal concerns,
especially for devices you don't own.
**Mitigation:** frame the app around **finding your own / cooperative devices**;
avoid features that log or track third parties over time; add a usage note. If the
user intends something broader, flag for their own legal review — out of scope for
these docs to bless.

## E. Open questions to resolve before/early in build
1. **Exact target(s)** the user wants to find, and whether those emit a **stable**
   identifier (drives feasibility of tracking — B6).
2. **Beacon for testing**: will the user provision a controllable beacon (iBeacon/
   Eddystone/ESP32)? Strongly recommended (`07`/`08`).
3. **Venu 4 stationary compass**: reliable enough for heading-up + ShadowBearing? (B7)
4. **WiFi**: BLE-only, or commit to a future phone companion? (C13)
5. **Battery ceiling**: acceptable session length / drain the user expects? (B11)
6. **Grid size vs device memory**: final cell size/extent after profiling (B10).

None of these block starting M0–M2 (the MVP). They shape M3+ and scope.
