"""Build the Test track's data (web/public/test-track-data): compact JSON replays of simulations that already ran in Isaac,
for the /test-track page to play back. It never runs physics; every pose is one Isaac recorded.

    uv run --no-sync python scripts/build_test_track.py [--final DIR] [--gate DIR] [--replay-check DIR] [--round0 DIR]
                                                        [--out DIR] [--check-estimate]

Sources (read only; the defaults are where T3 and T6 wrote them on this machine), in the page's order:
- final:        the big test's pre-registered final test (seeds 5400-5439, run once): the camera policy's per-step traces
                and the eval's episode log, C:\\dev\\pm-t6-big\\data\\evals\\bigtest_test (bigtest_final.episodes.jsonl,
                bigtest_final_traces/seed_<seed>.npz + .json). The traces don't carry the bin, so it is re-made from each
                scene's seed with the eval's own sampler (sim_eval.scenes.eval_scenes, as run_eval's scene_plan made it),
                and every trace is re-judged by SANT's check_success against it, exactly as the eval scored it
                (sim_eval.eval_policy._score). The build stops unless every verdict and its reasons come out as the eval
                logged them. Success, reasons and time are the log's; path, peak contact and settle time are that re-judging's.
- gate:        T3's teacher gate 2, C:\\dev\\pm-t3\\data\\rl\\eval\\v6c2_gate2 (verify.json, in_env.json, replay/episodes).
- replay-check: T3's replayability check on non-gate seeds, ...\\v6c2_replaycheck_7000 (same layout).
- round0:       T6's distill round 0 teacher episodes, C:\\dev\\pm-t6\\data\\distill\\distill_mouse\\r0 (rollouts.jsonl,
                round_t300.json, episodes/teacher_r0_<seed>). Failed rollouts saved no episode: they are listed, not replayed.

Writes:
    <out>/index.json                  {built, sources: [{id, title, what, checkpoint, seeds, summary, runs: [...]}]}
    <out>/runs/<source>/<seed>.json   the twin's episode payload (app.routers.twin: joint_pos, gripper, cube_pos, bin,
                                      base, 4 decimals) + cube_source, contact_n, hand_pos (3 decimals), facts. The
                                      final test adds cube_quat_path (the cube's recorded rotation each step, 3
                                      decimals) and contacts ({gripper_cube, arm_bin, arm_table}: [first, last + 1)
                                      step ranges where Isaac's contact sensors fired). All its steps are kept (50 Hz).

The cube: the gate and replay-check runs recorded its position every step (signals.npz). Round 0 did not record the
cube at all, so its cube is ESTIMATED from the gripper (estimate_cube) and marked cube_source "estimated";
--check-estimate measures that estimate against the runs that did record it. Neither recorded the cube's rotation:
it keeps the scene's start orientation, as in the twin. The final test recorded the cube's position and rotation.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "web" / "public" / "test-track-data"
GATE = Path(r"C:\dev\pm-t3\data\rl\eval\v6c2_gate2")
REPLAY_CHECK = Path(r"C:\dev\pm-t3\data\rl\eval\v6c2_replaycheck_7000")
ROUND0 = Path(r"C:\dev\pm-t6\data\distill\distill_mouse\r0")
FINAL = Path(r"C:\dev\pm-t6-big\data\evals\bigtest_test")
FINAL_CELL = "bigtest_final"

# The twin's joint order and base (app.routers.twin), so the page can use the twin's parser as is.
JOINT_NAMES = (*(f"panda_joint{i}" for i in range(1, 8)), "panda_finger_joint1", "panda_finger_joint2")
BASE = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0]
DECIMALS = 4

# The cube estimate (round 0): measured on the gate's recorded runs (--check-estimate).
GRASP_REACH_M = 0.05  # the gripper closes within this of the cube's centre: it took the cube
CUBE_HALF = 0.025  # the cube's centre on the table
REST_IN_BIN_Z = 0.035  # where a dropped cube's centre settles in the bin (the gate's recorded runs end at 0.035)
G = 9.81


def _round(a) -> list:
    return (np.round(np.asarray(a, dtype=np.float64), DECIMALS) + 0.0).tolist()


def wilson(k: int, n: int, z: float = 1.959964) -> list[float]:
    if n <= 0:
        return [0.0, 1.0]
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(max(0.0, c - h), 4), round(min(1.0, c + h), 4)]


def _in_bin(xy, bin_pos, inner) -> bool:
    return abs(xy[0] - bin_pos[0]) <= inner[0] / 2 and abs(xy[1] - bin_pos[1]) <= inner[1] / 2


def estimate_cube(ee: np.ndarray, gripper: np.ndarray, start: np.ndarray, bin_pos, inner, fps: float) -> np.ndarray:
    """The cube's path from the gripper alone, for runs that didn't record it. The cube stays put until the gripper
    closes within GRASP_REACH_M of it; then it keeps its offset to the gripper; when the gripper opens it falls
    straight down (free fall) to the bin's floor if it is over the bin, else to the table."""
    n = len(gripper)
    out = np.zeros((n, 3))
    cube = np.asarray(start, dtype=np.float64).copy()
    held, offset, fall = False, np.zeros(3), None  # fall: (start step, start z, rest z)
    for k in range(n):
        closed = bool(gripper[k])
        was = bool(gripper[k - 1]) if k else False
        if closed and not was and not held and np.linalg.norm(ee[k] - cube) <= GRASP_REACH_M:
            held, offset, fall = True, cube - ee[k], None
        elif held and not closed:
            held = False
            rest = REST_IN_BIN_Z if _in_bin(cube[:2], bin_pos, inner) else CUBE_HALF
            fall = (k, cube[2], rest)
        if held:
            cube = ee[k] + offset
        elif fall:
            t = (k - fall[0]) / fps
            cube = cube.copy()
            cube[2] = max(fall[2], fall[1] - 0.5 * G * t * t)
        out[k] = cube
    return out


