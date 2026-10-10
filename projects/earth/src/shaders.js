// GLSL for the Earth renderer. Everything is WebGL2 / GLSL ES 3.00 (three.js compiles
// ShaderMaterial as #version 300 es, so texture/textureGrad/textureLod are native).
//
// Units inside the shaders are kilometres. Light is expressed per unit solar illuminance
// at the top of the atmosphere (E_sun = 1, white), so every radiance below is physically
// proportioned against the Sun; exposure is applied only at the very end.

export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// ─── Atmosphere model ───────────────────────────────────────────────────────
// Structure follows Hillaire 2020 ("A Scalable and Production Ready Sky and Atmosphere
// Rendering Technique") / Bruneton 2017, with coefficients re-derived per channel:
// those papers sample R,G,B at 680/550/440 nm, but 680 nm misses ozone's Chappuis peak
// (~600 nm), so long twilight paths lose green but not red and turn magenta. We sample
// at the sRGB primaries' dominant wavelengths (611, 549, 464 nm):
//   Rayleigh σs = 5.802e-3·(680/λ)⁴ → (8.90, 13.66, 26.8)e-3 /km, scale height 8 km
//   Ozone σa = σ_O3(λ)·N for 300 DU in a 10–40 km tent peaking at 25 km, with
//   σ_O3 ≈ (4.7, 3.5, 0.5)e-21 cm² (Serdyuchenko 2014) → (2.53, 1.88, 0.27)e-3 /km
// Their Mie default (σt 4.4e-3 /km → AOD ≈ 0.005) is far cleaner than the real planet
// (global mean AOD₅₅₀ ≈ 0.1–0.15, remote ocean ≈ 0.05–0.08, MODIS/AERONET). We use a
// clean-marine AOD ≈ 0.035 (σs 0.026, σt 0.029 /km, single-scattering albedo 0.9,
// scale height 1.2 km, g = 0.8): it whitens the low limb the way real haze does.
// Atmosphere top is at 110 km so the 95 km airglow layer sits inside it.
export const ATMOSPHERE = /* glsl */ `
#define PI 3.14159265358979
const float R_GROUND = 6371.0;
const float R_TOP = 6481.0;
const float R_CLOUD = 6377.0;          // ~6 km: mid-level cloud tops
const vec3 RAY_SCAT = vec3(8.90e-3, 13.66e-3, 26.8e-3);
const float RAY_H = 8.0;
const float MIE_SCAT = 0.0262;
const float MIE_EXT = 0.0291;
const float MIE_H = 1.2;
const float MIE_G = 0.8;
const vec3 OZONE_ABS = vec3(2.53e-3, 1.88e-3, 0.27e-3);
const float SUN_ANG_R = 0.004653;       // 0.2666° solar angular radius
const float GROUND_ALBEDO = 0.3;
const vec2 TRANS_SIZE = vec2(256.0, 64.0);
const float MS_SIZE = 32.0;
const float IRR_SIZE = 64.0;
const float H_TOP = sqrt(R_TOP * R_TOP - R_GROUND * R_GROUND);

// Ray/sphere with the closest-approach formulation (stable for grazing rays from far away).
// Miss returns t0 > t1.
vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  vec3 q = ro - b * rd;
  float h = r * r - dot(q, q);
  if (h < 0.0) return vec2(1e9, -1e9);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

vec3 atmoDensity(float h) {
  return vec3(exp(-h / RAY_H), exp(-h / MIE_H), max(0.0, 1.0 - abs(h - 25.0) / 15.0));
}
vec3 atmoExtinction(vec3 d) { return RAY_SCAT * d.x + MIE_EXT * d.y + OZONE_ABS * d.z; }

float phaseRayleigh(float c) { return 3.0 / (16.0 * PI) * (1.0 + c * c); }
float phaseMie(float c) {        // Cornette–Shanks
  const float g2 = MIE_G * MIE_G;
  float k = 3.0 / (8.0 * PI) * (1.0 - g2) / (2.0 + g2);
  return k * (1.0 + c * c) / pow(1.0 + g2 - 2.0 * MIE_G * c, 1.5);
}

float unitToUV(float x, float n) { return 0.5 / n + x * (1.0 - 1.0 / n); }
float uvToUnit(float u, float n) { return (u - 0.5 / n) / (1.0 - 1.0 / n); }

float distToTop(float r, float mu) {
  float disc = r * r * (mu * mu - 1.0) + R_TOP * R_TOP;
  return max(0.0, -r * mu + sqrt(max(disc, 0.0)));
}

// Bruneton's transmittance parameterisation: resolves the horizon where T changes fastest.
vec2 transmittanceUV(float r, float mu) {
  float rho = sqrt(max(0.0, r * r - R_GROUND * R_GROUND));
  float d = distToTop(r, mu);
  float dMin = R_TOP - r, dMax = rho + H_TOP;
  return vec2(unitToUV((d - dMin) / (dMax - dMin), TRANS_SIZE.x), unitToUV(rho / H_TOP, TRANS_SIZE.y));
}

#ifdef USE_LUTS
uniform sampler2D uTransLUT;
uniform sampler2D uMSLUT;

vec3 transmittance(float r, float mu) {
  return texture(uTransLUT, transmittanceUV(min(r, R_TOP), mu)).rgb;
}
// Transmittance toward the Sun, fading across the solar disc as it sets behind the planet.
vec3 sunTransmittance(float r, float muS) {
  float sinH = R_GROUND / r;
  float cosH = -sqrt(max(0.0, 1.0 - sinH * sinH));
  return transmittance(r, muS) * smoothstep(-sinH * SUN_ANG_R, sinH * SUN_ANG_R, muS - cosH);
}
vec3 multiScattering(float r, float muS) {
  vec2 uv = vec2(unitToUV(muS * 0.5 + 0.5, MS_SIZE),
                 unitToUV(clamp((r - R_GROUND) / (R_TOP - R_GROUND), 0.0, 1.0), MS_SIZE));
  return texture(uMSLUT, uv).rgb;
}
#endif
`;

