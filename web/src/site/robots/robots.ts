// The robots on the shelf. Every number in robots.json cites its note (or the upstream repo for the arms that
// are coming next); robots.test.ts checks that each cited repo file exists.
import data from "./robots.json";

export type TileFx = "scan" | "glitch" | "blocks" | "dots";
export type Robot = {
  id: string;
  name: string;
  code: string;
  sub: string;
  status: string;
  year: string;
  note: string;
  /** Preview palette: dark, accent, light, mid. */
  pal: [string, string, string, string];
  fx: TileFx;
  sources: string[];
};

export const ROBOTS = data.robots as Robot[];
export const COPIES = data.copies;
