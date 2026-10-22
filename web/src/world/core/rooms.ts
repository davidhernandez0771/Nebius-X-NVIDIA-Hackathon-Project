// The rooms: the later scenes (the forest and the reactor inside the intro, then each station's), and
// which of them may mount. Under the loader (stations/intro/progress.ts "rooms") the builder mounts the
// ones whose files are in, one at a time out of sight, then compiles everything once, so no frame after
// the reveal stalls on a scene being built or a shader compiling. A short grace lets files already on
// their way finish. What isn't in by then is built after the reveal, one room per idle moment, or at
// once when the visitor reaches it (core/waiting.ts shows the in-place "loading" meanwhile).

/** Which rooms may mount; the canvas (WorldCanvas Stations) and the intro's scene follow it. */
export interface Rooms {
  allow(room: string): void;
  allowed(room: string): boolean;
  list(): string[];
  subscribe(fn: () => void): () => void;
  /** For tests and a new visit. */
  reset(): void;
}

export function createRooms(): Rooms {
  const set = new Set<string>();
  const fns = new Set<() => void>();
  return {
    allow(room) {
      if (set.has(room)) return;
      set.add(room);
      fns.forEach((fn) => fn());
    },
    allowed: (room) => set.has(room),
    list: () => [...set],
    subscribe(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    reset() {
      set.clear();
    },
  };
}

/** The page's rooms. */
export const rooms = createRooms();

export type BuildPhase = "building" | "compiling" | "done";

export interface RoomBuilder {
  /** Under the loader, every frame: mount the next room whose files are in, or compile when none is left. */
  tick(): BuildPhase;
  phase(): BuildPhase;
  /** Stop building under the loader now (continue anyway, or the loader gave up); it counts as done. */
  release(): void;
  /** After the reveal, in an idle moment: mount the next room whose files are in; its id, or null. */
  idle(): string | null;
  /** The visitor is reaching this room: mount it now. */
  need(room: string): void;
}

export function createRoomBuilder({
  order,
  rooms,
  filesDone,
  standing,
  compile,
  report,
  done,
  now,
  graceMs,
  roomTimeoutMs = 8000,
  budgetMs = 6000,
}: {
  /** The rooms in the journey's order. */
  order: readonly string[];
  rooms: Rooms;
  filesDone(room: string): boolean;
  standing(room: string): boolean;
  /** Compile (and upload) everything now in the scene. */
  compile(): Promise<void>;
  /** n parts done of m under the loader: each room to build, then the compile as the last. */
  report(n: number, m: number): void;
  /** The rooms step is done. */
  done(): void;
  now(): number;
  graceMs: number;
  /** A room that hasn't stood by this long after it was allowed counts as built (its scene threw). */
  roomTimeoutMs?: number;
  /** Past this long building under the loader, it builds no more (a slow device): the rest after the reveal. */
  budgetMs?: number;
}): RoomBuilder {
  let phase: BuildPhase = "building";
  let started = -1;
  const built: string[] = [];
  const allowedAt = new Map<string, number>();
  const stands = (r: string) => standing(r) || now() - (allowedAt.get(r) ?? now()) > roomTimeoutMs;
  const mounting = () => built.some((r) => !stands(r));
  const finish = () => {
    if (phase === "done") return;
    phase = "done";
    done();
  };
  return {
    tick() {
      if (phase !== "building") return phase;
      if (started < 0) started = now();
      if (mounting()) return phase;
      const late = now() - started > budgetMs;
      const next = late ? undefined : order.find((r) => !rooms.allowed(r) && filesDone(r));
      const coming = order.filter((r) => !rooms.allowed(r) && !filesDone(r));
      if (next) {
        rooms.allow(next);
        allowedAt.set(next, now());
        built.push(next);
        report(built.filter(stands).length, built.length + order.filter((r) => !rooms.allowed(r) && filesDone(r)).length + 1);
        return phase;
      }
      // Files still on their way: wait a little for them, then leave the rest for after the reveal.
      if (!late && coming.length && now() - started < graceMs) return phase;
      report(built.length, built.length + 1);
      phase = "compiling";
      compile().then(finish, finish);
      return phase;
    },
    phase: () => phase,
    release: finish,
    idle() {
      if (order.some((r) => rooms.allowed(r) && !stands(r))) return null;
      const next = order.find((r) => !rooms.allowed(r) && filesDone(r));
      if (!next) return null;
      rooms.allow(next);
      allowedAt.set(next, now());
      return next;
    },
    need(room) {
      if (!rooms.allowed(room)) allowedAt.set(room, now());
      rooms.allow(room);
    },
  };
}
