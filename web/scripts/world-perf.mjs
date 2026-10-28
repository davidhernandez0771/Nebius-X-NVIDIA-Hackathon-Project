// Measures /world in a headless Chrome over the DevTools protocol, with no dependencies (Node 22+'s
// WebSocket and fetch). The page must be the dev server (it reads the dev-only window.__world3d).
// See docs/superpowers/notes/2026-10-18-world-workshop.md for what it measures and the numbers.
//
//   npm --prefix web run dev -- --port 5186
//   node web/scripts/world-perf.mjs http://localhost:5186 perf.json [cpuThrottle]
//
// Env: TIERS=low,high,ultra (default all); CHROME=<path to chrome.exe>;
//   MODE=parts  GPU time with each part hidden (PARTS=..., BIG=WxH also renders at that CSS size);
//   MODE=shot   SHOTS="name:vh,..." screenshots (REDUCED=1, CLICK="x,y" CLICK_AT=name for a click);
//   MODE=load   frames of the load sequence on a throttled network (KBPS, STEP ms, N frames);
//   MODE=hold   frame and GPU time holding scroll positions (AT="name:vh,...", default the hero; SECONDS);
//   MODE=reveal the opening, RUNS fresh loads per tier: the loader's timeline, then for HOLD s after it lets go
//               (holding the hero) the worst frame, frames over 16.7 ms, the stall (the sum over 16.7 ms) and the
//               main thread's long tasks.
// W, H, DPR: the viewport (default 1280 x 800 at 1.5); HEADFUL=1: a visible window instead of headless.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [, , BASE = "http://localhost:5186", OUT = "perf.json", THROTTLE = "1"] = process.argv;
const PORT = 9333;
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = mkdtempSync(join(process.env.PERF_TMP ?? tmpdir(), "world-perf-"));
const chrome = spawn(CHROME, [
  // HEADFUL=1: a visible window (what a person sees), else headless.
  ...(process.env.HEADFUL ? [] : ["--headless=new"]),
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "--use-angle=d3d11",
  "--enable-gpu",
  "--ignore-gpu-blocklist",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  `--window-size=${process.env.W ?? 1280},${process.env.H ?? 800}`,
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(path) {
  for (let i = 0; i < 50; i++) {
    try {
      return await (await fetch(`http://127.0.0.1:${PORT}${path}`)).json();
    } catch {
      await sleep(200);
    }
  }
  throw new Error("chrome did not come up");
}

const targets = await json("/json/list");
const page = targets.find((t) => t.type === "page");
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
await send("Performance.enable");
await send("Runtime.enable");
// A mid laptop's screen by default: 1280 x 800 CSS px at 1.5x (1920 x 1200 device px); W, H, DPR override it.
const W = Number(process.env.W ?? 1280), H = Number(process.env.H ?? 800), DPR = Number(process.env.DPR ?? 1.5);
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
await send("Emulation.setCPUThrottlingRate", { rate: Number(THROTTLE) });

// The in-page probe: wraps the renderer to time each frame on the GPU (EXT_disjoint_timer_query_webgl2)
// and count draw calls; rAF deltas give the frame rate the page actually got.
const PROBE = String.raw`
window.__perf = async function (opts) {
  const st = window.__world3d.get();
  const r = st.gl, ctx = r.getContext();
  const ext = ctx.getExtension("EXT_disjoint_timer_query_webgl2");
  const gpu = [], cpu = [], calls = [], tris = [], frames = [], pending = [];
  const empty = opts.empty ? new st.scene.constructor() : null;
  const orig = r.render;
  r.render = function (s, c) {
    let q = null;
    if (ext) { q = ctx.createQuery(); ctx.beginQuery(ext.TIME_ELAPSED_EXT, q); }
    const c0 = performance.now();
    orig.call(r, empty ?? s, c);
    cpu.push(performance.now() - c0);
    if (q) { ctx.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q); }
    calls.push(r.info.render.calls); tris.push(r.info.render.triangles);
  };
  const vh = innerHeight;
  const t0 = performance.now();
  let last = t0;
  await new Promise((done) => {
    const tick = (now) => {
      frames.push(now - last); last = now;
      const u = (now - t0) / (opts.seconds * 1000);
      if (opts.from !== undefined) window.scrollTo(0, (opts.from + (opts.to - opts.from) * Math.min(1, u)) * vh);
      for (let i = pending.length - 1; i >= 0; i--) {
        const q = pending[i];
        if (ctx.getQueryParameter(q, ctx.QUERY_RESULT_AVAILABLE)) {
          if (!ctx.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(ctx.getQueryParameter(q, ctx.QUERY_RESULT) / 1e6);
          ctx.deleteQuery(q); pending.splice(i, 1);
        }
      }
      if (u < 1) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
  });
  r.render = orig;
  const stat = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { n: a.length, mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2), p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2), max: +s[s.length - 1].toFixed(2) }; };
  const rendered = calls.length;
  return { seconds: opts.seconds, rendered, renderedPerSec: +(rendered / opts.seconds).toFixed(1), frameMs: stat(frames.slice(2)), gpuMs: stat(gpu), renderCpuMs: stat(cpu), drawCalls: stat(calls), triangles: stat(tris), timerQuery: !!ext,
    canvas: [ctx.drawingBufferWidth, ctx.drawingBufferHeight], memory: { geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs?.length } };
};
"ok"`;

const results = { base: BASE, cpuThrottle: Number(THROTTLE), screen: `${W}x${H} CSS at ${DPR}x`, runs: {} };

async function open(url) {
  await send("Page.navigate", { url });
  for (let i = 0; i < 100; i++) {
    await sleep(200);
    const ok = await evaluate("!!window.__world3d || !!document.querySelector('.world-stills')").catch(() => false);
    if (ok) break;
  }
  await evaluate(PROBE);
}

// What the GPU check picks here, and what it saw.
await open(`${BASE}/world`);
results.gpuCheck = await evaluate(`(() => { try { return JSON.parse(sessionStorage.getItem("world.gpu")); } catch { return null; } })()`);
results.autoTier = await evaluate(`document.querySelector('.world-canvas')?.dataset.quality ?? "stills"`);

if (process.env.MODE === "load") {
  // The load sequence on a slow network: arrive at the workshop at once, a frame every STEP ms.
  await send("Network.enable");
  await send("Network.emulateNetworkConditions", { offline: false, latency: 80, downloadThroughput: Number(process.env.KBPS ?? 600) * 1024 / 8 * 8, uploadThroughput: 100000 });
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Page.navigate", { url: `${BASE}/world?quality=${process.env.TIERS ?? "high"}` });
  for (let i = 0; i < 60; i++) { await sleep(150); if (await evaluate("document.documentElement.scrollHeight > innerHeight * 5").catch(() => false)) break; }
  await evaluate("window.scrollTo(0, 6.7 * innerHeight)");
  const t0 = Date.now();
  const step = Number(process.env.STEP ?? 500);
  for (let i = 0; i < Number(process.env.N ?? 16); i++) {
    const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 60 });
    writeFileSync(`load-${String(i).padStart(2, "0")}.jpg`, Buffer.from(shot.data, "base64"));
    if (process.env.DIAG) console.log(i, JSON.stringify(await evaluate(`(() => { const st = window.__world3d?.get(); if (!st) return null; const out = { lights: [], mats: {} , env: !!st.scene.environment, tm: st.gl.toneMapping }; st.scene.traverse(o => { if (o.isLight) out.lights.push(o.type + ":" + o.intensity.toFixed(3)); if (o.isMesh || o.isInstancedMesh) { const m = o.material; if (m && /helix:label|helix:shell/.test(o.name)) out.mats[o.name] = m.type + " env=" + m.envMapIntensity?.toFixed(3) + " color=" + m.color?.getHexString(); if (o.name === "baked:room") out.room = m.color.getHexString(); } }); return out; })()`)));
    const left = t0 + (i + 1) * step - Date.now();
    if (left > 0) await sleep(left);
  }
  console.log("models", JSON.stringify(await evaluate(`performance.getEntriesByType("resource").filter(e => e.name.includes("/world/models/")).map(e => [e.name.split("/").pop(), Math.round(e.responseEnd)])`)));
  chrome.kill();
  process.exit(0);
}

