using Toybox.WatchUi;
using Toybox.Graphics;
using Toybox.Math;

// The core 2D radar (docs/06). You at center; arrow toward the estimate; distance,
// confidence, and warmer/colder feedback. Confidence changes the arrow's look, not
// just a number. Pure rendering from the controller's latest Estimate.
class RadarView extends WatchUi.View {
    hidden var _c;

    function initialize(controller) {
        View.initialize();
        _c = controller;
    }

    function onUpdate(dc) {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;
        var cy = h / 2;

        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        var R = ((w < h) ? w : h) / 2 - 8;
        var est = _c.getEstimate();
        var state = _c.getState();

        // range rings
        dc.setColor(0x0A3A3A, Graphics.COLOR_TRANSPARENT);
        dc.drawCircle(cx, cy, R);
        dc.drawCircle(cx, cy, (R * 0.66).toNumber());
        dc.drawCircle(cx, cy, (R * 0.33).toNumber());

        // orientation reference
        var headingRef = 0.0;
        if (_c.getSettings().orientation == 0) {   // heading-up
            var hd = _c.getHeadingForDisplay();
            if (hd != null) { headingRef = hd; }
        }
        drawNorthMarker(dc, cx, cy, R, headingRef);

        if (state == Const.STATE_ARRIVED) {
            drawBullseye(dc, cx, cy, R);
        } else if (est != null && est.hasBearing) {
            drawArrow(dc, cx, cy, R, est.bearingRad - headingRef, est.confidence);
        }

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(cx, cy, 4);

        drawReadouts(dc, w, h, cx, cy, est, state);
    }

    hidden function drawNorthMarker(dc, cx, cy, R, headingRef) {
        var ang = -headingRef;   // where North sits on screen
        var x = cx + (R - 4) * Math.sin(ang);
        var y = cy - (R - 4) * Math.cos(ang);
        dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x, y - 8, Graphics.FONT_XTINY, "N", Graphics.TEXT_JUSTIFY_CENTER);
    }

    hidden function drawArrow(dc, cx, cy, R, ang, conf) {
        var len = R * (0.35 + 0.6 * conf);
        var tipx = cx + len * Math.sin(ang);
        var tipy = cy - len * Math.cos(ang);
        var bw = 10 + 8 * conf;
        var perp = ang + Math.PI / 2.0;
        var b1x = cx + bw * Math.sin(perp);
        var b1y = cy - bw * Math.cos(perp);
        var b2x = cx - bw * Math.sin(perp);
        var b2y = cy + bw * Math.cos(perp);
        dc.setColor(arrowColor(conf), Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([[tipx, tipy], [b1x, b1y], [b2x, b2y]]);
    }

    hidden function arrowColor(conf) {
        if (conf < 0.3) { return 0x557755; }   // dim = uncertain
        if (conf < 0.6) { return 0x33AA88; }
        return 0x46DCB4;                         // bright = confident
    }

    hidden function drawBullseye(dc, cx, cy, R) {
        dc.setColor(0x46DCB4, Graphics.COLOR_TRANSPARENT);
        dc.drawCircle(cx, cy, (R * 0.5).toNumber());
        dc.drawCircle(cx, cy, (R * 0.3).toNumber());
        dc.fillCircle(cx, cy, 8);
    }

    hidden function drawReadouts(dc, w, h, cx, cy, est, state) {
        // distance
        var distStr = "--";
        if (state == Const.STATE_ACQUIRING) {
            distStr = WatchUi.loadResource(Rez.Strings.Locating);
        } else if (est != null && est.hasDistance && est.confidence > 0.15) {
            distStr = formatDistance(est.distanceM);
        }
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h - 48, Graphics.FONT_MEDIUM, distStr, Graphics.TEXT_JUSTIFY_CENTER);

        // confidence bar
        drawConfBar(dc, cx - 34, h - 20, 68, 6, (est == null) ? 0.0 : est.confidence);

        // warmer / colder near top
        if (est != null && est.warmer != 0 && state != Const.STATE_ARRIVED) {
            var warm = (est.warmer > 0);
            var wc = WatchUi.loadResource(warm ? Rez.Strings.Warmer : Rez.Strings.Colder);
            dc.setColor(warm ? Graphics.COLOR_GREEN : Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, 26, Graphics.FONT_XTINY, (warm ? "^ " : "v ") + wc,
                        Graphics.TEXT_JUSTIFY_CENTER);
        }

        // state chrome
        var chrome = stateText(est, state);
        if (chrome != null) {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h - 72, Graphics.FONT_XTINY, chrome, Graphics.TEXT_JUSTIFY_CENTER);
        }
    }

    hidden function drawConfBar(dc, x, y, wid, hei, conf) {
        dc.setColor(0x222222, Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(x, y, wid, hei);
        dc.setColor(0x46DCB4, Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(x, y, (wid * MathUtil.clamp(conf, 0.0, 1.0)).toNumber(), hei);
    }

    hidden function stateText(est, state) {
        if (state == Const.STATE_LOST)    { return WatchUi.loadResource(Rez.Strings.SignalLost); }
        if (state == Const.STATE_ARRIVED) { return WatchUi.loadResource(Rez.Strings.Arrived); }
        if (est != null) {
            if (est.hint == Const.HINT_GPS)    { return WatchUi.loadResource(Rez.Strings.WaitingGps); }
            if (est.hint == Const.HINT_WALK)   { return WatchUi.loadResource(Rez.Strings.WalkHint); }
            if (est.hint == Const.HINT_ROTATE) { return WatchUi.loadResource(Rez.Strings.RotateHint); }
            if (est.hint == Const.HINT_LOST)   { return WatchUi.loadResource(Rez.Strings.SignalLost); }
        }
        if (state == Const.STATE_ACQUIRING) { return WatchUi.loadResource(Rez.Strings.Acquiring); }
        return null;
    }

    hidden function formatDistance(d) {
        if (_c.getSettings().units == 1) {
            return (d * 3.28084).toNumber().toString() + " ft";
        }
        if (d < 10.0) { return d.format("%.1f") + " m"; }
        return d.toNumber().toString() + " m";
    }
}

class RadarDelegate extends WatchUi.BehaviorDelegate {
    hidden var _c;

    function initialize(c) {
        BehaviorDelegate.initialize();
        _c = c;
    }

    function onTap(evt) {
        _c.toggleOrientation();
        WatchUi.requestUpdate();
        return true;
    }

    function onSelect() {
        _c.resetFilter();
        WatchUi.requestUpdate();
        return true;
    }

    function onBack() {
        _c.backToScan();
        var v = new ScanListView(_c);
        WatchUi.switchToView(v, new ScanListDelegate(_c, v), WatchUi.SLIDE_RIGHT);
        return true;
    }

    function onMenu() {
        WatchUi.pushView(SettingsMenu.build(_c), new SettingsMenuDelegate(_c), WatchUi.SLIDE_UP);
        return true;
    }
}
