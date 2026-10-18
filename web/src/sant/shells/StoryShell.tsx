import type { ReactNode } from "react";
import { StoryNav, type NavItem } from "../components/Nav";
import { useMotion } from "../motion/MotionProvider";
import { useLenis } from "../motion/useLenis";

/** Field Notes (paper): landing, Results, About. Smooth scroll lives here and nowhere else. */
export function StoryShell({ children, home = "/", links, cta }: { children: ReactNode; home?: string; links?: NavItem[]; cta?: NavItem }) {
  const { reduced } = useMotion();
  useLenis(!reduced);
  return (
    <div className="sant sant-shell sant-shell--story" data-mode="paper">
      <a className="sant-skip" href="#sant-main">
        Skip to content
      </a>
      <StoryNav home={home} links={links} cta={cta} />
      <main id="sant-main" className="sant-story">
        {children}
      </main>
      <footer className="sant-footer">
        <p>
          SANT: Simulate, Augment, Neaten, Train. Built with NVIDIA Nemotron on Nebius Token Factory, NVIDIA Isaac Sim and Isaac Lab,
          and LeRobot.
        </p>
      </footer>
    </div>
  );
}
