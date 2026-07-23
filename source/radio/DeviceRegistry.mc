using Toybox.BluetoothLowEnergy as Ble;

// One discoverable device as shown in the scan list.
class DeviceEntry {
    public var key;        // stable-ish identity string
    public var name;       // advertised name or null
    public var rssi;       // smoothed dBm (Float)
    public var lastSeen;   // ms
    public var unstable;   // true if identity may rotate (untrackable)

    function initialize(key_, name_, rssi_, t_, unstable_) {
        key = key_;
        name = name_;
        rssi = rssi_ * 1.0;
        lastSeen = t_;
        unstable = unstable_;
    }
}

// Tracks devices seen while scanning; dedups on a best-effort stable key and
// produces a signal-sorted list for the UI. See docs/04.
class DeviceRegistry {
    hidden var _map;         // key -> DeviceEntry
    const PRUNE_MS = 12000;  // drop devices not seen for this long

    function initialize() {
        _map = {};
    }

    function observe(key, name, rssi, t, unstable) {
        var e = _map.get(key);
        if (e == null) {
            _map.put(key, new DeviceEntry(key, name, rssi, t, unstable));
        } else {
            e.rssi = Const.RSSI_ALPHA * rssi + (1.0 - Const.RSSI_ALPHA) * e.rssi;
            e.lastSeen = t;
            if (name != null) { e.name = name; }
        }
    }

    // Array of DeviceEntry, strongest first, stale entries pruned.
    function list() {
        var now = Toybox.System.getTimer();
        var vals = _map.values();
        var out = [];
        for (var i = 0; i < vals.size(); i++) {
            var e = vals[i];
            if (now - e.lastSeen <= PRUNE_MS) {
                out.add(e);
            }
        }
        // insertion sort by rssi desc (lists are short)
        for (var i = 1; i < out.size(); i++) {
            var cur = out[i];
            var j = i - 1;
            while (j >= 0 && out[j].rssi < cur.rssi) {
                out[j + 1] = out[j];
                j--;
            }
            out[j + 1] = cur;
        }
        return out;
    }

    function clear() { _map = {}; }

    // Best-effort stable identity for a ScanResult. Returns [key, unstable].
    // Priority: service UUID > device name > appearance (weak).
    // NOTE: ScanResult exposes no raw MAC, and privacy-randomized devices rotate
    // all of these — such targets are inherently untrackable (docs/09).
    static function keyInfo(r) {
        var uuids = r.getServiceUuids();
        if (uuids != null) {
            var u = uuids.next();
            if (u != null) {
                return ["u:" + u.toString(), false];
            }
        }
        var name = r.getDeviceName();
        if (name != null && name.length() > 0) {
            return ["n:" + name, false];
        }
        var appearance = 0;
        try { appearance = r.getAppearance(); } catch (ex) { appearance = 0; }
        return ["a:" + appearance.toString(), true];
    }
}
