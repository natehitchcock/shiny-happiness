using Toybox.System;
using Toybox.Timer;
using Toybox.WatchUi;
using Toybox.Math;

// The heartbeat and single source of truth. Owns the providers, the sample
// pipeline, the estimators, and the current Estimate + state. Views read from it;
// providers push into it. See docs/03.
class SessionController {
    // Collaborators
    public var geo;
    hidden var _pathloss;
    hidden var _buffer;
    hidden var _grid;
    hidden var _gradient;
    hidden var _shadow;
    hidden var _registry;
    hidden var _scanner;
    hidden var _geoProvider;
    hidden var _motionProvider;
    hidden var _headingSource;
    hidden var _settings;
    hidden var _mock;
    hidden var _sampleBuilder;
    hidden var _timer;

    // Live signal state
    hidden var _rssiSmooth;   // Float or null
    hidden var _rssiRaw;
    hidden var _rssiT;
    hidden var _lastSeenT;

    // Live geo state
    hidden var _curE;
    hidden var _curN;
    hidden var _posAcc;
    hidden var _haveFix;

    hidden var _moving;

    // Output
    hidden var _state;
    hidden var _estimate;
    hidden var _lastGridEst;
    hidden var _tickCount;

    // Bearing smoothing
    hidden var _sinAvg;
    hidden var _cosAvg;
    hidden var _haveSmoothed;

    function initialize() {
        _settings = new Settings();
        geo = new Geo();
        _pathloss = new PathLoss(Const.RSSI_1M_DBM, Const.N_OUTDOOR);
        _pathloss.setEnvironment(_settings.environment);
        _buffer = new SampleBuffer(Const.BUFFER_CAP);
        _grid = new GridFilter(Const.GRID_CELLS, Const.GRID_CELL_M, _pathloss);
        _gradient = new GradientEstimator();
        _shadow = new ShadowBearing();
        _registry = new DeviceRegistry();
        _scanner = new BleScanner(_registry, self);
        _geoProvider = new GeoProvider(self);
        _motionProvider = new MotionProvider(self);
        _headingSource = new HeadingSource();
        _sampleBuilder = new SampleBuilder();

        _mock = Const.MOCK_ENABLED ? new MockSignalSource(self) : null;

        _rssiSmooth = null;
        _rssiRaw = 0;
        _rssiT = 0;
        _lastSeenT = null;
        _curE = 0.0; _curN = 0.0; _posAcc = 100.0; _haveFix = false;
        _moving = false;
        _state = Const.STATE_SCANNING;
        _estimate = new Estimate();
        _lastGridEst = null;
        _tickCount = 0;
        _sinAvg = 0.0; _cosAvg = 1.0; _haveSmoothed = false;
    }

    // --- Lifecycle --------------------------------------------------------
    function start() {
        if (_mock != null) {
            _mock.enable(_registry);   // seeds a fake device into the list
        } else {
            _scanner.start();
        }
        _timer = new Timer.Timer();
        _timer.start(method(:tick), Const.TICK_MS, true);
    }

    function shutdown() {
        if (_timer != null) { _timer.stop(); }
        if (_mock == null) {
            _scanner.stop();
            _geoProvider.stop();
            _motionProvider.stop();
        }
    }

    // --- Target selection -------------------------------------------------
    function selectTarget(key) {
        _scanner.setTarget(key);
        if (_mock != null) {
            _mock.selectTarget();
        } else {
            _geoProvider.start();
            _motionProvider.start();
        }
        resetEngine();
        _state = Const.STATE_ACQUIRING;
    }

    function backToScan() {
        if (_mock == null) {
            _geoProvider.stop();
            _motionProvider.stop();
        }
        _scanner.setTarget(null);
        resetEngine();
        _state = Const.STATE_SCANNING;
    }

    function resetEngine() {
        _buffer.clear();
        _grid.reset();
        _sampleBuilder.reset();
        _shadow.clear();
        _rssiSmooth = null;
        _lastSeenT = null;
        _lastGridEst = null;
        _haveSmoothed = false;
        _estimate = new Estimate();
    }

    // --- Inbound events (from providers / mock) ---------------------------
    function onSignalObservation(rssi, t) {
        _rssiRaw = rssi;
        if (_rssiSmooth == null) {
            _rssiSmooth = rssi * 1.0;
        } else {
            _rssiSmooth = Const.RSSI_ALPHA * rssi + (1.0 - Const.RSSI_ALPHA) * _rssiSmooth;
        }
        _rssiT = t;
        _lastSeenT = t;
    }

    function onGeoFix(latDeg, lonDeg, accM, motionHeading, speed, t) {
        if (!geo.hasRef) { geo.setRef(latDeg, lonDeg); }
        var en = geo.toLocal(latDeg, lonDeg);
        _curE = en[0];
        _curN = en[1];
        _posAcc = accM;
        _haveFix = true;
        _headingSource.updateMotionHeading(motionHeading);
    }

    function onMotion(moving) {
        _moving = moving;
    }

