// Runs Ask SANT: the question goes to the backend (POST /api/ask, Nemotron picks a tool from
// registry.ts and writes one line); the call is checked again here and run. If the backend can't
// answer in time, the keyword rules pick the tool. Each answer logs the tool call line, then the reply.
import { useCallback, useRef, useState } from "react";
import { apiUrl } from "../../api/client";
import { scrollToY } from "../core/scroll";
import { useWorld } from "../core/WorldContext";
import { beatSpan, INTRO_VH } from "../stations/intro/storyPlan";
import { ITEMS, itemIndex, tagLabel, type TagId } from "../scene/items";
import { setFilter, spiral } from "../scene/spiral";
import { useDetail } from "../stations/workshop/detailStore";
import { scrollToStep } from "../stations/workshop/stepper";
import { endTour, startTour } from "../stations/workshop/tour";
import { TOOLS, callLine, route, validCall, type Section, type ToolCall } from "./registry";

export const ASK_TIMEOUT_MS = 6000;

export interface LogLine {
  id: number;
  kind: "tool" | "say" | "note";
  text: string;
}

/** The backend's pick, already checked against the registry, or null when it couldn't answer. */
export async function askBackend(text: string, fetcher: typeof fetch = fetch): Promise<{ call: ToolCall | null; reply: string } | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ASK_TIMEOUT_MS);
    const res = await fetcher(apiUrl("/api/ask"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, tools: TOOLS }),
      signal: ctl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const body = (await res.json()) as { tool?: unknown; arg?: unknown; reply?: unknown };
    const reply = typeof body.reply === "string" ? body.reply.replace(/\s+/g, " ").slice(0, 140) : "";
    return { call: validCall(body.tool, body.arg), reply };
  } catch {
    return null;
  }
}

export function useAsk() {
  const { store, goTo, reduced } = useWorld();
  const detail = useDetail();
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState(false);
  const id = useRef(0);
  const push = useCallback((kind: LogLine["kind"], text: string) => setLog((l) => [...l, { id: ++id.current, kind, text }].slice(-3)), []);

  /** Runs a checked call and says what it did. */
  const run = (c: ToolCall): string => {
    detail.close();
    endTour(store);
    switch (c.tool) {
      case "go_to_section": {
        const s = c.arg as Section;
        if (s === "top") scrollToY(0, !reduced);
        else if (s === "story") {
          // The intro's first beat (the problem), in the middle of its span, fully shown.
          const span = store.rail.spans[0];
          const [a, b] = beatSpan(1);
          scrollToY(span.start + (span.end - span.start) * ((a + b) / 2 / INTRO_VH), !reduced);
        } else if (s === "workshop") scrollToStep(store, 0);
        else if (s === "machine") goTo("machine");
        else goTo("workbench");
        return `Going to the ${s}.`;
      }
      case "show_cartridges_with_tag": {
        const t = c.arg as TagId;
        if (spiral.filter !== t) setFilter(t);
        scrollToStep(store, 0);
        return `${ITEMS.filter((i) => i.tag === t).length} cartridges for "${tagLabel(t)}".`;
      }
      case "open_cartridge": {
        const i = itemIndex(c.arg!);
        detail.open(i);
        return `Opening ${ITEMS[i].title}.`;
      }
      case "start_tutorial":
        startTour(store);
        return "A short tour of the workshop.";
    }
  };

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    const answer = await askBackend(q);
    setBusy(false);
    if (answer?.call) {
      push("tool", callLine(answer.call));
      const done = run(answer.call);
      push("say", answer.reply || done);
      return;
    }
    // The backend is down (or picked nothing usable): the keyword rules decide.
    const c = route(q);
    push("tool", `${callLine(c)} · rules`);
    push("say", run(c));
  };

  return { log, busy, ask };
}
