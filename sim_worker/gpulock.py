"""The shared GPU lock (C:\\dev\\gpu.lock): one heavy GPU job at a time across the terminals.

Protocol: before any Isaac or training run, read the lock. If it exists and the PID in it is alive, wait and re-check
every 5 min. Otherwise write "<terminal> <PID> <task> <time>" into it, and delete it when the run ends, even on
failure. A lock whose PID is dead is stale and replaced; one that can't be parsed is treated as held (a human must
look). Also wait while the GPU is busy without a lock, e.g. a Blender render: a render next to Isaac crashed the PC
on 2026-10-18.

    with GpuLock(task="overnight-recovery"):
        ...  # the GPU is ours
"""

from __future__ import annotations

import os
import subprocess
import time
from collections.abc import Callable
from datetime import datetime
from pathlib import Path

LOCK_PATH = Path(r"C:\dev\gpu.lock")
POLL_S = 300


def lock_text(terminal: str, pid: int, task: str, when: str) -> str:
    return f"{terminal} {pid} {task} {when}"


def parse_lock(text: str) -> tuple[str | None, int | None]:
    parts = text.split()
    try:
        return parts[0], int(parts[1])
    except (IndexError, ValueError):
        return None, None


def pid_alive(pid: int) -> bool:
    import psutil

    return psutil.pid_exists(pid)


def gpu_busy() -> list[str]:
    """Reasons the GPU looks busy without a lock: >= 30% utilisation in 3 samples, or blender.exe using CPU."""
    import psutil

    utils = []
    for _ in range(3):
        try:
            out = subprocess.run(["nvidia-smi", "--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"],
                                 capture_output=True, text=True, timeout=10).stdout
            utils.append(int(out.split()[0]))
        except (OSError, ValueError, IndexError, subprocess.SubprocessError):
            utils.append(0)
        time.sleep(2)
    blender = 0.0
    for p in psutil.process_iter(["name"]):
        if (p.info["name"] or "").lower() == "blender.exe":
            try:
                blender += p.cpu_percent(interval=1.0)
            except psutil.Error:
                pass
    reasons = []
    if min(utils) >= 30:
        reasons.append(f"GPU utilisation {utils}%")
    if blender > 20:
        reasons.append(f"blender.exe at {blender:.0f}% CPU")
    return reasons


class GpuLock:
    def __init__(self, path: Path = LOCK_PATH, *, task: str, terminal: str = "T3", pid: int | None = None,
                 pid_alive: Callable[[int], bool] = pid_alive, gpu_busy: Callable[[], list[str]] = gpu_busy,
                 sleep: Callable[[float], None] = time.sleep, clock: Callable[[], float] = time.time,
                 poll_s: float = POLL_S, max_wait_s: float | None = None, log: Callable[[str], None] = print):
        self.path, self.task, self.terminal = Path(path), task, terminal
        self.pid = os.getpid() if pid is None else pid
        self._alive, self._busy, self._sleep, self._clock = pid_alive, gpu_busy, sleep, clock
        self.poll_s, self.max_wait_s, self.log = poll_s, max_wait_s, log
        self.text: str | None = None

    def _wait_reason(self) -> str | None:
        try:
            held = self.path.read_text(encoding="utf-8").strip()
        except FileNotFoundError:
            held = None
        if held is not None:
            _, pid = parse_lock(held)
            if pid is None:
                return f"unreadable lock {held!r}"
            if self._alive(pid):
                return f"lock held by live PID {pid}: {held!r}"
            self.log(f"[gpulock] stale lock (PID {pid} is dead): {held!r}; replacing")
            self.path.unlink(missing_ok=True)
        busy = self._busy()
        return f"GPU busy: {'; '.join(busy)}" if busy else None

    def acquire(self) -> str:
        t0 = self._clock()
        while True:
            reason = self._wait_reason()
            if reason is None:
                text = lock_text(self.terminal, self.pid, self.task, datetime.now().isoformat(timespec="seconds"))
                try:
                    fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                except FileExistsError:
                    continue  # someone took it between the check and the write
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    f.write(text + "\n")
                self.text = text
                self.log(f"[gpulock] taken: {text!r}")
                return text
            if self.max_wait_s is not None and self._clock() - t0 >= self.max_wait_s:
                raise TimeoutError(f"GPU lock not free after {self.max_wait_s:.0f} s: {reason}")
            self.log(f"[gpulock] {reason}; re-check in {self.poll_s / 60:.0f} min")
            self._sleep(self.poll_s)

    def release(self) -> None:
        if self.text is None:
            return
        try:
            if self.path.read_text(encoding="utf-8").strip() == self.text:
                self.path.unlink()
                self.log("[gpulock] released")
            else:
                self.log("[gpulock] the lock is no longer ours; left in place")
        except FileNotFoundError:
            self.log("[gpulock] the lock was already gone")
        self.text = None

    def __enter__(self) -> "GpuLock":
        self.acquire()
        return self

    def __exit__(self, *exc) -> None:
        self.release()
