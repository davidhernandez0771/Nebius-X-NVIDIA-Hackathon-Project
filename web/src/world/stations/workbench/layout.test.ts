import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BENCH_SCALE, EDIT_VIEW, PRINT_H, PRINT_QUATERNION, SLOT, TURNTABLE, TURNTABLE_TOP, benchCartridge, printPose } from "./layout";

const v = (a: readonly number[]) => new THREE.Vector3(a[0], a[1], a[2]);

describe("the bench's live parts", () => {
  it("stand the cartridge on the turntable the edit camera looks at", () => {
    // Blender aimed "Workbench edit" straight over the turntable.
    expect(EDIT_VIEW.target[0]).toBeCloseTo(TURNTABLE.x, 3);
    expect(EDIT_VIEW.target[2]).toBeCloseTo(TURNTABLE.z, 3);
    const { position, yaw } = benchCartridge();
    expect(position.y - 1.25 * BENCH_SCALE).toBeCloseTo(TURNTABLE_TOP, 6);
    // Its label (+z) faces the camera.
    const face = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const toEye = v(EDIT_VIEW.position).sub(position).setY(0).normalize();
    expect(face.dot(toEye)).toBeGreaterThan(0.999);
  });

  it("frame the whole cartridge in the edit shot", () => {
    const eye = v(EDIT_VIEW.position);
    const ahead = v(EDIT_VIEW.target).sub(eye).normalize();
    const half = (EDIT_VIEW.fov / 2) * (Math.PI / 180);
    const { position } = benchCartridge();
    for (const dy of [-1.25, 1.25]) {
      const p = position.clone().add(new THREE.Vector3(0, dy * BENCH_SCALE, 0));
      expect(ahead.angleTo(p.sub(eye).normalize())).toBeLessThan(half * 0.9);
    }
  });

  it("feed the printed label out of the printer's slot, turned toward the edit camera", () => {
    const along = new THREE.Vector3(0, 0, 1).applyQuaternion(PRINT_QUATERNION);
    const start = printPose(0);
    const end = printPose(1);
    expect(end.clone().sub(start).normalize().dot(along)).toBeGreaterThan(0.999);
    // All inside the printer at the start, all out at the end (its near edge past the slot).
    expect(start.clone().sub(SLOT).dot(along)).toBeLessThan(-PRINT_H / 2);
    expect(end.clone().sub(SLOT).dot(along)).toBeGreaterThan(PRINT_H / 2);
    expect(printPose(2).equals(end)).toBe(true);
    // Its face sees the camera better than lying flat would, and its far edge stays over the bench top.
    const face = new THREE.Vector3(0, 1, 0).applyQuaternion(PRINT_QUATERNION);
    const toEye = v(EDIT_VIEW.position).sub(end).normalize();
    expect(face.dot(toEye)).toBeGreaterThan(new THREE.Vector3(0, 1, 0).dot(toEye) + 0.15);
    // bx_B_Mat, the bench's cutting mat, is the top: 3.335.
    expect(end.clone().addScaledVector(along, PRINT_H / 2).y).toBeGreaterThan(3.335);
  });
});

describe("the bench in the room view, and a save's flight", () => {
  it("stands the draft on the turntable in the room, where the bench opens it", async () => {
    const { benchMatrix } = await import("./layout");
    const { BENCH_PIVOT } = await import("../../scene/layout");
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    benchMatrix().decompose(p, q, s);
    const home = benchCartridge();
    expect(p.distanceTo(home.position.clone().add(v(BENCH_PIVOT.position)))).toBeLessThan(1e-9);
    expect(q.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), home.yaw))).toBeLessThan(1e-6);
    expect(s.x).toBeCloseTo(BENCH_SCALE, 9);
  });

  it("flies a saved cartridge from the turntable to its empty place on the spiral, up and clear first", async () => {
    const { flightPose, benchMatrix } = await import("./layout");
    const { SPARE } = await import("../../scene/layout");
    const start = new THREE.Vector3().setFromMatrixPosition(benchMatrix());
    const out = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: 0 };
    SPARE.forEach((slot, place) => {
      flightPose(place, 0, out);
      expect(out.position.distanceTo(start)).toBeLessThan(1e-9);
      expect(out.scale).toBeCloseTo(BENCH_SCALE, 9);
      flightPose(place, 1, out);
      expect(out.position.distanceTo(v(slot.position))).toBeLessThan(1e-9);
      expect(out.quaternion.angleTo(new THREE.Quaternion(...slot.quaternion))).toBeLessThan(1e-6);
      expect(out.scale).toBeCloseTo(slot.scale, 9);
      let prev = start.clone();
      for (let u = 0.01; u <= 1.0001; u += 0.01) {
        flightPose(place, u, out);
        expect(out.position.distanceTo(prev)).toBeLessThan(0.6);
        // Off the turntable upward first: it never dips into the bench.
        if (u < 0.25) expect(out.position.y).toBeGreaterThanOrEqual(prev.y - 1e-9);
        prev = out.position.clone();
      }
    });
  });
});

