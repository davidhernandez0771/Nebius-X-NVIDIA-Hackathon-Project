"""Health checks for the local services (stdlib only; any Python 3.10+ can run it).

    python scripts/launch/health.py status [--json] [--require backend,web,sim] [--timeout 3]
    python scripts/launch/health.py wait <service> [--timeout 60] [--interval 1]
    python scripts/launch/health.py port-free <port>
    python scripts/launch/health.py isaac [--isaac-venv DIR]

Services and their checks (base URLs can be overridden, see `default_services`):

    backend        GET http://127.0.0.1:8000/api/health   -> {"status": "ok"}
    web            GET http://127.0.0.1:5173/              -> any 2xx page (also tries localhost:5173)
    sim worker     GET http://127.0.0.1:8770/health        -> {"ok": true, "busy": ...}; busy -> BUSY
    policy server  GET http://127.0.0.1:8765/health        -> {"ok": true, "checkpoint": ...}
    teleop relay   GET http://127.0.0.1:8000/teleop/status -> {"sim_connected": ..., ...}

Each service is OK, BUSY (up, but the sim worker is running a job) or DOWN. `status` also
prints GPU memory (nvidia-smi) and the Isaac python processes that are running. Its exit code
is 0 when every required service is OK or BUSY, else 1. This script only reads: it never
starts or stops anything.
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from typing import Callable, Mapping, Sequence

STATES = ("OK", "BUSY", "DOWN")
DEFAULT_REQUIRED = ("backend", "web", "sim")
ISAAC_VENV = r"C:\isaac\env_isaaclab"

BACKEND_URL = "http://127.0.0.1:8000"
WEB_URL = "http://127.0.0.1:5173"
SIM_URL = "http://127.0.0.1:8770"
POLICY_URL = "http://127.0.0.1:8765"


@dataclass(frozen=True)
class ServiceSpec:
    name: str
    label: str
    urls: tuple[str, ...]  # tried in order; the first that answers decides
    kind: str  # how to read the answer: backend | web | sim | policy | teleop


@dataclass(frozen=True)
class CheckResult:
    name: str
    label: str
    state: str
    url: str
    detail: str


@dataclass(frozen=True)
class IsaacProcess:
    pid: int
    args: str


def _join(base: str, path: str) -> str:
    return base.rstrip("/") + path


def default_services(env: Mapping[str, str] | None = None) -> list[ServiceSpec]:
    """The five services. PM_BACKEND_URL, PM_WEB_URL, SIM_WORKER_URL (the backend's own
    variable) and PM_POLICY_URL override the base URLs; an override is the only URL tried."""
    env = os.environ if env is None else env
    backend = env.get("PM_BACKEND_URL") or BACKEND_URL
    web = (_join(env["PM_WEB_URL"], "/"),) if env.get("PM_WEB_URL") else (WEB_URL + "/", "http://localhost:5173/")
    sim = env.get("SIM_WORKER_URL") or SIM_URL
    policy = env.get("PM_POLICY_URL") or POLICY_URL
    return [
        ServiceSpec("backend", "backend", (_join(backend, "/api/health"),), "backend"),
        ServiceSpec("web", "web", web, "web"),
        ServiceSpec("sim", "sim worker", (_join(sim, "/health"),), "sim"),
        ServiceSpec("policy", "policy server", (_join(policy, "/health"),), "policy"),
        ServiceSpec("teleop", "teleop relay", (_join(backend, "/teleop/status"),), "teleop"),
    ]


def _fetch(url: str, timeout: float) -> tuple[int, bytes]:
    """(status, body) for any HTTP answer, error statuses included. Raises OSError if unreachable."""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:  # noqa: S310 - local URLs only
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def _interpret(kind: str, body: bytes) -> tuple[str, str]:
    """(state, detail) for a 2xx answer."""
    if kind == "web":
        return "OK", "page served"
    try:
        data = json.loads(body)
    except ValueError:
        return "DOWN", "answer is not JSON"
    if not isinstance(data, dict):
        return "DOWN", "answer is not a JSON object"
    if kind == "backend":
        if data.get("status") == "ok":
            return "OK", "status ok"
        return "DOWN", f"status {data.get('status')!r}"
    if kind == "sim":
        robots = ",".join(data.get("robots") or []) or "?"
        cams = "cameras" if data.get("cameras") else "no cameras"
        detail = f"robot {robots}, {cams}"
        if data.get("ok") is not True:
            return "DOWN", f"ok=false ({detail})"
        if data.get("busy"):
            return "BUSY", f"running a job ({detail})"
        return "OK", f"idle ({detail})"
    if kind == "policy":
        if data.get("ok") is not True:
            return "DOWN", "ok=false"
        cams = ",".join(sorted(data.get("cameras") or {})) or "none"
        return "OK", f"checkpoint {data.get('checkpoint')}, device {data.get('device')}, cameras {cams}"
    if kind == "teleop":
        sim = "sim connected" if data.get("sim_connected") else "no sim connected"
        browser = "browser connected" if data.get("browser_connected") else "no browser"
        return "OK", f"{sim}, {browser}, {data.get('messages_forwarded', 0)} poses forwarded"
    raise ValueError(f"unknown service kind {kind!r}")


def check_service(spec: ServiceSpec, timeout: float = 3.0) -> CheckResult:
    """Try each URL in order; the first one that answers at all decides the state."""
    last_error = "no URL"
    for url in spec.urls:
        try:
            status, body = _fetch(url, timeout)
        except (OSError, ValueError) as e:  # refused, timeout, DNS; ValueError: bad URL
            reason = getattr(e, "reason", e)
            last_error = f"unreachable ({type(reason).__name__})"
            continue
        if not 200 <= status < 300:
            return CheckResult(spec.name, spec.label, "DOWN", url, f"HTTP {status}")
        state, detail = _interpret(spec.kind, body)
        return CheckResult(spec.name, spec.label, state, url, detail)
    return CheckResult(spec.name, spec.label, "DOWN", spec.urls[0] if spec.urls else "", last_error)


def is_up(result: CheckResult) -> bool:
    return result.state in ("OK", "BUSY")


def exit_code(results: Sequence[CheckResult], required: Sequence[str]) -> int:
    by_name = {r.name: r for r in results}
    unknown = [n for n in required if n not in by_name]
    if unknown:
        raise ValueError(f"unknown service(s): {', '.join(unknown)}; known: {', '.join(by_name)}")
    return 0 if all(is_up(by_name[n]) for n in required) else 1


def wait_for(spec: ServiceSpec, timeout_s: float, interval_s: float = 1.0, *,
             check: Callable[..., CheckResult] = check_service,
             now: Callable[[], float] = time.monotonic, sleep: Callable[[float], None] = time.sleep) -> CheckResult:
    """Poll until the service is up (OK or BUSY) or `timeout_s` has passed; return the last result."""
    deadline = now() + timeout_s
    while True:
        result = check(spec, timeout=min(3.0, max(0.2, interval_s)))
        if is_up(result) or now() >= deadline:
            return result
        sleep(interval_s)


def port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    """True if something accepts TCP connections on host:port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0


