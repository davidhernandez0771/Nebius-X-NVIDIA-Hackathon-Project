// Descent (core): the generator. THE RING the intro ends over (the reactor's top ring) bursts into
// particles that fill the dark as the reactor goes out; the camera dives down through it, then falls in
// front of the room's open wall while every particle streams onto its point of the workshop
// (Generator.tsx). By the end the room stands there in light, and the workshop's travel materializes
// the real one over it (scene/dissolve.ts). A small mono counter at the bottom says what is happening,
// as Active Theory's loader does.
import { Suspense, useRef } from "react";
import { useStationFrame } from "../../core/WorldContext";
import type { StationModule, StationOverlayProps, StationSceneProps } from "../../core/types";
import { STILLS } from "../../scene/assets";
import { Generator } from "./Generator";
import { descentCamera, HUB_FAR } from "./path";

function Scene({ frame, quality, reduced }: StationSceneProps) {
  return (
    <Suspense fallback={null}>
      <Generator frame={frame} quality={quality} reduced={reduced} />
    </Suspense>
  );
}

function Overlay(_: StationOverlayProps) {
  const line = useRef<HTMLParagraphElement>(null);
  useStationFrame("descent", (f) => {
    if (!line.current) return;
    const pct = Math.round(Math.min(1, f.t / 0.95) * 100);
    line.current.textContent = `// building the workshop · ${String(pct).padStart(2, "0")}%`;
    line.current.style.opacity = String(f.current ? Math.min(1, f.t * 8) : 0);
  });
  return (
    <>
      <p className="world-sr">The ring breaks into particles, and they fall to build the workshop.</p>
      <p ref={line} className="world-building world-u" aria-hidden="true" />
    </>
  );
}

const descent: StationModule = {
  id: "descent",
  still: STILLS.descent,
  title: "Descent",
  owner: "core",
  kind: "rail",
  anchor: [0, 0, 0],
  // The intro ends above THE RING, looking down into it: the burst starts right there.
  travel: 0,
  length: 3,
  camera: descentCamera,
  // With reduced motion: no particles; the room view, behind the veil.
  rest: HUB_FAR,
  Scene,
  Overlay,
};

export default descent;
