import { describe, expect, it, vi } from "vitest";
import { compileSafe, type Compiler } from "./compile";

function fakeGl(programs: Map<object, { isReady(): boolean } | undefined>, parallel = true): Compiler {
  return {
    compile: () => new Set(programs.keys()),
    properties: { get: (m: object) => ({ currentProgram: programs.get(m) }) },
    extensions: { get: () => (parallel ? {} : null) },
  };
}

describe("compileSafe", () => {
  it("resolves once every program is ready", async () => {
    vi.useFakeTimers();
    let ready = false;
    const gl = fakeGl(new Map([[{}, { isReady: () => ready }]]));
    let done = false;
    void compileSafe(gl, {} as never, {} as never).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(50);
    expect(done).toBe(false);
    ready = true;
    await vi.advanceTimersByTimeAsync(20);
    expect(done).toBe(true);
    vi.useRealTimers();
  });

  it("treats a material whose program is gone (disposed meanwhile) as done, instead of throwing", async () => {
    const gl = fakeGl(new Map([[{}, undefined]]));
    await expect(compileSafe(gl, {} as never, {} as never)).resolves.toBeUndefined();
  });

  it("gives up after its time limit rather than hold the loader forever", async () => {
    vi.useFakeTimers();
    const gl = fakeGl(new Map([[{}, { isReady: () => false }]]));
    let done = false;
    void compileSafe(gl, {} as never, {} as never, 1000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(1100);
    expect(done).toBe(true);
    vi.useRealTimers();
  });
});
