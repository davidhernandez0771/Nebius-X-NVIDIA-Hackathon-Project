"""scripts/launch/start.ps1 and stop.ps1, run through Windows PowerShell.

Nothing here starts Isaac, a sim worker, or any real service on its real port:
- start.ps1 is only driven into its refusals, with a non-existent Isaac python, so it cannot
  launch anything even if a refusal regressed;
- stop.ps1 stops sleeper processes this test started, recorded in a temporary pids.json.

The one real start (the backend on a free port, then stop) is opt-in: PM_LAUNCH_E2E=1.
"""
from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

from test_launch_health import free_port

pytestmark = pytest.mark.skipif(
    sys.platform != "win32" or shutil.which("powershell") is None, reason="Windows PowerShell scripts"
)

LAUNCH = Path(__file__).resolve().parents[1] / "scripts" / "launch"
NO_SUCH_PYTHON = r"C:\no\such\isaac\python.exe"


def ps(script: str, *args: str, env: dict | None = None, timeout: float = 120) -> subprocess.CompletedProcess:
    full_env = {**os.environ, "PM_PYTHON": sys.executable, **(env or {})}
    return subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(LAUNCH / script), *args],
        capture_output=True, text=True, env=full_env, timeout=timeout,
    )


def ps_cmd(command: str) -> str:
    return subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", command],
                          capture_output=True, text=True, check=True, timeout=60).stdout.strip()


# --- start.ps1 refusals ------------------------------------------------------------------------


def test_start_without_a_service_prints_usage(tmp_path):
    r = ps("start.ps1", "-LogDir", str(tmp_path))
    assert r.returncode == 2
    assert "-Backend" in r.stdout and "-Sim" in r.stdout
    assert not (tmp_path / "pids.json").exists()


def test_start_refuses_a_second_sim_worker_when_the_port_is_taken(tmp_path):
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        s.listen()
        port = s.getsockname()[1]
        r = ps("start.ps1", "-Sim", "-SimPort", str(port), "-IsaacPython", NO_SUCH_PYTHON, "-LogDir", str(tmp_path))
    assert r.returncode == 1
    assert f"port {port} is already taken" in r.stdout
    assert not (tmp_path / "pids.json").exists()
    assert not (tmp_path / "sim.log").exists()


def test_start_sim_needs_the_isaac_python(tmp_path):
    r = ps("start.ps1", "-Sim", "-SimPort", str(free_port()), "-IsaacPython", NO_SUCH_PYTHON, "-LogDir", str(tmp_path))
    assert r.returncode == 1
    # refused either way: another Isaac process is running, or the python is missing
    assert "Isaac" in r.stdout
    assert not (tmp_path / "pids.json").exists()


def test_start_policy_needs_an_existing_checkpoint(tmp_path):
    r = ps("start.ps1", "-Policy", str(tmp_path / "no_such_checkpoint"), "-PolicyPort", str(free_port()),
           "-LogDir", str(tmp_path))
    assert r.returncode == 1
    assert "checkpoint not found" in r.stdout
    assert not (tmp_path / "pids.json").exists()


def test_start_web_needs_node_modules_or_says_so(tmp_path):
    has_modules = (LAUNCH.parents[1] / "web" / "node_modules").exists()
    if has_modules:
        pytest.skip("web/node_modules exists; this test checks the refusal without it")
    r = ps("start.ps1", "-Web", "-LogDir", str(tmp_path))
    assert r.returncode == 1
    assert "npm --prefix web ci" in r.stdout


# --- stop.ps1 ------------------------------------------------------------------------------------


def _sleeper() -> subprocess.Popen:
    # A process *tree*, like start.ps1's `cmd /c npm ...`: cmd.exe -> python. (A uv venv launcher
    # alone is no test of the tree kill: it puts its child in a kill-on-close job, so the child
    # dies with it anyway. Measured: without /T this test still passed with the launcher alone.)
    return subprocess.Popen(["cmd.exe", "/d", "/c", sys.executable, "-c", "import time; time.sleep(120)"],
                            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)


def _start_time(pid: int) -> str:
    return ps_cmd(f"(Get-Process -Id {pid}).StartTime.ToUniversalTime().ToString('o')")


def _children(pid: int) -> list[int]:
    out = ps_cmd(f"Get-CimInstance Win32_Process -Filter 'ParentProcessId={pid}' | ForEach-Object {{ $_.ProcessId }}")
    return [int(x) for x in out.split()] if out else []


