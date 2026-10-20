// The site audit: bundle sizes, the first load of `/`, frame times, memory across route changes, and a
// walk of every route at three viewports. Re-runnable against any build, so a "before" and an "after"
// come from the same script (docs/superpowers/notes/2026-10-20-overnight-site/audit.md).
//
//   npm run build && npx vite preview --port 4180 &
//   node scripts/site-audit.mjs http://localhost:4180 [--only bundle,load,frames,memory,walk]
//        [--viewports desktop,laptop,phone] [--out dir] [--shots dir] [--dist dist] [--cycles 4]
//
// It needs playwright-core, which the web app doesn't depend on: it is imported from PLAYWRIGHT_CORE
// (a path to the package, or its name; default "playwright-core"), and Chromium from CHROME
// (default /opt/pw-browsers/chromium). With no GPU, Chromium renders WebGL in software (SwiftShader):
// frame times are only comparable with each other, never with a real GPU. The site shows its 2D
// stills on a software renderer, so the 3D measurements force a tier with ?q=.
//
// Output: a JSON report and a markdown summary, printed and written to --out (default: the cwd).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const opts = { base: "http://localhost:4173", only: null, viewports: null, out: process.cwd(), shots: null, dist: path.join(HERE, "..", "dist"), cycles: 4, sample: 5000 };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const take = () => argv[++i];
    if (a === "--only") opts.only = new Set(take().split(","));
    else if (a === "--viewports") opts.viewports = new Set(take().split(","));
    else if (a === "--out") opts.out = take();
    else if (a === "--shots") opts.shots = take();
    else if (a === "--dist") opts.dist = take();
    else if (a === "--cycles") opts.cycles = +take();
    else if (a === "--sample") opts.sample = +take();
    else rest.push(a);
  }
  if (rest[0]) opts.base = rest[0].replace(/\/$/, "");
  return opts;
}

const VIEWPORTS = {
  desktop: { viewport: { width: 1920, height: 1080 } },
  laptop: { viewport: { width: 1280, height: 720 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
};

/** Every route of the site that isn't the world, in the order the walk visits them. */
export const ROUTES = ["/site/results", "/review2", "/pm/review", "/pm/results", "/pm/dataset", "/robots", "/robots/setup"];

/**
 * The loader is done: the world is mounted and its loader is at 100 (everything it waits for is in;
 * it then holds a beat before letting go, and the workshop's models start streaming), done, or gone.
 */
const READY_JS = `(() => {
  if (!document.querySelector(".world")) return false;
  const l = document.querySelector(".world-loader, .world [role=progressbar]");
  return !l || l.dataset.done === "true" || l.getAttribute("aria-valuenow") === "100";
})()`;

/**
 * The Python backend (VITE_API_BASE_URL, default :8000). The audit runs without it: the pages say so
 * and show their sample data, so a refused request there is expected, and reported apart.
 */
const BACKEND = new RegExp(process.env.BACKEND_RE || ":8000/");

/** The room view (the hub): its controls bar shows only there. */
const HUB_JS = `document.querySelector(".world-hubbar")?.dataset.on === "true"`;

// ---------------------------------------------------------------- small helpers

const kb = (n) => (n / 1024).toFixed(1);
const median = (xs) => quantile(xs, 0.5);
function quantile(xs, q) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))));
  return s[i];
}
const round = (x, d = 1) => (x === null || x === undefined ? null : Math.round(x * 10 ** d) / 10 ** d);
const gzip = (buf) => zlib.gzipSync(buf).length;

// ---------------------------------------------------------------- 1. bundle (from dist, no browser)

/** The relative static imports of a built chunk (`import"./x.js"`, `from"./x.js"`), not import(). */
export function staticImports(code) {
  const out = new Set();
  const re = /(?:^|[;\s}])(?:import|export)\s*(?:[^"'();]*?\bfrom\s*)?["']\.\/([^"']+\.js)["']/g;
  let m;
  while ((m = re.exec(code))) out.add(m[1]);
  return [...out];
}

