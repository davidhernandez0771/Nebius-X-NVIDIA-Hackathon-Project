// What the machine projects, from one place, for every cartridge (site-nav, 2026-10-26): the hologram is the one
// verified replay there is, the Franka FR3's pick-and-place (scene/HoloTwin.tsx: the twin's Franka URDF and
// public/world/demo-episode.json). Its panel's title, the line under it and the caption beside the machine say so;
// a cartridge for another arm (the SO-101 by default) says it has no replay of its own yet. Before, the panel's title
// was the cartridge's name ("SO-101") over a hard-coded "FRANKA FR3" line and a Franka hologram.
import type { Cartridge } from "../core/types";
import { robotFor } from "./robots";

/** The replay the machine projects: its robot (by label code and name) and its task. */
export const REPLAY = { code: "FR3", robot: "Franka FR3", task: "pick cube → bin" } as const;

export interface Projection {
  /** The panel's title: the robot the hologram shows. */
  title: string;
  /** The line under it: the task. */
  line: string;
  /** The cartridge plugged in, and whether the replay is its own robot's. */
  cartridgeLine: string;
  own: boolean;
  /** The caption beside the machine (machine/index.tsx). */
  lede: string;
}

export function projectionOf(c: Cartridge): Projection {
  const own = c.robot === REPLAY.code;
  const name = c.label;
  const DEMO = "a real, physics-checked demo, replayed.";
  let lede: string;
  if (own) lede = `${name} plugs in, and the machine projects ${name === REPLAY.robot ? "it" : `its robot, the ${REPLAY.robot}`}: ${DEMO}`;
  else {
    const why = c.robot ? `The ${robotFor(c.robot).name} has no verified replay yet` : "It names no robot";
    lede = `${name} plugs in. ${why}, so the machine projects the ${REPLAY.robot}'s: ${DEMO}`;
  }
  return {
    title: REPLAY.robot.toUpperCase(),
    line: REPLAY.task.toUpperCase(),
    cartridgeLine: own ? `CARTRIDGE · ${name.toUpperCase()}` : `CARTRIDGE · ${name.toUpperCase()} · NO OWN REPLAY`,
    own,
    lede,
  };
}
