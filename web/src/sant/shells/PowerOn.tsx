// The story → app "power on" (docs/design/motion.md §4): a Volt cover grows from the clicked
// button, the S·A·N·T units light one by one, the route changes while the page is covered, and
// the cover fades to reveal the app. Reduced motion: an instant route change.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useMotion } from "../motion/MotionProvider";
import { powerOnPlan, type PowerOnStep } from "../motion/powerOn";

type Run = { x: number; y: number; phase: "start" | "cover" | "reveal"; lit: number };

const PowerOnContext = createContext<{ start: (to: string, from?: Element | null) => void }>({ start: () => {} });

function focusPageHeading() {
  const h = document.querySelector<HTMLElement>("main h1");
  if (!h) return;
  if (!h.hasAttribute("tabindex")) h.setAttribute("tabindex", "-1");
  h.focus();
}

export function PowerOnProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { reduced } = useMotion();
  const [run, setRun] = useState<Run | null>(null);
  const timers = useRef<number[]>([]);
  const pending = useRef<{ to: string; navigated: boolean } | null>(null);

  const finish = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    const p = pending.current;
    pending.current = null;
    if (p && !p.navigated) navigate(p.to);
    setRun(null);
    window.setTimeout(focusPageHeading, 0);
  }, [navigate]);

  const apply = useCallback(
    (step: PowerOnStep) => {
      switch (step.phase) {
        case "cover":
          setRun((r) => r && { ...r, phase: "cover" });
          break;
        case "light":
          setRun((r) => r && { ...r, lit: step.unit + 1 });
          break;
        case "navigate":
          if (pending.current) {
            pending.current.navigated = true;
            navigate(pending.current.to);
          }
          break;
        case "reveal":
          setRun((r) => r && { ...r, phase: "reveal" });
          break;
        case "done":
          finish();
          break;
      }
    },
    [navigate, finish],
  );

  const start = useCallback(
    (to: string, from?: Element | null) => {
      if (pending.current) {
        finish();
        return;
      }
      if (reduced) {
        navigate(to);
        window.setTimeout(focusPageHeading, 0);
        return;
      }
      const rect = from?.getBoundingClientRect();
      const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
      const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
      pending.current = { to, navigated: false };
      setRun({ x, y, phase: "start", lit: 0 });
      // The cover step at t = 0 still runs in a timer, so the first frame paints the circle at 0.
      timers.current = powerOnPlan(false).map((step) => window.setTimeout(() => apply(step), step.at));
    },
    [reduced, navigate, finish, apply],
  );

  useEffect(() => {
    if (!run) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, finish]);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const value = useMemo(() => ({ start }), [start]);
  return (
    <PowerOnContext.Provider value={value}>
      {children}
      {run &&
        createPortal(
          <div
            className="sant sant-poweron"
            data-mode="volt"
            data-phase={run.phase}
            aria-hidden="true"
            onClick={finish}
            style={{ "--x": `${run.x}px`, "--y": `${run.y}px` } as CSSProperties}
          >
            <span className="sant-poweron__mark">
              {["S", "A", "N", "T"].map((u, i) => (
                <span key={u} className="sant-poweron__unit" data-lit={i < run.lit}>
                  {u}
                </span>
              ))}
            </span>
          </div>,
          document.body,
        )}
    </PowerOnContext.Provider>
  );
}

export function usePowerOn() {
  return useContext(PowerOnContext);
}
