// What the intro's breaks say (ui/Breaks.tsx), in order between the hero and the dive: the problem,
// the four steps, the proof and what you can do here. Honest numbers only: the confirmatory multiply
// run (raw 3/40 vs multiplied 17/40, same ACT policy, 40 unseen seeds, p = 0.0005), Nemotron's labels
// (40/40) and the Franka through the bring-your-robot path (30/30); scene/items.ts has the same.
import type { BreakSection } from "../../ui/Breaks";

export const SECTIONS: BreakSection[] = [
  {
    label: "01 · The problem",
    head: <h2 data-scramble>Robots need thousands of demos.</h2>,
    side: (
      <>
        <p>Teaching a robot one task takes hundreds to thousands of teleoperated demos.</p>
        <p>
          <strong>A person can show it once, with a webcam.</strong>
        </p>
      </>
    ),
  },
  {
    label: "02 · S · A · N · T",
    head: <h2 data-scramble>One demo in. A dataset out.</h2>,
    side: (
      <ol className="world-break__steps">
        <li>
          <b>S</b>
          <span>
            <strong>Simulate</strong> · the demo is replayed in Isaac Lab.
          </span>
        </li>
        <li>
          <b>A</b>
          <span>
            <strong>Augment</strong> · one demo becomes a hundred variants.
          </span>
        </li>
        <li>
          <b>N</b>
          <span>
            <strong>Neaten</strong> · physics finds the step where the cube slipped and fixes the grasp; only copies that succeed are
            kept.
          </span>
        </li>
        <li>
          <b>T</b>
          <span>
            <strong>Train</strong> · an imitation policy learns from the clean, multiplied set.
          </span>
        </li>
      </ol>
    ),
  },
  {
    label: "03 · The proof",
    className: "world-break--proof",
    head: (
      <>
        <h2 className="world-sr">Raw demos 3 of 40, multiplied 17 of 40.</h2>
        <p className="world-break__stat" aria-hidden="true">
          <b data-scramble>3/40</b>
          <span className="world-break__arrow">→</span>
          <b data-scramble>17/40</b>
        </p>
        <p className="world-break__sub world-u">Raw demos → multiplied · same ACT policy · 40 unseen seeds · p = 0.0005</p>
      </>
    ),
    side: (
      <ul className="world-break__rows">
        <li>
          <b data-scramble>40/40</b>
          <span>Nemotron labels</span>
        </li>
        <li>
          <b data-scramble>30/30</b>
          <span>Franka through the bring-your-robot path</span>
        </li>
      </ul>
    ),
  },
  {
    label: "04 · What you can do",
    head: <h2 data-scramble>Pick a cartridge.</h2>,
    side: (
      <>
        <ul className="world-break__menu">
          <li>record a demo</li>
          <li>perfect it</li>
          <li>multiply</li>
          <li>train</li>
          <li>bring your robot</li>
        </ul>
        <p className="world-break__foot">Each one is a cartridge in the workshop below. Keep scrolling.</p>
      </>
    ),
  },
];
