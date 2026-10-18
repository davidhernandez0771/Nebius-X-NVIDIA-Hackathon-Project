// Checks the station modules against the rail's rules, so a module that breaks the journey says so
// in the tests (and in a dev console warning) instead of as a camera jump.
import { stationPose } from "./rail";
import { BRANCHES, RAIL_ORDER, type CameraPose, type StationModule } from "./types";

const EPS = 1e-6;

function samePose(a: CameraPose, b: CameraPose): boolean {
  const d = (x: readonly number[], y: readonly number[]) => x.every((v, i) => Math.abs(v - y[i]) < EPS);
  return d(a.position, b.position) && d(a.target, b.target) && Math.abs(a.fov - b.fov) < EPS;
}

export function checkStations(stations: readonly StationModule[]): string[] {
  const problems: string[] = [];
  const ids = stations.map((s) => s.id);
  ids.forEach((id, i) => ids.indexOf(id) !== i && problems.push(`"${id}" is registered twice`));
  for (const id of [...RAIL_ORDER, ...BRANCHES]) if (!ids.includes(id)) problems.push(`no module for "${id}"`);

  const rail = RAIL_ORDER.map((id) => stations.find((s) => s.id === id)).filter((s): s is StationModule => !!s);
  rail.forEach((s, i) => {
    if (s.kind !== "rail") problems.push(`"${s.id}" is on the rail but kind is "${s.kind}"`);
    if (!(s.length > 0)) problems.push(`"${s.id}" needs a length > 0 (viewport heights)`);
    if (i > 0 && !(s.travel >= 0)) problems.push(`"${s.id}" needs a travel >= 0`);
    for (const t of [0, 0.5, 1]) {
      const p = s.camera(t);
      if (![...p.position, ...p.target, p.fov].every(Number.isFinite)) problems.push(`"${s.id}" camera(${t}) is not finite`);
    }
    // With no travel there is no move between the two cameras, so they must meet exactly.
    if (i > 0 && s.travel === 0 && !samePose(stationPose(rail[i - 1], 1), stationPose(s, 0)))
      problems.push(`"${s.id}" has travel 0 but its camera(0) isn't "${rail[i - 1].id}"'s camera(1)`);
  });
  for (const id of BRANCHES) {
    const s = stations.find((m) => m.id === id);
    if (s && s.kind !== "branch") problems.push(`"${id}" is a branch but kind is "${s.kind}"`);
  }
  return problems;
}
