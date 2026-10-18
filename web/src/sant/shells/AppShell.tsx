import type { ReactNode } from "react";
import { AppNav, type NavItem } from "../components/Nav";

/**
 * Volt: Record, Review, Dataset. Native scroll (no Lenis) and no WebGL here, because Record runs
 * MediaPipe next to Isaac Sim on the same GPU.
 */
export function AppShell({
  title,
  active,
  children,
  home = "/",
  links,
  status,
  actions,
}: {
  title: string;
  active: number | null;
  children: ReactNode;
  home?: string;
  links?: NavItem[];
  status?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="sant sant-shell sant-shell--app" data-mode="volt">
      <a className="sant-skip" href="#sant-main">
        Skip to content
      </a>
      <AppNav home={home} active={active} links={links} status={status} />
      <main id="sant-main" className="sant-app">
        <header className="sant-app__head">
          <h1 className="sant-app__title">{title}</h1>
          {actions && <div className="sant-app__actions">{actions}</div>}
        </header>
        {children}
      </main>
    </div>
  );
}
