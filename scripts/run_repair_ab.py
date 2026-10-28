"""Blind A/B of the repairers on the same human demos: the hand-written rules, Nemotron's trajectory edits, and the
hybrid (the rules first, the edits for a demo the rules discard; derived from the other two, primary vs the rules).

    uv run --env-file <.env> python scripts/run_repair_ab.py --name <name> --tag "human_20261019*" ^
        [--input keyboard] [--data-dir <DATA_DIR>] [--ids a,b] [--max-cost-usd 1.0] [--sim-port 8770]

One sim worker (Isaac, Franka, cameras) under the GPU lock, through run_human_demo_experiment's own pieces:
  select   the demos, frozen by hash, replaying the achieved path (Experiment.select; DATA_DIR/human_exp/<name>);
  physics  each demo replayed once as recorded (its raw verdict and signals; Experiment.physics);
  repair   both repairers on that same raw replay, the arm that goes first alternating by demo (even index: rules):
             rules           app.jobs.perfect_stored_demo(..., "rules")     -> "<id>_rules" (release_above_bin and
                             the rules' recenter_grasp included, up to 3 verifications);
             nemotron-edits  app.jobs.perfect_stored_demo_edits(...)        -> "<id>_edits" (Nemotron sees no
                             hand-written op; up to 3 model calls, each valid plan verified);
           every verification is the worker's replay and the unchanged check_success. ab/<id>.json per demo.
  summary  per arm: repaired demos that pass physics (status perfected or kept); the hybrid per demo is the rules'
           result when it passes, else the edits' (the edits arm is blind, so its run is the hybrid's fallback);
           primary rules vs hybrid, secondary rules vs edits, each with the paired table and exact McNemar.
           ab_summary.json, and the table printed.
A re-run resumes from the markers. To stop early but cleanly, create DATA_DIR/human_exp/<name>/STOP: the demo in
progress finishes, then the worker stops and gpu.lock is released (a re-run clears the file and resumes).
ab_config.json freezes the code commit, the repair prompt's SHA-256 and the prompt fingerprint (temperature, budget
hint, best-plan text, rescue) next to the experiment's config.json. Exit: 0 done, 1 refused, 2 stopped (a worker failed, the model API failed, or the spend
cap was reached: re-run to resume; a demo stopped mid-way is redone from its raw replay).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_human_demo_experiment as hx  # noqa: E402  (puts the repo root on sys.path too)

from app.ai import nemotron_repair  # noqa: E402
from app.jobs import perfect_stored_demo, perfect_stored_demo_edits, stored_raw  # noqa: E402
from app.sim_client import SimWorkerError  # noqa: E402
from demo_pipeline.edit_plan import REPAIR_BUDGET_M  # noqa: E402
from demo_pipeline.stats import mcnemar_exact, wilson_ci  # noqa: E402
from demo_pipeline.store import DemoStore  # noqa: E402
from nebius_llm import TokenFactoryError  # noqa: E402

ARMS = ("rules", "nemotron-edits")  # the two that run; the hybrid is derived from them (hybrid_status)
HYBRID = "hybrid"
PASS = ("perfected", "kept")
SETTINGS = {**hx.DEFAULTS, "smoke": False, "raw_arm": "all", "judge_copies": 1, "nemotron": False,
            "max_cost_usd": 0.0, "replay_path": "achieved", "replay_lookahead": 0, "repair": "rules"}


def prompt_sha256() -> str:
    return hashlib.sha256(nemotron_repair.SYSTEM_PROMPT.encode("utf-8")).hexdigest()


def git_commit() -> str | None:
    try:
        out = subprocess.run(["git", "rev-parse", "HEAD"], cwd=hx.REPO, capture_output=True, text=True, timeout=10)
        dirty = subprocess.run(["git", "status", "--porcelain", "--untracked-files=no"], cwd=hx.REPO,
                               capture_output=True, text=True, timeout=10).stdout.strip()
        return out.stdout.strip() + ("+dirty" if dirty else "")
    except (OSError, subprocess.SubprocessError):
        return None


def ab_settings() -> dict:
    """What run_repair_ab freezes about the edits arm (compared on a resume, like config.json)."""
    return {"arms": list(ARMS), "metric": "repaired demos that pass physics (status perfected or kept)",
            "test": "mcnemar_exact_two_sided", "order": "even index: rules first; odd: nemotron-edits first",
            "tier": nemotron_repair.TIER, "think": nemotron_repair.THINK, "max_rounds": nemotron_repair.MAX_ROUNDS,
            "repair_budget_m": REPAIR_BUDGET_M, "prompt_sha256": prompt_sha256(),
            "rescue": "a thinking reply cut at the token cap or with no JSON is re-asked once in the same round, "
                      "thinking off; not a round", "rescue_suffix_sha256": hashlib.sha256(
                nemotron_repair.RESCUE_SUFFIX.encode("utf-8")).hexdigest(),
            "primary": f"rules vs {HYBRID} (the rules' result when it passes, else the blind nemotron-edits run on "
                       "the same raw replay; no extra replays)",
            "secondary": "rules vs nemotron-edits", "temperature": nemotron_repair.TEMPERATURE,
            "prompt_fingerprint": nemotron_repair.prompt_fingerprint()}


def hybrid_status(row: dict) -> str:
    """What the hybrid repairer (app.jobs.perfect_stored_demo_hybrid) gives on this demo: the rules' result when it
    passes, else the edits'. The edits arm is blind to the rules, so its run is exactly the hybrid's fallback."""
    return row["rules"]["status"] if row["rules"]["status"] in PASS else row["nemotron-edits"]["status"]


def preregistration(config: dict, ab: dict) -> str:
    """The A/B's pre-registration (replaces the training one Experiment.select writes into this folder)."""
    ids = "\n".join(f"  - `{id}` sha256 `{config['demo_sha256'][id]}`" for id in config["ids"])
    return f"""# Pre-registration: repairer A/B `{config['name']}`

Frozen at {ab['frozen_at']} (UTC) from `config.json` and `ab_config.json`, before any repair ran. Code `{ab['commit']}`;
repair prompt sha256 `{ab['prompt_sha256']}`. The full text is docs/superpowers/notes/2026-10-20-nemotron-repair.md.

**Question.** {QUESTION_HYBRID if "primary" in ab else QUESTION_EDITS}

**Demos** ({config['n_human']}, frozen by content hash; the achieved path, lookahead {config['replay_lookahead']}{
    f"; recorded with input `{config['input']}`" if config.get("input") else ""}):
{ids}

**Arms**, both on each demo's one raw replay, the first arm alternating by demo ({ab['order']}):
- **rules:** app.jobs.perfect_stored_demo(..., "rules"): up to 3 verifications.
- **nemotron-edits:** app.jobs.perfect_stored_demo_edits: Nemotron `{ab['tier']}` (thinking {ab['think']}), at most
  {ab['max_rounds']} rounds, edits within a {ab['repair_budget_m'] * 100:.0f} cm per-step budget; each valid plan
  verified.{"" if "rescue" not in ab else " Rescue: " + ab["rescue"] + " (logged per demo and in ab_summary.json)."}{
    "" if "temperature" not in ab else f" Sampling at temperature {ab['temperature']}, the 5 cm budget stated in the"
    " facts, and the best failed plan so far shown each round; prompt fingerprint `" + ab["prompt_fingerprint"] + "`."}{
    "" if "primary" not in ab else '''
- **hybrid** (derived; no replay of its own): the rules' result when it passes, else the nemotron-edits result. The
  edits arm never sees the rules, so its run on a demo is exactly what app.jobs.perfect_stored_demo_hybrid would run
  there after the rules discard it.'''}

**Metric.** {ab['metric']}, per arm, out of {config['n_human']}. The verdict is the sim worker's replay and the
unchanged check_success, for every arm.

**Test.** {TEST_HYBRID if "primary" in ab else TEST_EDITS} Alpha 0.05, a Wilson 95% CI per arm. No interim looks, n
fixed; the counts and the paired tables are reported whatever they say. A worker, API or spend-cap stop is redone on
resume and never counted for any arm.
"""


