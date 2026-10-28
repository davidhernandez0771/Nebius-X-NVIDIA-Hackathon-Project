"""Render a frozen demo set with cameras (T2 sprint 5, Task 3: T1's set v2). Resumable by demo id.

    C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_worker\\scripts\\render_set.py --set C:\\dev\\pm-t1\\data\\sets\\v2

For each manifest entry: replay <set>/<id>/demo.json with front + wrist cameras ->
DATA_DIR/episodes/<prefix><id>/ (episode + signals.npz + scene/trajectory/verification.json), then copy T1's demo.json
and truth.json there verbatim. An id whose folder already has verification.json and truth.json is skipped.
Index: DATA_DIR/episodes/<prefix><set name>_index.json with the manifest's SHA-256, every row and the per-type table.
"""

import argparse
import hashlib
import json
import sys
import time
import traceback
from pathlib import Path

from isaaclab.app import add_launcher_args, launch_simulation

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))  # repo root: sim_worker
from sim_worker.own_code import check_own_code, put_own_code_first  # noqa: E402

put_own_code_first()  # this checkout's src before the venv's editable install (it points at another worktree)

parser = argparse.ArgumentParser(description="Replay a frozen demo set with cameras, keeping its ground truth.")
parser.add_argument("--set", type=Path, required=True, help="set folder with manifest.json and <id>/demo.json")
parser.add_argument("--prefix", default="", help="prepended to each id for the episode folder name")
parser.add_argument("--no-cameras", action="store_true")
add_launcher_args(parser)
args_cli = parser.parse_args()
if not args_cli.no_cameras:
    args_cli.enable_cameras = True

from demo_pipeline.paths import data_dir  # noqa: E402
from demo_pipeline.sim_protocol import ReplayRequest  # noqa: E402
from sim_worker.degraded import is_done  # noqa: E402
from sim_worker.isaac_executor import IsaacExecutor  # noqa: E402
from sim_worker.jobs import episodes_dir, run_replay  # noqa: E402
from sim_worker.keepawake import KeepAwake  # noqa: E402
from sim_worker.replay import make_sim_cfg  # noqa: E402
from sim_worker.setrender import copy_case_files, must_fail, outcome_table, set_entries  # noqa: E402


def main() -> None:
    check_own_code()  # logs where demo_pipeline came from; stops if not this checkout
    root, cameras = Path(data_dir()), not args_cli.no_cameras
    manifest_bytes = (args_cli.set / "manifest.json").read_bytes()
    set_name = json.loads(manifest_bytes).get("name", args_cli.set.name)
    entries = set_entries(args_cli.set)  # reads every demo first: a broken set fails before Isaac starts
    index_path = episodes_dir(root) / f"{args_cli.prefix}{set_name}_index.json"
    rows = []
    with launch_simulation(make_sim_cfg(args_cli.device), args_cli), KeepAwake():  # no idle sleep mid-run
        ex = IsaacExecutor(robot="franka", cameras=cameras, root=root)
        ex.warm_up()
        for e in entries:
            name = args_cli.prefix + e.id
            ep = episodes_dir(root) / name
            traj, scene = e.demo.trajectory, e.demo.scene
            row = {"id": e.id, "name": name, "type": e.type, "must_fail": must_fail(e.truth), "n_steps": len(traj.t),
                   "duration": round(traj.duration, 2),
                   "issues": sorted({i["type"] for i in e.truth.get("issues", []) if not i.get("dont_care")})}
            if is_done(ep):
                v = json.loads((ep / "verification.json").read_text(encoding="utf-8"))
                row.update(success=v["success"], reasons=v["reasons"], resumed=True)
                rows.append(row)
                print("RESUMED " + json.dumps(row), flush=True)
                continue
            t0 = time.time()
            try:
                resp = run_replay(ReplayRequest(trajectory=traj, scene=scene, record_cameras=cameras, out_name=name),
                                  ex._replay_fn, root=root, worker_robot="franka", worker_cameras=cameras)
                copy_case_files(e, ep)
                row.update(success=resp.verification.success, reasons=resp.verification.reasons, ep_dir=resp.ep_dir)
            except Exception as exc:  # recorded, retried on the next run
                traceback.print_exc()
                row.update(success=False, reasons=["sim_error"], error=repr(exc))
            row["wall_s"] = round(time.time() - t0, 1)
            rows.append(row)
            print("ROW " + json.dumps(row), flush=True)
        table = outcome_table(rows)
        index_path.write_text(json.dumps({"set": str(args_cli.set), "set_name": set_name,
                                          "manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
                                          "cameras": cameras, "by_type": table, "cases": rows}, indent=1),
                              encoding="utf-8")
        print("TABLE " + json.dumps(table), flush=True)
        print("INDEX " + json.dumps({"path": str(index_path), "n": len(rows),
                                     "violations": sum(len(t["violations"]) for t in table.values()),
                                     "sim_errors": sum(len(t["sim_errors"]) for t in table.values())}), flush=True)


if __name__ == "__main__":
    main()
