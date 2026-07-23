using Toybox.Math;

// Standing-still bearing assist. When the user rotates in place, their body
// attenuates ~2.4 GHz, so RSSI peaks roughly toward the emitter and dips when the
// body is in the way. Fit rssi(theta) ~= M + A*cos(theta - phi); phi is the
// bearing. Requires a reliable absolute heading (compass). Treat as an assist that
// seeds/confirms the grid, not a sole source. See docs/05.
class ShadowBearing {
    hidden var _sumCos, _sumSin, _sumR, _sumRCos, _sumRSin, _cnt;
    hidden var _bearing, _amp, _valid;

    function initialize() {
        clear();
    }

    function clear() {
        _sumCos = 0.0; _sumSin = 0.0; _sumR = 0.0;
        _sumRCos = 0.0; _sumRSin = 0.0; _cnt = 0;
        _bearing = 0.0; _amp = 0.0; _valid = false;
    }

    // Feed (headingRad, rssi) pairs while the user rotates.
    function add(heading, rssi) {
        if (heading == null) { return; }
        var c = Math.cos(heading);
        var s = Math.sin(heading);
        _sumCos += c; _sumSin += s; _sumR += rssi;
        _sumRCos += rssi * c; _sumRSin += rssi * s;
        _cnt++;
    }

    // Least-squares fit of rssi = M + A*cos*  + B*sin, phi = atan2(B, A).
    // Call after a rotation sweep (>= ~20 samples spanning a good heading range).
    function solve() {
        if (_cnt < 12) { _valid = false; return; }
        var meanC = _sumCos / _cnt;
        var meanS = _sumSin / _cnt;
        var meanR = _sumR / _cnt;
        // Covariances of rssi with cos/sin give the sinusoid coefficients.
        var covRC = _sumRCos / _cnt - meanR * meanC;
        var covRS = _sumRSin / _cnt - meanR * meanS;
        var amp = Math.sqrt(covRC * covRC + covRS * covRS);
        if (amp < 1e-3) { _valid = false; return; }
        _bearing = Math.atan2(covRS, covRC);
        _amp = amp;
        _valid = true;
    }

    // { :bearing, :conf } or null.
    function result() {
        if (!_valid) { return null; }
        // Larger modulation amplitude -> more trustworthy bearing.
        var conf = MathUtil.clamp(_amp / 8.0, 0.0, 0.7);
        return { :bearing => _bearing, :conf => conf };
    }
}
