"""RetryingPolicy: one retry on connection resets (WinError 10054 on Windows loopback), never on HTTP errors."""

from __future__ import annotations

import numpy as np
import pytest

from lerobot_tools.policy_client import PolicyServerError
from sim_eval.retry import RetryingPolicy

RESET = PolicyServerError("POST /act: cannot reach http://127.0.0.1:8765: [WinError 10054] reset")


class Flaky:
    """Raises the queued errors first, then answers."""

    def __init__(self, act_errors=(), reset_errors=()):
        self.act_errors, self.reset_errors = list(act_errors), list(reset_errors)
        self.act_calls = self.reset_calls = 0

    def reset(self):
        self.reset_calls += 1
        if self.reset_errors:
            raise self.reset_errors.pop(0)

    def act(self, state, images):
        self.act_calls += 1
        if self.act_errors:
            raise self.act_errors.pop(0)
        return np.ones(9, dtype=np.float32)


def test_one_connection_reset_is_retried_and_counted():
    inner = Flaky(act_errors=[RESET])
    p = RetryingPolicy(inner)
    np.testing.assert_array_equal(p.act(np.zeros(9), {}), np.ones(9))
    assert inner.act_calls == 2 and p.retries == 1


def test_two_resets_in_a_row_give_up():
    p = RetryingPolicy(Flaky(act_errors=[RESET, RESET]))
    with pytest.raises(PolicyServerError, match="10054"):
        p.act(np.zeros(9), {})
    assert p.retries == 1


def test_http_errors_are_not_retried():
    inner = Flaky(act_errors=[PolicyServerError("POST /act -> 500: boom", status=500)])
    with pytest.raises(PolicyServerError, match="500"):
        RetryingPolicy(inner).act(np.zeros(9), {})
    assert inner.act_calls == 1


def test_non_server_errors_are_not_retried():
    inner = Flaky(act_errors=[ValueError("image must be uint8")])
    with pytest.raises(ValueError):
        RetryingPolicy(inner).act(np.zeros(9), {})
    assert inner.act_calls == 1


def test_reset_is_retried_too():
    inner = Flaky(reset_errors=[RESET])
    p = RetryingPolicy(inner)
    p.reset()
    assert inner.reset_calls == 2 and p.retries == 1