// ─── LUT passes (run once at start-up) ──────────────────────────────────────
export const TRANSMITTANCE_FRAG = /* glsl */ `
${ATMOSPHERE}
void main() {
  vec2 uv = gl_FragCoord.xy / TRANS_SIZE;
  float xmu = uvToUnit(uv.x, TRANS_SIZE.x), xr = uvToUnit(uv.y, TRANS_SIZE.y);
  float rho = H_TOP * xr;
  float r = sqrt(rho * rho + R_GROUND * R_GROUND);
  float dMin = R_TOP - r, dMax = rho + H_TOP;
  float d = dMin + xmu * (dMax - dMin);
  float mu = d == 0.0 ? 1.0 : clamp((H_TOP * H_TOP - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0);
  const int N = 80;
  float dt = d / float(N);
  vec3 tau = vec3(0.0);
  for (int i = 0; i < N; i++) {
    float t = (float(i) + 0.5) * dt;
    float ri = sqrt(r * r + t * t + 2.0 * r * mu * t);
    tau += atmoExtinction(atmoDensity(ri - R_GROUND)) * dt;
  }
  gl_FragColor = vec4(exp(-tau), 1.0);
}`;

// Hillaire's multiple-scattering LUT: second-order luminance with an infinite-series
// correction 1/(1 − f_ms), stored per (sun zenith cosine, altitude).
export const MULTISCAT_FRAG = /* glsl */ `
#define USE_LUTS
${ATMOSPHERE}
void main() {
  vec2 uv = gl_FragCoord.xy / MS_SIZE;
  float muS = uvToUnit(uv.x, MS_SIZE) * 2.0 - 1.0;
  float r = clamp(R_GROUND + uvToUnit(uv.y, MS_SIZE) * (R_TOP - R_GROUND), R_GROUND + 0.01, R_TOP - 0.01);
  vec3 pos = vec3(0.0, r, 0.0);
  vec3 sun = vec3(sqrt(max(0.0, 1.0 - muS * muS)), muS, 0.0);
  const int SQ = 8;
  const int STEPS = 24;
  vec3 L2 = vec3(0.0), Fms = vec3(0.0);
  for (int i = 0; i < SQ; i++) {
    for (int j = 0; j < SQ; j++) {
      float cosT = 1.0 - 2.0 * (float(i) + 0.5) / float(SQ);
      float sinT = sqrt(max(0.0, 1.0 - cosT * cosT));
      float phi = 2.0 * PI * (float(j) + 0.5) / float(SQ);
      vec3 dir = vec3(sinT * cos(phi), cosT, sinT * sin(phi));
      vec2 tTop = raySphere(pos, dir, R_TOP);
      vec2 tGnd = raySphere(pos, dir, R_GROUND);
      bool hitG = tGnd.x > 0.0 && tGnd.y >= tGnd.x;
      float tMax = hitG ? tGnd.x : tTop.y;
      float dt = tMax / float(STEPS);
      vec3 T = vec3(1.0), L = vec3(0.0), F = vec3(0.0);
      for (int k = 0; k < STEPS; k++) {
        vec3 p = pos + dir * ((float(k) + 0.5) * dt);
        float rp = length(p);
        vec3 dens = atmoDensity(rp - R_GROUND);
        vec3 scat = RAY_SCAT * dens.x + MIE_SCAT * dens.y;
        vec3 ext = atmoExtinction(dens);
        vec3 Ts = exp(-ext * dt);
        vec3 integ = (1.0 - Ts) / max(ext, vec3(1e-9));
        L += T * scat * sunTransmittance(rp, dot(p, sun) / rp) * (1.0 / (4.0 * PI)) * integ;
        F += T * scat * integ;
        T *= Ts;
      }
      if (hitG) {
        vec3 n = normalize(pos + dir * tMax);
        float mu0 = dot(n, sun);
        L += T * sunTransmittance(R_GROUND, mu0) * max(mu0, 0.0) * GROUND_ALBEDO / PI;
      }
      L2 += L;
      Fms += F;
    }
  }
  L2 /= float(SQ * SQ);
  Fms /= float(SQ * SQ);
  gl_FragColor = vec4(L2 / (1.0 - Fms), 1.0);
}`;