def _json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _episode(ep_dir: Path, scene: dict, *, cube_pos: np.ndarray | None, contact: np.ndarray | None) -> dict:
    """The twin's payload (app.routers.twin.episode_payload's shape) for one recorded episode, plus the cube's source
    and the arm's contact force per step (or null)."""
    meta = _json(ep_dir / "episode.json")
    with np.load(ep_dir / "steps.npz") as z:
        q, grip, ee = z["joint_pos"], z["gripper"], z["ee_pos"]
    n = int(meta["n_steps"])
    if q.shape != (n, len(JOINT_NAMES)) or grip.shape != (n,):
        raise ValueError(f"{ep_dir.name}: joint_pos {q.shape}, gripper {grip.shape}; expected ({n}, 9), ({n},)")
    cube, bin_ = scene["cube_pose"], scene["bin_pose"]
    source = "recorded"
    if cube_pos is None or len(cube_pos) != n:
        inner = [0.2, 0.2, 0.08]
        cube_pos = estimate_cube(ee.astype(np.float64), grip, np.asarray(cube["pos"]), bin_["pos"], inner, meta["fps"])
        source = "estimated"
    return {
        "demo_id": meta["demo_id"],
        "source": "isaac",
        "robot": meta["robot"],
        "fps": meta["fps"],
        "n_steps": n,
        "joint_names": list(JOINT_NAMES),
        "joint_pos": _round(q),
        "gripper": [int(g) for g in grip],
        "cube_pos": _round(cube_pos),
        "cube_quat": _round(cube["quat_wxyz"]),
        "bin": _round([*bin_["pos"], *bin_["quat_wxyz"]]),
        "base": BASE,
        "verified": None,
        "lineage": None,
        "cube_source": source,
        "contact_n": None if contact is None or len(contact) != n else _round(np.round(contact, 2)),
        # the hand's tool point as Isaac recorded it (steps.npz ee_pos), for the page's trail; mm is plenty for a line
        "hand_pos": (np.round(ee.astype(np.float64), 3) + 0.0).tolist(),
    }


def _facts(v: dict) -> dict:
    """SANT's verification of one run, as the page shows it."""
    return {
        "success": bool(v["success"]),
        "reasons": list(v.get("reasons") or []),
        "duration_s": v.get("duration"),
        "path_m": None if v.get("path_length") is None else round(v["path_length"], 3),
        "peak_contact_n": None if v.get("max_contact_force") is None else round(v["max_contact_force"], 2),
        "settle_s": None if v.get("settle_time") is None else round(v["settle_time"], 2),
    }


