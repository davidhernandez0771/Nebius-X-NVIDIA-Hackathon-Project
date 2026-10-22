"""HTTP policy server, so the Isaac env can evaluate a LeRobot checkpoint without importing lerobot or torch.

    C:\\venvs\\lerobot\\Scripts\\python.exe -m lerobot_tools.policy_server --checkpoint <dir> --port 8765

<dir> may be a `pretrained_model/` dir, a step checkpoint dir, or a run output dir (uses checkpoints/last.txt).
--n-action-steps N / --temporal-ensemble COEF (lerobot_tools.inference; default off: the checkpoint's own settings)
change how the loaded policy executes its chunks. /health reports them under "inference".

Routes (JSON):
    GET  /health -> {"ok": true, "state_dim": 9, "cameras": {"front": [h, w], ...}, "checkpoint": ..., "device": ...,
                     "inference": {"overrides": {...}, "chunk_size": 100, "n_action_steps": 100, ...}}
    POST /reset  -> {"ok": true}           clears the policy's action queue; call it at every episode start
    POST /act    {"state": [9 floats], "images": {"front": "<base64 raw uint8 HxWx3>", ...}, "h": 128, "w": 128}
                 -> {"action": [9 floats]}
Errors: 400 for a bad request (with the reason), 404 for an unknown route, 500 if the policy raises.
Connections are HTTP/1.1 keep-alive (one TCP connection per client for a whole eval); the server drops a
connection after `idle_timeout` seconds without a request.
Client: lerobot_tools/policy_client.py (stdlib + numpy).
"""

from __future__ import annotations

import argparse
import base64
import binascii
import json
import logging
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Protocol

import numpy as np

from lerobot_tools.inference import InferenceOptions, add_inference_args, apply_to_config, config_record

log = logging.getLogger("policy_server")
IMAGE_PREFIX = "observation.images."
IDLE_TIMEOUT_S = 60.0  # drop a client's keep-alive connection after this long without a request


class Runner(Protocol):
    state_dim: int
    cameras: dict[str, tuple[int, int]]  # camera name -> (h, w) the policy expects

    def describe(self) -> dict: ...
    def reset(self) -> None: ...
    def act(self, state: np.ndarray, images: dict[str, np.ndarray]) -> np.ndarray: ...


class BadRequest(ValueError):
    pass


def resolve_pretrained_dir(path: Path) -> Path:
    """Accept a pretrained_model dir, a step checkpoint dir, or a run output dir (via checkpoints/last.txt)."""
    path = Path(path)
    if (path / "config.json").is_file():
        return path
    if (path / "pretrained_model" / "config.json").is_file():
        return path / "pretrained_model"
    from lerobot_tools.train import resolve_last_checkpoint

    return resolve_last_checkpoint(path) / "pretrained_model"


def decode_act_request(body: dict, state_dim: int, cameras: dict[str, tuple[int, int]]):
    """Validate an /act body against what the policy expects. Returns (state float32, {camera: HxWx3 uint8})."""
    if not isinstance(body, dict):
        raise BadRequest("body must be a JSON object")
    try:
        state = np.asarray(body["state"], dtype=np.float32)
    except (KeyError, TypeError, ValueError) as e:
        raise BadRequest(f"state: expected a list of {state_dim} floats ({e})") from e
    if state.shape != (state_dim,) or not np.isfinite(state).all():
        raise BadRequest(f"state: expected {state_dim} finite floats, got shape {state.shape}")
    images_in = body.get("images") or {}
    if not isinstance(images_in, dict):
        raise BadRequest("images: expected an object of camera -> base64")
    h, w = body.get("h"), body.get("w")
    images = {}
    for cam, (eh, ew) in cameras.items():
        if cam not in images_in:
            raise BadRequest(f"images: missing camera {cam!r} (policy needs {sorted(cameras)})")
        if (h, w) != (eh, ew):
            raise BadRequest(f"images: policy expects {eh}x{ew}, request says {h}x{w}")
        try:
            raw = base64.b64decode(images_in[cam], validate=True)
        except (binascii.Error, TypeError, ValueError) as e:
            raise BadRequest(f"images[{cam!r}]: bad base64 ({e})") from e
        if len(raw) != eh * ew * 3:
            raise BadRequest(f"images[{cam!r}]: {len(raw)} bytes, expected {eh}x{ew}x3 = {eh * ew * 3}")
        images[cam] = np.frombuffer(raw, dtype=np.uint8).reshape(eh, ew, 3)
    return state, images


