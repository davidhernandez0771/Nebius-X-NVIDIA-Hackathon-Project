// Shelf scroll check in headless Chrome on SwiftShader (no GPU): vite in-process, real wheel events,
// screenshots at steps 0, 5, 10 and the last, and the camera's distance from the spiral's axis sampled
// through the scroll (window.__world3d, dev only).
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const WEB = "C:/dev/pm-t3/web";
const OUT = process.argv[2];
const { createServer } = await import("file:///C:/dev/pm-t3/web/node_modules/vite/dist/node/index.js");
const server = await createServer({ root: WEB, configFile: `${WEB}/vite.config.ts`, server: { port: 5191, strictPort: true }, logLevel: "error" });
await server.listen();
const PORT = 9341;
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(OUT, "profile-"))}`,
  "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--window-size=1280,800", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { await sleep(200); } }
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }).then((d) => { if (d.error) throw new Error(method + ": " + d.error.message); return d.result; });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 }); writeFileSync(join(OUT, name), Buffer.from(s.data, "base64")); console.log("shot", name); };
const CAM = `(() => { const c = window.__world3d?.get().camera; return c ? [c.position.x, c.position.y, c.position.z] : null; })()`;
const STEP = `(async () => (await import("/src/world/stations/workshop/stepper.ts")).shelf.step)()`;
async function settle(maxMs = 60000) {
  let last = null, still = 0;
  for (let t = 0; t < maxMs; t += 400) {
    await sleep(400);
    const p = await evaluate(CAM);
    if (p && last && Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) < 1e-3) { if (++still >= 3) return p; } else still = 0;
    last = p;
  }
  return last;
}
const wheel = () => send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 640, y: 400, deltaX: 0, deltaY: 100 });

await send("Page.enable"); await send("Runtime.enable");
await send("Page.navigate", { url: "http://localhost:5191/world?quality=low" });
for (let i = 0; i < 200; i++) { await sleep(300); if (await evaluate(`!!document.querySelector(".world-skip") && !!window.__world3d`).catch(() => false)) break; }
console.log("gl", await evaluate(`(() => { const gl = window.__world3d.get().gl.getContext(); const e = gl.getExtension("WEBGL_debug_renderer_info"); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : "?"; })()`));
await evaluate(`document.querySelector(".world-skip").click()`);
for (let i = 0; i < 200; i++) { await sleep(300); if (await evaluate(`document.querySelector(".world-hubbar")?.dataset.on === "true"`)) break; }
await sleep(3000);
await evaluate(`[...document.querySelectorAll(".world-hubbar__go button")].find((b) => /shelf/i.test(b.textContent)).click()`);
console.log("step", await evaluate(STEP), "cam", (await settle()).map((v) => v.toFixed(2)).join(","));
await shot("step-00.jpg");
const radii = [];
let sampling = true;
const sampler = (async () => { while (sampling) { const p = await evaluate(CAM); if (p) radii.push(Math.hypot(p[0], p[2])); await sleep(50); } })();
for (const target of [5, 10, 23]) {
  while ((await evaluate(STEP)) < target) { await wheel(); await sleep(300); }
  const p = await settle();
  console.log("step", await evaluate(STEP), "cam", p.map((v) => v.toFixed(2)).join(","), "r", Math.hypot(p[0], p[2]).toFixed(2));
  await shot(`step-${String(target).padStart(2, "0")}.jpg`);
}
sampling = false; await sampler;
console.log("samples", radii.length, "camera r min", Math.min(...radii).toFixed(2), "max", Math.max(...radii).toFixed(2));
chrome.kill(); await server.close(); process.exit(0);