// Sky irradiance on a horizontal surface at sea level vs. sun zenith cosine.
export const IRRADIANCE_FRAG = /* glsl */ `
#define USE_LUTS
${ATMOSPHERE}
void main() {
  float muS = uvToUnit(gl_FragCoord.x / IRR_SIZE, IRR_SIZE) * 2.0 - 1.0;
  vec3 pos = vec3(0.0, R_GROUND + 0.05, 0.0);
  vec3 sun = vec3(sqrt(max(0.0, 1.0 - muS * muS)), muS, 0.0);
  const int SQ = 8;
  const int STEPS = 24;
  vec3 E = vec3(0.0);
  for (int i = 0; i < SQ; i++) {
    for (int j = 0; j < SQ; j++) {
      float cosT = (float(i) + 0.5) / float(SQ);          // uniform in solid angle
      float sinT = sqrt(max(0.0, 1.0 - cosT * cosT));
      float phi = 2.0 * PI * (float(j) + 0.5) / float(SQ);
      vec3 dir = vec3(sinT * cos(phi), cosT, sinT * sin(phi));
      float tMax = raySphere(pos, dir, R_TOP).y;
      float c = dot(dir, sun);
      float phR = phaseRayleigh(c), phM = phaseMie(c);
      vec3 T = vec3(1.0), L = vec3(0.0);
      float prev = 0.0;
      for (int k = 0; k < STEPS; k++) {
        float x1 = float(k + 1) / float(STEPS), xm = (float(k) + 0.5) / float(STEPS);
        float t1 = tMax * x1 * x1, tm = tMax * xm * xm;
        float dt = t1 - prev; prev = t1;
        vec3 p = pos + dir * tm;
        float rp = length(p);
        vec3 dens = atmoDensity(rp - R_GROUND);
        vec3 sR = RAY_SCAT * dens.x; float sM = MIE_SCAT * dens.y;
        vec3 ext = atmoExtinction(dens);
        float mu = dot(p, sun) / rp;
        vec3 S = sunTransmittance(rp, mu) * (sR * phR + sM * phM) + multiScattering(rp, mu) * (sR + sM);
        vec3 Ts = exp(-ext * dt);
        L += T * S * (1.0 - Ts) / max(ext, vec3(1e-9));
        T *= Ts;
      }
      E += L * cosT;
    }
  }
  gl_FragColor = vec4(E * 2.0 * PI / float(SQ * SQ), 1.0);
}`;

