// The fused output the RadarView renders each tick. See docs/05.
class Estimate {
    public var hasBearing;
    public var bearingRad;   // 0 = North, clockwise
    public var hasDistance;
    public var distanceM;
    public var confidence;   // 0..1
    public var mode;         // Const.MODE_*
    public var warmer;       // 1 warmer, -1 colder, 0 unknown
    public var hint;         // Const.HINT_*

    function initialize() {
        hasBearing = false;
        bearingRad = 0.0;
        hasDistance = false;
        distanceM = 0.0;
        confidence = 0.0;
        mode = Const.MODE_NONE;
        warmer = 0;
        hint = Const.HINT_NONE;
    }
}
