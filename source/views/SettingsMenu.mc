using Toybox.WatchUi;

// Minimal settings (docs/06): orientation, environment preset (drives path-loss),
// and units. Built as a Menu2; selecting an item cycles its value.
module SettingsMenu {
    function build(c) {
        var s = c.getSettings();
        var menu = new WatchUi.Menu2({ :title => WatchUi.loadResource(Rez.Strings.Settings) });

        menu.addItem(new WatchUi.MenuItem(
            WatchUi.loadResource(Rez.Strings.Orientation),
            orientationLabel(s.orientation),
            :orientation, {}));

        menu.addItem(new WatchUi.MenuItem(
            WatchUi.loadResource(Rez.Strings.Environment),
            environmentLabel(s.environment),
            :environment, {}));

        menu.addItem(new WatchUi.MenuItem(
            WatchUi.loadResource(Rez.Strings.Units),
            unitsLabel(s.units),
            :units, {}));

        return menu;
    }

    function orientationLabel(o) {
        return WatchUi.loadResource(o == 0 ? Rez.Strings.HeadingUp : Rez.Strings.NorthUp);
    }

    function environmentLabel(e) {
        if (e == 0) { return WatchUi.loadResource(Rez.Strings.Outdoor); }
        if (e == 1) { return WatchUi.loadResource(Rez.Strings.Mixed); }
        return WatchUi.loadResource(Rez.Strings.Indoor);
    }

    function unitsLabel(u) {
        return WatchUi.loadResource(u == 0 ? Rez.Strings.Meters : Rez.Strings.Feet);
    }
}

class SettingsMenuDelegate extends WatchUi.Menu2InputDelegate {
    hidden var _c;

    function initialize(c) {
        Menu2InputDelegate.initialize();
        _c = c;
    }

    function onSelect(item) {
        var id = item.getId();
        var s = _c.getSettings();
        if (id == :orientation) {
            _c.toggleOrientation();
            item.setSubLabel(SettingsMenu.orientationLabel(s.orientation));
        } else if (id == :environment) {
            var e = (s.environment + 1) % 3;
            _c.applyEnvironment(e);
            item.setSubLabel(SettingsMenu.environmentLabel(e));
        } else if (id == :units) {
            var u = (s.units == 0) ? 1 : 0;
            s.set("units", u);
            item.setSubLabel(SettingsMenu.unitsLabel(u));
        }
        WatchUi.requestUpdate();
    }

    function onBack() {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
    }
}
