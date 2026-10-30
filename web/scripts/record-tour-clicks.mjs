// The /record tour (src/site/record/tour) end to end in a headless Chrome over the DevTools protocol, with REAL input:
// Input.dispatchMouseEvent / dispatchKeyEvent, never element.click(). Before each click, document.elementFromPoint at
// the click point must be the control (or inside it), so a control left in a click-through layer fails here (the
// 10-26 "Back to room" bug). SwiftShader (no GPU), a fresh profile (a first visit), no backend needed.
// No dependencies (Node 22+). Mirrors guide-clicks.mjs (the workshop's tour).
//
//   npm --prefix web run dev -- --port 5241
//   node web/scripts/record-tour-clicks.mjs http://localhost:5241
//
// Env: SZ=WxH (default 1280x720; under 700 wide emulates a phone), REDUCED=1, OUT=<dir> to save a screenshot of each
// card (and the page after the tour closes). CHROME=<path to chrome.exe>.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:5241";
const PORT = 9300 + Math.floor(Math.random() * 400);
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = mkdtempSync(join(tmpdir(), "rectour-cdp-"));
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
  else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") logs.push("error " + msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
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
  const s = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(file, Buffer.from(s.data, "base64"));
  console.log("shot", file);
};
/** A real click: the mouse moves there, presses and releases (what a person does), no element.click(). */
const click = async (x, y) => {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
};
const KEYS = {
  Escape: { code: "Escape", vk: 27 },
  ArrowRight: { code: "ArrowRight", vk: 39 },
  ArrowLeft: { code: "ArrowLeft", vk: 37 },
  ArrowUp: { code: "ArrowUp", vk: 38 },
  Enter: { code: "Enter", vk: 13, text: "\r" },
  " ": { code: "Space", vk: 32, text: " " },
  w: { code: "KeyW", vk: 87, text: "w" },
  a: { code: "KeyA", vk: 65, text: "a" },
  s: { code: "KeyS", vk: 83, text: "s" },
  d: { code: "KeyD", vk: 68, text: "d" },
};
/** A real key press (down and up). */
const key = async (k) => {
  const { code, vk, text } = KEYS[k];
  await send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key: k, code, windowsVirtualKeyCode: vk, ...(text ? { text } : {}) });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
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
const count = () => evaluate(`document.querySelector('.rg-tour__count')?.textContent ?? null`);
const isOpen = () => evaluate(`!!document.querySelector('.rg-tour__card')`);

