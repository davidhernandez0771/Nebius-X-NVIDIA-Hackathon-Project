import { describe, expect, it } from "vitest";
import type { LiveTwin, ReplayTwin } from "../../twin";
import { chooseTwin } from "./robotTwin";

const pose = { pos: [0.5, 0.3, 0] as [number, number, number], quat: [1, 0, 0, 0] as [number, number, number, number] };

const sim = (over: Partial<LiveTwin> = {}): LiveTwin => ({
  status: "offline",
  joints: null,
  gripper: null,
  cube: null,
  bin: null,
  base: null,
  robot: null,
  ...over,
});

const replay = (over: Partial<ReplayTwin> = {}): ReplayTwin => ({
  status: "idle",
  error: null,
  episode: null,
  step: 0,
  playing: false,
  play: () => {},
  pause: () => {},
  seek: () => {},
  twin: { joints: null, gripper: null, cube: null, bin: null },
  base: null,
  ...over,
});

describe("chooseTwin", () => {
  it("shows the sim when it streams poses", () => {
    const t = chooseTwin(sim({ status: "live", joints: { panda_joint1: 0.2 }, gripper: 1, bin: pose }), replay({ status: "ready" }));
    expect(t.mode).toBe("live");
    expect(t.caption).toBe("live from the sim");
    expect(t.view).toEqual({ joints: { panda_joint1: 0.2 }, gripper: 1, cube: null, bin: pose, base: null });
  });

  it("replays the demo episode otherwise, named in the caption", () => {
    const episode = { demoId: "s1_0004_nemotron_m104003" } as ReplayTwin["episode"];
    const t = chooseTwin(
      sim({ status: "no_sim" }),
      replay({ status: "ready", episode, twin: { joints: { panda_joint1: 0.6 }, gripper: 0, cube: pose, bin: pose }, base: pose }),
    );
    expect(t.mode).toBe("replay");
    expect(t.caption).toBe("replay · verified copy s1_0004_nemotron_m104003");
    expect(t.view.joints).toEqual({ panda_joint1: 0.6 });
    expect(t.view.base).toBe(pose);
  });

  it("says so while the replay loads or when it fails, and never shows a connecting sim's stale data", () => {
    expect(chooseTwin(sim({ status: "waiting" }), replay({ status: "loading" })).caption).toBe("loading the replay…");
    const failed = chooseTwin(sim({ status: "connecting", joints: { panda_joint1: 1 } }), replay({ status: "error", error: "x" }));
    expect(failed.caption).toMatch(/didn't load/);
    expect(failed.view.joints).toBeNull();
  });
});
