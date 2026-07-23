using Toybox.Sensor;
using Toybox.Math;

// Coarse motion state from the accelerometer: are we walking (gates the gradient
// method and confirms GPS displacement is real). We deliberately do NOT integrate
// acceleration for position — drift makes that useless; GPS is position truth.
// See docs/02, docs/04.
class MotionProvider {
    hidden var _controller;
    hidden var _enabled;
    public var moving;

    const MOTION_MG = 120.0;  // deviation from 1g that counts as movement

    function initialize(controller) {
        _controller = controller;
        _enabled = false;
        moving = false;
    }

    function start() {
        if (_enabled) { return; }
        Sensor.enableSensorEvents(method(:onSensor));
        _enabled = true;
    }

    function stop() {
        if (!_enabled) { return; }
        Sensor.enableSensorEvents(null);
        _enabled = false;
    }

    function onSensor(info) {
        var m = false;
        if (info != null && (info has :accel) && info.accel != null) {
            var a = info.accel;  // [x,y,z] milli-g
            var mag = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
            var dev = mag - 1000.0;
            if (dev < 0) { dev = -dev; }
            m = dev > MOTION_MG;
        }
        moving = m;
        _controller.onMotion(m);
    }
}