if (process.env.MODE === "shot") {
  // SHOTS="name:vh,name:vh" -> name.png at each scroll position (viewport heights); QUERY extra query.
  const tier = process.env.TIERS ?? "high";
  if (process.env.REDUCED) await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await open(`${BASE}/world?quality=${tier}${process.env.QUERY ?? ""}`);
  for (const spec of (process.env.SHOTS ?? "intro:6.7").split(",")) {
    const [name, vh] = spec.split(":");
    await evaluate(`window.scrollTo(0, ${Number(vh)} * innerHeight)`);
    await sleep(Number(process.env.WAIT ?? 4500));
    if (process.env.HOVER) {
      const [hx, hy] = process.env.HOVER.split(",").map(Number);
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hx, y: hy });
      await sleep(800);
    }
    if (process.env.CLICK && name === process.env.CLICK_AT) {
      const [cx, cy] = process.env.CLICK.split(",").map(Number);
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx, y: cy });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: cx, y: cy, button: "left", clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: cx, y: cy, button: "left", clickCount: 1 });
      for (const ms of (process.env.CLICK_SHOTS ?? "600,1400,2200,3200,4400").split(",").map(Number)) {
        await sleep(ms - (Number(process.env._last ?? 0)));
        process.env._last = String(ms);
        const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 70 });
        writeFileSync(`${name}-click-${ms}.jpg`, Buffer.from(shot.data, "base64"));
      }
    }
    const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 72 });
    writeFileSync(`${name}.jpg`, Buffer.from(shot.data, "base64"));
    console.log("shot", name);
  }
  chrome.kill();
  process.exit(0);
}