def build_teacher_eval(root: Path, sid: str, title: str, what: str, out: Path) -> dict:
    """A T3 eval folder: SANT's replay verification (verify.json) of the teacher's in-env runs (in_env.json)."""
    verify, in_env = _json(root / "verify.json"), _json(root / "in_env.json")
    runs = []
    for seed, verdict in sorted(verify["verdicts"].items(), key=lambda kv: int(kv[0])):
        ep_dir = root / "replay" / "episodes" / f"teacher_{seed}"
        ver = _json(ep_dir / "verification.json") if (ep_dir / "verification.json").is_file() else verdict
        signals = ep_dir / "signals.npz"
        cube = contact = None
        if signals.is_file():
            with np.load(signals) as z:
                cube, contact = z["cube_pos"], z["max_contact_force"]
        payload = _episode(ep_dir, _json(ep_dir / "scene.json"), cube_pos=cube, contact=contact)
        payload["facts"] = _facts(ver)
        rel = f"runs/{sid}/{seed}.json"
        _write(out / rel, payload)
        env = in_env.get("in_env", {}).get(seed, {})
        runs.append({
            "id": seed, "seed": int(seed), "recorded": True, "file": rel, **_facts(ver),
            "in_env": None if not env else bool(env.get("success")), "cube_source": payload["cube_source"],
        })
    s = verify["summary"]
    return {
        "id": sid, "title": title, "what": what, "checkpoint": in_env.get("checkpoint"),
        "seeds": [min(r["seed"] for r in runs), max(r["seed"] for r in runs)],
        "summary": {"successes": s["successes"], "n": s["n"], "ci95": [round(c, 4) for c in s["ci95"]], "judge": "SANT's physics replay"},
        "runs": runs,
    }