// ─── Planet pass: one full-screen ray trace of atmosphere, surface, clouds, Sun, Moon ──
// Output: rgb = radiance added in front of the background, a = transmittance of the
// background (stars), composited with blend(ONE, SRC_ALPHA).
export const PLANET_FRAG = /* glsl */ `
#define USE_LUTS
${ATMOSPHERE}
uniform vec3 uCamPos;
uniform mat3 uCamRot;       // camera-to-world rotation
uniform mat4 uInvProj;
uniform float uPixelAngle;
uniform vec3 uSunDir;
uniform float uSunRadiance;
uniform float uEarthRot;
uniform float uCloudRot;
uniform float uCloudsOn;
uniform vec3 uMoonPos;
uniform float uLightsGain;
uniform float uAirglow;
uniform sampler2D uExposure;      // last frame's metered exposure
uniform vec2 uNightGain;          // (reference day exposure, exponent) for faint emitters
uniform float uSteps;
uniform sampler2D uAlbedo;
uniform sampler2D uCloudTex;
uniform sampler2D uLights;
uniform sampler2D uNormalTex;
uniform sampler2D uMoonTex;
uniform sampler2D uIrrLUT;
uniform vec2 uAlbedoSize;
uniform vec2 uCloudSize;
varying vec2 vUv;

const float MOON_R = 1737.4;
const float MOON_ALBEDO = 0.35;       // texture mean is ~0.34 linear; lunar normal albedo ~0.12
const float CLOUD_TAU = 60.0;         // optical depth of the densest texels (deep convection)
const float CLOUD_GAMMA = 2.4;
const float CLOUD_FLOOR = 0.1;        // the source map carries a haze floor over clear sky
const float CLOUD_RELIEF = 5.0;       // km of cloud-top height per unit texture density
const float NORMAL_STRENGTH = 4.0;     // the source normal map is soft; relief shows at low sun

vec3 skyIrradiance(float muS) {
  return texture(uIrrLUT, vec2(unitToUV(muS * 0.5 + 0.5, IRR_SIZE), 0.5)).rgb;
}

float gAirglow;                   // set once per pixel in main()
vec3 airglow(float h) {           // OI 557.7 nm layer, ~95 km, only seen edge-on at night
  float z = (h - 95.0) / 4.5;
  return gAirglow * vec3(0.45, 1.0, 0.25) * exp(-z * z);
}

// Ray-march in-scattering over [t0, t1]; warp > 0 packs samples toward t1, < 0 toward t0.
void integrateAtmosphere(vec3 ro, vec3 rd, float t0, float t1, int n, float warp,
                         float phR, float phM, inout vec3 L, inout vec3 T) {
  float len = t1 - t0;
  float wPrev = 0.0;
  for (int i = 0; i < n; i++) {
    float x1 = float(i + 1) / float(n), xm = (float(i) + 0.5) / float(n);
    float w1 = warp > 0.0 ? 1.0 - (1.0 - x1) * (1.0 - x1) : (warp < 0.0 ? x1 * x1 : x1);
    float wm = warp > 0.0 ? 1.0 - (1.0 - xm) * (1.0 - xm) : (warp < 0.0 ? xm * xm : xm);
    float dt = (w1 - wPrev) * len;
    wPrev = w1;
    vec3 p = ro + rd * (t0 + wm * len);
    float r = length(p);
    vec3 dens = atmoDensity(r - R_GROUND);
    vec3 sR = RAY_SCAT * dens.x;
    float sM = MIE_SCAT * dens.y;
    vec3 ext = sR + MIE_EXT * dens.y + OZONE_ABS * dens.z;
    float muS = dot(p, uSunDir) / r;
    vec3 S = sunTransmittance(r, muS) * (sR * phR + sM * phM) + multiScattering(r, muS) * (sR + sM)
           + airglow(r - R_GROUND);
    vec3 x = ext * dt;
    vec3 f = mix((1.0 - exp(-x)) / max(ext, vec3(1e-12)), dt * (1.0 - 0.5 * x), step(x, vec3(1e-3)));
    L += T * S * f;
    T *= exp(-x);
  }
}

// Longitude/latitude texture coordinates (flipY = false: v = 0 is the north pole).
vec2 geoUV(vec3 n, float rot) {
  float lon = atan(-n.z, n.x) - rot;
  float lat = asin(clamp(n.y, -1.0, 1.0));
  return vec2(fract(lon / (2.0 * PI) + 0.5), 0.5 - lat / PI);
}
// Screen-space UV derivatives with the longitude seam unwrapped (no 1-px mip seam).
vec4 uvGrad(vec2 uv) {
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  dx.x -= floor(dx.x + 0.5);
  dy.x -= floor(dy.x + 0.5);
  return vec4(dx, dy);
}
float gradLod(vec4 g, vec2 size) {
  vec2 a = g.xy * size, b = g.zw * size;
  return 0.5 * log2(max(max(dot(a, a), dot(b, b)), 1e-12));
}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x),
                 mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
                 mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.9375;
}
float fbm2(vec3 p) { return (vnoise(p) * 0.667 + vnoise(p * 2.03 + 17.1) * 0.333); }

// Cloud optics. Texture density → optical depth; reflectance from the Eddington
// two-stream solution for a conservative slab with g ≈ 0.85 (scaled τ* = 0.15 τ),
// with more reflection for oblique sun as real cloud decks show near the terminator.
float cloudTau(float d) {
  return CLOUD_TAU * pow(clamp((d - CLOUD_FLOOR) / (1.0 - CLOUD_FLOOR), 0.0, 1.0), CLOUD_GAMMA);
}
float cloudReflectance(float tau, float mu0) {
  float t = 0.225 * tau / (0.5 + max(mu0, 0.0));
  return t / (1.3333 + t);
}

vec3 sunDisk(vec3 rd) {
  if (dot(rd, uSunDir) < 0.999) return vec3(0.0);
  float ang = length(cross(rd, uSunDir));
  float cover = clamp((SUN_ANG_R - ang) / uPixelAngle + 0.5, 0.0, 1.0);
  float mu = sqrt(max(0.0, 1.0 - (ang * ang) / (SUN_ANG_R * SUN_ANG_R)));
  // Limb darkening (u ≈ 0.6, slightly stronger in blue)
  vec3 limb = 1.0 - vec3(0.52, 0.6, 0.7) * (1.0 - mu);
  return uSunRadiance * limb * cover;
}

vec2 moonUV(vec3 q) {
  vec3 e = normalize(-uMoonPos);                    // tidally locked: near side faces Earth
  vec3 north = normalize(vec3(0.0, 1.0, 0.0) - e * e.y);
  vec3 east = cross(north, e);
  float lon = atan(dot(q, east), dot(q, e));
  float lat = asin(clamp(dot(q, north), -1.0, 1.0));
  return vec2(fract(lon / (2.0 * PI) + 0.5), 0.5 - lat / PI);
}

vec3 shadeMoon(vec3 n, vec2 uv, vec4 g, vec3 rd) {
  vec3 a = textureGrad(uMoonTex, uv, g.xy, g.zw).rgb * MOON_ALBEDO;
  float mu0 = dot(n, uSunDir), mu = max(dot(n, -rd), 0.0);
  if (mu0 <= 0.0) return vec3(0.0);
  // Lommel–Seeliger (flat-looking full Moon) with the lunar phase law.
  float phaseDeg = degrees(acos(clamp(dot(uSunDir, -rd), -1.0, 1.0)));
  float phaseLaw = pow(10.0, -0.4 * (0.026 * phaseDeg + 4e-9 * pow(phaseDeg, 4.0)));
  return a / PI * 2.0 * mu0 / (mu0 + mu + 1e-4) * phaseLaw;
}

void main() {
  vec4 vd = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 rd = normalize(uCamRot * (vd.xyz / vd.w));
  vec3 ro = uCamPos;
  vec3 L = uSunDir;
  // Like the stars, airglow only registers in long (night-side) exposures.
  gAirglow = uAirglow * pow(max(textureLod(uExposure, vec2(0.5), 0.0).r / uNightGain.x, 1e-3), uNightGain.y);

  // Geometry and texture gradients are evaluated in uniform control flow, so that
  // derivative-based filtering stays valid on silhouette pixels.
  vec3 closest = ro - rd * dot(ro, rd);
  vec2 tG = raySphere(ro, rd, R_GROUND);
  bool hitG = tG.x > 0.0 && tG.y >= tG.x;
  vec3 nG = normalize(hitG ? ro + rd * tG.x : closest);
  vec2 tC = raySphere(ro, rd, R_CLOUD);
  bool shellC = tC.x > 0.0 && tC.y >= tC.x;
  bool hitC = uCloudsOn > 0.5 && shellC;
  vec3 nC = normalize(shellC ? ro + rd * tC.x : closest);
  vec2 uvG = geoUV(nG, uEarthRot);
  vec2 uvC = geoUV(nC, uEarthRot + uCloudRot);
  vec4 gG = uvGrad(uvG);
  vec4 gC = uvGrad(uvC);
  vec3 mo = ro - uMoonPos;
  vec2 tM = raySphere(mo, rd, MOON_R);
  bool hitM = tM.x > 0.0 && tM.y >= tM.x;
  vec3 nM = normalize(hitM ? mo + rd * tM.x : mo - rd * dot(mo, rd));
  vec2 uvM = moonUV(nM);
  vec4 gM = uvGrad(uvM);

  // Anything beyond the planet: the solar disc and the Moon.
  vec3 far = vec3(0.0);
  float farT = 1.0;
  if (!hitG) {
    far = sunDisk(rd);
    if (hitM) { far += shadeMoon(nM, uvM, gM, rd); farT = 0.0; }
  }

  vec2 tA = raySphere(ro, rd, R_TOP);
  if (tA.y < tA.x || tA.y <= 0.0) {
    gl_FragColor = vec4(far, farT);
    return;
  }

  float cosV = dot(rd, L);
  float phR = phaseRayleigh(cosV), phM = phaseMie(cosV);
  float t0 = max(tA.x, 0.0);
  vec3 p0 = ro + rd * t0;                          // rebase at the atmosphere entry
  float tEnd = (hitG ? tG.x : tA.y) - t0;
  float tCl = hitC ? tC.x - t0 : tEnd;

  // ── Clouds ──
  vec3 cloudRad = vec3(0.0);
  float cloudR = 0.0, cloudTdir = 1.0;
  if (hitC) {
    float lodC = gradLod(gC, uCloudSize);
    float d0 = textureGrad(uCloudTex, uvC, gC.xy, gC.zw).r;
    float d = d0;
    // Sub-texel breakup when the ~5 km texels are magnified (low orbit): ~3 km cells,
    // then ~600 m cumulus-top structure once a texel spans many pixels.
    float detail = clamp(-lodC * 0.6, 0.0, 1.0);
    float mottle = 1.0;
    if (detail > 0.0) {
      vec3 pc = nC * R_CLOUD;
      float fine = clamp(-lodC - 2.0, 0.0, 1.0);
      float n1 = fbm(pc * 0.35);
      float n2 = fine > 0.0 ? fbm2(pc * 1.7 + 11.0) : 0.5;
      float nz = mix(n1, 0.75 * n1 + 0.25 * n2, fine);
      d = clamp(d + (nz - 0.5) * 1.3 * detail * (sqrt(d * (1.0 - d)) + 0.12 * d), 0.0, 1.0);
      mottle = mix(1.0, 0.85 + 0.3 * n2, fine * smoothstep(0.2, 0.6, d));
    }
    float tau = cloudTau(d);
    float mu0 = dot(nC, L);
    float muV = max(dot(nC, -rd), 0.03);
    cloudTdir = exp(-tau / muV);
    cloudR = cloudReflectance(tau, mu0);
    // Cloud-top relief from the density gradient: tall, dense cells catch light on their
    // sunward side and fall into shade behind — strongest near the terminator.
    float tu = exp2(max(lodC, 0.0)) / uCloudSize.x, tv = exp2(max(lodC, 0.0)) / uCloudSize.y;
    float dE = textureGrad(uCloudTex, uvC + vec2(tu, 0.0), gC.xy, gC.zw).r - d0;
    float dN = textureGrad(uCloudTex, uvC - vec2(0.0, tv), gC.xy, gC.zw).r - d0;
    float cosLat = max(sqrt(1.0 - nC.y * nC.y), 0.05);
    vec3 east = normalize(vec3(nC.z, 0.0, -nC.x) + vec3(0.0, 0.0, 1e-5));
    vec3 north = cross(nC, east);
    vec2 grad = vec2(dE / (2.0 * PI * R_CLOUD * cosLat * tu), dN / (PI * R_CLOUD * tv));
    vec3 nb = normalize(nC - CLOUD_RELIEF * (grad.x * east + grad.y * north));
    float lit = max(dot(nb, L) + 0.04, 0.0) / 1.04 * mottle;
    cloudRad = cloudR / PI * (sunTransmittance(R_CLOUD, mu0) * lit + skyIrradiance(mu0));
  }

  // ── Surface ──
  vec3 groundRad = vec3(0.0);
  if (hitG) {
    vec3 n = nG;
    vec3 pg = n * R_GROUND;
    float lodG = gradLod(gG, uAlbedoSize);
    // Light that reaches the eye through cloud is mostly diffusely scattered: blur what's under it.
    float veilW = hitC ? clamp(cloudTdir / max(1.0 - cloudR, 1e-3), 0.0, 1.0) : 1.0;
    vec4 alb = textureGrad(uAlbedo, uvG, gG.xy, gG.zw);
    vec3 albedo = alb.rgb;
    float water = alb.a;
    if (veilW < 0.98) albedo = mix(textureLod(uAlbedo, uvG, lodG + 4.0).rgb, albedo, veilW);
    float detail = clamp(-lodG * 0.5, 0.0, 1.0);
    if (detail > 0.0) albedo *= 1.0 + (fbm(pg * 0.6) - 0.5) * 0.35 * detail * (1.0 - water);

    vec3 east = normalize(vec3(n.z, 0.0, -n.x) + vec3(0.0, 0.0, 1e-5));
    vec3 north = cross(n, east);
    vec3 nm = textureGrad(uNormalTex, uvG, gG.xy, gG.zw).xyz * 2.0 - 1.0;   // R = east, G = south
    vec3 ns = normalize(n + NORMAL_STRENGTH * (1.0 - water) * (nm.x * east - nm.y * north));

    float mu0 = dot(n, L);
    vec3 Tsun = sunTransmittance(R_GROUND, mu0);

    // Cloud shadow: follow the sun ray up to the cloud shell.
    float shTdir = 1.0, shR = 0.0;
    if (uCloudsOn > 0.5 && mu0 > -0.05) {
      float b = dot(pg, L);
      float tS = -b + sqrt(max(b * b + R_CLOUD * R_CLOUD - R_GROUND * R_GROUND, 0.0));
      vec3 ps = normalize(pg + L * tS);
      float ds = textureLod(uCloudTex, geoUV(ps, uEarthRot + uCloudRot), gradLod(gG, uCloudSize) + 1.0).r;
      float tauS = cloudTau(ds);
      shTdir = exp(-tauS / max(mu0, 0.08));
      shR = cloudReflectance(tauS, mu0);
    }
    vec3 Ebeam = Tsun * shTdir;                                          // direct sun, normal incidence
    vec3 Ehemi = Tsun * max(mu0, 0.0) * max(1.0 - shR - shTdir, 0.0)    // sun diffused through cloud
               + skyIrradiance(mu0) * (1.0 - 0.5 * shR);                  // blue sky

    vec3 land = albedo / PI * (Ebeam * max(dot(ns, L), 0.0) + Ehemi);

    // Ocean: dark water body + Fresnel sky reflection + GGX sun glint. Roughness from
    // Cox–Munk (σ² ≈ 0.003 + 0.00512·wind): ~0.2 for 5–10 m/s, varying with wind fields.
    vec3 V = -rd;
    float NoV = max(dot(n, V), 1e-3);
    float Fv = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);
    // Wind fields (~200 km, ~30 km) plus ~5–15 km slicks that show up in close-range glint.
    float rough = 0.12 + 0.11 * vnoise(pg * 0.0045) + 0.04 * vnoise(pg * 0.03);
    if (detail > 0.0) rough *= mix(1.0, 0.55 + 0.9 * fbm2(pg * vec3(0.07, 0.18, 0.07)), detail);
    vec3 H = normalize(L + V);
    float NoL = max(mu0, 0.0), NoH = max(dot(n, H), 0.0), VoH = max(dot(V, H), 0.0);
    float a2 = rough * rough;
    float dd = NoH * NoH * (a2 - 1.0) + 1.0;
    float D = a2 / (PI * dd * dd);
    float Vis = 0.5 / (NoL * sqrt(NoV * NoV * (1.0 - a2) + a2) + NoV * sqrt(NoL * NoL * (1.0 - a2) + a2) + 1e-5);
    float F = 0.02 + 0.98 * pow(1.0 - VoH, 5.0);
    vec3 glint = Ebeam * (D * Vis * F * NoL) * veilW;
    vec3 sea = albedo / PI * (Ebeam * NoL + Ehemi) * (1.0 - Fv)
             + Fv * skyIrradiance(mu0) / PI * 1.5
             + glint;

    vec3 surf = mix(land, sea, water);

    // City lights switch on after sunset; through cloud they bloom into soft glows.
    float li = textureGrad(uLights, uvG, gG.xy, gG.zw).r;
    if (veilW < 0.98) li = mix(textureLod(uLights, uvG, lodG + 3.5).r, li, veilW);
    float on = smoothstep(0.02, -0.12, mu0);
    vec3 lightCol = mix(vec3(1.0, 0.55, 0.22), vec3(1.0, 0.78, 0.55), smoothstep(0.4, 1.0, li));
    surf += uLightsGain * lightCol * pow(li, 2.2) * on;

    groundRad = surf;
  }

  // ── Atmosphere + composite ──
  vec3 SA = vec3(0.0), TA = vec3(1.0);
  float lenA = tCl;
  int nA = int(clamp(uSteps * (0.45 + lenA / 1400.0), 6.0, 32.0));
  if (hitG || hitC) {
    integrateAtmosphere(p0, rd, 0.0, tCl, nA, 1.0, phR, phM, SA, TA);
  } else {
    // Limb ray: samples packed toward the tangent point from both sides.
    float tMid = clamp(-dot(p0, rd), 0.0, tEnd);
    int nH = max(nA / 2 + 2, 6);
    integrateAtmosphere(p0, rd, 0.0, tMid, nH, 1.0, phR, phM, SA, TA);
    integrateAtmosphere(p0, rd, tMid, tEnd, nH, -1.0, phR, phM, SA, TA);
  }

  vec3 surfRad = hitG ? groundRad : far;
  vec3 col;
  float bgT;
  if (hitC) {
    vec3 SB = vec3(0.0), TB = vec3(1.0);
    int nB = int(clamp(uSteps * 0.4, 4.0, 12.0));
    integrateAtmosphere(p0, rd, tCl, tEnd, nB, hitG ? 1.0 : 0.0, phR, phM, SB, TB);
    col = SA + TA * (cloudRad + (1.0 - cloudR) * (SB + TB * surfRad));
    bgT = hitG ? 0.0 : dot(TA * TB, vec3(1.0 / 3.0)) * (1.0 - cloudR) * farT;
  } else {
    col = SA + TA * surfRad;
    bgT = hitG ? 0.0 : dot(TA, vec3(1.0 / 3.0)) * farT;
  }
  gl_FragColor = vec4(col, bgT);
}`;

