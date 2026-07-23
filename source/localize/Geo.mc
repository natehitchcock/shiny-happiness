using Toybox.Math;

// Converts lat/lon degrees into a local East-North (ENU, meters) plane centered
// on the first good GPS fix of the session. All estimator math happens in this
// plane; we only touch lat/lon at the edges. See docs/04.
class Geo {
    hidden var _lat0;
    hidden var _lon0;
    hidden var _mPerLon;   // meters per degree longitude at ref latitude
    public var hasRef;

    const M_PER_DEG_LAT = 111320.0;

    function initialize() {
        hasRef = false;
        _lat0 = 0.0;
        _lon0 = 0.0;
        _mPerLon = M_PER_DEG_LAT;
    }

    function setRef(latDeg, lonDeg) {
        _lat0 = latDeg;
        _lon0 = lonDeg;
        _mPerLon = M_PER_DEG_LAT * Math.cos(latDeg * Math.PI / 180.0);
        hasRef = true;
    }

    // [east_m, north_m]
    function toLocal(latDeg, lonDeg) {
        var n = (latDeg - _lat0) * M_PER_DEG_LAT;
        var e = (lonDeg - _lon0) * _mPerLon;
        return [e, n];
    }

    // Inverse (used by the mock source to synthesize fixes). [lat, lon]
    function toGeo(e, n) {
        var lat = _lat0 + n / M_PER_DEG_LAT;
        var lon = _lon0 + e / _mPerLon;
        return [lat, lon];
    }

    // Bearing from (e,n) to (te,tn): 0 = North, clockwise, radians.
    static function bearing(e, n, te, tn) {
        return Math.atan2(te - e, tn - n);
    }

    static function distance(e, n, te, tn) {
        var de = te - e;
        var dn = tn - n;
        return Math.sqrt(de * de + dn * dn);
    }
}
