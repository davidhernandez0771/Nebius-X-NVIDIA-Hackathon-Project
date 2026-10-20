// The SANT logo in 3D, built from the mark itself (web/public/world/mark.svg), so swapping the SVG
// swaps the logo. SVGLoader reads the paths; a filled path becomes its shape and a stroked one is
// outlined at its stroke width with round caps (strokeOutline). The shapes split into the ring (the
// arcs round the edge, which close into the portal's ring in the morph) and the core (everything
// inside). Units: the mark centred on the origin, y up, the arcs' centre line at radius 1.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";

/** Points round each round cap. */
const CAP_STEPS = 16;
/** Points per curve along a stroke. */
const CURVE_STEPS = 32;

/**
 * The closed outline of a stroke of `width` along `pts`: offset by half the width on each side, joined
 * by a half circle round each end. For smooth strokes (arcs, lines); sharp corners aren't mitred.
 */
export function strokeOutline(pts: readonly THREE.Vector2[], width: number): THREE.Vector2[] {
  const p = pts.filter((v, i) => i === 0 || v.distanceToSquared(pts[i - 1]) > 1e-12);
  const n = p.length;
  if (n < 2) return [];
  const h = width / 2;
  const normal = (i: number) => {
    const t = p[Math.min(i + 1, n - 1)].clone().sub(p[Math.max(i - 1, 0)]).normalize();
    return new THREE.Vector2(-t.y, t.x);
  };
  const left = p.map((v, i) => v.clone().addScaledVector(normal(i), h));
  const right = p.map((v, i) => v.clone().addScaledVector(normal(i), -h));
  // Both caps turn clockwise: from the left side, round the end, to the right side (and back at the start).
  const cap = (c: THREE.Vector2, from: number) =>
    Array.from({ length: CAP_STEPS - 1 }, (_, k) => {
      const a = from - (Math.PI * (k + 1)) / CAP_STEPS;
      return new THREE.Vector2(c.x + Math.cos(a) * h, c.y + Math.sin(a) * h);
    });
  const nEnd = normal(n - 1);
  const nStart = normal(0);
  return [
    ...left,
    ...cap(p[n - 1], Math.atan2(nEnd.y, nEnd.x)),
    ...right.reverse(),
    ...cap(p[0], Math.atan2(nStart.y, nStart.x) + Math.PI),
  ];
}

export interface LogoShapes {
  ring: THREE.Shape[];
  core: THREE.Shape[];
}

interface Piece {
  outer: THREE.Vector2[];
  holes: THREE.Vector2[][];
  /** Mean distance from the mark's centre, in SVG units (what sorts it into the ring or the core). */
  radius: number;
}

/** The mark's shapes, centred, y up, scaled so its outer arcs run at radius 1. */
export function logoShapes(svg: string): LogoShapes {
  const data = new SVGLoader().parse(svg);
  const root = data.xml as unknown as Element;
  const box = (root.getAttribute?.("viewBox") ?? "0 0 512 512").split(/[\s,]+/).map(Number);
  const cx = box[0] + box[2] / 2;
  const cy = box[1] + box[3] / 2;
  const meanRadius = (pts: THREE.Vector2[]) => pts.reduce((s, v) => s + Math.hypot(v.x - cx, v.y - cy), 0) / pts.length;

  const pieces: Piece[] = [];
  for (const path of data.paths) {
    const style = path.userData?.style ?? {};
    if (style.fill && style.fill !== "none")
      for (const s of SVGLoader.createShapes(path)) {
        const { shape, holes } = s.extractPoints(CURVE_STEPS);
        pieces.push({ outer: shape, holes, radius: meanRadius(shape) });
      }
    if (style.stroke && style.stroke !== "none")
      for (const sub of path.subPaths) {
        const line = sub.getPoints(CURVE_STEPS);
        const outer = strokeOutline(line, Number(style.strokeWidth) || 1);
        if (outer.length) pieces.push({ outer, holes: [], radius: meanRadius(line) });
      }
  }
  if (pieces.length === 0) return { ring: [], core: [] };

  // The ring: the pieces out at the edge (at least 3/4 of the farthest one's radius).
  const far = Math.max(...pieces.map((p) => p.radius));
  const isRing = (p: Piece) => p.radius >= far * 0.75;
  const ringPieces = pieces.filter(isRing);
  const unit = ringPieces.reduce((s, p) => s + p.radius, 0) / ringPieces.length;
  const toShape = ({ outer, holes }: Piece) => {
    const map = (v: THREE.Vector2) => new THREE.Vector2((v.x - cx) / unit, -(v.y - cy) / unit);
    const shape = new THREE.Shape(outer.map(map));
    shape.holes = holes.map((h) => new THREE.Path(h.map(map)));
    return shape;
  };
  return { ring: ringPieces.map(toShape), core: pieces.filter((p) => !isRing(p)).map(toShape) };
}

export interface ExtrudeOptions {
  /** Thickness, in the shapes' units (the ring's radius is 1). */
  depth: number;
  bevel: number;
  bevelSegments: number;
}

/** One merged, z-centred solid for a set of shapes: rounded glass edges from a small bevel. */
export function extrudeLogo(shapes: THREE.Shape[], { depth, bevel, bevelSegments }: ExtrudeOptions): THREE.BufferGeometry {
  const parts = shapes.map(
    (s) =>
      new THREE.ExtrudeGeometry(s, {
        depth,
        bevelEnabled: bevel > 0,
        bevelThickness: bevel,
        bevelSize: bevel,
        // Inset by the bevel, so the bevel rounds the edge without growing the outline.
        bevelOffset: -bevel,
        bevelSegments,
        curveSegments: CURVE_STEPS,
      }),
  );
  const g = parts.length ? (mergeGeometries(parts) ?? new THREE.BufferGeometry()) : new THREE.BufferGeometry();
  parts.forEach((p) => p.dispose());
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
