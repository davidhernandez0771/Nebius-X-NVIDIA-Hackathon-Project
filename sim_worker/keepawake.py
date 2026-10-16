"""Ask Windows not to idle-sleep while a sim job runs.

Measured (T2 note, sprint 4 Task 2): an idle-timer sleep at 16:46:29 (System log, Kernel-Power 42) broke a running
multiply with "CUDA error: unknown error" / Warp error 999, failing every remaining variant. This uses the standard
per-thread request SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED), as media players and downloaders do:
no power setting changes, it only lasts while the guard is held (one job), and an explicit sleep (lid, Start menu)
still wins. Must be entered and left on the same thread (the job loop's).
"""

from __future__ import annotations

import sys
from typing import Callable

ES_CONTINUOUS = 0x80000000
ES_SYSTEM_REQUIRED = 0x00000001


def _win32_setter() -> Callable[[int], object] | None:
    if sys.platform != "win32":
        return None
    import ctypes

    fn = ctypes.windll.kernel32.SetThreadExecutionState
    fn.argtypes = [ctypes.c_uint32]
    fn.restype = ctypes.c_uint32
    return fn


class KeepAwake:
    def __init__(self, setter: Callable[[int], object] | None = None, enabled: bool = True):
        self.enabled = enabled
        self.setter = setter if setter is not None else (_win32_setter() if enabled else None)

    def __enter__(self) -> "KeepAwake":
        if self.enabled and self.setter is not None:
            self.setter(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)
        return self

    def __exit__(self, *exc) -> None:
        if self.enabled and self.setter is not None:
            self.setter(ES_CONTINUOUS)
