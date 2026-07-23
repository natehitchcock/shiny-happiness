using Toybox.BluetoothLowEnergy as Ble;
using Toybox.System;

// Scan-only BLE central. Feeds every advertisement into the DeviceRegistry (for
// the list) and, once a target is chosen, forwards that device's RSSI to the
// controller as observations. We never connect — advertisements carry the RSSI
// we need. See docs/02, docs/04.
//
// BLE cannot be exercised in the simulator; validate this on hardware (docs/08).
class BleScanner extends Ble.BleDelegate {
    hidden var _registry;
    hidden var _controller;
    hidden var _targetKey;
    hidden var _scanning;

    function initialize(registry, controller) {
        BleDelegate.initialize();
        _registry = registry;
        _controller = controller;
        _targetKey = null;
        _scanning = false;
    }

    function start() {
        if (_scanning) { return; }
        Ble.setDelegate(self);
        Ble.setScanState(Ble.SCAN_STATE_SCANNING);
        _scanning = true;
    }

    function stop() {
        if (!_scanning) { return; }
        Ble.setScanState(Ble.SCAN_STATE_OFF);
        _scanning = false;
    }

    function setTarget(key) { _targetKey = key; }

    // BleDelegate callback: iterator of ScanResult.
    function onScanResults(scanResults) {
        var now = System.getTimer();
        var r = scanResults.next();
        while (r != null) {
            var info = DeviceRegistry.keyInfo(r);
            var key = info[0];
            var unstable = info[1];
            var rssi = r.getRssi();

            var name = null;
            try { name = r.getDeviceName(); } catch (ex) { name = null; }

            _registry.observe(key, name, rssi, now, unstable);

            if (_targetKey != null && key.equals(_targetKey)) {
                _controller.onSignalObservation(rssi, now);
            }
            r = scanResults.next();
        }
    }

    function onScanStateChange(scanState, status) {
        // Surface/log scan errors here if needed.
    }
}
