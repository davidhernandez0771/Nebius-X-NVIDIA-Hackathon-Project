// The hand-off between the work pages (Record → Pipeline → Data): a veil in the holo look comes up over the page,
// a teal hairline draws across it with the next page's name, the route changes under it, and the next page lifts it
// once it has mounted (HoloPage calls handoffArrive), taking the focus to its title. The veil lives on <body>, not
// in either page, so it covers the gap while the next page's chunk loads. Reduced motion: no veil, the route changes
// at once (the focus still goes to the title). The veil is opacity and transform only (holo.css .holo-handoff).

/** The veil comes up for this long before the route changes. */
export const HANDOFF_IN_MS = 320;
/** It lifts over this long once the next page is in. */
export const HANDOFF_OUT_MS = 420;
/** It goes by itself after this long, whatever happens (a page without the frame, an error). */
export const HANDOFF_MAX_MS = 2500;

type Veil = { el: HTMLElement; went: boolean; timers: number[] };
let veil: Veil | null = null;
/** A hand-off without the veil (reduced motion) still takes the focus to the next page's title. */
let focusNext = false;

function lift(v: Veil) {
  if (v.el.dataset.state === "out") return;
  v.el.dataset.state = "out";
  v.timers.push(
    window.setTimeout(() => {
      v.el.remove();
      if (veil === v) veil = null;
    }, HANDOFF_OUT_MS),
  );
}

/** True while a hand-off is under way (a second click waits for it). */
export function handingOff(): boolean {
  return veil !== null;
}

/** Bring the veil up with the next page's name, then call `go` (the navigation). */
export function handoffStart(label: string, go: () => void, { reduced = false }: { reduced?: boolean } = {}): void {
  if (veil) return;
  if (reduced || typeof document === "undefined") {
    focusNext = true;
    // A page without the frame never takes it: don't let a later, ordinary load steal the focus.
    if (typeof window !== "undefined") window.setTimeout(() => (focusNext = false), HANDOFF_MAX_MS);
    go();
    return;
  }
  const el = document.createElement("div");
  el.className = "holo-handoff";
  el.dataset.state = "in";
  el.setAttribute("aria-hidden", "true");
  const line = document.createElement("span");
  line.className = "holo-handoff__line";
  const tag = document.createElement("span");
  tag.className = "holo-handoff__tag";
  tag.textContent = label;
  el.append(line, tag);
  document.body.append(el);
  const v: Veil = { el, went: false, timers: [] };
  veil = v;
  v.timers.push(
    window.setTimeout(() => {
      v.went = true;
      go();
    }, HANDOFF_IN_MS),
    window.setTimeout(() => lift(v), HANDOFF_MAX_MS),
  );
}

/** The next page is in: lift the veil and give its title the focus. Nothing happens on an ordinary load. */
export function handoffArrive(title?: HTMLElement | null): void {
  const v = veil;
  if (focusNext) {
    focusNext = false;
    title?.focus({ preventScroll: true });
    return;
  }
  if (!v || !v.went) return;
  lift(v);
  title?.focus({ preventScroll: true });
}

/** Tests: drop any veil and its timers. */
export function resetHandoff(): void {
  focusNext = false;
  if (!veil) return;
  veil.timers.forEach((t) => window.clearTimeout(t));
  veil.el.remove();
  veil = null;
}