    // --- Engine tick ------------------------------------------------------
    function tick() {
        _tickCount++;

        if (_state == Const.STATE_SCANNING) {
            if (_mock != null) { _mock.enable(_registry); }  // keep it in the list
            WatchUi.requestUpdate();
            return;
        }

        var now = System.getTimer();
        if (_mock != null) { _mock.step(now); }

        // Build a sample if we have fresh signal + position.
        if (_haveFix && _rssiSmooth != null) {
            var hs = _headingSource.current();
            var s = _sampleBuilder.build(_rssiSmooth, _rssiT, _curE, _curN,
                                         _posAcc, hs[0], hs[1], _moving, now);
            if (s != null) {
                _buffer.add(s);
                _grid.applySample(s);
            }
        }

        // Grid estimate is heavier; run it every other tick.
        var gridEst;
        if (_tickCount % 2 == 0) {
            gridEst = _grid.estimate();
            _lastGridEst = gridEst;
        } else {
            gridEst = _lastGridEst;
        }
        var gradEst = _haveFix ? _gradient.estimate(_buffer) : null;

        var est = new Estimate();
        populateEstimate(est, gridEst, gradEst, now);
        _estimate = est;
        advanceState(est, now);

        WatchUi.requestUpdate();
    }

    // Fusion policy (docs/05).
    hidden function populateEstimate(est, gridEst, gradEst, now) {
        var gridConf = (gridEst == null) ? 0.0 : gridEst[:conf];

        if (gridEst != null && gridConf > 0.35) {
            var be = Geo.bearing(_curE, _curN, gridEst[:e], gridEst[:n]);
            est.hasBearing = true;
            est.bearingRad = smoothBearing(be);
            est.hasDistance = true;
            est.distanceM = Geo.distance(_curE, _curN, gridEst[:e], gridEst[:n]);
            est.confidence = gridConf;
            est.mode = Const.MODE_GRID;
        } else if (gradEst != null) {
            est.hasBearing = true;
            est.bearingRad = smoothBearing(gradEst[:bearing]);
            est.confidence = gradEst[:conf];
            est.mode = Const.MODE_GRADIENT;
            if (_rssiSmooth != null) {
                est.hasDistance = true;
                est.distanceM = _pathloss.distanceFor(_rssiSmooth);
            }
        } else {
            est.mode = Const.MODE_NONE;
            est.confidence = 0.0;
            est.hint = _haveFix ? Const.HINT_WALK : Const.HINT_GPS;
        }

        // Warmer/colder always comes from the gradient when available.
        if (gradEst != null) { est.warmer = gradEst[:warmer]; }

        // Cross-check: if grid and gradient bearings disagree strongly, we are
        // not really converged -> drop confidence and coach movement.
        if (gridEst != null && gradEst != null) {
            var gb = Geo.bearing(_curE, _curN, gridEst[:e], gridEst[:n]);
            if (MathUtil.angDiff(gb, gradEst[:bearing]) > 1.2) {
                est.confidence *= 0.5;
                if (est.hint == Const.HINT_NONE) { est.hint = Const.HINT_WALK; }
            }
        }

        if (est.mode != Const.MODE_NONE && est.confidence < 0.2 &&
            est.hint == Const.HINT_NONE) {
            est.hint = Const.HINT_WALK;
        }
        if (_lastSeenT != null && (now - _lastSeenT) > Const.LOST_MS) {
            est.hint = Const.HINT_LOST;
        }
    }

    hidden function advanceState(est, now) {
        var strong = (_rssiSmooth != null && _rssiSmooth > Const.ARRIVED_RSSI);
        var lost = (_lastSeenT != null && (now - _lastSeenT) > Const.LOST_MS);
        if (lost) { _state = Const.STATE_LOST; return; }
        if (strong && est.confidence > Const.CONF_ARRIVED) { _state = Const.STATE_ARRIVED; return; }
        if (est.hasBearing && est.confidence > Const.CONF_TRACK) { _state = Const.STATE_TRACKING; return; }
        _state = Const.STATE_ACQUIRING;
    }

    hidden function smoothBearing(b) {
        var s = Math.sin(b);
        var c = Math.cos(b);
        if (!_haveSmoothed) {
            _sinAvg = s; _cosAvg = c; _haveSmoothed = true;
        } else {
            var a = Const.BEARING_ALPHA;
            _sinAvg = a * s + (1.0 - a) * _sinAvg;
            _cosAvg = a * c + (1.0 - a) * _cosAvg;
        }
        return Math.atan2(_sinAvg, _cosAvg);
    }

    // --- Accessors for views ---------------------------------------------
    function getEstimate() { return _estimate; }
    function getState() { return _state; }
    function getRegistry() { return _registry; }
    function getSettings() { return _settings; }
    function getBuffer() { return _buffer; }
    function getRssi() { return _rssiSmooth; }

    function getHeadingForDisplay() {
        var hs = _headingSource.current();
        return hs[0];   // radians or null
    }

    function toggleOrientation() {
        var o = (_settings.orientation == 0) ? 1 : 0;
        _settings.set("orientation", o);
    }

    function applyEnvironment(envIdx) {
        _settings.set("environment", envIdx);
        _pathloss.setEnvironment(envIdx);
    }

    function resetFilter() {
        resetEngine();
        _state = Const.STATE_ACQUIRING;
    }
}
