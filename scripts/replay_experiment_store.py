"""Play a finished human-demo experiment back into a new data folder at its own pace, sped up, so the data showcase's
live mode (GET /showcase/live/{name}) can be watched and tested without the GPU or Isaac.

    uv run python scripts/replay_experiment_store.py --src C:/dev/pm-t6/data/human_exp/mouse20261020 \
        --data C:/dev/pm-t2/data/showcase-replay --name mouse_replay --speed 30 --live-from C:/dev/pm-t6/data/demos

Every file of the source lands at <data>/human_exp/<name>/<same path> when its modification time comes round, and
run.log is rewritten line by line at the times its lines carry, so stages, verdicts and variant folders appear in the
order and with the gaps they did (divided by --speed). The demos' live recordings (--live-from/<id>) are put in
<data>/demos/ first. Large files (frames, arrays, video) are hard links to the source, not copies: read them only.
The source is never written. It refuses a destination that already holds the experiment.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable

LINKED = {".png", ".npz", ".webm", ".mp4", ".jpg"}
SKIPPED_DIRS = {"logs"}  # the worker's and trainer's own logs: big, and the page doesn't read them
_TIME = re.compile(r"\[human-exp (\d\d):(\d\d):(\d\d)\]")


@dataclass(frozen=True)
class Step:
    at: float  # seconds after the start
    kind: str  # "file" (copy or link src to rel) or "log" (append line to rel)
    rel: str  # the destination, relative to the data folder
    src: Path | None = None
    line: str = ""


def _files(root: Path) -> list[Path]:
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if Path(dirpath) != root or d not in SKIPPED_DIRS)
        out += [Path(dirpath) / f for f in sorted(filenames)]
    return out


def plan(src: Path, live_dirs: list[Path] = ()) -> list[Step]:
    """Every step of the playback, in order."""
    src = Path(src)
    exp = f"human_exp/{src.name}"
    files = [p for p in _files(src) if p != src / "run.log"]
    lines = (src / "run.log").read_text(encoding="utf-8", errors="replace").splitlines() if (src / "run.log").is_file() else []
    mtimes = {p: p.stat().st_mtime for p in files}
    start = min(mtimes.values(), default=time.time())
    day = datetime.fromtimestamp(start).replace(hour=0, minute=0, second=0, microsecond=0)

    # Log lines at the times they carry (the day of the first file; a jump back over midnight is the next day).
    stamped, prev = [], None
    for line in lines:
        m = _TIME.match(line)
        if m:
            t = day + timedelta(hours=int(m[1]), minutes=int(m[2]), seconds=int(m[3]))
            while prev is not None and t < prev - timedelta(hours=12):
                t += timedelta(days=1)
            t = max(t, prev) if prev is not None else t
        else:
            t = prev if prev is not None else day.fromtimestamp(start)
        prev = t
        stamped.append((t.timestamp(), line))
    if stamped:
        start = min(start, stamped[0][0])

    steps = [Step(0.0, "file", f"demos/{d.name}/{p.relative_to(d).as_posix()}", p)
             for d in live_dirs for p in _files(Path(d))]
    timed = [Step(mtimes[p] - start, "file", f"{exp}/{p.relative_to(src).as_posix()}", p) for p in files]
    timed += [Step(t - start, "log", f"{exp}/run.log", line=line) for t, line in stamped]
    # Stable: at equal times files go before the log line that reports them.
    timed.sort(key=lambda s: (s.at, s.kind == "log"))
    return steps + timed


def _put(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.suffix.lower() in LINKED:
        try:
            os.link(src, dst)
            return
        except OSError:
            pass
    shutil.copy2(src, dst)


def run(steps: list[Step], data: Path, speed: float, sleep: Callable[[float], None] = time.sleep,
        say: Callable[[str], None] = lambda s: None) -> None:
    data = Path(data)
    now = 0.0
    for s in steps:
        if s.at > now:
            sleep((s.at - now) / speed)
            now = s.at
        dst = data / s.rel
        if s.kind == "file":
            _put(s.src, dst)
        else:
            dst.parent.mkdir(parents=True, exist_ok=True)
            with open(dst, "a", encoding="utf-8") as f:
                f.write(s.line + "\n")
            say(s.line)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--src", type=Path, required=True, help="a finished experiment, DATA_DIR/human_exp/<name>")
    ap.add_argument("--data", type=Path, required=True, help="the data folder to play it into (the backend's DATA_DIR)")
    ap.add_argument("--name", help="the experiment's name there (default: the source's)")
    ap.add_argument("--speed", type=float, default=30.0, help="how many times faster than it ran (default 30)")
    ap.add_argument("--live-from", type=Path, help="the main store's demos/ folder, for the live recordings")
    a = ap.parse_args(argv)
    name = a.name or a.src.name
    dest = a.data / "human_exp" / name
    if dest.exists():
        sys.exit(f"{dest} already exists: pick another --name or --data")
    if not (a.src / "config.json").is_file():
        sys.exit(f"{a.src} isn't an experiment (no config.json)")
    ids = json.loads((a.src / "config.json").read_text(encoding="utf-8")).get("ids", [])
    live = [a.live_from / i for i in ids if a.live_from and (a.live_from / i).is_dir()]
    steps = plan(a.src, live)
    if name != a.src.name:
        old, new = f"human_exp/{a.src.name}/", f"human_exp/{name}/"
        steps = [Step(s.at, s.kind, new + s.rel[len(old):] if s.rel.startswith(old) else s.rel, s.src, s.line) for s in steps]
    total = steps[-1].at / a.speed if steps else 0
    print(f"replaying {a.src} into {dest}: {len(steps)} steps over {total:.0f} s", flush=True)
    run(steps, a.data, a.speed, say=lambda line: print(line, flush=True))
    print("done", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
