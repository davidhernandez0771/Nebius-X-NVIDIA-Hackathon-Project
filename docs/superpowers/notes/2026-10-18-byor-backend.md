# T2 status: "Bring your robot" backend (2026-10-18)

Contract: `docs/design/byor-api.md`. Branch `pm/byor-backend`, worktree `C:\dev\pm-t2`. Not pushed or merged.

## What is built

| Part | Files | Commit |
|---|---|---|
| Contract | `docs/design/byor-api.md` | `e73cd75` |
| URDF parse, role rules, validation, spec (tool point, gripper, IK link, start pose), FK/IK | `sim_worker/urdf_import.py`, `sim_worker/urdf_kin.py` | `202034d` |
| Robot store + `/robots` routes (upload, parts, roles, evaluate, report) | `sim_worker/byor_store.py`, `src/app/routers/robots.py` | `66d4a0a` |
| Isaac side: URDF → USD (cached), scene, report-card run, card builder | `sim_worker/byor_scene.py`, `sim_worker/scripts/robot_report.py`, `sim_worker/byor_report.py` | `41d1268` |
| Test inputs from Isaac's own robot USDs | `sim_worker/scripts/export_usd_urdf.py` | `41d1268` |

**Recovered after the PC crash.** `byor_store.py` and `tests/test_app_robots_api.py` were on disk but uncommitted, and
the router the tests import (`src/app/routers/robots.py`) did not exist yet. I wrote the router to the tests and the
contract, then committed (`66d4a0a`).

## Decisions

- **Drives for any uploaded robot:** the arm uses Isaac Lab's `FRANKA_PANDA_HIGH_PD_CFG` gains (400 / 80) and the
  driven gripper joints use 2000 / 100. Mimic joints get no drive. Effort and velocity limits come from the URDF,
  and gravity is off on the robot. The built-in Franka differs in one way: its finger effort is 200 N, the URDF's
  is 20 N.
- **Scenes:** every robot runs the Franka's scenes (seeds 100–129, `sample_scene(rng, "franka", seed)`). The
  OpenArm baseline (`data/multiply_openarm`) used the same scenes; its cube and bin positions match the Franka's
  row for row.
- **Tracking:** `replay(..., robot=<id>)` runs the uploaded robot. `scene.robot` stays `franka`, meaning whose
  workspace it is, because `RobotName` is a closed `Literal` owned by `demo_pipeline`. The report run therefore
  writes its own per-scene files, not `EpisodeMeta` episodes, which would be labeled `franka`.
- **Report must be written inside `launch_simulation`:** leaving the context closes Kit and ends the process. This
  was found on the first smoke run, which ended without a `report.json`.
- **No `--headless` flag:** Isaac Lab 3.0's launcher has none, and headless is the default.
- **Evaluate checks for a running sim worker (`/health`) or another evaluate. It does not check `C:\dev\gpu.lock`,**
  which is a dev-machine convention. My Isaac runs went through a wrapper that honours it. The wrapper is in my
  scratchpad, not in the repo.

## Test inputs (in `data/byor_inputs/`, gitignored; how to rebuild them)

