import type { ReactNode } from "react";

type Props = {
  hero: ReactNode; // center hero area
  children: ReactNode; // right panel: a stack of glass cards
};

// The three-zone dashboard layout. The left icon rail lives in App (it is
// shared by every page), so a page provides the center hero and the right panel.
export default function Zones({ hero, children }: Props) {
  return (
    <div className="zones">
      <div className="zone-hero">{hero}</div>
      <aside className="zone-panel">{children}</aside>
    </div>
  );
}
