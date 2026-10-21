import { describe, expect, it } from "vitest";
import { demoName, rejectedText, clockDuration, footageAt, parseFootage, parseSet, parseSets, reasonText, repairText, stepAt, verdictOf, viewsOf, whatChanged } from "./model";

const V = (over: Record<string, unknown> = {}) => ({
  success: true, reasons: [], duration: 8.34, path_length: 1.0109, max_contact_force: 0, settle_time: 1.4, ...over,
});

const SET = {
  name: "mouse20261020",
  input: "mouse",
  repair: "rules",
  demos: [
    {
      id: "human_20261020183738_00ab", live: true, live_frames: 418,
      replay: { ...V(), frames: 418 },
      repair: {
        status: "perfected", decision: "repair", diagnosis_source: "rules", output_id: "human_20261020183738_00ab_rules",
        repairs: [{ t0: 0.76, t1: 7.68, op: "trim" }, { t0: 4, t1: 4.5, op: "smooth", strength: "med" }],
        issues: [{ type: "jitter", evidence: "jerk_rms above 20 m/s^3 over [4.00, 4.50] s", t0: 4, t1: 4.5 }],
        before: V(), after: V({ duration: 6.92, path_length: 1.0094, settle_time: 0.74 }),
      },
      repaired: { id: "human_20261020183738_00ab_rules", success: true, frames: 347 },
      variants: [
        { id: "human_20261020183738_00ab_rules_home_m3100", seed: 3100, success: true, reasons: [], frames: 404 },
        { id: "human_20261020183738_00ab_rules_home_m3101", seed: 3101, success: false, reasons: ["dropped"], frames: 0 },
        { id: null, seed: 3102, success: false, reasons: ["not_in_bin"], frames: 0 },
      ],
    },
    {
      id: "human_x", live: false, live_frames: 0,
      replay: { ...V({ success: false, reasons: ["not_in_bin", "collision"], max_contact_force: 311.9 }), frames: 500 },
      repair: { status: "discarded", decision: "discard", diagnosis_source: "rules", output_id: null, repairs: [], issues: [], before: V({ success: false }), after: null },
      repaired: null,
      variants: [],
    },
  ],
};

