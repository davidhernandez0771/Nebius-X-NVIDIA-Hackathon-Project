// Drive the walkthrough browser (Chrome on --remote-debugging-port 9351, video/walk/README.md) one command at a time,
// so each step can be checked before the next. The recorder (rec.mjs) films the same page meanwhile.
//
//   node video/walk/cdp.mjs nav <url>
//   node video/walk/cdp.mjs key <code> [hold ms]          e.g. key KeyW 500, key Space
//   node video/walk/cdp.mjs keys "<code>:<ms>,<code>:<ms>,..."   held keys one after another (wait:<ms> pauses)
//   node video/walk/cdp.mjs click <x> <y> | clicksel <css selector> | clicktext <text>
//   node video/walk/cdp.mjs type <text> | eval <js> | shot <file.png> | mark <name> | wheel <x> <y> <dy>
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PORT = 9351;
const [, , cmd, ...args] = process.argv;
const BUILD = join(import.meta.dirname, "..", "build", "walk");
const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const KEYMAP = { Space: [" ", 32], Enter: ["Enter", 13], Escape: ["Escape", 27], Tab: ["Tab", 9] };
const keyEv = (type, code) => {
  const [key, vk] = KEYMAP[code] ?? (code.startsWith("Key") ? [code.slice(3).toLowerCase(), code.charCodeAt(3)] : code.startsWith("Arrow") ? [code, { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }[code]] : [code, 0]);
  return send("Input.dispatchKeyEvent", { type, code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(type === "keyDown" && key.length === 1 ? { text: key } : {}) });
};
async function hold(code, ms) {
  await keyEv("keyDown", code);
  await sleep(ms);
  await keyEv("keyUp", code);
}
async function clickAt(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await sleep(60);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await sleep(50);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}
const centre = (sel) => `(() => { const e = ${sel}; if (!e) return null; e.scrollIntoView({block: "nearest"}); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`;

switch (cmd) {
  case "nav":
    await send("Page.navigate", { url: args[0] });
    break;
  case "key":
    await hold(args[0], Number(args[1] ?? 80));
    break;
  case "keys":
    for (const step of args[0].split(",")) {
      const [code, ms] = step.split(":");
      if (code === "wait") await sleep(Number(ms));
      else await hold(code, Number(ms ?? 80));
    }
    break;
  case "click":
    await clickAt(Number(args[0]), Number(args[1]));
    break;
  case "clicksel": {
    const at = await evaluate(centre(`document.querySelector(${JSON.stringify(args[0])})`));
    if (!at) throw new Error(`no ${args[0]}`);
    await clickAt(at[0], at[1]);
    console.log("clicked", at);
    break;
  }
  case "clicktext": {
    const at = await evaluate(
      centre(`[...document.querySelectorAll("button, a, [role=button], [role=tab], label, summary")].find((e) => e.offsetParent && e.textContent.trim().includes(${JSON.stringify(args[0])}))`),
    );
    if (!at) throw new Error(`no control with text ${args[0]}`);
    await clickAt(at[0], at[1]);
    console.log("clicked", at);
    break;
  }
  case "wheel":
    await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: Number(args[0]), y: Number(args[1]), deltaX: 0, deltaY: Number(args[2]) });
    break;
  case "type":
    await send("Input.insertText", { text: args.join(" ") });
    break;
  case "eval":
    console.log(JSON.stringify(await evaluate(args.join(" ")), null, 1));
    break;
  case "shot": {
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(args[0], Buffer.from(data, "base64"));
    console.log("shot", args[0]);
    break;
  }
  case "mark":
    appendFileSync(join(BUILD, "marks.jsonl"), JSON.stringify({ t: Date.now() / 1000, name: args.join(" ") }) + "\n");
    console.log("mark", args.join(" "));
    break;
  default:
    console.log("commands: nav key keys click clicksel clicktext wheel type eval shot mark");
}
ws.close();
