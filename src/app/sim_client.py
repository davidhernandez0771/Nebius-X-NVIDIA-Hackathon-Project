"""HTTP client for the Isaac sim worker, built on the contract in demo_pipeline.sim_protocol.

    client = SimWorkerClient()          # SIM_WORKER_URL, else http://127.0.0.1:8770
    client.health() / .replay(req) / .multiply(req)

Every failure is a SimWorkerError with a message that says what to do:
  * SimWorkerUnavailable: no connection, a timeout, or the worker dropped the connection
    (it crashed or isn't running). Retry later; nothing was recorded on our side.
  * SimWorkerBusy: 409 "busy", the worker runs one job at a time.
  * SimWorkerError: any other error response (status, error code and detail from its
    ErrorResponse), or a 2xx body that breaks the contract.

Read timeouts are per call: health is short, a replay may record cameras, and a
multiply replays n variants, so its timeout grows with n.

Retries (T2's sprint-4 finding: this machine resets ~4% of localhost HTTP responses, WinError 10054, even
from a plain stdlib server). /replay and /multiply are retried up to `retries` (3) times, `retry_wait_s` (10 s)
apart, after a dropped or reset connection and after 409 busy, as sim_worker/http_client.post_json does. Both
are safe to repeat: /multiply reuses finished seeds from disk, /replay re-records the same folder. Not
retried: timeouts (a hung worker; the read timeout is already long), other error answers (they are answers),
and /health (the preflight should fail fast).
"""
from __future__ import annotations

import os
import time
from typing import Callable

import httpx
from pydantic import BaseModel, ValidationError

from demo_pipeline.sim_protocol import (
    DEFAULT_PORT,
    PATHS,
    ErrorResponse,
    HealthResponse,
    MultiplyRequest,
    MultiplyResponse,
    ReplayRequest,
    ReplayResponse,
)

DEFAULT_URL = f"http://127.0.0.1:{DEFAULT_PORT}"
START_HINT = "start the sim worker (sim_worker/server.py) or set SIM_WORKER_URL"


class SimWorkerError(RuntimeError):
    def __init__(self, message: str, *, status: int | None = None, error: str | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.error = error


class SimWorkerUnavailable(SimWorkerError):
    """The worker could not be reached, timed out, or dropped the connection."""


class SimWorkerBusy(SimWorkerError):
    """409 busy: the worker is running another job."""


class _Dropped(Exception):
    """Internal: a dropped or reset connection that _call may retry; carries the error to raise at the end."""

    def __init__(self, error: SimWorkerUnavailable) -> None:
        super().__init__(str(error))
        self.error_ = error


class SimWorkerClient:
    def __init__(
        self,
        base_url: str | None = None,
        *,
        transport: httpx.BaseTransport | None = None,
        connect_timeout: float = 5.0,
        health_timeout: float = 5.0,
        replay_timeout: float = 600.0,
        multiply_timeout_per_variant: float = 120.0,
        retries: int = 3,
        retry_wait_s: float = 10.0,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.base_url = (base_url or os.environ.get("SIM_WORKER_URL") or DEFAULT_URL).rstrip("/")
        self.connect_timeout = connect_timeout
        self.health_timeout = health_timeout
        self.replay_timeout = replay_timeout
        self.multiply_timeout_per_variant = multiply_timeout_per_variant
        self.retries, self.retry_wait_s, self._sleep = retries, retry_wait_s, sleep
        self._http = httpx.Client(base_url=self.base_url, transport=transport)

    # --- calls ------------------------------------------------------------------------

    def health(self) -> HealthResponse:
        return self._call("GET", PATHS["health"], None, HealthResponse, self.health_timeout, retry=False)

    def replay(self, request: ReplayRequest) -> ReplayResponse:
        return self._call("POST", PATHS["replay"], request, ReplayResponse, self.replay_timeout)

    def multiply(self, request: MultiplyRequest) -> MultiplyResponse:
        read = self.replay_timeout + request.n * self.multiply_timeout_per_variant
        return self._call("POST", PATHS["multiply"], request, MultiplyResponse, read)

    # --- plumbing ---------------------------------------------------------------------

    def _call(self, method: str, path: str, body: BaseModel | None, out: type[BaseModel], read_timeout: float,
              retry: bool = True):
        attempts = self.retries + 1 if retry else 1
        for attempt in range(1, attempts + 1):
            try:
                return self._call_once(method, path, body, out, read_timeout, attempt, attempts)
            except (SimWorkerBusy, _Dropped) as e:
                if attempt == attempts:
                    raise (e.error_ if isinstance(e, _Dropped) else e) from None
                self._sleep(self.retry_wait_s)
        raise AssertionError("unreachable")

    def _call_once(self, method: str, path: str, body: BaseModel | None, out: type[BaseModel], read_timeout: float,
                   attempt: int, attempts: int):
        url = f"{self.base_url}{path}"
        timeout = httpx.Timeout(read_timeout, connect=self.connect_timeout)
        content = body.model_dump_json() if body is not None else None
        headers = {"content-type": "application/json"} if body is not None else None
        try:
            resp = self._http.request(method, path, content=content, headers=headers, timeout=timeout)
        except httpx.TransportError as e:  # connect/read/write errors, timeouts, dropped connections
            tried = f" after {attempt} attempts" if attempt > 1 else ""
            error = SimWorkerUnavailable(
                f"sim worker unavailable at {url}{tried}: {type(e).__name__}: {e}; {START_HINT}")
            if isinstance(e, httpx.TimeoutException):
                raise error from e  # a hung worker: retrying would only wait out another read timeout
            raise _Dropped(error) from e
        if resp.status_code >= 400:
            raise self._error(url, resp)
        try:
            return out.model_validate_json(resp.content)
        except ValidationError as e:
            raise SimWorkerError(f"sim worker reply from {url} breaks the contract: {e}",
                                 status=resp.status_code) from e

    @staticmethod
    def _error(url: str, resp: httpx.Response) -> SimWorkerError:
        try:
            err = ErrorResponse.model_validate_json(resp.content)
        except ValidationError:
            return SimWorkerError(f"sim worker {url} answered HTTP {resp.status_code}: {resp.text[:500]}",
                                  status=resp.status_code)
        cls = SimWorkerBusy if resp.status_code == 409 and err.error == "busy" else SimWorkerError
        return cls(f"sim worker {url} answered HTTP {resp.status_code} {err.error}: {err.detail}",
                   status=resp.status_code, error=err.error)

    @property
    def closed(self) -> bool:
        return self._http.is_closed

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "SimWorkerClient":
        return self

    def __exit__(self, *exc) -> None:
        self.close()
