# Robot assets: downloads, manifest and the catalog's real specs (`pm/robot-assets`, 2026-10-20)

**What it was:** a job from the lead session. It relayed the user's approval to download open robot descriptions:
code and data only, no GPU, no Blender. The branch is from `pm/live-11` (2abc94e). Nothing pushed, merged or
rebased.

## Downloads (outside the repo)

`C:\dev\assets\robots\`, with `SOURCES.md` and `fetch_manifest.json`. No clones:
- GitHub's tree API at each repo's default-branch head, pinned by commit;
- each file from raw.githubusercontent.com, checked against the commit's git blob SHA-1;
- an allow-list of file types (meshes, URDF/xacro, YAML/XML, text, licence, package.xml).

| Folder | Repo @ commit | Licence (from its own file) | Files | Size |
|---|---|---|---|---|
| franka | frankarobotics/franka_description @ 7aeeddc | Apache-2.0 | 66 | 38.1 MB |
| so101 | TheRobotStudio/SO-ARM100 @ a758567 | Apache-2.0 | 42 | 19.1 MB |
| piper | agilexrobotics/piper_ros @ ac41fcb | MIT (its package.xml says BSD) | 45 | 63.5 MB |
| openarm | enactic/openarm_description @ 206eb8a | Apache-2.0 | 56 | 105.2 MB |
| ur5e | UniversalRobots/Universal_Robots_ROS2_Description @ d4042c1 (ur5e only, not UR15/18/20/30/8long) | BSD-3-Clause | 30 | 9.8 MB |
| xarm6 | xArm-Developer/xarm_ros2 @ ac736c9 (xarm6 + xArm gripper) | BSD-3-Clause (its package.xml says TODO) | 61 | 21.3 MB |

**Treated as untrusted data:**
- nothing from the downloads was run or imported;
- xacro was never run;
- XML is read only by ElementTree or regular expressions.

**One leftover:** the first fetch, using a block-list, also wrote `piper/src/piper_description/urdf/compile`. It is
a **Linux ELF executable** from piper_ros with no file extension. It was never run, can't run on Windows, and isn't
in `fetch_manifest.json`. I didn't delete it (no `rm`); **delete it by hand.** The fetch now uses the allow-list.

## In the repo

- **`sim_worker/robot_assets.py`** (pure) builds each arm's chain into `urdf_import`'s Urdf, so forward kinematics
  is `urdf_kin`'s one code path:
  - **plain URDFs** (SO-101, PiPER, OpenArm's generated example, comments stripped) go through `parse_urdf`;
  - **xacro-only robots** (Franka FER/FR3, UR5e, xArm6) are built from the YAML their xacro loads, plus the few
    literal values the YAML lacks (axes, fixed frames, the hand mount, xArm's limit defaults, parsed without eval).

  It also reads triangle counts, units and up axes from the mesh files, the rest poses, DoF and reach.
- **`scripts/robot_asset_manifest.py`** writes:
  - `docs/design/robot-assets/manifest.json` (links and meshes, rest poses, specs);
  - `blender.md` (mesh tables);
  - `web/src/world/stations/robots/specs.json`;
  - `C:\dev\assets\robots\SOURCES.md`.
- **The catalog** (`catalog.ts`, `Panel.tsx`): Franka, OpenArm, SO-101 and PiPER now show DoF, reach and joint
  limits from their URDF chains, with the source commit. The panel says how reach is measured. The Flexiv keeps
  the notes' numbers (not downloaded). No payload anywhere: no repo states one.
- **`docs/design/robot-assets/README.md`:** what each mesh needs in Blender (formats, units, scale traps,
  decimation ratios for ~15k triangles per arm, ~105k on the wall), and the rest poses.

| Robot | DoF | Reach (shoulder to flange) | Triangles |
|---|---|---|---|
| Franka Panda (FER) | 7 | 0.858 m | 134,924 |
| Franka Research 3 | 7 | 0.858 m | 240,624 |
| UR5e | 6 | 0.969 m | 121,789 |
| xArm 6 | 6 | 0.764 m | 75,650 |
| SO-101 | 5 + jaw | 0.313 m | 398,884 |
| PiPER | 6 | 0.628 m | 183,746 |
| OpenArm v1.0 | 7 | 0.438 m | 1,006,467 |

**Cross-checks (tests):**
- Franka's `kinematics.yaml` reproduces the Panda URDF the twin already loads (`web/public/robots`), joint for
  joint, at 20 random poses.
- The reaches match what SANT measured before: Franka ≈ 0.85 m, OpenArm shoulder to wrist ≤ 0.44 m (T2 status).

## Not done

- **UR5e and xArm6** are in the manifest and `specs.json` but not in the catalog list. Neither is a robot SANT
  tests, and adding them would change the wall's layout, which the Blender pass will redo. One line each in
  `catalog.ts` when wanted.
- **The xArm gripper's fingers** are listed as parts. Their linkage is posed by the gripper's xacro, which isn't
  resolved.
- **"The forest":** the manifest is general (every link's meshes, offsets and a rest pose); I don't know that
  scene's needs beyond that.
