"""Policy server + stdlib client.

Protocol tests use a fake runner, so they run in any venv. The real-checkpoint test needs lerobot and the sprint-1
smoke checkpoint (git-ignored data/runs/...; override with T3_CHECKPOINT).
"""

from __future__ import annotations

import os
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
import pytest

from lerobot_tools.policy_client import PolicyClient, PolicyServerError
from lerobot_tools.policy_server import make_server

REPO = Path(__file__).parents[2]
SMOKE_CKPT = REPO / "data/runs/t3_act_smoke_20261015_170519/train/checkpoints/000300/pretrained_model"


class FakeRunner:
    state_dim = 9
    cameras = {"front": (4, 6), "wrist": (4, 6)}

    def __init__(self):
        self.resets, self.seen = 0, []

    def describe(self) -> dict:
        return {"checkpoint": "fake", "device": "cpu"}

    def reset(self) -> None:
        self.resets += 1

    def act(self, state: np.ndarray, images: dict[str, np.ndarray]) -> np.ndarray:
        if state[0] == -999:
            raise RuntimeError("policy blew up")
        self.seen.append((state, images))
        return np.arange(9, dtype=np.float32) + state[0]


def _serve(runner):
    server = make_server(runner, "127.0.0.1", 0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


@pytest.fixture
def fake():
    runner = FakeRunner()
    server, url = _serve(runner)
    yield runner, PolicyClient(url)
    server.shutdown()
    server.server_close()


def _images(h=4, w=6, seed=0):
    rng = np.random.default_rng(seed)
    return {cam: rng.integers(0, 256, size=(h, w, 3), dtype=np.uint8) for cam in ("front", "wrist")}


def test_health_reports_what_the_policy_expects(fake):
    _, client = fake
    h = client.health()
    assert h["ok"] is True
    assert h["state_dim"] == 9
    assert h["cameras"] == {"front": [4, 6], "wrist": [4, 6]}


def test_act_round_trips_state_and_images_exactly(fake):
    runner, client = fake
    imgs = _images()
    state = np.linspace(0, 1, 9)
    action = client.act(state, imgs)
    assert action.shape == (9,) and action.dtype == np.float32
    np.testing.assert_allclose(action, np.arange(9) + 0.0)
    got_state, got_imgs = runner.seen[0]
    np.testing.assert_allclose(got_state, state.astype(np.float32))
    for cam in imgs:
        assert got_imgs[cam].dtype == np.uint8
        np.testing.assert_array_equal(got_imgs[cam], imgs[cam])


def test_reset_reaches_the_runner(fake):
    runner, client = fake
    client.reset()
    client.reset()
    assert runner.resets == 2


@pytest.mark.parametrize("state, images, msg", [
    (np.zeros(8), _images(), "state"),
    (np.zeros(9), {"front": _images()["front"]}, "wrist"),
    (np.zeros(9), _images(h=5), "4x6"),
])
def test_bad_requests_get_400_with_a_reason(fake, state, images, msg):
    _, client = fake
    with pytest.raises(PolicyServerError) as e:
        client.act(state, images)
    assert e.value.status == 400
    assert msg in str(e.value)


def test_client_rejects_non_uint8_images_before_sending(fake):
    _, client = fake
    with pytest.raises(ValueError, match="uint8"):
        client.act(np.zeros(9), {k: v.astype(np.float32) for k, v in _images().items()})


def test_malformed_json_and_unknown_route(fake):
    _, client = fake
    req = urllib.request.Request(client.url + "/act", data=b"{not json", method="POST",
                                 headers={"Content-Type": "application/json"})
    with pytest.raises(urllib.error.HTTPError) as e:
        urllib.request.urlopen(req, timeout=5)
    assert e.value.code == 400
    with pytest.raises(urllib.error.HTTPError) as e:
        urllib.request.urlopen(client.url + "/nope", timeout=5)
    assert e.value.code == 404


def test_policy_exception_is_a_500_and_the_server_survives(fake):
    _, client = fake
    with pytest.raises(PolicyServerError) as e:
        client.act(np.full(9, -999.0), _images())
    assert e.value.status == 500 and "policy blew up" in str(e.value)
    assert client.act(np.zeros(9), _images()).shape == (9,)


def test_unreachable_server_raises_policy_server_error():
    with pytest.raises(PolicyServerError):
        PolicyClient("http://127.0.0.1:9", timeout=2).health()


def test_real_smoke_checkpoint_gives_a_finite_action():
    pytest.importorskip("lerobot")
    import torch

    from lerobot_tools.policy_server import PolicyRunner

    ckpt = Path(os.environ.get("T3_CHECKPOINT", SMOKE_CKPT))
    if not ckpt.exists():
        pytest.skip(f"no checkpoint at {ckpt}")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    runner = PolicyRunner(ckpt, device=device)
    assert runner.state_dim == 9 and set(runner.cameras) == {"front", "wrist"}
    server, url = _serve(runner)
    try:
        client = PolicyClient(url)
        client.reset()
        h, w = runner.cameras["front"]
        imgs = _images(h, w)
        times = []
        for i in range(30):
            t0 = time.perf_counter()
            action = client.act(np.zeros(9), imgs)
            times.append(time.perf_counter() - t0)
            assert action.shape == (9,) and np.isfinite(action).all()
        client.reset()
        ms = np.array(times[5:]) * 1000
        print(f"\nT3 policy round trip on {device}: first {times[0]*1000:.1f} ms, then median {np.median(ms):.1f} ms,"
              f" p95 {np.percentile(ms, 95):.1f} ms, max {ms.max():.1f} ms (n={len(ms)})")
    finally:
        server.shutdown()
        server.server_close()


# -- keep-alive (HTTP/1.1 persistent connection) ---------------------------------------------------------------------
# Windows loopback resets ~1 in 2,000-3,000 *new* TCP connections (WinError 10054, measured 2026-10-16), so the client
# keeps one connection open for the whole eval instead of opening one per call.


def _serve_counting(runner, **kw):
    """Like _serve, but counts the TCP connections the server accepts."""
    server = make_server(runner, "127.0.0.1", 0, **kw)
    accepted = []
    get_request = server.get_request

    def counting_get_request():
        conn = get_request()
        accepted.append(conn[1])
        return conn

    server.get_request = counting_get_request
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}", accepted


