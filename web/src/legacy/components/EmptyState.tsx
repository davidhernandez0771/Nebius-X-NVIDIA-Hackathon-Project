import { Link } from "react-router-dom";
import GlassCard from "./GlassCard";

type Props = { title: string; hint?: string; to?: string; cta?: string };

// Shown when a page needs a selection (room, location, photo) that isn't in the URL.
export default function EmptyState({ title, hint, to, cta }: Props) {
  return (
    <GlassCard variant="provisional" className="empty-state">
      <h2>{title}</h2>
      {hint && <p className="muted">{hint}</p>}
      {to && cta && (
        <Link to={to} className="pill-link">
          {cta}
        </Link>
      )}
    </GlassCard>
  );
}
