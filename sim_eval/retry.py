"""Retry a policy call once when the TCP connection is reset.

Measured 2026-10-16: PolicyClient opens one TCP connection per request (the server speaks HTTP/1.0), and on
Windows loopback about 1 in 2,000-3,000 connections is reset (WinError 10054). A 1,500-step episode makes 1,500
calls, so without a retry roughly 40% of episodes would end in a spurious policy_error. A persistent HTTP/1.1
connection showed 0 resets in 9,000 calls and was 6x faster; that fix belongs in lerobot_tools (see the T3 note).

Only connection-level failures (PolicyServerError.status is None) are retried, once. HTTP errors (4xx/5xx) and
anything else propagate unchanged. Caveat: if the server had already answered before the reset, the retried /act
returns the policy's *next* queued action, so one action is skipped. That costs a 20 ms glitch instead of losing the
episode.
"""

from __future__ import annotations

import numpy as np

from lerobot_tools.policy_client import PolicyServerError


class RetryingPolicy:
    def __init__(self, inner):
        self.inner = inner
        self.retries = 0

    def _call(self, fn, *args):
        try:
            return fn(*args)
        except PolicyServerError as e:
            if e.status is not None:
                raise
            self.retries += 1
            return fn(*args)

    def reset(self) -> None:
        self._call(self.inner.reset)

    def act(self, state: np.ndarray, images: dict[str, np.ndarray]) -> np.ndarray:
        return self._call(self.inner.act, state, images)