async function run() {
  const [w, h] = (process.env.SZ ?? "1280x720").split("x").map(Number);
  const tag = `${w}x${h}`;
  await size(w, h, w < 700);
  if (process.env.REDUCED) await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await navigate(`${BASE}/record`);
  await waitFor(`!!document.querySelector('.rg')`, 120000);

  /** A real click on the element matching `sel` (its centre), after checking the hit test lands on it. */
  const realClick = async (sel, name) => {
    const r = await evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const b = el.getBoundingClientRect(); const x = b.left + b.width / 2, y = b.top + b.height / 2; const hit = document.elementFromPoint(x, y); return { x, y, inView: x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight, hit: !!hit && (hit === el || el.contains(hit)), what: hit ? String(hit.className || hit.tagName) : null }; })()`,
    );
    check(`${name}: on screen`, !!r && r.inView);
    if (!r) return false;
    check(`${name}: hit test lands on it`, r.hit, `(got ${JSON.stringify(r.what)})`);
    await click(r.x, r.y);
    return true;
  };

  // A first visit: the tour opens by itself once the page has drawn in.
  await waitFor(`!!document.querySelector('.rg-tour__card[data-placed="true"]')`, 30000);
  check("opens by itself on a first visit", (await count()) === "Step 1 of 6");
  // The robot (and so the twin's three small views) loads in SwiftShader; the rings follow it in.
  await waitFor(`!!document.querySelector('.rg-twin3d .twin3d__front')`, 120000).catch(() => console.log("note: the twin's views didn't come up (no robot)"));
  await sleep(1200);
  const example = await evaluate(`(() => { const el = document.querySelector('.rg-example'); if (!el) return null; const r = el.getBoundingClientRect(); return { text: el.textContent, w: r.width }; })()`);
  check("the idle replay says it is an example", !!example && /^Example · a verified demo replaying\. Yours appears here when you Start\.$/.test(example.text) && example.w > 0, JSON.stringify(example));

  const ids = ["drive", "robot", "views", "readouts", "record", "run"];
  for (let i = 1; i <= 6; i++) {
    await sleep(900); // a phone scrolls the ringed thing into view (smooth), then the rings settle
    const info = await evaluate(
      `(() => { const c = document.querySelector('.rg-tour__card'); const r = c.getBoundingClientRect(); const rings = [...document.querySelectorAll('.rg-tour__ring')].map((x) => x.dataset.on); const p = document.querySelector('.rg-tour__ring'); const pr = p.getBoundingClientRect(); return { title: c.querySelector('h2').textContent, count: c.querySelector('.rg-tour__count').textContent, step: document.querySelector('.rg-tour').dataset.step, card: [r.left, r.top, r.right, r.bottom].map(Math.round), rings, ring: [pr.left, pr.top, pr.right, pr.bottom].map(Math.round), sw: document.documentElement.scrollWidth, vw: innerWidth, pe: getComputedStyle(c).pointerEvents }; })()`,
    );
    console.log(i, JSON.stringify(info));
    check(`card ${i} is ${ids[i - 1]}`, info.step === ids[i - 1] && info.count === `Step ${i} of 6`);
    check(`card ${i} inside the viewport`, info.card[0] >= 0 && info.card[2] <= w && info.card[1] >= 0 && info.card[3] <= h, JSON.stringify(info.card));
    check(`card ${i} no horizontal page scroll`, info.sw <= info.vw);
    check(`card ${i} pointer-events auto`, info.pe === "auto");
    check(`card ${i} rings its target`, info.rings[0] === "true", JSON.stringify(info.rings));
    check(`card ${i} its target is in view`, info.ring[3] > 0 && info.ring[1] < h, JSON.stringify(info.ring));
    if (w < 700) check(`card ${i} docks at the bottom`, info.card[3] >= h - 20, JSON.stringify(info.card));
    if (OUT) await shot(`${OUT}${i}-${ids[i - 1]}-${tag}.png`);
    if (i < 6) await realClick(".rg-tour__btn--go", `Next on card ${i}`);
  }

  // While open, the arrows are the tour's and the page's own listeners don't get them; Escape skips.
  await evaluate(`window.__keys = []; window.addEventListener('keydown', (e) => window.__keys.push(e.code)); true`);
  await key("ArrowLeft");
  await sleep(300);
  check("ArrowLeft steps back", (await count()) === "Step 5 of 6");
  await key("ArrowRight");
  await sleep(300);
  check("ArrowRight steps on", (await count()) === "Step 6 of 6");
  await key("ArrowUp");
  await sleep(200);
  check("the arrows don't reach the drive while it's open", (await evaluate(`window.__keys.length`)) === 0, JSON.stringify(await evaluate(`window.__keys`)));
  await key("Escape");
  await sleep(400);
  check("Escape skips", !(await isOpen()));
  check("seen is remembered", (await evaluate(`localStorage.getItem('sant.record.tour.seen')`)) === "1");

  // Closed: the drive's keys all reach the page again.
  await evaluate(`window.__keys = []; true`);
  for (const k of ["w", "a", "s", "d", " ", "Enter", "ArrowUp", "ArrowLeft"]) await key(k);
  await sleep(200);
  const got = await evaluate(`window.__keys`);
  check("after it closes, W A S D Space Enter and the arrows reach the page", JSON.stringify(got) === JSON.stringify(["KeyW", "KeyA", "KeyS", "KeyD", "Space", "Enter", "ArrowUp", "ArrowLeft"]), JSON.stringify(got));
  check("and nothing reopened it", !(await isOpen()));
  await evaluate(`window.scrollTo(0, 0); true`);
  await sleep(300);
  if (OUT) await shot(`${OUT}7-closed-${tag}.png`);
  check("Run SANT is on screen", await evaluate(`(() => { const r = document.querySelector('.rg-run')?.getBoundingClientRect(); return !!r && r.width > 0 && r.height > 0; })()`));

  // "? Tour" replays it (a real click); Next and Back (real clicks); Skip (a real click) closes it.
  await realClick(".rg-tour-btn", "? Tour");
  await waitFor(`!!document.querySelector('.rg-tour__card[data-placed="true"]')`, 10000);
  check("? Tour replays from card 1", (await count()) === "Step 1 of 6");
  await sleep(700);
  await realClick(".rg-tour__btn--go", "Next after the replay");
  await sleep(700);
  check("Next steps on", (await count()) === "Step 2 of 6");
  await realClick(".rg-tour__btn:not(.rg-tour__btn--go)", "Back");
  await sleep(700);
  check("Back steps back", (await count()) === "Step 1 of 6");
  await realClick(".rg-tour__skip", "Skip");
  await sleep(400);
  check("Skip closes it", !(await isOpen()));

  // A reload: it doesn't come back by itself.
  await navigate(`${BASE}/record`);
  await waitFor(`!!document.querySelector('.rg')`, 60000);
  await sleep(3500);
  check("no tour by itself on the second visit", !(await isOpen()));
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
