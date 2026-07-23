using Toybox.Math;

// Bayesian occupancy grid over where the emitter might be (the robust
// "triangulation" core). Each Sample updates a per-cell log-likelihood using a
// Gaussian measurement model around the path-loss prediction. The probability-
// weighted centroid is the estimate; the spread gives confidence and reveals
// ambiguity. Grid is centered on the session reference (first fix). See docs/05.
//
// Cost is O(cells) per sample and per estimate; keep GRID_CELLS modest and call
// estimate() at <= 1 Hz. Tune in Const / docs/08.
class GridFilter {
    hidden var _n;        // cells per side
    hidden var _cell;     // meters per cell
    hidden var _half;     // half-extent meters
    hidden var _log;      // Float[_n*_n] log-likelihood
    hidden var _pathloss;
    hidden var _sigma;
    hidden var _count;    // samples applied
    hidden var _sinceNorm;

    function initialize(nCells, cellM, pathloss) {
        _n = nCells;
        _cell = cellM;
        _half = nCells * cellM / 2.0;
        _log = new [nCells * nCells];
        _pathloss = pathloss;
        _sigma = Const.GRID_SIGMA_DB;
        reset();
    }

    function reset() {
        for (var i = 0; i < _log.size(); i++) { _log[i] = 0.0; }
        _count = 0;
        _sinceNorm = 0;
    }

    hidden function cellE(i) { return (i + 0.5) * _cell - _half; }
    hidden function cellN(j) { return (j + 0.5) * _cell - _half; }

    function applySample(s) {
        // Down-weight the whole update when GPS is poor.
        var w = 1.0;
        if (s.posAcc != null && s.posAcc > 10.0) { w = 10.0 / s.posAcc; }
        var inv2s2 = 1.0 / (2.0 * _sigma * _sigma);

        var idx = 0;
        for (var j = 0; j < _n; j++) {
            var cn = cellN(j);
            for (var i = 0; i < _n; i++) {
                var ce = cellE(i);
                var de = ce - s.e;
                var dn = cn - s.n;
                var d = Math.sqrt(de * de + dn * dn);
                var resid = s.rssi - _pathloss.expectedRssi(d);
                _log[idx] += -w * resid * resid * inv2s2;
                idx++;
            }
        }
        _count++;
        _sinceNorm++;
        if (_sinceNorm >= 16) { renormalize(); _sinceNorm = 0; }
    }

    // Subtract the current max so accumulated log-likelihoods stay bounded.
    hidden function renormalize() {
        var mx = _log[0];
        for (var k = 1; k < _log.size(); k++) {
            if (_log[k] > mx) { mx = _log[k]; }
        }
        for (var k = 0; k < _log.size(); k++) { _log[k] -= mx; }
    }

    // Returns { :e, :n, :spread, :conf, :count } or null.
    function estimate() {
        if (_count < 3) { return null; }

        var mx = _log[0];
        for (var k = 1; k < _log.size(); k++) {
            if (_log[k] > mx) { mx = _log[k]; }
        }

        var sw = 0.0, se = 0.0, sn = 0.0, see = 0.0, snn = 0.0;
        var idx = 0;
        for (var j = 0; j < _n; j++) {
            var cn = cellN(j);
            for (var i = 0; i < _n; i++) {
                var ce = cellE(i);
                var w = Math.exp(_log[idx] - mx);
                sw += w;
                se += w * ce;
                sn += w * cn;
                see += w * ce * ce;
                snn += w * cn * cn;
                idx++;
            }
        }
        if (sw <= 0.0) { return null; }

        var me = se / sw;
        var mn = sn / sw;
        var varE = see / sw - me * me;
        var varN = snn / sw - mn * mn;
        if (varE < 0.0) { varE = 0.0; }
        if (varN < 0.0) { varN = 0.0; }
        var spread = Math.sqrt(varE + varN);

        // Tight spread -> high confidence.
        var conf = MathUtil.clamp(1.0 - spread / 25.0, 0.0, 1.0);

        return { :e => me, :n => mn, :spread => spread,
                 :conf => conf, :count => _count };
    }

    function count() { return _count; }
}
