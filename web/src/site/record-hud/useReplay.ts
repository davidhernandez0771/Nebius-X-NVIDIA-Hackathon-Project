// Plays a recorded session through stepHud on the animation clock, for the preview. Live data
// would call stepHud per message instead; this only stands in for the webcam and the relay.
import { useEffect, useRef, useState } from "react";
import type { HandPoseMsg } from "../../record/teleop/handPoseMessage";
import { frameAt, initialHud, stepHud, type HudState, type Point } from "./hudModel";

export type SessionFrame = HandPoseMsg & { phase: string; landmarks: Point[] };
export type Session = { about: string; rate_hz: number; frames: SessionFrame[] };

function feed(state: HudState, frame: SessionFrame, lost: boolean): HudState {
  return lost ? stepHud(state, { ...frame, tracking_ok: false }) : stepHud(state, frame, frame.landmarks);
}

/** Every frame from 0 to `index`, so the traces already hold a history at the first paint. */
function preroll(frames: SessionFrame[], index: number): HudState {
  let s = initialHud();
  for (let i = 0; i <= index; i++) s = feed(s, frames[i], false);
  return s;
}

type View = { hud: HudState; index: number; elapsedMs: number };

/**
 * `running` false pauses the session clock (the simulator is still starting); it resumes where it
 * stopped. With `reduced` (reduced motion or effects off) the session holds still at `holdMs`.
 * The timer only runs while `recording`. `lost` sends the frames with tracking_ok false.
 */
export function useReplay(
  session: Session,
  { running, reduced, lost, recording, holdMs }: { running: boolean; reduced: boolean; lost: boolean; recording: boolean; holdMs: number },
) {
  const { frames } = session;
  const holdIndex = frameAt(frames, holdMs);
  const [view, setView] = useState<View>(() => {
    const index = reduced ? holdIndex : 0;
    return { hud: preroll(frames, index), index, elapsedMs: 0 };
  });
  // The loop's own copy of the state, so React's updaters stay pure (StrictMode runs them twice).
  const hud = useRef(view.hud);
  const index = useRef(view.index);
  const clock = useRef(0);
  const live = useRef({ lost, recording });
  live.current = { lost, recording };

  useEffect(() => {
    if (!reduced) return;
    const base = preroll(frames, holdIndex);
    hud.current = lost ? feed(base, frames[holdIndex], true) : base;
    index.current = holdIndex;
    clock.current = frames[holdIndex].t_ms;
    setView({ hud: hud.current, index: holdIndex, elapsedMs: frames[holdIndex].t_ms });
  }, [frames, reduced, lost, holdIndex]);

  useEffect(() => {
    if (reduced || !running) return;
    let raf = 0;
    let last = performance.now();
    let elapsed = 0;
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      clock.current += dt;
      if (live.current.recording) elapsed += dt;
      const next = frameAt(frames, clock.current);
      if (next !== index.current) {
        // Feed every frame since the last one, across the loop, so no sample is skipped.
        let s = hud.current;
        for (let i = (index.current + 1) % frames.length; ; i = (i + 1) % frames.length) {
          s = feed(s, frames[i], live.current.lost);
          if (i === next) break;
        }
        hud.current = s;
        index.current = next;
        const add = elapsed;
        elapsed = 0;
        setView((v) => ({ hud: s, index: next, elapsedMs: v.elapsedMs + add }));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [frames, running, reduced]);

  return { hud: view.hud, phase: frames[view.index].phase, elapsedMs: view.elapsedMs };
}
