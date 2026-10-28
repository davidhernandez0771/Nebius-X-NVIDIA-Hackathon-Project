import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Logo } from "../components/Logo";
import { StoryNav, type NavItem } from "../components/Nav";
import { useMotion } from "../motion/MotionProvider";
import { useLenis } from "../motion/useLenis";

const REPO = "https://github.com/davidhernandez0771/Nebius-X-NVIDIA-Hackathon-Project";

/** Field Notes (paper): landing, Results, About. Smooth scroll lives here and nowhere else. */
export function StoryShell({
  children,
  home = "/",
  links,
  cta,
  className = "",
  mode = "paper",
}: {
  children: ReactNode;
  home?: string;
  links?: NavItem[];
  cta?: NavItem;
  /** A page's own root class, for styles scoped to that page. */
  className?: string;
  /** Field Notes paper by default; Volt for a story page that sits in the work pages' dark look (Results). */
  mode?: "paper" | "volt";
}) {
  const { reduced } = useMotion();
  useLenis(!reduced);
  return (
    <div className={`sant sant-shell sant-shell--story ${className}`.trim()} data-mode={mode}>
      <a className="sant-skip" href="#sant-main">
        Skip to content
      </a>
      <StoryNav home={home} links={links} cta={cta} />
      <main id="sant-main" className="sant-story">
        {children}
      </main>
      {/* Content spec §3, "Footer (story pages)". Partner names in plain text, no logos. */}
      <footer className="sant-footer">
        <div className="sant-footer__grid">
          <div>
            <Logo size="sm" lit="all" />
            <p>Built with NVIDIA Isaac Lab, NVIDIA Nemotron and Nebius Token Factory.</p>
            <p>Our entry for the Nebius x NVIDIA Global AI Hackathon, Physical AI track. Everything runs in simulation.</p>
            <p>By David Hernandez Del Risco and Susana Rojas.</p>
          </div>
          <ul className="sant-footer__links">
            <li>
              <a href={REPO}>GitHub</a>
            </li>
            <li>
              <a href={`${REPO}/blob/main/docs/RUNBOOK.md`}>RUNBOOK</a>
            </li>
            <li>
              <NavLink to="/site/results">Results</NavLink>
            </li>
            <li>
              <NavLink to="/robots">Robots</NavLink>
            </li>
          </ul>
        </div>
        <p className="sant-footer__credits">
          Visual inspiration from Linear, Vercel and other work collected on recent.design. Inspiration only: no code or assets
          were copied.
        </p>
      </footer>
    </div>
  );
}
