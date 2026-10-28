// The lead's picture: the big test itself, one cell per scene (seeds 5400–5439), lit if the cube ended in the bin, with
// the simulated seconds it took, amber if it was dropped. Read from ./scenes.json, which scripts/build_scene_grid.py
// writes from the committed raw episode log. The cells light once, in the order the scenes ran; not with reduced motion.
import type { CSSProperties } from "react";
import { formatStat } from "../../sant/motion/format";
import { ProofCite } from "./ProofSection";
import { LEAD, V2_FAILURES } from "./proofData";
import data from "./scenes.json";

export type Scene = {
  seed: number;
  success: boolean;
  sim_s: number;
  reasons: string[];
};

export const SCENES: Scene[] = data.scenes;
export const SCENES_SOURCE: string = data.source;

/** The median of the successful scenes' simulated seconds. */
export function medianSuccessSeconds(scenes: readonly Scene[] = SCENES): number {
  const s = scenes
    .filter((x) => x.success)
    .map((x) => x.sim_s)
    .sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function SceneGrid({ goal }: { goal: number }) {
  const wins = SCENES.filter((s) => s.success).length;
  return (
    <figure className="sant-scenes" aria-labelledby="sant-scenes-t">
      <p id="sant-scenes-t" className="sant-scenes__title">
        The test, scene by scene
      </p>
      <ol className="sant-scenes__grid" aria-label={`${SCENES.length} test scenes, ${wins} in the bin`}>
        {SCENES.map((s, i) => (
          <li
            key={s.seed}
            className="sant-scenes__cell"
            data-state={s.success ? "success" : "failure"}
            style={{ "--i": i } as CSSProperties}
            aria-label={`Seed ${s.seed}: ${s.success ? `in the bin in ${formatStat(s.sim_s, 1)} s` : "dropped the cube"}`}
          >
            <span className="sant-scenes__seed sant-num">{s.seed}</span>
            <span className="sant-scenes__out sant-num">{s.success ? `${formatStat(s.sim_s, 1)} s` : "drop"}</span>
          </li>
        ))}
      </ol>
      <figcaption className="sant-scenes__key">
        <span data-state="success">
          <span className="sant-num">{wins}</span> in the bin, with the simulated seconds it took
        </span>
        <span data-state="failure">
          <span className="sant-num">{SCENES.length - wins}</span> dropped the cube and ran out of time
        </span>
        <span>
          Goal: at least <span className="sant-num">{goal}</span>
        </span>
        <span className="sant-scenes__cites">
          <ProofCite source={LEAD.result.source} prefix="Count: " />
          <ProofCite source={V2_FAILURES.source} prefix="Failures: " />
          <span className="sant-cite">
            Per scene: <code>{SCENES_SOURCE.split("/").pop()}</code>
          </span>
        </span>
      </figcaption>
    </figure>
  );
}
