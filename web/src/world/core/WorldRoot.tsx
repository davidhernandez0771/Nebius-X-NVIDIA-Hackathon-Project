// The world route (/world): the journey from the story down to the work. One canvas behind, one
// tall scroll track that drives the camera rail, each station's DOM overlay in front, and the
// journey rail to jump between stations. The canvas is released when the handoff leaves for a 2D
// route, since app pages like Record share the GPU with Isaac Sim (AppShell).
import { Component, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { useMotion } from "../../sant/motion/MotionProvider";
import { navigateWithTransition } from "../../sant/motion/viewTransition";
import { STATIONS } from "../stations";
import { INITIAL_HANDOFF, handoffStep, saveReturn, takeReturn } from "./handoff";
import { checkGpu } from "./gpu";
import { DEFAULT_CARTRIDGE } from "./layout";
import { Hud } from "./Hud";
import { TIERS, pickQuality, readSignals, saveTier, type QualityChoice, type TierName } from "./quality";
import { dwellStart, locate } from "./rail";
import { checkStations } from "./registry";
import { createWorldStore } from "./store";
import type { StationId, StationModule } from "./types";
import type { ReactNode } from "react";
import { WorldContext, type WorldApi } from "./WorldContext";
import "./world.css";
import "../ui/ui.css";

const WorldCanvas = lazy(() => import("./WorldCanvas"));

/** The canvas failed to load or to make a WebGL context: fall back to the stills. */
class CanvasBoundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("world: the 3D canvas failed, showing the stills", error);
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

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

const FORCED = new Set(["low", "high", "ultra", "medium", "stills", "static"]);

/**
 * The tier or the stills. A forced answer (`?quality=`, `?static`, or the `webgl` prop in tests)
 * skips the GPU check; otherwise it runs once per session.
 */
export function chooseQuality(search: string, webgl?: boolean): QualityChoice {
  if (webgl === false) return { mode: "stills", tier: TIERS.low };
  const signals = readSignals(search, "high");
  const forced = signals.forceStatic || FORCED.has(signals.query?.toLowerCase() ?? "");
  const gpu = forced || webgl === true ? "high" : checkGpu(session()).gpu;
  return pickQuality({ ...signals, gpu });
}

/** No usable GPU: each station's pre-rendered still, cross-fading as the journey moves. */
function Stills({ stations, at, title }: { stations: readonly StationModule[]; at: StationId; title: string }) {
  const still = stations.find((s) => s.id === at)?.still;
  return (
    <div className="world-ground world-stills" aria-hidden="true" data-quality="stills">
      {stations.map((s) =>
        s.still ? <img key={s.id} className="world-stills__img" src={s.still} alt="" decoding="async" data-on={s.id === at} /> : null,
      )}
      {still ? null : (
        <span key={at} className="world-ground__name">
          {title}
        </span>
      )}
    </div>
  );
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
  const [{ mode, tier: quality }, setChoice] = useState(() => chooseQuality(window.location.search, webgl));
  const run3D = mode === "3d";
  const [store] = useState(() => {
    const s = createWorldStore(stations, window.innerHeight, window.scrollY);
    // No canvas, nothing to load: the stills are ready at once.
    if (mode !== "3d") s.setReady();
    return s;
  });
  // The URL's tier wins and isn't tuned; neither is one an earlier visit saved.
  const [tuning] = useState(() => {
    const sig = readSignals(window.location.search, "high");
    const q = sig.query?.toLowerCase() ?? "";
    return { forced: FORCED.has(q), tune: !FORCED.has(q) && !sig.saved };
  });
  const setTier = useCallback((name: TierName) => {
    saveTier(name);
    setChoice({ mode: "3d", tier: TIERS[name] });
  }, []);
  const fail = useCallback(() => {
    store.setReady();
    setChoice({ mode: "stills", tier: TIERS.low });
  }, [store]);
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
      mode,
      fail,
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
    [store, quality, reduced, mode, fail, stations],
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

  // A held shot (the detail view, the tour) holds the page still too; its owner handles Escape.
  useEffect(() => {
    if (!coarse.override) return;
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before;
    };
  }, [coarse.override]);

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
          <CanvasBoundary onFail={fail}>
            <Suspense fallback={<div className="world-ground" aria-hidden="true" />}>
              <WorldCanvas store={store} stations={stations} quality={quality} reduced={reduced} onCut={onCut} tune={tuning.tune} onTier={setTier} />
            </Suspense>
          </CanvasBoundary>
        ) : (
          <Stills stations={stations} at={at} title={atTitle} />
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
        {run3D ? <Hud store={store} quality={quality} forced={tuning.forced} onTier={setTier} /> : null}
        <div className="world-track" style={{ height: coarse.height }} aria-hidden="true" />
      </div>
    </WorldContext.Provider>
  );
}
