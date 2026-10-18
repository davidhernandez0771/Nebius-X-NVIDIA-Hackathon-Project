// GLSL for the two passes. Written for three.js ShaderMaterial (GLSL ES 1.0 style;
// three translates it for WebGL2).
//
// Pass 1, FIELD_FRAG, draws the skeleton into a low-res offscreen target:
//   r = bone/joint coverage, g = glow falloff, b = thin lines + joint rings, a = nearness (z).
// Pass 2, POST_FRAG, turns that field into one of five styles, or a noise-masked
// morph between two of them, on a transparent background.

export const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const FIELD_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec4 uJoints[21]; // x, y, radius, z
uniform vec4 uBones[21];  // ax, ay, bx, by
uniform float uAspect;
uniform float uBoneR;

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  float dBone = 1e3;
  for (int i = 0; i < 21; i++) dBone = min(dBone, segDist(p, uBones[i].xy, uBones[i].zw));

  float dJoint = 1e3;
  float dRing = 1e3;
  float zNear = 0.0;
  for (int i = 0; i < 21; i++) {
    float len = length(p - uJoints[i].xy);
    float d = len - uJoints[i].z;
    dRing = min(dRing, abs(len - uJoints[i].z * 0.8));
    if (d < dJoint) { dJoint = d; zNear = uJoints[i].w; }
  }

  float aa = uBoneR * 0.35;
  float bone = 1.0 - smoothstep(uBoneR - aa, uBoneR + aa, dBone);
  float joint = 1.0 - smoothstep(-aa, aa, dJoint);
  float edge = max(min(dBone - uBoneR, dJoint), 0.0);
  float glow = exp(-edge / (uBoneR * 1.6));
  float w = uBoneR * 0.22;
  float thin = 1.0 - smoothstep(w - aa * 0.4, w + aa * 0.4, min(dBone, dRing));
  float near = clamp(0.5 - zNear * 4.0, 0.0, 1.0);
  gl_FragColor = vec4(max(bone, joint), glow, thin, near);
}
`;

export const POST_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uField;
uniform vec2 uRes;        // drawing-buffer pixels
uniform float uPx;        // pixel ratio: style sizes are in CSS pixels
uniform float uTime;      // seconds; frozen under reduced motion
uniform int uStyleA;
uniform int uStyleB;
uniform float uMix;
uniform float uSeed;
uniform float uGrip;      // 0 open .. 1 closed, eased
uniform float uPresence;  // 0 no hand .. 1 hand, eased
uniform vec3 uTeal;
uniform vec3 uAmber;
uniform vec3 uViolet;

vec4 field(vec2 px) { return texture2D(uField, px / uRes); }

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

float box(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// Textmode: a ramp of eight marks drawn from shapes, darkest to densest. No font.
float mark(float lv, vec2 p, float aa) {
  float w = 0.09;
  float d = 1e3;
  if (lv < 0.5) return 0.0;
  else if (lv < 1.5) d = length(p) - 0.14;
  else if (lv < 2.5) d = box(p, vec2(0.5, w));
  else if (lv < 3.5) d = min(box(p, vec2(0.55, w)), box(p, vec2(w, 0.55)));
  else if (lv < 4.5) {
    vec2 q = vec2(p.x + p.y, p.x - p.y) * 0.7071;
    d = min(box(q, vec2(0.7, w)), box(q, vec2(w, 0.7)));
  }
  else if (lv < 5.5) d = abs(length(p) - 0.48) - w;
  else if (lv < 6.5) d = min(box(vec2(p.x, abs(p.y) - 0.28), vec2(0.62, w)), box(vec2(abs(p.x) - 0.28, p.y), vec2(w, 0.62)));
  else d = box(p, vec2(0.6));
  return 1.0 - smoothstep(-aa, aa, d);
}

vec2 sAscii(vec2 px) {
  float cell = 9.0 * uPx;
  vec2 id = floor(px / cell);
  vec4 f = field((id + 0.5) * cell);
  float v = clamp(f.r * 0.85 + f.g * 0.5, 0.0, 1.0);
  float lv = floor(clamp(v - hash12(id * 1.7 + 4.0) * 0.3, 0.0, 1.0) * 7.99); // mixed marks, not a solid core
  if (lv > 0.5 && hash12(id + floor(uTime * 5.0)) > 0.94) lv = min(lv + 1.0, 7.0); // live shimmer
  vec2 local = fract(px / cell) * 2.0 - 1.0;
  return vec2(mark(lv, local, 3.0 / cell), 0.0);
}

float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

vec2 sBayer(vec2 px) {
  float block = 2.0 * uPx;
  vec2 q = floor(px / block);
  vec4 f = field((q + 0.5) * block);
  float v = clamp(f.r * 0.5 + f.g * 0.38, 0.0, 1.0);
  return vec2(step(bayer8(q) + 0.03, v), 0.0);
}

vec2 sHalftone(vec2 px) {
  float sp = 7.0 * uPx;
  float c = cos(0.42);
  float s = sin(0.42);
  vec2 r = mat2(c, -s, s, c) * px;
  vec2 cr = (floor(r / sp) + 0.5) * sp;
  vec4 f = field(mat2(c, s, -s, c) * cr);
  float v = clamp(f.r * 0.8 + f.g * 0.65, 0.0, 1.0);
  float d = length(r - cr) - sqrt(v) * sp * 0.62;
  return vec2(v > 0.04 ? 1.0 - smoothstep(-0.75 * uPx, 0.75 * uPx, d) : 0.0, 0.0);
}

vec2 sParticles(vec2 px) {
  float sp = 6.0 * uPx;
  vec2 id = floor(px / sp);
  vec2 h = hash22(id);
  vec2 drift = vec2(sin(uTime * 1.3 + h.x * 6.283), cos(uTime * 1.1 + h.y * 6.283)) * 0.14;
  vec2 pos = (id + 0.5 + (h - 0.5) * 0.7 + drift) * sp;
  vec4 f = field(pos);
  float v = clamp(f.r * 0.6 + f.g * 0.8, 0.0, 1.0);
  if (hash12(id + 17.0) > v * 1.15) return vec2(0.0);
  float rad = (0.55 + 1.5 * v) * uPx;
  float cov = 1.0 - smoothstep(rad - 0.7 * uPx, rad + 0.7 * uPx, length(px - pos));
  cov *= 0.6 + 0.4 * sin(uTime * 4.0 + h.x * 40.0);
  return vec2(cov, hash12(id + 3.7) < 0.12 ? 1.0 : 0.0);
}

vec2 sLines(vec2 px) {
  vec4 f = field(px);
  float glow = f.g * f.g * 0.38;
  float body = f.r * 0.1;
  float scan = 0.85 + 0.15 * sin(px.y / uPx * 0.9 - uTime * 6.0); // a faint travelling sheen
  return vec2(clamp(f.b + (glow + body) * scan, 0.0, 1.0), 0.0);
}

vec2 styleAt(int s, vec2 px) {
  if (s == 0) return sAscii(px);
  if (s == 1) return sBayer(px);
  if (s == 2) return sHalftone(px);
  if (s == 3) return sParticles(px);
  return sLines(px);
}

void main() {
  vec2 px = vUv * uRes;
  vec2 a = styleAt(uStyleA, px);
  vec2 b = a;
  float wB = 0.0;
  float seam = 0.0;
  if (uMix > 0.0) {
    b = styleAt(uStyleB, px);
    float n = 0.65 * vnoise(px / (90.0 * uPx) + uSeed * 3.17) + 0.35 * vnoise(px / (34.0 * uPx) - uSeed * 1.31);
    float k = 0.08;
    float t = uMix * (1.0 + 2.0 * k) - k;
    wB = smoothstep(n - k, n + k, t);
    seam = 1.0 - abs(2.0 * wB - 1.0);
  }
  vec4 f = field(px);
  float cov = mix(a.x, b.x, wB);
  float accent = mix(a.y, b.y, wB);
  float seamCov = seam * smoothstep(0.05, 0.6, f.g);
  vec3 ink = mix(uTeal, uAmber, uGrip) * (0.82 + 0.3 * f.a);
  vec3 col = mix(ink, uViolet, clamp(accent + seam, 0.0, 1.0));
  float alpha = clamp(max(cov, seamCov * 0.9), 0.0, 1.0) * uPresence;
  gl_FragColor = vec4(min(col, vec3(1.0)) * alpha, alpha);
}
`;
