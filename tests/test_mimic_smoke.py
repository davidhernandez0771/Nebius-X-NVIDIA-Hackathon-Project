"""scripts/mimic_smoke.py: the Mimic GPU smoke test's runner, checked without a GPU (the generator is faked).

The file-reading tests need h5py (Isaac Lab's Python; SANT's venv skips them).
"""
from __future__ import annotations

import json

import numpy as np
import pytest

import mimic_episode as fx
from scripts import mimic_smoke as sm
from sim_worker.gpu_lock import GpuLock


def test_the_command_runs_mimics_generator_on_our_file_with_our_env_and_no_headless_flag(tmp_path):
    cmd = sm.command(tmp_path / "in.hdf5", tmp_path / "out.hdf5", trials=10, max_failures=30)
    assert cmd[0] == str(sm.ISAAC_PY) and cmd[1] == str(sm.GENERATE)
    joined = " ".join(cmd)
    for part in ("--generation_num_trials 10", "--max_num_failures 30", "--num_envs 1", "--device cpu",
                 "--external_callback sim_worker.mimic_register.register", f"--input_file {tmp_path / 'in.hdf5'}"):
        assert part in joined
    # This Isaac Lab has no --headless (headless is the default), and an unknown flag is a hard error.
    assert "--headless" not in cmd
    assert "--viz" not in cmd and "--viz" in sm.command(tmp_path / "a", tmp_path / "b", viz=True)


def test_the_child_finds_sant_and_mimic_without_installing_anything():
    env = sm.child_env({"PYTHONPATH": "C:\\other"})
    parts = env["PYTHONPATH"].split(";")
    assert parts[:3] == [str(sm.REPO), str(sm.REPO / "src"), str(sm.MIMIC_SRC)]
    assert parts[-1] == "C:\\other"


def _lock(tmp_path):
    return GpuLock(tmp_path / "gpu.lock", task="mimic_smoke", owner="T2", log=lambda m: None)


def test_it_holds_the_gpu_lock_while_the_generator_runs_and_releases_it_after(tmp_path):
    seen = {}

    def runner(cmd, **kw):
        seen["locked"] = (tmp_path / "gpu.lock").exists()
        seen["timeout"] = kw["timeout"]
        return type("P", (), {"returncode": 0})()

    rc = sm.run_generator(["x"], lock=_lock(tmp_path), runner=runner, log_path=tmp_path / "smoke.log", timeout_s=60)
    assert rc == 0 and seen == {"locked": True, "timeout": 60}
    assert not (tmp_path / "gpu.lock").exists()


def test_it_releases_the_lock_even_when_the_generator_fails(tmp_path):
    def runner(cmd, **kw):
        raise TimeoutError("Isaac hung")

    with pytest.raises(TimeoutError):
        sm.run_generator(["x"], lock=_lock(tmp_path), runner=runner, log_path=tmp_path / "smoke.log", timeout_s=1)
    assert not (tmp_path / "gpu.lock").exists()


def test_it_refuses_to_overwrite_an_output(tmp_path):
    out = tmp_path / "out.hdf5"
    out.write_bytes(b"")
    with pytest.raises(SystemExit, match="exists"):
        sm.main(["--input", str(tmp_path / "in.hdf5"), "--output", str(out), "--dry-run"])


def _write(path, demos):
    import h5py

    def put(g, d):
        for k, v in d.items():
            if isinstance(v, dict):
                put(g.create_group(k), v)
            else:
                g.create_dataset(k, data=np.asarray(v))

    with h5py.File(path, "w") as f:
        data = f.create_group("data")
        for i, d in enumerate(demos):
            put(data.create_group(f"demo_{i}"), d)


def test_the_report_re_verifies_every_generated_demo_with_check_success(tmp_path):
    pytest.importorskip("h5py")
    out = tmp_path / "smoke_10.hdf5"
    hit = fx.generated(contact_forces=lambda x: np.where(np.arange(len(x))[:, None] >= fx.RELEASE, [2.0, 12.0, 0.0], x))
    _write(out, [fx.generated(), hit])
    _write(tmp_path / "smoke_10_failed.hdf5", [fx.generated()])
    r = sm.report(out)
    assert r["mimic_succeeded"] == 2 and r["mimic_failed"] == 1
    assert r["sant_verified"] == 1
    assert r["sant_reasons"] == {"collision": 1}
    assert [d["sant_success"] for d in r["demos"]] == [True, False]
    json.dumps(r)


def test_a_missing_output_reports_nothing_generated(tmp_path):
    pytest.importorskip("h5py")
    r = sm.report(tmp_path / "none.hdf5")
    assert r["mimic_succeeded"] == 0 and r["demos"] == []


def test_a_truncated_output_is_reported_not_a_crash(tmp_path):
    pytest.importorskip("h5py")
    out = tmp_path / "smoke_10.hdf5"
    out.write_bytes(b"\x89HDF\r\n\x1a\n" + b"\0" * 88)  # what a generator killed mid-write leaves
    r = sm.report(out)
    assert r["mimic_succeeded"] == 0 and r["demos"] == []
    assert r["unreadable_files"] and r["unreadable_files"][0]["file"].endswith("smoke_10.hdf5")


def test_the_report_carries_each_demos_tracking_so_the_rerun_shows_the_lag(tmp_path):
    pytest.importorskip("h5py")
    out = tmp_path / "smoke_10.hdf5"
    _write(out, [fx.generated()])
    row = sm.report(out)["demos"][0]
    # The fixture's arm sits 2 mm off its command (mimic_episode.arrays): well inside SANT's 2 cm.
    assert row["tcp_err_median_cm"] == pytest.approx(0.35, abs=0.1)
    assert row["secs_over_2cm"] == 0.0


def test_the_extended_run_can_use_several_environments(tmp_path):
    out = sm.main(["--input", str(tmp_path / "in.hdf5"), "--output", str(tmp_path / "o.hdf5"), "--num-envs", "4", "--dry-run"])
    cmd = out["command"]
    assert cmd[cmd.index("--num_envs") + 1] == "4"
