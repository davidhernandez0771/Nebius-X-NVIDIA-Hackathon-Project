// A run followed live: its snapshot then its events (SSE), folded with applyRunEvent. The example run plays
// through StubSource, so the pages run the same code either way.
import { useEffect, useReducer, useRef, useState } from "react";
import type { LiveConn } from "../data/hooks";
import { eventsUrl } from "./api";
import { applyRunEvent, emptyRun, parseRunEvent, type RunEvent, type RunState } from "./model";
import { EXAMPLE_RUN_ID, StubSource } from "./stub";

type Source = new (url: string) => Pick<EventSource, "close" | "readyState"> & {
  onopen: ((e: Event) => void) | null;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
};

type Action = { reset: string } | { event: RunEvent };

const reduce = (s: RunState, a: Action): RunState => ("reset" in a ? emptyRun(a.reset) : applyRunEvent(s, a.event));

/** The run `id`, live. `Source` is EventSource (tests pass a fake); the example run always uses StubSource. A new
 *  `nonce` follows it again from a fresh snapshot (after cancelling or resuming it). */
export function useRun(id: string | null, Source: Source | undefined = globalThis.EventSource as unknown as Source | undefined, speed = 30, nonce = 0): [RunState, LiveConn] {
  const [state, dispatch] = useReducer(reduce, id ?? "", emptyRun);
  const [conn, setConn] = useState<LiveConn>("connecting");
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!id) return setConn("closed");
    // Another run starts blank; the same run (a new nonce) keeps what it shows until its snapshot replaces it.
    if (shown.current !== id) dispatch({ reset: id });
    shown.current = id;
    const Make: Source | undefined = id === EXAMPLE_RUN_ID ? (class extends StubSource { constructor(u: string) { super(u, speed); } } as unknown as Source) : Source;
    if (!Make) return setConn("closed");
    setConn("connecting");
    const es = new Make(id === EXAMPLE_RUN_ID ? "stub://example" : eventsUrl(id));
    es.onopen = () => setConn("open");
    es.onmessage = (m) => {
      const e = parseRunEvent(String(m.data));
      if (!e) return;
      dispatch({ event: e });
      if (e.type === "end") {
        es.close();
        setConn("closed");
      }
    };
    es.onerror = () => setConn(es.readyState === 2 ? "closed" : "connecting");
    return () => es.close();
  }, [id, Source, speed, nonce]);
  return [state, conn];
}
