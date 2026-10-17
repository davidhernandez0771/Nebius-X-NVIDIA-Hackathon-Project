""".github/workflows/ci.yml, checked as text (no YAML library is in the SANT deps).

These pin what the sprint 7 plan asks CI to run, and one layout rule: the Python and web jobs are
separate checkouts, because test_launch_start_stop's web refusal test skips when web/node_modules
exists.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"


def _text() -> str:
    return WORKFLOW.read_text(encoding="utf-8")


def _jobs() -> dict[str, str]:
    """Each top-level job's name -> its block of text."""
    body = _text().split("\njobs:\n", 1)[1]
    parts = re.split(r"^  ([A-Za-z0-9_-]+):\s*$", body, flags=re.MULTILINE)
    return {parts[i]: parts[i + 1] for i in range(1, len(parts), 2)}


def _runs(block: str) -> list[str]:
    # A step's `run:` has its command on the same line; `defaults: run:` has none.
    return [m.strip() for m in re.findall(r"^[ \t]+(?:- )?run:[ \t]*(\S.*)$", block, flags=re.MULTILINE)]


def test_triggers_on_pull_requests_and_pushes_to_the_integration_branch():
    text = _text()
    assert re.search(r"^  pull_request:", text, flags=re.MULTILINE)
    push = re.search(r"^  push:\n    branches:\s*\[([^\]]*)\]", text, flags=re.MULTILINE)
    assert push, "push trigger with an inline branches list"
    assert [b.strip() for b in push.group(1).split(",")] == ["perfect-then-multiply"]


def test_python_job_syncs_the_lock_and_runs_pytest_on_314():
    jobs = _jobs()
    assert "python" in jobs
    block = jobs["python"]
    assert re.search(r'python-version:\s*"3\.14"', block)
    assert _runs(block) == ["uv sync --locked", "uv run pytest -q"]
    assert "npm" not in block


def test_web_job_installs_tests_and_builds_in_web():
    jobs = _jobs()
    assert "web" in jobs
    block = jobs["web"]
    assert re.search(r"working-directory:\s*web\b", block)
    assert _runs(block) == ["npm ci", "npm test", "npm run build"]


def test_uv_version_matches_the_one_the_local_verification_used():
    # The RUNBOOK records a local run with this uv; CI should not drift from it silently.
    block = _jobs()["python"]
    assert re.search(r'version:\s*"0\.12\.12"', block)


def test_third_party_actions_are_pinned():
    for ref in re.findall(r"uses:\s*(\S+)", _text()):
        name, _, version = ref.partition("@")
        assert version, f"{ref} has no version"
        if not name.startswith("actions/"):
            assert re.fullmatch(r"v\d+\.\d+\.\d+", version), f"{ref}: pin an exact release"
