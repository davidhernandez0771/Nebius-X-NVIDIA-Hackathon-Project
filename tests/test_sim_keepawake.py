"""sim_worker.keepawake: ask Windows not to idle-sleep while a sim job runs (pure, with a fake setter)."""

from __future__ import annotations

import pytest

from sim_worker.keepawake import ES_CONTINUOUS, ES_SYSTEM_REQUIRED, KeepAwake


def test_requests_the_system_while_inside_and_releases_after():
    calls: list[int] = []
    with KeepAwake(setter=calls.append):
        assert calls == [ES_CONTINUOUS | ES_SYSTEM_REQUIRED]
    assert calls == [ES_CONTINUOUS | ES_SYSTEM_REQUIRED, ES_CONTINUOUS]


def test_releases_even_when_the_job_raises():
    calls: list[int] = []
    with pytest.raises(RuntimeError):
        with KeepAwake(setter=calls.append):
            raise RuntimeError("sim crashed")
    assert calls[-1] == ES_CONTINUOUS


def test_disabled_does_nothing():
    calls: list[int] = []
    with KeepAwake(setter=calls.append, enabled=False):
        pass
    assert calls == []


def test_flag_values_match_the_win32_api():
    assert (ES_CONTINUOUS, ES_SYSTEM_REQUIRED) == (0x80000000, 0x00000001)
