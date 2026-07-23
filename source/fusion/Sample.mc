// One time-aligned observation: the smoothed target RSSI paired with where (in
// the local ENU plane) and under what conditions it was taken. See docs/04.
class Sample {
    public var t;        // ms timestamp
    public var rssi;     // smoothed dBm (Float)
    public var e;        // east meters (Float)
    public var n;        // north meters (Float)
    public var posAcc;   // GPS accuracy estimate, meters (Float)
    public var heading;  // absolute heading, radians, or null
    public var hdgOk;    // heading reliability flag
    public var moving;   // motion state at capture

    function initialize(t_, rssi_, e_, n_, posAcc_, heading_, hdgOk_, moving_) {
        t = t_;
        rssi = rssi_;
        e = e_;
        n = n_;
        posAcc = posAcc_;
        heading = heading_;
        hdgOk = hdgOk_;
        moving = moving_;
    }
}
