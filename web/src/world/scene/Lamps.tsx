// The lamps: the workshop starts dark. Once the room has materialized out of the particles
// (scene/dissolve.ts roomWhole), the lamps sputter while the files are still arriving, then run the
// power-on flicker when everything is in (flicker.ts).
// It is a short time-driven sequence, so it asks for frames only while it plays. With reduced
// motion there is no flicker: the room stays dark until it is ready, then fades up.
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useWorld } from "../core/WorldContext";
import { roomWhole } from "./dissolve";
import { FADE_S, OFF, POWER_ON_S, fadeOn, powerOn, sputter } from "./flicker";
import { loadProgress, power, setPower } from "./power";

export function Lamps({ reduced }: { reduced: boolean }) {
  const { store } = useWorld();
  const invalidate = useThree((s) => s.invalidate);
  const onAt = useRef<number | null>(null);

  // A fresh canvas has a fresh clock: start dark again.
  useEffect(() => {
    onAt.current = null;
    power.onAt = null;
    setPower(OFF);
  }, []);

  useFrame(({ clock }) => {
    const now = clock.elapsedTime;
    const f = store.frames;
    // The room boots once it stands there whole, dark, its edges still glowing out.
    const arrived = roomWhole() || f.workbench.current;
    if (!arrived) {
      if (onAt.current === null) setPower(OFF);
      return;
    }
    const progress = loadProgress();
    if (onAt.current === null && progress >= 1) {
      onAt.current = now;
      power.onAt = now;
    }
    let level: number;
    let playing: boolean;
    if (onAt.current !== null) {
      const u = now - onAt.current;
      level = reduced ? fadeOn(u) : powerOn(u);
      playing = u < (reduced ? FADE_S : POWER_ON_S);
    } else {
      level = reduced ? OFF : sputter(now, progress);
      playing = !reduced;
    }
    setPower(playing ? level : onAt.current !== null ? 1 : level);
    if (playing) invalidate();
  });

  return null;
}
