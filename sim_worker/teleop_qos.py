"""Keep the teleop sink at full speed when its window is not in front (Windows 11 power throttling / EcoQoS).

During a live session the person faces the browser, so the Kit window is in the background. Windows may then
throttle the sink's process ("EcoQoS": lower clocks, and on a hybrid CPU such as the i9-14900KF, the efficiency
cores), which slows every control step. high_qos() opts the current process out, as Task Manager's
"Efficiency mode" off does. Elsewhere it does nothing.
"""

from __future__ import annotations

import ctypes
import sys

PROCESS_POWER_THROTTLING = 4  # PROCESS_INFORMATION_CLASS.ProcessPowerThrottling
THROTTLING_VERSION = 1
EXECUTION_SPEED = 0x1  # EcoQoS
IGNORE_TIMER_RESOLUTION = 0x4  # keep honouring timer-resolution requests


class _ThrottlingState(ctypes.Structure):
    _fields_ = [("Version", ctypes.c_ulong), ("ControlMask", ctypes.c_ulong), ("StateMask", ctypes.c_ulong)]


def high_qos() -> bool:
    """Opt this process out of power throttling. True if Windows accepted it."""
    if sys.platform != "win32":
        return False
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.GetCurrentProcess.restype = ctypes.c_void_p
    kernel32.SetProcessInformation.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_ulong]
    # ControlMask: the policies this call decides; StateMask 0: throttling off for them
    state = _ThrottlingState(THROTTLING_VERSION, EXECUTION_SPEED | IGNORE_TIMER_RESOLUTION, 0)
    return bool(kernel32.SetProcessInformation(kernel32.GetCurrentProcess(), PROCESS_POWER_THROTTLING,
                                               ctypes.byref(state), ctypes.sizeof(state)))