// The material stage: six blank shells lying on the bench's mat, in a row in front of the turntable.
describe("the six blanks on the bench", () => {
  it("lie face up on the mat, three either side of the turntable (a column each side on a phone), apart, clear of it and of the printer", async () => {
    const { BLANKS, BLANK_SCALE, MAT_TOP, benchFrame, blankPose } = await import("./layout");
    const { FINISHES } = await import("../../scene/saved");
    expect(BLANKS).toHaveLength(FINISHES.length);
    const t = 0.17 * BLANK_SCALE;
    const tt = benchFrame(TURNTABLE);
    const printer = benchFrame(new THREE.Vector3(-2.4387, 3.56, -2.6557));
    for (const tall of [false, true]) {
      // Each blank's footprint on the mat, its four corners in the bench's own frame.
      const corners = FINISHES.map((_, i) => {
        const p = blankPose(i, 0, undefined, tall);
        return [-1.15, 1.15].flatMap((cx) => [-1.25, 1.25].map((cy) => benchFrame(new THREE.Vector3(cx, cy, 0).applyQuaternion(p.quaternion).multiplyScalar(BLANK_SCALE).add(p.position))));
      });
      FINISHES.forEach((_, i) => {
        const p = blankPose(i, 0, undefined, tall);
        // Its label side (+z) faces up; it rests on the mat.
        expect(new THREE.Vector3(0, 0, 1).applyQuaternion(p.quaternion).y).toBeGreaterThan(0.99);
        expect(p.position.y - t).toBeCloseTo(MAT_TOP, 6);
        expect(p.scale).toBe(BLANK_SCALE);
        for (const c of corners[i]) {
          // Inside the mat (8.2 × 3.9), not a corner over its edge.
          expect(Math.abs(c.x), `${tall} ${i}`).toBeLessThan(4.1);
          expect(Math.abs(c.z), `${tall} ${i}`).toBeLessThan(1.95);
          // Clear of the turntable's ring (0.965 m round its centre), and of the printer's foot.
          expect(Math.hypot(c.x - tt.x, c.z - tt.z), `${tall} ${i}`).toBeGreaterThan(0.965 + 0.04);
          expect(Math.abs(c.x - printer.x) > 0.75 || Math.abs(c.z - printer.z) > 0.55).toBe(true);
        }
      });
      // Apart: no two footprints' centres closer than a blank's width and a hand's breadth.
      const centres = FINISHES.map((_, i) => benchFrame(blankPose(i, 0, undefined, tall).position));
      for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) expect(centres[a].distanceTo(centres[b])).toBeGreaterThan(2.3 * BLANK_SCALE + 0.06);
      // Left to right in the finishes' order on a wide screen, mirrored either side of the turntable.
      if (!tall) {
        for (let i = 1; i < 6; i++) expect(centres[i].x).toBeGreaterThan(centres[i - 1].x);
        for (let i = 0; i < 3; i++) expect(centres[i].x - tt.x).toBeCloseTo(-(centres[5 - i].x - tt.x), 1);
      }
    }
  });

  it("lift a little under the pointer, and no more than that", async () => {
    const { BLANK_LIFT, blankPose } = await import("./layout");
    const rest = blankPose(2).position;
    const up = blankPose(2, 1).position;
    expect(up.y - rest.y).toBeCloseTo(BLANK_LIFT, 6);
    expect(BLANK_LIFT).toBeGreaterThan(0.03);
    expect(BLANK_LIFT).toBeLessThan(0.15);
  });

  it("fly one to the turntable: up off the mat, turning upright, standing where the bench cartridge stands", async () => {
    const { BLANKS, MAT_TOP, blankPose, pickPose } = await import("./layout");
    const out = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: 0 };
    const home = benchCartridge();
    const upright = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), home.yaw);
    BLANKS.forEach((_, i) => {
      pickPose(i, 0, out);
      const from = blankPose(i);
      expect(out.position.distanceTo(from.position)).toBeLessThan(1e-9);
      expect(out.quaternion.angleTo(from.quaternion)).toBeLessThan(1e-6);
      pickPose(i, 1, out);
      expect(out.position.distanceTo(home.position)).toBeLessThan(1e-9);
      expect(out.quaternion.angleTo(upright)).toBeLessThan(1e-6);
      expect(out.scale).toBeCloseTo(BENCH_SCALE, 9);
      let prev = from.position.clone();
      let top = -Infinity;
      for (let u = 0.02; u <= 1.0001; u += 0.02) {
        pickPose(i, u, out);
        expect(out.position.distanceTo(prev)).toBeLessThan(0.35);
        // Its centre never sinks under the mat by more than it stands tall (it only ever rises off it).
        expect(out.position.y).toBeGreaterThan(MAT_TOP);
        top = Math.max(top, out.position.y);
        prev = out.position.clone();
      }
      // It rises clear on the way over.
      expect(top).toBeGreaterThan(home.position.y + 0.3);
    });
  });
});

