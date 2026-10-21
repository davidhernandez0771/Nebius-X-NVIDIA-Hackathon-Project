"""sim_worker.own_code: every process imports this checkout's code, not the worktree an editable install points at.

The Isaac venv's _editable_impl_nebius_hackathon.pth points at C:\\dev\\pm-t2\\src and the LeRobot venv's at
C:\\dev\\pm-t3\\src (pip install -e, 2026-10-15), so a process started from any other worktree silently imports that
worktree's demo_pipeline unless its own src comes first (found by the scene smoke test, 2026-10-20)."""

from __future__ import annotations

import ast
import os
import subprocess
import sys
from pathlib import Path

import pytest

from sim_worker import own_code

REPO = Path(__file__).resolve().parents[1]
PROJECT = {"demo_pipeline", "app", "nebius_llm", "sim_worker", "sim_eval", "lerobot_tools"}


def _fake_checkout(root: Path, marker: str) -> Path:
    pkg = root / "src" / "demo_pipeline"
    pkg.mkdir(parents=True)
    (pkg / "__init__.py").write_text(f"WHO = {marker!r}\n", encoding="utf-8")
    return root


def test_put_own_code_first_moves_src_then_the_root_to_the_front(monkeypatch, tmp_path):
    repo = tmp_path / "pm-x"
    monkeypatch.setattr(sys, "path", ["a", str(repo), "b", str(repo / "src")])
    own_code.put_own_code_first(repo)
    assert sys.path == [str(repo / "src"), str(repo), "a", "b"]


def test_check_own_code_logs_this_checkout_and_returns_it():
    lines = []
    got = own_code.check_own_code(REPO, log=lines.append)
    assert os.path.normcase(str(got)) == os.path.normcase(str(REPO / "src" / "demo_pipeline"))
    assert lines == [f"[imports] demo_pipeline from {got}"]


def test_check_own_code_stops_a_process_that_imported_another_worktree(tmp_path):
    with pytest.raises(ImportError, match="not this checkout's") as e:
        own_code.check_own_code(tmp_path / "pm-other", log=lambda s: None)
    assert "put_own_code_first" in str(e.value)


def test_own_src_wins_over_an_editable_install_pointing_elsewhere(tmp_path):
    # Another worktree's src ahead on the path, as the Isaac venv's .pth (or a stale PYTHONPATH) puts it.
    other = _fake_checkout(tmp_path / "pm-t2", "pm-t2")
    mine = _fake_checkout(tmp_path / "pm-mine", "mine")
    (mine / "sim_worker").mkdir()
    (mine / "sim_worker" / "__init__.py").write_text("", encoding="utf-8")
    (mine / "sim_worker" / "own_code.py").write_text((REPO / "sim_worker" / "own_code.py").read_text(encoding="utf-8"),
                                                    encoding="utf-8")
    script = ("import sys; sys.path.insert(0, sys.argv[1]);"
              "from sim_worker.own_code import check_own_code, put_own_code_first; put_own_code_first();"
              "import demo_pipeline; print(demo_pipeline.WHO); check_own_code()")
    env = {**os.environ, "PYTHONPATH": str(other / "src")}
    out = subprocess.run([sys.executable, "-c", script, str(mine)], env=env, capture_output=True, text=True, check=True)
    assert out.stdout.splitlines() == ["mine"]  # the log goes to stderr: some entry points print JSON on stdout
    assert "[imports] demo_pipeline from" in out.stderr and "pm-mine" in out.stderr
    # Without it, the other worktree's code is what runs.
    bare = subprocess.run([sys.executable, "-c", "import demo_pipeline; print(demo_pipeline.WHO)"], env=env,
                          capture_output=True, text=True, check=True)
    assert bare.stdout.strip() == "pm-t2"


# --- every entry point ---------------------------------------------------------------------------------------

ENTRY_GLOBS = ["sim_worker/server.py", "sim_worker/scripts/*.py", "sim_eval/scripts/*.py", "sim_eval/parallel/scripts/*.py",
               "lerobot_tools/experiments.py", "lerobot_tools/start_state.py", "lerobot_tools/train_smoke.py",
               "scripts/mimic_smoke.py", "scripts/export_mimic.py"]  # Isaac Lab's Python runs these two (Mimic)


def _project_import(node: ast.stmt) -> bool:
    names = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module or ""] if isinstance(node, ast.ImportFrom) else []
    return any(n.split(".")[0] in PROJECT and n != "sim_worker.own_code" for n in names)


def _puts_src_first(node: ast.stmt, source: str) -> bool:
    text = ast.get_source_segment(source, node) or ""
    if "put_own_code_first(" in text:
        return True
    return text.startswith("sys.path[:0]") and "src" in text


def _entry_points() -> list[Path]:
    files = sorted({p for g in ENTRY_GLOBS for p in REPO.glob(g)})
    out = []
    for p in files:
        tree = ast.parse(p.read_text(encoding="utf-8"))
        if any(_project_import(n) for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))):
            out.append(p)
    return out


def test_the_entry_points_are_found():
    names = {p.name for p in _entry_points()}
    assert {"server.py", "teleop_sink.py", "run_batch.py", "eval_cells.py", "run_eval.py", "experiments.py"} <= names


@pytest.mark.parametrize("path", _entry_points(), ids=lambda p: p.relative_to(REPO).as_posix())
def test_every_entry_point_puts_its_own_src_first_and_checks_at_startup(path):
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source)
    first_project = next((n for n in tree.body if _project_import(n)), None)  # None: imported inside functions
    before = tree.body[:tree.body.index(first_project)] if first_project is not None else tree.body
    assert any(_puts_src_first(n, source) for n in before), \
        f"{path.name}: put this checkout's src first (sim_worker.own_code.put_own_code_first) before importing project code"
    main = next((n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "main"), None)
    assert main is not None and "check_own_code(" in (ast.get_source_segment(source, main) or ""), \
        f"{path.name}: main() must call sim_worker.own_code.check_own_code() at startup"
