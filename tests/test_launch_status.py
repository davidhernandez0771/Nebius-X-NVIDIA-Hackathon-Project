"""scripts/launch/status.ps1, run through Windows PowerShell.

It runs against fake HTTP servers on port 0 (URL overrides), never the real services.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from test_launch_health import JSON, FakeServer, free_port

pytestmark = pytest.mark.skipif(
    sys.platform != "win32" or shutil.which("powershell") is None, reason="Windows PowerShell scripts"
)

LAUNCH = Path(__file__).resolve().parents[1] / "scripts" / "launch"


def ps(script: str, *args: str, env: dict | None = None, timeout: float = 120) -> subprocess.CompletedProcess:
    full_env = {**os.environ, "PM_PYTHON": sys.executable, **(env or {})}
    return subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(LAUNCH / script), *args],
        capture_output=True, text=True, env=full_env, timeout=timeout,
    )


@pytest.fixture
def servers():
    made = []
    yield lambda routes: made.append(FakeServer(routes)) or made[-1]
    for s in made:
        s.close()


@pytest.fixture
def fake_env(servers):
    backend = servers({"/api/health": (200, {"status": "ok"}, JSON),
                       "/teleop/status": (200, {"browser_connected": False, "sim_connected": True, "messages_forwarded": 0}, JSON)})
    sim = servers({"/health": (200, {"ok": True, "robots": ["franka"], "cameras": True, "busy": True}, JSON)})
    dead = f"http://127.0.0.1:{free_port()}"
    return {"PM_BACKEND_URL": backend.base, "PM_WEB_URL": dead, "SIM_WORKER_URL": sim.base, "PM_POLICY_URL": dead}


# --- status.ps1 ------------------------------------------------------------------------------


def test_status_lines_and_exit_code(fake_env):
    r = ps("status.ps1", "-Require", "backend,sim", env=fake_env)
    lines = r.stdout.splitlines()
    assert r.returncode == 0, r.stdout + r.stderr
    assert [line.split()[0] for line in lines[:5]] == ["OK", "DOWN", "BUSY", "DOWN", "OK"]
    assert any(line.startswith("GPU") for line in lines)
    assert any(line.startswith("ISAAC") for line in lines)


def test_status_fails_when_a_required_service_is_down(fake_env):
    r = ps("status.ps1", "-Require", "backend,web", env=fake_env)
    assert r.returncode == 1
    assert "required but not up: web" in r.stdout


def test_status_json(fake_env):
    r = ps("status.ps1", "-Json", "-Require", "backend", env=fake_env)
    data = json.loads(r.stdout)
    assert r.returncode == 0 and data["exit_code"] == 0
    assert {s["name"]: s["state"] for s in data["services"]}["sim"] == "BUSY"