def _alive(pid: int) -> bool:
    return ps_cmd(f"if (Get-Process -Id {pid} -ErrorAction SilentlyContinue) {{ 'yes' }} else {{ 'no' }}") == "yes"


def _write_pids(log_dir: Path, entries: dict) -> None:
    (log_dir / "pids.json").write_text(json.dumps(entries), encoding="utf-8")


def test_stop_kills_only_what_the_pid_file_proves_it_started(tmp_path):
    ours, reused = _sleeper(), _sleeper()
    try:
        time.sleep(1.0)  # let the launcher start its child
        kids = _children(ours.pid)
        _write_pids(tmp_path, {
            "backend": {"pid": ours.pid, "start_time": _start_time(ours.pid), "command": "sleeper"},
            # same PID number scheme, but the recorded start time is not this process's: PID reuse
            "web": {"pid": reused.pid, "start_time": "2001-01-01T00:00:00.0000000Z", "command": "sleeper"},
            "policy": {"pid": 999999, "start_time": "2001-01-01T00:00:00.0000000Z", "command": "gone"},
        })
        r = ps("stop.ps1", "-LogDir", str(tmp_path))
        assert r.returncode == 0, r.stdout + r.stderr
        ours.wait(timeout=10)
        assert all(not _alive(k) for k in kids), "the launcher's child must be stopped too"
        assert reused.poll() is None, "a process whose start time does not match must not be touched"
        assert "not touched" in r.stdout
        assert not (tmp_path / "pids.json").exists()
    finally:
        for p in (ours, reused):
            if p.poll() is None:
                subprocess.run(["taskkill", "/PID", str(p.pid), "/T", "/F"], capture_output=True)


def test_stop_one_service_leaves_the_others_recorded(tmp_path):
    a, b = _sleeper(), _sleeper()
    try:
        time.sleep(0.5)
        _write_pids(tmp_path, {
            "backend": {"pid": a.pid, "start_time": _start_time(a.pid), "command": "sleeper"},
            "web": {"pid": b.pid, "start_time": _start_time(b.pid), "command": "sleeper"},
        })
        r = ps("stop.ps1", "-Service", "web", "-LogDir", str(tmp_path))
        assert r.returncode == 0, r.stdout + r.stderr
        b.wait(timeout=10)
        assert a.poll() is None
        left = json.loads((tmp_path / "pids.json").read_text(encoding="utf-8"))
        assert list(left) == ["backend"]
    finally:
        for p in (a, b):
            if p.poll() is None:
                subprocess.run(["taskkill", "/PID", str(p.pid), "/T", "/F"], capture_output=True)


def test_stop_with_no_pid_file_does_nothing(tmp_path):
    r = ps("stop.ps1", "-LogDir", str(tmp_path))
    assert r.returncode == 0
    assert "nothing to stop" in r.stdout


# --- opt-in: a real start + stop of the backend on a free port --------------------------------


@pytest.mark.skipif(os.environ.get("PM_LAUNCH_E2E") != "1", reason="opt-in: PM_LAUNCH_E2E=1 starts a real backend")
def test_e2e_start_and_stop_the_backend_on_a_free_port(tmp_path):
    port = free_port()
    env = {"DATA_DIR": str(tmp_path / "data"), "APP_DB_PATH": str(tmp_path / "app.db"),
           "PM_BACKEND_URL": f"http://127.0.0.1:{port}"}
    log_dir = tmp_path / "logs"
    # Not ps(): the services start.ps1 launches inherit its stdout/stderr handles, so a captured
    # pipe never reaches EOF while the backend runs (measured: subprocess.run hung until the
    # backend was stopped). Its output goes to a file instead.
    out_file = tmp_path / "start_out.txt"
    with open(out_file, "w", encoding="utf-8") as out:
        code = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
             str(LAUNCH / "start.ps1"), "-Backend", "-BackendPort", str(port), "-LogDir", str(log_dir)],
            stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT,
            env={**os.environ, "PM_PYTHON": sys.executable, **env}, timeout=300,
        ).returncode
    try:
        assert code == 0, out_file.read_text(encoding="utf-8", errors="replace")
        entries = json.loads((log_dir / "pids.json").read_text(encoding="utf-8"))
        assert entries["backend"]["port"] == port
        st = ps("status.ps1", "-Require", "backend", env=env)
        assert st.returncode == 0, st.stdout
    finally:
        s = ps("stop.ps1", "-LogDir", str(log_dir))
    assert s.returncode == 0, s.stdout + s.stderr
    time.sleep(1)
    with socket.socket() as sock:
        assert sock.connect_ex(("127.0.0.1", port)) != 0
