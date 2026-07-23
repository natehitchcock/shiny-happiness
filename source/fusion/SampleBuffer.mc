// Fixed-capacity ring buffer of Samples. Bounds memory (docs/02, docs/07) while
// keeping iteration cheap for the estimators and the debug overlay.
class SampleBuffer {
    hidden var _arr;
    hidden var _cap;
    hidden var _size;
    hidden var _head;   // index of next write

    function initialize(cap) {
        _cap = cap;
        _arr = new [cap];
        _size = 0;
        _head = 0;
    }

    function add(s) {
        _arr[_head] = s;
        _head = (_head + 1) % _cap;
        if (_size < _cap) { _size++; }
    }

    function size() { return _size; }

    // index 0 = oldest retained sample, size-1 = newest.
    function get(i) {
        var start = (_head - _size + _cap) % _cap;
        return _arr[(start + i) % _cap];
    }

    function latest() {
        if (_size == 0) { return null; }
        return _arr[(_head - 1 + _cap) % _cap];
    }

    function clear() {
        _size = 0;
        _head = 0;
    }
}
