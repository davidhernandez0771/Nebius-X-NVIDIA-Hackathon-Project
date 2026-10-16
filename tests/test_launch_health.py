"""scripts/launch/health.py: stdlib health checks shared by the launch scripts.

Every HTTP check runs against a local fake server on port 0; nothing here touches the real
services (8000, 5173, 8770, 8765) or starts Isaac.
"""
from __future__ import annotations

import json
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from scripts.launch import health as h


class FakeServer:
    """A tiny HTTP server: routes[path] = (status, body, content_type[, delay_s])."""

    def __init__(self, routes: dict):
        self.routes = routes
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                route = owner.routes.get(self.path)
                if route is None:
                    self.send_response(404)
                    self.end_headers()
                    return
                status, body, ctype, *rest = route
                if rest:
                    time.sleep(rest[0])
                data = body.encode() if isinstance(body, str) else json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args):
                pass

        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.srv.daemon_threads = True
        self.port = self.srv.server_address[1]
        self.base = f"http://127.0.0.1:{self.port}"
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def close(self):
        self.srv.shutdown()
        self.srv.server_close()


@pytest.fixture
def fake():
    servers = []

    def make(routes):
        s = FakeServer(routes)
        servers.append(s)
        return s

    yield make
    for s in servers:
        s.close()


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


JSON = "application/json"


def spec(name, *urls):
    return h.ServiceSpec(name=name, label=name, urls=tuple(urls), kind=name)


# --- one service -------------------------------------------------------------------------


def test_backend_ok(fake):
    s = fake({"/api/health": (200, {"status": "ok"}, JSON)})
    r = h.check_service(spec("backend", s.base + "/api/health"), timeout=2)
    assert r.state == "OK"
    assert r.url == s.base + "/api/health"


def test_backend_wrong_body_is_down(fake):
    s = fake({"/api/health": (200, {"status": "starting"}, JSON)})
    r = h.check_service(spec("backend", s.base + "/api/health"), timeout=2)
    assert r.state == "DOWN"
    assert "starting" in r.detail


def test_nothing_listening_is_down_and_says_unreachable():
    url = f"http://127.0.0.1:{free_port()}/health"
    r = h.check_service(spec("sim", url), timeout=1)
    assert r.state == "DOWN"
    assert "unreachable" in r.detail


@pytest.mark.parametrize(
    "body,state",
    [
        ({"ok": True, "robots": ["franka"], "cameras": True, "busy": False}, "OK"),
        ({"ok": True, "robots": ["franka"], "cameras": True, "busy": True}, "BUSY"),
        ({"ok": False, "robots": ["franka"], "cameras": True, "busy": False}, "DOWN"),
    ],
)
def test_sim_worker_states(fake, body, state):
    s = fake({"/health": (200, body, JSON)})
    r = h.check_service(spec("sim", s.base + "/health"), timeout=2)
    assert r.state == state


def test_sim_worker_detail_names_robot_and_cameras(fake):
    s = fake({"/health": (200, {"ok": True, "robots": ["franka"], "cameras": True, "busy": False}, JSON)})
    r = h.check_service(spec("sim", s.base + "/health"), timeout=2)
    assert "franka" in r.detail and "cameras" in r.detail


def test_http_error_is_down_with_the_status(fake):
    s = fake({"/health": (500, {"error": "sim_error"}, JSON)})
    r = h.check_service(spec("sim", s.base + "/health"), timeout=2)
    assert r.state == "DOWN"
    assert "HTTP 500" in r.detail


def test_bad_json_is_down(fake):
    s = fake({"/health": (200, "not json", "text/plain")})
    r = h.check_service(spec("sim", s.base + "/health"), timeout=2)
    assert r.state == "DOWN"
    assert "JSON" in r.detail


def test_slow_answer_times_out_as_down(fake):
    s = fake({"/health": (200, {"ok": True}, JSON, 1.5)})
    r = h.check_service(spec("policy", s.base + "/health"), timeout=0.3)
    assert r.state == "DOWN"


