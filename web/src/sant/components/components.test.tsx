import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { MotionProvider } from "../motion/MotionProvider";
import { EFFECTS_KEY } from "../motion/effects";
import { Badge, Button, Card, ChartFrame, EffectsToggle, Logo, ResultBars, SectionHeader, Stat, StepRail, ToastProvider, useToast } from ".";
import { LOGO_SYMBOL } from "./logoSymbol";

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduce && query.includes("reduce"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function wrap(ui: ReactNode) {
  return render(
    <MemoryRouter>
      <MotionProvider>
        <ToastProvider>{ui}</ToastProvider>
      </MotionProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete document.documentElement.dataset.motion;
  delete document.documentElement.dataset.effects;
});

describe("Button", () => {
  it("is a real button that runs its action", () => {
    const onClick = vi.fn();
    wrap(<Button onClick={onClick}>Record a demo</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Record a demo" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is a link when given a route", () => {
    wrap(<Button to="/pm/record">Open the app</Button>);
    expect(screen.getByRole("link", { name: "Open the app" }).getAttribute("href")).toBe("/pm/record");
  });

  it("carries its variant as a class", () => {
    wrap(<Button variant="secondary">See the results</Button>);
    expect(screen.getByRole("button").className).toContain("sant-btn--secondary");
  });
});

describe("Badge", () => {
  it("always shows its text, so colour is never the only signal", () => {
    wrap(<Badge tone="issue">2 pauses</Badge>);
    expect(screen.getByText("2 pauses").closest(".sant-badge")?.className).toContain("sant-badge--issue");
  });

  it("hides the live dot from assistive tech", () => {
    const { container } = wrap(
      <Badge tone="live" dot>
        Sim connected
      </Badge>,
    );
    expect(container.querySelector(".sant-badge__dot")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("Card", () => {
  it("is a titled section", () => {
    wrap(
      <Card title="Verified copies" tone="live">
        300 of 300
      </Card>,
    );
    expect(screen.getByRole("region", { name: "Verified copies" }).className).toContain("sant-card--live");
  });
});

describe("Stat", () => {
  it("names the final value and label for assistive tech, whatever the digits show", () => {
    wrap(<Stat value={42.5} decimals={1} suffix="%" label="success with multiplied demos" />);
    expect(screen.getByRole("group", { name: "42.5% success with multiplied demos" })).toBeTruthy();
  });

  it("shows the final value at once when motion is reduced", () => {
    stubReducedMotion(true);
    const { container } = wrap(<Stat value={7.5} decimals={1} suffix="%" label="success with the 10 demos alone" />);
    expect(container.querySelector(".sant-stat__value")?.textContent).toBe("7.5%");
  });

  it("shows the final value when it can't watch the viewport (no IntersectionObserver)", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const { container } = wrap(<Stat value={17} label="successes out of 40" />);
    expect(container.querySelector(".sant-stat__value")?.textContent).toBe("17");
  });

  it("shows its note and source", () => {
    wrap(<Stat value={42.5} decimals={1} suffix="%" label="success" note="17 of 40, 95% CI 28.5–57.8%" source="T3 sprint 7 note" />);
    expect(screen.getByText("17 of 40, 95% CI 28.5–57.8%")).toBeTruthy();
    expect(screen.getByText(/T3 sprint 7 note/)).toBeTruthy();
  });
});

describe("SectionHeader", () => {
  it("is a heading with its lede and margin note", () => {
    wrap(<SectionHeader title="Multiplying helps" lede="Same 10 demos, two policies." note="Fisher exact p = 0.0005" />);
    expect(screen.getByRole("heading", { level: 2, name: "Multiplying helps" })).toBeTruthy();
    expect(screen.getByText("Fisher exact p = 0.0005").closest(".sant-margin-note")).toBeTruthy();
  });

  it("takes a heading level", () => {
    wrap(<SectionHeader title="Type" level={3} />);
    expect(screen.getByRole("heading", { level: 3, name: "Type" })).toBeTruthy();
  });
});

describe("StepRail", () => {
  it("lists the four steps with their full names, in order", () => {
    wrap(<StepRail active={1} />);
    const items = within(screen.getByRole("list", { name: "SANT steps" })).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["SSimulate", "AAugment", "NNeaten", "TTrain"]);
  });

  it("marks the active step as the current one and earlier steps done", () => {
    wrap(<StepRail active={2} />);
    const items = screen.getAllByRole("listitem");
    expect(items[2].getAttribute("aria-current")).toBe("step");
    expect(items.map((li) => li.dataset.state)).toEqual(["done", "done", "active", "idle"]);
  });
});

describe("ChartFrame", () => {
  it("is a figure whose caption carries the source as text", () => {
    wrap(
      <ChartFrame title="Success on 40 new scenes" caption="One task, one robot." source="T3 status note, 2026-10-17 13:15">
        <svg />
      </ChartFrame>,
    );
    const figure = screen.getByRole("figure", { name: /Success on 40 new scenes/ });
    expect(within(figure).getByText(/T3 status note, 2026-10-17 13:15/)).toBeTruthy();
  });
});

describe("ResultBars", () => {
  const arms = [
    { label: "10 demos alone", k: 3, n: 40, ciLow: 2.6, ciHigh: 19.9 },
    { label: "10 demos + 100 copies", k: 17, n: 40, ciLow: 28.5, ciHigh: 57.8 },
  ];

  it("repeats the data in a table for screen readers", () => {
    wrap(<ResultBars arms={arms} p="0.0005" />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("10 demos + 100 copies")).toBeTruthy();
    expect(within(table).getByText("17 of 40")).toBeTruthy();
    expect(within(table).getByText("28.5–57.8%")).toBeTruthy();
  });

  it("draws each bar at its measured rate, never past it", () => {
    stubReducedMotion(true);
    const { container } = wrap(<ResultBars arms={arms} p="0.0005" />);
    const bars = [...container.querySelectorAll<HTMLElement>(".sant-bars__bar")];
    expect(bars.map((b) => b.style.getPropertyValue("--sant-bar"))).toEqual(["0.075", "0.425"]);
  });

  it("states the p-value as text", () => {
    wrap(<ResultBars arms={arms} p="0.0005" />);
    expect(screen.getByText("Fisher exact p = 0.0005")).toBeTruthy();
  });
});

describe("Logo", () => {
  it("is named SANT", () => {
    wrap(<Logo />);
    expect(screen.getByRole("img", { name: "SANT" })).toBeTruthy();
  });

  it("is a symbol, not letters: one path per part of the swappable symbol", () => {
    const { container } = wrap(<Logo wordmark={false} />);
    const parts = container.querySelectorAll(".sant-logo__symbol .sant-logo__unit");
    expect(parts).toHaveLength(LOGO_SYMBOL.units.length);
    parts.forEach((p, i) => expect(p.getAttribute("d")).toBe(LOGO_SYMBOL.units[i]));
    expect(container.textContent).toBe("");
  });

  it("lights the inner cube in the accent and the open frame and its corner lines in ink", () => {
    const { container } = wrap(<Logo wordmark={false} />);
    const parts = [...container.querySelectorAll(".sant-logo__unit")].map((p) => p.getAttribute("data-part"));
    expect(parts).toEqual(LOGO_SYMBOL.units.map((_, i) => (LOGO_SYMBOL.accent.includes(i) ? "accent" : "ink")));
    expect(parts.filter((p) => p === "accent")).toHaveLength(2);
    // Strokes, as the file draws it, round-capped.
    expect(container.querySelector(".sant-logo__symbol")?.getAttribute("stroke-width")).toBe(String(LOGO_SYMBOL.stroke));
    expect(container.querySelector(".sant-logo__symbol")?.getAttribute("stroke-linecap")).toBe("round");
  });

  it("can be the mark alone, still named SANT", () => {
    wrap(<Logo wordmark={false} />);
    expect(screen.getByRole("img", { name: "SANT" })).toBeTruthy();
  });

  it("sets the wordmark beside the symbol by default", () => {
    const { container } = wrap(<Logo />);
    expect(container.querySelector(".sant-logo__symbol")).toBeTruthy();
    expect(container.querySelector(".sant-logo__word")?.textContent).toBe("SANT");
  });

  it("uses the user's SVG when given one", () => {
    wrap(<Logo src="/logo.svg" />);
    expect(screen.getByRole("img", { name: "SANT" }).getAttribute("src")).toBe("/logo.svg");
  });
});

describe("EffectsToggle", () => {
  it("is a switch that turns effects off, reduces motion and remembers the choice", () => {
    wrap(<EffectsToggle />);
    const sw = screen.getByRole("switch", { name: /effects/i });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.dataset.motion).toBe("full");
    fireEvent.click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(document.documentElement.dataset.effects).toBe("off");
    expect(document.documentElement.dataset.motion).toBe("reduced");
    expect(localStorage.getItem(EFFECTS_KEY)).toBe("off");
  });

  it("starts off when the choice was saved", () => {
    localStorage.setItem(EFFECTS_KEY, "off");
    wrap(<EffectsToggle />);
    expect(screen.getByRole("switch", { name: /effects/i }).getAttribute("aria-checked")).toBe("false");
  });
});

describe("Toast", () => {
  function Trigger({ tone }: { tone?: "neutral" | "danger" }) {
    const toast = useToast();
    return <button onClick={() => toast.show({ message: tone === "danger" ? "Upload failed" : "Demo saved", tone })}>show</button>;
  }

  it("announces a message politely and can be dismissed", () => {
    wrap(<Trigger />);
    fireEvent.click(screen.getByText("show"));
    expect(screen.getByRole("status").textContent).toContain("Demo saved");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Demo saved")).toBeNull();
  });

  it("uses an alert for errors", () => {
    wrap(<Trigger tone="danger" />);
    fireEvent.click(screen.getByText("show"));
    expect(screen.getByRole("alert").textContent).toContain("Upload failed");
  });

  it("dismisses itself after 6 s, but not while hovered", () => {
    vi.useFakeTimers();
    wrap(<Trigger />);
    fireEvent.click(screen.getByText("show"));
    const toast = screen.getByRole("status");
    fireEvent.mouseEnter(toast);
    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(screen.queryByText("Demo saved")).not.toBeNull();
    fireEvent.mouseLeave(toast);
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.queryByText("Demo saved")).toBeNull();
  });
});
