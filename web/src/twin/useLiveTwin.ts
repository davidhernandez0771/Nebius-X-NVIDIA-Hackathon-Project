// The live twin: listens on the relay's read-only twin socket, so it never competes with the Record page's own
// connection (the relay allows one browser) and works with the camera off. Reconnects every RETRY_MS. The sink
// sends poses only while a page watches, at most ~30 a second, and none while the robot is still.
import { useEffect, useMemo, useReducer } from "react";
import { parseTwinMessage } from "./messages";
import { LIVE_START, liveReducer, liveTwin, twinSocketUrl, type LiveTwin } from "./live";

export const RETRY_MS = 2000;

export function useLiveTwin({
  enabled = true,
  url = twinSocketUrl(),
  WebSocketImpl = WebSocket,
}: { enabled?: boolean; url?: string; WebSocketImpl?: typeof WebSocket } = {}): LiveTwin {
  const [state, dispatch] = useReducer(liveReducer, LIVE_START);

  useEffect(() => {
    if (!enabled) return;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const connect = () => {
      socket = new WebSocketImpl(url);
      socket.onopen = () => dispatch({ kind: "open" });
      socket.onmessage = (ev: MessageEvent) => {
        const msg = parseTwinMessage(ev.data);
        if (msg) dispatch({ kind: "message", msg });
      };
      socket.onclose = () => {
        dispatch({ kind: "close" });
        if (!stopped) retry = setTimeout(connect, RETRY_MS);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [enabled, url, WebSocketImpl]);

  return useMemo(() => liveTwin(state), [state]);
}
