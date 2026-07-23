using Toybox.Application;
using Toybox.WatchUi;

// App entry point. Owns the SessionController and shows the scan list first.
class RadarApp extends Application.AppBase {
    hidden var _controller;

    function initialize() {
        AppBase.initialize();
        _controller = new SessionController();
    }

    function onStart(state) {
        _controller.start();
    }

    function onStop(state) {
        if (_controller != null) {
            _controller.shutdown();
        }
    }

    function getInitialView() {
        var v = new ScanListView(_controller);
        return [v, new ScanListDelegate(_controller, v)];
    }
}
