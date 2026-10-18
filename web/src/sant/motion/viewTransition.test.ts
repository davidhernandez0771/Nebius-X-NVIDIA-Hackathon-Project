import { describe, expect, it, vi } from "vitest";
import { navigateWithTransition } from "./viewTransition";

const passThrough = (fn: () => void) => fn();

describe("navigateWithTransition", () => {
  it("wraps the navigation in startViewTransition when supported and motion is full", () => {
    const navigate = vi.fn();
    const startViewTransition = vi.fn((cb: () => void) => {
      cb();
      return {};
    });
    navigateWithTransition(navigate, "/pm/record", { reduced: false, doc: { startViewTransition }, flush: passThrough });
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/pm/record");
  });

  it("commits the route synchronously inside the transition callback", () => {
    const order: string[] = [];
    const navigate = vi.fn(() => {
      order.push("navigate");
    });
    const flush = (fn: () => void) => {
      order.push("flush:start");
      fn();
      order.push("flush:end");
    };
    const startViewTransition = (cb: () => void) => {
      cb();
      return {};
    };
    navigateWithTransition(navigate, "/a", { reduced: false, doc: { startViewTransition }, flush });
    expect(order).toEqual(["flush:start", "navigate", "flush:end"]);
  });

  it("navigates directly when the browser has no view transitions", () => {
    const navigate = vi.fn();
    navigateWithTransition(navigate, "/b", { reduced: false, doc: {}, flush: passThrough });
    expect(navigate).toHaveBeenCalledWith("/b");
  });

  it("navigates directly when motion is reduced, even if supported", () => {
    const navigate = vi.fn();
    const startViewTransition = vi.fn();
    navigateWithTransition(navigate, "/c", { reduced: true, doc: { startViewTransition }, flush: passThrough });
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/c");
  });
});
