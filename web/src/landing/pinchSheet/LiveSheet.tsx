// The live cloth: react-three-fiber canvas, one 32 x 20 mesh, pointer and hand input.
//
// Kept light on purpose:
// - DPR is capped at 1.5, and the mesh has 640 vertices.
// - The frame loop is on demand, so it only renders while the cloth moves. A settled sheet costs
//   no frames at all.
// - The shading is a tiny custom shader. A flat sheet shows the print's exact paper colours, and
//   folds darken or lighten with their angle to one soft light. There are no shadows and no tone
//   mapping.

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  CanvasTexture,
  DoubleSide,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  ShaderMaterial,
  Vector3,
  type Mesh,
  type PerspectiveCamera,
  type WebGLRenderer,
} from "three";
import { createCloth, disturb, grab, isSettled, release, setTarget, snapToRest, stepCloth, stepsFor } from "./cloth";
import { clientToNdc, dragTarget, fitDistance, pickParticle, rayFromNdc, type Ray, type Vec3 } from "./picking";
import {
  INITIAL_PINCH_INPUT,
  reducePinchInput,
  type HandPinch,
  type PinchCommand,
  type PinchInputEvent,
  type ScreenPoint,
} from "./pinchInput";
import { drawPrint, PAPER } from "./print";
import { CAMERA_FOV, MAX_PULL, PICK_RADIUS, PINCH_LIFT, SHEET, SHEET_MARGIN } from "./sheetGeometry";

const STEP = 1 / 60;
const TEX_W = 1024;
const TEX_H = 640;

export interface LiveSheetProps {
  hand: HandPinch | null;
  onHoldChange?: (holding: boolean) => void;
  /** Called once the first frame is on screen, so the still print under it can go. */
  onReady?: () => void;
}

export default function LiveSheet({ onReady, ...props }: LiveSheetProps) {
  return (
    <Canvas
      style={{ position: "absolute", inset: 0, touchAction: "none" }}
      dpr={[1, 1.5]}
      flat
      frameloop="demand"
      camera={{ fov: CAMERA_FOV, near: 0.1, far: 50, position: [0, 0, 6] }}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      onCreated={() => requestAnimationFrame(() => requestAnimationFrame(() => onReady?.()))}
    >
      <Sheet {...props} />
    </Canvas>
  );
}

/** The one entrance moment: the sheet arrives with a soft ripple that the cloth smooths out. */
const ripple = (x: number, y: number) => 0.07 * Math.sin(2.4 * x + 1.1 * y + 0.6) * Math.cos(1.7 * y - 0.4 * x);

