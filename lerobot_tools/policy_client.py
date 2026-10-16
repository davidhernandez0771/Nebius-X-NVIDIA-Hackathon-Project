"""Client for lerobot_tools.policy_server. Stdlib + numpy only, so the Isaac env can import it with no new installs.

    client = PolicyClient("http://127.0.0.1:8765")
    client.reset()                                   # at the start of every episode
    action = client.act(joint_pos, {"front": rgb_hwc_uint8, "wrist": rgb_hwc_uint8})   # -> (9,) float32
    client.close()                                   # or use it as a context manager

One HTTP/1.1 keep-alive connection is reused for every call (thread-safe; calls are serialized). Windows loopback
resets ~1 in 2,000-3,000 *new* TCP connections (WinError 10054, measured 2026-10-16), so one connection per eval
instead of one per call removes those failures. If the server has dropped the idle connection, the client
reconnects and resends once; that is the only automatic retry.

Latency check against a running server:
    python -m lerobot_tools.policy_client --url http://127.0.0.1:8765 --bench 50
"""

from __future__ import annotations

import argparse
import base64
import http.client
import json
import threading
import time
import urllib.parse

import numpy as np


class PolicyServerError(RuntimeError):
    """The server answered with an error (`status` is the HTTP code) or could not be reached (`status` is None)."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class PolicyClient:
    def __init__(self, url: str = "http://127.0.0.1:8765", timeout: float = 30.0):
        self.url = url.rstrip("/")
        self.timeout = timeout
        parts = urllib.parse.urlsplit(self.url)
        if parts.scheme != "http" or not parts.hostname:
            raise ValueError(f"expected an http://host:port URL, got {url!r}")
        self._host, self._port, self._prefix = parts.hostname, parts.port or 80, parts.path
        self._conn: http.client.HTTPConnection | None = None
        self._lock = threading.Lock()

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    def __enter__(self) -> PolicyClient:
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def _send(self, method: str, path: str, data: bytes | None) -> tuple[int, bytes]:
        if self._conn is None:
            self._conn = http.client.HTTPConnection(self._host, self._port, timeout=self.timeout)
        headers = {"Content-Type": "application/json"} if data is not None else {}
        self._conn.request(method, self._prefix + path, body=data, headers=headers)
        resp = self._conn.getresponse()
        return resp.status, resp.read()  # http.client closes the socket itself if the server said "close"

    def _call(self, method: str, path: str, body: dict | None = None) -> dict:
        data = None if body is None else json.dumps(body).encode("utf-8")
        with self._lock:
            try:
                reused = self._conn is not None and self._conn.sock is not None
                try:
                    status, raw = self._send(method, path, data)
                except (http.client.RemoteDisconnected, ConnectionResetError, ConnectionAbortedError,
                        BrokenPipeError):
                    # The server closed the kept-alive connection (idle timeout) before reading this request:
                    # reconnect and send it once more. A fresh connection that fails is reported, not retried.
                    self.close()
                    if not reused:
                        raise
                    status, raw = self._send(method, path, data)
            except (OSError, http.client.HTTPException) as e:  # refused, timeout, reset
                self.close()
                raise PolicyServerError(f"{method} {path}: cannot reach {self.url}: {e}") from e
        if status >= 400:
            try:
                detail = json.loads(raw.decode("utf-8")).get("error", "")
            except (ValueError, AttributeError):
                detail = ""
            raise PolicyServerError(f"{method} {path} -> {status}: {detail}", status=status)
        return json.loads(raw.decode("utf-8"))

    def health(self) -> dict:
        return self._call("GET", "/health")

    def reset(self) -> None:
        self._call("POST", "/reset", {})

    def act(self, state: np.ndarray, images: dict[str, np.ndarray]) -> np.ndarray:
        """state: (state_dim,) joint positions. images: camera name -> HxWx3 uint8 RGB, all the same size."""
        sizes = set()
        encoded = {}
        for cam, img in images.items():
            img = np.asarray(img)
            if img.dtype != np.uint8 or img.ndim != 3 or img.shape[2] != 3:
                raise ValueError(f"image {cam!r} must be HxWx3 uint8, got {img.dtype} {img.shape}")
            sizes.add(img.shape[:2])
            encoded[cam] = base64.b64encode(np.ascontiguousarray(img).tobytes()).decode("ascii")
        if len(sizes) > 1:
            raise ValueError(f"all images must share one size, got {sorted(sizes)}")
        h, w = sizes.pop() if sizes else (0, 0)
        body = {"state": [float(x) for x in np.asarray(state).ravel()], "images": encoded, "h": h, "w": w}
        return np.asarray(self._call("POST", "/act", body)["action"], dtype=np.float32)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Round-trip latency against a running policy server")
    p.add_argument("--url", default="http://127.0.0.1:8765")
    p.add_argument("--bench", type=int, default=50, help="number of /act calls (the first 5 are warmup)")
    args = p.parse_args(argv)
    client = PolicyClient(args.url)
    health = client.health()
    rng = np.random.default_rng(0)
    imgs = {cam: rng.integers(0, 256, size=(h, w, 3), dtype=np.uint8) for cam, (h, w) in health["cameras"].items()}
    state = np.zeros(health["state_dim"])
    client.reset()
    times = []
    for _ in range(args.bench):
        t0 = time.perf_counter()
        client.act(state, imgs)
        times.append(time.perf_counter() - t0)
    ms = np.array(times[5:] or times) * 1000
    print(json.dumps({"health": health, "n": len(ms), "first_ms": round(times[0] * 1000, 1),
                      "median_ms": round(float(np.median(ms)), 1), "p95_ms": round(float(np.percentile(ms, 95)), 1),
                      "max_ms": round(float(ms.max()), 1)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
