import { describe, expect, it } from "vitest";
import { fillDistance, MACHINE_ANCHOR, MACHINE_VIEW, PROJECTION } from "../core/layout";
import { stop, type StopName } from "../scene/layout";
import { layoutRail, poseAt, stationPose } from "../core/rail";
import { checkStations } from "../core/registry";
import { RAIL_ORDER, type StationModule } from "../core/types";
import { STATIONS } from ".";
import { HUB_FAR } from "./descent/path";
import { HERO_LIFT, HERO_VIEW } from "./intro/layout";
import { PORTAL_VIEW } from "./intro/path";
import { CLOSE } from "./zoom";

const rails = RAIL_ORDER.map((id) => STATIONS.find((s) => s.id === id)!);

describe("the registered stations", () => {
  it("follow every rule of the rail", () => {
    expect(checkStations(STATIONS)).toEqual([]);
  });

  it("move the camera without a jump anywhere on the rail", () => {
    const rail = layoutRail(rails, 900);
    // A travel that cuts behind its own mask (cutAt) may jump there, and only there.
    const cuts = rail.spans.flatMap((s, i) => (rails[i].cutAt !== undefined ? [s.from + (s.start - s.from) * rails[i].cutAt!] : []));
    let prev = poseAt(rails, rail, 0);
    for (let y = 2; y <= rail.total; y += 2) {
      const p = poseAt(rails, rail, y);
      const step = Math.hypot(...p.position.map((v, i) => v - prev.position[i]));
      if (!cuts.some((c) => c > y - 2 && c <= y)) expect(step).toBeLessThan(0.5);
      prev = p;
    }
  });

  it("end the story on the ring and the descent just behind the room view", () => {
    const at = (id: string, t: number) => stationPose(STATIONS.find((s) => s.id === id)!, t);
    expect(at("intro", 1)).toEqual(PORTAL_VIEW);
    expect(at("descent", 0)).toEqual(PORTAL_VIEW);
    expect(at("descent", 1)).toEqual(HUB_FAR);
  });

  it("hand the machine's last view to the zoom", () => {
    const machine = STATIONS.find((s) => s.id === "machine")!;
    const zoom = STATIONS.find((s) => s.id === "zoom")!;
    expect(machine.kind).toBe("branch");
    expect(zoom.kind).toBe("branch");
    expect(machine.duration).toBeGreaterThan(0);
    expect(zoom.duration).toBeGreaterThan(0);
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
    const at = (id: string, t: number) => stationPose(STATIONS.find((s) => s.id === id)!, t);
    const same = (id: string, t: number, name: StopName) => {
      const p = at(id, t);
      const s = stop(name);
      p.position.forEach((v, i) => expect(v).toBeCloseTo(s.position[i], 6));
      p.target.forEach((v, i) => expect(v).toBeCloseTo(s.target[i], 6));
    };
    // The hero is Blender's Title framing, raised above the room by HERO_LIFT so the story's places
    // (the forest, the rock, the reactor) stack between it and the workshop.
    const title = stop("Title");
    expect(at("intro", 0)).toEqual(HERO_VIEW);
    HERO_VIEW.position.forEach((v, i) => expect(v).toBeCloseTo(title.position[i] + (i === 1 ? HERO_LIFT : 0), 6));
    HERO_VIEW.target.forEach((v, i) => expect(v).toBeCloseTo(title.target[i] + (i === 1 ? HERO_LIFT : 0), 6));
    same("workshop", 0, "Workshop intro");

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
    const broken = STATIONS.map((s) => (s.id === "descent" ? { ...s, camera: () => ({ position: [0, 0, 0] as const, target: [0, 0, -1] as const, fov: 40 }) } : s));
    expect(checkStations(broken)).toEqual([`"descent" has travel 0 but its camera(0) isn't "intro"'s camera(1)`]);
    expect(checkStations(STATIONS.filter((s) => s.id !== "workbench"))).toEqual([`no module for "workbench"`]);
    expect(checkStations([...STATIONS, STATIONS[0]])).toEqual([`"intro" is registered twice`]);
  });
});
