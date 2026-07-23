using Toybox.WatchUi;
using Toybox.Graphics;

// Device discovery + selection screen (docs/06). Live list sorted by RSSI.
class ScanListView extends WatchUi.View {
    hidden var _c;
    hidden var _sel;

    function initialize(controller) {
        View.initialize();
        _c = controller;
        _sel = 0;
    }

    function onUpdate(dc) {
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();
        var w = dc.getWidth();
        var h = dc.getHeight();

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, 14, Graphics.FONT_TINY,
                    WatchUi.loadResource(Rez.Strings.SelectTarget),
                    Graphics.TEXT_JUSTIFY_CENTER);

        var list = _c.getRegistry().list();
        if (list.size() == 0) {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h / 2, Graphics.FONT_SMALL,
                        WatchUi.loadResource(Rez.Strings.Scanning),
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            return;
        }

        if (_sel >= list.size()) { _sel = list.size() - 1; }
        if (_sel < 0) { _sel = 0; }

        var rowH = 36;
        var visible = 4;
        var top = _sel - 1;
        if (top > list.size() - visible) { top = list.size() - visible; }
        if (top < 0) { top = 0; }

        var y = 46;
        for (var i = top; i < list.size() && i < top + visible; i++) {
            var e = list[i];
            var isSel = (i == _sel);
            if (isSel) {
                dc.setColor(0x0E3326, Graphics.COLOR_TRANSPARENT);
                dc.fillRoundedRectangle(12, y - 2, w - 24, rowH - 6, 6);
            }
            dc.setColor(isSel ? Graphics.COLOR_GREEN : Graphics.COLOR_LT_GRAY,
                        Graphics.COLOR_TRANSPARENT);
            var label = (e.name != null) ? e.name : shortKey(e.key);
            dc.drawText(24, y + 4, Graphics.FONT_XTINY, label, Graphics.TEXT_JUSTIFY_LEFT);
            drawRssiBar(dc, w - 78, y + 10, 44, 8, e.rssi);
            if (e.unstable) {
                dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
                dc.drawText(w - 24, y + 4, Graphics.FONT_XTINY, "!", Graphics.TEXT_JUSTIFY_RIGHT);
            }
            y += rowH;
        }
    }

    hidden function shortKey(k) {
        if (k.length() <= 14) { return k; }
        return k.substring(0, 14);
    }

    hidden function drawRssiBar(dc, x, y, wid, hei, rssi) {
        var frac = MathUtil.clamp((rssi + 100.0) / 60.0, 0.0, 1.0);  // -100..-40
        dc.setColor(0x223022, Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(x, y, wid, hei);
        var col = (frac > 0.6) ? Graphics.COLOR_GREEN
                : ((frac > 0.3) ? Graphics.COLOR_YELLOW : Graphics.COLOR_ORANGE);
        dc.setColor(col, Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(x, y, (wid * frac).toNumber(), hei);
    }

    // --- called by delegate ---
    function moveDown() {
        var n = _c.getRegistry().list().size();
        if (_sel < n - 1) { _sel++; }
        WatchUi.requestUpdate();
    }

    function moveUp() {
        if (_sel > 0) { _sel--; }
        WatchUi.requestUpdate();
    }

    function selectCurrent() {
        var list = _c.getRegistry().list();
        if (_sel < list.size()) {
            _c.selectTarget(list[_sel].key);
            WatchUi.switchToView(new RadarView(_c), new RadarDelegate(_c), WatchUi.SLIDE_LEFT);
        }
    }
}

class ScanListDelegate extends WatchUi.BehaviorDelegate {
    hidden var _view;

    function initialize(controller, view) {
        BehaviorDelegate.initialize();
        _view = view;
    }

    function onNextPage()     { _view.moveDown(); return true; }
    function onPreviousPage() { _view.moveUp();   return true; }
    function onSelect()       { _view.selectCurrent(); return true; }
    function onTap(evt)       { _view.selectCurrent(); return true; }

    function onKey(evt) {
        var k = evt.getKey();
        if (k == WatchUi.KEY_DOWN)  { _view.moveDown(); return true; }
        if (k == WatchUi.KEY_UP)    { _view.moveUp();   return true; }
        if (k == WatchUi.KEY_ENTER) { _view.selectCurrent(); return true; }
        return false;
    }
}
