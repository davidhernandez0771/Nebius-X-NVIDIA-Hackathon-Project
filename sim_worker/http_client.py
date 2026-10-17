"""Stdlib JSON POST to the sim worker, with retries for dropped connections and 409 busy.

Measured (T2 note, sprint 4 Task 3): 1 of 15 long /multiply requests got WinError 10054 (connection reset) while
reading a 200 response the worker had finished and logged; no power or network event at the time. /multiply is
idempotent by seed (finished variants are reused from disk), so retrying returns at once. 4xx/5xx other than 409
are not retried: they are answers, not transport failures.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request


class WorkerError(RuntimeError):
    def __init__(self, status: int, body: str):
        super().__init__(f"sim worker answered {status}: {body}")
        self.status, self.body = status, body


def post_json(url: str, body: bytes, *, timeout: float = 6 * 3600, retries: int = 3, wait_s: float = 10.0,
              log=print) -> dict:
    last: Exception | None = None
    for attempt in range(retries + 1):
        if attempt:
            log(f"[client] retry {attempt}/{retries} after {last!r}")
            time.sleep(wait_s)
        req = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            text = e.read().decode(errors="replace")
            if e.code != 409:
                raise WorkerError(e.code, text) from None
            last = WorkerError(409, text)
        except (ConnectionError, urllib.error.URLError, TimeoutError) as e:
            last = e
    if isinstance(last, WorkerError):
        raise last
    raise ConnectionError(f"sim worker unreachable after {retries + 1} attempts: {last!r}")
