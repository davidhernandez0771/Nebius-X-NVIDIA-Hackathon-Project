import { BUDGET_USD, formatUsd, useSessionSpend } from "../api/usage";
import Icon from "./Icon";
import StatusPill from "./StatusPill";

// Nebius spend, e.g. "$0.02 / $25". See api/usage.ts for where the number comes from.
export default function SpendPill() {
  const spent = useSessionSpend();
  return (
    <StatusPill
      tone={spent / BUDGET_USD > 0.8 ? "warm" : "neutral"}
      icon={<Icon name="spend" size={14} />}
      title="Estimated Nebius spend this session, against your budget"
    >
      {formatUsd(spent)} / ${BUDGET_USD}
    </StatusPill>
  );
}
