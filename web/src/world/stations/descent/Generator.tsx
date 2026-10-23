// The transition's particles (generatorPlan.ts): one Points draw. Over the descent THE RING (the reactor's
// top ring, lifted off the core: stations/intro) bursts into a cloud that fills the shaft round the
// camera as it dives through, then every particle streams down onto its point of the
// workshop, sampled from the baked GLBs with the colour of the atlas there (the machine from
// machine_v2.glb with its surfaces' colours, scene/machineV2.ts), and the cartridges on the spiral and the
// shelves as boxes. The room is a glittering sculpture before it is a room. As the
// workshop's travel materializes the real surfaces (scene/dissolve.ts), each particle fades exactly
// where its surface appears: the shader evaluates the same field at its target. Off with reduced motion
// (the room fades in behind the veil instead).
import { useEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { ambient } from "../../core/activity";
import type { QualityTier } from "../../core/quality";
import type { StationFrame } from "../../core/types";
import { MACHINE_ANCHOR } from "../../core/layout";
import { BAKED, MACHINE_V2_URL, bakedUrl, type BakedName } from "../../scene/assets";
import { DISSOLVE_EDGE, DISSOLVE_GLSL, dissolve, FIELD_MAX } from "../../scene/dissolve";
import { HELIX, LIBRARY, type Slot } from "../../scene/layout";
import { cutBakedBody, machineV2Points, splitMachineV2, surfaceArea } from "../../scene/machineV2";
import { RING_TUBE, THE_RING } from "../intro/layout";
import { seeded } from "../intro/particles";
import { burstPoints, POINTS, SHARES, sampleBox, sampleTriangles, splitBudget, type Piece } from "./generatorPlan";

const vert = /* glsl */ `
attribute vec3 aStart; attribute vec3 aMid; attribute vec3 aColor; attribute vec4 aRand;
uniform float uP, uTime, uReveal, uPR, uSize;
uniform vec3 uTeal, uWhite;
varying vec3 vC; varying float vA;
${DISSOLVE_GLSL}
void main(){
  float r1 = aRand.x, r2 = aRand.y;
  // generatorPlan.ts burstAt / convergeAt
  float e1 = smoothstep(.02 + .05 * r1, .22 + .1 * r1, uP);
  float h = clamp((position.y + .6) / 15., 0., 1.);
  float c = .55 * r2 + .45 * h;
  float e2 = smoothstep(.34 + .32 * c, .62 + .32 * c, uP);
  vec3 p = mix(aStart, aMid, e1);
  float t = uTime * .5 + r1 * 40.;
  p += vec3(sin(t * 1.3 + aRand.z * 9.), cos(t * 1.1 + aRand.w * 9.), sin(t * .9 + r2 * 9.)) * (.7 * e1 * (1. - e2));
  vec3 q = mix(p, position, e2);
  // Each one arcs as it streams in, and keeps a faint shimmer once it has landed.
  q.y += sin(e2 * 3.14159) * (1.2 + 3. * aRand.z);
  q += (vec3(aRand.z, aRand.w, r1) - .5) * .035 * sin(uTime * 2. + r2 * 60.);
  vec4 mv = modelViewMatrix * vec4(q, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(uSize * uPR * (.55 + aRand.w * .9) * (30. / max(.5, -mv.z)), 3.2 * uPR);
  // Landed, each takes its surface's colour, lifted: the baked atlas is lit for a dark room.
  vC = mix(mix(uTeal, uWhite, step(.86, aRand.w)), aColor * 2.4 + uTeal * .07, e2);
  float twinkle = .55 + .45 * pow(max(.5 + .5 * sin(uTime * (1.5 + 3. * aRand.z) + aRand.w * 80.), 0.), 4.);
  float born = smoothstep(0., .025, uP);
  float f = dField(position);
  float gone = smoothstep(f - .01, f + .02, uReveal);
  vA = born * (1. - gone) * twinkle * (.5 + .5 * aRand.y) * (1. + .5 * sin(e2 * 3.14159));
}`;

const frag = /* glsl */ `
varying vec3 vC; varying float vA;
void main(){
  vec2 c = gl_PointCoord - .5; float r = dot(c, c) * 4.;
  if (r > 1.) discard;
  float a = 1. - r;
  gl_FragColor = vec4(vC, a * a * vA);
  #include <colorspace_fragment>
}`;

/** An atlas, shrunk once into a small canvas, read by uv (glTF textures aren't flipped). */
function atlasReader(map: THREE.Texture | null | undefined): (u: number, v: number, out: THREE.Color) => void {
  const S = 128;
  let data: Uint8ClampedArray | null = null;
  const img = map?.image as CanvasImageSource | undefined;
  try {
    if (img && typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = c.height = S;
      const g = c.getContext("2d", { willReadFrequently: true });
      if (g) {
        g.drawImage(img, 0, 0, S, S);
        data = g.getImageData(0, 0, S, S).data;
      }
    }
  } catch {
    data = null;
  }
  return (u, v, out) => {
    if (!data) {
      out.setRGB(0.32, 0.36, 0.36, THREE.SRGBColorSpace);
      return;
    }
    const x = Math.min(S - 1, Math.max(0, Math.floor(u * S)));
    const y = Math.min(S - 1, Math.max(0, Math.floor(v * S)));
    const k = (y * S + x) * 4;
    out.setRGB(data[k] / 255, data[k + 1] / 255, data[k + 2] / 255, THREE.SRGBColorSpace);
  };
}

/** The cartridges as boxes: half sizes of a cartridge standing up (Ribbon.tsx's HALF_W / HALF_H). */
const CART_HALF: [number, number, number] = [0.62, 1.25, 0.22];
const GRAPHITE = new THREE.Color().setRGB(0.1, 0.11, 0.12, THREE.SRGBColorSpace);
const BONE = new THREE.Color().setRGB(0.86, 0.85, 0.8, THREE.SRGBColorSpace);

function boxes(slots: readonly Slot[], n: number, rnd: () => number, shell: (i: number) => THREE.Color | null) {
  const position = new Float32Array(n * 3);
  const color = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const k = Math.floor(rnd() * slots.length);
    const s = slots[k];
    const half: [number, number, number] = [CART_HALF[0] * s.scale, CART_HALF[1] * s.scale, CART_HALF[2] * s.scale];
    position.set(sampleBox(s.position, s.quaternion, half, 1, rnd), i * 3);
    // The shell's colour, with the paper label on about a third of it.
    c.copy(rnd() < 0.34 ? BONE : (shell(k) ?? GRAPHITE));
    color.set([c.r, c.g, c.b], i * 3);
  }
  return { position, color };
}