describe("the showcase's data", () => {
  it("names a demo by when it was recorded, in the viewer's time zone (ids are UTC)", () => {
    expect(demoName("human_20261020183738_00ab", "America/New_York")).toBe("Oct 20, 14:37:38");
    expect(demoName("human_20261020183738_00ab", "UTC")).toBe("Oct 20, 18:37:38");
    expect(demoName("human_20261021003000_abcd1234", "America/New_York")).toBe("Oct 20, 20:30:00"); // the day before
    expect(demoName("human_20261020000005_ab", "UTC")).toBe("Oct 20, 00:00:05"); // midnight is 00, not 24
    expect(demoName("variant_x")).toBe("variant_x");
  });

  it("reads the sets and one set", () => {
    const sets = parseSets([{ name: "human10c", input: "webcam", n_demos: 10, replay_verified: 0, repaired: 3, variants_verified: 24, variants_total: 30, evals: [{ cell: "perfected_multiply_10", k: 3, n: 40 }] }]);
    expect(sets[0]).toMatchObject({ name: "human10c", input: "webcam", nDemos: 10, replayVerified: 0, repaired: 3, variantsVerified: 24, variantsTotal: 30 });
    expect(sets[0].evals).toEqual([{ cell: "perfected_multiply_10", k: 3, n: 40 }]);
    const set = parseSet(SET);
    expect(set.demos).toHaveLength(2);
    expect(set.demos[0].repair?.repairs[1]).toEqual({ t0: 4, t1: 4.5, op: "smooth", strength: "med" });
    expect(() => parseSet({ name: "x" })).toThrow(/demos/);
  });

  it("gives each demo its views in story order: live, replay, repaired, then the variants", () => {
    const [a, b] = parseSet(SET).demos;
    const views = viewsOf(a);
    // A variant without a kept episode has no view (it still counts in the totals).
    expect(views.map((v) => v.kind)).toEqual(["live", "replay", "repaired", "variant", "variant"]);
    expect(views[0]).toMatchObject({ id: a.id, live: true, verdict: null, frames: 418 });
    expect(views[1]).toMatchObject({ id: a.id, live: false, frames: 418 });
    expect(views[1].verdict?.pass).toBe(true);
    expect(views[2]).toMatchObject({ id: "human_20261020183738_00ab_rules", label: "Repaired" });
    expect(views[3].label).toBe("Variant 3100");
    expect(views[4].verdict).toEqual({ pass: false, text: "Physics: failed (dropped the cube)" });
    // Without a live recording or a repair there is just the replay.
    expect(viewsOf(b).map((v) => v.kind)).toEqual(["replay"]);
  });

  it("says what physics said in words", () => {
    expect(verdictOf(V())).toEqual({ pass: true, text: "Physics: verified" });
    expect(verdictOf(V({ success: false, reasons: ["not_in_bin", "collision"] })).text).toBe("Physics: failed (cube not in the bin, arm pressed on the bin or table)");
    expect(reasonText("something_new")).toBe("something new");
    expect(rejectedText(["not_in_bin", "collision"])).toBe("cube not in the bin, arm pressed on the bin or table");
  });

  it("lists what the repair changed, before and after, with the change", () => {
    const rows = whatChanged(parseSet(SET).demos[0].repair!);
    expect(rows.map((r) => r.label)).toEqual(["Duration", "Path length", "Peak contact force", "Settle time"]);
    expect(rows[0]).toEqual({ label: "Duration", before: "8.34 s", after: "6.92 s", change: "−1.42 s" });
    expect(rows[1]).toEqual({ label: "Path length", before: "1.011 m", after: "1.009 m", change: "−0.002 m" });
    expect(rows[2]).toEqual({ label: "Peak contact force", before: "0 N", after: "0 N", change: "same" });
    expect(whatChanged(parseSet(SET).demos[1].repair!)).toEqual([]);
  });

  it("describes each repair in a line", () => {
    expect(repairText({ t0: 0.76, t1: 7.68, op: "trim" })).toBe("Trimmed to 0.76–7.68 s (idle start and end cut)");
    expect(repairText({ t0: 4, t1: 4.5, op: "smooth", strength: "med" })).toBe("Smoothed 4.00–4.50 s (medium)");
    expect(repairText({ t0: 2, t1: 3, op: "remove_pause" })).toBe("Removed a pause at 2.00–3.00 s");
    expect(repairText({ t0: 2, t1: 3, op: "nudge" })).toBe("nudge at 2.00–3.00 s");
    expect(repairText({ t: 5.24, op: "release_above_bin" })).toBe("Released the cube above the bin at 5.24 s, off the rim");
    expect(repairText({ t: 2.12, op: "recenter_grasp" })).toBe("Re-centred the grasp on the cube at 2.12 s");
    expect(repairText({ t: 1.6, op: "retime_grasp" })).toBe("Slowed the grasp at 1.60 s: hover, slow last 4 cm, stop, close, hold, lift straight");
    expect(repairText({ op: "nudge" })).toBe("nudge");
  });

  it("maps the shared clock to each view's step and footage frame", () => {
    expect(stepAt(0, 418, 50)).toBe(0);
    expect(stepAt(1, 418, 50)).toBe(50);
    expect(stepAt(99, 418, 50)).toBe(417); // holds the last step
    const meta = parseFootage({ frames: 202, stride: 2, cols: 16, tile: [128, 128], fps: 50, url: "/showcase/x/sprite.jpg" });
    expect(footageAt(meta, 0)).toEqual({ index: 0, x: 0, y: 0 });
    expect(footageAt(meta, 1)).toEqual({ index: 25, x: 9 * 128, y: 1 * 128 });
    expect(footageAt(meta, 1000).index).toBe(201);
    expect(clockDuration([418, 347].map((n) => n / 50))).toBeCloseTo(8.36 + 1.5);
  });
});
