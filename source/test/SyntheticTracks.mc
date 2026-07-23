// Scripted user paths for the mock signal source (docs/08). Each is an array of
// [t_ms, east_m, north_m] waypoints, linearly interpolated by elapsed time.
// The default emitter used by MockSignalSource sits at ~ (25, 10) meters.
module SyntheticTracks {

    // Straight walk (south -> north), passing to the west of the emitter.
    // Good for exercising the gradient / warmer-colder flip.
    function walkPast() {
        return [
            [0,      0.0,  -20.0],
            [8000,   0.0,  -10.0],
            [16000,  2.0,    0.0],
            [24000,  4.0,   10.0],
            [32000,  6.0,   20.0],
            [40000,  8.0,   30.0]
        ];
    }

    // L-shaped approach that ends a few meters from the emitter.
    // Good for exercising grid convergence + ARRIVED.
    function homeIn() {
        return [
            [0,     -10.0, -10.0],
            [12000, -10.0,  10.0],
            [24000,  10.0,  10.0],
            [36000,  22.0,  10.0]
        ];
    }
}
