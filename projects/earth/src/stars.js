import * as THREE from 'three';

// Star field with physical relative brightness.
// The ~60 brightest stars are real (RA h, Dec °, V mag, B−V), so bright stars sit where
// they do in the real sky. Fainter stars are synthesised with real-sky statistics:
// cumulative counts growing ~3× per magnitude (Allen's Astrophysical Quantities) and a
// galactic-plane concentration that increases with magnitude, placed with the true
// galactic-pole orientation. Flux is relative to the Sun (V = −26.74), so stars scale
// with the same exposure as the sunlit Earth and mostly vanish on day-side exposures.
const BRIGHT = [
  [6.752, -16.716, -1.46, 0.00], [6.399, -52.696, -0.74, 0.15], [14.660, -60.834, -0.27, 0.71],
  [14.261, 19.182, -0.05, 1.23], [18.616, 38.784, 0.03, 0.00], [5.278, 45.998, 0.08, 0.80],
  [5.242, -8.202, 0.13, -0.03], [7.655, 5.225, 0.34, 0.42], [1.629, -57.237, 0.46, -0.16],
  [5.919, 7.407, 0.50, 1.85], [14.064, -60.373, 0.61, -0.23], [19.846, 8.868, 0.76, 0.22],
  [12.443, -63.099, 0.76, -0.24], [4.599, 16.509, 0.86, 1.54], [16.490, -26.432, 0.96, 1.83],
  [13.420, -11.161, 0.97, -0.23], [7.755, 28.026, 1.14, 1.00], [22.961, -29.622, 1.16, 0.09],
  [20.690, 45.280, 1.25, 0.09], [12.795, -59.689, 1.25, -0.23], [10.139, 11.967, 1.35, -0.11],
  [6.977, -28.972, 1.50, -0.21], [7.577, 31.888, 1.58, 0.03], [12.519, -57.113, 1.63, 1.60],
  [17.560, -37.104, 1.62, -0.22], [5.419, 6.350, 1.64, -0.22], [5.438, 28.608, 1.65, -0.13],
  [9.220, -69.717, 1.67, 0.07], [5.604, -1.202, 1.69, -0.18], [22.137, -46.961, 1.74, -0.13],
  [5.679, -1.943, 1.77, -0.21], [12.900, 55.960, 1.77, -0.02], [11.062, 61.751, 1.79, 1.07],
  [3.405, 49.861, 1.79, 0.48], [7.140, -26.393, 1.84, 0.68], [18.403, -34.385, 1.85, -0.03],
  [8.375, -59.510, 1.86, 1.28], [13.792, 49.313, 1.86, -0.19], [5.992, 44.948, 1.90, 0.08],
  [16.811, -69.028, 1.91, 1.44], [6.628, 16.399, 1.93, 0.00], [20.427, -56.735, 1.94, -0.20],
  [8.159, -47.337, 1.83, -0.26], [2.530, 89.264, 1.98, 0.60], [6.378, -17.956, 1.98, -0.23],
  [9.460, -8.659, 1.98, 1.44], [2.120, 23.463, 2.00, 1.15], [0.726, -17.987, 2.04, 1.02],
  [18.921, -26.297, 2.05, -0.13], [5.796, -9.670, 2.06, -0.17], [0.140, 29.091, 2.06, -0.11],
  [1.162, 35.621, 2.05, 1.58], [14.845, 74.156, 2.08, 1.47], [17.582, 12.560, 2.08, 0.15],
  [0.675, 56.537, 2.24, 1.17], [3.136, 40.956, 2.12, -0.05], [13.399, 54.925, 2.23, 0.02],
  [17.943, 51.489, 2.23, 1.52], [20.370, 40.257, 2.23, 0.67], [11.818, 14.572, 2.14, 0.09],
];

// Real-sky cumulative counts are ~3× per magnitude; faint limit keeps GPU work trivial.
const MAG_MIN = 2.25, MAG_MAX = 7.6, COUNT = 26000, SLOPE = 0.47;

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// B−V → effective temperature (Ballesteros 2012) → linear sRGB via Helland's blackbody fit,
// then desaturated: camera sensors render stars far less saturated than the blackbody hue.
function starTint(bv, out) {
  const T = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  const t = T / 100;
  let r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  let g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  let b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const lin = v => Math.pow(Math.min(Math.max(v, 0), 255) / 255, 2.2);
  r = lin(r); g = lin(g); b = lin(b);
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const sat = 0.55;
  out[0] = (y + (r - y) * sat) / y; out[1] = (y + (g - y) * sat) / y; out[2] = (y + (b - y) * sat) / y;
}

// Galactic (l, b) → equatorial J2000 unit vector in world frame.
const NGP_RA = 192.85948 * Math.PI / 180, NGP_DEC = 27.12825 * Math.PI / 180, L_NCP = 122.93192 * Math.PI / 180;
function galacticToWorld(l, b, out) {
  const sd = Math.sin(NGP_DEC) * Math.sin(b) + Math.cos(NGP_DEC) * Math.cos(b) * Math.cos(L_NCP - l);
  const dec = Math.asin(sd);
  const y = Math.cos(b) * Math.sin(L_NCP - l);
  const x = Math.cos(NGP_DEC) * Math.sin(b) - Math.sin(NGP_DEC) * Math.cos(b) * Math.cos(L_NCP - l);
  const ra = NGP_RA + Math.atan2(y, x);
  out[0] = Math.cos(dec) * Math.cos(ra); out[1] = Math.sin(dec); out[2] = -Math.cos(dec) * Math.sin(ra);
}

export function createStars() {
  const n = BRIGHT.length + COUNT;
  const pos = new Float32Array(n * 3), tint = new Float32Array(n * 3), flux = new Float32Array(n);
  const rand = mulberry32(20260926);
  const tmp = [0, 0, 0];
  const put = (i, dir, mag, bv) => {
    pos.set(dir, i * 3);
    starTint(bv, tmp); tint.set(tmp, i * 3);
    flux[i] = Math.pow(10, -0.4 * (mag + 26.74));
  };
  BRIGHT.forEach(([raH, decD, mag, bv], i) => {
    const ra = raH * Math.PI / 12, dec = decD * Math.PI / 180;
    put(i, [Math.cos(dec) * Math.cos(ra), Math.sin(dec), -Math.cos(dec) * Math.sin(ra)], mag, bv);
  });
  const a0 = Math.pow(10, SLOPE * MAG_MIN), a1 = Math.pow(10, SLOPE * MAG_MAX);
  for (let i = BRIGHT.length; i < n; i++) {
    const mag = Math.log10(a0 + rand() * (a1 - a0)) / SLOPE;
    // Disc concentration grows with depth: ~1.5× at the plane for bright, ~4× for mag 7.5.
    const k = 0.5 + 3.0 * (mag - MAG_MIN) / (MAG_MAX - MAG_MIN);
    let l, b;
    for (;;) {
      l = rand() * Math.PI * 2;
      b = Math.asin(2 * rand() - 1);
      const w = (1 + k * Math.exp(-Math.abs(b) / (14 * Math.PI / 180))) / (1 + k);
      if (rand() < w) break;
    }
    const u = rand();
    const bv = u < 0.3 ? 0.05 + (rand() - 0.5) * 0.35 : u < 0.88 ? 0.65 + (rand() - 0.5) * 0.7 : 1.35 + (rand() - 0.5) * 0.5;
    galacticToWorld(l, b, tmp);
    put(i, tmp.slice(), mag, bv);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  geo.setAttribute('flux', new THREE.BufferAttribute(flux, 1));
  return geo;
}
