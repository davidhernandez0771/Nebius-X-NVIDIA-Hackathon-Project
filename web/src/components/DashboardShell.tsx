import { useEffect, useState } from "react";
import { Outlet, useLocation, useSearchParams } from "react-router-dom";
import { type IconName } from "./Icon";
import Icon from "./Icon";
import IconTile from "./IconTile";
import SpendPill from "./SpendPill";

// Room-scoped pages read ?room_id=; keep it when moving between them.
// "Add scan" and "Add photo" are deliberately NOT here: both need an id
// (room_id / location_id) this rail can never carry from cold navigation, and
// both are already surfaced in context inside Room view, right where that id
// exists (the "Upload/Replace room scan" links, and each location's own "Add
// photo" link) -- a top-level rail entry would just be a second, worse-placed
// way to reach the same action.
const links: { to: string; label: string; icon: IconName; scoped?: boolean }[] = [
  { to: "/home", label: "Home", icon: "home" },
  { to: "/room", label: "Room view", icon: "room", scoped: true },
  { to: "/review", label: "Review", icon: "review" },
  { to: "/inventory", label: "Inventory", icon: "shelf", scoped: true },
  { to: "/organize", label: "Organize", icon: "organize", scoped: true },
  { to: "/chat", label: "Chat", icon: "chat", scoped: true },
  { to: "/settings", label: "Settings", icon: "settings" },
];

// Destinations that need a room selected first (via `scoped`'s room_id) --
// dimmed and non-navigating in the rail until then, rather than dead-ending
// on an EmptyState after the click. Review needs a specific photo_id instead,
// which nothing tracks globally, so it's disabled from cold nav regardless of
// room state -- reachable for real only via the link generated right after
// analyzing a photo (same pattern as the removed Add photo/Add scan tiles).
const NEEDS_ROOM = new Set(["/room", "/inventory", "/organize", "/chat"]);

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// Top bar + left icon rail around every dashboard page.
export default function DashboardShell() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const roomId = params.get("room_id");
  const now = useClock();

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="topbar-brand">
          <span className="wordmark">SANT</span>
          <span className="muted small topbar-date">
            {now.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
          </span>
        </div>
        <SpendPill />
        <time className="topbar-time" dateTime={now.toISOString()}>
          {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
        </time>
      </header>
      <nav className="app-nav" aria-label="Main">
        {links.map((l) => {
          const disabled = l.to === "/review" ? true : NEEDS_ROOM.has(l.to) && !roomId;
          const disabledReason = l.to === "/review" ? "Analyze a photo first" : "Select a room first";
          return (
            <IconTile
              key={l.to}
              to={l.scoped && roomId ? `${l.to}?room_id=${roomId}` : l.to}
              label={l.label}
              icon={<Icon name={l.icon} />}
              active={pathname.startsWith(l.to)}
              disabled={disabled}
              disabledReason={disabledReason}
            />
          );
        })}
      </nav>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
