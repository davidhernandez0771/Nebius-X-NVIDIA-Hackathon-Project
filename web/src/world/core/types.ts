// The world's station API (docs/design/world-core.md). A station is one stop on the journey: where
// its group sits in the world, how the camera looks at it, and what it draws in 3D and in the DOM.
// Each team's module lives in its own folder under world/stations/ and exports one StationModule.
import type { ComponentType } from "react";
import type { QualityTier } from "./quality";

export type Vec3 = readonly [number, number, number];

/** Where the camera is, what it looks at, and its vertical field of view in degrees. */
export interface CameraPose {
  position: Vec3;
  target: Vec3;
  fov: number;
}

/**
 * A held shot on a path (the shelf: the spiral's steps). The rig glides `at` along `pose` toward the
 * newest value instead of flying straight to each new shot, so it passes everything in between.
 */
export interface ShotTrack {
  id: string;
  at: number;
  pose: (at: number) => CameraPose;
}

/** A shot the camera holds instead of the rail, optionally on a track. */
export interface HeldShot extends CameraPose {
  track?: ShotTrack;
}

export type StationId = "intro" | "descent" | "workshop" | "machine" | "zoom" | "workbench" | "robots";

/**
 * The scroll rail, top to bottom: the story ends in the workshop, and the scroll ends there too. In
 * the workshop the page is a game: the machine, the projection and the bench are branches, opened by
 * a click (goTo), never by scrolling.
 */
export const RAIL_ORDER = ["intro", "descent", "workshop"] as const satisfies readonly StationId[];
export const BRANCHES = ["machine", "zoom", "workbench", "robots"] as const satisfies readonly StationId[];

/**
 * A station's progress, updated in place every rendered frame (never through React state). Read it
 * inside useFrame, or in a useStationFrame() callback for the DOM.
 */
export interface StationFrame {
  /** 0–1 through the station's dwell: 0 before it, 1 after it. */
  t: number;
  /** 0–1 through the travel into the station: 1 once the camera has arrived. */
  arrive: number;
  /** The station the journey is at (for a branch: while it is open). */
  current: boolean;
  /** Current or next to it on the rail, so worth drawing. Groups that aren't near are hidden. */
  near: boolean;
}

/** A cartridge on the workshop shelf: what the machine projects, and the 2D route it opens. */
export interface Cartridge {
  id: string;
  label: string;
  route: string;
  /** Which spiral slot (layout.json `helix`) it came from, so the machine flies that one in. */
  slot?: number;
}

export interface StationSceneProps {
  frame: StationFrame;
  quality: QualityTier;
  reduced: boolean;
}

export interface StationOverlayProps {
  /** Whether this station's overlay is showing (changes only when the station changes). */
  current: boolean;
  reduced: boolean;
}

export interface StationModule {
  id: StationId;
  /** Shown in the journey rail and as the overlay's accessible name. */
  title: string;
  /** Who builds it (documentation only). */
  owner: string;
  kind: "rail" | "branch";
  /** World position of the station's group. Camera poses and the Scene are local to it. */
  anchor: Vec3;
  /** Viewport heights of scroll for the camera to travel in from the previous station (rail only). */
  travel: number;
  /** Viewport heights of scroll spent at the station (rail only). */
  length: number;
  /**
   * The camera through the travel in, t 0–1, in world coordinates, given where the previous station
   * left it. Absent: a straight eased move. A station whose travel cuts (behind a full-screen mask,
   * the workshop's dive through the skylight) says where in `cutAt`.
   */
  enter?: (t: number, from: CameraPose) => CameraPose;
  /** The travel t at which `enter` jumps, hidden by the station's own mask (rail tests skip it). */
  cutAt?: number;
  /** The camera through the dwell, t 0–1, local to `anchor`. Use still() for a fixed shot. */
  camera: (t: number) => CameraPose;
  /** The one pose used when motion is reduced (default: camera(0.5)). */
  rest?: CameraPose;
  /** react-three-fiber content, mounted once inside a <group position={anchor}>. */
  Scene?: ComponentType<StationSceneProps>;
  /** DOM over the canvas: copy, controls and the keyboard path for anything clickable in 3D. */
  Overlay?: ComponentType<StationOverlayProps>;
  /**
   * How many stations away along the rail the Scene is still drawn (default 1: the neighbours). The
   * workshop's room uses 2, so it stays behind the machine and the zoom.
   */
  reach?: number;
  /**
   * With reduced motion the camera normally holds `rest`. A station that is browsed by steps (the
   * spiral) sets this so the camera jumps to each step instead (no easing, no travel).
   */
  follow?: boolean;
  /**
   * A branch that plays (the machine's plug-in, the zoom into the projection): seconds for its frame
   * t to run 0 to 1 once it opens, with the camera on camera(t). Absent: the branch holds rest (or
   * camera(0.5)) and its t is 1.
   */
  duration?: number;
  /**
   * A held branch whose shot changes as it goes (the workbench, stage by stage): the shot now, local
   * to `anchor`, read every frame. A new key tweens the camera to it (a cut with reduced motion).
   */
  shot?: () => { key: string; pose: CameraPose };
  /** A pre-rendered still of the station, shown instead of the canvas when there is no usable GPU. */
  still?: string;
}