/** The relative dynamic imports of a built chunk (`import("./x.js")`). */
export function dynamicImports(code) {
  const out = new Set();
  const re = /import\(\s*["']\.\/([^"']+\.js)["']\s*\)/g;
  let m;
  while ((m = re.exec(code))) out.add(m[1]);
  return [...out];
}

function closure(start, read) {
  const seen = new Set();
  const stack = [...start];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const d of staticImports(read(f))) stack.push(d);
  }
  return [...seen];
}

function auditBundle(dist) {
  const assets = path.join(dist, "assets");
  if (!fs.existsSync(assets)) return { error: `no build at ${dist}` };
  const files = fs.readdirSync(assets).filter((f) => /\.(js|css)$/.test(f));
  const cache = new Map();
  const read = (f) => {
    if (!cache.has(f)) cache.set(f, fs.readFileSync(path.join(assets, f)));
    return cache.get(f).toString("utf8");
  };
  const chunks = files
    .map((f) => {
      const buf = fs.readFileSync(path.join(assets, f));
      return { file: f, kind: f.endsWith(".css") ? "css" : "js", raw: buf.length, gzip: gzip(buf) };
    })
    .sort((a, b) => b.raw - a.raw);
  const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
  const entries = [...html.matchAll(/<script[^>]+src="\/assets\/([^"]+\.js)"/g)].map((m) => m[1]);
  const preloads = [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/assets\/([^"]+\.js)"/g)].map((m) => m[1]);
  const css = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="\/assets\/([^"]+\.css)"/g)].map((m) => m[1]);
  const first = closure([...entries, ...preloads], read);
  const size = (list) => list.reduce((a, f) => {
    const c = chunks.find((x) => x.file === f);
    return { raw: a.raw + (c?.raw ?? 0), gzip: a.gzip + (c?.gzip ?? 0) };
  }, { raw: 0, gzip: 0 });
  const external = [...html.matchAll(/<link[^>]+href="(https?:[^"]+)"/g)].map((m) => m[1]).filter((u) => !/preconnect/.test(u));
  return {
    chunks,
    totals: { js: size(chunks.filter((c) => c.kind === "js").map((c) => c.file)), css: size(chunks.filter((c) => c.kind === "css").map((c) => c.file)) },
    firstRequest: { entry: entries, js: first, jsSize: size(first), css, cssSize: size(css), external },
  };
}

// ---------------------------------------------------------------- the browser

async function loadPlaywright() {
  const spec = process.env.PLAYWRIGHT_CORE || "playwright-core";
  const target = spec.startsWith("/") ? pathToFileURL(fs.statSync(spec).isDirectory() ? path.join(spec, "index.mjs") : spec).href : spec;
  const mod = await import(target);
  return mod.chromium ?? mod.default.chromium;
}

const LAUNCH = {
  executablePath: process.env.CHROME || "/opt/pw-browsers/chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
};

/**
 * Runs in every page before its scripts: counts WebGL draw calls (so a frame can be told rendered or
 * idle) and keeps a weak handle on each WebGL context (so the ones still alive after a route change
 * can be counted without keeping them alive).
 */
