# 06 — UI & Radar View Design

Round AMOLED, `Toybox.WatchUi` + `Toybox.Graphics`. Design in **relative
coordinates** (fractions of `dc.getWidth()/getHeight()`) so it works across the
device's resolution (confirm exact px in `02`).

## Design language
- **Dark background** (near-black) — AMOLED power + burn-in friendliness.
- One accent color for the target arrow; cool/neutral for rings & chrome.
- **Confidence changes appearance**, not just a number: low confidence → arrow is
  short, semi-transparent, wobbly / dashed; high confidence → long, solid, bright.
  The user should *feel* certainty.
- Big, glanceable primary readouts (direction + distance). Minimal text.

## Screen 1 — Scan / Device list (`ScanListView`)
- Title "Select target".
- Scrollable list, each row: **name or short id**, a **signal bar** (from RSSI),
  and a small "last seen" fade. Sort by RSSI (strongest first).
- Rows flagged **"unstable id"** get a subtle warning glyph (may not be trackable —
  `04`/`09`).
- Select (tap / start button) → sets target, transitions to Radar (ACQUIRING).
- Input: `WatchUi.Menu2` is the easy path for a selectable list; or a custom
  scrolling view with a `BehaviorDelegate` (up/down/select).

## Screen 2 — Radar (`RadarView`) — the core

Layout (concentric, you at center):

```
            N (mode indicator)
        ______________________
       /        · · ·          \
      /     ·   ring 50m   ·     \
     |    ·                  ·    |
     |   ·     ring 15m       ·   |
     |   ·        ___         ·   |
     |   ·       / ▲ \        ·   |   ▲ = direction arrow to target
     |   ·      |  ●  |       ·   |   ● = you (center)
     |   ·       \___/        ·   |
     |    ·    ring 5m       ·    |
      \     ·             ·      /
       \___·___·___·___·___·____/
        [  ~14 m   ·  ▮▮▮▯▯  ]        distance + confidence meter
        [  getting warmer ↑  ]        warmer/colder cue
```

Elements:
1. **Center dot** = you.
2. **Range rings** — concentric circles labeled with distances derived from the
   estimate scale (e.g. auto-scale so the target sits ~70% out). Draw with
   `dc.drawCircle` (dim).
3. **Direction arrow** — from center toward the estimated bearing. Rotate into
   screen space per the **orientation mode** (below). Length & opacity encode
   confidence. Draw as a filled triangle/polygon (`dc.fillPolygon`).
4. **Distance readout** — big, `"~14 m"`; show a **range** ("~10–20 m") when
   uncertain; hide entirely when confidence is very low (show "locating…").
5. **Confidence meter** — small segmented bar (0..1 from `05`).
6. **Signal bar** — raw smoothed RSSI, gives immediate feedback independent of the
   estimate.
7. **Warmer/colder cue** — up/down chevron + word, from the gradient sign (`05`).
   The most reassuring real-time feedback; keep it prominent.
8. **State chrome** — small text for ACQUIRING ("collecting… walk a bit"), LOST
   ("signal lost — rescan?"), ARRIVED ("you're here 🎯").

### Orientation modes (Settings toggle)
- **Heading-up (default):** "up" on screen = the direction the watch/wrist points.
  Arrow screen-angle = `estimateBearing - currentHeading`. Feels like a real radar;
  requires heading (falls back to course-over-ground while walking).
- **North-up:** "up" = North. Arrow screen-angle = `estimateBearing`. A small "N"
  marker. Use this when heading is unreliable while stationary.

Angle-to-screen helper (ENU bearing, 0=N clockwise, screen y-down):
```
screenAngle = bearing - (mode == HEADING_UP ? heading : 0)
tipX = cx + R * sin(screenAngle)
tipY = cy - R * cos(screenAngle)
```

### Arrival / proximity mode
When RSSI crosses the "very close" threshold and the grid is tight (ARRIVED, `03`),
replace the arrow with a **pulsing bullseye** and "You're here" — because sub-2 m
direction is meaningless (`05`).

## Screen 3 — Coach overlay (`CoachOverlay`)
Transient, non-blocking banner driven by `Estimate.hint`:
- "Walk a few meters to get a fix"
- "Rotate slowly for a bearing" (with a small spin animation) — triggers/pairs with
  ShadowBearing (`05`).
- "Poor GPS — move to open sky"
- Auto-dismiss when the condition clears.

## Screen 4 — Settings (`SettingsView`, minimal)
- Orientation: Heading-up / North-up.
- Environment preset: Outdoor / Mixed / Indoor (sets path-loss `n`, `05`).
- Units: m / ft.
- Reset target / back to scan.
- (Debug) show heatmap overlay toggle.

## Stretch — heatmap overlay
Render the `GridFilter` probability field as a dim color wash under the rings
(probability → alpha/hue). Downsample for draw cost. Great for demos; gate behind
the debug toggle so the default view stays clean.

## Rendering & performance rules
- All heavy math lives in the filter tick (`03`); `onUpdate(dc)` only draws from the
  latest `Estimate` + a downsampled view of the buffer/grid.
- Redraw on `WatchUi.requestUpdate()` from the tick (~2 Hz is plenty; the arrow EMA
  makes it look smooth). Avoid per-frame allocation — precompute polygon point
  arrays and reuse.
- Respect low-power / always-on: provide a cheap draw path (dim, static-ish) when the
  device dims, per AMOLED guidance (`02`).
- Test at the device's real resolution in the simulator; keep touch targets and text
  within the round safe area (corners are clipped).

## Input map (buttons/touch — Venu is touch + button)
- **Scan list:** swipe/scroll, tap to select.
- **Radar:** tap = toggle orientation mode; long-press / back = return to scan;
  a button = recenter/reset filter.
- **Back** everywhere returns one state up (`03` state machine).