QUESTION_EDITS = ("On the same human demos, does Nemotron's trajectory editing (no hand-written op shown to it) repair "
                  "as many demos to a physics pass as the hand-written rules (with release_above_bin and "
                  "recenter_grasp)?")
QUESTION_HYBRID = ("On human demos the rules were never written for, does the hybrid repairer (the rules first; "
                   "Nemotron's blind trajectory edits for a demo the rules discard) repair more demos to a physics "
                   "pass than the rules alone?")
TEST_EDITS = "Exact two-sided McNemar on the paired outcomes; one test."
TEST_HYBRID = ("Primary: rules vs hybrid, exact two-sided McNemar on the paired outcomes. The hybrid can only add "
               "passes (only_rules = 0 by construction), so this is a sign test on the demos the rules discard and "
               "Nemotron repairs: it reaches p < 0.05 only with 6 or more of them. Secondary: rules vs nemotron-edits "
               "alone, exact two-sided McNemar (reported, not a second confirmatory test).")


def summarize(rows: dict[str, dict]) -> dict[str, Any]:
    """Per arm passes, the paired table and McNemar, from the ab/<id>.json markers."""
    ids = list(rows)
    ok = {arm: [rows[i][arm]["status"] in PASS for i in ids] for arm in ARMS}
    n = len(ids)
    both = sum(a and b for a, b in zip(ok["rules"], ok["nemotron-edits"]))
    only_rules = sum(a and not b for a, b in zip(ok["rules"], ok["nemotron-edits"]))
    only_edits = sum(b and not a for a, b in zip(ok["rules"], ok["nemotron-edits"]))
    out: dict[str, Any] = {"n": n, "arms": {}}
    status = {arm: {i: rows[i][arm]["status"] for i in ids} for arm in ARMS}
    status[HYBRID] = {i: hybrid_status(rows[i]) for i in ids}
    for arm, st in status.items():
        k = sum(v in PASS for v in st.values())
        out["arms"][arm] = {"pass": k, "of": n, "wilson_95": wilson_ci(k, n) if n else None, "status": st}
    hyb = [status[HYBRID][i] in PASS for i in ids]
    p_both = sum(a and b for a, b in zip(ok["rules"], hyb))
    p_rules = sum(a and not b for a, b in zip(ok["rules"], hyb))  # 0 by construction
    p_hyb = sum(b and not a for a, b in zip(ok["rules"], hyb))
    out["primary"] = {"arms": ["rules", HYBRID], "both": p_both, "only_rules": p_rules, "only_hybrid": p_hyb,
                      "neither": n - p_both - p_rules - p_hyb, "mcnemar_p": mcnemar_exact(p_rules, p_hyb)}
    out["paired"] = {"both": both, "only_rules": only_rules, "only_edits": only_edits,
                     "neither": n - both - only_rules - only_edits}
    out["mcnemar_p"] = mcnemar_exact(only_rules, only_edits)
    out["nemotron_cost_usd"] = round(sum(rows[i]["nemotron-edits"].get("cost_usd", 0.0) for i in ids), 5)
    out["raw_pass"] = sum(rows[i]["raw"]["success"] for i in ids)
    edits = [rows[i]["nemotron-edits"] for i in ids]
    rescues = [r for e in edits for r in e.get("rescues", [])]
    out["model_calls"] = sum(e.get("calls", 0) for e in edits)
    out["rescues"] = {"total": len(rescues), "length": sum(r["reason"] == "length" for r in rescues),
                      "no_json": sum(r["reason"] == "no_json" for r in rescues),
                      "demos": [i for i in ids if rows[i]["nemotron-edits"].get("rescues")]}
    return out


