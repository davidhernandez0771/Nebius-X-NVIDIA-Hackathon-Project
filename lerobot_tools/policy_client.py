"""Client for lerobot_tools.policy_server. Stdlib + numpy only, so the Isaac env can import it with no new installs.

    client = PolicyClient("http://127.0.0.1:8765")
    client.reset()                                   # at the start of every episode
    action = client.act(joint_pos, {"front": rgb_hwc_uint8, "wrist": rgb_hwc_uint8})   # -> (9,) float32

Latency check against a running server:
    python -m lerobot_tools.policy_client --url http://127.0.0.1:8765 --bench 50
"""

from __future__ import annotations

import argparse
import base64
import json
import time
import urllib.error
import urllib.request

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

    def _call(self, method: str, path: str, body: dict | None = None) -> dict:
        data = None if body is None else json.dumps(body).encode("utf-8")
        req = urllib.request.Request(self.url + path, data=data, method=method,
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            try:
                detail = json.loads(e.read().decode("utf-8")).get("error", "")
            except (ValueError, AttributeError):
                detail = ""
            raise PolicyServerError(f"{method} {path} -> {e.code}: {detail}", status=e.code) from e
        except (urllib.error.URLError, OSError) as e:  # refused, timeout, reset
            raise PolicyServerError(f"{method} {path}: cannot reach {self.url}: {e}") from e

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
