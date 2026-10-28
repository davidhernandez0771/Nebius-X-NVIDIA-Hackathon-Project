import { BUDGET_USD, formatUsd, useSessionSpend } from "../api/usage";
import { DotMeter, GlassCard, Icon, StatusPill, Zones } from "../components";

export default function Settings() {
  const spent = useSessionSpend();

  return (
    <Zones
      hero={
        <>
          <div className="hero-copy">
            <h1>Settings</h1>
            <p className="muted">Usage, preferences and your data.</p>
          </div>
          <GlassCard as="section" className="stack">
            <div className="row spread">
              <div>
                <h2>
                  {formatUsd(spent)} <span className="muted">of ${BUDGET_USD}</span>
                </h2>
                <p className="muted small">Estimated Nebius spend this session</p>
              </div>
              <Icon name="spend" size={28} />
            </div>
            <DotMeter value={spent / BUDGET_USD} label="Nebius spend against budget" tone="warm" dots={24} />
            {/* TODO(backend): show all-time spend once GET /api/usage exposes usage_log totals (see api/usage.ts). */}
            <p className="muted small">All-time spend isn't available from the backend yet.</p>
          </GlassCard>
        </>
      }
    >
      {["Preferences", "Export my data", "Delete my data"].map((label) => (
        <GlassCard key={label} variant="provisional" className="row spread">
          <h3>{label}</h3>
          <StatusPill>Not built yet</StatusPill>
        </GlassCard>
      ))}
    </Zones>
  );
}
