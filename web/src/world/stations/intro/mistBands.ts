// The forest's hanging mist, computed along each view ray instead of drawn as sheets: a band is a Gaussian
// of density in height, so the density along a straight ray has a closed form (an erf difference). No
// geometry, no overdraw, and no hard line where a sheet would cut a trunk or meet the eye edge-on.
// MIST_GLSL mirrors bandDepth and bandAlpha; place() (placeShaders.ts) adds the bands to every surface.

/** erf, Winitzki's approximation (error < 2e-4). */
export function erf(x: number): number {
  const a = 0.147;
  const x2 = x * x;
  return Math.sign(x) * Math.sqrt(1 - Math.exp((-x2 * (4 / Math.PI + a * x2)) / (1 + a * x2)));
}

/** ∫ exp(-((h - y) / t)²) ds along a ray of length len whose height goes from y0 to y1. */
export function bandDepth(y0: number, y1: number, len: number, y: number, t: number): number {
  const dy = y1 - y0;
  if (Math.abs(dy) < 1e-3 * t) return len * Math.exp(-((((y0 + y1) / 2 - y) / t) ** 2));
  return (len * t * Math.sqrt(Math.PI) * 0.5 * (erf((y1 - y) / t) - erf((y0 - y) / t))) / dy;
}

/** A level path through a band's middle this long is as opaque as its plan opacity. */
export const MIST_REACH = 20;

/** The density scale for a band whose opacity over MIST_REACH m is `opacity`. */
export const bandK = (opacity: number) => -Math.log(1 - opacity) / MIST_REACH;

export const bandAlpha = (depth: number, k: number) => 1 - Math.exp(-depth * k);

/** bandDepth and bandAlpha in GLSL, three bands (uBandY height, uBandT thickness, uBandK density, uBandV drift). */
export const MIST_GLSL = /* glsl */ `
uniform vec3 uBandY, uBandT, uBandK, uBandV;
float erfA(float x){ float x2 = x * x; return sign(x) * sqrt(1. - exp(-x2 * (1.2732395 + .147 * x2) / (1. + .147 * x2))); }
float bandDepth(float y0, float y1, float len, float y, float t){
  float dy = y1 - y0;
  if (abs(dy) < 1e-3 * t) { float m = ((y0 + y1) * .5 - y) / t; return len * exp(-m * m); }
  return len * t * .8862269 * (erfA((y1 - y) / t) - erfA((y0 - y) / t)) / dy;
}
vec3 mistBands(vec3 c, vec3 wp){
  if (uBandK.x + uBandK.y + uBandK.z <= 0.) return c;
  vec3 e = cameraPosition;
  float len = distance(wp, e);
  float a = 0.;
  for (int i = 0; i < 3; i++){
    float y = uBandY[i], t = uBandT[i], k = uBandK[i];
    if (k <= 0.) continue;
    // The band's drifting density, read a fixed way along the ray (continuous across the eye's level,
    // where a "where it crosses the band" point would jump).
    vec2 q = (e.xz + (wp.xz - e.xz) * min(1., 12. / max(len, 1e-3))) * .09 + uTime * uBandV[i] * vec2(1., .6);
    float m = .25 + 1.5 * smoothstep(.3, .8, vn2(q) * .65 + vn2(q * 2.7 + 3.) * .35);
    // Never a wall in front of the eye.
    float near = smoothstep(1., 6., len);
    a = 1. - (1. - a) * exp(-bandDepth(e.y, wp.y, len, y, t) * k * m * near);
  }
  return mix(c, uMist * 1.3, a);
}
`;