def table(rows: dict[str, dict], s: dict) -> str:
    lines = [f"{'demo':<30} {'raw':<32} {'rules':<11} {'nemotron-edits':<15} {HYBRID:<11} edits why"]
    for i, r in rows.items():
        raw = "pass" if r["raw"]["success"] else ",".join(r["raw"]["reasons"])
        why = (r["nemotron-edits"].get("why") or "")[:60]
        lines.append(f"{i:<30} {raw:<32} {r['rules']['status']:<11} {r['nemotron-edits']['status']:<15} "
                     f"{hybrid_status(r):<11} {why}")
    a, pr = s["arms"], s["primary"]
    lines.append(f"\nPRIMARY rules {a['rules']['pass']}/{s['n']}  vs  {HYBRID} {a[HYBRID]['pass']}/{s['n']}   paired: "
                 f"both {pr['both']}, only rules {pr['only_rules']}, only {HYBRID} {pr['only_hybrid']}, neither "
                 f"{pr['neither']}   exact McNemar p = {pr['mcnemar_p']:.3f}")
    lines.append(f"secondary: rules {a['rules']['pass']}/{s['n']}  vs  nemotron-edits {a['nemotron-edits']['pass']}/{s['n']}"
                 f"   paired: both {s['paired']['both']}, only rules {s['paired']['only_rules']}, only edits "
                 f"{s['paired']['only_edits']}, neither {s['paired']['neither']}   exact McNemar p = "
                 f"{s['mcnemar_p']:.3f}   Nemotron ${s['nemotron_cost_usd']:.3f}, {s['model_calls']} calls, "
                 f"{s['rescues']['total']} re-asked without thinking ({s['rescues']['length']} at the token cap)")
    return "\n".join(lines)


