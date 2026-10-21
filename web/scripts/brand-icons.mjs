// Draws the PNG icons from the favicon SVG (web/public/favicon.svg, the user's sant-favicon.svg) in a
// headless Chrome over the DevTools protocol: no dependencies (Node 22+'s WebSocket and fetch), and no
// GPU (SwiftShader). The browser draws the SVG at each size itself, on a transparent page, so the rounded
// square's corners stay clear.
//
//   node web/scripts/brand-icons.mjs
//
// Writes web/public/favicon-32.png, favicon-16.png and apple-touch-icon.png (180). Env: CHROME=<path>.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const SIZES = [
  ["favicon-32.png", 32],
  ["favicon-16.png", 16],
  ["apple-touch-icon.png", 180],
];
const PORT = 9361;
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = mkdtempSync(join(tmpdir(), "brand-icons-"));
const chrome = spawn(
  CHROME,
  ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu", "about:blank"],
  { stdio: "ignore" },
);

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

try {
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
    new Promise((resolve, reject) => {
      const n = ++id;
      waiting.set(n, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
      ws.send(JSON.stringify({ id: n, method, params }));
    });

  const svg = readFileSync(join(PUBLIC, "favicon.svg"), "utf8");
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  await send("Page.enable");
  await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  for (const [file, size] of SIZES) {
    await send("Emulation.setDeviceMetricsOverride", { width: size, height: size, deviceScaleFactor: 1, mobile: false });
    const html = `<!doctype html><html><body style="margin:0;background:transparent"><img src="${src}" width="${size}" height="${size}" style="display:block"></body></html>`;
    await send("Page.navigate", { url: `data:text/html;base64,${Buffer.from(html).toString("base64")}` });
    await sleep(400);
    const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: size, height: size, scale: 1 } });
    writeFileSync(join(PUBLIC, file), Buffer.from(shot.data, "base64"));
    console.log(`wrote ${file} (${size}×${size})`);
  }
  ws.close();
} finally {
  chrome.kill();
}
