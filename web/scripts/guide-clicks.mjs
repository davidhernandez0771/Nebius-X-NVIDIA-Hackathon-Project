// The first-visit guide (src/world/guide) end to end in a headless Chrome over the DevTools protocol, with REAL input:
// Input.dispatchMouseEvent / dispatchKeyEvent, never element.click(). Before each click, document.elementFromPoint at
// the click point must be the control (or inside it), so a control left in a click-through layer fails here (the
// 10-26 "Back to room" bug). SwiftShader (no GPU), a fresh profile (a first visit). No dependencies (Node 22+).
//
//   npm --prefix web run dev -- --port 5199
//   node web/scripts/guide-clicks.mjs http://localhost:5199
//
// Env: SZ=WxH (default 1280x720; under 700 wide emulates a phone), Q=low|high|stills (default low), REDUCED=1,
//   OUT=<dir> to save a screenshot of the hero and each step (EXT=jpg|png). CHROME=<path to chrome.exe>.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:5199";
const PORT = 9300 + Math.floor(Math.random() * 400);
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = mkdtempSync(join(tmpdir(), "tour-cdp-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--disable-gpu",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--window-size=1280,720",
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
const logs = [];
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && waiting.has(msg.id)) {
    waiting.get(msg.id)(msg);
    waiting.delete(msg.id);
  } else if (msg.method === "Runtime.exceptionThrown") logs.push("EXC " + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text));
  else if (msg.method === "Runtime.consoleAPICalled" && (msg.params.type === "error" || msg.params.type === "warning"))
    logs.push(msg.params.type + " " + msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
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
const size = async (w, h, mobile = false) => {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
  if (mobile) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
};
const shot = async (file) => {
  const s = await send("Page.captureScreenshot", file.endsWith(".jpg") ? { format: "jpeg", quality: 82 } : { format: "png" });
  writeFileSync(file, Buffer.from(s.data, "base64"));
  console.log("shot", file);
};
/** A real click: the mouse moves there, presses and releases (what a person does), no element.click(). */
const click = async (x, y) => {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
};
const KEYS = { Escape: 27, ArrowRight: 39, ArrowLeft: 37, Enter: 13, Tab: 9 };
const key = async (k) => {
  const code = KEYS[k];
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code: k, windowsVirtualKeyCode: code });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k, windowsVirtualKeyCode: code });
};
const waitFor = async (expr, ms = 60000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await evaluate(expr).catch(() => false)) return true;
    await sleep(250);
  }
  throw new Error("timed out waiting for " + expr);
};
const navigate = async (url) => {
  await send("Page.navigate", { url });
  await sleep(500);
};
const OUT = process.env.OUT ? process.env.OUT.replace(/[\/]?$/, "/") : "";
if (OUT) mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " " + extra : ""}`);
  if (!ok) process.exitCode = 1;
};

async function run() {
  const [w, h] = (process.env.SZ ?? "1280x720").split("x").map(Number);
  const tag = `${w}x${h}`;
  await size(w, h, w < 700);
  if (process.env.REDUCED) await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await navigate(`${BASE}/world?quality=${process.env.Q ?? "low"}`);
  await waitFor(`document.querySelector('.sant.world')?.dataset.loading === 'false'`, 180000);
  await sleep(2000);

  /** A real click on the element matching `sel` (its centre), after checking the hit test lands on it. */
  const realClick = async (sel, name) => {
    const r = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const b = el.getBoundingClientRect(); const x = b.left + b.width / 2, y = b.top + b.height / 2; const hit = document.elementFromPoint(x, y); return { x, y, hit: !!hit && (hit === el || el.contains(hit)), what: hit ? hit.className || hit.tagName : null }; })()`);
    check(`${name}: on screen`, !!r);
    if (!r) return false;
    check(`${name}: hit test lands on it`, r.hit, `(got ${JSON.stringify(r.what)})`);
    await click(r.x, r.y);
    return true;
  };

  // The hero: the offer is there.
  const offer = await evaluate(`!!document.querySelector('.world-guide-offer')`);
  check("hero offer shows on a first visit", offer);
  if (OUT) await shot(`${OUT}0-hero-offer-${tag}.${process.env.EXT ?? "png"}`);

  // Start the tour from the hero (a real click): it skips to the room and opens step 1.
  await realClick(".world-guide-offer .world-guide__btn--go", "Start the tour");
  await waitFor(`!!document.querySelector('.world-guide__card[data-placed="true"]')`, 60000);
  await sleep(900);
  for (let i = 1; i <= 4; i++) {
    const info = await evaluate(`(() => { const c = document.querySelector('.world-guide__card'); const r = c.getBoundingClientRect(); const ring = document.querySelector('.world-guide__ring'); return { title: c.querySelector('h2').textContent, count: c.querySelector('.world-guide__count').textContent, card: [r.left, r.top, r.right, r.bottom].map(Math.round), ring: ring.dataset.on, sw: document.documentElement.scrollWidth, vw: innerWidth, pe: getComputedStyle(c).pointerEvents }; })()`);
    console.log(i, JSON.stringify(info));
    check(`step ${i} card inside the viewport`, info.card[0] >= 0 && info.card[2] <= w && info.card[1] >= 0 && info.card[3] <= h, JSON.stringify(info.card));
    check(`step ${i} no horizontal page scroll`, info.sw <= info.vw);
    check(`step ${i} card pointer-events auto`, info.pe === "auto");
    if (i > 1) check(`step ${i} ring on its target`, info.ring === "true");
    if (OUT) await shot(`${OUT}${i}-step-${tag}.${process.env.EXT ?? "png"}`);
    if (i < 4) {
      await realClick(".world-guide__btn--go", `Next on step ${i}`);
      await sleep(700);
    }
  }
  // The arrows step back and on; Escape skips.
  await key("ArrowLeft");
  await sleep(300);
  check("ArrowLeft steps back", (await evaluate(`document.querySelector('.world-guide__count')?.textContent`)) === "Step 3 of 4");
  await key("ArrowRight");
  await sleep(300);
  check("ArrowRight steps on", (await evaluate(`document.querySelector('.world-guide__count')?.textContent`)) === "Step 4 of 4");
  await key("Escape");
  await sleep(400);
  check("Escape skips", !(await evaluate(`!!document.querySelector('.world-guide__card')`)));
  check("seen is remembered", (await evaluate(`localStorage.getItem('sant.guide.seen')`)) === "1");
  check("Escape didn't also leave the room", await evaluate(`document.querySelector('.world-hubbar')?.dataset.on === 'true'`));

  // The "?" replays it (a real click).
  await realClick(".world-guide-help", "? Tour");
  await waitFor(`!!document.querySelector('.world-guide__card[data-placed="true"]')`, 20000);
  check("? replays from step 1", (await evaluate(`document.querySelector('.world-guide__count')?.textContent`)) === "Step 1 of 4");
  // Skip (a real click) closes it.
  await realClick(".world-guide__skip", "Skip");
  await sleep(400);
  check("Skip closes it", !(await evaluate(`!!document.querySelector('.world-guide__card')`)));

  // A reload: it doesn't come back by itself.
  await navigate(`${BASE}/world?quality=${process.env.Q ?? "low"}`);
  await waitFor(`document.querySelector('.sant.world')?.dataset.loading === 'false'`, 180000);
  await sleep(1500);
  check("no offer on the second visit", !(await evaluate(`!!document.querySelector('.world-guide-offer')`)));
  console.log(results.join("\n"));
}

try {
  await run();
} catch (e) {
  console.error("FAILED", e);
  process.exitCode = 1;
} finally {
  if (logs.length) console.log(`page logs:\n${logs.slice(0, 40).join("\n")}`);
  ws.close();
  chrome.kill();
}