def test_policy_server_ok_reports_checkpoint(fake):
    body = {"ok": True, "state_dim": 9, "cameras": {"front": [128, 128]}, "checkpoint": "C:/runs/x", "device": "cuda"}
    s = fake({"/health": (200, body, JSON)})
    r = h.check_service(spec("policy", s.base + "/health"), timeout=2)
    assert r.state == "OK"
    assert "C:/runs/x" in r.detail


def test_web_any_2xx_page_is_ok(fake):
    s = fake({"/": (200, "<!doctype html><html></html>", "text/html")})
    r = h.check_service(spec("web", s.base + "/"), timeout=2)
    assert r.state == "OK"


def test_later_url_is_tried_when_the_first_is_unreachable(fake):
    s = fake({"/": (200, "<html></html>", "text/html")})
    dead = f"http://127.0.0.1:{free_port()}/"
    r = h.check_service(spec("web", dead, s.base + "/"), timeout=1)
    assert r.state == "OK"
    assert r.url == s.base + "/"


def test_teleop_relay_ok_says_whether_a_sim_is_connected(fake):
    s = fake({"/teleop/status": (200, {"browser_connected": False, "sim_connected": True, "messages_forwarded": 3}, JSON)})
    r = h.check_service(spec("teleop", s.base + "/teleop/status"), timeout=2)
    assert r.state == "OK"
    assert "sim connected" in r.detail
    s.routes["/teleop/status"] = (200, {"browser_connected": False, "sim_connected": False, "messages_forwarded": 0}, JSON)
    r = h.check_service(spec("teleop", s.base + "/teleop/status"), timeout=2)
    assert r.state == "OK"
    assert "no sim" in r.detail


# --- the service table -------------------------------------------------------------------


def test_default_services_match_the_plan():
    by_name = {s.name: s for s in h.default_services({})}
    assert list(by_name) == ["backend", "web", "sim", "policy", "teleop"]
    assert by_name["backend"].urls[0] == "http://127.0.0.1:8000/api/health"
    assert by_name["web"].urls[0] == "http://127.0.0.1:5173/"
    assert by_name["sim"].urls[0] == "http://127.0.0.1:8770/health"
    assert by_name["policy"].urls[0] == "http://127.0.0.1:8765/health"
    assert by_name["teleop"].urls[0] == "http://127.0.0.1:8000/teleop/status"


def test_web_also_tries_localhost_because_vite_may_bind_ipv6_only():
    web = next(s for s in h.default_services({}) if s.name == "web")
    assert "http://localhost:5173/" in web.urls


def test_env_overrides_the_base_urls():
    env = {"PM_BACKEND_URL": "http://127.0.0.1:9001/", "PM_WEB_URL": "http://127.0.0.1:9002",
           "SIM_WORKER_URL": "http://127.0.0.1:9003", "PM_POLICY_URL": "http://127.0.0.1:9004"}
    by_name = {s.name: s for s in h.default_services(env)}
    assert by_name["backend"].urls == ("http://127.0.0.1:9001/api/health",)
    assert by_name["teleop"].urls == ("http://127.0.0.1:9001/teleop/status",)
    assert by_name["web"].urls == ("http://127.0.0.1:9002/",)
    assert by_name["sim"].urls == ("http://127.0.0.1:9003/health",)
    assert by_name["policy"].urls == ("http://127.0.0.1:9004/health",)


# --- exit code ---------------------------------------------------------------------------


def _r(name, state):
    return h.CheckResult(name=name, label=name, state=state, url="u", detail="")


def test_exit_code_zero_only_when_every_required_service_is_up():
    results = [_r("backend", "OK"), _r("web", "OK"), _r("sim", "BUSY"), _r("policy", "DOWN"), _r("teleop", "OK")]
    assert h.exit_code(results, ["backend", "web", "sim"]) == 0  # BUSY is up
    assert h.exit_code(results, ["backend", "policy"]) == 1


