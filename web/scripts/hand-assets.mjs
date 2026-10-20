// Puts the MediaPipe hand-tracking files where the Record page loads them from (web/public, git-ignored):
//   1. node_modules/@mediapipe/tasks-vision/wasm/*  ->  public/mediapipe/wasm/  (the pinned package's own files);
//   2. public/models/hand_landmarker.task, if missing: copied from another worktree of this repo that has it, else
//      downloaded (pinned float16/1, not latest). Either way it must be the pinned model's bytes (size and SHA-256).
// It runs as npm's predev, so a new worktree has them on its first `npm --prefix web run dev`. A model it can't get is a
// warning, not a failure: the site still runs, and the camera says which file is missing (src/hand/tracking/assets.ts).
// scripts/launch/fetch_mediapipe.ps1 does the same by hand.
//
//   node web/scripts/hand-assets.mjs

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
export const MODEL_PIN = { bytes: 7819105, sha256: "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1" };
const MODEL_REL = join("public", "models", "hand_landmarker.task");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const size = (path) => (existsSync(path) ? statSync(path).size : -1);

/** Copies the package's wasm files into public/mediapipe/wasm, skipping those already the same size. */
export function copyWasm(webDir) {
  const src = join(webDir, "node_modules", "@mediapipe", "tasks-vision", "wasm");
  const files = existsSync(src) ? readdirSync(src).filter((f) => statSync(join(src, f)).isFile()) : [];
  if (files.length === 0) throw new Error(`no MediaPipe wasm files in ${src}; install the web packages first: npm --prefix web ci`);
  const dest = join(webDir, "public", "mediapipe", "wasm");
  mkdirSync(dest, { recursive: true });
  let copied = 0;
  for (const f of files) {
    if (size(join(dest, f)) === statSync(join(src, f)).size) continue;
    copyFileSync(join(src, f), join(dest, f));
    copied += 1;
  }
  return { dest, copied, kept: files.length - copied };
}

/** The model in this repo's other worktrees (`git worktree list`), the main checkout among them. */
export function worktreeModels(webDir) {
  let out;
  try {
    out = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: webDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return [];
  }
  const here = resolve(webDir, MODEL_REL);
  return out
    .split(/\r?\n/)
    .filter((l) => l.startsWith("worktree "))
    .map((l) => resolve(l.slice("worktree ".length), "web", MODEL_REL))
    .filter((p) => p !== here && existsSync(p));
}

/** Downloads the model's bytes with fetch. */
export async function download(url, fetchImpl = fetch) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Makes sure public/models/hand_landmarker.task is there: kept if present, else copied from the first candidate with
 * the pinned bytes, else downloaded. Writes through a .part file, so a bad copy or download leaves nothing behind.
 * Returns { path, how: "kept" | "copied" | "downloaded", from? }; throws if it can't get the pinned model.
 */
export async function ensureModel(webDir, { candidates = worktreeModels(webDir), fetchBytes = download, url = MODEL_URL, pin = MODEL_PIN, log = () => {} } = {}) {
  const path = join(webDir, MODEL_REL);
  if (size(path) > 0) {
    if (size(path) !== pin.bytes) log(`model: ${path} is ${size(path)} bytes, not the pinned ${pin.bytes}; left as it is`);
    return { path, how: "kept" };
  }
  const pinned = (buf) => buf.length === pin.bytes && sha256(buf) === pin.sha256;
  const save = (buf) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.part`, buf);
    renameSync(`${path}.part`, path);
  };
  for (const from of candidates) {
    if (size(from) !== pin.bytes) continue;
    const buf = readFileSync(from);
    if (!pinned(buf)) continue;
    save(buf);
    return { path, how: "copied", from };
  }
  log(`model: downloading ${url}`);
  const buf = await fetchBytes(url);
  if (!pinned(buf)) throw new Error(`the download from ${url} is not the pinned model (${buf.length} bytes, sha256 ${sha256(buf).slice(0, 12)}...)`);
  save(buf);
  return { path, how: "downloaded", from: url };
}

async function main() {
  const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const w = copyWasm(webDir);
    console.log(`hand-assets: wasm: ${w.copied} copied, ${w.kept} already there (${w.dest})`);
  } catch (err) {
    console.error(`hand-assets: FAILED: ${err.message}`);
    process.exit(1);
  }
  try {
    const m = await ensureModel(webDir, { log: (s) => console.log(`hand-assets: ${s}`) });
    console.log(`hand-assets: model: ${m.how}${m.from ? ` from ${m.from}` : ""} (${m.path})`);
  } catch (err) {
    rmSync(join(webDir, `${MODEL_REL}.part`), { force: true });
    console.warn(`hand-assets: WARNING: no hand model: ${err.message}`);
    console.warn("hand-assets: the camera won't track hands until it is there; run `node web/scripts/hand-assets.mjs` again when online");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
