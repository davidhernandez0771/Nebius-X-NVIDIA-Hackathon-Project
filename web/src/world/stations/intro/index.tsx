// Intro (core): the opening, a station before the workshop. The slash-cartridge loader runs on real
// progress; then the logo (the mark and two plumes, as particles) gathers in front of the iridescent
// ring. Scrolling plays the breaks over it (ui/Breaks.tsx: dark slabs with a slanted edge that uncover
// the problem, the four steps, the proof and what you can do, then hand the 3D back) while the
// particles fly up and settle as the roof's lattice over the ceiling, and the ring becomes the
// skylight's rim; the camera turns round the logo and ends on Blender's "Descent" stop, looking down
// through the skylight (storyline.ts spreads that over the breaks). Dust drifts through all of it.
import { useRef } from "react";
import { through } from "../../core/rail";
import { useStationFrame } from "../../core/WorldContext";
import type { StationModule, StationOverlayProps } from "../../core/types";
import { STILLS } from "../../scene/assets";
import { Breaks } from "../../ui/Breaks";
import { INTRO_STOPS } from "./layout";
import { Loader } from "./Loader";
import { IntroScene } from "./Scene";
import { SECTIONS } from "./sections";
import { INTRO_VH, story } from "./storyline";
import "./intro.css";

/** The page's one line, for the h1 (read by screen readers; the breaks carry the story). */
export const TITLE = "Show a robot once. Get the data to teach it.";

/** The camera through Blender's stops, by the story's 0–1. */
const path = through(...INTRO_STOPS);

function Overlay(_: StationOverlayProps) {
  const hint = useRef<HTMLParagraphElement>(null);
  useStationFrame("intro", (f) => {
    // Gone within the first half viewport of scroll, before the first edge comes up.
    if (hint.current) hint.current.style.opacity = String(1 - Math.min(1, f.t * INTRO_VH * 2));
  });
  return (
    <>
      <Loader />
      <h1 className="world-sr">{TITLE}</h1>
      <p ref={hint} className="world-hint world-u">
        Scroll down
      </p>
      <Breaks station="intro" length={INTRO_VH} sections={SECTIONS} />
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
  // The hero, then each break's wipe and dwell (ui/wipe.ts PLAN): about 1.5 viewports per section.
  length: INTRO_VH,
  camera: (t) => path(story(t)),
  rest: INTRO_STOPS[0],
  // The roof lattice, the skylight ring and the dust stay drawn along the whole rail.
  reach: 4,
  Scene: IntroScene,
  Overlay,
};

export default intro;