class PolicyRunner:
    """Loads a LeRobot checkpoint (any policy type) with its saved pre/post-processors."""

    def __init__(self, checkpoint: Path, device: str = "cuda", task: str | None = None,
                 inference: InferenceOptions | None = None):
        from lerobot.configs import PreTrainedConfig
        from lerobot.policies.factory import get_policy_class, make_pre_post_processors

        from demo_pipeline.rules import TASK_TEXT

        self.checkpoint = resolve_pretrained_dir(checkpoint)
        self.device = device
        self.task = task or TASK_TEXT
        cfg = PreTrainedConfig.from_pretrained(str(self.checkpoint))
        cfg.device = device
        overrides = apply_to_config(cfg, inference or InferenceOptions())  # before the policy is built from cfg
        self.policy = get_policy_class(cfg.type).from_pretrained(str(self.checkpoint), config=cfg)
        self.policy.to(device).eval()
        self.pre, self.post = make_pre_post_processors(
            self.policy.config, pretrained_path=str(self.checkpoint),
            preprocessor_overrides={"device_processor": {"device": device}},
        )
        self.policy_type = cfg.type
        self.inference = config_record(self.policy.config, overrides)
        self.state_dim = int(cfg.robot_state_feature.shape[0])
        self.cameras = {k[len(IMAGE_PREFIX):]: (int(ft.shape[1]), int(ft.shape[2]))  # (C, H, W)
                        for k, ft in cfg.image_features.items()}

    def describe(self) -> dict:
        return {"checkpoint": str(self.checkpoint), "device": self.device, "policy_type": self.policy_type,
                "inference": self.inference}

    def reset(self) -> None:
        self.policy.reset()
        self.pre.reset()
        self.post.reset()

    def act(self, state: np.ndarray, images: dict[str, np.ndarray]) -> np.ndarray:
        import torch

        obs = {"observation.state": torch.from_numpy(np.array(state, dtype=np.float32)), "task": self.task}
        for cam, img in images.items():  # HWC uint8 -> CHW float in [0, 1], like LeRobotDataset frames
            obs[IMAGE_PREFIX + cam] = torch.from_numpy(np.array(img)).permute(2, 0, 1).float().div_(255.0)
        with torch.inference_mode():
            action = self.post(self.policy.select_action(self.pre(obs)))
        return action.squeeze(0).float().cpu().numpy()


def make_server(runner: Runner, host: str = "127.0.0.1", port: int = 8765,
                idle_timeout: float = IDLE_TIMEOUT_S) -> ThreadingHTTPServer:
    lock = threading.Lock()  # the policy is stateful (action queue): one request at a time

    class Handler(BaseHTTPRequestHandler):
        # Keep-alive: every response carries Content-Length, and every request body is read in full (even on a 404),
        # so the next request on the same connection parses cleanly.
        protocol_version = "HTTP/1.1"
        timeout = idle_timeout

        def log_message(self, fmt, *args):
            log.debug("%s " + fmt, self.address_string(), *args)

        def _send(self, code: int, payload: dict):
            data = json.dumps(payload).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _read_body(self) -> bytes | None:
            """The raw request body, or None after answering 400 (and closing) for a bad Content-Length."""
            try:
                n = int(self.headers.get("Content-Length") or 0)
                if n < 0:
                    raise ValueError(n)
            except ValueError:
                self.close_connection = True  # can't tell where this body ends
                self._send(400, {"error": f"bad Content-Length {self.headers.get('Content-Length')!r}"})
                return None
            return self.rfile.read(n) if n else b""

        @staticmethod
        def _json(raw: bytes) -> dict:
            try:
                return json.loads(raw.decode("utf-8")) if raw else {}
            except (UnicodeDecodeError, json.JSONDecodeError) as e:
                raise BadRequest(f"invalid JSON: {e}") from e

        def do_GET(self):
            if self._read_body() is None:
                return
            if self.path != "/health":
                return self._send(404, {"error": f"no route GET {self.path}"})
            self._send(200, {"ok": True, "state_dim": runner.state_dim,
                             "cameras": {c: list(hw) for c, hw in runner.cameras.items()}, **runner.describe()})

        def do_POST(self):
            raw = self._read_body()
            if raw is None:
                return
            if self.path not in ("/reset", "/act"):
                return self._send(404, {"error": f"no route POST {self.path}"})
            try:
                body = self._json(raw)
                if self.path == "/reset":
                    with lock:
                        runner.reset()
                    return self._send(200, {"ok": True})
                state, images = decode_act_request(body, runner.state_dim, runner.cameras)
                with lock:
                    action = np.asarray(runner.act(state, images), dtype=np.float32).ravel()
                if not np.isfinite(action).all():
                    return self._send(500, {"error": f"policy returned a non-finite action {action.tolist()}"})
                self._send(200, {"action": action.tolist()})
            except BadRequest as e:
                self._send(400, {"error": str(e)})
            except Exception as e:  # keep serving; the caller records the failure
                log.exception("policy error on %s", self.path)
                self._send(500, {"error": f"{type(e).__name__}: {e}"})

    return ThreadingHTTPServer((host, port), Handler)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--checkpoint", type=Path, required=True)
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--device", default="cuda")
    add_inference_args(p, gripper=False)
    return p


def main(argv: list[str] | None = None) -> int:
    from sim_worker.teleop_qos import full_speed

    full_speed()  # out of Windows power throttling (per process: a child does not inherit it)
    p = build_parser()
    args = p.parse_args(argv)
    try:
        inference = InferenceOptions.from_args(args)
    except ValueError as e:
        p.error(str(e))
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    runner = PolicyRunner(args.checkpoint, device=args.device, inference=inference)
    server = make_server(runner, args.host, args.port)
    log.info("serving %s on http://%s:%d (state_dim=%d, cameras=%s, inference=%s)", runner.checkpoint, args.host,
             server.server_address[1], runner.state_dim, runner.cameras, runner.inference)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