// ─── Stars: point sources with a Gaussian optical PSF, flux-normalised ──────
export const STARS_VERT = /* glsl */ `
attribute vec3 tint;
attribute float flux;
uniform float uFluxScale;
uniform float uPointSize;
uniform sampler2D uExposure;
uniform float uExposureRef;
uniform float uExposurePow;
varying vec3 vCol;
void main() {
  vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 0.0);   // at infinity: no parallax
  clip.z = clip.w * 0.9999;
  gl_Position = clip;
  gl_PointSize = uPointSize;
  float e = textureLod(uExposure, vec2(0.5), 0.0).r;
  vCol = tint * flux * uFluxScale * pow(max(e / uExposureRef, 1e-3), uExposurePow);
}`;

export const STARS_FRAG = /* glsl */ `
uniform float uPointSize;
uniform float uSigma;
varying vec3 vCol;
void main() {
  vec2 d = (gl_PointCoord - 0.5) * uPointSize;
  float g = exp(-dot(d, d) / (2.0 * uSigma * uSigma)) / (6.2831853 * uSigma * uSigma);
  gl_FragColor = vec4(vCol * g, 1.0);
}`;

// ─── Post: bloom as an optical PSF (energy-conserving, no threshold) ────────
// Call of Duty: Advanced Warfare downsample (13 taps) / tent upsample chain.
export const DOWNSAMPLE_FRAG = /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uTexel;
varying vec2 vUv;
vec3 s(vec2 o) { return texture(uSrc, vUv + o * uTexel).rgb; }
void main() {
  vec3 c = s(vec2(0.0)) * 0.125
    + (s(vec2(-2, 2)) + s(vec2(2, 2)) + s(vec2(-2, -2)) + s(vec2(2, -2))) * 0.03125
    + (s(vec2(0, 2)) + s(vec2(-2, 0)) + s(vec2(2, 0)) + s(vec2(0, -2))) * 0.0625
    + (s(vec2(-1, 1)) + s(vec2(1, 1)) + s(vec2(-1, -1)) + s(vec2(1, -1))) * 0.125;
  gl_FragColor = vec4(c, 1.0);
}`;

export const UPSAMPLE_FRAG = /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uWeight;
varying vec2 vUv;
vec3 s(vec2 o) { return texture(uSrc, vUv + o * uTexel).rgb; }
void main() {
  vec3 c = s(vec2(0.0)) * 4.0
    + (s(vec2(0, 1)) + s(vec2(1, 0)) + s(vec2(0, -1)) + s(vec2(-1, 0))) * 2.0
    + (s(vec2(1, 1)) + s(vec2(1, -1)) + s(vec2(-1, 1)) + s(vec2(-1, -1)));
  gl_FragColor = vec4(c * (uWeight / 16.0), 1.0);
}`;

