using Toybox.Math;

// Small numeric helpers used by the estimators. Kept dependency-free so they
// can be exercised directly from the self-test view (docs/08).
module MathUtil {

    function clamp(x, lo, hi) {
        if (x < lo) { return lo; }
        if (x > hi) { return hi; }
        return x;
    }

    // Absolute smallest angular difference between two bearings (radians).
    function angDiff(a, b) {
        var d = a - b;
        while (d > Math.PI)  { d -= 2.0 * Math.PI; }
        while (d < -Math.PI) { d += 2.0 * Math.PI; }
        return (d < 0) ? -d : d;
    }

    function log10(x) {
        return Math.log(x, 10);   // Toybox.Math.log(value, base)
    }

    // Solve a 3x3 linear system by Cramer's rule.
    //   | a11 a12 a13 | |x|   |b1|
    //   | a21 a22 a23 | |y| = |b2|
    //   | a31 a32 a33 | |z|   |b3|
    // Returns [x,y,z] or null if (near) singular.
    function solve3(a11, a12, a13,
                    a21, a22, a23,
                    a31, a32, a33,
                    b1,  b2,  b3) {
        var det = a11 * (a22 * a33 - a23 * a32)
                - a12 * (a21 * a33 - a23 * a31)
                + a13 * (a21 * a32 - a22 * a31);
        if (det > -1e-9 && det < 1e-9) { return null; }

        var dx = b1  * (a22 * a33 - a23 * a32)
               - a12 * (b2  * a33 - a23 * b3)
               + a13 * (b2  * a32 - a22 * b3);
        var dy = a11 * (b2  * a33 - a23 * b3)
               - b1  * (a21 * a33 - a23 * a31)
               + a13 * (a21 * b3  - b2  * a31);
        var dz = a11 * (a22 * b3  - b2  * a32)
               - a12 * (a21 * b3  - b2  * a31)
               + b1  * (a21 * a32 - a22 * a31);

        return [dx / det, dy / det, dz / det];
    }
}
