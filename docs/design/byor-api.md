# "Bring your robot" (BYOR): backend API contract

- **Owner:** T2 (backend, `pm/byor-backend`). T1 builds the UI from this file.
- **Written:** 2026-10-18, from `origin/perfect-then-multiply` at `e94d817`.
- **Status:** this is the contract. Numbers in the examples are illustrative; the status note (`docs/superpowers/notes/2026-10-18-byor-backend.md`) says which
  parts are built and measured.

**The idea.** The user uploads a URDF, says which parts are the base, the arm joints, the hand and the gripper
fingers, and SANT runs the same pick-and-place task it runs for the Franka. The output is a **robot report card**:
where the robot can reach, how many of 30 fixed scenes it completes, why the others fail, and which joints hit
their limits. Every number in the card has a `source` that says what produced it.

**Flow (what the UI does):**

1. `POST /robots` with the file → `id`.
2. `GET /robots/{id}/parts` → the link/joint tree, the suggested roles and any problems.
3. The user checks or edits the roles → `PUT /robots/{id}/roles`. A 422 lists what is wrong; fix and resend.
4. `POST /robots/{id}/evaluate` → a job.
5. Poll `GET /robots/{id}/report` until `status` is `done` or `failed` (or poll `GET /jobs/{job_id}`).

**Conventions** (the same as `/demos`):

- Base URL: the FastAPI backend, `http://localhost:8000` (`VITE_API_BASE_URL`). No `/api` prefix.
- JSON bodies, except the upload: `multipart/form-data` with one field named `file`. `web/src/api/client.ts`
  `uploadFile()` already sends exactly that.
- Units: metres, radians, seconds, newtons. World frame: the robot's base at the origin, +x towards the table,
  +z up, table top at z = 0. Quaternions are `[w, x, y, z]`.