// Camera metering: highlight-weighted (power-3 mean) centre-weighted luminance of a
// small bloom mip, so black space doesn't drive the exposure; exponential adaptation.
// Samples clip just above bright cloud radiance so the solar disc counts as a highlight,
// not as something to expose for (matrix metering behaves the same way).
export const EXPOSURE_FRAG = /* glsl */ `
uniform sampler2D uSrc;
uniform sampler2D uPrev;
uniform float uDt;
uniform float uReset;
uniform float uHold;
uniform float uKey;
uniform vec2 uRange;
void main() {
  float sumW = 0.0, sumP = 0.0;
  for (int y = 0; y < 12; y++) {
    for (int x = 0; x < 16; x++) {
      vec2 uv = (vec2(float(x), float(y)) + 0.5) / vec2(16.0, 12.0);
      float l = min(dot(texture(uSrc, uv).rgb, vec3(0.2126, 0.7152, 0.0722)), 0.12);
      vec2 d = uv - 0.5;
      float w = exp(-dot(d, d) * 2.5);
      sumP += w * l * l * l;
      sumW += w;
    }
  }
  float m = pow(sumP / sumW, 1.0 / 3.0);
  float target = clamp(uKey / max(m, 1e-7), uRange.x, uRange.y);
  float prev = texture(uPrev, vec2(0.5)).r;
  float lp = log2(max(prev, 1e-6)), lt = log2(target);
  float rate = lt < lp ? 2.5 : 0.9;
  float e = uReset > 0.5 ? target : uHold > 0.5 ? prev : exp2(mix(lp, lt, 1.0 - exp(-uDt * rate)));
  gl_FragColor = vec4(e, 0.0, 0.0, 1.0);
}`;

