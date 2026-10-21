"""app.pipeline.recipe: what the site asks for, checked, and the runner's command line it becomes."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.pipeline.recipe import PRESETS, Recipe, runner_args


def _arg(args: list[str], flag: str) -> str | None:
    return args[args.index(flag) + 1] if flag in args else None


def test_a_recipe_takes_either_ids_or_a_tag():
    assert Recipe(tag="human_2026102*").tag == "human_2026102*"
    assert Recipe(ids=["human_a", "human_b"]).ids == ["human_a", "human_b"]
    with pytest.raises(ValidationError, match="exactly one"):
        Recipe()
    with pytest.raises(ValidationError, match="exactly one"):
        Recipe(ids=["a"], tag="h*")
    with pytest.raises(ValidationError):
        Recipe(ids=["../etc"])  # ids are names, never paths
    with pytest.raises(ValidationError):
        Recipe(tag="x", variants=0)
    with pytest.raises(ValidationError):
        Recipe(tag="x", surprise=True)  # unknown fields are refused, not ignored


def test_the_presets_set_training_and_eval():
    assert PRESETS["smoke"]["steps"] == 2000 and PRESETS["standard"]["steps"] == 30000
    args = runner_args(Recipe(tag="human_*", preset="smoke"), "pl_x")
    assert "--smoke" in args and _arg(args, "--steps") == "2000" and _arg(args, "--eval-n") == "5"
    args = runner_args(Recipe(tag="human_*", preset="standard", eval_n=20), "pl_x")
    assert "--smoke" not in args and _arg(args, "--steps") == "30000" and _arg(args, "--eval-n") == "20"


def test_the_command_line_carries_the_selection_and_the_recipe():
    r = Recipe(ids=["human_a", "human_b"], input="mouse", repairer="hybrid", variants=12, multiplied_only=True)
    args = runner_args(r, "pl_20261020_210000_ab12")
    assert _arg(args, "--name") == "pl_20261020_210000_ab12"
    assert _arg(args, "--ids") == "human_a,human_b" and "--tag" not in args
    assert _arg(args, "--input") == "mouse" and _arg(args, "--repairer") == "hybrid"
    assert _arg(args, "--variants") == "12" and "--multiplied-only" in args
    assert _arg(args, "--until") == "results"
    # Nemotron (billed) only when asked
    assert "--no-nemotron" in args
    assert "--no-nemotron" not in runner_args(Recipe(tag="h*", nemotron=True), "n")


def test_stop_after_and_the_dry_run_stop_the_runner_early():
    assert _arg(runner_args(Recipe(tag="h*", stop_after="grid"), "n"), "--until") == "grid"
    # A dry run selects and freezes (no GPU) and stops: the plan and its time estimate are the result.
    dry = Recipe(tag="h*", dry_run=True)
    assert _arg(runner_args(dry, "n"), "--until") == "select"
    assert dry.gpu is False and Recipe(tag="h*").gpu is True
