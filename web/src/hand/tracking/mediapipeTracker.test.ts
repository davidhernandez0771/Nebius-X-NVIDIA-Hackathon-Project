import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mp = vi.hoisted(() => ({
  createFromOptions: vi.fn(),
  camera: { video: {} as HTMLVideoElement, stream: {} as MediaStream, stop: vi.fn() },
}));
vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: {
    forVisionTasks: async (base: string) => ({ wasmLoaderPath: `${base}/vision_wasm_internal.js`, wasmBinaryPath: `${base}/vision_wasm_internal.wasm` }),
  },
  HandLandmarker: { createFromOptions: mp.createFromOptions },
}));
vi.mock("./camera", () => ({ startCamera: async () => mp.camera }));

import { createMediapipeTracker } from "./mediapipeTracker";

/** Vite's answer: the file if it's in web/public, else the index page. */
function serve(present: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => new Response(null, { headers: { "content-type": present.includes(path) ? "application/octet-stream" : "text/html" } })),
  );
}
const WASM = ["/mediapipe/wasm/vision_wasm_internal.js", "/mediapipe/wasm/vision_wasm_internal.wasm"];

describe("the MediaPipe tracker's start", () => {
  beforeEach(() => mp.createFromOptions.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  it("says which hand-tracking file is missing, before MediaPipe tries to load it", async () => {
    serve(WASM);
    const tracker = createMediapipeTracker();
    const statuses: string[] = [];
    tracker.onStatus((s) => statuses.push(s));
    await expect(tracker.start()).rejects.toThrow(/^Hand tracking couldn't load \/models\/hand_landmarker\.task /);
    expect(mp.createFromOptions).not.toHaveBeenCalled();
    expect(statuses[statuses.length - 1]).toBe("error");
    tracker.cleanup();
  });

  it("turns MediaPipe's bare Event into the file it was loading", async () => {
    serve([...WASM, "/models/hand_landmarker.task"]);
    mp.createFromOptions.mockRejectedValueOnce(new Event("error"));
    const tracker = createMediapipeTracker();
    const err = await tracker.start().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/^Hand tracking couldn't load \/mediapipe\/wasm\/vision_wasm_internal\.js \(error\)/);
    tracker.cleanup();
  });
});