// Final: exposure, optical PSF mix, cos² falloff, AgX, sRGB, sensor noise + dither.
export const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D uHDR;
uniform sampler2D uBloom;
uniform sampler2D uExposure;
uniform float uBloomStrength;
uniform float uBloomNorm;
uniform float uTime;
uniform float uGrain;
uniform vec2 uTanHalf;
// AgX "look" in ASC-CDL terms (power, saturation): a camera picture profile's gentle
// contrast/saturation over AgX's deliberately flat base.
uniform vec2 uLook;
varying vec2 vUv;

// AgX (Sobotka), Filament/three.js fit.
vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x, x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 c) {
  const mat3 toRec2020 = mat3(0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.0880, 0.0433, 0.0113, 0.8956);
  const mat3 fromRec2020 = mat3(1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187);
  const mat3 inset = mat3(0.856627153315983, 0.137318972929847, 0.11189821299995,
                          0.0951212405381588, 0.761241990602591, 0.0767994186031903,
                          0.0482516061458583, 0.101439036467562, 0.811302368396859);
  const mat3 outset = mat3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826,
                           -0.11060664309660323, 1.157823702216272, -0.11060664309660294,
                           -0.016493938717834573, -0.016493938717834257, 1.2519364065950405);
  const float minEv = -12.47393, maxEv = 4.026069;
  c = inset * (toRec2020 * c);
  c = clamp((log2(max(c, 1e-10)) - minEv) / (maxEv - minEv), 0.0, 1.0);
  c = agxContrast(c);
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = pow(max(c, 0.0), vec3(uLook.x));
  c = luma + uLook.y * (c - luma);
  c = outset * c;
  c = pow(max(c, 0.0), vec3(2.2));
  return clamp(fromRec2020 * c, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec3 c = mix(texture(uHDR, vUv).rgb, texture(uBloom, vUv).rgb * uBloomNorm, uBloomStrength);
  c *= texture(uExposure, vec2(0.5)).r;
  vec2 tp = (vUv * 2.0 - 1.0) * uTanHalf;
  c /= 1.0 + dot(tp, tp);
  c = toSRGB(agx(c));
  vec2 seed = gl_FragCoord.xy + fract(uTime * 13.37) * 311.0;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c += (hash12(seed) - 0.5) * uGrain * (0.35 + sqrt(luma));
  c += (hash12(seed + 71.3) + hash12(seed + 19.1) - 1.0) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}`;
