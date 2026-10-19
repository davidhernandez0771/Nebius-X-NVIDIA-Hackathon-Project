// /site/record-hud: the Record HUD tiles on a recorded fixture, for review before T4 mounts them
// on Record. The fixture is a scripted hand path in the wire format (fixture/session.json, written
// by web/scripts/record-hud-fixture.mjs); everything on the rack is computed from it.
import { useEffect, useState } from "react";
import { Badge } from "../../sant/components";
import { useMotion } from "../../sant/motion/MotionProvider";
import { AppShell } from "../../sant/shells/AppShell";
import { initialHud, meanRateHz } from "./hudModel";
import { RecordRack } from "./RecordRack";
import type { Chip, RecordState } from "./RecordBar";
import { SimStartLoader } from "./SimStartLoader";
import { useReplay } from "./useReplay";
import { SESSION } from "./fixture/session";

const RATE = meanRateHz(SESSION.frames);
// With reduced motion the rack holds mid-lift: the cube is in the gripper and every tile has a value.
const HOLD_MS = 4800;
const START_STEPS = ["launching isaac sim", "loading franka_panda", "rendering cameras", "linking webcam"];
const STEP_MS = 1600;

type Scene = "live" | "starting" | "lost";
const SCENES: { id: Scene; label: string }[] = [
  { id: "live", label: "Hand tracked" },
  { id: "starting", label: "Starting simulator" },
  { id: "lost", label: "Hand lost" },
];

function useStartSteps(active: boolean, reduced: boolean) {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    if (!active || reduced) return;
    const t0 = performance.now();
    const id = window.setInterval(() => setMs(performance.now() - t0), 100);
    return () => window.clearInterval(id);
  }, [active, reduced]);
  const shown = reduced ? STEP_MS * 1.5 : ms;
  return { elapsedMs: shown, current: Math.floor(shown / STEP_MS) % START_STEPS.length };
}

function chipsFor(scene: Scene): Chip[] {
  return [
    scene === "starting" ? { label: "sim_link", state: "wait", detail: "starting" } : { label: "sim_link", state: "ok" },
    scene === "starting"
      ? { label: "hand_track", state: "off" }
      : scene === "lost"
        ? { label: "hand_track", state: "wait", detail: "lost" }
        : { label: "hand_track", state: "ok" },
    { label: "verified", state: "off", detail: "after recording" },
  ];
}

export function RecordHudPreview() {
  const { reduced } = useMotion();
  const [scene, setScene] = useState<Scene>("live");
  const [rec, setRec] = useState<RecordState>("recording");
  const starting = scene === "starting";
  const replay = useReplay(SESSION, { running: !starting, reduced, lost: scene === "lost", recording: rec === "recording" && !starting, holdMs: HOLD_MS });
  const start = useStartSteps(starting, reduced);

  const message = starting ? (
    <SimStartLoader steps={START_STEPS} current={start.current} elapsedMs={start.elapsedMs} />
  ) : scene === "lost" ? (
    "Show your hand to the camera. The arm holds its last target until it sees you again."
  ) : undefined;

  return (
    <AppShell
      title="Record"
      active={0}
      links={[{ to: "/site/record-hud", label: "Record HUD" }]}
      status={<Badge>Recorded fixture</Badge>}
      actions={
        <div className="rh-scenes" role="group" aria-label="Preview state">
          {SCENES.map((s) => (
            <button key={s.id} type="button" className="rh-scenes__btn" aria-pressed={scene === s.id} onClick={() => setScene(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      }
    >
      <RecordRack
        hud={starting ? initialHud() : replay.hud}
        chips={chipsFor(scene)}
        state={starting ? "idle" : rec}
        elapsedMs={starting ? 0 : replay.elapsedMs}
        onToggle={() => setRec((r) => (r === "recording" ? "paused" : "recording"))}
        recordDisabled={starting}
        path={["sant", "record", "franka_panda"]}
        phase={replay.phase}
        rateHz={starting ? null : RATE}
        message={message}
      />
      <p className="rh-note">
        Recorded fixture: a scripted 10 s pick-and-place hand path in the teleop wire format (web/scripts/record-hud-fixture.mjs), not a
        webcam recording. Targets, the gripper latch and the workspace come from the sim's own mapping (src/demo_pipeline/teleop.py).
        Messages arrive at about 30 Hz (docs/superpowers/notes/2026-10-15-t4-status.md:169).
      </p>
    </AppShell>
  );
}
