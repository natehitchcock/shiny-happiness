using Toybox.Math;

// Log-distance path-loss model translating between RSSI (dBm) and distance (m).
//   RSSI(d) = rssi1m - 10 * n * log10(d)
//   d(RSSI) = 10 ^ ((rssi1m - RSSI) / (10 * n))
// See docs/05. `n` is set from the environment preset and can be self-calibrated.
class PathLoss {
    public var rssi1m;   // reference RSSI at 1 m (dBm)
    public var n;        // path-loss exponent

    function initialize(rssi1mRef, nExp) {
        rssi1m = rssi1mRef;
        n = nExp;
    }

    function setEnvironment(envIdx) {
        if (envIdx == 0)      { n = Const.N_OUTDOOR; }
        else if (envIdx == 1) { n = Const.N_MIXED; }
        else                  { n = Const.N_INDOOR; }
    }

    function expectedRssi(d) {
        var dd = (d < 0.5) ? 0.5 : d;
        return rssi1m - 10.0 * n * MathUtil.log10(dd);
    }

    function distanceFor(rssi) {
        var exp = (rssi1m - rssi) / (10.0 * n);
        return Math.pow(10.0, exp);
    }

    // Self-calibrate n (and rssi1m) from (distance, rssi) pairs by least-squares
    // regression of rssi vs log10(d): slope = -10n, intercept = rssi1m.
    // ds/rs are equal-length arrays; updates slowly (blend) and clamps n.
    function calibrate(ds, rs) {
        var count = ds.size();
        if (count < 4) { return; }
        var sx = 0.0, sy = 0.0, sxx = 0.0, sxy = 0.0;
        for (var i = 0; i < count; i++) {
            var d = (ds[i] < 0.5) ? 0.5 : ds[i];
            var x = MathUtil.log10(d);
            var y = rs[i];
            sx += x; sy += y; sxx += x * x; sxy += x * y;
        }
        var denom = count * sxx - sx * sx;
        if (denom > -1e-6 && denom < 1e-6) { return; }
        var slope = (count * sxy - sx * sy) / denom;
        var intercept = (sy - slope * sx) / count;
        var nNew = -slope / 10.0;
        nNew = MathUtil.clamp(nNew, 1.8, 4.5);
        // blend gently to avoid feedback instability
        n = 0.7 * n + 0.3 * nNew;
        rssi1m = 0.8 * rssi1m + 0.2 * intercept;
    }
}
