import { describe, expect, it, vi } from "vitest";
import { HandAssetError, checkHandAssets, loadFailureMessage } from "./assets";

const PATHS = ["/mediapipe/wasm/vision_wasm_internal.js", "/mediapipe/wasm/vision_wasm_internal.wasm", "/models/hand_landmarker.task"];

/** A server holding these files; anything else gets the dev server's index page, as Vite does. */
function server(files: Record<string, string>) {
  return vi.fn(async (path: string | URL | Request) => {
    const type = files[String(path)];
    return new Response(null, { status: 200, headers: { "content-type": type ?? "text/html" } });
  }) as unknown as typeof fetch;
}

describe("checkHandAssets", () => {
  const all = {
    [PATHS[0]]: "text/javascript",
    [PATHS[1]]: "application/wasm",
    [PATHS[2]]: "application/octet-stream",
  };

  it("passes when every file is there, asking with HEAD", async () => {
    const f = server(all);
    await expect(checkHandAssets(PATHS, f)).resolves.toBeUndefined();
    expect(vi.mocked(f).mock.calls.map((c) => [c[0], (c[1] as RequestInit).method])).toEqual(PATHS.map((p) => [p, "HEAD"]));
  });

  it("names the missing model when the server answers with its index page", async () => {
    const { [PATHS[2]]: _, ...noModel } = all;
    const err = await checkHandAssets(PATHS, server(noModel)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HandAssetError);
    expect((err as HandAssetError).path).toBe("/models/hand_landmarker.task");
    expect((err as Error).message).toBe(
      "Hand tracking couldn't load /models/hand_landmarker.task (not found: the server sent a web page instead). " +
        "Run `node web/scripts/hand-assets.mjs` (npm --prefix web run dev does it first), then reload.",
    );
  });

  it("names the first missing file and its status", async () => {
    const f = vi.fn(async () => new Response(null, { status: 404, statusText: "Not Found" })) as unknown as typeof fetch;
    await expect(checkHandAssets(PATHS, f)).rejects.toThrow(/^Hand tracking couldn't load \/mediapipe\/wasm\/vision_wasm_internal\.js \(404 Not Found\)/);
  });

  it("names the file when the request itself fails", async () => {
    const f = vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch;
    await expect(checkHandAssets(PATHS.slice(2), f)).rejects.toThrow("couldn't load /models/hand_landmarker.task (Failed to fetch)");
  });

  it("leaves a server without HEAD to the real load", async () => {
    const f = vi.fn(async () => new Response(null, { status: 405 })) as unknown as typeof fetch;
    await expect(checkHandAssets(PATHS, f)).resolves.toBeUndefined();
  });
});

describe("loadFailureMessage", () => {
  it("turns a failed script load (a bare Event) into the file that failed", () => {
    const script = document.createElement("script");
    script.src = "/mediapipe/wasm/vision_wasm_internal.js";
    const event = new Event("error");
    script.dispatchEvent(event);
    expect(String(event)).toBe("[object Event]");
    expect(loadFailureMessage(event)).toMatch(/^Hand tracking couldn't load \/mediapipe\/wasm\/vision_wasm_internal\.js \(error\)\. Run /);
  });

  it("falls back to the path it was loading when the Event has no source", () => {
    expect(loadFailureMessage(new Event("error"), "/mediapipe/wasm/vision_wasm_nosimd_internal.js")).toMatch(
      /couldn't load \/mediapipe\/wasm\/vision_wasm_nosimd_internal\.js \(error\)/,
    );
    expect(loadFailureMessage(new Event("error"))).not.toContain("[object Event]");
  });

  it("keeps an Error's message", () => {
    expect(loadFailureMessage(new Error("boom"))).toBe("boom");
    expect(loadFailureMessage("plain")).toBe("plain");
  });
});
