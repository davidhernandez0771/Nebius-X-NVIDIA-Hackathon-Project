// The world route (/world): the journey from the story down to the work. One canvas behind, one
// tall scroll track that drives the camera rail, each station's DOM overlay in front, and the
// journey rail to jump between stations. The canvas is released when the handoff leaves for a 2D
// route, since app pages like Record share the GPU with Isaac Sim (AppShell).
import { Component, lazy, Suspense, type MouseEvent as ReactMouseEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { useMotion } from "../../sant/motion/MotionProvider";
import { navigateWithTransition } from "../../sant/motion/viewTransition";
import { STATIONS } from "../stations";
import { FIRE_AT, saveReturn, takeReturn } from "./handoff";
import { hashOfBranch, placeOfHash, syncOp } from "./placeHash";
import { isReload, resumeSpot, saveSpot } from "./resume";
import { checkGpu } from "./gpu";
import { DEFAULT_CARTRIDGE } from "./layout";
import { Hud } from "./Hud";
import { runIris } from "./iris";
import { TIERS, pickQuality, readSignals, saveTier, type QualityChoice, type TierName } from "./quality";
import { dwellStart } from "./rail";
import { checkStations } from "./registry";
import { createWorldStore } from "./store";
import type { StationId, StationModule } from "./types";
import type { ReactNode } from "react";
import { WorldContext, type WorldApi } from "./WorldContext";
import "./world.css";
import "../ui/ui.css";
import { Logo } from "../../sant/components/Logo";
import { Contact } from "../ui/Contact";
import { GuideHelp, GuideLayer } from "../guide/Guide";
import { Wait } from "../ui/Wait";
import { assets } from "./assets";
import { isStanding } from "./standing";
import { prefetchOrder, waitFor } from "./waiting";
import { Loader } from "../stations/intro/Loader";
import { load } from "../stations/intro/progress";
import { pageHeld } from "./pageHold";
import { INTRO_VH } from "../stations/intro/storyPlan";

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

/** The rail is in the workshop's room view (arrived), where the branches are. */
function inRoom(store: ReturnType<typeof createWorldStore>): boolean {
  return store.getCoarse().current === "workshop" && store.frames.workshop.arrive >= 1;
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
      {/* The zoom isn't a place to go to: it plays out of the machine. */}
      <ul>{stations.filter((s) => s.kind === "branch" && s.id !== "zoom").map(item)}</ul>
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

  // The heavier stations stream in the background once the 3D engine is up (it and the fonts come first),
  // in the journey's order, with the station the visitor is at first (a return lands in the workshop).
  useEffect(() => {
    if (!run3D) return;
    let started = false;
    const start = () => {
      if (started || (!load.done() && load.status().step === "engine")) return;
      started = true;
      assets.want(prefetchOrder(quality.name));
      const c = store.getCoarse();
      const here = waitFor(c.branch ?? c.current, store.frames.intro.t * INTRO_VH, quality.name, reduced);
      if (here) assets.prioritize(here.files);
    };
    start();
    return load.subscribe(start);
  }, [run3D, quality.name, store, reduced]);

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
        // Anywhere else lets go of a held shot (the shelf, a detail view, the tour): Back lands in the room view.
        store.setOverride(null);
        if (m.kind === "branch") {
          // A branch is a place in the workshop's room. Opened from anywhere else on the rail (the journey
          // rail's MACHINE, WORKBENCH or ROBOTS from the story or the descent), the rail first cuts to the room
          // view under it, as Skip the intro does: the room is built and lit around the place, and Back lands
          // in the room. Before, the place opened over the story: the room not built yet (black), and Back
          // went back up into the story.
          if (!inRoom(store)) {
            const y = dwellStart(store.rail, "workshop");
            if (y !== null) {
              store.jump(y);
              scrollToY(y, false);
            }
          }
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

  // The page's scroll is the world's to set (the rail, a return, a place's hash): the browser's own restoration
  // on Back or Forward would put it somewhere else (the end of the rail, the room under a place's entry).
  useLayoutEffect(() => {
    setScrollRestoration("manual");
    return () => setScrollRestoration("auto");
  }, []);

  // Back from a 2D route: the machine, with the projection still lit, just before the zoom. Or a place in the
  // URL (a reload, a link, Back to its entry: placeHash.ts): the room view with that place open.
  // Otherwise, on a reload, where the journey was (resume.ts): the story or the descent at the same point.
  useLayoutEffect(() => {
    const back = takeReturn(session()) ?? placeOfHash(window.location.hash);
    if (!back) {
      const y = resumeSpot(session(), isReload(), store.rail.total);
      if (y === null) return;
      scrollToY(y, false);
      store.jump(y);
      return;
    }
    // The workshop's end (the room view), with the machine open and already played: the hologram up.
    const span = store.rail.spans.find((s) => s.id === "workshop");
    if (!span) return;
    const y = span.end;
    scrollToY(y, false);
    store.jump(y);
    if (stations.some((s) => s.id === back && s.kind === "branch")) store.setBranch(back as StationId, 1);
  }, [store, stations]);

  // Keep the spot when the page goes away (a reload among others), for the resume above.
  useEffect(() => {
    const keep = () => saveSpot(session(), store.targetY, store.rail.total);
    window.addEventListener("pagehide", keep);
    return () => window.removeEventListener("pagehide", keep);
  }, [store]);

  // The open place follows the URL's hash (placeHash.ts): opening one adds a history entry, so the browser's
  // Back (a phone's back gesture) closes it instead of leaving the site, and Forward opens it again; its own
  // Back to room or Escape takes the entry back off.
  const goToRef = useRef(api.goTo);
  goToRef.current = api.goTo;
  useEffect(() => {
    const h = window.history;
    const url = (hash: string) => window.location.pathname + window.location.search + hash;
    let last: StationId | null = null;
    // A history.back() of ours is on its way: its popstate only re-syncs (a place opened meanwhile stays open).
    let popping = false;
    // Applying a Back or Forward: what it changes is already in the URL.
    let applying = false;
    const sync = (force = false) => {
      if (applying) return;
      const branch = store.getCoarse().branch;
      if (branch === last && !force) return;
      last = branch;
      const own = !!(h.state as { worldPlace?: boolean } | null)?.worldPlace;
      const op = syncOp(branch, window.location.hash, own);
      try {
        if (op.op === "push") h.pushState({ ...(h.state ?? {}), worldPlace: true }, "", url(op.hash));
        else if (op.op === "replace") h.replaceState(h.state, "", url(op.hash));
        else if (op.op === "back") {
          popping = true;
          h.back();
        }
      } catch {
        /* a sandboxed frame may refuse: the places still work, only without the history */
      }
    };
    const onPop = () => {
      if (popping) {
        popping = false;
        sync(true);
        return;
      }
      const place = placeOfHash(window.location.hash);
      if (hashOfBranch(store.getCoarse().branch) === hashOfBranch(place)) return;
      applying = true;
      try {
        if (place) goToRef.current(place);
        else store.setBranch(null);
      } finally {
        applying = false;
      }
      last = store.getCoarse().branch;
    };
    sync(true);
    const off = store.subscribe(() => sync());
    window.addEventListener("popstate", onPop);
    return () => {
      off();
      window.removeEventListener("popstate", onPop);
    };
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
    let fired = false;
    return store.onFrame(() => {
      if (store.getCoarse().branch !== "zoom") {
        fired = false;
        return;
      }
      if (fired || store.frames.zoom.t < FIRE_AT) return;
      fired = true;
      // Not inside the canvas's frame: navigating unmounts it.
      setTimeout(() => handoffRef.current(), 0);
    });
  }, [store]);

  // The page holds still from one place (pageHold.ts): the loader, an open branch, a held shot (the shelf,
  // the detail view, the tour), or in 3D the room view once the dive has landed (the room is a game: clicks,
  // Escape). It writes whenever the page differs from that answer. "↑ Story" (world:story) goes back to
  // the top, which lets go of it.
  useEffect(() => {
    const root = document.documentElement;
    let held = false;
    const apply = () => {
      held = pageHeld(store.getCoarse(), store.frames.workshop.arrive, run3D);
      const want = held ? "hidden" : "";
      if (root.style.overflow !== want) root.style.overflow = want;
    };
    apply();
    const offs = [store.subscribe(apply), store.onFrame(apply)];
    const toStory = () => jumpRef.current("intro");
    window.addEventListener("world:story", toStory);
    return () => {
      offs.forEach((off) => off());
      window.removeEventListener("world:story", toStory);
      if (held) root.style.overflow = "";
    };
  }, [store, run3D]);

  // An open branch closes on Escape (unless something inside it took the key: a robot's close-up steps
  // back to the wall first) and takes focus; closing gives it back.
  const lastBranch = useRef(coarse.branch);
  useEffect(() => {
    if (lastBranch.current !== coarse.branch) {
      lastBranch.current = coarse.branch;
      const at = coarse.branch ?? store.getCoarse().current;
      document.querySelector<HTMLElement>(`.world-station[data-station="${at}"]`)?.focus({ preventScroll: true });
    }
    if (!coarse.branch) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && store.setBranch(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [coarse.branch, store]);

  // The journey rail jumps behind the iris (iris.ts): it closes, the scroll and the camera cut to the
  // station, and it opens there, so nothing in between plays (the dive, half a spiral). Reduced
  // motion already cuts behind the veil, and a branch keeps its tween to the side.
  const iris = useRef<HTMLDivElement>(null);
  const jump = useCallback(
    (id: StationId) => {
      const m = stations.find((s) => s.id === id);
      const y = dwellStart(store.rail, id);
      const { branch, current, override } = store.getCoarse();
      // Already there (and not on the shelf over it): nothing to cut.
      if (!m || m.kind === "branch" || reduced || !iris.current || y === null || (current === id && branch === null && override === null)) {
        api.goTo(id);
        return;
      }
      runIris(iris.current, () => {
        const wasOpen = store.getCoarse().branch !== null;
        store.setBranch(null);
        store.setOverride(null);
        store.jump(y);
        // A branch locks the page scroll; the unlock lands a frame later.
        if (wasOpen) requestAnimationFrame(() => scrollToY(y, false));
        else scrollToY(y, false);
      });
    },
    [api, reduced, stations, store],
  );

  const jumpRef = useRef(jump);
  jumpRef.current = jump;

  const onCut = useCallback(() => {
    const el = veil.current;
    if (!el) return;
    el.classList.remove("is-cut");
    void el.offsetWidth;
    el.classList.add("is-cut");
  }, []);

  // Skip the intro (and the guide, asked for away from the room): the room view at once (a cut behind the veil, not the iris: whoever skips wants to
  // be there now), with the focus on the workshop, so Tab goes on to its four things to click.
  const toRoom = useCallback(() => {
    const y = dwellStart(store.rail, "workshop");
    if (y === null) return;
    store.setBranch(null);
    store.setOverride(null);
    store.jump(y);
    scrollToY(y, false);
    onCut();
    // The section shows once the store has moved there: focus it after this render.
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.world-station[data-station="workshop"]')?.focus({ preventScroll: true }));
  }, [store, onCut]);
  const skipIntro = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      toRoom();
    },
    [toRoom],
  );

  const at = coarse.branch ?? coarse.current;
  const atTitle = stations.find((s) => s.id === at)?.title ?? "";

  return (
    <WorldContext.Provider value={api}>
      <div
        className="sant world"
        data-mode="volt"
        data-branch={coarse.branch ?? undefined}
        data-motion-world={reduced ? "reduced" : "full"}
        data-loading={run3D && !coarse.ready}
      >
        <a className="world-skip world-u" href="#world-workshop" onClick={skipIntro}>
          Skip the intro
        </a>
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
              <section key={s.id} id={`world-${s.id}`} className="world-station" data-station={s.id} data-current={current} aria-label={s.title} tabIndex={-1}>
                <s.Overlay current={current} reduced={reduced} />
              </section>
            );
          })}
        </main>
        <div ref={iris} className="world-iris" aria-hidden="true" />
        <p className="world-brand">
          <Logo size="sm" lit="all" />
          <span className="world-brand__line world-u">perfect, then multiply</span>
        </p>
        <Contact>
          <GuideHelp />
        </Contact>
        {run3D ? <Wait store={store} assets={assets} tier={quality.name} reduced={reduced} stands={isStanding} /> : null}
        {/* Over everything, wherever the page opens (a return lands in the workshop, not at the hero). */}
        {run3D ? <Loader /> : null}
        <JourneyRail stations={stations} at={at} goTo={jump} />
        {/* The first-visit guide: once per browser, in the room view (guide/Guide.tsx). */}
        <GuideLayer toRoom={toRoom} />
        {run3D ? <Hud store={store} quality={quality} forced={tuning.forced} onTier={setTier} /> : null}
        <div className="world-track" style={{ height: coarse.height }} aria-hidden="true" />
      </div>
    </WorldContext.Provider>
  );
}
