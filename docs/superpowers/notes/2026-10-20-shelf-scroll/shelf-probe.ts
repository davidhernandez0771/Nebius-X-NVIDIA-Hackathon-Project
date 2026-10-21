import { createWorldStore } from "C:/dev/pm-t3/web/src/world/core/store";
import { heldShot, heldKey, mixShot, newShot, retarget } from "C:/dev/pm-t3/web/src/world/core/shot";
import { STATIONS } from "C:/dev/pm-t3/web/src/world/stations";
import { createShelfInput, scrollToStep, shelf, stepShelf, closeShelf } from "C:/dev/pm-t3/web/src/world/stations/workshop/stepper";
const fixed = process.argv.includes("--fixed");
for (const [name, gap, n] of [["slow (1.5 s/notch)", 1.5, 6], ["steady (0.3 s/notch)", 0.3, 10], ["flick (30 ms/notch)", 0.03, 30]] as const) {
  const store = createWorldStore(STATIONS, 1000);
  let clock = 0;
  const input = createShelfInput({ browsing: () => shelf.open, now: () => clock * 1000, step: (d) => stepShelf(store, d), close: () => closeShelf(store) });
  scrollToStep(store, 0);
  const s = newShot();
  const times = Array.from({ length: n }, (_, k) => 0.1 + k * gap);
  let minR = 99;
  for (let f = 0; f <= 60 * (0.1 + n * gap + 3); f++) {
    clock = f / 60;
    while (times.length && times[0] <= clock) { times.shift(); input.wheel({ deltaY: 100, deltaMode: 0, preventDefault() {} }); }
    const o = store.getCoarse().override!;
    let pose;
    if (fixed) { const h = heldShot(s, o, 1 / 60, false); retarget(s, h.dest, h.key, clock, false, h.arc); pose = mixShot(s, h.dest, clock).pose; }
    else { const plain = { position: o.position, target: o.target, fov: o.fov }; retarget(s, plain, heldKey(plain), clock, false); pose = mixShot(s, plain, clock).pose; }
    minR = Math.min(minR, Math.hypot(pose.position[0], pose.position[2]));
  }
  console.log(fixed ? "after " : "before", name.padEnd(22), "steps", String(shelf.step).padStart(2), " closest to the axis", minR.toFixed(2), "m");
  shelf.open = false; shelf.step = 0;
}
