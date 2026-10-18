// GLSL for the hand art. Written for three.js ShaderMaterial (GLSL ES 1.0 style; three
// translates it for WebGL2).
//
// handFragment(style) draws the hand straight from the skeleton uniforms, one full-screen
// pass, in one of six styles, on a transparent background with a soft dark backdrop under the
// hand so it reads over the webcam. One program per style keeps each small: the six together
// in one program took over a second to compile on Windows (D3D inlines every branch). A
// crossfade draws the two styles' programs additively, each weighted by the same noise mask,
// which sums to exactly the mix of the two (premultiplied colors mix linearly):
//   0 ink     idle: dry-brush strokes along the bones, thick at the joints, over a hairline
//   1 bloom   grab: brush strokes bursting out of the palm, sparse to dense
//   2 burst   release: streaks shooting out of the fingertips
//   3 trail   recording: a particle hand with a luminous trail (TRAIL_FRAG's feedback buffer)
//   4 ripple  frozen: a calm dot field rippling out from the palm
//   5 glitch  reset: the hand tears into displaced rows, dark slabs and pixel fragments, then
//             snaps back
// Space: p = (u * aspect, v), y up; one CSS pixel is uPx / uRes.y.

export const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const COMMON = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec4 uBones[21];  // ax, ay, bx, by
uniform float uAspect;
uniform float uBoneR;
uniform float uTime;      // seconds; frozen under reduced motion

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-10), 0.0, 1.0);
  return length(pa - ba * h);
}

// Distance from q to the nearest bone's centerline.
float handD(vec2 q) {
  float d = 1e3;
  for (int i = 0; i < 21; i++) d = min(d, segDist(q, uBones[i].xy, uBones[i].zw));
  return d;
}
`;

export const handFragment = (style: number) => /* glsl */ `
#define STYLE ${style}
${COMMON}
uniform vec2 uRes;        // drawing-buffer pixels
uniform float uPx;        // pixel ratio
uniform float uScale;     // hand size: wrist to middle knuckle
uniform vec2 uPalm;
uniform vec4 uBurst[5];   // fingertip x, y, dir x, dir y at the release
uniform vec3 uBounds;     // x, y, radius: nothing is drawn outside
uniform float uMix;       // crossfade 0..1; 0: no crossfade, this pass draws alone
uniform float uPassB;     // 1: this pass draws the incoming style (and the seam)
uniform float uSeed;
uniform float uAge;       // seconds since this pass's style began
uniform float uGrip;      // 0 open .. 1 closed, eased
uniform float uPresence;  // 0 no hand .. 1 hand, eased
uniform sampler2D uTrail;
uniform vec3 uInk;
uniform vec3 uTeal;
uniform vec3 uAmber;
uniform vec3 uShade;

float cpx;    // one CSS pixel in p units
vec3 accent;  // teal, amber while the gripper is closed

float hairline(float d, float w) {
  return 1.0 - smoothstep(w - cpx * 0.6, w + cpx * 0.6, d);
}

// Over-compositing of premultiplied colors: top over bottom.
vec4 over(vec4 top, vec4 bottom) {
  return top + bottom * (1.0 - top.a);
}

