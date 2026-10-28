import { useEffect, useReducer, useRef, useState } from "react";
import { describeError } from "../../pm/api";
import { applyEvent, initialFeed, parseEvent, type FeedState } from "./liveFeed";

export type Async<T> = { state: "loading" } | { state: "ok"; value: T } | { state: "error"; message: string };

/** A promise's result as state; `key` changes start a new load (null: nothing to load). */
export function useAsync<T>(key: string | null, load: () => Promise<T>): Async<T> {
  const [s, set] = useState<Async<T>>({ state: "loading" });
  useEffect(() => {
    if (key === null) return;
    let live = true;
    set({ state: "loading" });
    load().then(
      (value) => live && set({ state: "ok", value }),
      // A line a person can act on ("Can't reach the backend at …"), not the browser's "Failed to fetch".
      (e: unknown) => live && set({ state: "error", message: describeError(e) }),
    );
    return () => {
      live = false;
    };
    // load is a fresh closure every render; key says when it means something new
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return s;
}

/** A looping clock in seconds for every view at once, ticking at most `hz` times a second while playing. */
export function useClock(duration: number, playing: boolean, hz = 30): [number, (t: number) => void] {
  const [t, setT] = useState(0);
  const now = useRef(0);
  useEffect(() => {
    if (!playing || duration <= 0) return;
    let raf = 0;
    let last: number | null = null;
    let shown = 0;
    const tick = (ms: number) => {
      const dt = last === null ? 0 : (ms - last) / 1000;
      last = ms;
      now.current = (now.current + dt) % duration;
      if (ms - shown >= 1000 / hz - 1) {
        shown = ms;
        setT(now.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration, hz]);
  const seek = (v: number) => {
    now.current = Math.max(0, Math.min(duration, v));
    setT(now.current);
  };
  return [t, seek];
}

export type LiveConn = "connecting" | "open" | "closed";

/** The live feed of one experiment: an EventSource on url, folded with applyEvent. */
export function useLiveFeed(url: string | null, Source: typeof EventSource | undefined = globalThis.EventSource): [FeedState, LiveConn] {
  const [state, dispatch] = useReducer(applyEvent, undefined, initialFeed);
  const [conn, setConn] = useState<LiveConn>("connecting");
  useEffect(() => {
    if (!url || !Source) {
      setConn("closed");
      return;
    }
    setConn("connecting");
    const es = new Source(url);
    es.onopen = () => setConn("open");
    es.onmessage = (m: MessageEvent) => {
      const e = parseEvent(String(m.data));
      if (!e) return;
      dispatch(e);
      if (e.type === "end") {
        es.close();
        setConn("closed");
      }
    };
    es.onerror = () => setConn(es.readyState === 2 ? "closed" : "connecting");
    return () => es.close();
  }, [url, Source]);
  return [state, conn];
}
