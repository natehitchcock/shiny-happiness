using Toybox.Application.Properties;

// Thin wrapper over persisted app properties. Defaults mirror properties.xml.
class Settings {
    public var orientation;   // 0 = heading-up, 1 = north-up
    public var environment;   // 0 = outdoor, 1 = mixed, 2 = indoor
    public var units;         // 0 = meters, 1 = feet

    function initialize() {
        orientation = getNum("orientation", 0);
        environment = getNum("environment", 0);
        units = getNum("units", 0);
    }

    hidden function getNum(key, def) {
        var v = null;
        try { v = Properties.getValue(key); } catch (ex) { v = null; }
        if (v == null) { return def; }
        return v;
    }

    function set(key, val) {
        try { Properties.setValue(key, val); } catch (ex) {}
        if (key.equals("orientation"))      { orientation = val; }
        else if (key.equals("environment")) { environment = val; }
        else if (key.equals("units"))       { units = val; }
    }
}
