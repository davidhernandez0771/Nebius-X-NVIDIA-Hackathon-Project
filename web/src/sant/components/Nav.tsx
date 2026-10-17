import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import { usePowerOn } from "../shells/PowerOn";
import { Button } from "./Button";
import { EffectsToggle } from "./EffectsToggle";
import { Logo } from "./Logo";
import { StepRail } from "./StepRail";

export type NavItem = { to: string; label: string };

/** Paper nav: the wordmark, the story links, and the way into the app (the power-on). */
export function StoryNav({ home = "/", links = [], cta }: { home?: string; links?: NavItem[]; cta?: NavItem }) {
  const powerOn = usePowerOn();
  return (
    <nav className="sant-nav sant-nav--story" aria-label="Story">
      <NavLink to={home} className="sant-nav__home" aria-label="SANT home">
        <Logo size="sm" lit="all" />
      </NavLink>
      <ul className="sant-nav__links">
        {links.map((l) => (
          <li key={l.to}>
            <NavLink to={l.to} end className="sant-nav__link">
              {l.label}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="sant-nav__end">
        <EffectsToggle />
        {cta && <Button onClick={(e) => powerOn.start(cta.to, e.currentTarget)}>{cta.label}</Button>}
      </div>
    </nav>
  );
}

/** Volt nav: the wordmark, the S·A·N·T rail for where the demo is, and a status slot. */
export function AppNav({ home = "/", active, links = [], status }: { home?: string; active: number | null; links?: NavItem[]; status?: ReactNode }) {
  return (
    <nav className="sant-nav sant-nav--app" aria-label="App">
      <NavLink to={home} className="sant-nav__home" aria-label="SANT home">
        <Logo size="sm" lit="all" />
      </NavLink>
      <StepRail active={active} compact />
      {links.length > 0 && (
        <ul className="sant-nav__links">
          {links.map((l) => (
            <li key={l.to}>
              <NavLink to={l.to} end className="sant-nav__link">
                {l.label}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
      <div className="sant-nav__end">
        {status}
        <EffectsToggle />
      </div>
    </nav>
  );
}