if (process.env.MODE === "parts") {
  const tier = process.env.TIERS ?? "high";
  await open(`${BASE}/world?quality=${tier}`);
  const at = Number(process.env.AT ?? 6.7);
  await evaluate(`window.scrollTo(0, ${at} * innerHeight)`);
  await sleep(7000);
  const parts = {};
  const groups = (process.env.PARTS ?? "helix,library,ribbon,baked:room,baked:shelves,baked:pedestal,baked:bench,baked:desk,baked:machine_body,station:machine").split(",");
  const measure = async (label) => { const r = await evaluate("window.__perf({ seconds: 3 })"); parts[label] = { gpu: r.gpuMs?.p50, gpu95: r.gpuMs?.p95, calls: r.drawCalls?.p50, tris: r.triangles?.p50 }; console.log(label, JSON.stringify(parts[label])); };
  await measure("all");
  { const r = await evaluate("window.__perf({ seconds: 3, empty: true })"); parts.emptyScene = { gpu: r.gpuMs?.p50, cpu: r.renderCpuMs?.p50 }; console.log("emptyScene", JSON.stringify(parts.emptyScene)); }
  { const r = await evaluate("window.__perf({ seconds: 3 })"); parts.allCpu = { gpu: r.gpuMs?.p50, cpu: r.renderCpuMs?.p50, cpu95: r.renderCpuMs?.p95, canvas: r.canvas }; console.log("allCpu", JSON.stringify(parts.allCpu)); }
  if (process.env.BIG) {
    const [bw, bh] = (process.env.BIG === "1" ? "2560x1600" : process.env.BIG).split("x").map(Number);
    await send("Emulation.setDeviceMetricsOverride", { width: bw, height: bh, deviceScaleFactor: 1.5, mobile: false });
    await sleep(2500);
    const r = await evaluate("window.__perf({ seconds: 3 })"); parts.big = { gpu: r.gpuMs?.p50, cpu: r.renderCpuMs?.p50, canvas: r.canvas }; console.log("big", JSON.stringify(parts.big));
    const e = await evaluate("window.__perf({ seconds: 3, empty: true })"); parts.bigEmpty = { gpu: e.gpuMs?.p50, cpu: e.renderCpuMs?.p50 }; console.log("bigEmpty", JSON.stringify(parts.bigEmpty));
    writeFileSync(OUT, JSON.stringify(parts, null, 2)); chrome.kill(); process.exit(0);
  }
  for (const g of groups) {
    await evaluate(`(() => { const o = window.__world3d.get().scene.getObjectByName(${JSON.stringify(g)}); if (o) o.visible = false; window.__world3d.get().invalidate(); return !!o; })()`);
    await measure("-" + g);
    await evaluate(`(() => { const o = window.__world3d.get().scene.getObjectByName(${JSON.stringify(g)}); if (o) o.visible = true; })()`);
  }
  await evaluate(`(() => { window.__world3d.get().scene.traverse(o => { if (o.isMesh && o.name !== "") {} }); const sc = window.__world3d.get().scene; sc.children.forEach(c => c.visible = false); })()`);
  await measure("nothing");
  writeFileSync(OUT, JSON.stringify(parts, null, 2));
  chrome.kill();
  process.exit(0);
}

