import type { Issue, RoleSet } from "./types";
import type { Robot } from "./SetupPage";

/** Placeholder until the run and the report card land. */
export function RunPanel(_: { robot: Robot; roles: RoleSet; mount: [number, number, number]; issues: Issue[]; onIssues: (i: Issue[]) => void }) {
  return null;
}
