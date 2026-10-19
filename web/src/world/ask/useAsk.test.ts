import { describe, expect, it, vi } from "vitest";
import { askBackend } from "./useAsk";

const respond = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response);

describe("askBackend", () => {
  it("sends the registry and keeps only a call the registry accepts", async () => {
    const f = respond({ tool: "show_cartridges_with_tag", arg: "train", reply: "The training cartridges." });
    expect(await askBackend("how do you train?", f)).toEqual({ call: { tool: "show_cartridges_with_tag", arg: "train" }, reply: "The training cartridges." });
    const sent = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.tools.map((t: { name: string }) => t.name)).toContain("start_tutorial");
    expect((await askBackend("x", respond({ tool: "show_cartridges_with_tag", arg: "games", reply: "" })))?.call).toBeNull();
  });

  it("returns null when the backend is down or errors, so the rules decide", async () => {
    expect(await askBackend("x", respond({}, false))).toBeNull();
    expect(await askBackend("x", vi.fn(async () => Promise.reject(new Error("offline"))))).toBeNull();
  });
});
