import type { RoleSet } from "./types";
import type { Robot } from "./SetupPage";

/** Placeholder until the 3D view lands (next commit). */
export default function RobotPreview(_: { robot: Robot; roles: RoleSet; focus: string | null }) {
  return <div className="byor-view__wait">3D view coming next.</div>;
}
