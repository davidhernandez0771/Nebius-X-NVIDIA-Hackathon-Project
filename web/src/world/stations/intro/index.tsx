// Intro (core): the opening, a station before the workshop. The slash-cartridge loader runs on real
// progress; then the logo (the mark and two plumes, as particles) gathers in front of the iridescent
// ring. Scrolling plays the story beats over it while the particles fly up and settle as the roof's
// lattice over the ceiling, and the ring becomes the skylight's rim; the camera turns round the logo
// and ends on Blender's "Descent" stop, looking down through the skylight. Dust drifts through all of it.
import { useRef } from "react";
import { through } from "../../core/rail";
import { useStationFrame } from "../../core/WorldContext";
import type { StationModule, StationOverlayProps } from "../../core/types";
import { STILLS } from "../../scene/assets";
import { Beats } from "../../ui/Beats";
import { hero } from "../../../site/landing/copy";
import { INTRO_STOPS } from "./layout";
import { Loader } from "./Loader";
import { IntroScene } from "./Scene";
import "./intro.css";

function Overlay(_: StationOverlayProps) {
  const hint = useRef<HTMLParagraphElement>(null);
  useStationFrame("intro", (f) => {
    if (hint.current) hint.current.style.opacity = String(1 - Math.min(1, f.t * 12));
  });
  return (
    <>
      <Loader />
      <h1 className="world-sr">{hero.title}</h1>
      <p ref={hint} className="world-hint world-u">
        Scroll down
      </p>
      <Beats
        station="intro"
        beats={[
          {
            from: 0.07,
            to: 0.38,
            children: (
              <>
                <h2 data-scramble>One human demo.</h2>
                <p>A webcam, a hand, one try at a task. No robot in the room, no teleop rig.</p>
              </>
            ),
          },
          {
            from: 0.38,
            to: 0.69,
            children: (
              <>
                <h2 data-scramble>Checked by physics.</h2>
                <p>Isaac Lab replays the demo, finds the step where the cube slipped, and fixes the grasp.</p>
              </>
            ),
          },
          {
            from: 0.69,
            to: 1,
            children: (
              <>
                <h2 data-scramble>Multiplied.</h2>
                <p>One demo becomes a hundred. Every copy is physics-checked before it may become training data.</p>
              </>
            ),
          },
        ]}
      />
    </>
  );
}

const intro: StationModule = {
  id: "intro",
  still: STILLS.intro,
  title: "Story",
  owner: "core",
  kind: "rail",
  anchor: [0, 0, 0],
  travel: 0,
  length: 3,
  camera: through(...INTRO_STOPS),
  rest: INTRO_STOPS[0],
  // The roof lattice, the skylight ring and the dust stay drawn along the whole rail.
  reach: 4,
  Scene: IntroScene,
  Overlay,
};

export default intro;