function probe(readyJs) {
  const a = (window.__audit = { draws: 0, contexts: [], readyAt: null });
  // Every request of the visit, timed on the page's own clock (the default buffer stops at 250).
  performance.setResourceTimingBufferSize?.(5000);
  // The moment the loader lets go, to the microtask: requests started before it held up the first frame.
  const ready = new Function(`return ${readyJs}`);
  const watch = new MutationObserver(() => {
    if (a.readyAt === null && ready()) {
      a.readyAt = performance.now();
      watch.disconnect();
    }
  });
  watch.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-done", "aria-valuenow", "class"] });
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C) continue;
    for (const name of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced", "drawRangeElements"]) {
      const orig = C.prototype[name];
      if (!orig) continue;
      C.prototype[name] = function (...args) {
        a.draws++;
        return orig.apply(this, args);
      };
    }
  }
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = getContext.call(this, type, ...rest);
    if (ctx && /webgl/.test(type) && !a.contexts.some((r) => r.deref() === ctx)) a.contexts.push(new WeakRef(ctx));
    return ctx;
  };
  a.liveContexts = () => {
    let live = 0;
    let detached = 0;
    for (const r of a.contexts) {
      const c = r.deref();
      if (!c || c.isContextLost()) continue;
      live++;
      if (c.canvas && !c.canvas.isConnected) detached++;
    }
    return { created: a.contexts.length, live, detached };
  };
  /** rAF intervals over `ms`, each with the draw calls made since the last frame. */
  a.sample = (ms) =>
    new Promise((resolve) => {
      const frames = [];
      let last = performance.now();
      let draws = a.draws;
      const t0 = last;
      const tick = (now) => {
        frames.push({ dt: now - last, draws: a.draws - draws });
        last = now;
        draws = a.draws;
        if (now - t0 < ms) requestAnimationFrame(tick);
        else resolve(frames);
      };
      requestAnimationFrame(tick);
    });
}

async function newPage(browser, vp, log) {
  const ctx = await browser.newContext({ ...VIEWPORTS[vp], reducedMotion: "no-preference" });
  await ctx.addInitScript(probe, READY_JS);
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    // A refused request names its URL only in the message's location.
    const src = m.location()?.url ?? "";
    log.push({ type: m.type(), text: m.text().slice(0, 300), url: page.url(), ...(BACKEND.test(src) ? { backend: true } : {}) });
  });
  page.on("pageerror", (e) => log.push({ type: "pageerror", text: String(e.message).slice(0, 300), url: page.url() }));
  page.on("requestfailed", (r) => {
    // Aborted on navigation away is not a failure of the page.
    if (r.failure()?.errorText !== "net::ERR_ABORTED")
      log.push({ type: "requestfailed", text: `${r.url()} ${r.failure()?.errorText}`, url: page.url(), ...(BACKEND.test(r.url()) ? { backend: true } : {}) });
  });
  page.on("response", (r) => {
    if (r.status() >= 400) log.push({ type: "http", text: `${r.status()} ${r.url()}`, url: page.url() });
  });
  return { ctx, page };
}

async function waitReady(page, timeout = 120000) {
  const h = await page.waitForFunction(`${READY_JS} ? performance.now() : false`, null, { timeout, polling: 50 });
  return h.jsonValue();
}

/** In-app navigation (the router's own, no reload), so the heap carries over between routes. */
async function spaGo(page, to) {
  await page.evaluate((to) => {
    window.history.pushState({}, "", to);
    window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
  }, to);
}

/** Down the journey to the room view: the scroll ends there and the page locks. */
async function toHub(page, timeout = 150000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate(HUB_JS)) return Date.now() - t0;
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(1500);
  }
  return null;
}

// ---------------------------------------------------------------- 2. first load of /

