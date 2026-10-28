"""The robot asset manifest (sim_worker.robot_assets) from the downloads in C:\\dev\\assets\\robots.

Writes:
- docs/design/robot-assets/manifest.json: per robot, the source (repo, commit, licence), the arm's joints with limits,
  DoF, reach, the rest pose and its source, every link's meshes (file, offset, scale, format, triangles, bytes, unit,
  up axis), the totals and a decimation ratio for the wall;
- docs/design/robot-assets/blender.md: the mesh table for the Blender pass (per robot and per file);
- web/src/world/stations/robots/specs.json: what the catalog panel shows from the chains (DoF, reach, joint limits,
  source commit);
- C:\\dev\\assets\\robots\\SOURCES.md: where every downloaded file came from (repo, commit, licence, paths, sizes).

Reads only: the downloads are data (never executed). Run:
    uv run python scripts/robot_asset_manifest.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sim_worker.robot_assets import ASSETS, WALL_TRIS_PER_ROBOT, manifest  # noqa: E402

OUT = ROOT / "docs" / "design" / "robot-assets"
SPECS = ROOT / "web" / "src" / "world" / "stations" / "robots" / "specs.json"


def specs(man: dict) -> dict:
    """The catalog's numbers per robot: DoF, reach and the arm joints' limits, with their source commit."""
    out = {}
    for name, r in man["robots"].items():
        arm = r["joints"][: r["dof"]]
        out[name] = {"label": r["label"], "repo": r["source"]["repo"], "commit": r["source"]["commit"][:7],
                     "licence": r["source"]["licence"], "dof": r["dof"], "reach_m": r["reach_m"],
                     "reach_definition": r["reach_definition"],
                     "joints": [{"name": j["name"], "type": j["type"], "lower": j["lower"], "upper": j["upper"]} for j in arm]}
    return out


def sources_md(fetch: dict, man: dict) -> str:
    lines = ["# Robot descriptions: sources", "",
             "Downloaded for SANT's robot wall, forest and catalog (2026-10-20), with the user's approval relayed by the "
             "lead session. Subsets only, no clones: GitHub's tree API at a pinned commit, then each file from "
             "raw.githubusercontent.com, checked against the commit's git blob SHA-1 (`fetch_manifest.json` lists every "
             "file, size and blob SHA). Data only: nothing here is executed. Each folder keeps its repo's licence file.", "",
             "| Folder | Repo | Commit | Licence (from the repo's own file) | Files | Size |", "|---|---|---|---|---|---|"]
    lic = {r["source"]["folder"]: r["source"]["licence"] for r in man["robots"].values()}
    for folder, f in fetch.items():
        lines.append(f"| `{folder}/` | [{f['repo']}](https://github.com/{f['repo']}/tree/{f['commit']}) ({f['branch']}) | "
                     f"`{f['commit']}` | {lic.get(folder, '?')} | {len(f['files'])} | {f['bytes'] / 1e6:.1f} MB |")
    total = sum(f["bytes"] for f in fetch.values())
    lines += ["", f"Total: {sum(len(f['files']) for f in fetch.values())} files, {total / 1e6:.1f} MB.", "",
              "## What was taken from each repo", "",
              "- **franka** (frankarobotics/franka_description): LICENSE, package.xml, README; `robots/common`, `robots/fer` "
              "(the Panda) and `robots/fr3` (xacro + kinematics/limits YAML); `end_effectors/common`, `end_effectors/franka_hand`; "
              "visual + collision meshes for `fer`, `fr3` and the white hand.",
              "- **so101** (TheRobotStudio/SO-ARM100): LICENSE; `Simulation/SO101/` (URDFs, MJCF, STL meshes).",
              "- **piper** (agilexrobotics/piper_ros): LICENSE; `src/piper_description/` package.xml, `urdf/`, `meshes/`.",
              "- **openarm** (enactic/openarm_description): LICENSE.txt, README, package.xml; `assets/robot/openarm_v1.0/` "
              "(config/arm, urdf, mesh/arm: v1.0 is the OpenArm SANT ran in Isaac) and `assets/end_effector/parallel_link/` "
              "(its gripper). Not the bimanual torso meshes.",
              "- **ur5e** (UniversalRobots/Universal_Robots_ROS2_Description): LICENSE, package.xml, README; `urdf/`, "
              "`config/ur5e/`, `config/initial_positions.yaml`, `meshes/ur5e/`. **Not** the UR15/18/20/30/8long meshes, "
              "which carry their own restrictive LICENSE.txt.",
              "- **xarm6** (xArm-Developer/xarm_ros2): LICENSE; `xarm_description/` package.xml, the xarm6 + common + "
              "xArm-gripper xacros, xarm6 config (kinematics, joint limits, link inertials), `meshes/xarm6/` and "
              "`meshes/gripper/xarm/`.",
              "", "Only these file types were fetched: stl, dae, obj, glb, gltf, urdf, xacro, yaml, xml, md, txt, csv, json, part, "
              "LICENSE, package.xml. Scripts, launch files and binaries were excluded.", "",
              "## Licence notes", "",
              "- **PiPER:** the repo's LICENSE is MIT, but `src/piper_description/package.xml` says `<license>BSD</license>`. "
              "The repo-level LICENSE governs the repo; flagged in case it matters.",
              "- **xArm:** the LICENSE is UFACTORY's BSD-3-Clause; `xarm_description/package.xml` says "
              "`<license>TODO: License declaration</license>`.",
              "- **UR:** the repo is BSD-3-Clause; only `meshes/ur5e` was taken (no per-folder licence there).",
              "",
              "## To remove by hand",
              "",
              "- `piper/src/piper_description/urdf/compile` is a **Linux ELF executable** from piper_ros that the first "
              "fetch's block-list let through (it has no file extension). It was never run (and can't run on Windows). "
              "It is not in `fetch_manifest.json`; the fetch now uses an allow-list of file types. Delete it when you like.",
              ""]
    return "\n".join(lines)


def blender_md(man: dict) -> str:
    lines = ["# Robot meshes for the Blender pass", "",
             "Generated by `scripts/robot_asset_manifest.py` from `manifest.json`. Triangle counts are from the files "
             "(STL facets; Collada triangles + polylists). Units: STL has none (the URDF's `scale` says: 0.001 means "
             "millimetres); Collada says its own `unit` and `up_axis`, which Blender's importer applies.", "",
             f"Wall budget: ~{WALL_TRIS_PER_ROBOT // 1000}k triangles per arm, {man['wall_target_tris'] // 1000}k for the "
             f"{len(man['robots'])} arms (the brief's 50–150k on the wall). The ratio is Blender's Decimate (Collapse) "
             "ratio for the whole arm; small links (fingers, flanges) can keep more and the long links less.", "",
             "| Robot | Formats | Mesh files | Triangles | Size | Decimate to ~15k |", "|---|---|---|---|---|---|"]
    for name, r in man["robots"].items():
        fmts = sorted({m["format"] for v in r["meshes"].values() for m in v})
        t = r["mesh_totals"]
        lines.append(f"| {r['label']} | {', '.join(fmts)} | {t['files']} | {t['tris']:,} | {t['bytes'] / 1e6:.1f} MB | "
                     f"{r['blender']['decimate_ratio']} |")
    lines += ["", "## Per file", ""]
    for name, r in man["robots"].items():
        lines += [f"### {r['label']}", "", "| Link | File | Format | Triangles | Unit | Up | Scale | Offset (xyz / rpy) |",
                  "|---|---|---|---|---|---|---|---|"]
        for link, ms in r["meshes"].items():
            for m in ms:
                off = f"{m['origin']['xyz']} / {[round(v, 4) for v in m['origin']['rpy']]}"
                lines.append(f"| {link} | `{m['file']}` | {m['format']} | {m.get('tris', 0):,} | {m.get('unit_m')} | "
                             f"{m.get('up_axis')} | {m['scale']} | {off} |")
        if r["notes"]:
            lines += ["", *(f"- {n}" for n in r["notes"])]
        lines.append("")
    return "\n".join(lines)


def main() -> int:
    man = manifest()
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "manifest.json").write_text(json.dumps(man, indent=1) + "\n", encoding="utf-8")
    (OUT / "blender.md").write_text(blender_md(man), encoding="utf-8")
    SPECS.write_text(json.dumps(specs(man), indent=1) + "\n", encoding="utf-8")
    fetch = json.loads((ASSETS / "fetch_manifest.json").read_text(encoding="utf-8"))
    (ASSETS / "SOURCES.md").write_text(sources_md(fetch, man), encoding="utf-8")
    for name, r in man["robots"].items():
        print(f"{name:8s} DoF {r['dof']}  reach {r['reach_m']:.3f} m  meshes {r['mesh_totals']['files']:3d}  "
              f"tris {r['mesh_totals']['tris']:>9,}  licence {r['source']['licence']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