vec4 sInk(vec2 p, float dP) {
  float W = uBoneR * 2.0;
  float boil = floor(uTime * 7.0);
  float cov = 0.0;
  float tone = 1.0;
  for (int i = 0; i < 21; i++) {
    vec2 a = uBones[i].xy;
    vec2 b = uBones[i].zw;
    vec2 ba = b - a;
    float L = length(ba);
    if (L < 1e-5) continue;
    vec2 t = ba / L;
    vec2 pa = p - a;
    float u = dot(pa, t) / L;
    if (u < -0.15 || u > 1.15) continue;
    float fi = float(i);
    float v = dot(pa, vec2(-t.y, t.x)) + W * 0.07 * (hash12(vec2(fi, boil)) - 0.5);
    if (abs(v) > W * 1.4) continue;
    // Each bone's stroke weight drifts slowly: some bold, some barely there.
    float weight = 0.18 + 0.82 * smoothstep(0.3, 0.7, vnoise(vec2(fi * 1.7, uTime * 0.35)));
    float prof = 0.5 + 0.5 * pow(abs(2.0 * u - 1.0), 1.5);   // thick at the joints
    float ends = smoothstep(-0.13, 0.0, u) * (1.0 - smoothstep(1.0, 1.13, u));
    float br = 0.65 * vnoise(vec2(u * L / W * 0.4 + fi * 7.0, v / W * 5.0 + boil * 3.1))
             + 0.35 * vnoise(vec2(u * L / W * 0.9 - fi * 3.0, v / W * 11.0 - boil * 1.7));
    float halfW = W * weight * prof * ends * (0.85 + 0.3 * br);
    float inside = 1.0 - smoothstep(halfW - cpx * 0.7, halfW + cpx * 0.7, abs(v));
    bool tip = i == 3 || i == 7 || i == 11 || i == 15 || i == 20;
    float dry = 0.2 + smoothstep(0.55, 1.1, u) * (tip ? 0.6 : 0.3); // the brush lifts off
    float c = inside * smoothstep(dry - 0.06, dry + 0.06, br);
    if (c > cov) { cov = c; tone = 0.6 + 0.4 * br; }
  }
  float hair = hairline(dP, cpx * 0.6) * 0.85;
  vec4 stroke = vec4(uInk * tone * cov, cov);
  return over(stroke, vec4(accent * hair, hair));
}

vec4 sBloom(vec2 p, float dP, float age) {
  const float N = 40.0;
  vec2 d = p - uPalm;
  float r = length(d);
  float theta = atan(d.y, d.x);
  // Blooms out sparse to dense, then settles smaller and sparser so a long grab still shows the hand.
  float settle = smoothstep(0.9, 1.7, age);
  float grow = (1.0 - pow(1.0 - clamp(age / 0.55, 0.0, 1.0), 3.0)) * (1.0 - 0.35 * settle);
  float density = (0.12 + 0.88 * (1.0 - pow(1.0 - clamp(age / 0.8, 0.0, 1.0), 2.0))) * (1.0 - 0.5 * settle);
  float k0 = floor(theta / 6.2832 * N);
  float cov = 0.0;
  float tone = 1.0;
  for (int j = -1; j <= 1; j++) {
    float k = mod(k0 + float(j), N);
    float hk = hash12(vec2(k, 3.0 + uSeed));
    if (hk > density) continue;
    float phi = (k + 0.5 + (hash12(vec2(k, 9.0)) - 0.5) * 0.7) / N * 6.2832;
    vec2 dir = vec2(cos(phi), sin(phi));
    float breathe = 1.0 + 0.06 * sin(uTime * 2.0 + k);
    float len = uScale * (0.55 + 0.8 * hash12(vec2(k, 17.0))) * grow * breathe;
    float r0 = uScale * 0.1 * hash12(vec2(k, 23.0));
    float s = (dot(d, dir) - r0) / max(len, 1e-5);
    if (s < 0.0 || s > 1.0) continue;
    float across = dot(d, vec2(-dir.y, dir.x));
    float w = uScale * (0.035 + 0.045 * hash12(vec2(k, 31.0))) * pow(sin(3.1416 * s), 0.7);
    float br = vnoise(vec2(s * 7.0 + k * 3.0, across / max(w, 1e-5) * 3.0 + k * 11.0));
    float inside = 1.0 - smoothstep(w - cpx * 0.7, w + cpx * 0.7, abs(across));
    float c = inside * smoothstep(0.18 + 0.4 * s - 0.05, 0.18 + 0.4 * s + 0.05, br);
    if (c > cov) { cov = c; tone = 0.7 + 0.3 * br; }
  }
  vec3 ink = mix(uInk, uAmber, 0.7 + 0.3 * uGrip) * tone;
  float hair = hairline(dP, cpx * 1.3);
  float core = 1.0 - smoothstep(uScale * 0.05, uScale * 0.07, r);
  vec4 strokes = vec4(ink * cov, cov);
  return over(vec4(accent * max(hair, core), max(hair, core)), strokes);
}

