"""sim_worker.teleop_qos: opt the teleop sink out of Windows power throttling (EcoQoS)."""

from __future__ import annotations

import sys

import pytest

from sim_worker.teleop_qos import high_qos


@pytest.mark.skipif(sys.platform != "win32", reason="Windows power throttling only")
def test_high_qos_succeeds_on_windows():
    assert high_qos() is True


def test_high_qos_is_a_no_op_elsewhere(monkeypatch):
    monkeypatch.setattr(sys, "platform", "linux")
    assert high_qos() is False
