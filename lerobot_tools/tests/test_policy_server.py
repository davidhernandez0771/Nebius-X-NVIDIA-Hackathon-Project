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