interface Buffers {
  geometry: THREE.BufferGeometry;
}

function build(scenes: Record<BakedName, THREE.Object3D>, machine: THREE.Object3D, n: number): Buffers {
  const rnd = seeded(23);
  const counts = splitBudget(n, SHARES);
  const target = new Float32Array(n * 3);
  const color = new Float32Array(n * 3);
  let at = 0;
  const c = new THREE.Color();
  const v = new THREE.Vector3();

  /** count points over a baked mesh (geometry g, in its own frame), coloured from its atlas. */
  const sampleBaked = (mesh: THREE.Mesh, g: THREE.BufferGeometry, count: number) => {
    const s = sampleTriangles(
      { position: g.attributes.position.array, index: g.index ? g.index.array : null, uv: g.attributes.uv ? g.attributes.uv.array : null },
      count,
      rnd,
    );
    const read = atlasReader((mesh.material as THREE.MeshStandardMaterial).map);
    for (let i = 0; i < count; i++, at++) {
      v.fromArray(s.position, i * 3).applyMatrix4(mesh.matrixWorld);
      target.set([v.x, v.y, v.z], at * 3);
      read(s.uv[i * 2], s.uv[i * 2 + 1], c);
      color.set([c.r, c.g, c.b], at * 3);
    }
  };

  for (const name of BAKED) {
    const count = counts[name as Piece];
    const root = scenes[name];
    root.updateMatrixWorld(true);
    const mesh = root.getObjectByName(`baked_${name}`) as THREE.Mesh | undefined;
    if (!mesh || !count) continue;
    const g = mesh.geometry as THREE.BufferGeometry;
    if (name !== "machine_body") {
      sampleBaked(mesh, g, count);
      continue;
    }
    // The machine is machine_v2 now (scene/machineV2.ts): its own surfaces, plus what the room keeps of
    // the baked body (the cable and plug), each its share of the points by area.
    const parts = splitMachineV2(machine);
    const cable = cutBakedBody(g);
    const area = [parts.body, parts.glow, parts.slot, parts.lens, ...parts.fans.flatMap((f) => [f.body, f.mark])].reduce((s, x) => s + surfaceArea(x), 0);
    const cableN = Math.round((count * surfaceArea(cable)) / (surfaceArea(cable) + area));
    sampleBaked(mesh, cable, cableN);
    const pts = machineV2Points(parts, count - cableN, rnd);
    const anchor = new THREE.Vector3(...MACHINE_ANCHOR);
    for (let i = 0; i < count - cableN; i++, at++) {
      v.fromArray(pts.position, i * 3).add(anchor);
      target.set([v.x, v.y, v.z], at * 3);
      color.set([pts.color[i * 3], pts.color[i * 3 + 1], pts.color[i * 3 + 2]], at * 3);
    }
    cable.dispose();
    [parts.body, parts.glow, parts.slot, parts.lens, ...parts.fans.flatMap((f) => [f.body, f.mark])].forEach((x) => x.dispose());
  }
  const shells = HELIX.map((h) => (h.shell ? new THREE.Color(h.shell[0], h.shell[1], h.shell[2]) : null));
  for (const [slots, count, shell] of [
    [HELIX, counts.helix, (k: number) => shells[k]],
    [LIBRARY, counts.library, () => null],
  ] as const) {
    const b = boxes(slots, count, rnd, shell);
    target.set(b.position, at * 3);
    color.set(b.color, at * 3);
    at += count;
  }
  // A piece whose mesh is missing leaves its share unused.
  const used = at;

  // Start on THE RING (its surface), burst round it and down the shaft into the cloud.
  const { start, mid } = burstPoints(used, THE_RING, RING_TUBE, rnd);
  const rand = new Float32Array(used * 4);
  for (let i = 0; i < used; i++) rand.set([rnd(), rnd(), rnd(), rnd()], i * 4);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(target.subarray(0, used * 3), 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(color.subarray(0, used * 3), 3));
  geometry.setAttribute("aStart", new THREE.BufferAttribute(start, 3));
  geometry.setAttribute("aMid", new THREE.BufferAttribute(mid, 3));
  geometry.setAttribute("aRand", new THREE.BufferAttribute(rand, 4));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 26, 10), 70);
  return { geometry };
}

