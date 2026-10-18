// The world route (/world): the journey from the story down to the work. One canvas behind, one
// tall scroll track that drives the camera rail, each station's DOM overlay in front, and the
// journey rail to jump between stations. The canvas is released when the handoff leaves for a 2D
// route, since app pages like Record share the GPU with Isaac Sim (AppShell).
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { useMotion } from "../../sant/motion/MotionProvider";
import { navigateWithTransition } from "../../sant/motion/viewTransition";
import { hasWebGL } from "../../three/capability";
import { STATIONS } from "../stations";
import { INITIAL_HANDOFF, handoffStep, saveReturn, takeReturn } from "./handoff";
import { DEFAULT_CARTRIDGE } from "./layout";
import { pickTier, readSignals } from "./quality";
import { dwellStart, locate } from "./rail";
import { checkStations } from "./registry";
import { createWorldStore } from "./store";
import type { StationId, StationModule } from "./types";
import { WorldContext, type WorldApi } from "./WorldContext";
import "./world.css";

const WorldCanvas = lazy(() => import("./WorldCanvas"));

function session(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

/** The browser's own scroll restoration on Back would put the page back at the end of the rail. */
function setScrollRestoration(mode: "auto" | "manual") {
  try {
    window.history.scrollRestoration = mode;
  } catch {
    /* not supported */
  }
}

function scrollToY(top: number, smooth: boolean) {
  try {
    window.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
  } catch {
    /* jsdom has no scrollTo */
  }
}

/** `?static` forces the no-canvas fallback (also used when there is no WebGL). */
export function canRun3D(search: string): boolean {
  return !new URLSearchParams(search).has("static") && hasWebGL();
}

function JourneyRail({ stations, at, goTo }: { stations: readonly StationModule[]; at: StationId; goTo: (id: StationId) => void }) {
  const item = (s: StationModule) => (
    <li key={s.id} data-kind={s.kind}>
      <button type="button" aria-current={s.id === at ? "step" : undefined} onClick={() => goTo(s.id)}>
        <span className="world-rail__label">{s.title}</span>
      </button>
    </li>
  );
  return (
    <nav className="world-rail" aria-label="Journey">
      <ol>{stations.filter((s) => s.kind === "rail").map(item)}</ol>
      <ul>{stations.filter((s) => s.kind === "branch").map(item)}</ul>
    </nav>
  );
}

export default function WorldRoot({ stations = STATIONS, webgl }: { stations?: readonly StationModule[]; webgl?: boolean }) {
  const { reduced } = useMotion();
  const navigate = useNavigate();
  const [run3D] = useState(() => webgl ?? canRun3D(window.location.search));
  const [quality] = useState(() => pickTier(readSignals(window.location.search)));
  const [store] = useState(() => createWorldStore(stations, window.innerHeight, window.scrollY));
  const coarse = useSyncExternalStore(store.subscribe, store.getCoarse);
  const veil = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (import.meta.env.DEV) checkStations(stations).forEach((p) => console.warn(`world: ${p}`));
  }, [stations]);

  const handoff = useCallback(() => {
    const to = (store.getCoarse().cartridge ?? DEFAULT_CARTRIDGE).route;
    saveReturn(session(), "machine");
    setScrollRestoration("manual");
    navigateWithTransition((path: string) => navigate(path), to, { reduced });
  }, [navigate, reduced, store]);
  const handoffRef = useRef(handoff);
  handoffRef.current = handoff;

  const api = useMemo<WorldApi>(
    () => ({
      store,
      quality,
      reduced,
      goTo(id) {
        const m = stations.find((s) => s.id === id);
        if (!m) return;
        if (m.kind === "branch") {
          store.setBranch(id);
          return;
        }
        const wasOpen = store.getCoarse().branch !== null;
        store.setBranch(null);
        const y = dwellStart(store.rail, id);
        if (y === null) return;
        // A branch locks the page scroll; wait a frame for the unlock before scrolling.
        if (wasOpen) requestAnimationFrame(() => scrollToY(y, !reduced));
        else scrollToY(y, !reduced);
      },
      back: () => store.setBranch(null),
      selectCartridge: (c) => store.setCartridge(c),
      handoff: () => handoffRef.current(),
    }),
    [store, quality, reduced, stations],
  );

  // Back from a 2D route: the machine, with the projection still lit, just before the zoom.
  useLayoutEffect(() => {
    const back = takeReturn(session());
    const span = back ? store.rail.spans.find((s) => s.id === back) : undefined;
    if (!span) return;
    const y = span.end - 1;
    scrollToY(y, false);
    store.setScroll(y);
    store.setShown(y);
    requestAnimationFrame(() => setScrollRestoration("auto"));
  }, [store]);

  useEffect(() => {
    const onScroll = () => {
      store.setScroll(window.scrollY);
      if (!run3D) store.setShown(window.scrollY);
    };
    const onResize = () => store.setViewport(window.innerHeight);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [store, run3D]);

  // A resize rescales the rail; put the page back where the store says the journey is.
  useLayoutEffect(() => {
    if (Math.abs(window.scrollY - store.targetY) > 1) scrollToY(store.targetY, false);
  }, [coarse.height, store]);

  // The handoff watches what the camera shows (damped), so the screen is opaque when it fires.
  useEffect(() => {
    let state = INITIAL_HANDOFF;
    const zoomIndex = store.rails.findIndex((s) => s.id === "zoom");
    return store.onFrame(() => {
      if (store.getCoarse().branch) return;
      const r = handoffStep(state, locate(store.rail, store.shownY), zoomIndex);
      state = r.state;
      // Not inside the canvas's frame: navigating unmounts it.
      if (r.fire) setTimeout(() => handoffRef.current(), 0);
    });
  }, [store]);

  // An open branch holds the page still, closes on Escape, and takes focus; closing gives it back.
  const lastBranch = useRef(coarse.branch);
  useEffect(() => {
    if (lastBranch.current !== coarse.branch) {
      lastBranch.current = coarse.branch;
      const at = coarse.branch ?? store.getCoarse().current;
      document.querySelector<HTMLElement>(`.world-station[data-station="${at}"]`)?.focus({ preventScroll: true });
    }
    if (!coarse.branch) return;
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && store.setBranch(null);
    window.addEventListener("keydown", onKey);
    return () => {
      root.style.overflow = before;
      window.removeEventListener("keydown", onKey);
    };
  }, [coarse.branch, store]);

  const onCut = useCallback(() => {
    const el = veil.current;
    if (!el) return;
    el.classList.remove("is-cut");
    void el.offsetWidth;
    el.classList.add("is-cut");
  }, []);

  const at = coarse.branch ?? coarse.current;
  const atTitle = stations.find((s) => s.id === at)?.title ?? "";

  return (
    <WorldContext.Provider value={api}>
      <div className="sant world" data-mode="volt" data-branch={coarse.branch ?? undefined} data-motion-world={reduced ? "reduced" : "full"}>
        {run3D ? (
          <Suspense fallback={<div className="world-ground" aria-hidden="true" />}>
            <WorldCanvas store={store} stations={stations} quality={quality} reduced={reduced} onCut={onCut} />
          </Suspense>
        ) : (
          <div className="world-ground" aria-hidden="true">
            <span key={at} className="world-ground__name">
              {atTitle}
            </span>
          </div>
        )}
        <div ref={veil} className="world-veil" aria-hidden="true" />
        <main className="world-overlays">
          {stations.map((s) => {
            if (!s.Overlay) return null;
            const current = coarse.branch ? s.id === coarse.branch : s.kind === "rail" && s.id === coarse.current;
            return (
              <section key={s.id} className="world-station" data-station={s.id} data-current={current} aria-label={s.title} tabIndex={-1}>
                <s.Overlay current={current} reduced={reduced} />
              </section>
            );
          })}
        </main>
        <JourneyRail stations={stations} at={at} goTo={api.goTo} />
        <div className="world-track" style={{ height: coarse.height }} aria-hidden="true" />
      </div>
    </WorldContext.Provider>
  );
}
