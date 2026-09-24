import { describe, expect, it } from "vitest";
import { NotConnectedProvider, ProviderError } from "./providerAdapter";

async function drain(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

describe("NotConnectedProvider", () => {
  it("reports itself as not connected", () => {
    const provider = new NotConnectedProvider();
    expect(provider.connected).toBe(false);
  });

  it("throws a typed not_connected ProviderError instead of yielding a fabricated reply", async () => {
    const provider = new NotConnectedProvider();
    const controller = new AbortController();
    const iterable = provider.send([{ role: "user", text: "hello" }], { signal: controller.signal });

    await expect(drain(iterable)).rejects.toMatchObject({
      name: "ProviderError",
      code: "not_connected",
    });
  });

  it("never yields any chunk before throwing", async () => {
    const provider = new NotConnectedProvider();
    const controller = new AbortController();
    const iterator = provider.send([{ role: "user", text: "hello" }], { signal: controller.signal })[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toBeInstanceOf(ProviderError);
  });

  it("throws a cancelled error when the signal is already aborted", async () => {
    const provider = new NotConnectedProvider();
    const controller = new AbortController();
    controller.abort();
    const iterable = provider.send([{ role: "user", text: "hello" }], { signal: controller.signal });
    await expect(drain(iterable)).rejects.toMatchObject({ code: "cancelled" });
  });
});
