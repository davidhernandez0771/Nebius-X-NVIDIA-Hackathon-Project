"""The site's pipeline runs: each wraps one scripts/run_human_demo_experiment.py process, one at a time in a FIFO queue,
and is exported at the end (app.pipeline.export). A run lives in DATA_DIR/pipeline/runs/<id>/ (run.json, runner.log,
artifacts/); its experiment in DATA_DIR/human_exp/<id>/, where the showcase reads it too.

GPU: the runner takes C:\\dev\\gpu.lock before each GPU stage (sim, train, eval) and waits while anyone else holds it;
here only one run is active, so the site never starts a second Isaac process; the rest wait in the queue.

States: queued -> running -> done | failed (stopped; resumable) | refused (bad selection or settings) | cancelled
(resumable) | interrupted (the runner died, or the backend restarted without it; resumable). Cancel writes
<experiment>/STOP: the runner stops before its next stage. How a run ended is read from its run.log ("done through",
"REFUSED:", "STOPPED:"), so a runner this backend didn't start (a restart) is still read right.
"""
from __future__ import annotations

import json
import os
import re
import secrets
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from app.config import REPO_ROOT
from demo_pipeline.store import write_atomic

from .progress import snapshot
from .recipe import Recipe, runner_args
from .timings import Timings, learn

RUNNER = REPO_ROOT / "scripts" / "run_human_demo_experiment.py"
STOP_FILE = "STOP"  # the runner's (scripts/run_human_demo_experiment.py STOP_FILE)
LOCK_PATH = Path(r"C:\dev\gpu.lock")
ACTIVE = ("running", "cancelling")
RESUMABLE = ("failed", "cancelled", "interrupted")
_RESULT = re.compile(r"\[human-exp \d\d:\d\d:\d\d\] (done through '(\w+)'|REFUSED: (.*)|STOPPED: (.*))$")


def popen_launch(cmd: list[str], log_path: Path, env: dict):
    log_path.parent.mkdir(parents=True, exist_ok=True)
    f = log_path.open("a", encoding="utf-8")
    f.write(f"\n=== {datetime.now(timezone.utc).isoformat(timespec='seconds')} {' '.join(cmd)}\n")
    f.flush()
    return subprocess.Popen(cmd, cwd=REPO_ROOT, env=env, stdout=f, stderr=subprocess.STDOUT)


def windows_pid_alive(pid: int) -> bool:
    if sys.platform != "win32":
        try:
            os.kill(pid, 0)  # POSIX only: on Windows this would terminate the process
            return True
        except OSError:
            return False
    import ctypes

    k32 = ctypes.windll.kernel32
    h = k32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return False
    code = ctypes.c_ulong()
    ok = k32.GetExitCodeProcess(h, ctypes.byref(code))
    k32.CloseHandle(h)
    return bool(ok) and code.value == 259  # STILL_ACTIVE


def read_lock() -> str | None:
    try:
        return LOCK_PATH.read_text(encoding="utf-8").strip() or None
    except OSError:
        return None


def count_selection(data: Path) -> Callable[[Recipe], int]:
    """How many demos a recipe selects, by the runner's own rule (sim_worker.human_exp.select_ids)."""
    def count(r: Recipe) -> int:
        if str(REPO_ROOT) not in sys.path:
            sys.path.insert(0, str(REPO_ROOT))
        from demo_pipeline.store import DemoStore
        from sim_worker.human_exp import select_ids

        return len(select_ids(DemoStore(data), ids=r.ids, tag=r.tag, input=r.input))
    return count


def default_export(run: dict, data: Path, out: Path) -> list[dict]:
    from functools import partial

    from .export import assemble_in_lerobot_venv, build_artifacts, git_commit, robota_export

    return build_artifacts(run, data=data, out=out, robota=partial(robota_export, nemotron=bool(run["recipe"].get("nemotron"))),
                           assemble=assemble_in_lerobot_venv, commit=git_commit())


