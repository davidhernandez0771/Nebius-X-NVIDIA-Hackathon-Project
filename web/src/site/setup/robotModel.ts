// What the 3D preview draws, without WebGL: a URDF rebuilt from the parts JSON (the recorded robots come without
// meshes), which link lights up for the part in focus, and the stick figure used when there are no meshes.
import { Box3, Vector3, type Object3D } from "three";
import type { URDFJoint, URDFLink, URDFRobot } from "urdf-loader";
import type { Parts } from "./types";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const vec = (v: number[]) => v.map((n) => String(n)).join(" ");

/** A geometry-free URDF with the same links, joints, origins, axes, limits and mimics as `parts`. */
export function urdfFromParts(parts: Parts): string {
  const links = parts.links.map((l) => `  <link name="${esc(l.name)}"/>`);
  const joints = parts.joints.map((j) => {
    const body = [
      `    <parent link="${esc(j.parent)}"/>`,
      `    <child link="${esc(j.child)}"/>`,
      `    <origin xyz="${vec(j.origin.xyz)}" rpy="${vec(j.origin.rpy)}"/>`,
    ];
    if (j.type !== "fixed") body.push(`    <axis xyz="${vec(j.axis)}"/>`);
    if (j.limits) body.push(`    <limit lower="${j.limits.lower}" upper="${j.limits.upper}" effort="${j.limits.effort}" velocity="${j.limits.velocity}"/>`);
    if (j.mimic) body.push(`    <mimic joint="${esc(j.mimic.joint)}" multiplier="${j.mimic.multiplier}" offset="${j.mimic.offset}"/>`);
    return `  <joint name="${esc(j.name)}" type="${j.type}">\n${body.join("\n")}\n  </joint>`;
  });
  return `<?xml version="1.0"?>\n<robot name="${esc(parts.name)}">\n${[...links, ...joints].join("\n")}\n</robot>\n`;
}

/** The links to light for a part in focus: a link itself, or a joint's child link (what the joint moves). */
export function focusLinks(parts: Parts, name: string | null): string[] {
  if (!name) return [];
  if (parts.links.some((l) => l.name === name)) return [name];
  const j = parts.joints.find((x) => x.name === name);
  return j ? [j.child] : [];
}

export type Bone = { link: string; a: Vector3; b: Vector3 };
export type StickFigure = { bones: Bone[]; dots: { joint: string; p: Vector3 }[]; size: number; center: Vector3 };

const isJoint = (o: Object3D): o is URDFJoint => (o as URDFJoint).isURDFJoint === true;
const isLink = (o: Object3D): o is URDFLink => (o as URDFLink).isURDFLink === true;

/**
 * A capsule per link, from its origin to each of its child joints, and a dot per joint, in the robot's own frame.
 * A leaf link (a finger, a tool frame) gets a short stub that carries on in its parent's direction.
 */
export function stickFigure(robot: URDFRobot): StickFigure {
  robot.updateMatrixWorld(true);
  const local = (o: Object3D) => robot.worldToLocal(o.getWorldPosition(new Vector3()));
  const bones: Bone[] = [];
  const dots: StickFigure["dots"] = [];
  const box = new Box3();

  for (const [name, link] of Object.entries(robot.links)) {
    const a = local(link);
    box.expandByPoint(a);
    const kids = link.children.filter(isJoint);
    for (const j of kids) {
      const b = local(j);
      if (a.distanceTo(b) > 0.001) bones.push({ link: name, a, b });
    }
    if (kids.length === 0 && link !== robot) {
      const parentJoint = link.parent;
      const grand = parentJoint?.parent;
      if (parentJoint && grand && isLink(grand)) {
        const from = local(grand);
        const dir = a.clone().sub(from);
        const len = dir.length();
        if (len > 0.001) bones.push({ link: name, a, b: a.clone().add(dir.multiplyScalar(Math.min(0.06, len * 0.5) / len)) });
        else bones.push({ link: name, a, b: a.clone().add(new Vector3(0, 0, 0.04)) });
      }
    }
  }
  for (const [name, j] of Object.entries(robot.joints)) {
    const p = local(j);
    dots.push({ joint: name, p });
    box.expandByPoint(p);
  }
  for (const b of bones) box.expandByPoint(b.b);
  const size = box.getSize(new Vector3());
  return { bones, dots, size: Math.max(size.x, size.y, size.z), center: box.getCenter(new Vector3()) };
}
