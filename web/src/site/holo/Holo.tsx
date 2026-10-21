// The holo primitives, shared by the work pages after Record (/pipeline, /data) so the three read as one place:
// the page frame (Record's top strip, the void and its faint cutting-mat grid), a see-through panel with corner
// ticks, a mono tag, a hairline rule, a glow trace, and the hand-off link between pages (handoff.ts). The look is
// holo.css; the panel imposes nothing structural, so any element can take the class.
// Owner: T1 (pm/data-holo); T2's /pipeline uses it. Ask before changing a class's box model.
import { useEffect, useRef, type ComponentPropsWithoutRef, type ElementType, type MouseEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate, type LinkProps } from "react-router-dom";
import { Logo } from "../../sant/components/Logo";
import { useMotion } from "../../sant/motion/MotionProvider";
import { handingOff, handoffArrive, handoffStart } from "./handoff";
import "./holo.css";

/** The pages on the path, and the ones off it (in the More nav) that use the frame too. */
export type HoloPageId = "record" | "pipeline" | "data" | "test-track";

/** The path the work pages share, in the order the visitor goes. */
export const PATH: { id: HoloPageId; to: string; label: string }[] = [
  { id: "record", to: "/record", label: "Record" },
  { id: "pipeline", to: "/pipeline", label: "Pipeline" },
  { id: "data", to: "/data", label: "Data" },
];

const MORE: { id?: HoloPageId; to: string; label: string }[] = [
  { to: "/robots", label: "Robots" },
  { to: "/site/results", label: "Results" },
  // A viewer of finished runs (T5's /test-track), not a step on the path.
  { id: "test-track", to: "/test-track", label: "Test track" },
];

const MAIN_ID = "holo-main";

/** A link to the next page that plays the hand-off (handoff.ts) first. A click with a modifier (a new tab), a
 *  link to the page already shown and reduced motion are plain links. */
export function HandoffLink({ to, label, onClick, ...rest }: Omit<LinkProps, "to"> & { to: string; label: string }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { reduced } = useMotion();
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return;
    if ((rest.target && rest.target !== "_self") || to.split(/[?#]/)[0] === pathname) return;
    e.preventDefault();
    if (handingOff()) return;
    handoffStart(label, () => navigate(to), { reduced });
  };
  return <Link to={to} onClick={click} {...rest} />;
}

/** The frame of a work page: Record's top strip (the mark, back to the workshop, the title, the path
 *  Record › Pipeline › Data, the page's actions), then the page. Keeps the SANT app's root (.sant, Volt). */
export function HoloPage({ title, here, actions, children }: { title: string; here: HoloPageId; actions?: ReactNode; children: ReactNode }) {
  const h1 = useRef<HTMLHeadingElement>(null);
  // Arrived by a hand-off: lift its veil and bring the focus here.
  useEffect(() => handoffArrive(h1.current), []);
  return (
    <div className="sant holo holo-page" data-mode="volt" data-here={here}>
      <a className="sant-skip" href={`#${MAIN_ID}`}>
        Skip to content
      </a>
      <header className="holo-top">
        <div className="holo-top__left">
          <span className="holo-top__brand">
            <Logo size="sm" lit="all" />
          </span>
          <Link className="holo-top__eject" to="/" title="Back to the workshop">
            <span aria-hidden="true">⏏</span> workshop
          </Link>
          <h1 ref={h1} className="holo-top__title" tabIndex={-1}>
            {title}
          </h1>
        </div>
        <nav className="holo-path" aria-label="Pages">
          <ol>
            {PATH.map((p) => (
              <li key={p.id}>
                <HandoffLink to={p.to} label={p.label} aria-current={p.id === here ? "page" : undefined}>
                  {p.label}
                </HandoffLink>
              </li>
            ))}
          </ol>
        </nav>
        <div className="holo-top__right">
          {actions && <div className="holo-top__actions">{actions}</div>}
          <nav className="holo-more" aria-label="More">
            {MORE.map((m) => (
              <Link key={m.to} to={m.to} aria-current={m.id && m.id === here ? "page" : undefined}>
                {m.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main id={MAIN_ID} className="holo-main">
        {children}
      </main>
    </div>
  );
}

type PanelProps<T extends ElementType> = { as?: T; state?: "pass" | "fail" | "live"; className?: string } & Omit<ComponentPropsWithoutRef<T>, "as" | "className">;

/** A see-through panel with corner ticks (::before; ::after is left free). Position only: no box model. */
export function HoloPanel<T extends ElementType = "section">({ as, state, className, ...rest }: PanelProps<T>) {
  const Tag = (as ?? "section") as ElementType;
  return <Tag className={className ? `holo-panel ${className}` : "holo-panel"} data-holo-state={state} {...rest} />;
}

/** A small mono label in capitals, with a dot before it when asked. */
export function HoloTag({ dot, className, ...rest }: { dot?: boolean } & ComponentPropsWithoutRef<"span">) {
  return <span className={className ? `holo-tag ${className}` : "holo-tag"} data-dot={dot ? "true" : undefined} {...rest} />;
}

/** A hairline; with a label, the label sits at its left. Without one it is decoration. */
export function HoloRule({ label, className }: { label?: ReactNode; className?: string }) {
  const cls = className ? `holo-rule ${className}` : "holo-rule";
  if (!label) return <div className={cls} aria-hidden="true" />;
  return (
    <div className={cls}>
      <span className="holo-rule__label">{label}</span>
    </div>
  );
}

/** A glow trace: a hairline with a light running along it (still with reduced motion). Decoration. */
export function HoloTrace({ className }: { className?: string }) {
  return <span className={className ? `holo-trace ${className}` : "holo-trace"} aria-hidden="true" />;
}
