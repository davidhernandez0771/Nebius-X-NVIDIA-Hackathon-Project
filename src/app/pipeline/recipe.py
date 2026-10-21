"""What the site asks a pipeline run to do, checked, and the runner's command line it becomes
(scripts/run_human_demo_experiment.py, whose own checks are the last word).

The demos: `ids`, or `tag` (an fnmatch pattern over human demo ids), optionally only one `input`. The recipe: the
repairer, the variants per demo, a training preset (steps and eval seeds), the eval size, where to stop
(`stop_after`: "grid" for the data alone, no training) and whether Nemotron labels the demos (billed, off by
default). A `dry_run` selects and freezes the demos (no GPU) and stops: the plan and its time estimate are the result.
"""
from __future__ import annotations

import re
from typing import Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator, model_validator

PRESETS: dict[str, dict] = {
    "smoke": {"steps": 2000, "eval_n": 5, "smoke": True, "label": "Smoke test: proves every stage runs, measures nothing"},
    "standard": {"steps": 30000, "eval_n": 40, "smoke": False, "label": "Standard: 30k ACT steps, 40 eval seeds"},
    "long": {"steps": 60000, "eval_n": 40, "smoke": False, "label": "Long: 60k ACT steps, 40 eval seeds"},
}
StopAfter = Literal["grid", "train", "eval", "results"]
_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]*")
_TAG = re.compile(r"[A-Za-z0-9_*?.\[\]-]+")


class Recipe(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ids: list[str] | None = Field(None, validation_alias=AliasChoices("ids", "demos"))  # the pages send `demos`
    tag: str | None = None
    input: Literal["camera", "keyboard", "mouse"] | None = None
    repairer: Literal["rules", "nemotron-edits", "hybrid"] = "rules"
    variants: int = Field(10, ge=1, le=99)
    preset: Literal["smoke", "standard", "long"] = "standard"
    eval_n: int | None = Field(None, ge=1, le=200)
    stop_after: StopAfter = "results"
    multiplied_only: bool = False
    nemotron: bool = False
    dry_run: bool = False

    @field_validator("ids")
    @classmethod
    def _names(cls, v: list[str] | None) -> list[str] | None:
        if v is not None and (not v or not all(_ID.fullmatch(i) for i in v)):
            raise ValueError("ids are demo names (letters, digits, _ . -), at least one")
        return v

    @field_validator("tag")
    @classmethod
    def _pattern(cls, v: str | None) -> str | None:
        if v is not None and not _TAG.fullmatch(v):
            raise ValueError("tag is an fnmatch pattern over demo ids (letters, digits, _ - . * ? [])")
        return v

    @model_validator(mode="after")
    def _one_selection(self) -> "Recipe":
        if (self.ids is None) == (self.tag is None):
            raise ValueError("give exactly one of ids or tag")
        return self

    @property
    def steps(self) -> int:
        return PRESETS[self.preset]["steps"]

    @property
    def eval_seeds(self) -> int:
        return self.eval_n if self.eval_n is not None else PRESETS[self.preset]["eval_n"]

    @property
    def until(self) -> str:
        return "select" if self.dry_run else self.stop_after

    @property
    def gpu(self) -> bool:
        """Whether the run reaches a GPU stage (everything after select does)."""
        return not self.dry_run


def runner_args(r: Recipe, name: str) -> list[str]:
    """The runner's arguments (after the script) for this recipe, as experiment `name`."""
    args = ["--name", name]
    args += ["--ids", ",".join(r.ids)] if r.ids is not None else ["--tag", r.tag or ""]
    if r.input:
        args += ["--input", r.input]
    if PRESETS[r.preset]["smoke"]:
        args.append("--smoke")
    args += ["--repairer", r.repairer, "--variants", str(r.variants), "--steps", str(r.steps),
             "--eval-n", str(r.eval_seeds), "--until", r.until]
    if r.multiplied_only:
        args.append("--multiplied-only")
    if not r.nemotron:
        args.append("--no-nemotron")
    return args
