// Intro (core): the opening, a station before the workshop. The loader (Loader.tsx, mounted by WorldRoot
// over everything) runs on real progress; then the SANT logo grows in as a glass object in a clean dark space (Scene.tsx). Scrolling
// is a descent, like Active Theory's forest → reactor: the camera sinks below the logo onto a misty
// forest floor with robot parts in the moss (the problem), drops through a crack into an underground
// reactor that powers up as the story goes on (S·A·N·T, the proof, Nemotron), and ends above the core's
// top ring, lifted off at full power: THE RING, which the descent bursts into the particles that build
// the workshop. Timing in storyPlan.ts, the camera in path.ts, the words in Story.tsx.
import type { StationModule, StationOverlayProps } from "../../core/types";
import { STILLS } from "../../scene/assets";
import { IntroScene } from "./Scene";
import { Story } from "./Story";
import { HERO_VIEW } from "./layout";
import { cameraAt } from "./path";
import { INTRO_VH } from "./storyPlan";
import "./intro.css";

/** The page's one line, for the h1 (read by screen readers; the beats carry the story). */
export const TITLE = "Show a robot once. Get the data to teach it.";

function Overlay(_: StationOverlayProps) {
  return (
    <>
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
  // The hero, the sink, the forest, the crack, the reactor and the ring (storyPlan.ts PLAN).
  length: INTRO_VH,
  camera: (t) => cameraAt(t * INTRO_VH),
  // With reduced motion the camera holds the hero; the words still change with the scroll.
  rest: HERO_VIEW,
  // Drawn while the descent bursts the ring; gone once the workshop is being built.
  reach: 1,
  Scene: IntroScene,
  Overlay,
};

export default intro;
