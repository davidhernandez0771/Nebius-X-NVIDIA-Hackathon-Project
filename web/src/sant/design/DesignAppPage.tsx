// /design/app: the Volt app shell with a sample Review layout, for reviewing the shell itself.
// The episode facts are real (docs/media/README.md, "Before and after perfecting"); the layout is
// a sample, and the status slot says so.
import { useNavigate } from "react-router-dom";
import { Badge, Button, Card, Stat } from "../components";
import { useMotion } from "../motion/MotionProvider";
import { navigateWithTransition } from "../motion/viewTransition";
import { AppShell } from "../shells/AppShell";
import "./design.css";

const DEMOS = [
  { id: "s1_0002", note: "13.8 s, 2 pauses", tone: "issue" as const },
  { id: "s1_0003", note: "10.6 s, idle at both ends", tone: "issue" as const },
  { id: "degraded_0004", note: "11.8 mm off-center grasp", tone: "issue" as const },
];

export function DesignAppPage() {
  const navigate = useNavigate();
  const { reduced } = useMotion();
  return (
    <AppShell
      title="Review: s1_0002"
      active={2}
      home="/design"
      links={[
        { to: "/design", label: "Design system" },
        { to: "/design/app", label: "App shell" },
      ]}
      status={<Badge>Sample layout</Badge>}
      actions={
        <Button variant="secondary" size="sm" onClick={() => navigateWithTransition((to: string) => navigate(to), "/design", { reduced })}>
          Back to the design page
        </Button>
      }
    >
      <div className="sant-app-grid">
        <Card title="Demos">
          <ul className="sant-design-demos">
            {DEMOS.map((d, i) => (
              <li key={d.id} aria-current={i === 0 ? "true" : undefined}>
                <span className="sant-num">{d.id}</span>
                <Badge tone={d.tone}>{d.note}</Badge>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Stage" tone="live">
          <div className="sant-design-stage" role="img" aria-label="Placeholder for the demo video and its timeline">
            <span>The demo video and its timeline go here.</span>
          </div>
        </Card>
        <Card title="Inspector">
          <div className="sant-design-inspector">
            <Stat value={13.8} decimals={1} suffix=" s" label="raw demo" note="tremor, two pauses, slowness, 0.6 s idle at the start" />
            <Stat value={9.3} decimals={1} suffix=" s" label="after repair" note="trimmed, pause-free, smoothed; the replay succeeded" source="docs/media/README.md" />
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
