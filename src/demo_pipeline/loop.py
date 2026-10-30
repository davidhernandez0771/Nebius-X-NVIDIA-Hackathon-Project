"""SANT's closed loop, resumable: a policy's eval -> Nemotron's diagnosis -> a frozen data recipe -> a recipe arm and
a uniform control arm trained the same way -> both evaluated on the same fresh seeds -> a two-sided Fisher test.

Stages (STAGES), each recorded in DATA_DIR/loops/<name>/loop.json with its status, command, start/end, inputs hash
and outputs:
  diagnose       scripts/analyze_failures.py on the given eval(s) (traced, or --results-only): Nemotron's recipe
                 (recipe_nemotron.json) or the code baseline (recipe_rules.json). Skipped when a recipe is given.
  freeze         the recipe is validated (data_recipe.validate_recipe + data_fixes.fix_errors), copied to
                 <loop>/recipe.json with its sha256, and preregistration.md is written: seeds, n, both arms' exact
                 commands and the decision rule. This happens before anything is trained, and once an arm has started
                 a changed recipe or setting is refused (use a new --name).
  train_recipe   scripts/run_human_demo_experiment.py --name <name>_recipe ... --scene-recipe <loop>/recipe.json
  train_control  the identical command without --scene-recipe (variant scenes as multiply has always sampled them),
                 both with --multiplied-only --no-nemotron --until train
  eval_recipe    the same commands with --until results: eval_cells on --eval-seed0 .. + --eval-n - 1, then the
  eval_control   experiment's results.json (successes on the registered seeds, Wilson 95% CI)
  compare        two-sided Fisher exact, decision at p <= 0.05 with the recipe arm ahead; compare.json, report.md

Resume: a stage is skipped when loop.json says it is done, its inputs hash still matches (the files it read, its
command), and its output files exist. Anything else runs it again; the experiment script resumes from its own markers.

Seeds: the eval seeds are always passed explicitly (the experiment script's default, 5020, is a spent test set), and
a range is refused if it touches a training scene (< 5000), sim_eval.distill_round.EVAL_ONLY_SEEDS, the practice and
DAgger seeds (5200-5279, DAgger r1 5210-5249), the replay-verify gate (5450-5499), the ablation (5600-5639), the
diagnosed eval's own seeds, or the eval seeds frozen by any other experiment or loop under DATA_DIR.

GPU: this module never holds C:\\dev\\gpu.lock. run_human_demo_experiment.py takes it around its sim, train and eval
stages (sim_worker.gpulock), so holding it here would make the child wait on its parent forever. The arms run one at
a time.

Security: child processes get argument lists only (no shell); names match NAME_RE; every path is resolved under the
loop's root; the env file (the Token Factory key) is read into the diagnose child's environment and never logged.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from demo_pipeline.paths import REPO_ROOT
from demo_pipeline.stats import fisher_exact, wilson_ci

STAGES = ("diagnose", "freeze", "train_recipe", "train_control", "eval_recipe", "eval_control", "compare")
ARMS = ("recipe", "control")
NAME_RE = re.compile(r"^[a-z0-9_-]{1,64}$")
TAG_RE = re.compile(r"^[A-Za-z0-9_.*?\[\]-]{1,64}$")
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
INPUTS = ("camera", "keyboard", "mouse")
REPAIRERS = ("rules", "nemotron-edits", "hybrid")
RECIPE_SOURCES = ("nemotron", "rules")
ALPHA = 0.05
EVAL_SEED_MIN = 5000
#: Seed blocks already used, beyond distill_round.EVAL_ONLY_SEEDS (GPU runbook 2026-10-26, "Fresh seeds").
SPENT_RANGES: tuple[tuple[int, int, str], ...] = (
    (5200, 5279, "practice traces and DAgger r1 (5210-5249): sim_eval.overnight.PRACTICE_SEEDS"),
    (5450, 5499, "the SANT replay-verify gate (2026-10-22-pr-live-13.md)"),
    (5600, 5639, "the ablation (GPU runbook 2026-10-26, (b))"),
)
DONE = ("done", "provided")

Runner = Callable[[list[str], Path, "dict | None"], int]


class Refused(ValueError):
    """Nothing was run: bad arguments, spent seeds, a changed pre-registration, a missing prerequisite."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _hash(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()


def _read_json(path: Path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(obj, indent=1, default=str), encoding="utf-8")
    os.replace(tmp, path)