export function Generator({ frame, quality, reduced }: { frame: StationFrame; quality: QualityTier; reduced: boolean }) {
  const gltfs = useGLTF(BAKED.map(bakedUrl), false) as unknown as { scene: THREE.Object3D }[];
  const machine = useGLTF(MACHINE_V2_URL, false);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const n = POINTS[quality.name];
  const points = useMemo(() => {
    const scenes = Object.fromEntries(BAKED.map((name, i) => [name, gltfs[i].scene])) as Record<BakedName, THREE.Object3D>;
    const { geometry } = build(scenes, machine.scene, n);
    const material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uP: { value: 0 },
        uTime: { value: 0 },
        uReveal: dissolve.reveal,
        uPR: { value: 1 },
        // Fewer points draw a little bigger, so the low tier's room still reads.
        uSize: { value: n < 50000 ? 3 : 2 },
        uTeal: { value: new THREE.Color("#19f5c2") },
        uWhite: { value: new THREE.Color("#eafffa") },
      },
    });
    const p = new THREE.Points(geometry, material);
    p.name = "descent:generator";
    p.frustumCulled = false;
    p.raycast = () => {};
    p.visible = false;
    return p;
  }, [gltfs, machine, n]);
  useEffect(
    () => () => {
      points.geometry.dispose();
      points.material.dispose();
    },
    [points],
  );

  useFrame(({ clock }) => {
    const u = points.material.uniforms;
    const p = frame.t;
    u.uP.value = p;
    u.uTime.value = clock.elapsedTime;
    u.uPR.value = gl.getPixelRatio();
    // Drawn from the burst until the room has taken over every particle.
    points.visible = !reduced && p > 0.001 && dissolve.reveal.value < FIELD_MAX + DISSOLVE_EDGE + 0.02;
    if (points.visible && quality.idleMotion) ambient(invalidate);
  });

  return <primitive object={points} />;
}
