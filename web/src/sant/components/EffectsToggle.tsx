import { useMotion } from "../motion/MotionProvider";

/** The visible "Effects" switch. Off means static end states everywhere, like reduced motion. */
export function EffectsToggle() {
  const { effects, setEffects, prefersReduced } = useMotion();
  const on = effects === "on";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className="sant-switch"
      onClick={() => setEffects(on ? "off" : "on")}
      title={prefersReduced ? "Your system asks for reduced motion, so effects stay still either way" : undefined}
    >
      <span className="sant-switch__track" aria-hidden="true">
        <span className="sant-switch__thumb" />
      </span>
      <span className="sant-switch__label">Effects</span>
    </button>
  );
}