vec4 sBurst(vec2 p, float dP, float age) {
  float glow = 0.0;
  float head = 0.0;
  for (int f = 0; f < 5; f++) {
    vec2 tip = uBurst[f].xy;
    float base = atan(uBurst[f].w, uBurst[f].z);
    // A flash where the fingertip let go.
    float flash = (1.0 - smoothstep(0.0, 0.18, age)) * (1.0 - smoothstep(0.0, uScale * 0.09, length(p - tip)));
    glow = max(glow, flash);
    for (int j = 0; j < 18; j++) {
      vec2 id = vec2(float(f) * 19.0 + float(j), uSeed);
      float t = age - 0.12 * hash12(id + 1.0);
      if (t <= 0.0 || t > 1.0) continue;
      float ang = base + (hash12(id + 2.0) - 0.5) * 2.0;
      vec2 dir = vec2(cos(ang), sin(ang));
      float speed = uScale * (1.1 + 1.6 * hash12(id + 3.0));
      float dist = speed * (1.0 - pow(1.0 - t, 2.5)) * 0.85;
      float len = uScale * (0.1 + 0.25 * hash12(id + 4.0)) * (1.0 - t * 0.7);
      vec2 hd = tip + dir * dist;
      vec2 tl = hd - dir * len;
      float w = cpx * (0.5 + 0.9 * hash12(id + 5.0));
      float c = (1.0 - smoothstep(w, w + cpx, segDist(p, tl, hd))) * (1.0 - smoothstep(0.55, 1.0, t));
      glow = max(glow, c);
      head = max(head, c * (1.0 - smoothstep(0.0, uScale * 0.05, length(p - hd))));
    }
  }
  vec3 col = mix(uInk, accent, head);
  float hair = hairline(dP, cpx * 0.6) * 0.8;
  return over(vec4(col * glow, glow), vec4(accent * hair, hair));
}

vec4 sTrail(vec2 p, float dP) {
  float cell = cpx * 4.0;
  vec2 id = floor(p / cell);
  vec2 h = vec2(hash12(id), hash12(id + 7.7));
  vec2 drift = vec2(sin(uTime * 1.3 + h.x * 6.283), cos(uTime * 1.1 + h.y * 6.283)) * 0.15;
  vec2 pos = (id + 0.5 + (h - 0.5) * 0.7 + drift) * cell;
  float near = 1.0 - smoothstep(uBoneR * 0.4, uBoneR * 2.2, dP);
  float spark = 0.0;
  if (hash12(id + 17.0) < near * 0.9) {
    float rad = cpx * (0.5 + 1.1 * near * hash12(id + 5.0));
    spark = (1.0 - smoothstep(rad - cpx * 0.6, rad + cpx * 0.6, length(p - pos))) * (0.55 + 0.45 * sin(uTime * 5.0 + h.x * 40.0));
  }
  float trail = texture2D(uTrail, vUv).r;
  vec4 light = vec4(mix(uInk, accent, 0.3) * spark, spark);
  vec4 streak = vec4(accent * trail * 0.8, trail * 0.8);
  return over(light, streak);
}

vec4 sRipple(vec2 p) {
  float sp = cpx * 9.0;
  vec2 c = (floor(p / sp) + 0.5) * sp;
  vec2 d = c - uPalm;
  float r = length(d);
  float R = uScale * 2.1;
  if (r > R) return vec4(0.0);
  float wave = sin(r / (uScale * 0.22) - uTime * 2.2);
  vec2 off = (r > 1e-5 ? d / r : vec2(0.0)) * wave * cpx * 2.2;
  float inHand = 1.0 - smoothstep(uBoneR * 0.8, uBoneR * 1.6, handD(c));
  float rad = cpx * (0.8 + 0.5 * (wave * 0.5 + 0.5) + 1.2 * inHand);
  float dotC = 1.0 - smoothstep(rad - cpx * 0.6, rad + cpx * 0.6, length(p - c - off));
  float fade = 1.0 - smoothstep(R * 0.55, R, r);
  float a = dotC * fade * mix(0.35 + 0.25 * (wave * 0.5 + 0.5), 0.95, inHand);
  return vec4(mix(uInk, accent, inHand) * a, a);
}

