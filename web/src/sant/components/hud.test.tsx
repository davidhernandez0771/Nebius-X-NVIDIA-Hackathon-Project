import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { MotionProvider } from "../motion/MotionProvider";
import { digitDots } from "../motion/countdown";
import { CountUpTiles, Dial, DottedCountdown, GlyphLoader, PillNav, StatusGlyph, TrackingHUD, type Detection, type GlyphState } from ".";

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: reduce && query.includes("reduce"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

/** An IntersectionObserver that never reports, so a counter stays at its start value. */
function stubQuietObserver() {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
}

function wrap(ui: ReactNode, path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MotionProvider>{ui}</MotionProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => localStorage.clear());

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const DETECTIONS: Detection[] = [
  { id: "hand", label: "hand", score: 0.973, box: [0.1, 0.2, 0.3, 0.4], tone: "live" },
  { id: "cube", label: "cube", box: [0.6, 0.55, 0.1, 0.1], tone: "issue" },
  { id: "bin", label: "bin", box: [0.85, 0.7, 0.3, 0.4] },
];

describe("TrackingHUD", () => {
  it("draws one labelled box per detection, with the score to two decimals", () => {
    const { container } = wrap(<TrackingHUD detections={DETECTIONS} label="Webcam tracking" />);
    expect(container.querySelectorAll(".sant-hud__box")).toHaveLength(3);
    const tags = Array.from(container.querySelectorAll(".sant-hud__tag")).map((t) => t.textContent);
    expect(tags).toEqual(["hand 0.97", "cube", "bin"]);
  });

  it("places boxes in percent of the frame and keeps them inside it", () => {
    const { container } = wrap(<TrackingHUD detections={DETECTIONS} label="Webcam tracking" />);
    const [hand, , bin] = Array.from(container.querySelectorAll<HTMLElement>(".sant-hud__box"));
    expect(hand.style.left).toBe("10%");
    expect(hand.style.top).toBe("20%");
    expect(hand.style.width).toBe("30%");
    expect(hand.style.height).toBe("40%");
    // The bin starts at 85% and is 30% wide, so it is cut at the right edge.
    expect(parseFloat(bin.style.width)).toBeCloseTo(15);
    expect(parseFloat(bin.style.height)).toBeCloseTo(30);
  });

  it("carries each detection's tone, so the label and stroke colour can follow it", () => {
    const { container } = wrap(<TrackingHUD detections={DETECTIONS} label="Webcam tracking" />);
    const tones = Array.from(container.querySelectorAll(".sant-hud__box")).map((b) => b.getAttribute("data-tone"));
    expect(tones).toEqual(["live", "issue", "neutral"]);
  });

  it("lists what it tracks in words for assistive tech; the drawing is hidden", () => {
    const { container } = wrap(<TrackingHUD detections={DETECTIONS} label="Webcam tracking" />);
    expect(screen.getByRole("figure", { name: "Webcam tracking" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Tracked" }).textContent).toMatch(/hand, 97% confidence/);
    expect(container.querySelector(".sant-hud__overlay")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("stops boxes gliding between frames when motion is reduced", () => {
    stubReducedMotion(true);
    const { container } = wrap(<TrackingHUD detections={DETECTIONS} label="Webcam tracking" />);
    expect(container.querySelector(".sant-hud")?.getAttribute("data-animate")).toBe("false");
  });
});

const STATES: GlyphState[] = ["recorded", "diagnosed", "repaired", "verified", "failed", "blocked"];

describe("StatusGlyph", () => {
  it("names every state, so colour is never the only signal", () => {
    wrap(
      <>
        {STATES.map((s) => (
          <StatusGlyph key={s} state={s} />
        ))}
      </>,
    );
    for (const name of ["Recorded", "Diagnosed", "Repaired", "Verified", "Failed", "Blocked"]) {
      expect(screen.getByRole("img", { name })).toBeTruthy();
    }
  });

  it("draws every state with its own mark", () => {
    const { container } = wrap(
      <>
        {STATES.map((s) => (
          <StatusGlyph key={s} state={s} />
        ))}
      </>,
    );
    const marks = Array.from(container.querySelectorAll(".sant-glyph__mark")).map((m) => m.getAttribute("d"));
    expect(new Set(marks).size).toBe(STATES.length);
  });

  it("can show its name as text beside the mark", () => {
    const { container } = wrap(<StatusGlyph state="verified" showLabel />);
    expect(screen.getByText("Verified")).toBeTruthy();
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("redraws the mark when the state changes", () => {
    const { container, rerender } = wrap(<StatusGlyph state="diagnosed" />);
    const before = container.querySelector("svg");
    rerender(
      <MemoryRouter>
        <MotionProvider>
          <StatusGlyph state="repaired" />
        </MotionProvider>
      </MemoryRouter>,
    );
    expect(container.querySelector("svg")).not.toBe(before);
    expect(container.querySelector(".sant-glyph")?.getAttribute("data-state")).toBe("repaired");
  });

  it("marks a step still in progress as busy", () => {
    const { container } = wrap(<StatusGlyph state="diagnosed" busy />);
    expect(container.querySelector(".sant-glyph")?.getAttribute("data-busy")).toBe("true");
    expect(screen.getByRole("img", { name: "Diagnosing" })).toBeTruthy();
  });

  it("is still with effects off", () => {
    localStorage.setItem("sant.effects", "off");
    const { container } = wrap(<StatusGlyph state="verified" />);
    expect(container.querySelector(".sant-glyph")?.getAttribute("data-animate")).toBe("false");
  });
});

describe("CountUpTiles", () => {
  const tiles = (
    <CountUpTiles from={7.5} to={42.5} decimals={1} suffix="%" label="success on 40 new scenes" note="3 of 40 → 17 of 40" />
  );

  it("gives assistive tech the final value; the rolling digits are hidden", () => {
    stubQuietObserver();
    const { container } = wrap(tiles);
    expect(screen.getByRole("group", { name: "42.5% success on 40 new scenes" })).toBeTruthy();
    expect(container.querySelector(".sant-tiles__row")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("waits at the start value until it is seen, with the leading tile blank", () => {
    stubReducedMotion(false);
    stubQuietObserver();
    const { container } = wrap(tiles);
    const cells = Array.from(container.querySelectorAll<HTMLElement>(".sant-tiles__tile"));
    expect(cells.map((c) => c.dataset.pos)).toEqual(["0", "7", "5"]);
    expect(cells[0].dataset.lead).toBe("true");
  });

  it("shows the end value at once when motion is reduced", () => {
    stubReducedMotion(true);
    stubQuietObserver();
    const { container } = wrap(tiles);
    const cells = Array.from(container.querySelectorAll<HTMLElement>(".sant-tiles__tile"));
    expect(cells.map((c) => c.dataset.pos)).toEqual(["4", "2", "5"]);
    expect(cells[0].dataset.lead).toBe("false");
    expect(screen.getByText("%")).toBeTruthy();
  });
});

describe("DottedCountdown", () => {
  function lit(container: HTMLElement) {
    return Array.from(container.querySelectorAll(".sant-count__dot")).map((d) => d.getAttribute("data-on") === "true");
  }

  it("counts 3, 2, 1 a second apart, then says it is done", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    const { container } = wrap(<DottedCountdown running onDone={onDone} />);
    expect(screen.getByRole("timer").textContent).toMatch(/Recording starts in 3/);
    expect(lit(container)).toEqual(digitDots("3"));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole("timer").textContent).toMatch(/in 2/);
    expect(lit(container)).toEqual(digitDots("2"));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(lit(container)).toEqual(digitDots("1"));
    expect(onDone).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("keeps time with motion reduced: only the decoration stops", () => {
    stubReducedMotion(true);
    vi.useFakeTimers();
    const onDone = vi.fn();
    const { container } = wrap(<DottedCountdown from={2} running onDone={onDone} />);
    expect(container.querySelector(".sant-count")?.getAttribute("data-animate")).toBe("false");
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("waits, dimmed, until it is told to run", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    const { container } = wrap(<DottedCountdown running={false} onDone={onDone} />);
    expect(container.querySelector(".sant-count")?.getAttribute("data-idle")).toBe("true");
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("Dial", () => {
  it("is a meter with its value in words", () => {
    wrap(<Dial label="Gripper" value={42} min={0} max={80} unit="mm" step={5} major={20} />);
    const meter = screen.getByRole("meter", { name: "Gripper" });
    expect(meter.getAttribute("aria-valuenow")).toBe("42");
    expect(meter.getAttribute("aria-valuemin")).toBe("0");
    expect(meter.getAttribute("aria-valuemax")).toBe("80");
    expect(meter.getAttribute("aria-valuetext")).toBe("42 mm");
  });

  it("rolls the scale so the value sits under the index mark", () => {
    const { container } = wrap(<Dial label="Gripper" value={60} min={0} max={80} unit="mm" step={5} major={20} sweep={240} />);
    // 60 of 0–80 is 60° right of centre, so the scale turns 60° left.
    expect(container.querySelector<SVGGElement>(".sant-dial__scale")?.style.transform).toBe("rotate(-60deg)");
  });

  it("labels the major ticks", () => {
    wrap(<Dial label="Joint 1" value={30} min={-166} max={166} unit="°" step={10} major={90} />);
    for (const v of ["−90", "0", "90"]) expect(screen.getByText(v)).toBeTruthy();
  });

  it("carries a tone, e.g. amber while the gripper is closed", () => {
    const { container } = wrap(<Dial label="Gripper" value={4} min={0} max={80} unit="mm" step={5} major={20} tone="issue" />);
    expect(container.querySelector(".sant-dial")?.getAttribute("data-tone")).toBe("issue");
  });

  it("writes negative values with a true minus, like its scale", () => {
    wrap(<Dial label="Joint 1" value={-15} min={-166} max={166} unit="°" step={10} major={90} />);
    expect(screen.getByText("−15")).toBeTruthy();
  });

  it("shows the value with fixed decimals", () => {
    wrap(<Dial label="Reach" value={0.4321} min={0} max={0.855} unit="m" step={0.05} major={0.2} decimals={2} />);
    expect(screen.getByText("0.43")).toBeTruthy();
  });
});

describe("GlyphLoader", () => {
  it("is a progress bar when it knows how far along it is", () => {
    wrap(<GlyphLoader label="Starting Isaac Sim" progress={0.42} />);
    const bar = screen.getByRole("progressbar", { name: "Starting Isaac Sim" });
    expect(bar.getAttribute("aria-valuenow")).toBe("42");
  });

  it("is a status message when it doesn't", () => {
    wrap(<GlyphLoader label="Starting MediaPipe" />);
    expect(screen.getByRole("status").textContent).toMatch(/Starting MediaPipe/);
  });

  it("scrambles the unresolved part of the label while it loads", () => {
    stubReducedMotion(false);
    vi.useFakeTimers();
    const { container } = wrap(<GlyphLoader label="Starting Isaac Sim" progress={0} />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(container.querySelector(".sant-glyphs__text")?.textContent).not.toBe("Starting Isaac Sim");
  });

  it("shows the plain label with motion reduced, and when done", () => {
    stubReducedMotion(true);
    const { container, rerender } = wrap(<GlyphLoader label="Starting Isaac Sim" progress={0.1} />);
    expect(container.querySelector(".sant-glyphs__text")?.textContent).toBe("Starting Isaac Sim");
    stubReducedMotion(false);
    rerender(
      <MemoryRouter>
        <MotionProvider>
          <GlyphLoader label="Isaac Sim is ready" done />
        </MotionProvider>
      </MemoryRouter>,
    );
    expect(container.querySelector(".sant-glyphs__text")?.textContent).toBe("Isaac Sim is ready");
    expect(container.querySelector(".sant-glyphs")?.getAttribute("data-done")).toBe("true");
  });
});

describe("PillNav", () => {
  const ITEMS = [
    { to: "/record", label: "Record" },
    { to: "/review", label: "Review" },
    { to: "/dataset", label: "Dataset" },
  ];

  function at(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <MotionProvider>
          <Routes>
            {ITEMS.map((i) => (
              <Route key={i.to} path={i.to} element={<PillNav items={ITEMS} label="Pages" />} />
            ))}
          </Routes>
        </MotionProvider>
      </MemoryRouter>,
    );
  }

  it("is a named nav with the current page marked", () => {
    at("/review");
    const nav = screen.getByRole("navigation", { name: "Pages" });
    expect(nav).toBeTruthy();
    expect(screen.getByRole("link", { name: "Review" }).getAttribute("aria-current")).toBe("page");
  });

  it("lights the joins up to the current page, since the pages are steps in order", () => {
    const { container } = at("/review");
    expect(Array.from(container.querySelectorAll(".sant-pill__join")).map((j) => j.getAttribute("data-done"))).toEqual(["true", "false"]);
  });

  it("puts the glowing mark behind the current link, measured from the list", () => {
    // Each item is positioned, so a link's offsetLeft is relative to its item, not the list.
    const left: Record<string, number> = { Record: 104, Review: 200, Dataset: 300 };
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const x = this.classList.contains("sant-pill__list") ? 100 : (left[this.textContent ?? ""] ?? 0);
      return { left: x, width: this.classList.contains("sant-pill__link") ? 70 : 400, top: 0, height: 30 } as DOMRect;
    });
    const { container } = at("/review");
    const mark = container.querySelector<HTMLElement>(".sant-pill__mark");
    expect(mark?.style.getPropertyValue("--x")).toBe("100px");
    expect(mark?.style.getPropertyValue("--w")).toBe("70px");
    vi.restoreAllMocks();
  });

  it("moves the current mark when another page is chosen", () => {
    const { container } = at("/record");
    fireEvent.click(screen.getByRole("link", { name: "Dataset" }));
    expect(screen.getByRole("link", { name: "Dataset" }).getAttribute("aria-current")).toBe("page");
    expect(Array.from(container.querySelectorAll(".sant-pill__join")).map((j) => j.getAttribute("data-done"))).toEqual(["true", "true"]);
  });
});