class RepairAB:
    def __init__(self, exp: hx.Experiment, *, max_cost_usd: float,
                 perfect_rules: Callable = perfect_stored_demo, perfect_edits: Callable = perfect_stored_demo_edits):
        self.exp, self.max_cost_usd = exp, max_cost_usd
        self.perfect_rules, self.perfect_edits = perfect_rules, perfect_edits
        self.dir = exp.root / "ab"

    def freeze(self) -> None:
        path = self.exp.root / "ab_config.json"
        frozen = hx._read_json(path)
        now = ab_settings()
        if frozen is not None:
            diff = [k for k in now if frozen.get(k) != now[k]]
            if diff:
                raise hx.Refused(f"{path} was frozen with other edits-arm settings ({', '.join(diff)}); use a new "
                                 "--name")
        else:
            frozen = {**now, "commit": git_commit(), "frozen_at": hx._now()}
            hx._write_json(path, frozen)
        (self.exp.root / "preregistration.md").write_text(preregistration(self.exp.config, frozen), encoding="utf-8")

    def rows(self) -> dict[str, dict]:
        return {id: r for id in self.exp.ids if (r := hx._read_json(self.dir / f"{id}.json")) is not None}

    def spent(self) -> float:
        return sum(r["nemotron-edits"].get("cost_usd", 0.0) for r in self.rows().values())

    def check_budget(self) -> None:
        if self.spent() >= self.max_cost_usd:
            raise hx.Stop(f"Nemotron spend reached the ${self.max_cost_usd:.2f} cap")

    def repair_one(self, client, i: int, id: str) -> dict:
        raw = stored_raw(self.exp.store, id, need_cameras=True)
        if raw is None:
            raise hx.Stop(f"{id}: no stored raw replay; the physics step must run first")
        row: dict[str, Any] = {"id": id, "raw": raw.verification.model_dump(), "order": []}
        arms = ARMS if i % 2 == 0 else ARMS[::-1]
        for arm in arms:
            row["order"].append(arm)
            if arm == "rules":
                row[arm] = self.perfect_rules(self.exp.store, client, id, "rules", raw=raw, record_cameras=True)
            else:
                try:
                    row[arm] = self.perfect_edits(self.exp.store, client, id, raw=raw, record_cameras=True,
                                                  before_model_call=self.check_budget)
                except TokenFactoryError as e:
                    raise hx.Stop(f"{id}: the Nemotron API failed ({type(e).__name__}: {e}); re-run to resume") from e
        return row

    @property
    def stop_file(self) -> Path:
        return self.exp.root / "STOP"

    def run(self) -> dict:
        self.freeze()
        if self.stop_file.is_file():  # left by an earlier, stopped run
            self.stop_file.unlink()
            self.exp.log(f"cleared an old {self.stop_file}")
        with self.exp.deps.sim_session() as client:
            health = client.health()
            if not (health.ok and health.cameras and hx.ROBOT in health.robots):
                raise hx.Stop(f"the sim worker can't record {hx.ROBOT} camera episodes: {health}")
            try:
                self.exp.physics(client)
                for i, id in enumerate(self.exp.ids):
                    if (self.dir / f"{id}.json").is_file():
                        continue
                    if self.stop_file.is_file():  # between demos: the worker stops and the lock goes cleanly
                        raise hx.Stop(f"stop file {self.stop_file} found; re-run with the same --name to resume")
                    row = self.repair_one(client, i, id)
                    hx._write_json(self.dir / f"{id}.json", row)
                    self.exp.log(f"ab {id}: rules {row['rules']['status']}, nemotron-edits "
                                 f"{row['nemotron-edits']['status']}")
            except SimWorkerError as e:
                raise hx.Stop(f"the sim worker failed ({e}); re-run to resume") from e
        rows = self.rows()
        s = summarize(rows)
        hx._write_json(self.exp.root / "ab_summary.json", {**s, "at": hx._now()})
        self.exp.log("\n" + table(rows, s))
        return s


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--name", required=True, help="DATA_DIR/human_exp/<name>")
    p.add_argument("--ids", help="comma-separated human demo ids (in this order)")
    p.add_argument("--tag", help='fnmatch pattern over human demo ids, e.g. "human_20261019*"')
    p.add_argument("--input", choices=("camera", "keyboard", "mouse"), default=None,
                   help="only demos recorded with this input (Demo.input; needs pm/live-11's Experiment.select)")
    p.add_argument("--data-dir", type=Path, default=None)
    p.add_argument("--max-cost-usd", type=float, default=1.0, help="Nemotron spend cap for the edits arm")
    p.add_argument("--sim-port", type=int, default=8770)
    return p