vec4 sGlitch(vec2 p, float age) {
  // Strong at once, then snaps back between 0.5 and 0.7 s.
  float g = smoothstep(0.0, 0.06, age) * (1.0 - smoothstep(0.5, 0.7, age));
  float band = floor(p.y / (cpx * 7.0));
  float tick = floor(uTime * 14.0);
  float shift = (hash12(vec2(band, tick)) - 0.5) * uScale * 0.5 * g * step(0.55, hash12(vec2(band, tick + 0.5)));
  vec2 pg = p + vec2(shift, 0.0);
  float dG = handD(pg);
  vec4 hand = sInk(pg, dG);

  float reach = uScale * 1.5 * (0.6 + 0.4 * g);
  float inZone = 1.0 - smoothstep(reach * 0.6, reach, length(p - uPalm));
  // Dark brush slabs: ragged-ended runs along each band.
  float run = uScale * 0.16;
  float s = floor(pg.x / run + hash12(vec2(band, 1.0)) * 5.0);
  float ragged = vnoise(vec2(pg.x / (cpx * 3.0), band * 1.3));
  float slab = step(hash12(vec2(band, s) + uSeed), 0.32) * step(0.25, ragged) * inZone * g;
  float edge = slab * (1.0 - step(cpx * 1.2, mod(p.y, cpx * 7.0))); // a light top edge
  // Pixel fragments scattering off the hand.
  vec2 cell = floor(p / (cpx * 4.0));
  float frag = step(hash12(cell + tick * 0.37), 0.1 * g) * (1.0 - smoothstep(uScale * 0.15, uScale * 0.6, dG));
  vec4 slabs = vec4(uShade * slab * 0.92 + accent * edge * 0.9, max(slab * 0.92, edge));
  vec4 frags = vec4(mix(uInk, accent, hash12(cell)) * frag, frag);
  return over(frags, over(slabs, hand));
}

vec4 styleAt(vec2 p, float dP, float age) {
#if STYLE == 0
  return sInk(p, dP);
#elif STYLE == 1
  return sBloom(p, dP, age);
#elif STYLE == 2
  return sBurst(p, dP, age);
#elif STYLE == 3
  return sTrail(p, dP);
#elif STYLE == 4
  return sRipple(p);
#else
  return sGlitch(p, age);
#endif
}

void main() {
  cpx = uPx / uRes.y;
  accent = mix(uTeal, uAmber, uGrip);
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  if (uPresence < 0.005 || length(p - uBounds.xy) > uBounds.z) {
    gl_FragColor = vec4(0.0);
    return;
  }
  float dP = handD(p);
  vec4 col = styleAt(p, dP, uAge);

  // A soft dark backdrop under the hand, so the art reads over a busy webcam image.
  float back = 0.34 * exp(-max(dP - uBoneR, 0.0) / (uScale * 0.3));
  col = over(col, vec4(uShade * back, back));

  if (uMix > 0.0) {
    float n = 0.65 * vnoise(p / (cpx * 90.0) + uSeed * 3.17) + 0.35 * vnoise(p / (cpx * 34.0) - uSeed * 1.31);
    float k = 0.08;
    float t = uMix * (1.0 + 2.0 * k) - k;
    float wB = smoothstep(n - k, n + k, t);
    float seam = (1.0 - abs(2.0 * wB - 1.0)) * (1.0 - smoothstep(uBoneR, uBoneR * 4.0, dP)) * 0.6;
    col *= (uPassB > 0.5 ? wB : 1.0 - wB) * (1.0 - seam);
    if (uPassB > 0.5) col += vec4(accent * seam, seam);
  }
  gl_FragColor = col * uPresence;
}
`;

// The recording trail's feedback buffer: last frame, faded and drifting down, plus sparks
// along the hand. Rendered at low resolution into ping-pong targets; the trail style samples it.
export const TRAIL_FRAG = /* glsl */ `
${COMMON}
uniform sampler2D uPrev;
uniform vec2 uFieldRes;
uniform float uDecay;
uniform vec2 uDrift;
uniform float uEmit;

void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  float prev = texture2D(uPrev, vUv + uDrift).r * uDecay;
  float d = handD(p);
  float spark = (1.0 - smoothstep(uBoneR * 0.3, uBoneR * 1.5, d)) * step(0.55, hash12(floor(vUv * uFieldRes) + floor(uTime * 30.0)));
  gl_FragColor = vec4(min(1.0, prev + spark * 0.3 * uEmit), 0.0, 0.0, 1.0);
}
`;
