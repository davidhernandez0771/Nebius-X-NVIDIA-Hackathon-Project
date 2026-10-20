import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Camera, Material, Object3D } from "three";
import { compileSafe } from "./compileSafe";

const scene = {} as Object3D;
const camera = {} as Camera;

/** A renderer whose compile() returns these materials, each with the program the map gives it. */
function fakeGl(programs: Map<Material, { isReady(): boolean | null } | undefined>, parallel = true) {
  return {
    compile: vi.fn(() => new Set(programs.keys())),
    properties: { get: (m: Material) => ({ currentProgram: programs.get(m) }) },
    extensions: { has: (n: string) => parallel && n === "KHR_parallel_shader_compile" },
  };
}

const mat = (name: string) => ({ name }) as unknown as Material;

describe("compileSafe", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves once every program is linked", async () => {
    let linked = false;
    const gl = fakeGl(new Map([[mat("a"), { isReady: () => linked }]]));
    const done = vi.fn();
    compileSafe(gl, scene, camera).then(done);
    await vi.advanceTimersByTimeAsync(50);
    expect(done).not.toHaveBeenCalled();
    linked = true;
    await vi.advanceTimersByTimeAsync(20);
    expect(done).toHaveBeenCalled();
    expect(gl.compile).toHaveBeenCalledWith(scene, camera);
  });

  it("doesn't throw for a material disposed while it waits (three's compileAsync does)", async () => {
    const programs = new Map<Material, { isReady(): boolean | null } | undefined>([
      [mat("kept"), { isReady: () => true }],
      [mat("disposed"), undefined],
    ]);
    const done = vi.fn();
    compileSafe(fakeGl(programs, false), scene, camera).then(done);
    await vi.advanceTimersByTimeAsync(20);
    expect(done).toHaveBeenCalled();
  });

  it("gives up on a program that never reports ready (a lost context)", async () => {
    const gl = fakeGl(new Map([[mat("a"), { isReady: () => null }]]));
    const done = vi.fn();
    compileSafe(gl, scene, camera, 200).then(done);
    await vi.advanceTimersByTimeAsync(150);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toHaveBeenCalled();
  });

  it("rejects when compile itself throws", async () => {
    const gl = { ...fakeGl(new Map()), compile: () => { throw new Error("no context"); } };
    await expect(compileSafe(gl, scene, camera)).rejects.toThrow("no context");
  });
});