def test_unknown_required_service_is_refused():
    with pytest.raises(ValueError, match="nonsense"):
        h.exit_code([_r("backend", "OK")], ["nonsense"])


# --- GPU and Isaac processes ---------------------------------------------------------------


def test_parse_gpu_memory():
    assert h.parse_gpu("5732, 16303\n") == [(5732, 16303)]
    assert h.parse_gpu("100, 8000\n200, 16000\n") == [(100, 8000), (200, 16000)]
    assert h.parse_gpu("garbage") == []


def test_gpu_memory_without_nvidia_smi_is_none():
    def run(cmd):
        raise FileNotFoundError(cmd[0])

    assert h.gpu_memory(run=run) is None


def test_gpu_memory_uses_the_query(monkeypatch):
    seen = []

    def run(cmd):
        seen.append(cmd)
        return "5732, 16303\n"

    assert h.gpu_memory(run=run) == [(5732, 16303)]
    assert seen[0][0] == "nvidia-smi"
    assert "--query-gpu=memory.used,memory.total" in seen[0]


ISAAC_ROWS = [
    {"ProcessId": 37300, "ParentProcessId": 1, "ExecutablePath": r"C:\isaac\env_isaaclab\Scripts\python.exe",
     "CommandLine": r"C:\isaac\env_isaaclab\Scripts\python.exe -m sim_worker.server --port 8770 --robot franka --cameras"},
    # the trampoline's child: a base interpreter outside the Isaac venv, same arguments
    {"ProcessId": 9996, "ParentProcessId": 37300,
     "ExecutablePath": r"C:\Users\x\AppData\Roaming\uv\python\cpython-3.12-windows-x86_64-none\python.exe",
     "CommandLine": r'"C:\Users\x\...\python.exe"  -m sim_worker.server --port 8770 --robot franka --cameras'},
    {"ProcessId": 41372, "ParentProcessId": 1, "ExecutablePath": r"C:\venvs\pm-t4\Scripts\python.exe",
     "CommandLine": r"C:\venvs\pm-t4\Scripts\python.exe -m pytest -q"},
    {"ProcessId": 30460, "ParentProcessId": 1, "ExecutablePath": r"c:\ISAAC\env_isaaclab\Scripts\python.exe",
     "CommandLine": r'"C:\isaac\env_isaaclab\Scripts\python.exe" -u sim_eval\scripts\eval_cells.py --n 20'},
    {"ProcessId": 5, "ParentProcessId": 1, "ExecutablePath": None, "CommandLine": None},
]


def test_isaac_processes_are_the_launchers_under_the_isaac_venv():
    procs = h.isaac_processes(ISAAC_ROWS, r"C:\isaac\env_isaaclab")
    assert [p.pid for p in procs] == [37300, 30460]
    assert procs[0].args == "-m sim_worker.server --port 8770 --robot franka --cameras"
    assert procs[1].args == r"-u sim_eval\scripts\eval_cells.py --n 20"


def test_parse_process_json_accepts_one_object_a_list_or_nothing():
    one = json.dumps(ISAAC_ROWS[0])
    assert h.parse_process_json(one) == [ISAAC_ROWS[0]]
    assert h.parse_process_json(json.dumps(ISAAC_ROWS)) == ISAAC_ROWS
    assert h.parse_process_json("") == []


def test_list_processes_failure_is_none():
    def run(cmd):
        raise OSError("no powershell")

    assert h.list_python_processes(run=run) is None


# --- ports and waiting --------------------------------------------------------------------


def test_port_in_use():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        s.listen()
        port = s.getsockname()[1]
        assert h.port_in_use(port) is True
    assert h.port_in_use(free_port()) is False


def test_wait_returns_as_soon_as_the_service_is_up():
    states = iter(["DOWN", "DOWN", "OK"])
    calls = []

    def check(_spec, timeout):
        calls.append(timeout)
        return _r("backend", next(states))

    clock = iter(range(100))
    r = h.wait_for(spec("backend", "u"), timeout_s=30, interval_s=1, check=check,
                   now=lambda: next(clock), sleep=lambda s: None)
    assert r.state == "OK" and len(calls) == 3


