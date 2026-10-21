// The robot wall: the side walls' shelves, holding robots and robot parts instead of the old library of
// cartridge spines (wallPlan.ts places them, wallParts.ts builds them). The robots are their makers'
// published meshes (robotModels.ts), loaded after the room; until they are in, the shelves show their
// plinths. One merged mesh for both walls and one additive mesh for the light pools behind the items:
// two draw calls, as the library had. The low tier leaves the three extra robots out and uses lighter parts.
//
// Lit like a museum wall: each item has a picture light under the board above it, a cone of warm light
// computed in the shader from the vertex's `aSpot` (it follows the lamps), plus the room's live lights.
// In the room view a click on either wall opens the robots view (stations/robots); there the robot
// under the pointer (or the catalog entry with focus, hot.ts) lights up teal, and a click picks it.
// The click targets are invisible boxes: drawn by nobody, raycast by r3f.
import { useEffect, useMemo, useRef, useState } from "react";
import { Html } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { inHub } from "../core/CameraRig";
import type { QualityTier } from "../core/quality";
import { useWorld } from "../core/WorldContext";
import { CATALOG } from "../stations/robots/catalog";
import { hotNumber, robotsView } from "../stations/robots/hot";
import { ROBOT_WALL } from "./assets";
import { addGlow, loadProgress, markLoaded, power } from "./power";
import { MODEL_IDS, loadRobotModel } from "./robotModels";
import { PART_MAX_TRIS, PART_MAX_TRIS_LOW, buildPools, buildWall, wallModels, type WallModels } from "./wallParts";
import { BOARDS, EXTRA_ROBOTS, ITEM_SIZE, WALL, robotSpot, wallPlan } from "./wallPlan";

/** The picture lights at full power (added to the diffuse colour under each cone). */
const SPOT = 1.6;
const HOT = new THREE.Color("#19f5c2");

const WALL_GLSL_V = /* glsl */ `
attribute vec4 aSpot;
varying vec4 vSpot;
varying vec3 vWallP;
varying vec3 vWallN;
`;
const WALL_GLSL_F = /* glsl */ `
uniform float uSpot, uHot, uHotLevel;
uniform vec3 uHotColor;
varying vec4 vSpot;
varying vec3 vWallP;
varying vec3 vWallN;
`;