def eval_seeds(path: Path) -> set[int]:
    """The seeds in an eval's results: <name>.json ({"episodes": [...]}) or <name>.episodes.jsonl."""
    path = Path(path)
    if path.name.endswith(".jsonl"):
        out = set()
        for line in path.read_text(encoding="utf-8").splitlines():
            rec = json.loads(line) if line.strip() else {}
            if "episode" in rec:
                out.add(int(rec["episode"]["seed"]))
        return out
    return {int(e["seed"]) for e in json.loads(path.read_text(encoding="utf-8")).get("episodes", [])}


def _eval_only_seeds() -> frozenset[int]:
    from sim_eval.distill_round import EVAL_ONLY_SEEDS  # both test sets, the selection blocks, the retired ones

    return EVAL_ONLY_SEEDS


def subprocess_runner(cmd: list[str], log_path: Path, env: dict | None = None) -> int:
    """Run one child (an argument list, never a shell), its output appended to log_path."""
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as f:
        f.write(f"\n[{_now()}] {' '.join(cmd)}\n")
        f.flush()
        return subprocess.run(cmd, stdout=f, stderr=subprocess.STDOUT, env=env, cwd=REPO_ROOT, check=False).returncode


@dataclass(frozen=True)
class LoopConfig:
    name: str
    eval_seed0: int
    data_dir: Path
    eval_n: int = 40
    root: Path = REPO_ROOT
    evals: tuple[Path, ...] = ()
    recipe: Path | None = None
    recipe_source: str = "nemotron"
    results_only: bool = False
    post_hoc: bool = False
    no_model: bool = False
    k: int = 3
    env_file: Path | None = None
    tag: str | None = None
    ids: tuple[str, ...] | None = None
    input: str | None = "mouse"
    min_demos: int | None = None
    repairer: str = "rules"
    variants: int = 10
    steps: int = 30_000
    smoke: bool = False
    python: str = field(default_factory=lambda: sys.executable)


@dataclass(frozen=True)
class Planned:
    stage: str
    command: list[str] | None  # None: done in this process (freeze, compare) or skipped (diagnose with a recipe)


