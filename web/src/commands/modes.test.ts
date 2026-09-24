import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetLaunchGuardForTests, launchLink, launchMode, validateModeLink } from "./modes";
import type { Mode, ModeLink } from "./types";

function link(overrides: Partial<ModeLink> = {}): ModeLink {
  return { id: "link-1", kind: "external", label: "Docs", url: "https://example.com", ...overrides };
}

function mode(overrides: Partial<Mode> = {}): Mode {
  return {
    id: "mode-1",
    name: "Focus mode",
    links: [link()],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("validateModeLink", () => {
  it("accepts an https external link", () => {
    expect(validateModeLink({ kind: "external", url: "https://example.com" })).toBeNull();
  });

  it("accepts an http external link", () => {
    expect(validateModeLink({ kind: "external", url: "http://example.com" })).toBeNull();
  });

  it("rejects a javascript: scheme", () => {
    expect(validateModeLink({ kind: "external", url: "javascript:alert(1)" })).toMatch(/scheme/i);
  });

  it("rejects a data: scheme", () => {
    expect(validateModeLink({ kind: "external", url: "data:text/html,<script>1</script>" })).toMatch(/scheme/i);
  });

  it("rejects an unparseable external URL", () => {
    expect(validateModeLink({ kind: "external", url: "not a url" })).not.toBeNull();
  });

  it("accepts an internal path starting with /", () => {
    expect(validateModeLink({ kind: "internal", url: "/inventory" })).toBeNull();
  });

  it("rejects an internal path not starting with /", () => {
    expect(validateModeLink({ kind: "internal", url: "inventory" })).not.toBeNull();
  });
});

describe("launchLink", () => {
  let navigate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    navigate = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("navigates for an internal link and reports opened", () => {
    const result = launchLink(link({ kind: "internal", url: "/modes" }), navigate);
    expect(navigate).toHaveBeenCalledWith("/modes");
    expect(result.status).toBe("opened");
  });

  it("calls window.open for an external link and reports opened when it returns a window", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue({} as Window);
    const result = launchLink(link({ url: "https://example.com/docs" }), navigate);
    expect(openSpy).toHaveBeenCalledWith("https://example.com/docs", "_blank", "noopener,noreferrer");
    expect(result.status).toBe("opened");
  });

  it("reports blocked when window.open returns null (popup blocked)", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const result = launchLink(link(), navigate);
    expect(result.status).toBe("blocked");
    expect(result.message).toMatch(/blocked/i);
  });

  it("reports error and never calls window.open for an invalid scheme", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue({} as Window);
    const result = launchLink(link({ url: "javascript:alert(1)" }), navigate);
    expect(result.status).toBe("error");
    expect(openSpy).not.toHaveBeenCalled();
  });
});

describe("launchMode", () => {
  let navigate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    navigate = vi.fn();
    __resetLaunchGuardForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("launches every link in order and reports allOpened when every link opens", () => {
    vi.spyOn(window, "open").mockReturnValue({} as Window);
    const m = mode({ links: [link({ id: "a" }), link({ id: "b", kind: "internal", url: "/inventory" })] });
    const result = launchMode(m, navigate);
    expect(result.results.map((r) => r.linkId)).toEqual(["a", "b"]);
    expect(result.allOpened).toBe(true);
  });

  it("reports allOpened false and per-link blocked status when a popup is blocked", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const result = launchMode(mode(), navigate);
    expect(result.allOpened).toBe(false);
    expect(result.results[0].status).toBe("blocked");
  });

  it("never calls window.open a second time for a repeated launch inside the duplicate window", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue({} as Window);
    let t = 1_000;
    const now = () => t;
    const m = mode();
    launchMode(m, navigate, now);
    t += 100; // well inside the 1500ms duplicate-launch window
    const second = launchMode(m, navigate, now);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(second.results[0].status).toBe("blocked");
    expect(second.results[0].message).toMatch(/just activated/i);
  });

  it("allows a second launch once the duplicate-launch window has passed", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue({} as Window);
    let t = 1_000;
    const now = () => t;
    const m = mode();
    launchMode(m, navigate, now);
    t += 2_000; // past the 1500ms window
    launchMode(m, navigate, now);
    expect(openSpy).toHaveBeenCalledTimes(2);
  });

  it("tracks the duplicate-launch guard independently per mode id", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue({} as Window);
    const now = () => 5_000;
    launchMode(mode({ id: "mode-a" }), navigate, now);
    launchMode(mode({ id: "mode-b" }), navigate, now);
    expect(openSpy).toHaveBeenCalledTimes(2);
  });

  it("reports allOpened false for a mode with no links rather than vacuously true", () => {
    const result = launchMode(mode({ links: [] }), navigate);
    expect(result.allOpened).toBe(false);
    expect(result.results).toEqual([]);
  });
});
