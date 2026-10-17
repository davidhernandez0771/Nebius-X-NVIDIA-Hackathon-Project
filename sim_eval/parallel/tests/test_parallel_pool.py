"""The policy pool: N policy sessions behind N ports in one process, and the checks that they serve one checkpoint."""

from __future__ import annotations

import numpy as np
import pytest

from lerobot_tools.policy_client import PolicyClient
from sim_eval.parallel.pool import check_pool, pool_urls, serve_pool

HEALTH = {"ok": True, "state_dim": 9, "cameras": {"front": [128, 128], "wrist": [128, 128]},
          "checkpoint": "C:/runs/raw_10/checkpoints/010000/pretrained_model", "device": "cuda",
          "policy_type": "act"}


class CountingRunner:
    """Stateful like ACT: act() returns how many calls this session has had since reset."""

    state_dim = 9
    cameras = {"front": (4, 4)}

    def __init__(self, name: str):
        self.name, self.calls = name, 0

    def describe(self) -> dict:
        return {"checkpoint": "ckpt", "device": "cpu", "policy_type": "fake", "session": self.name}

    def reset(self) -> None:
        self.calls = 0

    def act(self, state, images):
        self.calls += 1
        return np.full(9, float(self.calls), dtype=np.float32)


def test_pool_urls_are_consecutive_ports():
    assert pool_urls(3, base_port=8770) == ["http://127.0.0.1:8770", "http://127.0.0.1:8771", "http://127.0.0.1:8772"]
    with pytest.raises(ValueError):
        pool_urls(0, base_port=8770)


def test_a_pool_serving_one_checkpoint_passes():
    assert check_pool([dict(HEALTH), dict(HEALTH)]) == []


@pytest.mark.parametrize("field,value", [("checkpoint", "C:/runs/raw_multiply_10/x"), ("policy_type", "diffusion"),
                                         ("state_dim", 7), ("cameras", {"front": [128, 128]})])
def test_a_pool_whose_sessions_disagree_is_refused(field, value):
    other = dict(HEALTH, **{field: value})
    problems = check_pool([dict(HEALTH), other])
    assert len(problems) == 1 and field in problems[0] and "session 1" in problems[0]


def test_an_empty_pool_is_refused():
    assert check_pool([]) != []


def test_each_port_serves_its_own_session_state():
    runners = [CountingRunner("a"), CountingRunner("b")]
    servers = serve_pool(runners, base_port=0)  # 0: let the OS pick free ports
    try:
        urls = [f"http://127.0.0.1:{s.server_address[1]}" for s in servers]
        img = {"front": np.zeros((4, 4, 3), dtype=np.uint8)}
        with PolicyClient(urls[0]) as a, PolicyClient(urls[1]) as b:
            assert [a.health()["session"], b.health()["session"]] == ["a", "b"]
            a.reset(), b.reset()
            for _ in range(3):
                a.act(np.zeros(9), img)
            assert b.act(np.zeros(9), img)[0] == 1.0  # b's queue is untouched by a's calls
            assert a.act(np.zeros(9), img)[0] == 4.0
    finally:
        for s in servers:
            s.shutdown()
            s.server_close()
