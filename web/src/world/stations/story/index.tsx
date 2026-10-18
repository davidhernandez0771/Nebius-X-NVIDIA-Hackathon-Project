// Story (core placeholder): the title, the intro, and a scroll story with data that animates with
// the scroll. The real story beats come from the landing (T5, web/src/site/landing/copy.ts).
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import { Box, PALETTE } from "../../core/Placeholder";
import { useStationFrame } from "../../core/WorldContext";
import type { StationModule, StationOverlayProps, StationSceneProps } from "../../core/types";
import { hero } from "../../../site/landing/copy";

const BARS = 9;
const BEATS = [
  "Placeholder beat: robots learn from demonstrations, and nobody has enough.",
  "Placeholder beat: one human demo, perfected, then multiplied in simulation.",
  "Placeholder beat: every copy checked by physics before it is kept.",
];

function Scene({ frame }: StationSceneProps) {
  const bars = useRef<(Group | null)[]>([]);
  // The data placeholder: bars grow left to right as the story scrolls.
  useFrame(() => {
    bars.current.forEach((g, i) => {
      if (!g) return;
      const u = Math.min(1, Math.max(0, frame.t * 1.6 - i / BARS));
      g.scale.y = 0.05 + u * (0.6 + (i % 3) * 0.35 + i * 0.12);
    });
  });
  return (
    <group position={[3.5, -2.6, 0]}>
      {Array.from({ length: BARS }, (_, i) => (
        <group key={i} ref={(g) => (bars.current[i] = g)} position={[(i - (BARS - 1) / 2) * 1.1, 0, 0]}>
          <Box size={[0.7, 1, 0.7]} position={[0, 0.5, 0]} color={i === BARS - 1 ? PALETTE.accent : PALETTE.raised} emissive={i === BARS - 1 ? 0.4 : 0} />
        </group>
      ))}
    </group>
  );
}

function Overlay(_: StationOverlayProps) {
  const beats = useRef<(HTMLLIElement | null)[]>([]);
  useStationFrame("story", (f) => {
    const active = f.t < 0.12 ? -1 : Math.min(BEATS.length - 1, Math.floor(((f.t - 0.12) / 0.88) * BEATS.length));
    beats.current.forEach((li, i) => li && (li.dataset.on = String(i === active)));
  });
  return (
    <div className="world-panel world-panel--story">
      <h1 className="world-title">{hero.title}</h1>
      <p className="world-lede">{hero.lede}</p>
      <ol className="world-beats">
        {BEATS.map((b, i) => (
          <li key={b} ref={(el) => (beats.current[i] = el)} data-on="false">
            {b}
          </li>
        ))}
      </ol>
    </div>
  );
}

const story: StationModule = {
  id: "story",
  title: "Story",
  owner: "core (copy from T5)",
  kind: "rail",
  anchor: [0, 42, 0],
  travel: 0,
  length: 3,
  camera: (t) => ({ position: [0, 0.8 - t * 1.6, 14], target: [0, -0.6 - t * 0.6, 0], fov: 40 }),
  Scene,
  Overlay,
};

export default story;
