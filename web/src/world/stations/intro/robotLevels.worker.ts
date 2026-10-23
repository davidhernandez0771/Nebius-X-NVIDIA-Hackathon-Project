// Simplifies the forest robots off the main thread (each level is 50–110 ms of edge collapses; robotSimplify.ts),
// so the hero stays smooth while the robots arrive. robotLevelsClient.ts posts each model and takes its levels back.
import { robotLevels } from "./robotSimplify";
import type { LodMesh } from "./robotLod";

export interface LevelsRequest {
  id: string;
  model: LodMesh;
  coarse: number;
  /** 0: no near level. */
  detail: number;
}

export interface LevelsReply {
  id: string;
  coarse: LodMesh;
  detail?: LodMesh;
}

const buffers = (m: LodMesh) => [m.position.buffer, m.normal.buffer, m.color.buffer, m.index.buffer] as ArrayBuffer[];

self.onmessage = (e: MessageEvent<LevelsRequest>) => {
  const { id, model, coarse, detail } = e.data;
  const l = robotLevels(model, { coarse, detail, near: detail > 0 ? 1 : 0 });
  const reply: LevelsReply = { id, coarse: l.coarse, detail: l.detail };
  (self as unknown as Worker).postMessage(reply, [...buffers(reply.coarse), ...(reply.detail ? buffers(reply.detail) : [])]);
};
