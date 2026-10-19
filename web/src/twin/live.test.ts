import { describe, expect, it } from "vitest";
import { LIVE_START, liveReducer, liveTwin, twinSocketUrl, type LiveEvent, type LiveState } from "./live";
import { namedJoints, parseTwinMessage, type TwinMessage } from "./messages";

const NAMES = [...Array.from({ length: 7 }, (_, i) => `panda_joint${i + 1}`), "panda_finger_joint1", "panda_finger_joint2"];
// Isaac Lab's Franka start pose (isaaclab_assets/robots/franka.py)
const REST = [0, -0.569, 0, -2.81, 0, 3.037, 0.741, 0.04, 0.04];
const SCENE = { type: "sim_twin_scene", robot: "franka", joint_names: NAMES, base: [0, 0, 0, 1, 0, 0, 0], bin: [0.5, 0.3, 0, 1, 0, 0, 0] };
const FRAME = { type: "sim_twin", q: REST, gripper: 1, cube: [0.5, 0, 0.025, 1, 0, 0, 0] };

const msg = (m: unknown) => parseTwinMessage(JSON.stringify(m)) as TwinMessage;
const run = (...events: LiveEvent[]): LiveState => events.reduce(liveReducer, LIVE_START);
const open: LiveEvent = { kind: "open" };
const m = (x: unknown): LiveEvent => ({ kind: "message", msg: msg(x) });

describe("parseTwinMessage", () => {
  it("reads the relay's three twin messages", () => {
    expect(msg({ type: "status", sim_connected: false })).toEqual({ kind: "status", simConnected: false });
    expect(msg(SCENE)).toEqual({
      kind: "scene",
      scene: { robot: "franka", jointNames: NAMES, base: { pos: [0, 0, 0], quat: [1, 0, 0, 0] }, bin: { pos: [0.5, 0.3, 0], quat: [1, 0, 0, 0] } },
    });
    expect(msg(FRAME)).toEqual({ kind: "frame", frame: { q: REST, gripper: 1, cube: { pos: [0.5, 0, 0.025], quat: [1, 0, 0, 0] } } });
  });

  it("drops anything else", () => {
    expect(parseTwinMessage("not json")).toBeNull();
    expect(msg({ type: "sim_status", recording: false, steps: 0 })).toBeNull();
    expect(msg({ ...FRAME, cube: [0.5, 0, 0.025] })).toBeNull();
    expect(msg({ ...FRAME, gripper: 2 })).toBeNull();
    expect(msg({ ...SCENE, joint_names: [1, 2] })).toBeNull();
  });

  it("names the joints only when the counts agree", () => {
    expect(namedJoints(["a", "b"], [1, 2])).toEqual({ a: 1, b: 2 });
    expect(namedJoints(["a"], [1, 2])).toBeNull();
  });
});

describe("the live twin's state", () => {
  it("goes connecting, waiting, live", () => {
    expect(liveTwin(LIVE_START).status).toBe("connecting");
    expect(liveTwin(run(open, m({ type: "status", sim_connected: true }))).status).toBe("waiting");
    const live = liveTwin(run(open, m({ type: "status", sim_connected: true }), m(SCENE), m(FRAME)));
    expect(live.status).toBe("live");
    expect(live.joints?.panda_joint4).toBe(-2.81);
    expect(live.gripper).toBe(1);
    expect(live.cube?.pos).toEqual([0.5, 0, 0.025]);
    expect(live.bin?.pos).toEqual([0.5, 0.3, 0]);
    expect(live.robot).toBe("franka");
  });

  it("ignores a frame before its scene, and drops the pose when the sim or the socket goes", () => {
    expect(liveTwin(run(open, m(FRAME))).joints).toBeNull();
    const gone = liveTwin(run(open, m(SCENE), m(FRAME), m({ type: "status", sim_connected: false })));
    expect(gone.status).toBe("no_sim");
    expect(gone.joints).toBeNull();
    expect(gone.bin).toBeNull();
    const closed = liveTwin(run(open, m(SCENE), m(FRAME), { kind: "close" }));
    expect(closed.status).toBe("offline");
    expect(closed.cube).toBeNull();
  });

  it("starts over on a new scene (the sink reconnected)", () => {
    const s = run(open, m(SCENE), m(FRAME), m({ ...SCENE, bin: [0.6, 0.2, 0, 1, 0, 0, 0] }));
    expect(liveTwin(s).status).toBe("waiting");
    expect(liveTwin(s).bin?.pos).toEqual([0.6, 0.2, 0]);
  });

  it("listens on the relay's twin role, from the API base", () => {
    expect(twinSocketUrl("http://localhost:8000/")).toBe("ws://localhost:8000/ws/teleop?role=twin");
    expect(twinSocketUrl("https://sant.example")).toBe("wss://sant.example/ws/teleop?role=twin");
  });
});
