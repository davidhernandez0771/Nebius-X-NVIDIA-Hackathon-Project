import { describe, expect, it } from "vitest";
import { ARMS, COMPARISONS, HEADLINE, LIMITS, NOTES, PLATEAU, REPORT_CARDS, VERIFIED, cite, type Source } from "./facts";
import { wilson } from "./stats";

const one = (x: number) => (Math.round(x * 1000) / 10).toFixed(1);

function sources(value: unknown, found: Source[] = []): Source[] {
  if (Array.isArray(value)) value.forEach((v) => sources(v, found));
  else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.note === "string" && typeof o.lines === "string") found.push(o as unknown as Source);
    else Object.values(o).forEach((v) => sources(v, found));
  }
  return found;
}

describe("the arms", () => {
  it("are 0, 100 and 300 copies, in that order", () => {
    expect(ARMS.map((a) => a.copies)).toEqual([0, 100, 300]);
  });

  it("have outcome strings that add up to the counts in the note", () => {
    for (const a of ARMS) {
      expect(a.outcomes).toMatch(/^[01]+$/);
      expect(a.outcomes.length).toBe(a.n);
      expect([...a.outcomes].filter((c) => c === "1").length).toBe(a.k);
    }
    expect(ARMS.map((a) => `${a.k}/${a.n}`)).toEqual(["3/40", "17/40", "16/40"]);
  });

  it("print the CI the note printed, and it is the Wilson CI of k/n", () => {
    for (const a of ARMS) {
      const [lo, hi] = wilson(a.k, a.n);
      expect(a.ci.text).toBe(`${one(lo)}–${one(hi)}%`);
    }
  });

  it("count drops among failures, never more than the failures", () => {
    for (const a of ARMS) expect(a.drops.of).toBe(a.n - a.k);
    expect(ARMS.map((a) => `${a.drops.k} of ${a.drops.of}`)).toEqual(["15 of 37", "22 of 23", "23 of 24"]);
  });
});

describe("the sentences", () => {
  const [raw, x100, x300] = ARMS;
  const kn = (a: { k: number; n: number }) => `${a.k}/${a.n}`;

  it("quote the same counts and p as results.json", () => {
    expect(HEADLINE.text).toContain(`${kn(x100)} `);
    expect(HEADLINE.text).toContain(`vs ${kn(raw)} `);
    expect(HEADLINE.replicates).toContain(`scored ${kn(x300)} against the same ${kn(raw)} (p = ${COMPARISONS.rawVs300.p})`);
    expect(PLATEAU.text).toContain(`${kn(x100)} against ${kn(x300)}`);
    expect(PLATEAU.text).toContain(`${x300.epochs.text} times, against ${x100.epochs.text}`);
    expect(LIMITS[3].text).toContain(`${x100.drops.k} of ${x100.drops.of} failures with 100 copies, ${x300.drops.k} of ${x300.drops.of} with 300`);
  });

  it("read the p values and verified copies from results.json", () => {
    expect([COMPARISONS.rawVs100.p, COMPARISONS.rawVs300.p, COMPARISONS.x100Vs300.p]).toEqual(["0.0005", "0.0012", "1.0"]);
    expect([kn(VERIFIED.x100), kn(VERIFIED.x300)]).toEqual(["100/100", "300/300"]);
  });
});

describe("sources", () => {
  const all = sources({ ARMS, COMPARISONS, HEADLINE, LIMITS, REPORT_CARDS });

  it("are on every fact", () => {
    expect(all.length).toBeGreaterThan(20);
    for (const s of all) {
      expect(Object.keys(NOTES)).toContain(s.note);
      expect(s.lines).toMatch(/^\d+(–\d+)?(, \d+(–\d+)?)*$/);
    }
  });

  it("read as a note and its lines", () => {
    expect(cite({ note: "web", lines: "436" })).toBe("Web pages note, line 436");
    expect(cite({ note: "t3", lines: "1156" })).toBe("T3 status note, line 1156");
    expect(cite({ note: "t3", lines: "1171–1173" })).toBe("T3 status note, lines 1171–1173");
    expect(cite({ note: "t2", lines: "302–303, 368" })).toBe("T2 status note, lines 302–303, 368");
  });
});

describe("report cards", () => {
  const card = (key: string) => REPORT_CARDS.find((c) => c.key === key)!;

  it("count drops the way the arms do (R9)", () => {
    const counts = card("franka").failures!.counts!.map((c) => `${c.k} of ${c.of}`);
    expect(counts).toEqual(ARMS.slice(1).map((a) => `${a.drops.k} of ${a.drops.of}`));
  });

  it("compare copies on the same 30 scenes (B2, B3, Y3)", () => {
    const copies = ["franka", "openarm", "flexiv"].map((k) => card(k).copies!);
    expect(copies.map((c) => `${c.k}/${c.n}`)).toEqual(["30/30", "0/30", "9/30"]);
    expect(card("franka").copies!.also).toMatch(/^27\/30 in the first run.*30\/30 again through the bring-your-own-robot upload/);
    expect(card("openarm").copies!.also).toMatch(/^0\/30 again through the bring-your-own-robot upload/);
    expect(new Set(copies.map((c) => c.what)).size).toBe(1);
  });

  it("say pending, with the reason, where nothing is measured", () => {
    expect(card("franka").reach).toBeNull();
    expect(card("franka").pendingNotes?.reach).toMatch(/no reach map/i);
    for (const k of ["openarm", "flexiv"]) {
      expect(card(k).policy).toBeNull();
      expect(card(k).pendingNotes?.policy).toBeTruthy();
    }
    const yours = card("yours");
    expect([yours.copies, yours.policy, yours.failures, yours.reach]).toEqual([null, null, null, null]);
  });
});
