// The forest robots' levels, made off the main thread: one worker (robotLevels.worker.ts) takes each model in turn.
// Where workers aren't there (or the worker fails), each robot is simplified on the main thread instead, one per
// idle moment, so no single task holds a frame for long.
import type { RobotTier } from "./forestRobots";
import type { LodMesh } from "./robotLod";
import type { LevelsReply, LevelsRequest } from "./robotLevels.worker";
import { robotLevels, type RobotLevels } from "./robotSimplify";

export interface LevelMaker {
  make(id: string, model: LodMesh, tier: Pick<RobotTier, "coarse" | "detail" | "near">): Promise<RobotLevels>;
  dispose(): void;
}

const idle = (f: () => void) =>
  typeof requestIdleCallback === "function" ? requestIdleCallback(f, { timeout: 500 }) : setTimeout(f, 16);

export function levelMaker(): LevelMaker {
  let worker: Worker | null = null;
  try {
    worker = typeof Worker === "function" ? new Worker(new URL("./robotLevels.worker.ts", import.meta.url), { type: "module" }) : null;
  } catch {
    worker = null;
  }
  const pending = new Map<string, { ok: (l: RobotLevels) => void; fallback: () => void }>();
  const onMain = (model: LodMesh, tier: Pick<RobotTier, "coarse" | "detail" | "near">) =>
    new Promise<RobotLevels>((ok) => idle(() => ok(robotLevels(model, tier))));
  if (worker) {
    worker.onmessage = (e: MessageEvent<LevelsReply>) => {
      const p = pending.get(e.data.id);
      pending.delete(e.data.id);
      p?.ok({ coarse: e.data.coarse, detail: e.data.detail });
    };
    worker.onerror = () => {
      // The worker didn't start (or broke): what is left is made on the main thread.
      worker?.terminate();
      worker = null;
      for (const p of pending.values()) p.fallback();
      pending.clear();
    };
  }
  return {
    make(id, model, tier) {
      if (!worker) return onMain(model, tier);
      return new Promise<RobotLevels>((ok) => {
        pending.set(id, { ok, fallback: () => void onMain(model, tier).then(ok) });
        const req: LevelsRequest = { id, model, coarse: tier.coarse, detail: tier.near > 0 ? tier.detail : 0 };
        // The model is copied, not moved: the fallback may still need it.
        worker!.postMessage(req);
      });
    },
    dispose() {
      worker?.terminate();
      worker = null;
      pending.clear();
    },
  };
}
