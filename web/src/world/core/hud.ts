// What the HUD shows (backtick toggles it, or ?hud): written by the canvas a few times a second
// (Perf.tsx HudProbe), read by the DOM (Hud.tsx). Mutated in place.
export const hud = {
  fps: 0,
  /** Draw calls, triangles and points in the last rendered frame, every pass included. */
  calls: 0,
  tris: 0,
  points: 0,
  textures: 0,
  geometries: 0,
  programs: 0,
  dpr: 1,
  gpu: "",
  /** The JS heap in MB (Chromium only), or null. */
  heapMb: null as number | null,
  /** "auto" while the auto-tune measures, then what it decided. */
  tune: "",
};