class Loop:
    def __init__(self, cfg: LoopConfig, *, runner: Runner = subprocess_runner, log: Callable[[str], None] = print):
        self.runner, self.log = runner, log
        self.cfg = self._checked(cfg)
        self.folder = self.cfg.data_dir / "loops" / self.cfg.name
        self.state_path = self.folder / "loop.json"
        self._check_seeds()

    # ------------------------------------------------------------------ validation

    def _under_root(self, path: Path, what: str) -> Path:
        root = Path(self.root).resolve()
        p = Path(path).resolve()
        if not p.is_relative_to(root):
            raise Refused(f"{what} {p} is outside the root {root} (pass --root)")
        return p

    def _checked(self, cfg: LoopConfig) -> LoopConfig:
        self.root = Path(cfg.root).resolve()
        for name in (cfg.name, f"{cfg.name}_recipe", f"{cfg.name}_control"):
            if not NAME_RE.fullmatch(name):
                raise Refused(f"name {cfg.name!r}: lower-case letters, digits, _ and -, at most 56 characters")
        if cfg.tag is not None and not TAG_RE.fullmatch(cfg.tag):
            raise Refused(f"--tag {cfg.tag!r}: letters, digits, _ - . * ? [ ] only")
        if cfg.ids is not None and (not cfg.ids or not all(ID_RE.fullmatch(i) for i in cfg.ids)):
            raise Refused("--ids: comma-separated demo ids of letters, digits, _ and -")
        if (cfg.tag is None) == (cfg.ids is None):
            raise Refused("give the human demos with --tag or --ids (one of them)")
        if cfg.input is not None and cfg.input not in INPUTS:
            raise Refused(f"--input must be one of {INPUTS}")
        if cfg.repairer not in REPAIRERS:
            raise Refused(f"--repairer must be one of {REPAIRERS}")
        if cfg.recipe_source not in RECIPE_SOURCES:
            raise Refused(f"--recipe-source must be one of {RECIPE_SOURCES}")
        if cfg.no_model and cfg.recipe_source == "nemotron" and cfg.recipe is None:
            raise Refused("--no-model writes only the rules baseline: pass --recipe-source rules")
        for label, v, lo, hi in (("--eval-n", cfg.eval_n, 1, 400), ("--k", cfg.k, 1, 5), ("--variants", cfg.variants, 1, 99),
                                 ("--steps", cfg.steps, 1, 1_000_000), ("--eval-seed0", cfg.eval_seed0, 0, 10**6)):
            if not (isinstance(v, int) and lo <= v <= hi):
                raise Refused(f"{label} must be an integer in {lo}..{hi}, got {v!r}")
        if cfg.min_demos is not None and not (isinstance(cfg.min_demos, int) and 1 <= cfg.min_demos <= 1000):
            raise Refused("--min-demos must be a positive integer")
        if cfg.recipe is None and not cfg.evals:
            raise Refused("give an eval to diagnose (--eval) or a recipe (--recipe)")
        evals = tuple(self._under_root(e, "--eval") for e in cfg.evals)
        for e in evals:
            if not e.is_file():
                raise Refused(f"--eval {e} does not exist")
        recipe = None if cfg.recipe is None else self._under_root(cfg.recipe, "--recipe")
        if recipe is not None and not recipe.is_file():
            raise Refused(f"--recipe {recipe} does not exist")
        env_file = None if cfg.env_file is None else self._under_root(cfg.env_file, "--env-file")
        data = self._under_root(cfg.data_dir, "--data-dir")
        return LoopConfig(**{**cfg.__dict__, "root": self.root, "evals": evals, "recipe": recipe,
                             "env_file": env_file, "data_dir": data})

    def _check_seeds(self) -> None:
        c = self.cfg
        lo, hi = c.eval_seed0, c.eval_seed0 + c.eval_n - 1
        seeds = set(range(lo, hi + 1))
        if lo < EVAL_SEED_MIN:
            raise Refused(f"eval seeds {lo}-{hi}: seeds below {EVAL_SEED_MIN} are training scenes")
        spent = sorted(seeds & _eval_only_seeds())
        if spent:
            raise Refused(f"eval seeds {lo}-{hi} include {spent[0]}..{spent[-1]}, which are eval-only seeds already "
                          "spent (sim_eval.distill_round.EVAL_ONLY_SEEDS); pick fresh seeds, e.g. 5680")
        for a, b, why in SPENT_RANGES:
            if lo <= b and a <= hi:
                raise Refused(f"eval seeds {lo}-{hi} overlap {a}-{b}: {why}")
        for e in c.evals:
            used = seeds & eval_seeds(e)
            if used:
                raise Refused(f"eval seeds {lo}-{hi} include {min(used)}, a seed of the diagnosed eval {e.name}: the "
                              "recipe was fitted to it")
        own = {f"{c.name}_recipe", f"{c.name}_control"}
        for cfg_path in sorted((c.data_dir / "human_exp").glob("*/config.json")):
            name = cfg_path.parent.name
            if name in own:
                continue
            other = _read_json(cfg_path) or {}
            blocks = [(other.get("eval_seed0"), other.get("eval_n"))]
            if other.get("select_steps"):
                blocks.append((other.get("practice_seed0"), other.get("practice_n")))
            for s0, n in blocks:
                if isinstance(s0, int) and isinstance(n, int) and lo <= s0 + n - 1 and s0 <= hi:
                    raise Refused(f"eval seeds {lo}-{hi} overlap {s0}-{s0 + n - 1}, frozen by the experiment {name}")
        for state_path in sorted((c.data_dir / "loops").glob("*/loop.json")):
            if state_path.parent.name == c.name:
                continue
            s = (_read_json(state_path) or {}).get("seeds") or {}
            s0, n = s.get("seed0"), s.get("n")
            if isinstance(s0, int) and isinstance(n, int) and lo <= s0 + n - 1 and s0 <= hi:
                raise Refused(f"eval seeds {lo}-{hi} overlap {s0}-{s0 + n - 1}, used by the loop {state_path.parent.name}")

    # ------------------------------------------------------------------ the commands

    def arm_name(self, arm: str) -> str:
        return f"{self.cfg.name}_{arm}"

    @property
    def frozen_recipe(self) -> Path:
        return self.folder / "recipe.json"

    @property
    def recipe_input(self) -> Path:
        return self.cfg.recipe or self.folder / "diagnose" / f"recipe_{self.cfg.recipe_source}.json"

    def diagnose_command(self) -> list[str] | None:
        c = self.cfg
        if c.recipe is not None:
            return None
        cmd = [c.python, str(REPO_ROOT / "scripts" / "analyze_failures.py")]
        for e in c.evals:
            cmd += ["--eval", str(e)]
        cmd += ["--out", str(self.folder / "diagnose"), "--k", str(c.k)]
        if c.results_only:
            cmd.append("--results-only")
        if c.post_hoc:
            cmd += ["--protect", "none"]
        if c.no_model:
            cmd.append("--no-model")
        return cmd

    def arm_command(self, arm: str, until: str) -> list[str]:
        """The experiment command; the two arms differ only in --name and --scene-recipe."""
        c = self.cfg
        cmd = [c.python, str(REPO_ROOT / "scripts" / "run_human_demo_experiment.py"), "--name", self.arm_name(arm),
               "--data-dir", str(c.data_dir)]
        cmd += ["--tag", c.tag] if c.tag is not None else ["--ids", ",".join(c.ids or ())]
        if c.input is not None:
            cmd += ["--input", c.input]
        if c.min_demos is not None:
            cmd += ["--min-demos", str(c.min_demos)]
        cmd += ["--repairer", c.repairer, "--variants", str(c.variants), "--steps", str(c.steps),
                "--eval-n", str(c.eval_n), "--eval-seed0", str(c.eval_seed0), "--no-nemotron", "--multiplied-only"]
        if c.smoke:
            cmd.append("--smoke")
        if arm == "recipe":
            cmd += ["--scene-recipe", str(self.frozen_recipe)]
        cmd += ["--until", until]
        return cmd

    def command(self, stage: str) -> list[str] | None:
        if stage == "diagnose":
            return self.diagnose_command()
        if stage.startswith("train_"):
            return self.arm_command(stage[len("train_"):], "train")
        if stage.startswith("eval_"):
            return self.arm_command(stage[len("eval_"):], "results")
        return None

    def plan(self) -> list[Planned]:
        return [Planned(s, self.command(s)) for s in STAGES]

    # ------------------------------------------------------------------ state

    def _load(self) -> dict:
        state = _read_json(self.state_path)
        if state is None:
            c = self.cfg
            state = {"name": c.name, "version": 1, "created": _now(),
                     "seeds": {"seed0": c.eval_seed0, "n": c.eval_n, "range": [c.eval_seed0, c.eval_seed0 + c.eval_n - 1]},
                     "arms": {a: self.arm_name(a) for a in ARMS}, "smoke": c.smoke,
                     "stages": {s: {"status": "pending"} for s in STAGES}, "result": None}
        for s in STAGES:
            state["stages"].setdefault(s, {"status": "pending"})
        return state

    def _save(self, state: dict) -> None:
        state["updated"] = _now()
        _write_json(self.state_path, state)

    # ------------------------------------------------------------------ each stage's inputs and outputs

    def _exp_root(self, arm: str) -> Path:
        return self.cfg.data_dir / "human_exp" / self.arm_name(arm)

    def outputs(self, stage: str) -> dict[str, Path]:
        if stage == "diagnose":
            return {"recipe": self.recipe_input}
        if stage == "freeze":
            return {"recipe": self.frozen_recipe, "freeze": self.folder / "freeze.json",
                    "preregistration": self.folder / "preregistration.md"}
        if stage.startswith("train_"):
            return {"train_marker": self._exp_root(stage[6:]) / "stages" / "train.json"}
        if stage.startswith("eval_"):
            return {"results": self._exp_root(stage[5:]) / "results.json"}
        return {"compare": self.folder / "compare.json", "report": self.folder / "report.md"}

    def _outputs_ok(self, stage: str) -> bool:
        out = self.outputs(stage)
        if not all(p.is_file() for p in out.values()):
            return False
        if stage.startswith("train_"):
            return bool((_read_json(out["train_marker"]) or {}).get("ok"))
        if stage.startswith("eval_"):
            return self._headline(stage[5:], strict=False) is not None
        return True

    def inputs(self, stage: str, state: dict) -> dict:
        cmd = self.command(stage)
        if stage == "diagnose":
            if self.cfg.recipe is not None:
                return {"recipe": sha256_file(self.cfg.recipe)}
            return {"cmd": cmd, "evals": [sha256_file(e) for e in self.cfg.evals]}
        if stage == "freeze":
            return {"recipe": sha256_file(self.recipe_input), "seeds": [self.cfg.eval_seed0, self.cfg.eval_n],
                    "arms": {a: self.arm_command(a, "train") for a in ARMS}, "smoke": self.cfg.smoke}
        if stage.startswith("train_"):
            return {"cmd": cmd, "freeze": state["stages"]["freeze"].get("inputs_hash")}
        if stage.startswith("eval_"):
            return {"cmd": cmd, "train": sha256_file(self.outputs("train_" + stage[5:])["train_marker"])}
        return {a: sha256_file(self.outputs("eval_" + a)["results"]) for a in ARMS}

    # ------------------------------------------------------------------ run

    def run(self, *, stage: str | None = None, dry_run: bool = False) -> int:
        """0 done, 1 refused, 2 a stage failed (re-run to resume)."""
        if stage is not None and stage not in STAGES:
            self.log(f"[loop] REFUSED: unknown stage {stage!r}; one of {', '.join(STAGES)}")
            return 1
        stages = [stage] if stage else list(STAGES)
        if dry_run:
            for p in self.plan():
                if p.stage not in stages:
                    continue
                if p.command is None:
                    what = {"diagnose": f"skipped: the recipe is given ({self.cfg.recipe})",
                            "freeze": f"in-process: validate the recipe, copy it to {self.frozen_recipe}, write "
                                      f"{self.folder / 'preregistration.md'}",
                            "compare": "in-process: two-sided Fisher (recipe ahead), Wilson 95% CIs -> "
                                       f"{self.folder / 'compare.json'}, report.md"}[p.stage]
                    self.log(f"[{p.stage}] {what}")
                else:
                    self.log(f"[{p.stage}] {subprocess.list2cmdline(p.command)}")
            return 0
        try:
            state = self._load()
            for s in stages:
                if not self._run_stage(s, state):
                    return 2
        except Refused as e:
            self.log(f"[loop] REFUSED: {e}")
            return 1
        self.log(f"[loop] {self.cfg.name}: done through {stages[-1]} -> {self.state_path}")
        return 0

    def _run_stage(self, stage: str, state: dict) -> bool:
        missing = [prev for prev in STAGES[: STAGES.index(stage)] if state["stages"][prev]["status"] not in DONE]
        if missing:
            raise Refused(f"{stage} needs {', '.join(missing)} first")
        st = state["stages"][stage]
        inputs_hash = _hash(self.inputs(stage, state))
        if st.get("status") in DONE and st.get("inputs_hash") == inputs_hash and self._outputs_ok(stage):
            self.log(f"[{stage}] skip: done at {st.get('ended')}, inputs unchanged")
            return True
        if stage == "freeze" and st.get("status") in DONE:
            started = [s for s in STAGES[2:] if state["stages"][s]["status"] != "pending"]
            if started:
                raise Refused("the recipe or the pre-registered settings changed after the arms started "
                              f"({', '.join(started)}); the pre-registration stands as frozen. Use a new --name")
        cmd = self.command(stage)
        st.clear()
        st.update(status="running", command=cmd, started=_now(), inputs_hash=inputs_hash)
        self._save(state)
        if stage == "diagnose" and cmd is None:
            st.update(status="provided", ended=_now(), outputs={"recipe": str(self.cfg.recipe)})
            self._save(state)
            self.log(f"[diagnose] the recipe is given: {self.cfg.recipe}")
            return True
        try:
            if cmd is not None:
                if stage != "diagnose":
                    self._lock_note()
                self.log(f"[{stage}] {subprocess.list2cmdline(cmd)}")
                rc = self.runner(cmd, self.folder / "logs" / f"{stage}.log", self._env(stage))
                st["exit"] = rc
                if rc != 0 or not self._outputs_ok(stage):
                    st.update(status="failed", ended=_now(),
                              error=f"exit {rc}" if rc else "the stage's output files are missing or incomplete")
                    self._save(state)
                    self.log(f"[{stage}] FAILED ({st['error']}); see {self.folder / 'logs' / f'{stage}.log'}; "
                             "re-run to resume")
                    return False
            elif stage == "freeze":
                self._freeze(state)
            else:
                state["result"] = self._compare(state)
        except Refused as e:
            st.update(status="failed", ended=_now(), error=str(e))
            self._save(state)
            raise
        st.update(status="done", ended=_now(), outputs={k: str(v) for k, v in self.outputs(stage).items()})
        self._save(state)
        self.log(f"[{stage}] done")
        return True

    def _env(self, stage: str) -> dict | None:
        """The diagnose child gets the env file's variables (the Token Factory key); nothing else changes."""
        if stage != "diagnose" or self.cfg.env_file is None:
            return None
        from dotenv import dotenv_values

        return {**os.environ, **{k: v for k, v in dotenv_values(self.cfg.env_file).items() if v is not None}}

    def _lock_note(self) -> None:
        """Who holds the GPU lock, for the log. The experiment script waits for it; this process never takes it."""
        try:
            from sim_worker.gpulock import LOCK_PATH, parse_lock, pid_alive

            text = LOCK_PATH.read_text(encoding="utf-8").strip()
        except (OSError, ImportError):
            return
        _, pid = parse_lock(text)
        alive = pid is not None and pid_alive(pid)
        self.log(f"[loop] {LOCK_PATH} is held ({text!r}, PID {'alive' if alive else 'not running'}); "
                 "the experiment script waits for it")

    # ------------------------------------------------------------------ freeze

    def _freeze(self, state: dict) -> None:
        from demo_pipeline.data_fixes import fix_errors
        from demo_pipeline.data_recipe import DataRecipe, validate_recipe

        src = self.recipe_input
        text = src.read_text(encoding="utf-8")
        try:
            recipe = DataRecipe.model_validate_json(text)
        except ValueError as e:
            raise Refused(f"the recipe {src.name} is not a DataRecipe: {e}") from None
        problems = validate_recipe(recipe, robot="franka") + fix_errors(recipe.fixes)
        if problems:
            if not recipe.regions and not recipe.fixes:
                raise Refused("the recipe changes nothing (no region, no fix): the analyst found nothing to act on, "
                              "so there is no A/B to run")
            raise Refused(f"the recipe {src.name} is not usable: " + "; ".join(problems))
        self.folder.mkdir(parents=True, exist_ok=True)
        if src.resolve() != self.frozen_recipe.resolve():
            shutil.copyfile(src, self.frozen_recipe)
        sha = sha256_file(self.frozen_recipe)
        freeze = {"recipe_sha256": sha, "recipe_from": str(src), "frozen_at": _now(),
                  "seeds": state["seeds"], "arms": {a: self.arm_command(a, "train") for a in ARMS},
                  "diagnosed": [{"file": e.name, "sha256": sha256_file(e)} for e in self.cfg.evals],
                  "decision": {"test": "fisher_exact_two_sided", "alpha": ALPHA}}
        _write_json(self.folder / "freeze.json", freeze)
        (self.folder / "preregistration.md").write_text(self.preregistration(recipe, freeze), encoding="utf-8")

    def preregistration(self, recipe, freeze: dict) -> str:
        c = self.cfg
        lo, hi = freeze["seeds"]["range"]
        regions = "\n".join(
            f"  - `{r.name}` ({r.share:.0%} of the new scenes): cube x {list(r.cube_x)}, y {list(r.cube_y)}; "
            f"bin x {list(r.bin_x)}, y {list(r.bin_y)}; targets {', '.join(r.targets)}" for r in recipe.regions) or "  - none"
        fixes = "\n".join(f"  - `{f.lever}` ({f.rationale})" for f in recipe.fixes) or "  - none"
        diag = ", ".join(f"`{d['file']}` (sha256 {d['sha256'][:12]})" for d in freeze["diagnosed"]) or "a given recipe"
        return f"""# Pre-registration: SANT loop `{c.name}`

Written {freeze['frozen_at']}, by the freeze stage, before either arm is trained.{' **SMOKE TEST: proves the stages run; not a result.**' if c.smoke else ''}

## Question
Does training on scenes chosen by the failure analyst's recipe beat training on uniformly sampled scenes,
everything else the same?

## The recipe (frozen)
- File: `recipe.json`, sha256 `{freeze['recipe_sha256']}`.
- Diagnosed from: {diag}{' (post-hoc: those seeds were a test already run)' if c.post_hoc else ''}.
- Summary: {recipe.summary}
- Uniform share: {recipe.uniform_share:.0%}
- Regions:
{regions}
- Fixes:
{fixes}

## Arms
- **recipe** (`{self.arm_name('recipe')}`): the command below with `--scene-recipe recipe.json`.
- **control** (`{self.arm_name('control')}`): the identical command without `--scene-recipe`
  (variant scenes as multiply has always sampled them).
- Same human demos, same repair, {c.variants} variants per demo, ACT {c.steps} steps, `--multiplied-only`.

```
{subprocess.list2cmdline(freeze['arms']['recipe'])}
{subprocess.list2cmdline(freeze['arms']['control'])}
```

## Evaluation
- Both arms on the same fresh seeds **{lo}-{hi}** (n = {c.eval_n} per arm), each arm once.
- The seed guard checked them against every spent block, the diagnosed eval and every other experiment's seeds.
- An episode ended by `sim_error` / `policy_error` is re-run (eval_cells resume) and never counted.

## Decision rule
- Primary: **two-sided Fisher exact test (as the project's other pre-registered comparisons); the recipe wins only if
  p <= {ALPHA} and the recipe arm has the higher success rate.**
- Wilson 95% CIs for both arms. The one-sided p (recipe > control) is reported as well, as secondary.
- Anything else is "no difference shown", stated as such.
"""

    # ------------------------------------------------------------------ compare

    def _headline(self, arm: str, *, strict: bool = True) -> dict | None:
        res = _read_json(self.outputs("eval_" + arm)["results"])
        head = (((res or {}).get("experiment") or {}).get("headline") or {}).get("multiplied")
        ok = (isinstance(head, dict) and head.get("complete") and head.get("seed0") == self.cfg.eval_seed0
              and head.get("n_registered", head.get("n")) == self.cfg.eval_n and isinstance(head.get("successes"), int)
              and isinstance(head.get("n"), int) and 0 <= head["successes"] <= head["n"] and head["n"] > 0)
        if not ok:
            if strict:
                raise Refused(f"the {arm} arm's results.json is missing, incomplete or on other seeds")
            return None
        return {"successes": head["successes"], "n": head["n"], "sample": bool(res.get("sample"))}

    def _compare(self, state: dict) -> dict:
        from demo_pipeline.data_recipe import fisher_greater

        r, c = self._headline("recipe"), self._headline("control")
        p1 = fisher_greater(r["successes"], r["n"] - r["successes"], c["successes"], c["n"] - c["successes"])
        p2 = fisher_exact(r["successes"], r["n"], c["successes"], c["n"])
        better = p2 <= ALPHA and r["successes"] / r["n"] > c["successes"] / c["n"]

        def arm(h):
            return {"successes": h["successes"], "n": h["n"], "rate": h["successes"] / h["n"],
                    "ci": list(wilson_ci(h["successes"], h["n"]))}

        freeze = _read_json(self.folder / "freeze.json") or {}
        out = {"recipe": arm(r), "control": arm(c), "test": "fisher_exact_two_sided", "alpha": ALPHA,
               "p_one_sided": p1, "p_two_sided": p2,
               "decision": "recipe_better" if better else "no_difference_shown",
               "sample": r["sample"] or c["sample"] or self.cfg.smoke, "seeds": state["seeds"],
               "recipe_sha256": freeze.get("recipe_sha256"), "at": _now()}
        _write_json(self.folder / "compare.json", out)
        (self.folder / "report.md").write_text(self.report(out), encoding="utf-8")
        self.log(f"[compare] recipe {r['successes']}/{r['n']} vs control {c['successes']}/{c['n']}, "
                 f"two-sided Fisher p = {p2:.4g}: {out['decision']}")
        return out

    def report(self, out: dict) -> str:
        r, c = out["recipe"], out["control"]
        lo, hi = out["seeds"]["range"]

        def line(label, a):
            return f"| {label} | {a['successes']}/{a['n']} ({a['rate']:.0%}) | {a['ci'][0]:.3f}-{a['ci'][1]:.3f} |"

        verdict = ("**The recipe arm is better** (two-sided Fisher p <= 0.05)." if out["decision"] == "recipe_better"
                   else "**No difference shown** at p <= 0.05; the recipe is not shown to help.")
        return f"""# SANT loop `{self.cfg.name}`: recipe vs uniform control
{'**SMOKE TEST: proves the stages run; not a result.**' if out['sample'] else ''}

Pre-registered in `preregistration.md` (recipe sha256 `{out['recipe_sha256']}`), seeds {lo}-{hi}, each arm once.

| Arm | Success | Wilson 95% CI |
|---|---|---|
{line('Recipe scenes', r)}
{line('Uniform scenes (control)', c)}

- One-sided Fisher exact (recipe > control): p = {out['p_one_sided']:.4g}
- Two-sided Fisher exact: p = {out['p_two_sided']:.4g}

{verdict}
"""
