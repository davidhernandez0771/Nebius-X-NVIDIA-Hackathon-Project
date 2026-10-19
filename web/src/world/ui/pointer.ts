// The pointer over the world, in normalised device coordinates (-1..1, y up), for things that turn
// toward the cursor (the logo, the arm). One window listener for the page; `onMove` lets the canvas
// ask for a frame when it renders on demand.
export const pointer = { x: 0, y: 0, moved: 0 };
const fns = new Set<() => void>();
let attached = false;

function onMove(e: PointerEvent) {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  pointer.moved = performance.now();
  fns.forEach((fn) => fn());
}

export function onPointer(fn: () => void): () => void {
  if (!attached && typeof window !== "undefined") {
    window.addEventListener("pointermove", onMove, { passive: true });
    attached = true;
  }
  fns.add(fn);
  return () => fns.delete(fn);
}