/** Where a local point lands on a w×h screen from a shot, and whether it is in front of the camera. */
function project(shot: { position: readonly number[]; target: readonly number[]; fov: number }, w: number, h: number, p: THREE.Vector3) {
  const cam = new THREE.PerspectiveCamera(shot.fov, w / h, 0.1, 200);
  cam.position.set(shot.position[0], shot.position[1], shot.position[2]);
  cam.lookAt(shot.target[0], shot.target[1], shot.target[2]);
  cam.updateMatrixWorld(true);
  const q = p.clone().project(cam);
  return { x: ((q.x + 1) / 2) * w, y: ((1 - q.y) / 2) * h, front: q.z < 1 };
}

/** The editor's panel on each screen (bench.css): bottom left on a desktop, the bottom sheet on a phone. */
const SCREENS = [
  { name: "desktop", w: 1280, h: 720, panel: { x0: 0, x1: 440, y0: 380, y1: 720 } },
  { name: "phone", w: 390, h: 844, panel: { x0: 0, x1: 390, y0: 844 - 360, y1: 844 } },
];

describe("each stage's shot", () => {
  it("sees all six blanks in the material shot, on screen and clear of the editor", async () => {
    const { BLANKS, BLANK_SCALE, blankPose, shotFor } = await import("./layout");
    for (const s of SCREENS) {
      const shot = shotFor("material", s.w / s.h);
      BLANKS.forEach((_, i) => {
        const p = blankPose(i, 0, undefined, s.h > s.w);
        for (const cx of [-1.15, 1.15])
          for (const cy of [-1.25, 1.25]) {
            const corner = new THREE.Vector3(cx, cy, 0.17).applyQuaternion(p.quaternion).multiplyScalar(BLANK_SCALE).add(p.position);
            const q = project(shot, s.w, s.h, corner);
            expect(q.front, `${s.name} blank ${i}`).toBe(true);
            expect(q.x, `${s.name} blank ${i} x`).toBeGreaterThan(12);
            expect(q.x, `${s.name} blank ${i} x`).toBeLessThan(s.w - 12);
            expect(q.y, `${s.name} blank ${i} y`).toBeGreaterThan(70);
            const underPanel = q.x > s.panel.x0 && q.x < s.panel.x1 && q.y > s.panel.y0 && q.y < s.panel.y1;
            expect(underPanel, `${s.name} blank ${i} under the editor`).toBe(false);
          }
      });
      // The turntable, where the picked one goes, is in the shot too.
      const tt = project(shot, s.w, s.h, TURNTABLE.clone());
      expect(tt.x).toBeGreaterThan(0);
      expect(tt.x).toBeLessThan(s.w);
      expect(tt.y).toBeGreaterThan(60);
    }
  });

  it("frames the cartridge and its robot's hologram in the robot shot", async () => {
    const { HOLO_BASE, HOLO_H, shotFor } = await import("./layout");
    const { position } = benchCartridge();
    for (const s of SCREENS) {
      const shot = shotFor("robot", s.w / s.h);
      for (const p of [position.clone().setY(position.y - 1.25 * BENCH_SCALE), HOLO_BASE.clone().setY(HOLO_BASE.y + HOLO_H)]) {
        const q = project(shot, s.w, s.h, p);
        expect(q.y, s.name).toBeGreaterThan(70);
        if (s.name === "phone") expect(q.y, s.name).toBeLessThan(s.panel.y0);
        else expect(q.x > s.panel.x1 || q.y < s.panel.y0, `${s.name} under the editor`).toBe(true);
        expect(q.x).toBeGreaterThan(0);
        expect(q.x).toBeLessThan(s.w);
      }
    }
  });

  it("keeps the whole cartridge on screen, above the editor, in the other stages", async () => {
    const { shotFor } = await import("./layout");
    const { position } = benchCartridge();
    for (const stage of ["colour", "name"] as const)
      for (const s of SCREENS) {
        const shot = shotFor(stage, s.w / s.h);
        for (const dy of [-1.25, 1.25])
          for (const dx of [-1.15, 1.15]) {
            const q = project(shot, s.w, s.h, position.clone().add(new THREE.Vector3(dx * BENCH_SCALE, dy * BENCH_SCALE, 0)));
            expect(q.y, `${stage} ${s.name}`).toBeGreaterThan(70);
            expect(q.x, `${stage} ${s.name}`).toBeGreaterThan(8);
            expect(q.x, `${stage} ${s.name}`).toBeLessThan(s.w - 8);
            if (s.name === "phone") expect(q.y, `${stage} ${s.name}`).toBeLessThan(s.panel.y0);
            else expect(q.x > s.panel.x1 || q.y < s.panel.y0, `${stage} ${s.name} under the editor`).toBe(true);
          }
      }
  });

  it("pulls back for the done shot, so the flight can be watched from the turntable to its place on the spiral", async () => {
    const { shotFor } = await import("./layout");
    const { SPARE, BENCH_PIVOT } = await import("../../scene/layout");
    const anchor = v(BENCH_PIVOT.position);
    for (const s of SCREENS) {
      const shot = shotFor("done", s.w / s.h);
      const points = [TURNTABLE.clone(), ...SPARE.map((p) => v(p.position).sub(anchor))];
      for (const p of points) {
        const q = project(shot, s.w, s.h, p);
        expect(q.front, s.name).toBe(true);
        expect(q.x, s.name).toBeGreaterThan(8);
        expect(q.x, s.name).toBeLessThan(s.w * 0.88);
        expect(q.y, s.name).toBeGreaterThan(70);
        if (s.name === "phone") expect(q.y, s.name).toBeLessThan(s.panel.y0);
        else expect(q.x > s.panel.x1 || q.y < s.panel.y0, `${s.name} under the editor`).toBe(true);
      }
    }
  });

  it("keeps every shot's camera inside the room (room.glb: 44 × 34 m, 15 m high; the robot shelves 20 m out)", async () => {
    const { shotFor } = await import("./layout");
    const { BENCH_PIVOT } = await import("../../scene/layout");
    const anchor = v(BENCH_PIVOT.position);
    for (const stage of ["material", "colour", "robot", "name", "done"] as const)
      for (const s of SCREENS) {
        const eye = v(shotFor(stage, s.w / s.h).position).add(anchor);
        expect(Math.abs(eye.x), `${stage} ${s.name}`).toBeLessThan(18);
        expect(eye.z, `${stage} ${s.name}`).toBeGreaterThan(-18);
        expect(eye.z, `${stage} ${s.name}`).toBeLessThan(11);
        expect(eye.y, `${stage} ${s.name}`).toBeGreaterThan(1);
        expect(eye.y, `${stage} ${s.name}`).toBeLessThan(12.5);
      }
  });

  it("keeps the cartridge clear of the journey rail on the right of a desktop", async () => {
    const { shotFor } = await import("./layout");
    const { position } = benchCartridge();
    for (const stage of ["colour", "name", "robot"] as const) {
      const shot = shotFor(stage, 1280 / 720);
      for (const dx of [-1.15, 1.15])
        for (const dy of [-1.25, 1.25]) {
          // The label face, the nearest part.
          const q = project(shot, 1280, 720, position.clone().add(new THREE.Vector3(dx * BENCH_SCALE, dy * BENCH_SCALE, 0.17 * BENCH_SCALE).applyAxisAngle(new THREE.Vector3(0, 1, 0), benchCartridge().yaw)));
          expect(q.x, stage).toBeLessThan(1130);
        }
    }
  });

  it("stands the hologram over the cartridge's top, centred on it", async () => {
    const { HOLO_BASE, HOLO_H } = await import("./layout");
    const { position } = benchCartridge();
    expect(HOLO_BASE.y).toBeGreaterThan(position.y + 1.25 * BENCH_SCALE);
    expect(HOLO_BASE.y).toBeLessThan(position.y + 1.25 * BENCH_SCALE + 0.4);
    expect(Math.hypot(HOLO_BASE.x - position.x, HOLO_BASE.z - position.z)).toBeLessThan(1e-9);
    expect(HOLO_H).toBeGreaterThan(0.8);
    expect(HOLO_H).toBeLessThan(2);
  });
});