- **Franka:** zip of Isaac's bundled `franka_description` (`isaacsim.asset.importer.urdf/data/urdf/robots/
  franka_description`: `package.xml`, `robots/panda_arm_hand.urdf`, `meshes/`). Upload id `byor_3292d47ab6`.
  The suggested roles were accepted as-is with no issues. The derived TCP is 0.10328 m vs the built-in 0.1034.
- **OpenArm:** no OpenArm URDF is on disk, and downloading is not allowed without asking. I exported Isaac's own
  cached `openarm_unimanual.usd` (the asset of the 0/30 baseline):
  `export_usd_urdf.py --usd <cache>\...\openarm_unimanual.usd --out data\byor_inputs\openarm --collision-only`.
  - The `PhysX` variant name is case-sensitive.
  - `openarm_hand_joint` and `openarm_ee_tcp_joint` are locked `[x, x]` joints, written out as fixed.
  - The visuals are dropped: their meshes export to 148 MB of OBJ, over the 100 MB upload limit.
  - Upload id `byor_790916a678`; mount `[0.20, 0, 0.25]` (the built-in's); otherwise the suggested roles.
  - The derived TCP is `openarm_ee_tcp` = link7 + 0.1931 m, the same as the built-in hand + 0.093.
  - Differences from the built-in: the importer puts the fingers straight on link7, and finger 2 mimics finger 1.
    The new path also does not know the built-in's 90° finger turn or its `ik_limit_gain` 0.5.
- **SO-101:** skipped. Its URDF is not on disk.

## Results (2026-10-18, Isaac Lab 3.0, seeds 100–129, all runs under `C:\dev\gpu.lock`)

Each run went through the API: upload → parts → PUT roles → POST evaluate → the job ran `robot_report.py` in the
Isaac python → poll `/robots/{id}/report`. The cards are copied in `data/byor_runs/`. The Franka card is also
`tests/data/byor/franka.report.json`, the cached result for `tests/test_byor_e2e.py`.

| Run | Pick-place | Reasons | Tracking mean / max (mm) | Reach map | Wall |
|---|---|---|---|---|---|
| Franka, new path, suggested roles | **30/30** | — | 3.75 / 10.7 | 1.00 | 241 s |
| Franka, new path, built-in start pose (`start_joint_pos` = Isaac's default joints) | 30/30 | — | 3.79 / 11.2 | 1.00 | 229 s |
| Franka, **built-in** `multiply_run.py`, today, same seeds | **30/30** | — | 2.04 / 7.1 | — | 207 s |
| Franka, built-in, 2026-10-16 (`data/multiply_franka`) | 27/30 | unreachable 3 (115, 126, 129) | 4.3 / 81 | — | 416 s |
| OpenArm, new path, mount `[0.20, 0, 0.25]` | **0/30** | unreachable 30, not_in_bin 30 | — | 0.51 | 255 s |
| OpenArm, built-in, 2026-10-16 (`data/multiply_openarm`) | 0/30 | unreachable 30, collision 13, not_in_bin 10, dropped 8 | 23 / 81 | — | 626 s |

**Franka matches the built-in.** The 2026-10-16 card says 27/30, but that run is stale: on the current code the
built-in Franka gets 30/30 on the same seeds (`data/multiply_franka_rerun_20261018/yield.json`). I did not bisect
which later commit changed it. Against today's built-in run:

- **Outcomes:** success agrees on all 30 seeds, and the cube and bin positions are identical.
- **Tracking is 1.7 mm worse** on average with the new path (per seed +0.7 to +3.3 mm). Likely causes, none tested
  separately:
  - the URDF's limits and inertias instead of the Isaac asset's (velocity 2.2–2.6 rad/s vs 20–25; finger effort
    20 N vs 200);
  - convex-hull mesh collisions instead of the asset's primitives;
  - a TCP 1.1 mm shorter.
- **The start pose does not change the outcome:** both start poses give 30/30.
- **One joint-limit hit:** `panda_joint7` touches its upper limit in seed 126 (46 steps) and still succeeds.

**OpenArm reproduces the wrist flaw.** All 30 scenes fail `unreachable`.

- The card's joint-limit table names the cause: `openarm_joint6` (the ±45° wrist) is at its upper limit in **30 of
  30** scenes (4886 steps), and `openarm_joint7` at its lower limit in 28.
- The reach map gives 0.51 overall, with the grasp layers at 0.56–0.62.
- Why its reasons differ from the built-in's: the built-in run turned the fingers 90° in the tool frame and used
  `ik_limit_gain` 0.5. Both are hand-tuned for that robot and unknown to the generic path. So here the arm never
  closes on the cube: not_in_bin 30, with no drops or collisions. The built-in arm sometimes carried the cube and
  dropped it.
- The verdict is `not_ready`, as it should be.

**The reach map is optimistic for the OpenArm.** Static IK, with 4 start poses, reaches about 60% of the grasp
cells, yet the DLS replay, one path from the start pose, reaches none. The reach map says where a pose exists; the
pick-place count says whether this controller gets there.

**Tests:** `uv run pytest` (worktree venv) passes before each commit.

## Connecting T1's `/robots/setup` (pm/web-setup, `C:\dev\pm-t1`) to this backend

I checked `web/src/site/setup/client.ts`, `types.ts`, `roles.ts` and `useRun.ts` against the routes, read-only.

**The calls match:**

| Call | What it sends |
|---|---|
| `POST /robots` | multipart, field `file` |
| `GET /robots/{id}/parts` | — |
| `PUT /robots/{id}/roles` | `{base, arm_joints, hand, gripper_joints, mount: {pos}}` |
| `POST /robots/{id}/evaluate` | `{seed0: 100, n: 30}` |
| `GET /robots/{id}/report` | polled |
| `GET /robots` | `pickClient`'s liveness probe |

Errors are read from `detail.errors`. Every field `types.ts` reads is in the responses.
`tests/test_byor_e2e.py` checks the same field lists against a real report card.

**Fixed on my side:**

- **CORS** allowed only `http://localhost:5173`. A page opened at `http://127.0.0.1:5173` could not reach the API,
  and `pickClient` silently fell back to the fixtures. Both origins are allowed now (`src/app/main.py`).
- **An upload with no `file` field** got FastAPI's default 422 (a list in `detail`), which `toError` shows as raw
  text. It is now a 400 `not_urdf` in the contract shape.

**For T1 (nothing blocks the live mode):**

1. `types.ts` `PartJoint.limits`: `effort` and `velocity` are `number | null`. A URDF `<limit>` may leave them out,
   and the backend then sends `null`. Today the type says `number`.
2. Replace the fixture report cards with the real runs (section above): `data/robots/byor_3292d47ab6/report.json`
   (Franka) and `data/robots/byor_790916a678/report.json` (OpenArm). The current `franka.report.json` (30/30) and
   `openarm.report.json` come from the built-in robots' runs, not BYOR runs.
3. Live runs need the sim worker stopped. Evaluate answers 409 `sim_busy` while anything answers
   `http://localhost:8770/health`. The page already shows that message.