def select_kwargs(args: argparse.Namespace) -> dict:
    """Experiment.select's arguments; `input` only when given, so a checkout whose select has none still runs."""
    kw = {"ids": args.ids.split(",") if args.ids else None, "tag": args.tag, "settings": SETTINGS}
    return {**kw, "input": args.input} if args.input else kw


def main(argv: list[str] | None = None) -> int:
    p = build_parser()
    args = p.parse_args(argv)
    if args.ids and args.tag:
        p.error("give --ids or --tag, not both")
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if not os.environ.get("NEBIUS_API_KEY"):
        p.error("NEBIUS_API_KEY is not set: run with uv run --env-file <path to .env>")
    if args.data_dir is not None:
        os.environ["DATA_DIR"] = str(args.data_dir)
    from demo_pipeline.paths import data_dir

    data = Path(data_dir()).resolve()

    def log(msg: str) -> None:
        print(msg if msg.startswith("[human-exp") else f"[repair-ab {datetime.now():%H:%M:%S}] {msg}", flush=True)

    gpu_stage = hx.make_gpu_stage(log)
    exp = hx.Experiment(data, args.name, hx.Deps(
        user_store=DemoStore(data), gpu_stage=gpu_stage, run=hx.make_runner(data, log), log=log,
        sim_session=hx.make_sim_session(data, args.name, gpu_stage, log, args.sim_port,
                                        data / "human_exp" / args.name / "logs", lookahead=0)))
    try:
        try:
            exp.select(**select_kwargs(args))
        except TypeError as e:  # a checkout without Demo.input (before pm/live-11's select gained `input`)
            raise hx.Refused(f"this checkout's Experiment.select takes no --input ({e}); run from pm/live-11") from e
        except ValueError as e:
            raise hx.Refused(str(e)) from e
        RepairAB(exp, max_cost_usd=args.max_cost_usd).run()
    except hx.Refused as e:
        exp.log(f"REFUSED: {e}")
        return 1
    except hx.Stop as e:
        exp.log(f"STOPPED: {e}")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
