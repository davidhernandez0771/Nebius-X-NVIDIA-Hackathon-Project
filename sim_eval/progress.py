"""Resumable evals: an append-only per-episode log (JSON lines), so a run killed mid-way (Windows sleep killed CUDA
in T2's batch, 2026-10-16) resumes at the next unfinished seed instead of starting over.

    line 1:  {"header": {"checkpoint": ..., "seed0": ..., "max_seconds": ..., "cameras": ..., "reset_pose": ..., ...}}
    then:    {"episode": <EpisodeResult>}      one per finished episode, flushed + fsynced

On resume the header must describe the same run (RESUME_KEYS); `n` may grow, since scene i depends only on its seed.
Episodes that ended in sim_error or policy_error are infrastructure failures, not policy results, so they are run
again. A torn last line (the process died mid-write) is ignored.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from demo_pipeline.schemas import Scene
from sim_eval.results import EpisodeResult

# inference: lerobot_tools.inference options (None for a default eval, and in logs written before they existed)
RESUME_KEYS = ("checkpoint", "seed0", "max_seconds", "cameras", "reset_pose", "inference")
RERUN_ON_RESUME = ("sim_error", "policy_error")


class EpisodeLog:
    def __init__(self, path: Path):
        self.path = Path(path)

    @classmethod
    def open(cls, path: Path, header: dict, *, resume: bool) -> tuple[EpisodeLog, list[EpisodeResult]]:
        """Start a log, or (resume=True) continue one. Returns the log and the episodes already finished."""
        path = Path(path)
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            cls(path)._write({"header": header})
            return cls(path), []
        if not resume:
            raise FileExistsError(f"{path} exists; pass --resume to continue that run")
        lines = path.read_text(encoding="utf-8").splitlines()
        old = json.loads(lines[0])["header"]
        diff = [k for k in RESUME_KEYS if old.get(k) != header.get(k)]
        if diff:
            raise ValueError(f"{path} is a different run: " + "; ".join(
                f"{k} was {old.get(k)!r}, now {header.get(k)!r}" for k in diff))
        latest: dict[int, EpisodeResult] = {}
        for i, line in enumerate(lines[1:], start=1):
            try:
                ep = EpisodeResult.model_validate(json.loads(line)["episode"])
            except (ValueError, KeyError):
                if i != len(lines) - 1:
                    raise
                # torn last line: drop it, so later appends and resumes see a clean file
                tmp = path.with_name(path.name + ".tmp")
                tmp.write_text("".join(x + "\n" for x in lines[:-1]), encoding="utf-8")
                os.replace(tmp, path)
                break
            latest[ep.seed] = ep
        done = [ep for _, ep in sorted(latest.items()) if ep.ended_by not in RERUN_ON_RESUME]
        return cls(path), done

    def _write(self, record: dict) -> None:
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
            f.flush()
            os.fsync(f.fileno())

    def append(self, ep: EpisodeResult) -> None:
        self._write({"episode": ep.model_dump()})


def remaining(scenes: list[Scene], done: list[EpisodeResult]) -> list[Scene]:
    """The scenes whose seed has no finished episode yet, in order."""
    seeds = {s.seed for s in scenes}
    stray = sorted(e.seed for e in done if e.seed not in seeds)
    if stray:
        raise ValueError(f"the log has episodes for seeds {stray} outside this run's scenes")
    finished = {e.seed for e in done}
    return [s for s in scenes if s.seed not in finished]
