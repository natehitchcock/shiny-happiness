# 05 — Localization Algorithms

This is the core intellectual content: turning a stream of noisy, directionless RSSI
readings taken from known positions into a **direction and distance** to the emitter,
with an honest **confidence**.

## The fundamental problem

- A wrist antenna is **omnidirectional**: one reading = one scalar (how strong),
  never a bearing.
- Therefore **direction must come from spatial diversity**: compare readings taken at
  *different known positions*. The only way to get "different positions" is for the
  **user to move** (GPS gives the positions) — or to exploit **body shadowing** by
  rotating in place (your body becomes a crude directional mask).

Two independent methods, fused:

| Method | Needs | Gives | Robustness |
|---|---|---|---|
| **Gradient (hot/cold)** | user walking | direction of increasing signal | high, simple — **MVP** |
| **Grid Bayesian filter** | several spatially-diverse samples | full position estimate + confidence + heatmap | high — **V1 core** |
| **Body-shadow bearing** | user rotating in place + compass | a bearing while standing still | medium — assist |
| **Multilateration (LSQ)** | ≥3 non-collinear samples | closed-ish-form position | medium — optional, brittle to noise |

## 1. Path-loss model — RSSI ↔ distance (`PathLoss`)

Log-distance path loss:

```
RSSI(d) = RSSI_1m - 10 * n * log10(d)
=>  d(RSSI) = 10 ^ ((RSSI_1m - RSSI) / (10 * n))
```

- `RSSI_1m` (a.k.a. `A` or `txPower`): reference RSSI at 1 m. iBeacon-style beacons
  advertise their measured power; otherwise estimate/calibrate (~ -59 dBm typical).
- `n`: path-loss exponent. Free space ≈ 2; typical outdoor 2–3; cluttered/indoor
  3–4+. Provide presets (outdoor≈2.2, mixed≈2.7, indoor≈3.2) **and** self-calibrate
  (below).
- **Never trust a single distance.** Use path-loss to get a soft *range with
  uncertainty*, not a hard radius. A ±8 dB RSSI error at n=2.5 is roughly a **±2×
  distance** error — huge. This is exactly why we fuse many samples rather than
  trilaterate three.

### Self-calibration of `n` (and optionally `RSSI_1m`)
As the user walks *toward or away* from a converging estimate, you have pairs of
(distance-to-current-estimate, measured RSSI). Fit `n` (and `RSSI_1m`) by linear
regression of `RSSI` vs `log10(d)`:
```
slope = -10n,  intercept = RSSI_1m
```
Update slowly (only when the estimate is reasonably confident, to avoid feedback
instability). Clamp `n` to [1.8, 4.5].

## 2. Gradient "hot/cold" direction (`GradientEstimator`) — the MVP

No absolute position of the emitter needed; just answer *"which way should I walk to
get closer?"*

Approach — **RSSI gradient along the recent track**:
1. Over a sliding window of recent Samples, you have positions `(e_i, n_i)` and
   smoothed `rssi_i`.
2. Fit a local plane `rssi ≈ a*e + b*n + c` by least squares over the window. The
   gradient `∇rssi = (a, b)` points in the direction of **increasing** signal (toward
   the emitter, on average).
3. **Guidance bearing** = `atan2(a, b)` (same ENU convention as `04`).
4. **Warmer/colder**: sign of the dot product of your current velocity with
   `∇rssi` — moving up-gradient = "warmer".

Notes:
- Requires the user to have moved across a couple of meters with some direction
  change; before that, output "collecting… walk a bit."
- Robust to unknown `RSSI_1m`/`n` (it only uses the *gradient*, not absolute
  distance). This is why it's the guaranteed-shippable MVP.
- Fails if the field is flat (far away, or standing in a multipath null) → low
  confidence, coach to move more.

## 3. Bayesian occupancy-grid filter (`GridFilter`) — the V1 core

The most robust way to "triangulate" noisy RSSI. Maintain a **2D probability grid**
over where the emitter might be, and update it with every Sample.

### Setup
- A grid of cells covering the plausible area (e.g. a **±64 m** square around the
  session reference or the user, cell size **2 m** → 64×64 = 4096 cells). Tune
  cell size vs memory/CPU (start coarse — even 48×48 works).
