using Toybox.Activity;

// Provides an absolute heading with a reliability flag. While moving we use the
// GPS course-over-ground (reliable); while stationary we fall back to the
// magnetometer compass via Activity.getActivityInfo().currentHeading, which is
// less reliable and may need calibration. VERIFY the stationary-compass behavior
// on real Venu 4 hardware (docs/02, docs/09).
class HeadingSource {
    hidden var _motionHeading;
    hidden var _motionOk;
    hidden var _override;   // simulator-only heading injection (see MockSignalSource)

    function initialize() {
        _motionHeading = null;
        _motionOk = false;
        _override = null;
    }

    // Force a heading (used by the mock in the simulator). Pass null to clear.
    function setOverride(h) {
        _override = h;
    }

    // Called from the controller on each GPS fix; hdg is non-null only when
    // the fix was taken while moving.
    function updateMotionHeading(hdg) {
        if (hdg != null) {
            _motionHeading = hdg;
            _motionOk = true;
        } else {
            _motionOk = false;
        }
    }

    // Returns [headingRad or null, reliable].
    function current() {
        if (_override != null) {
            return [_override, true];
        }
        if (_motionOk && _motionHeading != null) {
            return [_motionHeading, true];
        }
        var info = Activity.getActivityInfo();
        if (info != null && info.currentHeading != null) {
            return [info.currentHeading, false];   // compass: usable, lower trust
        }
        return [null, false];
    }
}