function Sheet({ hand, onHoldChange }: LiveSheetProps) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);

  const cloth = useMemo(() => {
    const c = createCloth(SHEET);
    disturb(c, ripple);
    return c;
  }, []);
  const geometry = useMemo(() => {
    const g = new PlaneGeometry(SHEET.width, SHEET.height, SHEET.cols - 1, SHEET.rows - 1);
    (g.attributes.position.array as Float32Array).set(cloth.pos);
    g.computeVertexNormals();
    return g;
  }, [cloth]);
  const texture = useMemo(() => makePrintTexture(gl), [gl]);
  const material = useMemo(() => makeClothMaterial(texture), [texture]);
  const ring = useMemo(
    () => ({
      geometry: new RingGeometry(0.03, 0.046, 40),
      material: new MeshBasicMaterial({ color: PAPER.accent, depthTest: false, transparent: true }),
    }),
    [],
  );
  const ringRef = useRef<Mesh>(null);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      texture.dispose();
      ring.geometry.dispose();
      ring.material.dispose();
    },
    [geometry, material, texture, ring],
  );

  // The print's typeface may arrive after the first draw; redraw once fonts are ready.
  useEffect(() => {
    let live = true;
    document.fonts?.ready.then(() => {
      if (!live) return;
      redrawPrint(texture);
      invalidate();
    });
    return () => {
      live = false;
    };
  }, [texture, invalidate]);

  // Fit the resting sheet (plus room to pull) to the box, whatever its shape.
  useEffect(() => {
    if (!(size.width > 0 && size.height > 0)) return;
    camera.position.set(0, 0, fitDistance(CAMERA_FOV, size.width / size.height, SHEET.width, SHEET.height, SHEET_MARGIN));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, size.width, size.height, invalidate]);

  // --- input: pointer + hand -> reducer -> grab / drag / release on the cloth ---
  const input = useRef(INITIAL_PINCH_INPUT);
  const plane = useRef<{ point: Vec3; toward: Vec3 } | null>(null);
  const holding = useRef(false);
  const onHold = useRef(onHoldChange);
  onHold.current = onHoldChange;

  const api = useRef({ dispatch: (_e: PinchInputEvent) => {}, hover: (_p: ScreenPoint) => {} });
  api.current.dispatch = (e: PinchInputEvent) => {
    const r = reducePinchInput(input.current, e);
    input.current = r.state;
    if (r.commands.length) {
      r.commands.forEach(run);
      invalidate();
    }
  };
  api.current.hover = (p: ScreenPoint) => {
    const ray = rayAt(p);
    const over = !!ray && pickParticle(cloth.pos, ray, PICK_RADIUS) >= 0;
    gl.domElement.style.cursor = over ? "grab" : "";
  };

  function rayAt(p: ScreenPoint): Ray | null {
    const ndc = clientToNdc(p, gl.domElement.getBoundingClientRect());
    return ndc ? rayFromNdc(ndc, camera) : null;
  }
  function setHolding(v: boolean) {
    if (holding.current === v) return;
    holding.current = v;
    gl.domElement.style.cursor = v ? "grabbing" : "";
    onHold.current?.(v);
  }
  function aim(ray: Ray) {
    const i = cloth.grabbed;
    if (i < 0 || !plane.current) return;
    const t = dragTarget({
      ray,
      planePoint: plane.current.point,
      towardCamera: plane.current.toward,
      lift: PINCH_LIFT,
      rest: cloth.rest.subarray(i * 3, i * 3 + 3),
      maxPull: MAX_PULL,
    });
    if (t) setTarget(cloth, t);
  }
  function run(c: PinchCommand) {
    if (c.type === "release") {
      release(cloth);
      plane.current = null;
      setHolding(false);
      return;
    }
    const ray = rayAt(c.point);
    if (!ray) return;
    if (c.type === "drag") return aim(ray);
    const i = pickParticle(cloth.pos, ray, PICK_RADIUS);
    if (i < 0) return; // pressed beside the sheet: nothing to hold
    const toward = camera.getWorldDirection(new Vector3()).negate();
    plane.current = { point: [cloth.pos[i * 3], cloth.pos[i * 3 + 1], cloth.pos[i * 3 + 2]], toward: [toward.x, toward.y, toward.z] };
    grab(cloth, i);
    aim(ray);
    setHolding(true);
  }

  useEffect(() => {
    const el = gl.domElement;
    const pt = (e: PointerEvent): ScreenPoint => ({ x: e.clientX, y: e.clientY });
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      el.setPointerCapture?.(e.pointerId);
      api.current.dispatch({ type: "pointerdown", id: e.pointerId, point: pt(e) });
    };
    const move = (e: PointerEvent) => {
      if (input.current.owner === "pointer") api.current.dispatch({ type: "pointermove", id: e.pointerId, point: pt(e) });
      else if (e.pointerType === "mouse" && !holding.current) api.current.hover(pt(e));
    };
    const up = (e: PointerEvent) => api.current.dispatch({ type: "pointerup", id: e.pointerId });
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, [gl]);

  const hx = hand?.point?.x;
  const hy = hand?.point?.y;
  const hp = !!hand?.pinching;
  const hasPoint = hand?.point != null;
  useEffect(() => {
    api.current.dispatch({ type: "hand", hand: hasPoint ? { point: { x: hx!, y: hy! }, pinching: hp } : null });
  }, [hx, hy, hp, hasPoint]);

  useEffect(() => () => void (holding.current && onHold.current?.(false)), []);

  // --- simulation: fixed 60 Hz steps, only while something moves ---
  const carry = useRef(0);
  useFrame((state, delta) => {
    if (cloth.grabbed < 0 && isSettled(cloth)) {
      carry.current = 0;
      return;
    }
    const s = stepsFor(carry.current, delta, STEP);
    carry.current = s.carry;
    for (let k = 0; k < s.steps; k++) stepCloth(cloth, STEP);
    const done = cloth.grabbed < 0 && isSettled(cloth);
    if (done) snapToRest(cloth); // exactly flat, so no faint shading is left behind
    const attr = geometry.attributes.position;
    (attr.array as Float32Array).set(cloth.pos);
    attr.needsUpdate = true;
    geometry.computeVertexNormals();

    const r = ringRef.current;
    if (r) {
      const i = cloth.grabbed;
      r.visible = i >= 0 && !!plane.current;
      if (r.visible && plane.current) {
        const n = plane.current.toward;
        r.position.set(cloth.pos[i * 3] + n[0] * 0.02, cloth.pos[i * 3 + 1] + n[1] * 0.02, cloth.pos[i * 3 + 2] + n[2] * 0.02);
        r.quaternion.copy(state.camera.quaternion);
      }
    }
    if (!done) state.invalidate(); // keep drawing until the cloth has settled
  });

  return (
    <>
      <mesh geometry={geometry} material={material} frustumCulled={false} />
      <mesh ref={ringRef} geometry={ring.geometry} material={ring.material} renderOrder={2} visible={false} />
    </>
  );
}

function makePrintTexture(gl: WebGLRenderer): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const texture = new CanvasTexture(canvas);
  texture.anisotropy = Math.min(4, gl.capabilities.getMaxAnisotropy());
  redrawPrint(texture);
  return texture;
}

function redrawPrint(texture: CanvasTexture) {
  const canvas = texture.image as HTMLCanvasElement;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  drawPrint(ctx, canvas.width, canvas.height);
  texture.needsUpdate = true;
}

/** "#RRGGBB" to 0..1 floats, untouched by colour management (the shader writes them out as-is). */
function rgb(hex: string): Vector3 {
  const n = parseInt(hex.slice(1), 16);
  return new Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormal;
void main() {
  vUv = uv;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// shade = 1 when the cloth faces the viewer (the print's own colours), darker as a fold turns away
// from the light, a touch lighter as it turns toward it. The back of the fabric is plain.
const FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform vec3 light;
uniform float strength;
uniform vec3 back;
varying vec2 vUv;
varying vec3 vNormal;
void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  float shade = 1.0 + strength * (dot(n, light) - light.z);
  vec3 base = gl_FrontFacing ? texture2D(map, vUv).rgb : back;
  gl_FragColor = vec4(base * clamp(shade, 0.6, 1.05), 1.0);
}`;

function makeClothMaterial(map: CanvasTexture): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      map: { value: map },
      light: { value: new Vector3(-0.42, 0.55, 0.72).normalize() },
      strength: { value: 0.9 },
      back: { value: rgb(PAPER.back) },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: DoubleSide,
  });
}
