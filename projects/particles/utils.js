export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Seeded pseudo-random number generator (mulberry32).
 *
 * Every random decision in the world draws from this rather than
 * Math.random(), which makes a run reproducible from its seed alone. That is
 * what lets a save file restore a world *exactly* — restore the particle state
 * and this one integer, and the future unfolds identically. It is also as fast
 * as Math.random(), which matters because the physics loop draws from it twice
 * per particle per step.
 */
let rngState = 1;

export function seedRandom(seed) {
  // Zero is a fixed point for the state update, so it is never a valid seed.
  rngState = (seed >>> 0) || 1;
}

export function randomState() {
  return rngState;
}

export function setRandomState(state) {
  rngState = (state >>> 0) || 1;
}

export function random() {
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randomRange(min, max) {
  return min + random() * (max - min);
}

export function randomSigned(amount = 1) {
  return (random() * 2 - 1) * amount;
}

/** Base64 of a typed array's bytes — compact enough for save files. */
export function encodeTypedArray(array) {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  let binary = "";
  // Chunked because String.fromCharCode.apply blows the argument limit on
  // anything megabyte-sized, which a full particle pool certainly is.
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function decodeTypedArray(text, Type) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Type(bytes.buffer);
}

export function wrapHue(hue) {
  return ((hue % 360) + 360) % 360;
}

/**
 * Wrap a value into [0, size) — the torus operation used by both the physics
 * (positions) and the spatial grid (cell indices).
 */
export function wrap(value, size) {
  const wrapped = value % size;
  return wrapped < 0 ? wrapped + size : wrapped;
}

/** HSL (degrees, percent, percent) -> {r, g, b} in 0-255. */
export function hslToRgb(hue, saturation, lightness) {
  const h = wrapHue(hue) / 360;
  const s = saturation / 100;
  const l = lightness / 100;
  if (s === 0) {
    const value = Math.round(l * 255);
    return { r: value, g: value, b: value };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hueToChannel(p, q, h + 1 / 3) * 255),
    g: Math.round(hueToChannel(p, q, h) * 255),
    b: Math.round(hueToChannel(p, q, h - 1 / 3) * 255)
  };
}

function hueToChannel(p, q, t) {
  let value = t;
  if (value < 0) value += 1;
  if (value > 1) value -= 1;
  if (value < 1 / 6) return p + (q - p) * 6 * value;
  if (value < 1 / 2) return q;
  if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
  return p;
}

/** Opaque, flat CSS colour — one solid colour per species, no alpha, no glow. */
export function rgbColor(hue, saturation, lightness) {
  const { r, g, b } = hslToRgb(hue, saturation, lightness);
  return `rgb(${r},${g},${b})`;
}

export function formatInteger(value) {
  return Math.round(value).toLocaleString();
}

export function formatSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0 s";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}