const metrics = async () => Object.fromEntries((await send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
/** __perf plus the main thread's busy time per rendered frame (Chrome's TaskDuration over the window). */
async function measured(expr) {
  const a = await metrics();
  const r = await evaluate(expr);
  const b = await metrics();
  const busy = (b.TaskDuration - a.TaskDuration) * 1000;
  r.mainThreadMsPerFrame = r.rendered ? +(busy / r.rendered).toFixed(2) : null;
  r.mainThreadBusyPct = +((busy / (r.seconds * 1000)) * 100).toFixed(1);
  r.jsHeapMB = +(b.JSHeapUsedSize / 1048576).toFixed(1);
  return r;
}

if (process.env.MODE === "reveal") {
  // Recorded from the document's start: every frame interval, every long task, the loader's status, its reveal.
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: String.raw`(() => {
      const L = (window.__reveal = { status: [], long: [], frames: [], reveal: null });
      try { new PerformanceObserver((l) => l.getEntries().forEach((e) => L.long.push([e.startTime, e.duration]))).observe({ type: "longtask", buffered: true }); } catch {}
      let last = 0;
      const tick = (t) => { if (last) L.frames.push([t, t - last]); last = t; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      new MutationObserver(() => {
        const bar = document.querySelector(".world-loader [role=progressbar]") || document.querySelector(".world-loader[role=progressbar]");
        const loader = document.querySelector(".world-loader");
        const txt = bar ? (bar.getAttribute("aria-valuetext") || "") + " " + bar.getAttribute("aria-valuenow") : null;
        const s = L.status[L.status.length - 1];
        if (txt && (!s || s[1] !== txt)) L.status.push([Math.round(performance.now()), txt]);
        if (L.reveal === null && L.status.length && (!loader || loader.dataset.done === "true")) L.reveal = performance.now();
      }).observe(document, { subtree: true, attributes: true, childList: true });
    })();`,
  });
  const HOLD = Number(process.env.HOLD ?? 6);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  for (const tier of (process.env.TIERS ?? "high,ultra").split(",")) {
    results.runs[tier] = [];
    for (let run = 0; run < Number(process.env.RUNS ?? 3); run++) {
      await send("Network.clearBrowserCache").catch(() => {});
      // Through a blank page, so the first check below can't read the last run's page.
      await send("Page.navigate", { url: "about:blank" });
      await sleep(300);
      await send("Page.navigate", { url: `${BASE}/world?quality=${tier}` });
      await sleep(300);
      for (let i = 0; i < 240; i++) {
        await sleep(250);
        if (await evaluate("!!(window.__reveal && window.__reveal.reveal !== null)").catch(() => false)) break;
      }
      await sleep(HOLD * 1000);
      const L = await evaluate("window.__reveal");
      const inHold = (a) => a.filter(([t]) => t >= L.reveal && t <= L.reveal + HOLD * 1000);
      const frames = inHold(L.frames).map(([, d]) => d);
      const long = inHold(L.long).map(([, d]) => d);
      const r = {
        revealMs: Math.round(L.reveal),
        timeline: L.status,
        frames: frames.length,
        worstFrameMs: +Math.max(0, ...frames).toFixed(1),
        over16: frames.filter((d) => d > 16.7).length,
        stallMs: Math.round(sum(frames.map((d) => Math.max(0, d - 16.7)))),
        longTasks: long.length,
        longestTaskMs: Math.round(Math.max(0, ...long)),
        longTotalMs: Math.round(sum(long)),
      };
      results.runs[tier].push(r);
      console.log(tier, run, JSON.stringify({ reveal: r.revealMs, worst: r.worstFrameMs, over16: r.over16, stall: r.stallMs, long: r.longTasks, longest: r.longestTaskMs }));
    }
  }
  writeFileSync(OUT, JSON.stringify(results, null, 2));
  chrome.kill();
  process.exit(0);
}