/** The picture lights and the highlight, added to a built-in lit material (Lambert or Standard). */
export function wallMaterial(m: THREE.Material, uniforms: Record<string, THREE.IUniform>): THREE.Material {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\n${WALL_GLSL_V}`)
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
  vSpot = aSpot;
  vWallP = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vWallN = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>\n${WALL_GLSL_F}`).replace(
      "#include <opaque_fragment>",
      `{
    vec3 toL = vSpot.xyz - vWallP;
    float dl = length(toL);
    vec3 L = toL / dl;
    // The cone points down and back toward the wall (the light is out over the room).
    vec3 axis = normalize(vec3(sign(vSpot.x) * 0.55, -1.0, 0.0));
    float cone = smoothstep(0.78, 0.95, dot(-L, axis));
    vec3 N = normalize(vWallN);
    float ndl = max(dot(N, L), 0.0);
    float hot = step(0.5, uHot) * (1.0 - step(0.5, abs(vSpot.w - uHot))) * uHotLevel;
    outgoingLight += diffuseColor.rgb * uSpot * cone * ndl * (1.0 + hot * 0.6) / (1.0 + 0.05 * dl * dl);
    float rim = pow(1.0 - max(dot(N, normalize(cameraPosition - vWallP)), 0.0), 2.0);
    outgoingLight += uHotColor * hot * (0.1 + 0.7 * rim);
  }
  #include <opaque_fragment>`,
    );
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${key()}|robot-wall`;
  return m;
}

/** A soft round pool: white in the middle, nothing at the edge (the quads' uv 0–1). */
function poolTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  if (g) {
    const r = g.createRadialGradient(64, 52, 4, 64, 64, 64);
    r.addColorStop(0, "rgba(255,255,255,1)");
    r.addColorStop(0.45, "rgba(255,255,255,0.35)");
    r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The robot spots' click boxes and name badges, in world coordinates. */
const SPOTS = CATALOG.map((r) => ({ id: r.id, name: r.name, ...robotSpot(r.id) }));

export function RobotWall({ quality, reduced }: { quality: QualityTier; reduced: boolean }) {
  const { store, goTo } = useWorld();
  const invalidate = useThree((s) => s.invalidate);
  const low = quality.name === "low";
  const plan = useMemo(() => wallPlan({ extras: !low }), [low]);
  const [models, setModels] = useState<WallModels | null>(null);

  // The robots' models (0.25–0.76 MB each; the low tier skips the extras'): fetched once the room's own
  // models are in (or after 15 s), so they never hold up the first view. A model that fails leaves its
  // plinth empty; the others still stand.
  useEffect(() => {
    let live = true;
    const ids = MODEL_IDS.filter((id) => !low || !(EXTRA_ROBOTS as readonly string[]).includes(id));
    const started = performance.now();
    let timer = 0;
    const load = () => {
      Promise.allSettled(ids.map((id) => loadRobotModel(id))).then((res) => {
        const got: Record<string, THREE.BufferGeometry> = {};
        res.forEach((r, i) => {
          if (r.status === "fulfilled") got[ids[i]] = r.value;
          else console.warn(`world: the ${ids[i]} model didn't load for the robot wall`, r.reason);
        });
        const built = live ? wallModels(got, low ? PART_MAX_TRIS_LOW : PART_MAX_TRIS) : null;
        Object.values(got).forEach((g) => g.dispose());
        if (built) setModels(built);
      });
    };
    const wait = () => {
      if (!live) return;
      if (loadProgress() >= 1 || performance.now() - started > 15000) load();
      else timer = window.setTimeout(wait, 250);
    };
    wait();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [low]);
  useEffect(
    () => () => {
      if (!models) return;
      Object.values(models.robots).forEach((g) => g?.dispose());
      models.pieces.forEach((g) => g.dispose());
    },
    [models],
  );

  const geometry = useMemo(() => buildWall(plan, models), [plan, models]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const pools = useMemo(() => buildPools(plan), [plan]);
  useEffect(() => () => pools.dispose(), [pools]);

  const uniforms = useMemo(
    () => ({ uSpot: { value: 0 }, uHot: { value: 0 }, uHotLevel: { value: 0 }, uHotColor: { value: HOT.clone() } }),
    [],
  );
  const material = useMemo(() => {
    const base =
      quality.name === "low"
        ? new THREE.MeshLambertMaterial({ vertexColors: true })
        : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.12 });
    return wallMaterial(base, uniforms);
  }, [quality, uniforms]);
  useEffect(() => () => material.dispose(), [material]);

  const poolMat = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    return m;
  }, []);
  useEffect(() => {
    const off = addGlow(poolMat, "#ffe2bd");
    return () => {
      off();
      poolMat.map?.dispose();
      poolMat.dispose();
    };
  }, [poolMat]);

  useEffect(() => {
    markLoaded(ROBOT_WALL);
    invalidate();
  }, [geometry, invalidate]);

  // The highlight follows hot.ts; a frame when it changes.
  useEffect(() => robotsView.subscribe(() => invalidate()), [invalidate]);
  useFrame((_, delta) => {
    uniforms.uSpot.value = SPOT * power.level;
    const want = hotNumber(robotsView.get().hot);
    if (want !== 0) uniforms.uHot.value = want;
    const target = want !== 0 ? 1 : 0;
    const lvl = uniforms.uHotLevel;
    if (reduced) lvl.value = target;
    else if (lvl.value !== target) {
      lvl.value += (target - lvl.value) * (1 - Math.exp(-10 * Math.min(delta, 1 / 30)));
      if (Math.abs(target - lvl.value) < 0.01) lvl.value = target;
      else invalidate();
    }
    if (lvl.value === 0) uniforms.uHot.value = 0;
  });

  // The robots view's name badges show only there (written on the DOM, never through React per frame).
  const badges = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    let shown = false;
    return store.onFrame(() => {
      const on = store.getCoarse().branch === "robots";
      if (on === shown) return;
      shown = on;
      badges.current.forEach((el) => el && (el.dataset.on = String(on)));
    });
  }, [store]);
  useEffect(
    () =>
      robotsView.subscribe(() => {
        const hot = robotsView.get().hot;
        badges.current.forEach((el, i) => el && (el.dataset.hot = String(SPOTS[i].id === hot)));
      }),
    [],
  );

  const inView = () => store.getCoarse().branch === "robots";
  const wallHit = {
    onClick: (e: ThreeEvent<MouseEvent>) => {
      if (!inHub(store)) return;
      e.stopPropagation();
      goTo("robots");
    },
    onPointerOver: () => {
      if (inHub(store)) document.body.style.cursor = "pointer";
    },
    onPointerOut: () => {
      document.body.style.cursor = "";
    },
  };
  const robotHit = (id: string) => ({
    onClick: (e: ThreeEvent<MouseEvent>) => {
      if (!inView()) return;
      e.stopPropagation();
      robotsView.pick(id);
    },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      if (!inView()) return;
      e.stopPropagation();
      robotsView.setHot(id);
      document.body.style.cursor = "pointer";
    },
    onPointerOut: () => {
      if (robotsView.get().hot === id) robotsView.setHot(null);
      document.body.style.cursor = "";
    },
  });

  const wallMid = (WALL.inner + WALL.outer) / 2;
  const span = WALL.z[1] - WALL.z[0];
  const top = BOARDS[2] + 3;
  const size = ITEM_SIZE.robot;
  return (
    <group name="robot-wall">
      <mesh geometry={geometry} material={material} raycast={() => null} matrixAutoUpdate={false} />
      <mesh geometry={pools} material={poolMat} raycast={() => null} matrixAutoUpdate={false} renderOrder={1} />
      {([-1, 1] as const).map((side) => (
        <mesh key={side} visible={false} position={[side * wallMid, (BOARDS[0] + top) / 2, (WALL.z[0] + WALL.z[1]) / 2]} {...wallHit}>
          <boxGeometry args={[WALL.outer - WALL.inner, top - BOARDS[0], span]} />
        </mesh>
      ))}
      {SPOTS.map((s, i) => (
        <group key={s.id} position={s.position as [number, number, number]}>
          <mesh visible={false} position={[0, size.height / 2 + 0.1, 0]} {...robotHit(s.id)}>
            <boxGeometry args={[size.depth, size.height + 0.2, size.width]} />
          </mesh>
          <Html position={[0.9, -0.25, 0]} center zIndexRange={[18, 10]}>
            <div ref={(el) => (badges.current[i] = el)} className="world-robotbadge" data-on="false" data-hot="false" aria-hidden="true">
              <span>{String(i + 1).padStart(2, "0")}</span>
              <b>{s.name}</b>
            </div>
          </Html>
        </group>
      ))}
    </group>
  );
}
