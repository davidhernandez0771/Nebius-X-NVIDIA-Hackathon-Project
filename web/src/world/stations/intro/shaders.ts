// The opening's shaders, ported from the prototype as they are (site-journey.html). Both clamp the
// point size in the shader (5 px for the logo, 3.5 px for the dust, times the pixel ratio): unclamped
// points near the camera stalled the prototype. The only changes: the logo's distance factor (uDist)
// follows LOGO_SCALE, and the dust column's floor and height are uniforms instead of 0 and 34.

export const logoVert = /* glsl */ `
attribute vec3 aRoof; attribute vec4 aRand;
uniform float uT, uIntro, uTime, uSize, uPR, uDist; uniform vec3 uColA, uColB, uColC;
varying vec3 vC; varying float vA;
void main(){
  vec3 scatter = (aRand.yzw - .5) * vec3(44., 30., 22.);
  float ie = clamp((uIntro - aRand.x * .45) / .55, 0., 1.); ie = ie * ie * (3. - 2. * ie);
  vec3 p = mix(scatter, position, ie);
  float d = clamp((uT - aRand.x * .3) / .7, 0., 1.); d = d * d * (3. - 2. * d);
  vec3 q = mix(p, aRoof, d);
  float arc = sin(d * 3.14159);
  q += vec3(aRand.y - .5, .5 + aRand.z, aRand.w - .5) * arc * 5.5;
  float t = uTime * .6 + aRand.x * 30.;
  q += vec3(sin(t * 1.3 + aRand.y * 9.), cos(t * 1.1 + aRand.z * 9.), sin(t * .9 + aRand.w * 9.)) * (.035 + .25 * (1. - ie));
  vec4 mv = modelViewMatrix * vec4(q, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(uSize * uPR * (.45 + aRand.y) * (uDist / max(.5, -mv.z)), 5. * uPR);
  vC = mix(mix(uColA, uColB, smoothstep(.2, .9, aRand.z * .7 + d * .6)), uColC, step(.965, aRand.w));
  vA = (.16 + .36 * aRand.w) * (.25 + .75 * ie) * (1. + arc * .7) * (1. - .35 * d);
}`;

export const logoFrag = /* glsl */ `
varying vec3 vC; varying float vA;
void main(){
  vec2 c = gl_PointCoord - .5; float r = dot(c, c) * 4.;
  if (r > 1.) discard;
  float a = (1. - r); a *= a;
  gl_FragColor = vec4(vC, a * vA);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export const dustVert = /* glsl */ `
attribute vec4 aRand; uniform float uTime, uPR, uMix, uSize, uY0, uH; uniform vec3 uHigh, uLow, uWarm;
varying vec3 vC; varying float vA;
void main(){
  vec3 p = position;
  p.y = uY0 + mod(p.y - uY0 + uTime * (.12 + aRand.x * .3), uH);
  p.x += sin(uTime * .21 + aRand.y * 20.) * .6; p.z += cos(uTime * .17 + aRand.z * 20.) * .6;
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(uSize * uPR * (.3 + aRand.w * 1.2) * (30. / max(.5, -mv.z)), 3.5 * uPR);
  vec3 low = mix(uLow, uWarm, step(.8, aRand.z));
  vC = mix(low, uHigh, smoothstep(uY0 + 8., uY0 + uH - 8., p.y) * (1. - uMix * .6));
  vA = (.12 + .3 * aRand.y);
}`;

export const dustFrag = /* glsl */ `
varying vec3 vC; varying float vA;
void main(){ vec2 c = gl_PointCoord - .5; float r = dot(c, c) * 4.; if (r > 1.) discard; float a = 1. - r;
  gl_FragColor = vec4(vC, a * a * vA);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** The prototype's logo point size per tier (fewer points get bigger ones). */
export const logoPointSize = (n: number) => (n > 100000 ? 0.85 : n > 40000 ? 1.05 : 1.7);
