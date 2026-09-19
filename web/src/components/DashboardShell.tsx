import { useEffect, useState } from "react";
import { Outlet, useLocation, useSearchParams } from "react-router-dom";
import { type IconName } from "./Icon";
import Icon from "./Icon";
import IconTile from "./IconTile";
import SpendPill from "./SpendPill";

// Room-scoped pages read ?room_id=; keep it when moving between them.
const links: { to: string; label: string; icon: IconName; scoped?: boolean }[] = [
  { to: "/", label: "Home", icon: "home" },
  { to: "/room", label: "Room view", icon: "room", scoped: true },
  { to: "/add/scan", label: "Add scan", icon: "scan", scoped: true },
  { to: "/add/photo", label: "Add photo", icon: "camera" },
  { to: "/review", label: "Review", icon: "review" },
  { to: "/inventory", label: "Inventory", icon: "shelf", scoped: true },
  { to: "/organize", label: "Organize", icon: "organize", scoped: true },
  { to: "/chat", label: "Chat", icon: "chat", scoped: true },
  { to: "/settings", label: "Settings", icon: "settings" },
];

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
        {links.map((l) => (
          <IconTile
            key={l.to}
            to={l.scoped && roomId ? `${l.to}?room_id=${roomId}` : l.to}
            label={l.label}
            icon={<Icon name={l.icon} />}
            active={l.to === "/" ? pathname === "/" : pathname.startsWith(l.to)}
          />
        ))}
      </nav>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
