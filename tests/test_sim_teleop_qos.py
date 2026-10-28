"""sim_worker.teleop_qos: opt the teleop sink out of Windows power throttling (EcoQoS)."""

from __future__ import annotations

import sys

import pytest

from sim_worker import teleop_qos
from sim_worker.teleop_qos import full_speed, high_qos


@pytest.mark.skipif(sys.platform != "win32", reason="Windows power throttling only")
def test_high_qos_succeeds_on_windows():
    assert high_qos() is True


def test_high_qos_is_a_no_op_elsewhere(monkeypatch):
    monkeypatch.setattr(sys, "platform", "linux")
    assert high_qos() is False


def test_full_speed_logs_to_stderr_and_returns_high_qos(capsys, monkeypatch):
    monkeypatch.setattr(teleop_qos, "high_qos", lambda: True)
    assert full_speed() is True
    out = capsys.readouterr()
    assert out.out == "" and "[qos] Windows power throttling off: True" in out.err
