"""sim_worker.regression: replayed episode folders compared (stored, base code, this branch), and the verdict per
episode: identical / within noise / DIFFERS. Pure; episodes written here with episode_io."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from demo_pipeline.episode_io import EpisodeMeta, save_episode, save_signals
from demo_pipeline.schemas import SimSignals
from sim_worker.regression import compare, episode_verdict, load_run, report_markdown

N = 40


def _write(ep: Path, *, reasons=(), cube_dx=0.0, tcp_dx=0.0, contact_flip=0, force=0.0, n=N) -> Path:
    t = np.arange(n)
    ee = np.stack([0.5 + 0.001 * t + tcp_dx, np.zeros(n), np.full(n, 0.2)], axis=1).astype(np.float32)
    save_episode(ep, EpisodeMeta(demo_id=ep.name, robot="franka", task_text="x", fps=50, n_steps=n, cameras=[]), {
        "joint_pos": np.zeros((n, 9), np.float32) + tcp_dx, "action": np.zeros((n, 9), np.float32),
        "ee_pos": ee, "ee_quat": np.tile([0, 1, 0, 0], (n, 1)).astype(np.float32), "gripper": (t > 10).astype(np.int8)})
    contact = t > 12
    contact[:contact_flip] = ~contact[:contact_flip]
    save_signals(ep, SimSignals(cube_pos=np.tile([0.5 + cube_dx, 0.0, 0.025], (n, 1)), contact_gripper_cube=contact,
                                contact_arm_bin=np.zeros(n, bool), contact_arm_table=np.zeros(n, bool),
                                max_contact_force=np.full(n, force)))
    (ep / "verification.json").write_text(json.dumps({"success": not reasons, "reasons": list(reasons)}), encoding="utf-8")
    return ep


def test_identical_runs_differ_by_nothing(tmp_path):
    a, b = (load_run(_write(tmp_path / n)) for n in ("a", "b"))
    d = compare(a, b)
    assert d["same_reasons"] and d["n_steps"] == (N, N)
    assert d["cube_max_m"] == 0 and d["tcp_max_m"] == 0 and d["contact_steps"] == 0 and d["force_max_n"] == 0


def test_the_diffs_are_exact_numbers(tmp_path):
    a = load_run(_write(tmp_path / "a"))
    b = load_run(_write(tmp_path / "b", reasons=("collision",), cube_dx=0.003, tcp_dx=0.0005, contact_flip=2, force=6.0))
    d = compare(a, b)
    assert not d["same_reasons"] and d["reasons"] == ([], ["collision"])
    assert d["cube_max_m"] == pytest.approx(0.003) and d["cube_final_m"] == pytest.approx(0.003)
    assert d["tcp_max_m"] == pytest.approx(0.0005, abs=1e-7)
    assert d["contact_steps"] == 2 and d["force_max_n"] == pytest.approx(6.0)


def test_runs_of_different_length_compare_over_the_common_steps(tmp_path):
    d = compare(load_run(_write(tmp_path / "a")), load_run(_write(tmp_path / "b", n=N + 5)))
    assert d["n_steps"] == (N, N + 5) and d["cube_max_m"] == 0


def _runs(tmp_path, base, branch):
    return ([load_run(_write(tmp_path / f"base{i}", **kw)) for i, kw in enumerate(base)],
            [load_run(_write(tmp_path / f"branch{i}", **kw)) for i, kw in enumerate(branch)])


def test_bitwise_equal_runs_are_identical(tmp_path):
    base, branch = _runs(tmp_path, [{}, {}], [{}, {}])
    assert episode_verdict(base, branch)["verdict"] == "identical"


def test_a_branch_inside_the_physics_noise_passes(tmp_path):
    # Base run to run: 2 mm of cube drift; the branch lands inside that.
    base, branch = _runs(tmp_path, [{}, {"cube_dx": 0.002}], [{"cube_dx": 0.001}, {}])
    v = episode_verdict(base, branch)
    assert v["verdict"] == "within noise"
    assert v["noise"]["cube_max_m"] == pytest.approx(0.002) and v["regression"]["cube_max_m"] <= v["noise"]["cube_max_m"]


def test_a_branch_outside_the_noise_differs(tmp_path):
    base, branch = _runs(tmp_path, [{}, {}], [{"cube_dx": 0.01}, {"cube_dx": 0.01}])
    v = episode_verdict(base, branch)
    assert v["verdict"] == "DIFFERS" and any(w.startswith("cube_max_m: 0.01 > noise 0") for w in v["why"])


def test_a_new_reason_differs_unless_the_base_also_flips(tmp_path):
    base, branch = _runs(tmp_path, [{}, {}], [{"reasons": ("dropped",)}, {"reasons": ("dropped",)}])
    assert episode_verdict(base, branch)["verdict"] == "DIFFERS"
    noisy, branch2 = _runs(tmp_path / "n", [{}, {"reasons": ("dropped",)}], [{"reasons": ("dropped",)}, {}])
    assert episode_verdict(noisy, branch2)["verdict"] == "within noise"


def test_the_markdown_report_names_every_episode_and_the_stored_comparison(tmp_path):
    base, branch = _runs(tmp_path, [{}, {}], [{}, {}])
    stored = load_run(_write(tmp_path / "stored", reasons=("collision",)))
    rows = [{"episode": "ep_a", "stored": stored, "base": base, "branch": branch}]
    md = report_markdown(rows)
    assert "ep_a" in md and "identical" in md and "collision" in md
