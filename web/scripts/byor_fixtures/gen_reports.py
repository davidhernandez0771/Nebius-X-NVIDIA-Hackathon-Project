"""T1 fixture builder, step 2 (after gen_parts.py, same out dir, run from C:\dev\pm-t2): the report card for the
Franka and the OpenArm, assembled with T2's own card code (sim_worker.byor_report) from the recorded built-in runs.
Read-only on pm-t2."""
import json, sys, glob
from pathlib import Path
import numpy as np
from sim_worker.byor_store import RobotStore
from sim_worker.urdf_import import Roles, build_spec
from sim_worker import byor_report as card

out = Path(sys.argv[1])
store = RobotStore(out / "store")
ROBOTS = {
    "franka": {"runs": "data/yield/clean_franka_s4.json", "eps": "data/episodes/yield_clean_franka_s4_{seed:04d}",
               "note": "docs/superpowers/notes/2026-10-15-t2-status.md:639 (clean-expert Franka multiply 30/30, seeds 100-129)"},
    "openarm": {"runs": "data/multiply_openarm/yield.json", "eps": None,
                "note": "docs/superpowers/notes/2026-10-15-t2-status.md:311 (OpenArm multiply 0/30, seeds 100-129)"},
}
for name, cfg in ROBOTS.items():
    up = json.loads((out / f"{name}.upload.json").read_text())
    rid = up["id"]
    saved = json.loads((out / f"{name}.roles.json").read_text())
    roles = Roles.model_validate(saved["roles"])
    u = store.urdf(rid)
    spec = build_spec(u, roles, rid, mesh_loader=store.mesh_loader(rid)).spec
    reach = card.reach_map(u, spec, roles)
    y = json.loads(Path(cfg["runs"]).read_text())
    rows, qs = [], []
    arm = list(roles.arm_joints)
    for v in y["variants"]:
        seed = v.get("seed") or int(v["variant"].split("_")[1])
        if cfg["eps"]:
            ep = Path(cfg["eps"].format(seed=seed))
            sc = json.loads((ep / "scene.json").read_text())
            cube, binp, mean = sc["cube_pose"]["pos"][:2], sc["bin_pose"]["pos"][:2], None
        else:
            ep = Path(glob.glob(f"data/multiply_openarm/*/var_{seed:04d}")[0])
            cube, binp, mean = v["cube"], v["bin"], v["mean_mm"]
        q = np.load(ep / "steps.npz")["joint_pos"][:, :len(arm)]  # columns 0-6 are joints 1-7 (ranges match the limits)
        hits = card.joint_limit_hits(u, arm, arm, [q])
        rows.append({"seed": seed, "success": v["success"], "reasons": v["reasons"],
                     "tracking_mean_mm": None if mean is None else round(mean, 2), "n_steps": int(len(q)),
                     "cube": [round(c, 4) for c in cube], "bin": [round(c, 4) for c in binp],
                     "limit_hits": [f"{h['joint']}:{h['limit']}" for h in hits]})
        qs.append(q)
    hits = card.joint_limit_hits(u, arm, arm, qs)
    rep = card.build_report(
        robot={"id": rid, "name": up["name"], "urdf_sha256": up["sha256"], "dof": len(arm)},
        roles=saved["roles"], spec=saved["spec"], seeds=(rows[0]["seed"], rows[-1]["seed"]), rows=rows, reach=reach,
        limit_hits=hits,
        provenance={"fixture": ("T1 web fixture, not a BYOR run. Pick-place rows are the built-in robot's recorded "
                                f"run ({cfg['runs']}; {cfg['note']}). The reach map and limit hits are "
                                "sim_worker.byor_report on the uploaded URDF and that run's joint positions."),
                    "created_at": "2026-10-18", "baseline": {"source": cfg["note"]}})
    (out / f"{name}.report.json").write_text(json.dumps(rep, indent=1))
    pp = rep["pick_place"]
    print(name, pp["successes"]["value"], "/", pp["successes"]["of"], pp["failure_reasons"]["value"],
          "reach", rep["reach_map"]["fraction"]["value"], [(l["name"], l["yaw_deg"], l["fraction"]) for l in rep["reach_map"]["layers"]],
          "hits", hits, rep["verdict"]["value"])
