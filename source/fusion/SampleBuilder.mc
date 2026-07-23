using Toybox.Math;

// Turns the latest smoothed RSSI + GPS fix + heading into a Sample, enforcing a
// spatial/temporal gate so the buffer holds genuinely diverse samples rather than
// a pile of near-duplicates. See docs/04.
class SampleBuilder {
    hidden var _lastE;
    hidden var _lastN;
    hidden var _lastT;
    hidden var _has;

    function initialize() {
        _has = false;
        _lastE = 0.0;
        _lastN = 0.0;
        _lastT = 0;
    }

    // Returns a Sample or null if not ready / gated out.
    function build(rssiSmooth, rssiT, e, n, posAcc, heading, hdgOk, moving, now) {
        if (rssiSmooth == null) { return null; }
        if (now - rssiT > Const.RSSI_STALE_MS) { return null; }  // dead signal

        if (_has) {
            var de = e - _lastE;
            var dn = n - _lastN;
            var moved = Math.sqrt(de * de + dn * dn);
            if (moved < Const.SAMPLE_MIN_MOVE_M &&
                (now - _lastT) < Const.SAMPLE_MIN_DT_MS) {
                return null;
            }
        }

        _lastE = e;
        _lastN = n;
        _lastT = now;
        _has = true;
        return new Sample(now, rssiSmooth, e, n, posAcc, heading, hdgOk, moving);
    }

    function reset() {
        _has = false;
    }
}
