// The rooms the loader builds before it lets go: every later scene whose files are in, mounted one at a
// time out of sight, then everything compiled, so no frame after the reveal stalls on a build or a shader.
import { describe, expect, it, vi } from "vitest";
import { createRoomBuilder, createRooms } from "./rooms";

function setup(filesIn: string[], { graceMs = 2000, roomTimeoutMs = 8000, budgetMs = 60000 } = {}) {
  const rooms = createRooms();
  const order = ["intro:places", "descent", "workshop", "robots"];
  const inFiles = new Set(filesIn);
  const stand = new Set<string>();
  let now = 0;
  let finishCompile: () => void = () => {};
  const compile = vi.fn(() => new Promise<void>((r) => (finishCompile = r)));
  const report = vi.fn();
  const done = vi.fn();
  const b = createRoomBuilder({
    order,
    rooms,
    filesDone: (r) => inFiles.has(r),
    standing: (r) => stand.has(r),
    compile,
    report,
    done,
    now: () => now,
    graceMs,
    roomTimeoutMs,
    budgetMs,
  });
  return { b, rooms, inFiles, stand, compile, report, done, advance: (ms: number) => (now += ms), finishCompile: () => finishCompile() };
}

describe("building the rooms under the loader", () => {
  it("mounts the scenes whose files are in, one at a time, each once the last one stands", () => {
    const s = setup(["intro:places", "descent", "workshop"]);
    s.b.tick();
    expect(s.rooms.allowed("intro:places")).toBe(true);
    expect(s.rooms.allowed("descent")).toBe(false);
    // Still mounting: nothing new.
    s.b.tick();
    expect(s.rooms.allowed("descent")).toBe(false);
    s.stand.add("intro:places");
    s.b.tick();
    expect(s.rooms.allowed("descent")).toBe(true);
    // Three to mount, then the compile: the last part of the step.
    expect(s.report).toHaveBeenLastCalledWith(1, 4);
  });

  it("then compiles everything once, and only when that has finished is it done", async () => {
    const s = setup(["intro:places", "descent"], { graceMs: 0 });
    for (const r of ["intro:places", "descent"]) {
      s.b.tick();
      s.stand.add(r);
    }
    s.b.tick();
    expect(s.compile).toHaveBeenCalledTimes(1);
    // Compiling: every room built, the step not yet done.
    expect(s.report).toHaveBeenLastCalledWith(2, 3);
    expect(s.done).not.toHaveBeenCalled();
    s.b.tick();
    expect(s.compile).toHaveBeenCalledTimes(1);
    s.finishCompile();
    await Promise.resolve();
    await Promise.resolve();
    expect(s.done).toHaveBeenCalled();
    expect(s.b.phase()).toBe("done");
  });

  it("waits a short grace for files still on their way, then leaves the rest for later", () => {
    const s = setup(["intro:places"], { graceMs: 2000 });
    s.b.tick();
    s.stand.add("intro:places");
    s.b.tick();
    // The descent's files are still coming: within the grace it waits.
    expect(s.compile).not.toHaveBeenCalled();
    s.advance(1000);
    s.inFiles.add("descent");
    s.b.tick();
    expect(s.rooms.allowed("descent")).toBe(true);
    s.stand.add("descent");
    s.advance(1500);
    s.b.tick();
    // Past the grace: the workshop and the robots, still coming, are left for after the reveal.
    expect(s.compile).toHaveBeenCalledTimes(1);
    expect(s.rooms.allowed("workshop")).toBe(false);
  });

  it("keeps the loader short on a slow device: past its budget it builds no more, compiles what it has", () => {
    const s = setup(["intro:places", "descent", "workshop", "robots"], { budgetMs: 5000 });
    s.b.tick();
    s.stand.add("intro:places");
    s.advance(3000);
    s.b.tick();
    expect(s.rooms.allowed("descent")).toBe(true);
    s.stand.add("descent");
    s.advance(2500);
    s.b.tick();
    // Past the budget: the workshop and the robots wait for after the reveal.
    expect(s.compile).toHaveBeenCalledTimes(1);
    expect(s.rooms.allowed("workshop")).toBe(false);
  });

  it("never waits for ever on a scene that doesn't stand (it threw, its boundary caught it)", () => {
    const s = setup(["intro:places", "descent"], { graceMs: 0, roomTimeoutMs: 8000 });
    s.b.tick();
    s.advance(7000);
    s.b.tick();
    expect(s.rooms.allowed("descent")).toBe(false);
    s.advance(1500);
    s.b.tick();
    expect(s.rooms.allowed("descent")).toBe(true);
  });

  it("lets go at once when told to (continue anyway): what isn't built is built later", () => {
    const s = setup(["intro:places", "descent"]);
    s.b.tick();
    s.b.release();
    expect(s.b.phase()).toBe("done");
    expect(s.done).toHaveBeenCalled();
    s.b.tick();
    expect(s.rooms.allowed("descent")).toBe(false);
  });
});

describe("the rooms after the reveal", () => {
  it("builds the next one whose files are in, one per idle moment", () => {
    const s = setup(["intro:places", "descent", "workshop"]);
    s.b.release();
    expect(s.b.idle()).toBe("intro:places");
    // Not the next until that one stands.
    expect(s.b.idle()).toBe(null);
    s.stand.add("intro:places");
    expect(s.b.idle()).toBe("descent");
  });

  it("builds a room the visitor is reaching right away, ahead of the order", () => {
    const s = setup(["intro:places", "descent", "workshop", "robots"]);
    s.b.release();
    s.b.need("robots");
    expect(s.rooms.allowed("robots")).toBe(true);
    // Its files not in yet: wanted, built as soon as they are.
    s.b.need("descent");
    expect(s.rooms.allowed("descent")).toBe(true);
  });
});

describe("the allowed rooms", () => {
  it("tells subscribers when a room is allowed, once", () => {
    const rooms = createRooms();
    const heard = vi.fn();
    rooms.subscribe(heard);
    rooms.allow("descent");
    rooms.allow("descent");
    expect(heard).toHaveBeenCalledTimes(1);
    expect(rooms.allowed("descent")).toBe(true);
    expect(rooms.list()).toEqual(["descent"]);
  });
});
