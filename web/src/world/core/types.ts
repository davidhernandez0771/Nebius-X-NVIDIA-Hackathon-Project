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

export type StationId = "story" | "descent" | "workshop" | "machine" | "zoom" | "workbench";

/** The scroll rail, top to bottom. The workbench is a branch: reached with goTo(), not by scrolling. */
export const RAIL_ORDER = ["story", "descent", "workshop", "machine", "zoom"] as const satisfies readonly StationId[];
export const BRANCHES = ["workbench"] as const satisfies readonly StationId[];

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
  /** The camera through the dwell, t 0–1, local to `anchor`. Use still() for a fixed shot. */
  camera: (t: number) => CameraPose;
  /** The one pose used when motion is reduced (default: camera(0.5)). */
  rest?: CameraPose;
  /** react-three-fiber content, mounted once inside a <group position={anchor}>. */
  Scene?: ComponentType<StationSceneProps>;
  /** DOM over the canvas: copy, controls and the keyboard path for anything clickable in 3D. */
  Overlay?: ComponentType<StationOverlayProps>;
}
