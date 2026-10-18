// The part roles the user wires up: which link is the base and the hand, which joints are the arm and the gripper.
// Mirrors the backend's rules (byor-api.md §3-4) closely enough to give instant feedback; PUT /roles has the last word.
import type { Issue, Parts, PartJoint, RoleSet, RolesBody } from "./types";

export type Role = "base" | "arm" | "hand" | "gripper";
export const ROLES: Role[] = ["base", "arm", "hand", "gripper"];
export const ROLE_LABEL: Record<Role, string> = { base: "Base", arm: "Arm", hand: "Hand", gripper: "Gripper" };

export type TreeRow = {
  kind: "link" | "joint";
  name: string;
  depth: number;
  /** The first row of a branch (a joint whose parent link has more than one child joint). */
  branchStart: boolean;
  /** That branch is its parent's last one, so the connector stops here. */
  branchLast: boolean;
  /** One per ancestor lane (length = depth): does that lane's line continue past this row? */
  guides: boolean[];
  /** The row's own spine stops here (the next row is not on it). */
  end: boolean;
  joint?: PartJoint;
};

/** Depth grows only where a link has several child joints, so a 7-joint arm reads as one spine. */
export function treeRows(parts: Parts): TreeRow[] {
  const links = new Map(parts.links.map((l) => [l.name, l]));
  const joints = new Map(parts.joints.map((j) => [j.name, j]));
  const rows: TreeRow[] = [];
  const walk = (link: string, depth: number, branchLast: boolean, guides: boolean[]) => {
    rows.push({ kind: "link", name: link, depth, branchStart: false, branchLast, guides, end: false });
    const kids = links.get(link)?.child_joints ?? [];
    const branches = kids.length > 1;
    kids.forEach((jn, i) => {
      const j = joints.get(jn);
      if (!j) return;
      const d = branches ? depth + 1 : depth;
      const last = branches ? i === kids.length - 1 : branchLast;
      const g = branches ? [...guides, !last] : guides;
      rows.push({ kind: "joint", name: jn, depth: d, branchStart: branches, branchLast: last, guides: g, end: false, joint: j });
      walk(j.child, d, last, g);
    });
  };
  walk(parts.root, 0, true, []);
  rows.forEach((r, i) => {
    const next = rows[i + 1];
    r.end = !next || next.depth < r.depth || (next.depth === r.depth && next.branchStart);
  });
  return rows;
}

const MOVABLE = new Set(["revolute", "continuous", "prismatic"]);

export function accepts(parts: Parts, role: Role, name: string): boolean {
  if (role === "base" || role === "hand") return parts.links.some((l) => l.name === name);
  const j = parts.joints.find((x) => x.name === name);
  if (!j) return false;
  if (role === "arm") return j.type === "revolute" || j.type === "continuous";
  return MOVABLE.has(j.type);
}

/** Joint depth from the root, so the arm is always listed from the base outwards. */
function jointDepths(parts: Parts): Map<string, number> {
  const out = new Map<string, number>();
  treeRows(parts).forEach((r, i) => r.kind === "joint" && out.set(r.name, i));
  return out;
}

const without = (xs: string[], name: string) => xs.filter((x) => x !== name);

export function assign(parts: Parts, roles: RoleSet, role: Role, name: string): RoleSet {
  if (!accepts(parts, role, name)) return roles;
  if (role === "base") return { ...roles, base: name };
  if (role === "hand") return { ...roles, hand: name };
  const order = jointDepths(parts);
  const sorted = (xs: string[]) => [...new Set(xs)].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  if (role === "arm") return { ...roles, arm_joints: sorted([...roles.arm_joints, name]), gripper_joints: without(roles.gripper_joints, name) };
  return { ...roles, gripper_joints: sorted([...roles.gripper_joints, name]), arm_joints: without(roles.arm_joints, name) };
}

export function unassign(roles: RoleSet, role: Role, name: string): RoleSet {
  if (role === "base") return roles.base === name ? { ...roles, base: null } : roles;
  if (role === "hand") return roles.hand === name ? { ...roles, hand: null } : roles;
  if (role === "arm") return { ...roles, arm_joints: without(roles.arm_joints, name) };
  return { ...roles, gripper_joints: without(roles.gripper_joints, name) };
}

export function rolesOf(roles: RoleSet, name: string): Role[] {
  const out: Role[] = [];
  if (roles.base === name) out.push("base");
  if (roles.arm_joints.includes(name)) out.push("arm");
  if (roles.hand === name) out.push("hand");
  if (roles.gripper_joints.includes(name)) out.push("gripper");
  return out;
}

export function fromSuggested(parts: Parts): RoleSet {
  const s = parts.suggested_roles;
  return { base: s.base, arm_joints: s.arm_joints ?? [], hand: s.hand, gripper_joints: s.gripper_joints ?? [] };
}

export function suggestedFor(parts: Parts, name: string): Role[] {
  return rolesOf(fromSuggested(parts), name);
}

/** The roles the user changed from the suggestion (for "suggested" vs "yours" on the chips). */
export function isSuggested(parts: Parts, role: Role, name: string): boolean {
  return suggestedFor(parts, name).includes(role);
}

const err = (code: string, message: string, where: string): Issue => ({ code, severity: "error", message, where });

/** The moving joints on the path from `base` down to `hand`, base first; null if the hand isn't below the base. */
export function chainJoints(parts: Parts, base: string, hand: string): string[] | null {
  const byChild = new Map(parts.joints.map((j) => [j.child, j]));
  const path: string[] = [];
  for (let link = hand; link !== base; ) {
    const j = byChild.get(link);
    if (!j) return null;
    if (j.type !== "fixed") path.unshift(j.name);
    link = j.parent;
  }
  return path;
}

/** Instant checks with the backend's codes; the 422 from PUT /roles stays authoritative. */
export function localIssues(roles: RoleSet, parts?: Parts): Issue[] {
  const out: Issue[] = [];
  if (!roles.base) out.push(err("no_base", "pick the base link", "base"));
  if (roles.arm_joints.length < 5)
    out.push(err("arm_too_short", `the arm has ${roles.arm_joints.length} joints; the task needs at least 5`, "arm_joints"));
  if (!roles.hand) out.push(err("no_hand", "pick the hand link", "hand"));
  if (roles.gripper_joints.length === 0) out.push(err("no_gripper", "pick at least one gripper joint", "gripper_joints"));
  if (parts && roles.base && roles.hand && roles.arm_joints.length >= 5) {
    const chain = chainJoints(parts, roles.base, roles.hand);
    if (!chain || chain.join() !== roles.arm_joints.join())
      out.push(
        err(
          "arm_not_chain",
          chain
            ? `the arm joints must be the moving joints from the base (${roles.base}) to the hand (${roles.hand}): ${chain.join(", ")}`
            : `the hand (${roles.hand}) isn't below the base (${roles.base})`,
          "arm_joints",
        ),
      );
  }
  return out;
}

export function toBody(roles: RoleSet, mount?: [number, number, number]): RolesBody {
  return mount ? { ...roles, mount: { pos: mount } } : { ...roles };
}

export function sameRoles(a: RoleSet, b: RoleSet): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
