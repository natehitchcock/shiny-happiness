using Toybox.Math;
using Toybox.System;

// Drives the engine from a synthetic emitter + user track so the whole pipeline
// (sampling, grid, gradient, UI, state machine) can be exercised in the simulator,
// where real BLE is unavailable. Enable via Const.MOCK_ENABLED. See docs/08.
//
// It converts synthetic ENU positions back to lat/lon (about a fixed reference)
// and feeds them through the same onGeoFix / onSignalObservation entry points the
// real providers use, so nothing downstream knows it's a mock.
class MockSignalSource {
    hidden var _c;
    hidden var _geo;
    hidden var _emitterE;
    hidden var _emitterN;
    hidden var _track;
    hidden var _startT;
    hidden var _started;
    hidden var _n;        // synthetic path-loss exponent
    hidden var _rssi1m;
    hidden var _lastE;
    hidden var _lastN;

    const REF_LAT = 45.0;
    const REF_LON = -122.0;

    function initialize(controller) {
        _c = controller;
        _geo = new Geo();
        _geo.setRef(REF_LAT, REF_LON);
        _emitterE = 25.0;
        _emitterN = 10.0;
        _track = SyntheticTracks.walkPast();   // swap to homeIn() to test ARRIVED
        _started = false;
        _n = 2.4;
        _rssi1m = -59.0;
        _lastE = 0.0;
        _lastN = 0.0;
    }

    // Keep a fake device present in the scan list.
    function enable(registry) {
        registry.observe("u:MOCK-BEACON", "MOCK Beacon", -70, System.getTimer(), false);
    }

    function selectTarget() {
        _started = false;   // restart the track on (re)selection
    }

    function step(now) {
        if (!_started) {
            _startT = now;
            _started = true;
            _lastE = _track[0][1];
            _lastN = _track[0][2];
        }
        var pos = samplePos(now - _startT);
        var e = pos[0];
        var n = pos[1];

        var de = e - _lastE;
        var dn = n - _lastN;
        var spd = Math.sqrt(de * de + dn * dn) / (Const.TICK_MS / 1000.0);
        var hdg = (spd > 0.3) ? Math.atan2(de, dn) : null;
        _lastE = e;
        _lastN = n;

        var d = Geo.distance(e, n, _emitterE, _emitterN);
        var dd = (d < 0.5) ? 0.5 : d;
        var rssi = _rssi1m - 10.0 * _n * Math.log(dd, 10) + noise();

        var ll = _geo.toGeo(e, n);
        _c.onGeoFix(ll[0], ll[1], 5.0, hdg, spd, now);
        _c.onSignalObservation(rssi.toNumber(), now);
        _c.onMotion(spd > 0.3);
    }

    hidden function samplePos(elapsed) {
        var last = _track.size() - 1;
        if (elapsed <= _track[0][0])    { return [_track[0][1], _track[0][2]]; }
        if (elapsed >= _track[last][0]) { return [_track[last][1], _track[last][2]]; }
        for (var i = 0; i < last; i++) {
            var t0 = _track[i][0];
            var t1 = _track[i + 1][0];
            if (elapsed >= t0 && elapsed <= t1) {
                var f = (elapsed - t0) * 1.0 / (t1 - t0);
                var e = _track[i][1] + f * (_track[i + 1][1] - _track[i][1]);
                var n = _track[i][2] + f * (_track[i + 1][2] - _track[i][2]);
                return [e, n];
            }
        }
        return [_track[last][1], _track[last][2]];
    }

    // Cheap pseudo-gaussian dB noise (mean 0, ~ +/-6) via sum of uniforms.
    hidden function noise() {
        var s = 0.0;
        for (var i = 0; i < 4; i++) {
            s += (Math.rand() % 1000) / 1000.0;
        }
        return (s - 2.0) * 3.0;
    }
}