def test_wait_gives_up_after_the_timeout_with_the_last_result():
    t = [0.0]

    def sleep(s):
        t[0] += s

    r = h.wait_for(spec("sim", "u"), timeout_s=5, interval_s=2, check=lambda _s, timeout: _r("sim", "DOWN"),
                   now=lambda: t[0], sleep=sleep)
    assert r.state == "DOWN"
    assert t[0] >= 5


def test_wait_counts_busy_as_up():
    r = h.wait_for(spec("sim", "u"), timeout_s=5, interval_s=1, check=lambda _s, timeout: _r("sim", "BUSY"),
                   now=lambda: 0.0, sleep=lambda s: None)
    assert r.state == "BUSY"


# --- output and CLI ------------------------------------------------------------------------


def test_format_line_is_state_label_url_detail():
    line = h.format_line(h.CheckResult(name="sim", label="sim worker", state="BUSY",
                                       url="http://127.0.0.1:8770/health", detail="franka, cameras"))
    assert line.split()[0] == "BUSY"
    assert "sim worker" in line and "http://127.0.0.1:8770/health" in line and "franka, cameras" in line


def _env_for(fake_backend, fake_sim, dead_port):
    return {
        "PM_BACKEND_URL": fake_backend.base,
        "PM_WEB_URL": f"http://127.0.0.1:{dead_port}",
        "SIM_WORKER_URL": fake_sim.base,
        "PM_POLICY_URL": f"http://127.0.0.1:{dead_port}",
    }


@pytest.fixture
def two_up(fake):
    backend = fake({"/api/health": (200, {"status": "ok"}, JSON),
                    "/teleop/status": (200, {"browser_connected": False, "sim_connected": False, "messages_forwarded": 0}, JSON)})
    sim = fake({"/health": (200, {"ok": True, "robots": ["franka"], "cameras": True, "busy": True}, JSON)})
    return backend, sim


def test_cli_status_json(two_up, capsys, monkeypatch):
    backend, sim = two_up
    for k, v in _env_for(backend, sim, free_port()).items():
        monkeypatch.setenv(k, v)
    code = h.main(["status", "--json", "--require", "backend,sim", "--no-gpu", "--no-processes", "--timeout", "1"])
    out = json.loads(capsys.readouterr().out)
    states = {s["name"]: s["state"] for s in out["services"]}
    assert states == {"backend": "OK", "web": "DOWN", "sim": "BUSY", "policy": "DOWN", "teleop": "OK"}
    assert out["required"] == ["backend", "sim"]
    assert out["exit_code"] == 0 and code == 0


def test_cli_status_text_and_failing_exit_code(two_up, capsys, monkeypatch):
    backend, sim = two_up
    for k, v in _env_for(backend, sim, free_port()).items():
        monkeypatch.setenv(k, v)
    code = h.main(["status", "--require", "backend,web", "--no-gpu", "--no-processes", "--timeout", "1"])
    out = capsys.readouterr().out.splitlines()
    assert code == 1
    assert [line.split()[0] for line in out[:5]] == ["OK", "DOWN", "BUSY", "DOWN", "OK"]
    assert any("required" in line and "web" in line for line in out[5:])


def test_cli_wait(two_up, monkeypatch):
    backend, sim = two_up
    for k, v in _env_for(backend, sim, free_port()).items():
        monkeypatch.setenv(k, v)
    assert h.main(["wait", "backend", "--timeout", "2", "--interval", "0.1"]) == 0
    assert h.main(["wait", "web", "--timeout", "0.3", "--interval", "0.1"]) == 1


def test_cli_port_free():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        s.listen()
        assert h.main(["port-free", str(s.getsockname()[1])]) == 1
    assert h.main(["port-free", str(free_port())]) == 0