def build_round0(root: Path, sid: str, title: str, what: str, out: Path) -> dict:
    """T6's round 0: the teacher driving the distillation's rollouts. A failed rollout saved no episode."""
    rows = [json.loads(line) for line in (root / "rollouts.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    rnd = next(iter(sorted(root.glob("round_t*.json"))), None)
    info = _json(rnd) if rnd else {}
    runs = []
    for row in sorted(rows, key=lambda r: r["seed"]):
        seed = str(row["seed"])
        ep_dir = root / "episodes" / f"teacher_r0_{seed}"
        base = {"id": seed, "seed": row["seed"], "ended_by": row.get("ended_by"), "steps": row.get("steps")}
        if not (row.get("success") and (ep_dir / "steps.npz").is_file()):
            runs.append({**base, "recorded": False, "file": None, "success": bool(row.get("success")),
                         "reasons": list(row.get("reasons") or []), "duration_s": None, "path_m": None,
                         "peak_contact_n": None, "settle_s": None, "in_env": None, "cube_source": None})
            continue
        meta = _json(ep_dir / "episode.json")
        ver = (meta.get("passport") or {}).get("verification") or {"success": row["success"], "reasons": row.get("reasons")}
        payload = _episode(ep_dir, _json(ep_dir / "scene.json"), cube_pos=None, contact=None)
        payload["facts"] = _facts(ver)
        rel = f"runs/{sid}/{seed}.json"
        _write(out / rel, payload)
        runs.append({**base, "recorded": True, "file": rel, **_facts(ver), "in_env": None, "cube_source": payload["cube_source"]})
    k = sum(r["success"] for r in runs)
    return {
        "id": sid, "title": title, "what": what, "checkpoint": info.get("teacher_checkpoint"),
        "seeds": [min(r["seed"] for r in runs), max(r["seed"] for r in runs)],
        "summary": {"successes": k, "n": len(runs), "ci95": wilson(k, len(runs)), "judge": "SANT's check during the rollout"},
        "runs": runs,
    }


def _repo_on_path() -> None:
    """This worktree's own src and sim_eval first: a venv's editable .pth can point at another checkout's src."""
    for p in (str(REPO), str(REPO / "src")):
        while p in sys.path:
            sys.path.remove(p)
    sys.path[:0] = [str(REPO / "src"), str(REPO)]


def final_scene(seed: int) -> dict:
    """The scene the final test ran for this seed, as scene.json would hold it: run_eval's scene_plan takes its unseen
    scenes from sim_eval.scenes.eval_scenes, which is multiply.sample_scene with np.random.default_rng(seed)."""
    _repo_on_path()
    from sim_eval.scenes import eval_scenes

    return eval_scenes(1, seed)[0].model_dump(mode="json")


def judge_trace(arrays: dict, scene: dict, fps: int) -> dict:
    """SANT's check_success on a recorded trace against the scene's bin, exactly as the eval scored the episode
    (sim_eval.eval_policy._score over the same step records)."""
    _repo_on_path()
    from demo_pipeline.schemas import Scene
    from demo_pipeline.scene_geometry import BIN_INNER
    from sim_eval.eval_policy import StepRecord, _score

    a = arrays
    records = [
        StepRecord(tcp_pos=a["tcp_pos"][k], tcp_quat_wxyz=a["tcp_quat_wxyz"][k], cube_pos=a["cube_pos"][k],
                   gripper=int(a["gripper"][k]), contact_gripper_cube=bool(a["contact_gripper_cube"][k]),
                   contact_arm_bin=bool(a["contact_arm_bin"][k]), contact_arm_table=bool(a["contact_arm_table"][k]),
                   max_contact_force=float(a["max_contact_force"][k]))
        for k in range(len(a["gripper"]))
    ]
    return _score(records, Scene.model_validate(scene), BIN_INNER, fps).model_dump()


CONTACTS = {"gripper_cube": "contact_gripper_cube", "arm_bin": "contact_arm_bin", "arm_table": "contact_arm_table"}
TRACE_KEYS = ("joint_pos", "gripper", "tcp_pos", "tcp_quat_wxyz", "cube_pos", "cube_quat_wxyz", "max_contact_force", *CONTACTS.values())


def _spans(flags) -> list[list[int]]:
    """The steps where a flag is on, as [first, last + 1) ranges."""
    d = np.diff(np.concatenate([[0], np.asarray(flags, dtype=bool).astype(np.int8), [0]]))
    return [[int(a), int(b)] for a, b in zip(np.flatnonzero(d == 1), np.flatnonzero(d == -1))]


def build_final_test(root: Path, sid: str, title: str, what: str, out: Path, *, cell: str = FINAL_CELL,
                     scene_for=None, judge=None, seeds=None) -> dict:
    """The big test's final test: one replay per episode from its per-step trace, with the eval's own verdict.
    scene_for(seed) -> scene dict and judge(arrays, scene, fps) -> verification dict default to final_scene and
    judge_trace (looked up at call time, so tests can swap them). seeds: only these episodes (every one must be in
    the log); the eval's summary is then not cross-checked, since it counts them all."""
    scene_for = scene_for or final_scene
    judge = judge or judge_trace
    lines = [json.loads(line) for line in (root / f"{cell}.episodes.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    header = next((r["header"] for r in lines if "header" in r), {})
    eps = sorted((r["episode"] for r in lines if "episode" in r), key=lambda e: e["seed"])
    only = None if seeds is None else {int(s) for s in seeds}
    seeds = [e["seed"] for e in eps]
    if not eps or len(set(seeds)) != len(seeds):
        raise ValueError(f"{cell}: expected one episode per seed, got {seeds}")
    if only is not None:
        if missing := sorted(only - set(seeds)):
            raise ValueError(f"{cell}: no episode for seeds {missing}")
        eps = [e for e in eps if int(e["seed"]) in only]
        seeds = [e["seed"] for e in eps]
    traces = root / f"{cell}_traces"
    runs = []
    for ep in eps:
        seed = int(ep["seed"])
        meta = _json(traces / f"seed_{seed}.json")
        with np.load(traces / f"seed_{seed}.npz") as z:
            a = {k: np.asarray(z[k]) for k in TRACE_KEYS}
        n = len(a["gripper"])
        fps = int(meta.get("fps") or 50)
        if int(meta["seed"]) != seed or int(meta["n_steps"]) != n or int(ep["steps"]) != n:
            raise ValueError(f"seed {seed}: the trace says seed {meta['seed']}, {meta['n_steps']} steps, its arrays {n}; the log {ep['steps']}")
        if a["joint_pos"].shape != (n, len(JOINT_NAMES)) or any(len(a[k]) != n for k in TRACE_KEYS):
            raise ValueError(f"seed {seed}: the trace's arrays aren't all {n} steps long")
        if ep.get("final_cube_pos") is not None and not np.allclose(a["cube_pos"][-1], ep["final_cube_pos"], atol=1e-5):
            raise ValueError(f"seed {seed}: the trace's last cube position isn't the one the log recorded")
        scene = scene_for(seed)
        v = judge(a, scene, fps)
        if bool(v["success"]) != bool(ep["success"]) or sorted(v["reasons"]) != sorted(ep["reasons"]):
            raise ValueError(f"seed {seed}: re-judging the trace gives {v['success']} {v['reasons']}, the log {ep['success']} {ep['reasons']}: "
                             "the bin or the trace is not the one the eval used")
        facts = {
            "success": bool(ep["success"]),
            "reasons": list(ep["reasons"]),
            "duration_s": ep.get("sim_s"),
            "path_m": round(v["path_length"], 3),
            "peak_contact_n": round(v["max_contact_force"], 2),
            "settle_s": None if v.get("settle_time") is None else round(v["settle_time"], 2),
        }
        cube, bin_ = scene["cube_pose"], scene["bin_pose"]
        payload = {
            "demo_id": f"{cell}_{seed}",
            "source": "isaac",
            "robot": scene.get("robot", "franka"),
            "fps": fps,
            "n_steps": n,
            "joint_names": list(JOINT_NAMES),
            "joint_pos": _round(a["joint_pos"]),
            "gripper": [int(g) for g in a["gripper"]],
            "cube_pos": _round(a["cube_pos"]),
            "cube_quat": _round(cube["quat_wxyz"]),
            "bin": _round([*bin_["pos"], *bin_["quat_wxyz"]]),
            "base": BASE,
            "verified": bool(ep["success"]),
            "lineage": None,
            "cube_source": "recorded",
            "contact_n": _round(np.round(a["max_contact_force"], 2)),
            "hand_pos": (np.round(a["tcp_pos"].astype(np.float64), 3) + 0.0).tolist(),
            "cube_quat_path": (np.round(a["cube_quat_wxyz"].astype(np.float64), 3) + 0.0).tolist(),
            "contacts": {name: _spans(a[key]) for name, key in CONTACTS.items()},
            "facts": facts,
        }
        rel = f"runs/{sid}/{seed}.json"
        _write(out / rel, payload)
        runs.append({"id": str(seed), "seed": seed, "recorded": True, "file": rel, **facts, "in_env": None,
                     "cube_source": "recorded", "ended_by": ep.get("ended_by"), "steps": n})
    k = sum(r["success"] for r in runs)
    summary_file = root / f"{cell}.json"
    if only is None and summary_file.is_file():  # the eval's own summary must count the same
        s = _json(summary_file).get("summary") or {}
        if (s.get("successes"), s.get("n")) != (k, len(runs)):
            raise ValueError(f"{summary_file.name} says {s.get('successes')}/{s.get('n')}, the episode log {k}/{len(runs)}")
    return {
        "id": sid, "title": f"{title} · {k}/{len(runs)}", "what": what, "checkpoint": header.get("checkpoint"),
        "seeds": [min(seeds), max(seeds)],
        "summary": {"successes": k, "n": len(runs), "ci95": wilson(k, len(runs)), "judge": "SANT's check_success, as each run ran"},
        "note": ("Every pose is the run's own trace, recorded by Isaac at 50 Hz. The trace doesn't hold the bin, so its spot is "
                 "re-made from the scene's seed with the eval's own scene sampler; judging each trace again against it gives "
                 "the same verdict and reasons the eval logged, for all of them."),
        "runs": runs,
    }


def _write(path: Path, body) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(body, separators=(",", ":")), encoding="utf-8", newline="\n")


def check_estimate(roots: list[Path]) -> dict:
    """How far the gripper-based cube estimate lands from the recorded cube, over runs that recorded both: while
    carried (first close to last open) and after the release (where it lands)."""
    held, landed, n = [], [], 0
    for root in roots:
        for ep_dir in sorted((root / "replay" / "episodes").glob("teacher_*")):
            if not (ep_dir / "signals.npz").is_file():
                continue
            scene, meta = _json(ep_dir / "scene.json"), _json(ep_dir / "episode.json")
            with np.load(ep_dir / "steps.npz") as z, np.load(ep_dir / "signals.npz") as s:
                grip = z["gripper"]
                est = estimate_cube(z["ee_pos"].astype(np.float64), grip, np.asarray(scene["cube_pose"]["pos"]),
                                    scene["bin_pose"]["pos"], [0.2, 0.2, 0.08], meta["fps"])
                d = np.linalg.norm(est - s["cube_pos"], axis=1)
            changes = np.flatnonzero(np.diff(grip.astype(np.int16))) + 1
            if len(changes) < 2:
                continue
            n += 1
            held.append(d[changes[0]:changes[-1]])
            landed.append(d[-1])
    if not n:
        return {"episodes": 0}
    h = np.concatenate(held)
    mm = lambda v: round(float(v) * 1000, 1)  # noqa: E731
    return {"episodes": n, "held_median_mm": mm(np.median(h)), "held_p95_mm": mm(np.percentile(h, 95)),
            "landed_median_mm": mm(np.median(landed)), "landed_max_mm": mm(max(landed))}


def build(gate: Path | None, replay_check: Path | None, round0: Path | None, out: Path, final: Path | None = None) -> dict:
    sources = []
    if final:  # first: the page opens on it
        sources.append(build_final_test(
            final, "final-test-v2", "The final test",
            "The camera policy that passed the pre-registered test: 40 scenes it had never seen (seeds 5400–5439), run once. "
            "It sees only its cameras and its joints; SANT judged every run as it ran.",
            out, scene_for=final_scene, judge=judge_trace))
    if gate:
        sources.append(build_teacher_eval(
            gate, "teacher-gate", "Teacher · gate 2",
            "The RL teacher's 50 fresh-scene runs that decided the gate. Each run's path was re-run with physics and judged by SANT.",
            out))
    if replay_check:
        sources.append(build_teacher_eval(
            replay_check, "teacher-replay-check", "Teacher · replay check",
            "32 more runs on seeds outside the gate, to check that SANT's physics replay agrees with the teacher's own episodes.",
            out))
    if round0:
        r0 = build_round0(
            round0, "distill-r0", "Distillation · round 0",
            "The teacher driving round 0 of the distillation, with cameras on. The verified runs became the camera robot's training data.",
            out)
        # Its cube is estimated: say how far off that estimate is where the cube was recorded.
        r0["cube_estimate"] = check_estimate([p for p in (gate, replay_check) if p]) if (gate or replay_check) else None
        sources.append(r0)
    index = {"built": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "sources": sources}
    _write(out / "index.json", index)
    return index


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--final", type=Path, default=FINAL, help="the big test's eval folder (bigtest_final.*)")
    ap.add_argument("--gate", type=Path, default=GATE)
    ap.add_argument("--replay-check", type=Path, default=REPLAY_CHECK)
    ap.add_argument("--round0", type=Path, default=ROUND0)
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--check-estimate", action="store_true", help="measure the round-0 cube estimate on recorded runs; writes nothing")
    a = ap.parse_args(argv)
    found = [p if p and p.is_dir() else None for p in (a.gate, a.replay_check, a.round0)]
    if a.check_estimate:
        print(json.dumps(check_estimate([p for p in found[:2] if p]), indent=1))
        return 0
    final = a.final if a.final and (a.final / f"{FINAL_CELL}.episodes.jsonl").is_file() else None
    for name, p, f in zip(("final", "gate", "replay-check", "round0"), (a.final, a.gate, a.replay_check, a.round0), (final, *found)):
        if f is None:
            print(f"skipped {name}: {p} is not a folder with its runs", file=sys.stderr)
    index = build(*found, a.out, final=final)
    for s in index["sources"]:
        rec = sum(r["recorded"] for r in s["runs"])
        print(f"{s['id']}: {s['summary']['successes']}/{s['summary']['n']} verified, {rec} replays")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
