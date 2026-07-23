using Toybox.Position;
using Toybox.System;

// Wraps Toybox.Position: continuous GPS fixes forwarded to the controller as
// lat/lon degrees plus a rough accuracy in meters and a motion heading when the
// user is actually moving. See docs/04.
class GeoProvider {
    hidden var _controller;
    hidden var _enabled;

    function initialize(controller) {
        _controller = controller;
        _enabled = false;
    }

    function start() {
        if (_enabled) { return; }
        Position.enableLocationEvents(Position.LOCATION_CONTINUOUS, method(:onPosition));
        _enabled = true;
    }

    function stop() {
        if (!_enabled) { return; }
        Position.enableLocationEvents(Position.LOCATION_DISABLED, method(:onPosition));
        _enabled = false;
    }

    function onPosition(info) {
        if (info == null || info.position == null) { return; }
        var deg = info.position.toDegrees();   // [lat, lon]
        var acc = accuracyMeters(info.accuracy);

        var spd = (info.speed == null) ? 0.0 : info.speed;
        // Motion heading is only trustworthy while actually moving.
        var hdg = null;
        if (info.heading != null && spd > 0.5) { hdg = info.heading; }

        _controller.onGeoFix(deg[0], deg[1], acc, hdg, spd, System.getTimer());
    }

    hidden function accuracyMeters(q) {
        if (q == Position.QUALITY_GOOD)   { return 5.0; }
        if (q == Position.QUALITY_USABLE) { return 15.0; }
        if (q == Position.QUALITY_POOR)   { return 40.0; }
        return 100.0;   // NOT_AVAILABLE / LAST_KNOWN
    }
}
