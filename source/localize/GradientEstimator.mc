using Toybox.Math;

// MVP direction finder. Fits a local plane rssi ~= a*e + b*n + c over the recent
// track; the gradient (a,b) points toward increasing signal = toward the emitter.
// Needs only motion (no compass, no absolute distance), which is why it is the
// guaranteed-shippable method. See docs/05.
class GradientEstimator {
    const WINDOW = 12;         // recent samples to fit
    const MIN_SPREAD_M = 3.0;  // require this much spatial spread

    // Returns { :bearing, :warmer, :conf } or null if not enough information.
    function estimate(buffer) {
        var size = buffer.size();
        if (size < 4) { return null; }

        var start = (size > WINDOW) ? size - WINDOW : 0;

        var See = 0.0, Snn = 0.0, Sen = 0.0, Se = 0.0, Sn = 0.0, S1 = 0.0;
        var Ser = 0.0, Snr = 0.0, Sr = 0.0;
        var minE = null, maxE = null, minN = null, maxN = null;

        for (var i = start; i < size; i++) {
            var s = buffer.get(i);
            var e = s.e, n = s.n, r = s.rssi;
            See += e * e; Snn += n * n; Sen += e * n;
            Se += e; Sn += n; S1 += 1.0;
            Ser += e * r; Snr += n * r; Sr += r;
            if (minE == null || e < minE) { minE = e; }
            if (maxE == null || e > maxE) { maxE = e; }
            if (minN == null || n < minN) { minN = n; }
            if (maxN == null || n > maxN) { maxN = n; }
        }

        var spreadE = maxE - minE;
        var spreadN = maxN - minN;
        var spread = Math.sqrt(spreadE * spreadE + spreadN * spreadN);
        if (spread < MIN_SPREAD_M) { return null; }

        // Normal equations for [a,b,c].
        var sol = MathUtil.solve3(See, Sen, Se,
                                  Sen, Snn, Sn,
                                  Se,  Sn,  S1,
                                  Ser, Snr, Sr);
        if (sol == null) { return null; }

        var a = sol[0], b = sol[1];
        var gmag = Math.sqrt(a * a + b * b);
        if (gmag < 1e-4) { return null; }

        var bearing = Math.atan2(a, b);   // toward increasing RSSI

        // Warmer/colder: is our recent motion up-gradient?
        var warmer = 0;
        if (size >= 2) {
            var last = buffer.get(size - 1);
            var prev = buffer.get(size - 2);
            var ve = last.e - prev.e;
            var vn = last.n - prev.n;
            var dot = ve * a + vn * b;
            warmer = (dot > 0) ? 1 : ((dot < 0) ? -1 : 0);
        }

        // Heuristic confidence from gradient strength x spatial spread.
        var conf = MathUtil.clamp(gmag * spread / 30.0, 0.0, 0.6);

        return { :bearing => bearing, :warmer => warmer, :conf => conf };
    }
}
