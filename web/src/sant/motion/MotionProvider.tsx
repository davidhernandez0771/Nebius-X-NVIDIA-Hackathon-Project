// One source of truth for motion: reduced when the OS asks or the user turns effects off.
// Sets data-effects and data-motion on <html>, which tokens.css uses to collapse durations.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { readEffects, resolveMotion, writeEffects, type Effects } from "./effects";

const QUERY = "(prefers-reduced-motion: reduce)";

type Motion = { effects: Effects; setEffects: (e: Effects) => void; reduced: boolean; prefersReduced: boolean };

const MotionContext = createContext<Motion>({ effects: "on", setEffects: () => {}, reduced: false, prefersReduced: false });

function localStore() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function mediaQuery(): MediaQueryList | undefined {
  return typeof window.matchMedia === "function" ? window.matchMedia(QUERY) : undefined;
}

export function MotionProvider({ children }: { children: ReactNode }) {
  const [prefersReduced, setPrefersReduced] = useState(() => mediaQuery()?.matches ?? false);
  const [effects, setEffectsState] = useState<Effects>(() => readEffects(localStore()));
  const { reduced } = resolveMotion({ prefersReduced, effects });

  useEffect(() => {
    const mq = mediaQuery();
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setPrefersReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.effects = effects;
    root.dataset.motion = reduced ? "reduced" : "full";
    return () => {
      delete root.dataset.effects;
      delete root.dataset.motion;
    };
  }, [effects, reduced]);

  const setEffects = useCallback((e: Effects) => {
    writeEffects(localStore(), e);
    setEffectsState(e);
  }, []);

  const value = useMemo(() => ({ effects, setEffects, reduced, prefersReduced }), [effects, setEffects, reduced, prefersReduced]);
  return <MotionContext.Provider value={value}>{children}</MotionContext.Provider>;
}

export function useMotion(): Motion {
  return useContext(MotionContext);
}