- Store **log-likelihood** per cell (add, don't multiply — avoids underflow). Init
  uniform (all zeros).

### Update per Sample `s` (position `p_s`, smoothed `rssi_s`)
For each cell `c` at position `p_c`:
```
d      = distance(p_s, p_c)                       // meters
expect = RSSI_1m - 10*n*log10(max(d, 0.5))        // predicted RSSI if emitter in c
resid  = rssi_s - expect
logL[c] += -(resid*resid) / (2 * sigma^2)         // Gaussian measurement model
```
- `sigma` = RSSI noise std (start ~6 dB; widen for poor `posAcc`). Down-weight the
  whole update when GPS accuracy is bad (multiply the added term by a `<1` factor).
- Periodically **renormalize** (subtract max) and optionally apply a mild **spatial
  blur / decay** so the grid can adapt if the emitter moves and doesn't get
  overconfident.

### Reading the estimate
- **Peak cell** (max logL) → convert logL→prob (softmax over cells) → the MAP
  location.
- **Estimate position** = probability-weighted centroid (smoother than raw argmax).
- **Bearing/distance** from user's current position to that point (`04` formulas).
- **Confidence** from the **spread** of the distribution: compute the weighted
  covariance of cell positions; small spread (e.g. std < a few m) = high confidence.
  Also flag **multimodality** (two strong separated peaks) as low confidence /
  "keep moving to disambiguate."

### Why a grid (vs solving equations)
- Handles the **non-convex, multi-solution** nature of RSSI multilateration
  gracefully (ambiguities show as multiple peaks, not a wrong point-solution).
- Naturally yields **confidence** and a **heatmap** (stretch UI).
- Simple, bounded, no matrix inversion / no divergence like Gauss-Newton on bad data.
- Fixed cost per tick = grid size × new samples; keep grid coarse and update with
  only *new* samples (accumulate), not the whole buffer each tick.

### Cost control
- Update the grid **incrementally**: apply only Samples added since last tick.
- Keep the grid coarse; refine cell size only near the peak if you want (optional
  two-level grid).
- Cap update frequency (e.g. filter at 1–2 Hz, independent of render).

## 4. Body-shadow bearing (`ShadowBearing`) — standing-still assist

Exploits that **your body attenuates ~2.4 GHz**: when your torso is between the watch
and the emitter, RSSI dips; when the watch faces the emitter, RSSI peaks.

Procedure (triggered by the rotate-in-place gesture from `04`):
1. User rotates slowly through 360° (coach them). Record `(heading_k, rssi_k)`.
2. Fit RSSI as a function of heading — e.g. a single sinusoid
   `rssi(θ) ≈ M + Acos(θ - φ)`; the phase **φ is the bearing to the emitter**
   (peak direction). Least-squares fit of `[cosθ, sinθ, 1]`.
3. Confidence from the fit amplitude `A` vs residual (strong, clean sinusoid = good
   bearing). Weak modulation = inconclusive.

Caveats: needs a **reliable absolute heading** (compass; see `02`/`09`). Multipath
can create spurious peaks. Treat as an *assist* that seeds/confirms the grid, not a
sole source.

## 5. Multilateration (optional, `— not the primary path`)
Given ≥3 non-collinear Samples converted to distances via `PathLoss`, solve for
emitter `(e,n)` minimizing `Σ (||p_i - x|| - d_i)^2` (nonlinear least squares,
Gauss–Newton / Levenberg–Marquardt). Documented for completeness, but **the grid
filter is preferred** because LSQ diverges badly on RSSI-derived distances. If
implemented, use the grid MAP as the initial guess.

## Fusing methods into one `Estimate`

`SessionController` combines outputs each tick into:
```
Estimate {
  bearingRad     // best direction to walk / point arrow
  distanceM      // best distance estimate (or a range)
  confidence     // 0..1
  mode           // GRADIENT | GRID | SHADOW | FUSED
  hint           // e.g. "walk a few meters", "rotate slowly", "getting warmer"
}
```

Fusion policy (simple, effective):
- **ACQUIRING / low grid confidence:** use **GradientEstimator** bearing (needs only
  motion). Distance = coarse path-loss. Hint = "walk to locate."
- **TRACKING / grid confident:** use **GridFilter** centroid for bearing + distance;
  confidence from grid spread.
- **Standing still with a fresh ShadowBearing:** blend its bearing in (weighted by
  its fit confidence), especially useful when the grid is uncertain.
- Always **cross-check**: if gradient and grid bearings disagree by a lot, drop
  confidence and coach the user to gather more samples rather than committing.

## Smoothing the output
- Low-pass the reported **bearing** (angular EMA on `sin/cos`) so the arrow doesn't
  jitter; but let it snap when confidence jumps.
- Hysteresis on state transitions (ACQUIRING↔TRACKING) to avoid flicker.
- Clamp distance display to sane bounds; show ranges ("~10–20 m") when uncertainty is
  high rather than false precision.

## Honest accuracy expectations (set these in the UI)
- **Open outdoor, cooperative beacon, user walks 20–40 m:** converge to within a few
  meters; reliable "which way" guidance.
- **Cluttered / indoor / multipath:** bias and multi-path nulls; expect the arrow to
  wander — the app should *show low confidence*, not fake certainty.
- **Very close (< ~2 m):** RSSI saturates/oscillates; direction becomes unreliable —
  switch to "you're basically on top of it" proximity mode (strong-signal ARRIVED
  state) rather than a spinning arrow.
