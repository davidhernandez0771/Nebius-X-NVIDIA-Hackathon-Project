// Intro (core): the opening, a station before the workshop. The slash-cartridge loader runs on real
// progress; then the SANT logo grows in as a glass object turning in a clean dark space (Scene.tsx),
// and scrolling plays the story beside it (Story.tsx: the problem, S·A·N·T, the proof, Nemotron's
// jobs), turning and leaning the logo as it goes (storyPlan.ts). At the end the logo becomes the ring,
// square to the camera; the descent bursts it into the particles that build the workshop.
import type { StationModule, StationOverlayProps } from "../../core/types";
import { STILLS } from "../../scene/assets";
import { Loader } from "./Loader";
import { IntroScene } from "./Scene";
import { Story } from "./Story";
import { cameraAt, INTRO_VH } from "./storyPlan";
import "./intro.css";

/** The page's one line, for the h1 (read by screen readers; the beats carry the story). */
export const TITLE = "Show a robot once. Get the data to teach it.";

function Overlay(_: StationOverlayProps) {
  return (
    <>
      <Loader />
      <h1 className="world-sr">{TITLE}</h1>
      <Story />
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
  // The hero, the four beats and the morph (storyPlan.ts PLAN).
  length: INTRO_VH,
  camera: (t) => cameraAt(t * INTRO_VH),
  rest: cameraAt(0),
  // Drawn while the descent bursts the ring; gone once the workshop is being built.
  reach: 1,
  Scene: IntroScene,
  Overlay,
};

export default intro;
