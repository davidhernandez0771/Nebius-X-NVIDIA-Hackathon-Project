// The twin's recording aids (./aids.ts has the geometry): three views from one renderer, the main one from behind
// the robot, over its shoulder (the operator's view: W moves away, D to the right; drag to turn), the side and the
// top (orthographic), drawn with scissor viewports into the one canvas, so one WebGL context and one robot; and the
// top-down alignment grid beside them. Still on demand: a frame is drawn only when something asks for one.
import { useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState, type RefCallback } from "react";
import { OrthographicCamera, PerspectiveCamera } from "three";
import {
  ALIGN_RADIUS,
  BIN_INNER_HALF,
  CUBE_HALF,
  fitOrtho,
  formatCm,
  glRect,
  GRID_HALF,
  GRID_STEP,
  gridBox,
  gridPoint,
  SIDE_REGION,
  squareCorners,
  TOP_REGION,
  viewLayout,
  type Align,
  type Rect,
} from "./aids";
import type { TwinPose, Vec3 } from "./types";

// The pane's hairline (--rg-hair over --rg-void): it shows in the 1 px between the views.
const HAIR = "#082C26";
const half = ([a, b]: readonly [number, number]) => (b - a) / 2;
const mid = ([a, b]: readonly [number, number]) => (a + b) / 2;

const ortho = () => new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);

/** Fit an ortho camera's frustum to its region and its view's aspect. */
function frame(cam: OrthographicCamera, halfU: number, halfV: number, r: Rect) {
  const { halfW, halfH } = fitOrtho(halfU, halfV, r.w / Math.max(1, r.h));
  if (cam.right === halfW && cam.top === halfH) return;
  Object.assign(cam, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
  cam.updateProjectionMatrix();
}

/**
 * Takes over the canvas's drawing (a frame callback with a priority): the front view with the scene's camera, then
 * the side and top views, each in its own viewport. three.js is y up and the sim z up: (x, y, z)_sim -> (x, z, -y).
 */
export function ThreeViews() {
  const side = useMemo(() => {
    // from the robot's right (sim -y = three +z): reach to the right, height up
    const cam = ortho();
    const [x, z] = [mid(SIDE_REGION.x), mid(SIDE_REGION.z)];
    cam.position.set(x, z, 3);
    cam.lookAt(x, z, 0);
    return cam;
  }, []);
  const top = useMemo(() => {
    // from above, forward (sim +x) up, so the robot's left (+y) is on the left, as the operator stands
    const cam = ortho();
    const [x, y] = [mid(TOP_REGION.x), mid(TOP_REGION.y)];
    cam.position.set(x, 3, -y);
    cam.up.set(1, 0, 0);
    cam.lookAt(x, 0, -y);
    return cam;
  }, []);

  useFrame(({ gl, scene, camera, size }) => {
    const L = viewLayout(size.width, size.height);
    gl.setScissorTest(false);
    gl.setViewport(0, 0, size.width, size.height);
    gl.setClearColor(HAIR, 1);
    gl.clear();
    gl.setScissorTest(true);
    const draw = (cam: PerspectiveCamera | OrthographicCamera, r: Rect) => {
      if (r.w < 2 || r.h < 2) return;
      const [x, y, w, h] = glRect(r, size.height);
      gl.setViewport(x, y, w, h);
      gl.setScissor(x, y, w, h);
      gl.render(scene, cam);
    };
    const front = camera as PerspectiveCamera;
    const aspect = L.front.w / Math.max(1, L.front.h);
    if (front.aspect !== aspect) {
      front.aspect = aspect;
      front.updateProjectionMatrix();
    }
    draw(front, L.front);
    frame(side, half(SIDE_REGION.x), half(SIDE_REGION.z), L.side);
    draw(side, L.side);
    frame(top, half(TOP_REGION.y), half(TOP_REGION.x), L.top);
    draw(top, L.top);
    gl.setScissorTest(false);
    gl.setViewport(0, 0, size.width, size.height);
  }, 1);
  return null;
}

type Size = { w: number; h: number };

/** The element's size, kept current with a ResizeObserver (0 x 0 where there is none, e.g. jsdom). */
export function useBox<T extends Element>(): [RefCallback<T>, Size] {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (s.w === r.width && s.h === r.height ? s : { w: r.width, h: r.height }));
    };
    measure();
    if (typeof ResizeObserver === "function") {
      observer.current = new ResizeObserver(measure);
      observer.current.observe(el);
    }
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return [ref, size];
}

