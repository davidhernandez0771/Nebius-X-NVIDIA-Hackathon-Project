import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import type { NavItem } from "./Nav";

/**
 * Glass pill nav for the app pages. The pages are steps in order (Record, Review, Dataset), so the
 * thin joins between them light up to the current page, and a soft mark glides behind the
 * current link when another is chosen. Falls back to a solid pill without backdrop-filter.
 */
export function PillNav({ items, label = "Pages", end }: { items: NavItem[]; label?: string; end?: ReactNode }) {
  const { pathname } = useLocation();
  const current = items.findIndex((i) => i.to === pathname);
  const list = useRef<HTMLUListElement>(null);
  const [mark, setMark] = useState<{ x: number; w: number } | null>(null);

  useLayoutEffect(() => {
    // Measured against the list, not offsetLeft: each item is positioned, so offsetLeft would be
    // relative to the item. Measured again once web fonts load and on resize, as widths change.
    const measure = () => {
      const ul = list.current;
      const link = ul?.querySelectorAll<HTMLElement>(".sant-pill__link")[current];
      if (!ul || !link) return setMark(null);
      const a = ul.getBoundingClientRect();
      const b = link.getBoundingClientRect();
      setMark({ x: b.left - a.left, w: b.width });
    };
    measure();
    let live = true;
    document.fonts?.ready.then(() => live && measure());
    window.addEventListener("resize", measure);
    return () => {
      live = false;
      window.removeEventListener("resize", measure);
    };
  }, [current, items]);

  return (
    <nav className="sant-pill" aria-label={label}>
      <ul ref={list} className="sant-pill__list">
        {mark && mark.w > 0 && (
          <li className="sant-pill__mark" aria-hidden="true" style={{ "--x": `${mark.x}px`, "--w": `${mark.w}px` } as CSSProperties} />
        )}
        {items.map((item, i) => (
          <li key={item.to} className="sant-pill__item">
            {i > 0 && <span className="sant-pill__join" data-done={i <= current} aria-hidden="true" />}
            <NavLink to={item.to} end className="sant-pill__link">
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
      {end && <div className="sant-pill__end">{end}</div>}
    </nav>
  );
}
