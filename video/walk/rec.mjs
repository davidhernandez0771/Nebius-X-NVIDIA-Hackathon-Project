// Film the walkthrough browser: every frame Chrome paints (Page.startScreencast) goes to build/walk/frames as a JPEG,
// with its time in build/walk/frames.jsonl, until this process is stopped (an empty build/walk/STOP file stops it).
// cut.mjs later turns the frames into a constant-rate video.
import { existsSync, mkdirSync, appendFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PORT = 9351;
const BUILD = join(import.meta.dirname, "..", "build", "walk");
const FRAMES = join(BUILD, "frames");
mkdirSync(FRAMES, { recursive: true });
rmSync(join(BUILD, "STOP"), { force: true });
const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
let n = readdirSync(FRAMES).length; // a restarted recorder carries on the numbering
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.method !== "Page.screencastFrame") return;
  const { data, metadata, sessionId } = msg.params;
  send("Page.screencastFrameAck", { sessionId });
  const name = `${String(n++).padStart(6, "0")}.jpg`;
  writeFileSync(join(FRAMES, name), Buffer.from(data, "base64"));
  appendFileSync(join(BUILD, "frames.jsonl"), JSON.stringify({ f: name, t: metadata.timestamp }) + "\n");
});
send("Page.enable");
// the film's frame: exactly 1920 x 1080, and without the world's quality chip (a tuning control, not the site's content)
send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
send("Page.addScriptToEvaluateOnNewDocument", {
  source: `addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = ".world-q{display:none!important}"; document.head.append(s); });`,
});
send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
console.log("recording");
const timer = setInterval(() => {
  if (existsSync(join(BUILD, "STOP"))) {
    send("Page.stopScreencast");
    clearInterval(timer);
    setTimeout(() => process.exit(0), 500);
  }
}, 500);