class RunManager:
    def __init__(self, data: Path, *, launch=popen_launch, export: Callable[[dict, Path, Path], list[dict]] = default_export,
                 now: Callable[[], float] = time.time, count_demos: Callable[[Recipe], int] | None = None,
                 pid_alive: Callable[[int], bool] = windows_pid_alive, lock_text: Callable[[], str | None] = read_lock,
                 python: str = sys.executable, timings: Callable[[Path], Timings] = learn):
        self.data = Path(data)
        self.root = self.data / "pipeline" / "runs"
        self.launch, self.export, self.now = launch, export, now
        self.count_demos = count_demos or count_selection(self.data)
        self.pid_alive, self.lock_text, self.python = pid_alive, lock_text, python
        self._learn = timings
        self._timings = timings(self.data)
        self._procs: dict[str, object] = {}
        self._lock = threading.RLock()
        # A restart: a run still marked active keeps its runner if that process is alive; else it was interrupted.
        for run in self.list():
            if run["status"] in ACTIVE and not (run.get("pid") and self.pid_alive(run["pid"])):
                self._finish(run, None)

    # --- the records ------------------------------------------------------------------------------------
    def _path(self, run_id: str) -> Path:
        return self.root / run_id / "run.json"

    def _save(self, run: dict) -> dict:
        write_atomic(self._path(run["id"]), json.dumps(run, indent=1))
        return run

    def get(self, run_id: str) -> dict:
        try:
            return json.loads(self._path(run_id).read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            raise KeyError(run_id) from e

    def list(self) -> list[dict]:
        out = []
        for p in sorted(self.root.glob("*/run.json")):
            try:
                out.append(json.loads(p.read_text(encoding="utf-8")))
            except (OSError, ValueError):
                continue
        return sorted(out, key=lambda r: (r.get("seq", 0), r["created"]))  # the queue order

    def position(self, run_id: str) -> int | None:
        """Its place in the queue behind other runs (1: next), or None when it isn't queued."""
        queued = [r["id"] for r in self.list() if r["status"] == "queued"]
        return queued.index(run_id) + 1 if run_id in queued else None

    def exp_root(self, run_id: str) -> Path:
        return self.data / "human_exp" / run_id

    # --- the API ------------------------------------------------------------------------------------------
    def create(self, recipe: Recipe, name: str | None = None) -> dict:
        n = self.count_demos(recipe)  # ValueError: nothing queued
        stamp = datetime.fromtimestamp(self.now(), timezone.utc)
        run_id = f"pl_{stamp:%Y%m%d_%H%M%S}_{secrets.token_hex(2)}"
        recipe_d = recipe.model_dump() | {"steps": recipe.steps, "eval_n": recipe.eval_seeds}
        seq = max((r.get("seq", 0) for r in self.list()), default=0) + 1
        run = {"id": run_id, "seq": seq, "name": name or run_id, "created": stamp.isoformat(timespec="seconds"), "status": "queued",
               "detail": None, "resumable": False, "recipe": recipe_d, "args": runner_args(recipe, run_id), "n_demos": n,
               "pid": None, "started_at": None, "finished_at": None, "stage_times": {}, "export": None}
        with self._lock:
            return self._save(run)

    def cancel(self, run_id: str) -> dict:
        with self._lock:
            run = self.get(run_id)
            if run["status"] == "queued":
                run.update(status="cancelled", resumable=True, detail="cancelled before it started", finished_at=self.now())
            elif run["status"] == "running":
                stop = self.exp_root(run_id) / STOP_FILE
                stop.parent.mkdir(parents=True, exist_ok=True)
                stop.write_text("cancelled from the site\n", encoding="utf-8")
                run.update(status="cancelling", detail="stopping before the next stage")
            return self._save(run)

    def resume(self, run_id: str) -> dict:
        with self._lock:
            run = self.get(run_id)
            if run["status"] not in RESUMABLE:
                raise ValueError(f"run {run_id} is {run['status']}: only a failed, cancelled or interrupted run resumes")
            (self.exp_root(run_id) / STOP_FILE).unlink(missing_ok=True)
            run.update(status="queued", detail="resumed: carries on from the last finished step", resumable=False,
                       finished_at=None)
            return self._save(run)

    def snapshot(self, run_id: str) -> dict:
        run = self.get(run_id)
        return snapshot(run, data=self.data, timings=self._timings, now=self.now(), lock=self.lock_text(),
                        position=self.position(run_id))

    def timings(self) -> Timings:
        return self._timings

    # --- the loop -----------------------------------------------------------------------------------------
    def tick(self) -> None:
        """Advance: read the active run, finish it if its runner ended, start the next queued run."""
        with self._lock:
            for run in self.list():
                if run["status"] in ACTIVE:
                    self._poll(run)
            if not any(r["status"] in ACTIVE for r in self.list()):
                nxt = next((r for r in self.list() if r["status"] == "queued"), None)
                if nxt is not None:
                    self._start(nxt)

    def _start(self, run: dict) -> None:
        env = {k: v for k, v in os.environ.items() if k != "VIRTUAL_ENV"}
        env.update(DATA_DIR=str(self.data), PYTHONPATH=f"{REPO_ROOT / 'src'}{os.pathsep}{REPO_ROOT}", PYTHONUNBUFFERED="1")
        cmd = [self.python, str(RUNNER), *run["args"]]
        proc = self.launch(cmd, self.root / run["id"] / "runner.log", env)
        self._procs[run["id"]] = proc
        run.update(status="running", pid=getattr(proc, "pid", None), started_at=run.get("started_at") or self.now(),
                   detail=None)
        self._save(run)

    def _poll(self, run: dict) -> None:
        proc = self._procs.get(run["id"])
        if proc is not None:
            rc = proc.poll()
            ended = rc is not None
        else:  # adopted after a restart: alive or not is all we know
            rc = None
            ended = not (run.get("pid") and self.pid_alive(run["pid"]))
        if ended:
            self._procs.pop(run["id"], None)
            self._finish(run, rc)
        else:
            self._record_stages(run)

    def _record_stages(self, run: dict) -> None:
        snap = snapshot(run, data=self.data, timings=self._timings, now=self.now(), lock=None, position=None)
        times = run.setdefault("stage_times", {})
        changed = False
        for st in snap["stages"]:
            t = times.get(st["id"])
            if st["status"] == "running" and t is None:
                times[st["id"]] = [self.now(), None]
                changed = True
            elif st["status"] == "done":
                if t is None:
                    times[st["id"]] = [self.now(), self.now()]
                    changed = True
                elif t[1] is None:
                    t[1] = self.now()
                    changed = True
        if changed:
            self._save(run)

    def _result(self, run_id: str) -> tuple[str | None, str | None]:
        """The runner's last word in run.log: ("done", stage) | ("refused", why) | ("stopped", why) | (None, None)."""
        try:
            lines = (self.exp_root(run_id) / "run.log").read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            return None, None
        for line in reversed(lines):
            m = _RESULT.match(line.strip())
            if m:
                if m.group(2):
                    return "done", m.group(2)
                return ("refused", m.group(3)) if m.group(3) else ("stopped", m.group(4))
        return None, None

    def _runner_tail(self, run_id: str) -> str:
        try:
            text = (self.root / run_id / "runner.log").read_text(encoding="utf-8", errors="replace").strip()
        except OSError:
            return ""
        return text.splitlines()[-1][-300:] if text else ""

    def _finish(self, run: dict, rc: int | None) -> None:
        self._record_stages(run)
        kind, what = self._result(run["id"])
        recipe = run["recipe"]
        cancelling = run["status"] == "cancelling" or (self.exp_root(run["id"]) / STOP_FILE).is_file()
        now = self.now()
        if kind == "done" and (rc in (0, None)):
            if recipe.get("dry_run"):
                snap = snapshot({**run, "status": "done"}, data=self.data, timings=self._timings, now=now, lock=None,
                                position=None)
                hours = (snap.get("plan_s") or 0) / 3600
                run.update(status="done", finished_at=now, resumable=False,
                           detail=f"dry run: {snap['demos']} demos selected; the full run would take about {hours:.1f} h")
            else:
                self._export(run)
                return
        elif kind == "refused":
            run.update(status="refused", detail=f"refused: {what}", resumable=False, finished_at=now)
        elif cancelling:
            run.update(status="cancelled", detail="cancelled at a stage boundary; resume carries on", resumable=True,
                       finished_at=now)
        elif kind == "stopped":
            run.update(status="failed", detail=f"stopped: {what}", resumable=True, finished_at=now)
        elif rc is None:
            run.update(status="interrupted", detail="the runner ended without a result (a backend restart, or it was "
                                                   "killed); resume carries on", resumable=True, finished_at=now)
        else:
            run.update(status="failed", detail=f"the runner exited {rc}: {self._runner_tail(run['id'])}", resumable=True,
                       finished_at=now)
        self._save(run)

    def _export(self, run: dict) -> None:
        run["export"] = {"status": "running", "artifacts": [], "detail": "exporting"}
        times = run.setdefault("stage_times", {})
        times["export"] = [self.now(), None]
        self._save(run)
        try:
            arts = self.export(run, self.data, self.root / run["id"] / "artifacts")
            run["export"] = {"status": "done", "artifacts": arts, "done": len(arts), "total": len(arts), "detail": "ready"}
            run.update(status="done", detail=None, resumable=False)
        except Exception as e:  # noqa: BLE001: the run's data is there; only the downloads failed
            run["export"] = {"status": "failed", "artifacts": [], "detail": f"{type(e).__name__}: {e}"}
            run.update(status="failed", detail=f"export failed: {type(e).__name__}: {e}", resumable=True)
        times["export"][1] = self.now()
        run["finished_at"] = self.now()
        self._save(run)
        self._timings = self._learn(self.data)  # the finished run's own times count from now on
        write_atomic(self.data / "pipeline" / "timings.json", json.dumps(self._timings.to_dict(), indent=1))

