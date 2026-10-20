// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODEL_PIN, MODEL_URL, copyWasm, ensureModel, worktreeModels } from "./hand-assets.mjs";

const MODEL = Buffer.from("a pinned hand model");
const PIN = { bytes: MODEL.length, sha256: createHash("sha256").update(MODEL).digest("hex") };
let web;

function put(path, data) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, data);
}
const modelPath = () => join(web, "public", "models", "hand_landmarker.task");

beforeEach(() => {
  web = mkdtempSync(join(tmpdir(), "hand-assets-"));
});
afterEach(() => rmSync(web, { recursive: true, force: true }));

describe("copyWasm", () => {
  const wasm = () => join(web, "node_modules", "@mediapipe", "tasks-vision", "wasm");

  it("copies the package's wasm files into public/mediapipe/wasm, then keeps them", () => {
    put(join(wasm(), "vision_wasm_internal.js"), "loader");
    put(join(wasm(), "vision_wasm_internal.wasm"), "binary");
    expect(copyWasm(web)).toMatchObject({ copied: 2, kept: 0 });
    const dest = join(web, "public", "mediapipe", "wasm");
    expect(readdirSync(dest).sort()).toEqual(["vision_wasm_internal.js", "vision_wasm_internal.wasm"]);
    expect(readFileSync(join(dest, "vision_wasm_internal.js"), "utf8")).toBe("loader");
    expect(copyWasm(web)).toMatchObject({ copied: 0, kept: 2 });
    put(join(wasm(), "vision_wasm_internal.js"), "a newer loader");
    expect(copyWasm(web)).toMatchObject({ copied: 1, kept: 1 });
  });

  it("refuses without node_modules, and says to install them", () => {
    expect(() => copyWasm(web)).toThrow(/npm --prefix web ci/);
  });
});

describe("ensureModel", () => {
  const never = vi.fn(async () => {
    throw new Error("no download expected");
  });

  it("keeps a model already there, without downloading", async () => {
    put(modelPath(), MODEL);
    expect(await ensureModel(web, { candidates: [], fetchBytes: never, pin: PIN })).toMatchObject({ how: "kept" });
    expect(never).not.toHaveBeenCalled();
  });

  it("copies the pinned model from another worktree, skipping one that isn't it", async () => {
    const other = mkdtempSync(join(tmpdir(), "hand-assets-other-"));
    try {
      const wrong = join(other, "a.task");
      const right = join(other, "b.task");
      put(wrong, Buffer.from("not the pinned model"));
      put(right, MODEL);
      const got = await ensureModel(web, { candidates: [wrong, right], fetchBytes: never, pin: PIN });
      expect(got).toMatchObject({ how: "copied", from: right });
      expect(readFileSync(modelPath())).toEqual(MODEL);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("downloads the pinned URL when no worktree has it", async () => {
    const fetchBytes = vi.fn(async () => MODEL);
    expect(await ensureModel(web, { candidates: [], fetchBytes, pin: PIN })).toMatchObject({ how: "downloaded", from: MODEL_URL });
    expect(fetchBytes).toHaveBeenCalledWith(MODEL_URL);
    expect(readFileSync(modelPath())).toEqual(MODEL);
  });

  it("refuses a download that isn't the pinned model (a web page, say) and leaves nothing behind", async () => {
    const fetchBytes = vi.fn(async () => Buffer.from("<!doctype html>"));
    await expect(ensureModel(web, { candidates: [], fetchBytes, pin: PIN })).rejects.toThrow(/not the pinned model/);
    expect(existsSync(modelPath())).toBe(false);
    expect(existsSync(`${modelPath()}.part`)).toBe(false);
  });

  it("pins float16/1, the model the other checkouts hold", () => {
    expect(MODEL_URL).toMatch(/\/hand_landmarker\/float16\/1\/hand_landmarker\.task$/);
    expect(MODEL_PIN).toEqual({ bytes: 7819105, sha256: "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1" });
  });
});

describe("worktreeModels", () => {
  it("finds nothing outside a git checkout", () => {
    expect(worktreeModels(web)).toEqual([]);
  });
});