# --- GPU and processes -------------------------------------------------------------------


def _run(cmd: Sequence[str]) -> str:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=20, check=True).stdout


def parse_gpu(text: str) -> list[tuple[int, int]]:
    """nvidia-smi's `used, total` CSV lines (MiB) -> [(used, total), ...]; unparsable lines are skipped."""
    rows = []
    for line in text.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) == 2 and all(p.isdigit() for p in parts):
            rows.append((int(parts[0]), int(parts[1])))
    return rows


def gpu_memory(run: Callable[[Sequence[str]], str] = _run) -> list[tuple[int, int]] | None:
    """[(used MiB, total MiB)] per GPU, or None if nvidia-smi is missing or fails."""
    try:
        out = run(["nvidia-smi", "--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"])
    except (OSError, subprocess.SubprocessError):
        return None
    return parse_gpu(out)


_PS_QUERY = ("Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | "
             "Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress")


def parse_process_json(text: str) -> list[dict]:
    """ConvertTo-Json gives an object for one process, a list for several, nothing for none."""
    text = text.strip()
    if not text:
        return []
    data = json.loads(text)
    return data if isinstance(data, list) else [data]


def list_python_processes(run: Callable[[Sequence[str]], str] = _run) -> list[dict] | None:
    """Every python.exe with its path and command line (Windows, via PowerShell); None on failure."""
    try:
        return parse_process_json(run(["powershell", "-NoProfile", "-NonInteractive", "-Command", _PS_QUERY]))
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def _args_of(cmdline: str, exe: str) -> str:
    """The command line without the executable (quoted or not)."""
    s = cmdline.strip()
    if s.startswith('"'):
        end = s.find('"', 1)
        return s[end + 1:].strip() if end > 0 else s
    if s.lower().startswith(exe.lower()):
        return s[len(exe):].strip()
    return s.split(None, 1)[1] if " " in s else ""


