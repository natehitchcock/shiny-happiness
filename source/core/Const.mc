using Toybox.Math;

// Central place for enums and tuning constants. Everything the field-tester
// (docs/08) will want to sweep lives here.
module Const {

    // App / session states (see docs/03 state machine).
    enum {
        STATE_SCANNING,   // device list
        STATE_ACQUIRING,  // target chosen, gathering first samples
        STATE_TRACKING,   // live estimate available
        STATE_ARRIVED,    // very close / converged
        STATE_LOST        // no advertisements for a while
    }

    // Which estimator produced the current Estimate.
    enum {
        MODE_NONE,
        MODE_GRADIENT,
        MODE_GRID,
        MODE_SHADOW,
        MODE_FUSED
    }

    // Coaching hint codes; views map these to localized strings.
    enum {
        HINT_NONE,
        HINT_WALK,
        HINT_ROTATE,
        HINT_GPS,
        HINT_LOST
    }

    // --- Tuning knobs (docs/08 table) -------------------------------------
    const TICK_MS        = 500;    // engine + render tick (2 Hz)
    const BUFFER_CAP     = 128;    // sample ring-buffer capacity

    const GRID_CELLS     = 48;     // grid is GRID_CELLS x GRID_CELLS
    const GRID_CELL_M    = 3.0;    // meters per cell -> +/- 72 m coverage
    const GRID_SIGMA_DB  = 6.0;    // RSSI measurement noise std (dB)

    const RSSI_ALPHA     = 0.3;    // EMA smoothing for RSSI
    const BEARING_ALPHA  = 0.35;   // angular EMA for the arrow

    const RSSI_1M_DBM    = -59.0;  // reference RSSI at 1 m (calibrate/beacon)
    const ARRIVED_RSSI   = -52;    // "very close" threshold (dBm)

    const LOST_MS        = 6000;   // no ad for this long -> LOST
    const RSSI_STALE_MS  = 3000;   // don't pair a fix with a dead signal
    const SAMPLE_MIN_MOVE_M = 1.5; // spatial gate between samples
    const SAMPLE_MIN_DT_MS  = 2000;

    const CONF_TRACK     = 0.30;   // confidence to enter TRACKING
    const CONF_ARRIVED   = 0.50;   // confidence + strong RSSI to ARRIVE

    // Settings: environment preset -> path-loss exponent n.
    const N_OUTDOOR = 2.2;
    const N_MIXED   = 2.7;
    const N_INDOOR  = 3.2;

    // Flip to true (PC build) to drive the engine from MockSignalSource in the
    // simulator, where real BLE is unavailable. See docs/08 + source/test.
    const MOCK_ENABLED = false;
}
