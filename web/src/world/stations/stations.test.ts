import { describe, expect, it } from "vitest";
import { fillDistance, MACHINE_ANCHOR, MACHINE_VIEW, PROJECTION } from "../core/layout";
import { stop, type StopName } from "../scene/layout";
import { layoutRail, poseAt, stationPose } from "../core/rail";
import { checkStations } from "../core/registry";
import { RAIL_ORDER, type StationModule } from "../core/types";
import { STATIONS } from ".";
import { spiral } from "./descent";
import { CLOSE } from "./zoom";

const rails = RAIL_ORDER.map((id) => STATIONS.find((s) => s.id === id)!);

describe("the registered stations", () => {
  it("follow every rule of the rail", () => {
    expect(checkStations(STATIONS)).toEqual([]);
  });

  it("move the camera without a jump anywhere on the rail", () => {
    const rail = layoutRail(rails, 900);
    let prev = poseAt(rails, rail, 0);
    for (let y = 2; y <= rail.total; y += 2) {
      const p = poseAt(rails, rail, y);
      const step = Math.hypot(...p.position.map((v, i) => v - prev.position[i]));
      expect(step).toBeLessThan(0.5);
      prev = p;
    }
  });

  it("descend: the spiral goes down the whole way and turns once", () => {
    let y = Infinity;
    for (let t = 0; t <= 1; t += 0.05) {
      const p = spiral(t);
      expect(p.position[1]).toBeLessThan(y);
      y = p.position[1];
    }
    expect(spiral(1).position[0]).toBeCloseTo(spiral(0).position[0], 6);
    expect(spiral(1).position[2]).toBeCloseTo(spiral(0).position[2], 6);
  });

  it("hand the machine's last view to the zoom", () => {
    const machine = rails[RAIL_ORDER.indexOf("machine")];
    const zoom = rails[RAIL_ORDER.indexOf("zoom")];
    expect(stationPose(machine, 1)).toEqual(stationPose(zoom, 0));
    expect(machine.camera(1)).toEqual(MACHINE_VIEW);
    expect(zoom.anchor).toEqual(MACHINE_ANCHOR);
  });

  it("end the zoom square in front of the projection, close enough that it fills the view", () => {
    const off = CLOSE.position.map((v, i) => v - PROJECTION.center[i]);
    const d = off.reduce((s, v, i) => s + v * PROJECTION.normal[i], 0);
    const side = Math.hypot(...off.map((v, i) => v - d * PROJECTION.normal[i]));
    expect(d).toBeGreaterThan(0.5);
    expect(d).toBeLessThan(fillDistance(CLOSE.fov));
    expect(side).toBeLessThan(0.01);
    // machine.glb's hologram and layout.json's "Zoom to UI" stop agree on where the screen is.
    CLOSE.target.forEach((v, i) => expect(v).toBeCloseTo(PROJECTION.center[i], 2));
  });

  it("follow Blender's camera stops", () => {
    const at = (id: string, t: number) => stationPose(rails[RAIL_ORDER.indexOf(id as (typeof RAIL_ORDER)[number])], t);
    const same = (id: string, t: number, name: StopName) => {
      const p = at(id, t);
      const s = stop(name);
      p.position.forEach((v, i) => expect(v).toBeCloseTo(s.position[i], 6));
      p.target.forEach((v, i) => expect(v).toBeCloseTo(s.target[i], 6));
    };
    same("intro", 0, "Title");
    same("intro", 1, "Descent");
    same("descent", 0, "Descent");
    same("workshop", 0, "Workshop intro");
    same("workshop", 1, "Tutorial 1 · shelf");
    same("machine", 0, "Tutorial 2 · machine");
    same("machine", 0.5, "Plug in");
    same("machine", 1, "Projection");
    same("zoom", 1, "Zoom to UI");
  });

  it("each live in their own folder with an owner", () => {
    const owners = Object.fromEntries(STATIONS.map((s: StationModule) => [s.id, s.owner]));
    expect(owners).toMatchObject({ workshop: "T6", machine: "T7", workbench: "T1" });
  });
});

describe("checkStations", () => {
  it("names what is wrong", () => {
    const broken = STATIONS.map((s) => (s.id === "zoom" ? { ...s, camera: () => ({ position: [0, 0, 0] as const, target: [0, 0, -1] as const, fov: 40 }) } : s));
    expect(checkStations(broken)).toEqual([`"zoom" has travel 0 but its camera(0) isn't "machine"'s camera(1)`]);
    expect(checkStations(STATIONS.filter((s) => s.id !== "workbench"))).toEqual([`no module for "workbench"`]);
    expect(checkStations([...STATIONS, STATIONS[0]])).toEqual([`"intro" is registered twice`]);
  });
});