@pytest.fixture
def counted():
    runner = FakeRunner()
    server, url, accepted = _serve_counting(runner)
    client = PolicyClient(url)
    yield runner, client, accepted
    client.close()
    server.shutdown()
    server.server_close()


def test_many_calls_share_one_connection(counted):
    _, client, accepted = counted
    client.health()
    client.reset()
    for _ in range(50):
        client.act(np.zeros(9), _images())
    assert len(accepted) == 1


def test_error_responses_keep_the_connection_usable(counted):
    _, client, accepted = counted
    with pytest.raises(PolicyServerError) as e:
        client.act(np.zeros(8), _images())
    assert e.value.status == 400
    with pytest.raises(PolicyServerError) as e:
        client.act(np.full(9, -999.0), _images())
    assert e.value.status == 500
    np.testing.assert_allclose(client.act(np.ones(9), _images()), np.arange(9) + 1.0)
    assert len(accepted) == 1


def test_unknown_route_body_is_drained_so_the_next_request_parses(counted):
    _, client, accepted = counted
    with pytest.raises(PolicyServerError) as e:
        client._call("POST", "/nope", {"state": [0.0] * 9, "padding": "x" * 5000})
    assert e.value.status == 404
    assert client.health()["ok"] is True
    assert len(accepted) == 1


def test_client_reconnects_after_the_server_drops_an_idle_connection():
    runner = FakeRunner()
    server, url, accepted = _serve_counting(runner, idle_timeout=0.2)
    client = PolicyClient(url)
    try:
        client.reset()
        time.sleep(0.6)  # the server closes the idle connection
        np.testing.assert_allclose(client.act(np.zeros(9), _images()), np.arange(9))
        assert runner.resets == 1 and len(runner.seen) == 1  # nothing sent twice
        assert len(accepted) == 2
    finally:
        client.close()
        server.shutdown()
        server.server_close()


def test_client_works_with_a_close_after_each_response_server():
    """An HTTP/1.0 server (the sprint-2 one) closes after every response; the client must just reconnect."""
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    class OneShot(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"

        def log_message(self, *a):
            pass

        def do_GET(self):
            data = b'{"ok": true}'
            self.send_response(200)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    server = ThreadingHTTPServer(("127.0.0.1", 0), OneShot)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    client = PolicyClient(f"http://127.0.0.1:{server.server_address[1]}")
    try:
        assert [client.health()["ok"] for _ in range(3)] == [True] * 3
    finally:
        client.close()
        server.shutdown()
        server.server_close()


# --- inference options (lerobot_tools.inference): the server applies --n-action-steps / --temporal-ensemble ---------

def test_the_server_takes_the_inference_flags_and_not_the_gripper_one():
    from lerobot_tools.policy_server import build_parser

    args = build_parser().parse_args(["--checkpoint", "x", "--n-action-steps", "20"])
    assert (args.n_action_steps, args.temporal_ensemble) == (20, None)
    assert build_parser().parse_args(["--checkpoint", "x", "--temporal-ensemble", "0.01"]).temporal_ensemble == 0.01
    plain = build_parser().parse_args(["--checkpoint", "x"])
    assert (plain.n_action_steps, plain.temporal_ensemble) == (None, None)  # default: the checkpoint's own
    with pytest.raises(SystemExit):
        build_parser().parse_args(["--checkpoint", "x", "--binarize-gripper"])  # eval-side only


def test_health_carries_the_runners_inference_settings():
    class Tuned(FakeRunner):
        def describe(self):
            return {**super().describe(), "inference": {"overrides": {"n_action_steps": 20}, "n_action_steps": 20}}

    server, url = _serve(Tuned())
    try:
        assert PolicyClient(url).health()["inference"]["overrides"] == {"n_action_steps": 20}
    finally:
        server.shutdown()
        server.server_close()


def test_a_real_checkpoint_loads_with_the_overrides_on_cpu():
    pytest.importorskip("lerobot")
    from lerobot_tools.inference import InferenceOptions
    from lerobot_tools.policy_server import PolicyRunner

    ckpt = Path(os.environ.get("T3_CHECKPOINT", SMOKE_CKPT))
    if not ckpt.exists():
        pytest.skip(f"no checkpoint at {ckpt}")
    plain = PolicyRunner(ckpt, device="cpu")
    assert plain.describe()["inference"]["overrides"] == {}
    replan = PolicyRunner(ckpt, device="cpu", inference=InferenceOptions(n_action_steps=20))
    assert replan.policy.config.n_action_steps == 20 and replan.describe()["inference"]["n_action_steps"] == 20
    ens = PolicyRunner(ckpt, device="cpu", inference=InferenceOptions(temporal_ensemble_coeff=0.01))
    assert ens.policy.config.n_action_steps == 1 and hasattr(ens.policy, "temporal_ensembler")
    ens.reset()
    h, w = ens.cameras["front"]
    a = [ens.act(np.zeros(9, dtype=np.float32), _images(h, w)) for _ in range(3)]
    assert all(x.shape == (9,) and np.isfinite(x).all() for x in a)
