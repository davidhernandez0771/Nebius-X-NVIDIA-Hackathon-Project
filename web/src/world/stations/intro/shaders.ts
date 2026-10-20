// The opening's shaders. The dust is the prototype's (site-journey.html), its point size clamped in
// the shader (3.5 px times the pixel ratio: unclamped points near the camera stalled the prototype),
// with the column's floor and height as uniforms. The backdrop is the dark space round the glass logo.

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


/** The dark space: a sphere round the logo, seen from inside. */
export const backdropVert = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
}`;

/**
 * Near-black with a little lift toward the top, the teal light leak up and to the left (Active
 * Theory's corner glow), and a faint glow behind the logo: transmission only refracts what is drawn
 * opaque behind the glass, so this is what it carries (its bright edges come from the studio's reflections).
 */
export const backdropFrag = /* glsl */ `
uniform float uDim; uniform vec3 uBase, uLeak;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  vec3 c = uBase * (.65 + .55 * smoothstep(-.6, .9, d.y));
  c += uLeak * pow(max(0., dot(d, normalize(vec3(-.7, .55, .45)))), 7.) * .35;
  // A soft glow straight behind the logo, so the glass always has some light to carry.
  c += uLeak * .006 * smoothstep(.96, 1., -d.z);
  gl_FragColor = vec4(c * (1. - uDim), 1.);
  #include <colorspace_fragment>
}`;
