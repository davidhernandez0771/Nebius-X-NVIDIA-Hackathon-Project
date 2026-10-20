// The robots lying in the forest's moss, as one merged geometry: the stand-in Franka (its URDF's collision meshes,
// loaded by the twin's loader) posed whole in each spot of forestRobots.ts: joints set, the body turned from the
// URDF's z-up onto the moss by the pose's `lay`, scaled, turned to the spot's yaw and sunk by its fraction. A
// gripper pose keeps only the hand and its fingers. Each vertex carries its link's own z in uv.x, for the panel
// seams the forest's shader draws. When a robot's real GLB arrives it takes the same spot.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { URDFRobot } from "urdf-loader";
import { FRANKA } from "../../../twin/model";
import { POSES, type RobotSpot } from "./forestRobots";

const HAND_LINKS = ["panda_hand", "panda_leftfinger", "panda_rightfinger"];

type Linkish = THREE.Object3D & { isURDFLink?: boolean; isURDFJoint?: boolean };

/** The meshes of one URDF link (not its child links'), in the link's own frame. */
function linkMeshes(link: THREE.Object3D): THREE.BufferGeometry[] {
  const inv = new THREE.Matrix4().copy(link.matrixWorld).invert();
  const out: THREE.BufferGeometry[] = [];
  const walk = (o: THREE.Object3D) => {
    for (const c of o.children) {
      const u = c as Linkish;
      if (u.isURDFLink || u.isURDFJoint) continue;
      const m = c as THREE.Mesh;
      if (m.isMesh) out.push((m.geometry as THREE.BufferGeometry).clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, c.matrixWorld)));
      walk(c);
    }
  };
  walk(link);
  return out;
}

const Z_UP_TO_Y_UP = new THREE.Matrix4().makeRotationX(-Math.PI / 2);

/** One spot's body, in place: posed, laid down, scaled, turned and sunk into the floor at y = `floor`. */
function wreck(robot: URDFRobot, s: RobotSpot, floor: number): THREE.BufferGeometry {
  const pose = POSES[s.pose];
  for (const [name, v] of Object.entries({ ...FRANKA.rest, ...pose.joints })) robot.joints[name]?.setJointValue(v);
  robot.updateMatrixWorld(true);
  const names = pose.only === "hand" ? HAND_LINKS : Object.keys(robot.links);
  const frame = pose.only === "hand" ? robot.links.panda_hand : robot;
  const frameInv = new THREE.Matrix4().copy(frame.matrixWorld).invert();
  const place = new THREE.Matrix4()
    .makeRotationY(s.yaw)
    .multiply(new THREE.Matrix4().makeScale(s.scale, s.scale, s.scale))
    .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...pose.lay)))
    .multiply(Z_UP_TO_Y_UP);
  const parts: THREE.BufferGeometry[] = [];
  for (const name of names) {
    const link = robot.links[name];
    if (!link) continue;
    const toFrame = new THREE.Matrix4().multiplyMatrices(frameInv, link.matrixWorld);
    for (const g of linkMeshes(link)) {
      const out = g.index ? g.toNonIndexed() : g;
      if (out !== g) g.dispose();
      // The seams follow the link's own z, before the link is moved anywhere.
      const p = out.attributes.position;
      const uv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) uv[i * 2] = p.getZ(i);
      out.applyMatrix4(toFrame).applyMatrix4(place);
      out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      for (const k of Object.keys(out.attributes)) if (k !== "position" && k !== "normal" && k !== "uv") out.deleteAttribute(k);
      if (!out.attributes.normal) out.computeVertexNormals();
      parts.push(out);
    }
  }
  const body = mergeGeometries(parts, false) ?? new THREE.BufferGeometry();
  parts.forEach((g) => g.dispose());
  body.computeBoundingBox();
  const b = body.boundingBox!;
  const h = b.max.y - b.min.y;
  body.translate(s.x - (b.min.x + b.max.x) / 2, floor - b.min.y - s.sink * h, s.z - (b.min.z + b.max.z) / 2);
  return body;
}

/** Every spot's robot, merged into one geometry (one draw). */
export function wreckGeometry(robot: URDFRobot, spots: readonly RobotSpot[], floor: number): THREE.BufferGeometry {
  const parts = spots.map((s) => wreck(robot, s, floor));
  const g = mergeGeometries(parts, false) ?? new THREE.BufferGeometry();
  parts.forEach((p) => p.dispose());
  return g;
}