const at = (r: Rect) => ({ left: r.x, top: r.y, width: r.w, height: r.h });
const points = (ps: Vec3[], centre: Vec3, b: ReturnType<typeof gridBox>) => ps.map((p) => gridPoint(p, centre, b).map((v) => v.toFixed(1)).join(",")).join(" ");

/**
 * The top-down alignment grid, centred on what the tool point should line up with: the cube, or (carrying it) the
 * bin's centre. A line every 5 cm; the tool point live (in the needle colour while the gripper is closed); the
 * target brightens once lined up. Δx is forward, Δy to the robot's left.
 */
export function AlignGrid({ rect, align, cube, bin, gripper }: { rect: Rect; align: Align | null; cube: TwinPose | null; bin: TwinPose | null; gripper: 0 | 1 | null }) {
  const { w, h } = rect;
  const b = gridBox(w, h);
  const centre: Vec3 = align?.target ?? cube?.pos ?? [0, 0, 0];
  const lines = Math.round(GRID_HALF / GRID_STEP);
  const span = GRID_HALF * b.scale;
  const tool = align ? gridPoint(align.tool, centre, b) : null;
  const toolClamped = align ? Math.max(Math.abs(align.tool[0] - centre[0]), Math.abs(align.tool[1] - centre[1])) > GRID_HALF : false;
  const text = align ? `${align.aligned ? "lined up over" : "line up with"} the ${align.kind}: forward ${formatCm(align.dx)} cm, left ${formatCm(align.dy)} cm` : "no cube to line up with";
  return (
    <div className="twin3d__cell twin3d__align" style={at(rect)} data-aligned={align?.aligned || undefined}>
      <span className="twin3d__tag">align{align ? ` · ${align.kind}` : ""}</span>
      {span > 0 && (
        <svg className="twin3d__grid" width={w} height={h} role="img" aria-label={text}>
          {Array.from({ length: 2 * lines + 1 }, (_, i) => {
            const d = (i - lines) * GRID_STEP * b.scale;
            const cls = i === lines ? "twin3d__gl twin3d__gl--axis" : "twin3d__gl";
            return (
              <g key={i} className={cls}>
                <line x1={b.cx + d} y1={b.cy - span} x2={b.cx + d} y2={b.cy + span} />
                <line x1={b.cx - span} y1={b.cy + d} x2={b.cx + span} y2={b.cy + d} />
              </g>
            );
          })}
          {align?.kind === "bin" && bin && (
            <polygon className="twin3d__bin" data-on={align.aligned || undefined} points={points(squareCorners(bin, BIN_INNER_HALF), centre, b)} />
          )}
          {cube && (align === null || align.kind === "cube") && (
            <>
              <polygon className="twin3d__cube" data-on={align?.aligned || undefined} points={points(squareCorners(cube, CUBE_HALF), centre, b)} />
              <circle className="twin3d__zone" data-on={align?.aligned || undefined} cx={b.cx} cy={b.cy} r={ALIGN_RADIUS * b.scale} />
            </>
          )}
          {align?.kind === "bin" && cube && <polygon className="twin3d__cube twin3d__cube--carried" points={points(squareCorners(cube, CUBE_HALF), centre, b)} />}
          {tool && (
            <g className="twin3d__tool" data-closed={gripper === 1 || undefined} data-far={toolClamped || undefined} transform={`translate(${tool[0].toFixed(1)} ${tool[1].toFixed(1)})`}>
              <circle r={3} />
              <line x1={-9} x2={-5} y1={0} y2={0} />
              <line x1={5} x2={9} y1={0} y2={0} />
              <line x1={0} x2={0} y1={-9} y2={-5} />
              <line x1={0} x2={0} y1={5} y2={9} />
            </g>
          )}
        </svg>
      )}
      <p className="twin3d__delta">
        {align ? (
          <>
            <span>Δx {formatCm(align.dx)}</span>
            <span>Δy {formatCm(align.dy)}</span>
            <small>cm</small>
          </>
        ) : (
          <span>—</span>
        )}
      </p>
    </div>
  );
}

/** The three views' tags and the front view's drag area (the orbit controls listen on it, not the whole canvas). */
export function ViewCells({ front, side, top, onFront }: { front: Rect; side: Rect; top: Rect; onFront: (el: HTMLDivElement | null) => void }) {
  return (
    <>
      <div className="twin3d__cell twin3d__front" style={at(front)} ref={onFront}>
        <span className="twin3d__tag">behind the robot</span>
      </div>
      <div className="twin3d__cell" style={at(side)}>
        <span className="twin3d__tag">side</span>
      </div>
      <div className="twin3d__cell" style={at(top)}>
        <span className="twin3d__tag">top</span>
      </div>
    </>
  );
}
