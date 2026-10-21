"""What the site asks a pipeline run to do, checked, and the runner's command line it becomes
(scripts/run_human_demo_experiment.py, whose own checks are the last word).

The demos: `ids`, or `tag` (an fnmatch pattern over human demo ids), optionally only one `input`. The recipe: the
repairer, the variants per demo, a training preset (steps and eval seeds), the eval size, where to stop
(`stop_after`: "grid" for the data alone, no training) and whether Nemotron labels the demos (billed, off by
default). A `dry_run` selects and freezes the demos (no GPU) and stops: the plan and its time estimate are the result.

The "teacher" recipe (`kind: "teacher"`, TeacherRecipe) trains the real approach instead (scripts/run_teacher_pipeline.py):
T3's RL teacher, the teacher gate, T6's distillation round 0 with `teacher_n` teacher rollouts (300 or 600), and a
DAgger round when asked, from the SANT data of an earlier human-demo run (`human_run`). Its `dry_run` checks the
scripts and inputs and stops.
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

    kind: Literal["demos"] = "demos"
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


TEACHER_PRESETS: dict[str, dict] = {
    "smoke": {"rl_iterations": 20, "smoke": True,
              "label": "Smoke test: T3's and T6's smallest sizes, no gate threshold; proves every stage runs"},
    "full": {"rl_iterations": 1500, "smoke": False,
             "label": "Full: 1,500 RL iterations, the 90% teacher gate, round 0 at 60k ACT steps"},
}


class TeacherRecipe(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["teacher"]
    human_run: str
    teacher_n: Literal[300, 600] = 300
    dagger: bool = False
    preset: Literal["smoke", "full"] = "full"
    rl_iterations: int | None = Field(None, ge=20, le=5000)
    dry_run: bool = False

    @field_validator("human_run")
    @classmethod
    def _run_name(cls, v: str) -> str:
        if not _ID.fullmatch(v):
            raise ValueError("human_run is a human-demo run's name (letters, digits, _ . -)")
        return v

    @property
    def iterations(self) -> int:
        return self.rl_iterations or TEACHER_PRESETS[self.preset]["rl_iterations"]

    @property
    def smoke(self) -> bool:
        return TEACHER_PRESETS[self.preset]["smoke"]

    @property
    def until(self) -> str:
        return "plan" if self.dry_run else "results"

    @property
    def gpu(self) -> bool:
        return not self.dry_run


AnyRecipe = Recipe | TeacherRecipe


def parse_recipe(body: dict) -> AnyRecipe:
    """A request body as its recipe: `kind: "teacher"` is the teacher recipe, anything else the demos recipe."""
    return TeacherRecipe.model_validate(body) if body.get("kind") == "teacher" else Recipe.model_validate(body)


def teacher_args(r: TeacherRecipe, name: str) -> list[str]:
    """scripts/run_teacher_pipeline.py's arguments for this recipe, as run `name`."""
    args = ["--name", name, "--human-run", r.human_run, "--teacher-n", str(r.teacher_n),
            "--rl-iterations", str(r.iterations), "--until", r.until]
    if r.dagger:
        args.append("--dagger")
    if r.smoke:
        args.append("--smoke")
    return args
