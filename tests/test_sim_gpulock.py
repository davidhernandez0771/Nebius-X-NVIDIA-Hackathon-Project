"""sim_worker.gpulock: the shared C:\\dev\\gpu.lock protocol, pure (pid check, clock and sleep injected)."""

from __future__ import annotations

import pytest

from sim_worker.gpulock import GpuLock, lock_text, parse_lock


class Clock:
    def __init__(self):
        self.t, self.sleeps = 0.0, []

    def sleep(self, s):
        self.sleeps.append(s)
        self.t += s


def test_lock_text_and_parse_round_trip():
    text = lock_text("T3", 1234, "overnight", "2026-10-18T20:00:00")
    assert text == "T3 1234 overnight 2026-10-18T20:00:00"
    assert parse_lock(text) == ("T3", 1234)
    assert parse_lock("garbage") == (None, None)


def test_acquire_writes_the_lock_and_release_deletes_it(tmp_path):
    path = tmp_path / "gpu.lock"
    lock = GpuLock(path, task="t", pid=42, pid_alive=lambda p: True, gpu_busy=lambda: [])
    with lock:
        assert path.read_text(encoding="utf-8").split()[:3] == ["T3", "42", "t"]
    assert not path.exists()


def test_release_happens_even_when_the_body_raises(tmp_path):
    path = tmp_path / "gpu.lock"
    with pytest.raises(RuntimeError):
        with GpuLock(path, task="t", pid=42, pid_alive=lambda p: True, gpu_busy=lambda: []):
            raise RuntimeError("training crashed")
    assert not path.exists()


def test_waits_while_a_live_holder_has_it_and_rechecks_every_poll(tmp_path):
    path = tmp_path / "gpu.lock"
    path.write_text("T2 77 smoke 2026-10-18T13:33:51\n", encoding="utf-8")
    clock, alive = Clock(), {77: True}

    def sleep(s):
        clock.sleep(s)
        if len(clock.sleeps) == 2:
            path.unlink()  # T2 finishes and deletes its lock

    lock = GpuLock(path, task="t", pid=42, pid_alive=lambda p: alive.get(p, False), gpu_busy=lambda: [],
                   sleep=sleep, poll_s=300)
    with lock:
        assert path.read_text(encoding="utf-8").startswith("T3 42 t ")
    assert clock.sleeps == [300, 300]


def test_a_lock_whose_pid_is_dead_is_stale_and_replaced(tmp_path):
    path = tmp_path / "gpu.lock"
    path.write_text("T2 77 smoke 2026-10-18T13:33:51\n", encoding="utf-8")
    slept = []
    with GpuLock(path, task="t", pid=42, pid_alive=lambda p: False, gpu_busy=lambda: [], sleep=slept.append):
        assert path.read_text(encoding="utf-8").startswith("T3 42 ")
    assert slept == [] and not path.exists()


def test_an_unreadable_lock_is_treated_as_held(tmp_path):
    path = tmp_path / "gpu.lock"
    path.write_text("???\n", encoding="utf-8")
    calls = []

    def sleep(s):
        calls.append(s)
        path.unlink()

    with GpuLock(path, task="t", pid=42, pid_alive=lambda p: False, gpu_busy=lambda: [], sleep=sleep):
        pass
    assert calls == [300]


def test_waits_while_the_gpu_is_busy(tmp_path):
    path = tmp_path / "gpu.lock"
    busy = [["blender.exe at 90% CPU"], []]
    slept = []
    with GpuLock(path, task="t", pid=42, pid_alive=lambda p: True, gpu_busy=lambda: busy.pop(0), sleep=slept.append):
        pass
    assert slept == [300]


def test_release_leaves_a_lock_that_is_no_longer_ours(tmp_path):
    path = tmp_path / "gpu.lock"
    with GpuLock(path, task="t", pid=42, pid_alive=lambda p: True, gpu_busy=lambda: []):
        path.write_text("T2 77 other 2026-10-18T23:00:00\n", encoding="utf-8")
    assert path.read_text(encoding="utf-8").startswith("T2 77")


def test_gives_up_after_max_wait(tmp_path):
    path = tmp_path / "gpu.lock"
    path.write_text("T2 77 smoke 2026-10-18T13:33:51\n", encoding="utf-8")
    clock = Clock()
    lock = GpuLock(path, task="t", pid=42, pid_alive=lambda p: True, gpu_busy=lambda: [], sleep=clock.sleep,
                   clock=lambda: clock.t, max_wait_s=900)
    with pytest.raises(TimeoutError):
        lock.acquire()
    assert path.read_text(encoding="utf-8").startswith("T2 77")
