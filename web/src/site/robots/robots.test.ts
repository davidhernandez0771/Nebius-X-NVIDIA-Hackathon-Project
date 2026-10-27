import { describe, expect, it } from "vitest";
import { LEAD } from "../results/proofData";
import { COPIES, ROBOTS } from "./robots";

// The repo's docs, keyed "docs/…" (Vite resolves the glob at build time; nothing is bundled into the app).
const DOCS = new Set(Object.keys(import.meta.glob(["../../../../docs/**/*.md"])).map((k) => k.replace(/^(\.\.\/)+/, "")));
const hasNumber = (s: string) => /\d/.test(s.replace(/\b(7|6|5)-DOF\b/g, ""));

describe("robots data", () => {
  it("lists the six cartridges in shelf order, ending with the add slot", () => {
    expect(ROBOTS.map((r) => r.code)).toEqual(["FRANKA", "OPENARM", "RIZON", "SO-101", "PIPER", "+ ADD"]);
  });

  // site-bugs (2026-10-26): the Franka's cartridge still said "3/40 → 17/40", the scripted-demo result, while the site
  // leads with the pre-registered 30/40 on the same arm.
  it("gives the Franka its headline result, the pre-registered one-shot test, not the earlier scripted 17/40", () => {
    const franka = ROBOTS.find((r) => r.code === "FRANKA")!;
    expect(franka.note).toContain(`${LEAD.result.k}/${LEAD.result.n}`);
    expect(franka.note).not.toContain("17/40");
    expect(franka.sources.join(" ")).toMatch(/2026-10-23-bigtest-prereg\.md#L744/);
  });

  it("cites a source for every robot that shows a result", () => {
    for (const r of ROBOTS) if (hasNumber(r.note)) expect(r.sources.length, r.name).toBeGreaterThan(0);
  });

  it("points every repo citation at a file that exists", () => {
    const docs = [...ROBOTS.flatMap((r) => r.sources), ...COPIES.sources].filter((s) => !s.startsWith("http"));
    expect(docs.length).toBeGreaterThan(0);
    for (const doc of docs) expect(DOCS.has(doc.split(" (")[0]), doc).toBe(true);
  });

  it("gives each robot its own preview palette of four colours", () => {
    for (const r of ROBOTS) {
      expect(r.pal).toHaveLength(4);
      for (const c of r.pal) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(new Set(ROBOTS.map((r) => r.pal[1])).size).toBe(ROBOTS.length);
  });

  it("keeps the verified-copies count with its source", () => {
    expect(COPIES.verified).toBe(100);
    expect(COPIES.total).toBe(100);
  });
});
