import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { type IconName } from "./Icon";
import Icon from "./Icon";
import IconTile from "./IconTile";

// The Perfect-then-multiply pages, in workflow order.
const links: { to: string; label: string; icon: IconName }[] = [
  { to: "/pm/record", label: "Record", icon: "camera" },
  { to: "/pm/review", label: "Review demos", icon: "scan" },
  { to: "/pm/dataset", label: "Dataset", icon: "box" },
  { to: "/pm/results", label: "Results", icon: "chart" },
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
  const now = useClock();

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="topbar-brand">
          <span className="wordmark">SANT</span>
          <span className="muted small topbar-subtitle">Simulate · Augment · Neaten · Train</span>
          <span className="muted small topbar-date">
            {now.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
          </span>
        </div>
        <time className="topbar-time" dateTime={now.toISOString()}>
          {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
        </time>
      </header>
      <nav className="app-nav" aria-label="Main">
        {links.map((l) => (
          <IconTile
            key={l.to}
            to={l.to}
            label={l.label}
            icon={<Icon name={l.icon} />}
            active={pathname.startsWith(l.to)}
          />
        ))}
      </nav>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
