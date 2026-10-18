"""The GPU lock shared by every terminal on this machine: one file, C:\\dev\\gpu.lock, "<owner> <pid> <task> <time>".

Before any Isaac or training run: read the file. If it names a process that is still alive, wait and re-check
every 5 minutes. Otherwise write our own line, and delete the file when the run ends, even on failure. The file
is created with O_CREAT | O_EXCL, so two terminals that both find it free can't both win; a stale one (dead PID,
or a line that doesn't parse) is removed first. On exit, the file is deleted only while it still holds our line.

Liveness uses OpenProcess + GetExitCodeProcess on Windows. Never os.kill(pid, 0) there: on Windows it calls
TerminateProcess. Pure apart from pid_alive; the clock, sleep and liveness are injected for tests.
"""

from __future__ import annotations

import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Callable

LOCK_PATH = Path(r"C:\dev\gpu.lock")
POLL_S = 300  # re-check a live lock every 5 min
STILL_ACTIVE = 259


@dataclass(frozen=True)
class LockInfo:
    owner: str
    pid: int
    task: str
    when: str


def format_lock(owner: str, pid: int, task: str, when: datetime) -> str:
    if any(c.isspace() for c in owner + task):
        raise ValueError("owner and task may not contain spaces")
    return f"{owner} {pid} {task} {when.isoformat(timespec='seconds')}\n"


def parse_lock(text: str) -> LockInfo | None:
    parts = text.split()
    if len(parts) < 4 or not parts[1].isdigit():
        return None
    return LockInfo(owner=parts[0], pid=int(parts[1]), task=parts[2], when=" ".join(parts[3:]))


def pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if sys.platform != "win32":
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        return True
    import ctypes
    from ctypes import wintypes

    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.OpenProcess.restype = wintypes.HANDLE
    k32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    handle = k32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return ctypes.get_last_error() == 5  # ERROR_ACCESS_DENIED: it exists, we just can't open it
    try:
        code = wintypes.DWORD()
        if not k32.GetExitCodeProcess(handle, ctypes.byref(code)):
            return True
        return code.value == STILL_ACTIVE
    finally:
        k32.CloseHandle(handle)


class GpuLock:
    def __init__(self, path: Path = LOCK_PATH, task: str = "gpu", *, owner: str = "T4", pid: int | None = None,
                 alive: Callable[[int], bool] = pid_alive, sleep: Callable[[float], None] = time.sleep,
                 now: Callable[[], datetime] = datetime.now, poll_s: float = POLL_S,
                 max_wait_s: float | None = None, log: Callable[[str], None] = print) -> None:
        self.path, self.task, self.owner = Path(path), task, owner
        self.pid = os.getpid() if pid is None else pid
        self.alive, self.sleep, self.now, self.poll_s = alive, sleep, now, poll_s
        self.max_wait_s, self.log = max_wait_s, log
        self.line: str | None = None

    def _read(self) -> str | None:
        try:
            return self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return None

    def acquire(self) -> None:
        waited = 0.0
        while True:
            text = self._read()
            if text is not None:
                info = parse_lock(text)
                if info is not None and info.pid != self.pid and self.alive(info.pid):
                    if self.max_wait_s is not None and waited + self.poll_s > self.max_wait_s:
                        raise TimeoutError(f"{self.path} still held by {text.strip()!r} after {waited:.0f} s")
                    self.log(f"[gpu.lock] held by {text.strip()!r}; re-checking in {self.poll_s:.0f} s")
                    self.sleep(self.poll_s)
                    waited += self.poll_s
                    continue
                self.log(f"[gpu.lock] taking over stale lock {text.strip()!r}")
                try:
                    self.path.unlink()
                except FileNotFoundError:
                    pass
            line = format_lock(self.owner, self.pid, self.task, self.now())
            try:
                fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            except FileExistsError:  # someone else won the race: look again
                continue
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(line)
            self.line = line
            self.log(f"[gpu.lock] acquired: {line.strip()}")
            return

    def release(self) -> None:
        if self.line is not None and self._read() == self.line:
            self.path.unlink()
            self.log(f"[gpu.lock] released: {self.line.strip()}")
        self.line = None

    def __enter__(self) -> "GpuLock":
        self.acquire()
        return self

    def __exit__(self, *exc) -> None:
        self.release()