async function auditLoad(browser, base, vp, query) {
  const log = [];
  const { ctx, page } = await newPage(browser, vp, log);
  // Cross-origin requests (the Google Fonts) report no sizes to the page: Playwright sees them.
  const external = [];
  page.on("requestfinished", async (r) => {
    if (r.url().startsWith(base) || !/^https?:/.test(r.url())) return;
    const row = { url: r.url().slice(0, 120), bytes: 0 };
    external.push(row);
    try {
      const s = await r.sizes();
      row.bytes = s.responseBodySize + s.responseHeadersSize;
    } catch {
      /* the page went away */
    }
  });
  const t0 = Date.now();
  await page.goto(`${base}/${query}`, { waitUntil: "commit" });
  let mode = "3d";
  try {
    await waitReady(page);
  } catch {
    mode = "timeout";
  }
  const wallMs = Date.now() - t0;
  if (mode !== "timeout" && (await page.evaluate(() => document.querySelector(".world-stills") !== null))) mode = "stills";
  // What streams in after the first frame (the workshop's models, the twin).
  await page.waitForTimeout(15000);
  const t = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    const res = performance.getEntriesByType("resource").map((e) => ({
      url: e.name,
      type: e.initiatorType,
      start: e.startTime,
      end: e.responseEnd,
      transfer: e.transferSize,
      decoded: e.decodedBodySize,
    }));
    if (nav) res.unshift({ url: nav.name, type: "document", start: 0, end: nav.responseEnd, transfer: nav.transferSize, decoded: nav.decodedBodySize });
    return { readyAt: window.__audit.readyAt, fcp: fcp?.startTime ?? null, res };
  });
  const local = t.res.filter((r) => r.url.startsWith(base));
  const before = local.filter((r) => t.readyAt !== null && r.start <= t.readyAt);
  const after = local.filter((r) => t.readyAt === null || r.start > t.readyAt);
  const sum = (rs, k = "transfer") => rs.reduce((a, r) => a + (r[k] || 0), 0);
  const isJs = (r) => /\.m?js(\?|$)/.test(r.url);
  const out = {
    viewport: vp,
    query,
    mode,
    readyMs: round(t.readyAt, 0),
    lastBeforeReadyEndMs: round(Math.max(0, ...before.map((r) => r.end)), 0),
    fcpMs: round(t.fcp, 0),
    wallMs,
    beforeReady: {
      requests: before.length,
      bytes: sum(before),
      decoded: sum(before, "decoded"),
      js: sum(before.filter(isJs)),
      jsDecoded: sum(before.filter(isJs), "decoded"),
      external,
      files: before.sort((a, b) => b.transfer - a.transfer).map((r) => ({ url: r.url.slice(base.length), type: r.type, bytes: r.transfer, decoded: r.decoded, startMs: round(r.start, 0) })),
    },
    after15s: {
      requests: after.length,
      bytes: sum(after),
      files: after.sort((a, b) => b.transfer - a.transfer).slice(0, 15).map((r) => ({ url: r.url.slice(base.length), bytes: r.transfer, startMs: round(r.start, 0) })),
    },
    errors: log,
  };
  await ctx.close();
  return out;
}

// ---------------------------------------------------------------- 3. frame times

function frameStats(frames) {
  const dts = frames.slice(1).map((f) => f.dt);
  const drawn = frames.filter((f) => f.draws > 0);
  // Interval between rendered frames: what the canvas actually shows.
  const rendered = [];
  let acc = 0;
  for (const f of frames.slice(1)) {
    acc += f.dt;
    if (f.draws > 0) {
      rendered.push(acc);
      acc = 0;
    }
  }
  const secs = dts.reduce((a, b) => a + b, 0) / 1000 || 1;
  return {
    frames: dts.length,
    rafMedianMs: round(median(dts)),
    rafP95Ms: round(quantile(dts, 0.95)),
    renderedPerSec: round(drawn.length / secs),
    renderedMedianMs: round(median(rendered)),
    renderedP95Ms: round(quantile(rendered, 0.95)),
    drawsPerRenderedFrame: drawn.length ? round(median(drawn.map((f) => f.draws)), 0) : 0,
  };
}

/** Samples while the pointer circles the screen, so the demand-driven canvas has a reason to draw. */
async function sampleMoving(page, vp, ms) {
  const { width, height } = VIEWPORTS[vp].viewport;
  const sampling = page.evaluate((ms) => window.__audit.sample(ms), ms);
  let done = false;
  sampling.then(() => (done = true));
  for (let i = 0; !done; i++) {
    const a = (i / 40) * Math.PI * 2;
    await page.mouse.move(width / 2 + Math.cos(a) * width * 0.25, height / 2 + Math.sin(a) * height * 0.2).catch(() => {});
    await page.waitForTimeout(50);
  }
  return frameStats(await sampling);
}

