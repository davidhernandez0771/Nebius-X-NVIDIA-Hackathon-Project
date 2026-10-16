// Test helpers for the pm pages: a fake backend behind fetch, a router, a demo.

import { vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Demo } from "./types";

type Reply = { status: number; body: unknown } | Error;

/** Stub fetch by "METHOD /path" (query string ignored); unknown routes get FastAPI's bare 404. */
export function stubBackend(routes: Record<string, Reply | Reply[]>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const key = `${init?.method ?? "GET"} ${path}`;
    calls.push(key);
    const entry = routes[key];
    const reply = Array.isArray(entry) ? (entry.length > 1 ? entry.shift()! : entry[0]) : entry;
    if (reply instanceof Error) throw reply;
    const { status, body } = reply ?? { status: 404, body: { detail: "Not Found" } };
    return new Response(JSON.stringify(body), { status });
  });
  return calls;
}


export function renderAt(path: string, element: JSX.Element, route: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

const pose = { pos: [0.5, 0, 0.02] as [number, number, number], quat_wxyz: [1, 0, 0, 0] as [number, number, number, number] };
export function demo(id: string, source: Demo["source"], extra: Partial<Demo> = {}): Demo {
  return {
    id,
    source,
    parent_id: source === "human" ? null : "h1",
    human_seconds: source === "human" ? 60 : 0,
    created_at: "2026-10-16T10:00:00Z",
    trajectory: {
      t: [0, 1, 2],
      ee_pos: [
        [0.4, 0, 0.3],
        [0.5, 0, 0.1],
        [0.5, 0, 0.1],
      ],
      ee_quat: [
        [0, 1, 0, 0],
        [0, 1, 0, 0],
        [0, 1, 0, 0],
      ],
      gripper: [0, 1, 1],
    },
    scene: { cube_pose: pose, bin_pose: pose, robot: "franka", seed: 3 },
    ...extra,
  };
}

export const down = new TypeError("Failed to fetch");

