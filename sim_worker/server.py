"""Sim worker HTTP server (contract: demo_pipeline.sim_protocol), one long-lived Isaac process.

Isaac must run on the main thread, so a stdlib ThreadingHTTPServer runs in a daemon thread: it validates each request
with the contract models and hands it to SimWorker, whose one-job slot is executed by the main thread's job loop.
A POST while a job is in flight gets 409 "busy" at once (never two sims). GET /health always answers, with busy set.

Usage (headless, Isaac python):
    C:\\isaac\\env_isaaclab\\Scripts\\python.exe -m sim_worker.server --port 8770 --robot franka [--cameras]
Episodes go to DATA_DIR/episodes/ (demo_pipeline.paths.data_dir).
"""

from __future__ import annotations

import json
import queue
import threading
import traceback
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Protocol

from pydantic import BaseModel, ValidationError

from demo_pipeline.sim_protocol import (
    DEFAULT_PORT,
    PATHS,
    ErrorResponse,
    HealthResponse,
    MultiplyRequest,
    ReplayRequest,
)

REQUESTS: dict[str, type[BaseModel]] = {PATHS["replay"]: ReplayRequest, PATHS["multiply"]: MultiplyRequest}
KINDS = {PATHS["replay"]: "replay", PATHS["multiply"]: "multiply"}


class Busy(Exception):
    """A job is already in flight."""


class Executor(Protocol):
    def execute(self, kind: str, request: BaseModel) -> BaseModel: ...


@dataclass
class _Job:
    kind: str
    request: BaseModel
    done: threading.Event = field(default_factory=threading.Event)
    result: BaseModel | None = None
    error: BaseException | None = None


class SimWorker:
    """One job at a time: submit() (any thread) blocks until serve_jobs() (the main thread) has run it."""

    def __init__(self, executor: Executor, *, robot: str, cameras: bool):
        self.executor, self.robot, self.cameras = executor, robot, cameras
        self._slot = threading.Lock()  # held from submission until the result is handed back
        self._jobs: queue.Queue[_Job] = queue.Queue()

    @property
    def busy(self) -> bool:
        return self._slot.locked()

    def health(self) -> HealthResponse:
        return HealthResponse(ok=True, robots=[self.robot], cameras=self.cameras, busy=self.busy)

    def submit(self, kind: str, request: BaseModel) -> BaseModel:
        if not self._slot.acquire(blocking=False):
            raise Busy("the sim worker is running another job; retry later")
        try:
            job = _Job(kind, request)
            self._jobs.put(job)
            job.done.wait()
            if job.error is not None:
                raise job.error
            return job.result
        finally:
            self._slot.release()

    def run_one(self, timeout: float = 0.2) -> bool:
        """Execute one queued job, if any (main thread). Exceptions go back to the submitter."""
        try:
            job = self._jobs.get(timeout=timeout)
        except queue.Empty:
            return False
        try:
            job.result = self.executor.execute(job.kind, job.request)
        except BaseException as exc:  # noqa: BLE001 - every failure is reported to the client, the loop survives
            traceback.print_exc()
            job.error = exc
        finally:
            job.done.set()
        return True

    def serve_jobs(self, stop: threading.Event) -> None:
        while not stop.is_set():
            self.run_one()


def _status_for(exc: BaseException) -> tuple[int, str]:
    if isinstance(exc, Busy):
        return 409, "busy"
    if isinstance(exc, (ValidationError, ValueError)):  # includes jobs.WrongRobot and camera mismatches
        return 422, "invalid"
    return 500, "sim_error"


def make_http_server(worker: SimWorker, host: str = "127.0.0.1", port: int = DEFAULT_PORT) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def _send(self, status: int, model: BaseModel) -> None:
            body = model.model_dump_json().encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _error(self, status: int, error: str, detail: str) -> None:
            self._send(status, ErrorResponse(error=error, detail=detail))

        def do_GET(self) -> None:  # noqa: N802
            if self.path == PATHS["health"]:
                self._send(200, worker.health())
            else:
                self._error(404, "not_found", f"no GET {self.path}")

        def do_POST(self) -> None:  # noqa: N802
            raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
            model = REQUESTS.get(self.path)
            if model is None:
                self._error(404, "not_found", f"no POST {self.path}")
                return
            try:
                request = model.model_validate_json(raw)
            except ValidationError as exc:
                self._error(422, "invalid", str(exc))
                return
            try:
                self._send(200, worker.submit(KINDS[self.path], request))
            except BaseException as exc:  # noqa: BLE001
                status, error = _status_for(exc)
                self._error(status, error, f"{type(exc).__name__}: {exc}")

        def log_message(self, fmt: str, *args) -> None:
            print(f"[server] {self.address_string()} {fmt % args}", flush=True)

    srv = ThreadingHTTPServer((host, port), Handler)
    srv.daemon_threads = True
    return srv


def main(argv: list[str] | None = None) -> None:
    import argparse
    import sys
    from pathlib import Path

    from isaaclab.app import add_launcher_args, launch_simulation

    from .tracking import add_tracking_args, options_from_args

    parser = argparse.ArgumentParser(description="Isaac sim worker: /health, /replay, /multiply")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--robot", default="franka", choices=["franka", "openarm", "flexiv"])
    parser.add_argument("--cameras", action="store_true")
    add_tracking_args(parser)
    add_launcher_args(parser)
    args = parser.parse_args(argv)
    if args.cameras:
        args.enable_cameras = True

    from demo_pipeline.paths import data_dir

    from .isaac_executor import IsaacExecutor
    from .replay import make_sim_cfg

    root = Path(data_dir())
    with launch_simulation(make_sim_cfg(args.device), args):
        executor = IsaacExecutor(robot=args.robot, cameras=args.cameras, root=root, tracking=options_from_args(args))
        executor.warm_up()  # build the sim session now, on the main thread, before serving
        worker = SimWorker(executor, robot=args.robot, cameras=args.cameras)
        srv = make_http_server(worker, args.host, args.port)
        threading.Thread(target=srv.serve_forever, daemon=True, name="http").start()
        print(json.dumps({"event": "ready", "url": f"http://{args.host}:{args.port}", "robot": args.robot,
                          "cameras": args.cameras, "episodes": str(root / "episodes")}), flush=True)
        stop = threading.Event()
        try:
            worker.serve_jobs(stop)
        except KeyboardInterrupt:
            print("[server] stopping", flush=True)
        finally:
            srv.shutdown()
            sys.stdout.flush()


if __name__ == "__main__":
    main()