if (process.env.MODE === "hold") {
  // Hold each scroll position (AT="name:vh,...", default the hero at 0) on each tier and measure it (SECONDS).
  for (const tier of (process.env.TIERS ?? "high,ultra").split(",")) {
    await open(`${BASE}/world?quality=${tier}`);
    results.runs[tier] = {};
    for (const spec of (process.env.AT ?? "hero:0").split(",")) {
      const [name, vh] = spec.split(":");
      await evaluate(`window.scrollTo(0, ${Number(vh)} * innerHeight)`);
      await sleep(Number(process.env.WAIT ?? 5000));
      const r = await measured(`window.__perf({ seconds: ${Number(process.env.SECONDS ?? 5)} })`);
      results.runs[tier][name] = r;
      console.log(tier, name, JSON.stringify({ fps: r.renderedPerSec, frame: r.frameMs?.p50, frame95: r.frameMs?.p95, gpu: r.gpuMs?.p50, gpu95: r.gpuMs?.p95, cpu: r.renderCpuMs?.p50, main: r.mainThreadMsPerFrame, calls: r.drawCalls?.p50, tris: r.triangles?.p50, canvas: r.canvas }));
    }
  }
  writeFileSync(OUT, JSON.stringify(results, null, 2));
  chrome.kill();
  process.exit(0);
}

const VH = { intro: 6.7, shelf: 8.2, machine: 9.0, plug: 9.8, projection: 10.6 };
for (const tier of (process.env.TIERS ?? "low,high,ultra").split(",")) {
  const t0 = Date.now();
  await open(`${BASE}/world?quality=${tier}`);
  // Down to the workshop and let everything load and the lamps come on.
  await evaluate(`window.scrollTo(0, ${VH.intro} * innerHeight)`);
  await sleep(6000);
  const run = { loadToLitMs: null };
  run.loaded = await evaluate(`performance.getEntriesByType("resource").filter(e => e.name.includes("/world/models/")).map(e => ({ f: e.name.split("/").pop(), kb: Math.round(e.encodedBodySize / 1024), ms: Math.round(e.duration) }))`);
  for (const [name, at] of Object.entries(VH)) {
    await evaluate(`window.scrollTo(0, ${at} * innerHeight)`);
    await sleep(2500);
    run[`hold:${name}`] = await measured(`window.__perf({ seconds: 4 })`);
  }
  // The scroll itself: from the top of the descent to most of the way into the zoom, at a steady pace.
  run.sweep = await measured(`window.__perf({ seconds: 12, from: 3, to: 11.4 })`);
  run.wallS = (Date.now() - t0) / 1000;
  results.runs[tier] = run;
  console.log(tier, JSON.stringify({ intro: run["hold:intro"].frameMs, sweepFrame: run.sweep.frameMs, sweepGpu: run.sweep.gpuMs, calls: run.sweep.drawCalls }));
}

writeFileSync(OUT, JSON.stringify(results, null, 2));
ws.close();
chrome.kill();
process.exit(0);