- **Errors.** Every 4xx from `/robots` has this body. `errors` always has at least one entry.

  ```json
  {"detail": {"errors": [{"code": "arm_too_short", "severity": "error",
                          "message": "the arm has 4 DOF (shoulder_pan, shoulder_lift, elbow, wrist_flex); the task needs at least 5",
                          "where": "arm_joints"}]}}
  ```

  `where` names the role or file the problem is in, or is `null`. The codes are in [§8](#8-issue-codes).
- **Issues that are not errors.** `parts`, `roles` and the upload also return `issues`: the same objects with
  `severity` `"warning"` (the robot can still be evaluated) or `"error"` (it cannot until this is fixed).

## 1. `POST /robots`: upload a robot

**Body:** `multipart/form-data`, field `file`, one of:

- a `.urdf` file. Fine for robots whose geometry is only boxes, cylinders and spheres. A URDF that names mesh
  files without them gets `missing_mesh` errors;
- a `.zip` with one `.urdf` and the meshes it references (STL, OBJ or DAE). `package://<pkg>/<path>` is resolved
  inside the zip: to the folder named `<pkg>`, or the folder whose `package.xml` says `<name><pkg></name>`.
  Relative paths are resolved from the URDF's folder.

**Not accepted:** `.xacro` (run `xacro robot.urdf.xacro > robot.urdf` first and upload the result), MJCF, USD,
more than one `.urdf` in a zip, archives over 100 MB or 5000 files, and zip entries with absolute paths, `..`
or links.

**The id** is `byor_` + the first 10 hex characters of the upload's SHA-256. Uploading the same bytes again
returns the same robot (`200`, `"created": false`) and keeps its roles and report.

**201** (or **200** for a re-upload):

```json
{
  "id": "byor_3f9a1c2b7d",
  "name": "panda",
  "created": true,
  "urdf": "franka_description/robots/panda_arm_hand.urdf",
  "sha256": "3f9a1c2b7d5e...",
  "n_links": 12,
  "n_joints": 11,
  "issues": [],
  "parts": "/robots/byor_3f9a1c2b7d/parts"
}
```

**Errors:** `400` `not_urdf` / `xacro` / `no_urdf` / `multiple_urdfs` / `unsafe_zip`; `413` `too_large`;
`422` `urdf_parse` (the XML or the URDF structure is broken: the message names the element).

## 2. `GET /robots` and `GET /robots/{id}`: list and summary

`GET /robots` → newest first, each one the summary below. `GET /robots/{id}` → one; `404` if unknown.

```json
{
  "id": "byor_3f9a1c2b7d",
  "name": "panda",
  "uploaded_at": "2026-10-18T15:02:11Z",
  "roles_set": true,
  "report_status": "done",
  "headline": {"pick_place": "27/30", "reach": 0.97}
}
```

`report_status` is one of `none`, `queued`, `running`, `done`, `failed`. `headline` is `null` until a report is
done.

## 3. `GET /robots/{id}/parts`: the tree, suggested roles and issues

```json
{
  "id": "byor_3f9a1c2b7d",
  "name": "panda",
  "root": "panda_link0",
  "links": [
    {"name": "panda_link0", "parent_joint": null, "child_joints": ["panda_joint1"], "has_geometry": true,
     "has_inertial": true},
    {"name": "panda_hand", "parent_joint": "panda_hand_joint",
     "child_joints": ["panda_finger_joint1", "panda_finger_joint2"], "has_geometry": true, "has_inertial": true}
  ],
  "joints": [
    {"name": "panda_joint1", "type": "revolute", "parent": "panda_link0", "child": "panda_link1",
     "axis": [0, 0, 1], "origin": {"xyz": [0, 0, 0.333], "rpy": [0, 0, 0]},
     "limits": {"lower": -2.8973, "upper": 2.8973, "effort": 87.0, "velocity": 2.175}, "mimic": null},
    {"name": "panda_finger_joint2", "type": "prismatic", "parent": "panda_hand", "child": "panda_rightfinger",
     "axis": [0, -1, 0], "origin": {"xyz": [0, 0, 0.0584], "rpy": [0, 0, 0]},
     "limits": {"lower": 0.0, "upper": 0.04, "effort": 20.0, "velocity": 0.2},
     "mimic": {"joint": "panda_finger_joint1", "multiplier": 1.0, "offset": 0.0}}
  ],
  "suggested_roles": {
    "base": "panda_link0",
    "arm_joints": ["panda_joint1", "panda_joint2", "panda_joint3", "panda_joint4", "panda_joint5",
                   "panda_joint6", "panda_joint7"],
    "hand": "panda_hand",
    "gripper_joints": ["panda_finger_joint1", "panda_finger_joint2"]
  },
  "why": {
    "base": "the root link (no parent joint)",
    "arm_joints": "the longest chain of revolute joints from the root (7)",
    "hand": "the last arm link, followed through fixed joints to where the gripper joints start",
    "gripper_joints": "the prismatic joints after the hand (2; panda_finger_joint2 mimics panda_finger_joint1)"
  },
  "derived": {
    "dof": 7,
    "reach_m": {"value": 1.19, "source": "sum of joint-origin distances from the first arm joint to the hand"},
    "tcp": {"link": "panda_hand", "offset": [0.0, 0.0, 0.1033], "approach_axis": [0, 0, 1],
            "source": "finger geometry: the fingertips are 0.1123 m along the hand's +z; the grasp point sits 0.009 m above them (Franka's documented TCP is 0.0089 m above its fingertips)"},
    "gripper": {"open": 0.04, "closed": 0.0,
                "source": "the panda_finger_joint1 limit with the fingers farthest from the approach axis is open"}
  },
  "issues": []
}
```

- `links` and `joints` are in URDF order. Every link and joint in the file is listed (only two are shown above).
- `suggested_roles` has the same shape as the `PUT /roles` body (§4) and is `null` for a role the rules cannot
  fill (each one then has an `error` issue). `why` has one sentence per suggested role.
- `derived` is what the backend computes from the suggested roles: degrees of freedom, a reach estimate, the tool
  point (TCP) and the gripper's open and closed values. Each has a `source`.

**How roles are suggested** (`sim_worker/urdf_import.py`):

| Role | Rule |
|---|---|
| `base` | The root link (the only link that is no joint's child). A root with no geometry and one fixed child (`world` → `base_link`) gives the child. |
| `arm_joints` | The longest chain of revolute or continuous joints from the root, skipping fixed joints. Trailing joints whose names say `finger`, `gripper`, `jaw`, `claw` or `knuckle` go to the gripper instead. |
| `hand` | The child of the last arm joint, followed down fixed joints for as long as there is exactly one way down (it stops where the gripper joints branch off). |
| `gripper_joints` | The movable joints below the hand: prismatic joints, mimic joints and joints with those names. |
| TCP | In order: a link below the hand, reached by fixed joints, named like `tcp`, `tool`, `grasp`, `ee`, `end_effector` or `gripper_frame`. Otherwise the fingertips (the farthest point of the finger links' collision geometry along the approach axis) minus 0.009 m. Otherwise the finger joints' origins, with a `tcp_estimated` warning. The approach axis is the direction from the hand to the fingers, snapped to the nearest hand axis. |
| gripper open/closed | For each driving (non-mimic) gripper joint: the limit at which its finger is farther from the approach axis is `open`, the other limit is `closed`. |

## 4. `PUT /robots/{id}/roles`: set the roles

**Body** (required: `base`, `arm_joints`, `hand`, `gripper_joints`; the rest are optional overrides):

```json
{
  "base": "panda_link0",
  "arm_joints": ["panda_joint1", "panda_joint2", "panda_joint3", "panda_joint4", "panda_joint5",
                 "panda_joint6", "panda_joint7"],
  "hand": "panda_hand",
  "gripper_joints": ["panda_finger_joint1", "panda_finger_joint2"],
  "tcp_offset": null,
  "gripper_open": null,
  "gripper_closed": null,
  "mount": {"pos": [0.0, 0.0, 0.0]},
  "start_joint_pos": null
}
```

- `arm_joints` are listed from the base outwards and must be one connected chain from `base` to `hand`
  (fixed joints in between are fine and are not listed).
- `tcp_offset`: `[x, y, z]` from the hand link's origin to the grasp point, in the hand frame. `null` uses the
  derived TCP (§3).
- `gripper_open` / `gripper_closed`: joint values for the driving gripper joints: one number for all of them, or
  `{joint: value}`. `null` uses the derived ones.
- `mount.pos`: where the robot's base sits in the world. The default `[0, 0, 0]` is where the Franka sits: the
  table starts 0.15 m in front of it, and the task's cubes are 0.40–0.60 m away. A small arm may need to sit
  closer (`[0.25, 0, 0]`); the report card states the mount.
- `start_joint_pos`: `{joint: value}` for the start pose. `null` computes one: the inverse-kinematics solution
  for the tool 0.35 m above the middle of the workspace, pointing down, started from the middle of each joint's
  range.

**200:** the roles are saved, together with the robot spec the sim will use.

```json
{
  "roles": {"base": "panda_link0", "arm_joints": ["panda_joint1", "..."], "hand": "panda_hand",
            "gripper_joints": ["panda_finger_joint1", "panda_finger_joint2"],
            "tcp_offset": null, "gripper_open": null, "gripper_closed": null,
            "mount": {"pos": [0.0, 0.0, 0.0]}, "start_joint_pos": null},
  "spec": {
    "name": "byor_3f9a1c2b7d",
    "ik_link": "panda_link7",
    "arm_joints": ["panda_joint1", "..."],
    "finger_joints": ["panda_finger_joint1"],
    "passive_finger_joints": ["panda_finger_joint2"],
    "gripper_open": 0.04,
    "gripper_closed": 0.0,
    "tcp_offset": [0.0, 0.0, 0.2103],
    "hand_in_tool_wxyz": [0.9239, 0.0, 0.0, 0.3827],
    "base_pos": [0.0, 0.0, 0.0],
    "start_joint_pos": {"panda_joint1": 0.0, "panda_joint2": -0.21, "...": 0.0},
    "sources": {
      "ik_link": "panda_hand is joined to panda_link7 by fixed joints, which the URDF importer merges; IK drives panda_link7",
      "tcp_offset": "finger geometry (see parts.derived.tcp), moved into panda_link7's frame",
      "start_joint_pos": "IK for the tool at (0.45, 0, 0.35) pointing down: residual 0.1 mm, 0.00 rad"
    }
  },
  "issues": [],
  "ready": true
}
```

- `spec` is read-only; it is shown so the user can see what the sim will do. `ik_link` differs from `hand` when
  the hand hangs off the last arm link by fixed joints: the importer merges those links, so the tool offset
  and orientation are moved into the merged link's frame.
- `finger_joints` are driven. `passive_finger_joints` (mimic joints) follow their leader through the importer's
  mimic constraint and get no drive.
- `ready` is `true` when nothing in `issues` is an error.

**422:** the roles are not saved. Examples:
- `no_gripper`: no gripper joints, or none of them is below the hand;
- `arm_too_short`: fewer than 5 arm joints;
- `arm_not_chain`: the arm joints don't form one chain from `base` to `hand`;
- `unknown_joint` / `unknown_link`: the name is not in the URDF;
- `role_overlap`: a joint is both an arm joint and a gripper joint;
- `joint_no_limits`: a revolute arm or gripper joint has no `<limit>`.

`404` if the robot does not exist.

## 5. `POST /robots/{id}/evaluate`: run the report card

**Body** (optional; these are the defaults):

```json
{"seed0": 100, "n": 30}
```

The defaults are the fixed scenes every robot is graded on: seeds 100–129, the same seeds and scenes as the
Franka and OpenArm multiply runs. `n` may be 1–30, for a quick check; the headline is only comparable at 30.

**202:**

```json
{"job_id": "c0ffee12", "status": "queued", "poll": "/jobs/c0ffee12", "report": "/robots/byor_3f9a1c2b7d/report"}
```

**409:**
- `roles_missing`: the roles were never set;
- `roles_invalid`: the saved roles no longer validate;
- `sim_busy`: another Isaac process is running. That is the sim worker answering `/health`, or another evaluate.
  Only one Isaac process runs at a time; stop the sim worker (`scripts/launch/stop.ps1`) and retry.

**404:** the robot does not exist.

What the job does: it runs `sim_worker/scripts/robot_report.py` in the Isaac python, as its own process, and writes
`report.json`. The Franka takes about 7 minutes (30 scenes of ~14 s). The job's `result` is
`{"report": "/robots/{id}/report"}`.

## 6. `GET /robots/{id}/report`: status and the report card

Always `200` for a known robot (`404` otherwise), so the UI can poll one URL:

```json
{
  "status": "running",
  "progress": {"stage": "pick_place", "done": 12, "total": 30},
  "report": null,
  "error": null
}
```

- `status` is `none` (never evaluated), `queued`, `running`, `done` or `failed`.
- `progress.stage` is `convert` (URDF → USD, cached after the first run), `reach_map` or `pick_place`.
- `error` is a message when `failed`.
- `report` is the card when `done`; a failed re-run keeps the last good card in `report`.

**The report card** (`report`). Every number is either `{"value": …, "source": "…"}` or sits in a table whose
`source` covers its columns.

```json
{
  "schema": "sant.robot_report/1",
  "robot": {"id": "byor_3f9a1c2b7d", "name": "panda", "urdf_sha256": "3f9a1c2b7d5e...", "dof": 7},
  "roles": {"base": "panda_link0", "...": "the saved roles (§4)"},
  "spec": {"...": "the resolved spec (§4), with its sources"},
  "task": {
    "name": "pick-place",
    "text": "pick up the red cube and place it in the blue bin",
    "workspace": {"cube_x": [0.40, 0.60], "cube_y": [-0.20, 0.20], "cube_yaw": [-1.5708, 1.5708],
                  "bin_x": [0.40, 0.65], "bin_y": [-0.30, 0.30]},
    "seeds": [100, 129],
    "source": "demo_pipeline.multiply.SCENE_RANGES['franka'] (spec 8.6); scenes from demo_pipeline.multiply.sample_scene"
  },
  "verdict": {
    "value": "ready",
    "source": "rule: ready if pick-place succeeds in >= 24 of 30 scenes, partial if >= 6, else not_ready"
  },
  "pick_place": {
    "successes": {"value": 27, "of": 30,
                  "source": "scripted expert (sim_worker.scripted) on the base scene, moved into each scene by demo_pipeline.multiply.transform_trajectory, replayed by sim_worker.replay (differential IK, Isaac Lab 3.0 PhysX), judged by demo_pipeline.success.check_success"},
    "failure_reasons": {"value": {"unreachable": 3},
                        "source": "demo_pipeline.success.check_success reason codes over the failed scenes; one scene can have several"},
    "tracking_mean_mm": {"value": 1.9, "source": "sim_worker.tracking.tracking_stats: commanded vs reached tool point, mean over every step of every scene"}
  },
  "reach_map": {
    "fraction": {"value": 0.97, "source": "share of grid cells reachable in every layer"},
    "grid": {"x": [0.40, 0.45, 0.50, 0.55, 0.60, 0.65], "y": [-0.30, -0.25, "...", 0.30]},
    "layers": [
      {"name": "grasp", "z": 0.025, "yaw_deg": 0, "reachable": [[true, true, "... one row per x, one entry per y"]]},
      {"name": "grasp", "z": 0.025, "yaw_deg": 45, "reachable": [["..."]]},
      {"name": "grasp", "z": 0.025, "yaw_deg": -45, "reachable": [["..."]]},
      {"name": "release", "z": 0.10, "yaw_deg": 0, "reachable": [["..."]]},
      {"name": "carry", "z": 0.25, "yaw_deg": 0, "reachable": [["..."]]}
    ],
    "source": "sim_worker.urdf_kin.solve_ik on the URDF chain (the one Isaac imports): tool pointing down at each cell, joint limits enforced, from 4 start poses; reachable = within 5 mm and 0.05 rad"
  },
  "joint_limit_hits": {
    "value": [{"joint": "panda_joint4", "scenes": 2, "steps": 41, "limit": "lower"}],
    "source": "recorded joint positions (steps.npz joint_pos) within 0.01 rad (prismatic: 0.5 mm) of a URDF limit, over all scenes; arm joints only"
  },
  "scenes": {
    "source": "one row per seed: success and reasons from check_success, positions from sample_scene, tracking from tracking_stats, limit hits as above",
    "rows": [
      {"seed": 100, "success": true, "reasons": [], "cube": [0.519, 0.116], "bin": [0.572, -0.186],
       "tracking_mean_mm": 1.9, "limit_hits": []}
    ]
  },
  "provenance": {
    "git_commit": "e94d817",
    "created_at": "2026-10-18T15:20:00Z",
    "wall_s": 434.0,
    "sim": {"physics_dt": 0.01, "decimation": 2, "isaac_lab": "3.0"},
    "baseline": {"franka_builtin": "27/30 (data/multiply_franka/yield.json, 2026-10-16)"}
  }
}
```

**How the sim runs an uploaded robot** (`sim_worker/byor_scene.py`; the card's `provenance` repeats it):

- URDF → USD with Isaac Lab's `UrdfConverter`: fixed base, fixed joints merged, convex-hull collisions, no
  self-collision, the PhysX variant. It reconverts only when the URDF's bytes or these settings change.
- Drives: the arm gets stiffness 400 / damping 80 (Isaac Lab's `FRANKA_PANDA_HIGH_PD_CFG`, its gains for
  differential IK), the driven gripper joints 2000 / 100, mimic joints no drive. Effort and velocity limits come
  from the URDF. Gravity is off on the robot, as in the `*_HIGH_PD` configs; the cube keeps its gravity.
- Contacts: the cube's sensor is filtered against the finger links (the gripper joints' children), the table's and
  the bin's against every arm, hand and finger body, found by name in the converted USD.
- The scenes are the Franka's (`robot` in each `scene.json` is `franka`: whose workspace it is); the robot that
  runs is the upload.

The `reach_map` layers are the tool poses the task needs:
- `grasp` at the cube's centre height, with the wrist turned −45°, 0° and +45° (the scripted grasp turns at most
  45°);
- `release` 0.10 m above the bin floor;
- `carry` at the 0.25 m carry height.

`reachable[i][j]` is grid `x[i]`, `y[j]`.

## 7. `GET /jobs/{job_id}`

The existing jobs route (`/demos` uses it too). Kind `robot_report`; status `queued|running|succeeded|failed`.

## 8. Issue codes

| Code | Severity | Where it comes from | Meaning |
|---|---|---|---|
| `not_urdf` | error | upload | not a `.urdf` or `.zip` |
| `xacro` | error | upload | a `.xacro` file, or a zip with only xacro: run `xacro` first |
| `no_urdf` / `multiple_urdfs` | error | upload | a zip with no `.urdf` or more than one (the message lists them) |
| `unsafe_zip` | error | upload | an absolute path, `..` or a link in the zip |
| `too_large` | error | upload | over 100 MB or 5000 files |
| `urdf_parse` | error | upload | broken XML or URDF structure (no `<robot>`, a joint without parent/child, ...) |
| `missing_mesh` | error | parts | a mesh the URDF names is not in the upload |
| `package_unresolved` | error | parts | `package://pkg/...` with no folder or `package.xml` for `pkg` |
| `mesh_format` | error | parts | a mesh that is not STL, OBJ or DAE (convert GLB first) |
| `multiple_roots` / `cycle` | error | parts | the links do not form one tree |
| `unsupported_joint` | error | parts / roles | a `floating` or `planar` joint in the arm or gripper |
| `no_arm` | error | parts | no revolute joints at all |
| `arm_too_short` | error | parts / roles | fewer than 5 arm joints |
| `arm_not_chain` | error | roles | the arm joints are not one chain from `base` to `hand` |
| `no_hand` | error | parts | there is nothing after the last arm joint |
| `no_gripper` | error | parts / roles | no gripper joints below the hand |
| `joint_no_limits` | error | parts / roles | a revolute or prismatic arm or gripper joint without `<limit>` |
| `unknown_joint` / `unknown_link` | error | roles | a name not in the URDF |
| `role_overlap` | error | roles | the same joint in two roles |
| `tcp_estimated` | warning | parts / roles | no TCP link or usable finger geometry: the TCP is the finger joints' midpoint; set `tcp_offset` |
| `no_inertial` | warning | parts | a link with geometry but no `<inertial>` (the importer gives it a default mass) |
| `reach_short` | warning | parts / roles | the reach estimate is shorter than the distance from the mount to the far edge of the workspace |
| `start_pose_unsolved` | warning | roles | the start-pose IK did not converge (residual in the message); set `start_joint_pos` |

## 9. Files on disk

All of a robot's files live under `DATA_DIR/robots/<id>/`:

| File | What |
|---|---|
| `source/` | the upload, extracted |
| `robot.json` | summary: id, name, URDF path in `source/`, SHA-256, upload time |
| `roles.json` | the last accepted roles and the resolved spec (§4) |
| `usd/` | the URDF → USD conversion (Isaac Lab `UrdfConverter`; it reconverts only when the URDF or the settings change) |
| `report.json` | the last finished report card |
| `report_status.json` | status, progress and error of the current or last run |
| `run/` | the run's scenes (`source/`, `var_0100/`, ...), each with `scene.json`, `trajectory.json`, `verification.json`, `signals.npz` and `steps.npz` (`joint_pos`, `joint_names`) |
| `run.log` | the Isaac process's output; a failed run's error ends with its last lines |
| `report_progress.json` | the running stage (§6 `progress`); removed when the run ends |
