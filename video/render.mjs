// Renders the film (/film?render=1) frame by frame in Chrome over the DevTools protocol and pipes the frames to
// ffmpeg; no dependencies (Node 22+'s WebSocket and fetch), after web/scripts/world-perf.mjs.
//
//   node video/render.mjs <base url> <out.mp4> [from s] [to s]     frames → H.264 (no sound; video/mux.mjs adds it)
//   STILLS="3,20.5,61" node video/render.mjs <base url> <dir>      PNGs at those times, for checking
//
// Env: CHROME=<path to chrome.exe>; FFMPEG=<path to ffmpeg.exe>; HEADFUL=1 shows the window.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [, , BASE = "http://localhost:5199", OUT = "film.mp4", FROM, TO] = process.argv;
const PORT = 9341;
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const FFMPEG =
  process.env.FFMPEG ??
  "C:/Users/dhrce/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0-full_build/bin/ffmpeg.exe";
const profile = mkdtempSync(join(tmpdir(), "sant-film-"));
const chrome = spawn(
  CHROME,
  [
    ...(process.env.HEADFUL ? [] : ["--headless=new"]),
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--use-angle=d3d11",
    "--enable-gpu",
    "--ignore-gpu-blocklist",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--hide-scrollbars",
    "--window-size=1920,1080",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(path) {
  for (let i = 0; i < 80; i++) {
    try {
      return await (await fetch(`http://127.0.0.1:${PORT}${path}`)).json();
    } catch {
      await sleep(250);
    }
  }
  throw new Error("chrome did not come up");
}
const page = (await json("/json/list")).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const waiting = new Map();
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && waiting.has(msg.id)) {
    waiting.get(msg.id)(msg);
    waiting.delete(msg.id);
  }
});
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id;
    waiting.set(i, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, timeout: 120000 });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: `${BASE}/film?render=1` });
for (let i = 0; i < 240; i++) {
  if (await evaluate("!!(window.__film && window.__film.ready)").catch(() => false)) break;
  await sleep(250);
}
const info = await evaluate("({ d: window.__film.duration, fps: window.__film.fps })");
const shot = async (format) => Buffer.from((await send("Page.captureScreenshot", { format, ...(format === "jpeg" ? { quality: 95 } : {}), optimizeForSpeed: format !== "png" })).data, "base64");

if (process.env.STILLS) {
  mkdirSync(OUT, { recursive: true });
  for (const s of process.env.STILLS.split(",").map(Number)) {
    await evaluate(`window.__film.seek(${s})`);
    writeFileSync(join(OUT, `t${s.toFixed(2).padStart(7, "0")}.png`), await shot("png"));
    console.log("still", s);
  }
} else {
  const from = Number(FROM ?? 0);
  const to = Math.min(info.d, Number(TO ?? info.d));
  const n = Math.round((to - from) * info.fps);
  const ff = spawn(FFMPEG, ["-y", "-v", "error", "-f", "image2pipe", "-framerate", String(info.fps), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-tune", "animation", OUT], { stdio: ["pipe", "inherit", "inherit"] });
  const t0 = Date.now();
  for (let f = 0; f < n; f++) {
    await evaluate(`window.__film.seek(${(from + f / info.fps).toFixed(4)})`);
    const buf = await shot("jpeg");
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if (f % 150 === 0) console.log(`frame ${f}/${n} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  console.log(`wrote ${OUT}: ${n} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
ws.close();
chrome.kill();