def isaac_processes(rows: Sequence[Mapping], isaac_venv: str = ISAAC_VENV) -> list[IsaacProcess]:
    """The python processes launched from the Isaac venv.

    A uv venv's python.exe is a launcher that starts a base interpreter with the same
    arguments, so each Isaac run shows up twice. Only the launcher's ExecutablePath is inside
    the venv, so matching on the path counts each run once."""
    root = os.path.normcase(os.path.normpath(isaac_venv)) + os.sep
    procs = []
    for row in rows:
        exe = row.get("ExecutablePath") or ""
        if exe and os.path.normcase(os.path.normpath(exe)).startswith(root):
            procs.append(IsaacProcess(int(row["ProcessId"]), _args_of(row.get("CommandLine") or "", exe)))
    return procs


# --- output and CLI ------------------------------------------------------------------------


def format_line(r: CheckResult) -> str:
    return f"{r.state:<5} {r.label:<14} {r.url:<38} {r.detail}"


def _status(args: argparse.Namespace) -> int:
    services = default_services()
    # in parallel: on Windows a refused loopback connect takes ~2 s, so DOWN services add up
    with ThreadPoolExecutor(max_workers=len(services)) as pool:
        results = list(pool.map(lambda s: check_service(s, timeout=args.timeout), services))
    required = [n.strip() for n in args.require.split(",") if n.strip()]
    code = exit_code(results, required)
    gpus = None if args.no_gpu else gpu_memory()
    rows = None if args.no_processes else list_python_processes()
    isaac = None if rows is None else isaac_processes(rows, args.isaac_venv)
    if args.json:
        print(json.dumps({
            "services": [asdict(r) for r in results],
            "required": required,
            "exit_code": code,
            "gpu": None if gpus is None else [{"used_mib": u, "total_mib": t} for u, t in gpus],
            "isaac_processes": None if isaac is None else [asdict(p) for p in isaac],
        }, indent=2))
        return code
    for r in results:
        print(format_line(r))
    if not args.no_gpu:
        if gpus:
            print("GPU   " + "; ".join(f"{u} / {t} MiB used ({t - u} MiB free)" for u, t in gpus))
        else:
            print("GPU   unknown (nvidia-smi not found or failed)")
    if not args.no_processes:
        if isaac is None:
            print("ISAAC unknown (could not list processes)")
        elif not isaac:
            print(f"ISAAC no python process from {args.isaac_venv}")
        else:
            for p in isaac:
                print(f"ISAAC pid {p.pid}: {p.args}")
    down = [n for n in required if not is_up(next(r for r in results if r.name == n))]
    print("all required services up: " + ", ".join(required) if code == 0
          else "required but not up: " + ", ".join(down))
    return code


def _wait(args: argparse.Namespace) -> int:
    services = {s.name: s for s in default_services()}
    if args.service not in services:
        print(f"unknown service {args.service!r}; known: {', '.join(services)}", file=sys.stderr)
        return 2
    r = wait_for(services[args.service], args.timeout, args.interval)
    print(format_line(r))
    return 0 if is_up(r) else 1


def _isaac(args: argparse.Namespace) -> int:
    rows = list_python_processes()
    if rows is None:
        print("could not list processes", file=sys.stderr)
        return 2
    procs = isaac_processes(rows, args.isaac_venv)
    for proc in procs:
        print(f"pid {proc.pid}: {proc.args}")
    return 1 if procs else 0


def main(argv: Sequence[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Read-only health checks for the local services.")
    sub = p.add_subparsers(dest="cmd", required=True)
    st = sub.add_parser("status", help="one line per service, GPU memory, Isaac processes")
    st.add_argument("--json", action="store_true")
    st.add_argument("--require", default=",".join(DEFAULT_REQUIRED),
                    help="comma-separated services that must be up for exit code 0")
    st.add_argument("--timeout", type=float, default=3.0, help="seconds per HTTP check")
    st.add_argument("--isaac-venv", default=ISAAC_VENV)
    st.add_argument("--no-gpu", action="store_true")
    st.add_argument("--no-processes", action="store_true")
    wt = sub.add_parser("wait", help="poll one service until it is up (exit 0) or the timeout passes (exit 1)")
    wt.add_argument("service")
    wt.add_argument("--timeout", type=float, default=60.0)
    wt.add_argument("--interval", type=float, default=1.0)
    pf = sub.add_parser("port-free", help="exit 0 if nothing listens on 127.0.0.1:<port>, else 1")
    pf.add_argument("port", type=int)
    iz = sub.add_parser("isaac", help="list Isaac python processes: exit 0 none, 1 some, 2 unknown")
    iz.add_argument("--isaac-venv", default=ISAAC_VENV)
    args = p.parse_args(argv)
    try:
        if args.cmd == "status":
            return _status(args)
        if args.cmd == "wait":
            return _wait(args)
        if args.cmd == "isaac":
            return _isaac(args)
        return 1 if port_in_use(args.port) else 0
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