async function auditFrames(browser, base, vp, tier, ms) {
  const log = [];
  const { ctx, page } = await newPage(browser, vp, log);
  const out = { viewport: vp, tier };
  await page.goto(`${base}/?q=${tier}`);
  try {
    await waitReady(page);
    await page.waitForTimeout(4000);
    out.intro = await sampleMoving(page, vp, ms);
    const hubMs = await toHub(page);
    out.hubReachedMs = hubMs;
    if (hubMs !== null) {
      await page.waitForTimeout(3000);
      out.hub = await sampleMoving(page, vp, ms);
      // The machine: plug in and project the robot (the particle hologram).
      const machine = page.locator('.world-hubtag button[aria-label^="The machine"]');
      if (await machine.count()) {
        await machine.click({ force: true, timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(8000);
        out.machine = await sampleMoving(page, vp, ms);
      }
    }
  } catch (e) {
    out.error = String(e.message).split("\n")[0];
  }
  out.errors = log;
  await ctx.close();
  return out;
}

// ---------------------------------------------------------------- 4. memory across route changes

async function auditMemory(browser, base, cycles) {
  const log = [];
  const { ctx, page } = await newPage(browser, "laptop", log);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  const measure = async (label) => {
    await page.waitForTimeout(1500);
    for (let i = 0; i < 3; i++) await cdp.send("HeapProfiler.collectGarbage");
    const heap = await cdp.send("Runtime.getHeapUsage");
    const dom = await cdp.send("Memory.getDOMCounters").catch(() => ({}));
    const gl = await page.evaluate(() => window.__audit.liveContexts());
    return { label, heapMb: round(heap.usedSize / 1048576, 2), nodes: dom.nodes, listeners: dom.jsEventListeners, documents: dom.documents, gl };
  };
  const points = [];
  const world = async () => {
    await spaGo(page, "/?q=high");
    await waitReady(page).catch(() => {});
    await page.waitForTimeout(3000);
  };
  await page.goto(`${base}/?q=high`);
  await waitReady(page).catch(() => {});
  await page.waitForTimeout(3000);
  points.push(await measure("start /"));
  for (let c = 1; c <= cycles; c++) {
    await spaGo(page, "/site/results");
    await page.waitForTimeout(2500);
    if (c === 1) points.push(await measure("c1 /site/results"));
    await spaGo(page, "/review2");
    await page.waitForTimeout(2500);
    if (c === 1) points.push(await measure("c1 /review2"));
    await world();
    points.push(await measure(`cycle ${c} /`));
  }
  // And away from the world for good: what's left of it.
  await spaGo(page, "/site/results");
  await page.waitForTimeout(2500);
  points.push(await measure("end /site/results"));
  const cyc = points.filter((p) => p.label.startsWith("cycle"));
  const out = {
    points,
    growthPerCycleMb: cyc.length > 1 ? round((cyc[cyc.length - 1].heapMb - cyc[0].heapMb) / (cyc.length - 1), 2) : null,
    errors: log,
  };
  await ctx.close();
  return out;
}

// ---------------------------------------------------------------- 5. the walk

/** What's wrong on the page right now: blank, sideways overflow, things off the right edge. */
async function inspect(page) {
  return page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const root = document.getElementById("root");
    const text = (root?.innerText ?? "").trim().length;
    const media = root?.querySelectorAll("canvas, img, svg, video").length ?? 0;
    const off = [];
    for (const el of root?.querySelectorAll("*") ?? []) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(el);
      // Hidden (by an ancestor's opacity too) or decoration that takes no clicks: not a layout problem.
      if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      if (cs.visibility === "hidden" || (cs.position === "fixed" && cs.pointerEvents === "none" && el.getAttribute("aria-hidden") === "true")) continue;
      if (r.right > w + 1 && r.left < w) {
        // Inside a scroller that clips it on purpose: fine.
        let p = el.parentElement;
        let clipped = false;
        while (p && p !== root) {
          const ps = getComputedStyle(p);
          if (/(auto|scroll|hidden|clip)/.test(ps.overflowX) && p.getBoundingClientRect().right <= w + 1) {
            clipped = true;
            break;
          }
          p = p.parentElement;
        }
        if (!clipped) off.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""} → ${Math.round(r.right - w)}px`);
      }
    }
    return {
      blank: text === 0 && media === 0,
      text,
      scrollWidth: document.documentElement.scrollWidth,
      overflowX: document.documentElement.scrollWidth > w + 1,
      offRight: [...new Set(off)].slice(0, 8),
    };
  });
}

async function walkWorld(page, base, vp, shots) {
  const steps = [];
  const shot = async (name) => shots && page.screenshot({ path: path.join(shots, `${vp}-world-${name}.png`) }).catch(() => {});
  const step = async (name, fn) => {
    const s = { route: "/", step: name };
    try {
      await fn();
      Object.assign(s, await inspect(page));
      await shot(name);
    } catch (e) {
      s.error = String(e.message).split("\n")[0];
    }
    steps.push(s);
  };
  await step("intro", async () => {
    await page.goto(`${base}/?q=high`);
    await waitReady(page);
    await page.waitForTimeout(3000);
  });
  await step("hub", async () => {
    if ((await toHub(page)) === null) throw new Error("never reached the room view");
    await page.waitForTimeout(2000);
  });
  for (const [tag, wait] of [["The shelf", 6000], ["The machine", 9000], ["The bench", 6000]]) {
    await step(tag.slice(4), async () => {
      await settleHub(page);
      const btn = page.locator(`.world-hubtag button[aria-label^="${tag}"]`);
      const box = await btn.boundingBox();
      const { width, height } = page.viewportSize();
      const seen = box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height;
      // A tag off the screen (a phone held upright frames only the shelf): the hub bar's button, if any.
      if (seen) await btn.click({ force: true, timeout: 5000 });
      else {
        const alt = page.locator(".world-hubbar__go button", { hasText: tag.slice(4) });
        if (!(await alt.isVisible().catch(() => false))) throw new Error(`"${tag}" is off the screen and has no other way in`);
        await alt.click({ force: true, timeout: 5000 });
      }
      await page.waitForTimeout(wait);
    });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(2500);
    // The shelf's browse mode can take two Escapes (a held shot, then the spiral).
    if (!(await page.evaluate(HUB_JS))) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(2500);
    }
  }
  await step("story", async () => {
    await settleHub(page);
    await page.getByRole("button", { name: "↑ Story" }).click({ force: true, timeout: 5000 });
    await page.waitForFunction(() => window.scrollY < 50, null, { timeout: 30000 });
    await page.waitForTimeout(2000);
  });
  return steps;
}

/** Back in the room view and the camera at rest: the tags have stopped moving. */
async function settleHub(page, timeout = 30000) {
  const t0 = Date.now();
  let last = "";
  while (Date.now() - t0 < timeout) {
    const now = await page.evaluate(
      (hub) => (new Function(`return ${hub}`)() ? [...document.querySelectorAll(".world-hubtag")].map((t) => { const r = t.getBoundingClientRect(); return `${Math.round(r.x)},${Math.round(r.y)}`; }).join(" ") : ""),
      HUB_JS,
    );
    if (now && now === last) return;
    last = now;
    await page.waitForTimeout(700);
  }
}

async function auditWalk(browser, base, vp, shots) {
  const log = [];
  const { ctx, page } = await newPage(browser, vp, log);
  const steps = [];
  const at = () => log.length;
  let mark = at();
  const errorsSince = () => log.slice(mark).filter((l) => l.type !== "warning");
  for (const s of await walkWorld(page, base, vp, shots)) {
    steps.push(s);
  }
  // The world's errors all land on its steps together.
  if (steps.length) steps[0].errors = errorsSince();
  for (const route of ROUTES) {
    mark = at();
    const s = { route };
    try {
      await page.goto(`${base}${route}`, { waitUntil: "load" });
      await page.waitForTimeout(3500);
      Object.assign(s, await inspect(page));
      if (shots) await page.screenshot({ path: path.join(shots, `${vp}${route.replace(/\//g, "-")}.png`) });
      // Scroll to the bottom too: layout problems often sit below the fold.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(800);
      const below = await inspect(page);
      if (below.overflowX || below.offRight.length) s.offRight = [...new Set([...(s.offRight ?? []), ...below.offRight])];
      s.overflowX = s.overflowX || below.overflowX;
    } catch (e) {
      s.error = String(e.message).split("\n")[0];
    }
    s.errors = errorsSince();
    steps.push(s);
  }
  await ctx.close();
  return steps;
}

// ---------------------------------------------------------------- the report

function markdown(r) {
  const L = [];
  const b = r.bundle;
  if (b && !b.error) {
    L.push("### Bundle", "", "| | raw KB | gzip KB |", "|---|---:|---:|");
    L.push(`| all JS (${b.chunks.filter((c) => c.kind === "js").length} chunks) | ${kb(b.totals.js.raw)} | ${kb(b.totals.js.gzip)} |`);
    L.push(`| all CSS | ${kb(b.totals.css.raw)} | ${kb(b.totals.css.gzip)} |`);
    L.push(`| JS on the first request (entry + its static imports: ${b.firstRequest.js.length} files) | ${kb(b.firstRequest.jsSize.raw)} | ${kb(b.firstRequest.jsSize.gzip)} |`);
    L.push(`| CSS on the first request | ${kb(b.firstRequest.cssSize.raw)} | ${kb(b.firstRequest.cssSize.gzip)} |`);
    L.push("", "Largest chunks:", "", "| chunk | raw KB | gzip KB |", "|---|---:|---:|");
    for (const c of b.chunks.slice(0, 12)) L.push(`| ${c.file} | ${kb(c.raw)} | ${kb(c.gzip)} |`);
    L.push("");
  }
  if (r.load?.length) {
    L.push(
      "### First load of `/` (until the loader lets go)",
      "",
      "Transferred = bytes on the wire from `vite preview` (gzip), same-origin requests started before the loader let go. The Google Fonts are counted apart.",
      "",
      "| viewport | query | mode | FCP ms | ready ms | requests | KB transferred | of it JS KB | JS KB decoded | fonts KB (external) | KB in the 15 s after |",
      "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    );
    for (const l of r.load) {
      const ext = l.beforeReady.external.reduce((a, e) => a + e.bytes, 0);
      L.push(`| ${l.viewport} | \`/${l.query}\` | ${l.mode} | ${l.fcpMs ?? "—"} | ${l.readyMs ?? "—"} | ${l.beforeReady.requests} | ${kb(l.beforeReady.bytes)} | ${kb(l.beforeReady.js)} | ${kb(l.beforeReady.jsDecoded)} | ${kb(ext)} | ${kb(l.after15s.bytes)} |`);
    }
    L.push("");
  }
  if (r.frames?.length) {
    L.push("### Frame interval (SwiftShader, relative only)", "", "rAF = every animation frame; rendered = frames the canvas drew (it renders on demand).", "", "| viewport | tier | point | rAF median ms | rAF p95 ms | rendered/s | rendered median ms | rendered p95 ms | draws/frame |", "|---|---|---|---:|---:|---:|---:|---:|---:|");
    for (const f of r.frames) {
      for (const pt of ["intro", "hub", "machine"]) {
        const s = f[pt];
        if (s) L.push(`| ${f.viewport} | ${f.tier} | ${pt} | ${s.rafMedianMs} | ${s.rafP95Ms} | ${s.renderedPerSec} | ${s.renderedMedianMs ?? "—"} | ${s.renderedP95Ms ?? "—"} | ${s.drawsPerRenderedFrame} |`);
        else if (pt !== "machine") L.push(`| ${f.viewport} | ${f.tier} | ${pt} | — | — | — | — | — | ${f.error ?? "not reached"} |`);
      }
    }
    L.push("");
  }
  if (r.memory) {
    L.push("### Memory across `/` → `/site/results` → `/review2` → `/` (after forced GC)", "", "| point | JS heap MB | DOM nodes | listeners | WebGL live (detached) / created |", "|---|---:|---:|---:|---|");
    for (const p of r.memory.points) L.push(`| ${p.label} | ${p.heapMb} | ${p.nodes ?? "—"} | ${p.listeners ?? "—"} | ${p.gl.live} (${p.gl.detached}) / ${p.gl.created} |`);
    L.push("", `Heap growth per cycle: ${r.memory.growthPerCycleMb} MB`, "");
  }
  if (r.walk) {
    L.push("### Route walk", "", "| viewport | route | step | blank | overflow-x | off the right edge | errors |", "|---|---|---|---|---|---|---|");
    for (const [vp, steps] of Object.entries(r.walk)) {
      for (const s of steps) {
        const backend = (s.errors ?? []).filter((e) => e.backend).length;
        const errs = (s.errors ?? [])
          .filter((e) => !e.backend)
          .map((e) => `${e.type}: ${e.text.slice(0, 80)}`)
          .concat(backend ? [`(${backend} refused by the offline backend, expected)`] : [])
          .join("<br>");
        L.push(`| ${vp} | ${s.route} | ${s.step ?? ""} | ${s.error ? "ERR " + s.error.slice(0, 60) : s.blank ? "BLANK" : ""} | ${s.overflowX ? `yes (${s.scrollWidth}px)` : ""} | ${(s.offRight ?? []).slice(0, 3).join("<br>")} | ${errs.replace(/\|/g, "/")} |`);
      }
    }
    L.push("");
  }
  return L.join("\n");
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const want = (s) => !o.only || o.only.has(s);
  const vps = Object.keys(VIEWPORTS).filter((v) => !o.viewports || o.viewports.has(v));
  const report = { base: o.base, at: new Date().toISOString() };
  const say = (m) => process.stderr.write(`[audit] ${m}\n`);
  if (want("bundle")) {
    say("bundle");
    report.bundle = auditBundle(o.dist);
  }
  const needBrowser = ["load", "frames", "memory", "walk"].some(want);
  if (needBrowser) {
    const chromium = await loadPlaywright();
    const browser = await chromium.launch(LAUNCH);
    try {
      if (o.shots) fs.mkdirSync(o.shots, { recursive: true });
      if (want("load")) {
        report.load = [];
        for (const vp of vps)
          for (const q of ["?q=high", ""]) {
            say(`load ${vp} ${q || "/"}`);
            report.load.push(await auditLoad(browser, o.base, vp, q));
          }
      }
      if (want("frames")) {
        report.frames = [];
        for (const vp of vps)
          for (const tier of ["high", "low"]) {
            say(`frames ${vp} ${tier}`);
            report.frames.push(await auditFrames(browser, o.base, vp, tier, o.sample));
          }
      }
      if (want("memory")) {
        say("memory");
        report.memory = await auditMemory(browser, o.base, o.cycles);
      }
      if (want("walk")) {
        report.walk = {};
        for (const vp of vps) {
          say(`walk ${vp}`);
          report.walk[vp] = await auditWalk(browser, o.base, vp, o.shots);
        }
      }
    } finally {
      await browser.close();
    }
  }
  const md = markdown(report);
  fs.mkdirSync(o.out, { recursive: true });
  fs.writeFileSync(path.join(o.out, "site-audit.json"), JSON.stringify(report, null, 1));
  fs.writeFileSync(path.join(o.out, "site-audit.md"), md);
  console.log(JSON.stringify(report));
  console.log("\n" + md);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
