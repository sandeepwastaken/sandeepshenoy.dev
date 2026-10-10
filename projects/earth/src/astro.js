// Low-precision solar/lunar ephemerides (Astronomical Almanac "low precision" formulae,
// good to ~0.01° for the Sun and ~0.3° for the Moon) and sidereal time.
// World frame: +Y = celestial north pole, +X = vernal equinox (RA 0h); right-handed,
// so RA increases counter-clockwise seen from +Y, same sense as Earth's rotation.

const DEG = Math.PI / 180;

const daysSinceJ2000 = ms => ms / 86400000 + 2440587.5 - 2451545.0;

// Greenwich mean sidereal time as an angle (radians): the RA of the Greenwich meridian.
export function gmst(ms) {
  const n = daysSinceJ2000(ms);
  return (((280.46061837 + 360.98564736629 * n) % 360) + 360) % 360 * DEG;
}

export function sunEquatorial(ms) {
  const n = daysSinceJ2000(ms);
  const L = 280.460 + 0.9856474 * n;
  const g = (357.528 + 0.9856003 * n) * DEG;
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  return {
    ra: Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)),
    dec: Math.asin(Math.sin(eps) * Math.sin(lambda)),
  };
}

// Returns RA/Dec (radians) and geocentric distance in Earth radii.
export function moonEquatorial(ms) {
  const T = daysSinceJ2000(ms) / 36525;
  const s = x => Math.sin(x * DEG), c = x => Math.cos(x * DEG);
  const lambda = 218.32 + 481267.881 * T
    + 6.29 * s(135.0 + 477198.87 * T) - 1.27 * s(259.3 - 413335.36 * T)
    + 0.66 * s(235.7 + 890534.22 * T) + 0.21 * s(269.9 + 954397.74 * T)
    - 0.19 * s(357.5 + 35999.05 * T) - 0.11 * s(186.5 + 966404.03 * T);
  const beta = 5.13 * s(93.3 + 483202.02 * T) + 0.28 * s(228.2 + 960400.89 * T)
    - 0.28 * s(318.3 + 6003.15 * T) - 0.17 * s(217.6 - 407332.21 * T);
  const parallax = 0.9508 + 0.0518 * c(135.0 + 477198.87 * T) + 0.0095 * c(259.3 - 413335.36 * T)
    + 0.0078 * c(235.7 + 890534.22 * T) + 0.0028 * c(269.9 + 954397.74 * T);
  const l = c(beta) * c(lambda);
  const m = 0.9175 * c(beta) * s(lambda) - 0.3978 * s(beta);
  const n = 0.3978 * c(beta) * s(lambda) + 0.9175 * s(beta);
  return { ra: Math.atan2(m, l), dec: Math.asin(n), dist: 1 / Math.sin(parallax * DEG) };
}

export function equatorialToWorld(ra, dec, out) {
  return out.set(Math.cos(dec) * Math.cos(ra), Math.sin(dec), -Math.cos(dec) * Math.sin(ra));
}
