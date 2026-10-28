// The contact glow: the sim's hardest arm push on the bin or the table (sim_twin "contact", from the success check's
// contact sensors: sim_worker/teleop_isaac.py read_contact) as a colour on the twin's link that pushes, and a quiet
// force bar on /record. Live webcam demos pressed into the bin at 75-927 N and the person never knew: there is no
// feeling of pushing, so the twin shows it. Amber from a touch, red over the success check's 5 N collision limit.

export type TwinContact = {
  forceN: number;
  /** The robot link pushing hardest (the twin's URDF link name); null when nothing touches. */
  body: string | null;
  against: "bin" | "table" | null;
};

export const TOUCH_N = 0.5; // below this nothing glows: a graze, solver noise
export const COLLISION_N = 5; // demo_pipeline/success.py COLLISION_FORCE_N: above it the check calls it a collision
export const BAR_MAX_N = 1000; // the bar's top (the worst webcam demo pushed 927 N)

export const GLOW = { touch: "#FFB000", collision: "#FF2D2D" } as const; // the hologram's amber (--rg-hold), a red

export type ContactLevel = "none" | "touch" | "collision";

export function contactLevel(forceN: number): ContactLevel {
  if (!(forceN >= TOUCH_N)) return "none"; // also NaN
  return forceN > COLLISION_N ? "collision" : "touch";
}

/** Where a force sits on the bar, 0..1, on a log scale from TOUCH_N to BAR_MAX_N (so 5 N and 500 N both read). */
export function barFraction(forceN: number): number {
  if (!(forceN > TOUCH_N)) return 0;
  const f = Math.log(forceN / TOUCH_N) / Math.log(BAR_MAX_N / TOUCH_N);
  return Math.min(1, f);
}

/** The 5 N collision mark's place on the bar. */
export const COLLISION_MARK = barFraction(COLLISION_N);

/** The glow for a force: its colour and emissive strength (brighter as it pushes harder), or none. */
export function contactGlow(forceN: number): { level: ContactLevel; color: string | null; intensity: number } {
  const level = contactLevel(forceN);
  if (level === "none") return { level, color: null, intensity: 0 };
  if (level === "touch") return { level, color: GLOW.touch, intensity: 0.35 + 0.35 * (barFraction(forceN) / COLLISION_MARK) };
  const over = (barFraction(forceN) - COLLISION_MARK) / (1 - COLLISION_MARK); // 0 at 5 N, 1 at BAR_MAX_N and above
  return { level, color: GLOW.collision, intensity: 0.8 + 0.8 * over };
}

/** A link name for people: panda_hand -> hand, panda_link4 -> link 4, panda_leftfinger -> left finger. */
export function bodyLabel(body: string): string {
  return body
    .replace(/^(panda|openarm)_/, "")
    .replace(/^(left|right)_?finger/, "$1 finger")
    .replace(/^link(\d)/, "link $1")
    .replace(/_/g, " ");
}

/** "7.3 N · hand on the bin", or "no contact". */
export function contactText(c: TwinContact | null): string {
  if (!c || contactLevel(c.forceN) === "none") return "no contact";
  const n = c.forceN >= 100 ? Math.round(c.forceN).toString() : c.forceN.toFixed(1);
  const who = c.body ? bodyLabel(c.body) : "arm";
  return `${n} N · ${who}${c.against ? ` on the ${c.against}` : ""}`;
}
