"""scripts/start-live.ps1, run through Windows PowerShell.

Only its refusal is driven here: a listener this checkout didn't start holds port 8000, so the script must stop before
starting anything. The real start (backend, relay, web) was checked by hand; see the live-start note.
"""
from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(
    sys.platform != "win32" or shutil.which("powershell") is None, reason="Windows PowerShell scripts"
)

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "start-live.ps1"


def test_refuses_when_another_checkout_holds_the_backend_port(tmp_path):
    held = socket.socket()
    try:
        try:
            held.bind(("127.0.0.1", 8000))
            held.listen()
        except OSError:
            pass  # something already listens on 8000, and this run's empty LogDir never started it: same refusal
        r = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(SCRIPT),
             "-LogDir", str(tmp_path), "-SantVenv", str(tmp_path / "no_such_venv")],
            capture_output=True, text=True, env={**os.environ, "PM_PYTHON": sys.executable}, timeout=120,
        )
    finally:
        held.close()
    assert r.returncode == 1, r.stdout + r.stderr
    assert "[backend] REFUSED: port 8000 is held by something this checkout didn't start" in r.stdout
    assert "pid " in r.stdout
    # nothing was started, so nothing is recorded and no sink command is offered yet
    assert not (tmp_path / "pids.json").exists()
    assert not (tmp_path / "backend.log").exists()
    assert "teleop_sink.py" not in r.stdout
