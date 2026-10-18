"""Measure Nemotron's labeler and judge against code, on existing recordings (pre-registered).

Pre-registration and results: docs/superpowers/notes/2026-10-18-nemotron-judge.md.

    uv run python scripts/intent_eval.py build  --out docs/superpowers/notes/2026-10-18-nemotron-judge/sets.json
    uv run python scripts/intent_eval.py run    --sets <sets.json> --phase dev  --env C:/dev/pm-t4/.env
    uv run python scripts/intent_eval.py run    --sets <sets.json> --phase test --env C:/dev/pm-t4/.env
    uv run python scripts/intent_eval.py report --phase test

- Episodes are read (never written) from T2's store (--episodes, default C:/dev/pm-t2/data/episodes).
- `run --dry-run` scores the code baselines only and makes no call.
- Results go to data/intent_eval/<phase>/ (git-ignored): labels.jsonl, judgements.jsonl, calls.jsonl.
  A re-run skips items already done. Every call is logged with its item, tokens, estimated USD,
  latency and the running total; the key is read from --env and never printed.
- The spend cap counts every call in every phase: a call is refused once spent + $0.01 would pass
  --cap (default $4.50, under the task's $5).
"""
from __future__ import annotations

import argparse
import io
import json
import math
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from demo_pipeline.intent import (  # noqa: E402
    IntentError,
    code_judge,
    code_label,
    recolor_cube,
    reverse_trajectory,
    sample_indices,
    score_label,
    summarize,
    truth_events,
)
from demo_pipeline.schemas import Trajectory  # noqa: E402
from demo_pipeline.stats import wilson_ci  # noqa: E402

EPISODES = Path("C:/dev/pm-t2/data/episodes")
OUT = ROOT / "data" / "intent_eval"
LABEL_FRAMES = 8
JUDGE_FRAMES = 4
MODEL_SIZE = 256  # frames are 128 px; T4's diagnoser sent 256 px (263 prompt tokens per image)

# --- the sets --------------------------------------------------------------------------------------


def _ok(ep: Path, name: str) -> bool:
    return json.loads((ep / name / "verification.json").read_text())["success"]


def _reasons(ep: Path, name: str) -> list[str]:
    return json.loads((ep / name / "verification.json").read_text())["reasons"]


def _copies(ep: Path, source: str, sep: str) -> list[str]:
    return sorted(d.name for d in ep.glob(f"{source}{sep}*") if d.is_dir() and (d / "front").is_dir())


def build_sets(ep: Path) -> dict:
    """Deterministic item lists. Dev: home_src_3009 and degraded_0015-0019 only; test never uses them."""
    home = {i: [c for c in _copies(ep, f"home_src_{i}", "_") if _ok(ep, c)] for i in range(3000, 3010)}
    s1_ok = {k: [] for k in range(5)}
    s1_fail = {k: [] for k in range(5)}
    for k in range(5):
        for lineage in ("", "_rules", "_nemotron"):
            for c in _copies(ep, f"s1_000{k}{lineage}_mx_", ""):
                (s1_ok if _ok(ep, c) else s1_fail)[k].append(c)
        s1_ok[k].sort()
        s1_fail[k] = sorted(c for c in s1_fail[k] if "not_in_bin" in _reasons(ep, c))

    red_bin = {"color": "red", "destination": "bin"}

    def lab(clip, perturb=None, truth=red_bin):
        return {"id": f"{clip}{'+' + perturb if perturb else ''}", "clip": clip, "perturb": perturb, "truth": truth}

    def pair(kind, human, copy, perturb=None):
        return {"id": f"{kind}:{human}|{copy}{'+' + perturb if perturb else ''}", "kind": kind, "human": human,
                "copy": copy, "perturb": perturb, "truth": "yes" if kind == "match" else "no"}

    green_bin = {"color": "green", "destination": "bin"}
    red_table = {"color": "red", "destination": "table"}
    used: set[str] = set()

    def take(pool: list[str], n: int) -> list[str]:
        out = [c for c in pool if c not in used][:n]
        used.update(out)
        return out

    # Labeler, test: 10 recorded demos, 10 copies, 10 recoloured copies, 10 reversed copies.
    label_test = [lab(f"s1_000{k}_raw") for k in range(5)] + [lab(f"degraded_{i:04d}") for i in range(5)]
    label_test += [lab(c) for k in range(5) for c in take(s1_ok[k], 1)]
    label_test += [lab(c) for i in range(3000, 3005) for c in take(home[i], 1)]
    label_test += [lab(c, "recolor", green_bin) for i in range(3000, 3009) for c in take(home[i], 1)]
    label_test += [lab(c, "recolor", green_bin) for c in take(home[3000], 1)]
    label_test += [lab(c, "reverse", red_table) for i in range(3000, 3009) for c in take(home[i], 1)]
    label_test += [lab(c, "reverse", red_table) for c in take(home[3001], 1)]

    # Judge, test: 30 matching pairs and 30 wrong ones (10 per kind). Every copy is used once.
    used.clear()
    match = [pair("match", f"s1_000{k}_raw", c) for k in range(5) for c in take(s1_ok[k], 4)]
    match += [pair("match", f"home_src_{i}", c) for i in range(3000, 3009) for c in take(home[i], 1)]
    match += [pair("match", f"home_src_{i}", c) for i in range(3000, 3009) for c in take(home[i], 1)]
    match = match[:30]
    obj = [pair("object", f"s1_000{k}_raw", c, "recolor") for k in (3, 4) for c in take(s1_ok[k], 3)][:5]
    obj += [pair("object", f"home_src_{i}", c, "recolor") for i in range(3000, 3005) for c in take(home[i], 1)]
    goal = [pair("goal", f"s1_000{k}_raw", c, "reverse") for k in (0, 1, 3, 4) for c in take(s1_ok[k], 2)][:5]
    goal += [pair("goal", f"home_src_{i}", c, "reverse") for i in range(3004, 3009) for c in take(home[i], 1)]
    failed = []
    while len(failed) < 10 and any(c not in used for k in range(5) for c in s1_fail[k]):
        for k in range(5):
            failed += [pair("failed", f"s1_000{k}_raw", c) for c in take(s1_fail[k], 1)]
    judge_test = match + obj[:10] + goal[:10] + failed[:10]

    # Dev: prompt and pixel-rule checks only, on sources the test never uses.
    used.clear()
    label_dev = [lab("degraded_0018"), *(lab(c) for c in take(home[3009], 1)),
                 *(lab(c, "recolor", green_bin) for c in take(home[3009], 1)),
                 *(lab(c, "reverse", red_table) for c in take(home[3009], 1))]
    judge_dev = [*(pair("match", "home_src_3009", c) for c in take(home[3009], 1)),
                 *(pair("object", "home_src_3009", c, "recolor") for c in take(home[3009], 1)),
                 *(pair("goal", "home_src_3009", c, "reverse") for c in take(home[3009], 1)),
                 pair("failed", "home_src_3009", "v2_2000")]
    return {"episodes": str(ep), "dev": {"label": label_dev, "judge": judge_dev},
            "test": {"label": label_test, "judge": judge_test}}


# --- clips -------------------------------------------------------------------------------------------


class Clip:
    """One episode's sampled frames and summary, with the perturbation applied."""

    def __init__(self, ep: Path, name: str, perturb: str | None, k: int):
        traj = Trajectory.model_validate_json((ep / name / "trajectory.json").read_text())
        fps = json.loads((ep / name / "episode.json").read_text())["fps"]
        files = sorted((ep / name / "front").glob("*.png"))
        if len(files) != len(traj.t):
            raise ValueError(f"{name}: {len(files)} frames but {len(traj.t)} trajectory steps")
        n = len(files)
        if perturb == "reverse":
            traj = reverse_trajectory(traj)
        self.indices = sample_indices(n, k)
        source = [n - 1 - i for i in self.indices] if perturb == "reverse" else self.indices
        arrays = [np.asarray(Image.open(files[i]).convert("RGB")) for i in source]
        if perturb == "recolor":
            arrays = [recolor_cube(a) for a in arrays]
        self.arrays = arrays
        self.summary = summarize(traj, fps)
        self.traj = traj
        self.fps = fps

    def pngs(self) -> list[tuple[int, bytes]]:
        out = []
        for i, a in zip(self.indices, self.arrays):
            buf = io.BytesIO()
            Image.fromarray(a).resize((MODEL_SIZE, MODEL_SIZE), Image.LANCZOS).save(buf, format="PNG")
            out.append((i, buf.getvalue()))
        return out


# --- running -----------------------------------------------------------------------------------------


def _jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _append(path: Path, rec: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def spent_so_far(out: Path) -> float:
    return sum(c.get("est_cost_usd", 0.0) for p in out.glob("*/calls.jsonl") for c in _jsonl(p))


def run(args) -> None:
    sets = json.loads(Path(args.sets).read_text())
    ep = Path(args.episodes or sets["episodes"])
    phase_dir = OUT / args.phase
    budget = None
    if not args.dry_run:
        from dotenv import load_dotenv

        if args.env:
            load_dotenv(args.env)  # never printed
        os.environ["USAGE_LOG_PATH"] = str(OUT / "usage_log.jsonl")
        from app.ai.intent import Budget

        budget = Budget(cap_usd=args.cap, per_call_reserve_usd=0.01, spent_usd=spent_so_far(OUT))
        print(f"spend so far ${budget.spent_usd:.4f}; cap ${args.cap:.2f}")

    which = ["label", "judge"] if args.what == "both" else [args.what]
    for what in which:
        items = sets[args.phase][what][: args.limit or None]
        out_file = phase_dir / ("labels.jsonl" if what == "label" else "judgements.jsonl")
        if args.dry_run:
            out_file = phase_dir / ("labels.code.jsonl" if what == "label" else "judgements.code.jsonl")
        done = {r["id"] for r in _jsonl(out_file)}
        for item in items:
            if item["id"] in done:
                continue
            rec = (_run_label if what == "label" else _run_judge)(ep, item, budget, phase_dir, args.dry_run)
            if rec is None:
                print("stopped: spend cap reached")
                return
            _append(out_file, rec)
            print(f"{what} {item['id']}: code {rec['code_summary']} | model {rec.get('model_summary', '-')}")


def _call_logger(phase_dir: Path, item_id: str, budget):
    def on_call(entry: dict) -> None:
        _append(phase_dir / "calls.jsonl", {"item": item_id, **entry, "spent_usd": round(budget.spent_usd, 6)})

    return on_call


def _run_label(ep, item, budget, phase_dir, dry):
    clip = Clip(ep, item["clip"], item["perturb"], LABEL_FRAMES)
    truth = item["truth"]
    events = truth_events(clip.traj)
    score = lambda lab: score_label(lab, color=truth["color"], destination=truth["destination"], events=events, fps=clip.fps)  # noqa: E731
    code = code_label(clip.arrays, clip.summary)
    rec = {"id": item["id"], "truth": truth, "events": events, "code": code.model_dump(), "code_score": score(code)}
    rec["code_summary"] = rec["code_score"]
    if dry:
        return rec
    from app.ai.intent import BudgetExceeded, label_demo

    try:
        lab = label_demo(clip.pngs(), clip.summary, budget=budget, on_call=_call_logger(phase_dir, item["id"], budget))
        rec.update(model=lab.model_dump(), model_score=score(lab), model_error=None)
    except BudgetExceeded:
        return None
    except IntentError as e:
        rec.update(model=None, model_score={k: False for k in ("color", "destination", "task", "steps")}, model_error=str(e))
    rec["model_summary"] = rec["model_score"]
    return rec


def _run_judge(ep, item, budget, phase_dir, dry):
    human = Clip(ep, item["human"], None, JUDGE_FRAMES)
    copy = Clip(ep, item["copy"], item["perturb"], JUDGE_FRAMES)
    code = code_judge((human.arrays, human.summary), (copy.arrays, copy.summary))
    rec = {"id": item["id"], "kind": item["kind"], "truth": item["truth"], "code": code.model_dump(),
           "code_right": code.matches == item["truth"]}
    rec["code_summary"] = code.matches
    if dry:
        return rec
    from app.ai.intent import BudgetExceeded, judge_pair

    try:
        v = judge_pair(human.pngs(), human.summary, copy.pngs(), copy.summary, budget=budget,
                       on_call=_call_logger(phase_dir, item["id"], budget))
        rec.update(model=v.model_dump(), model_right=v.matches == item["truth"], model_error=None)
        rec["model_summary"] = v.matches
    except BudgetExceeded:
        return None
    except IntentError as e:
        rec.update(model=None, model_right=False, model_error=str(e))
        rec["model_summary"] = "invalid"
    return rec


# --- reporting ---------------------------------------------------------------------------------------


def sign_test_p(model_only: int, code_only: int) -> float:
    """Exact two-sided binomial (McNemar) p on the discordant pairs."""
    n = model_only + code_only
    if n == 0:
        return 1.0
    k = min(model_only, code_only)
    return min(1.0, 2 * sum(math.comb(n, i) for i in range(k + 1)) / 2**n)


def _rate(k: int, n: int) -> str:
    lo, hi = wilson_ci(k, n)
    return f"{k}/{n} = {100 * k / n:.1f}% (95% CI {100 * lo:.1f}-{100 * hi:.1f}%)"


def _compare(rows: list[dict], model_key, code_key) -> list[str]:
    m = [bool(model_key(r)) for r in rows]
    c = [bool(code_key(r)) for r in rows]
    mo = sum(a and not b for a, b in zip(m, c))
    co = sum(b and not a for a, b in zip(m, c))
    return [f"  Nemotron {_rate(sum(m), len(rows))}", f"  code     {_rate(sum(c), len(rows))}",
            f"  only Nemotron right: {mo}, only code right: {co}, exact sign-test p = {sign_test_p(mo, co):.3g}"]


def report(args) -> None:
    d = OUT / args.phase
    labels, judges = _jsonl(d / "labels.jsonl"), _jsonl(d / "judgements.jsonl")
    calls = _jsonl(d / "calls.jsonl")
    lines = [f"# intent eval, phase {args.phase}", ""]
    if labels:
        lines.append(f"Labeler, {len(labels)} clips")
        for key in ("task", "color", "destination", "steps"):
            lines.append(f"- {key}:")
            lines += _compare(labels, lambda r, k=key: r["model_score"][k], lambda r, k=key: r["code_score"][k])
        for group in ("", "+recolor", "+reverse"):
            rows = [r for r in labels if (group in r["id"] if group else "+" not in r["id"])]
            if rows:
                lines.append(f"- task, {group or 'unperturbed'} ({len(rows)}): Nemotron {sum(r['model_score']['task'] for r in rows)}, "
                             f"code {sum(r['code_score']['task'] for r in rows)}")
        lines.append(f"- invalid after 2 attempts: {sum(1 for r in labels if r.get('model_error'))}")
    if judges:
        lines += ["", f"Judge, {len(judges)} pairs"]
        lines += _compare(judges, lambda r: r["model_right"], lambda r: r["code_right"])
        for kind in ("match", "object", "goal", "failed"):
            rows = [r for r in judges if r["kind"] == kind]
            if rows:
                lines.append(f"- {kind} ({len(rows)}): Nemotron {_rate(sum(r['model_right'] for r in rows), len(rows))}; "
                             f"code {sum(r['code_right'] for r in rows)}/{len(rows)}")
        pos = [r for r in judges if r["truth"] == "yes"]
        neg = [r for r in judges if r["truth"] == "no"]
        if pos and neg:
            for who in ("model", "code"):
                bal = (sum(r[f"{who}_right"] for r in pos) / len(pos) + sum(r[f"{who}_right"] for r in neg) / len(neg)) / 2
                lines.append(f"- balanced accuracy, {who}: {bal:.3f}")
        lines.append(f"- invalid after 2 attempts: {sum(1 for r in judges if r.get('model_error'))}")
    if calls:
        cost = sum(c["est_cost_usd"] for c in calls)
        lat = sorted(c["latency_s"] for c in calls)
        lines += ["", f"Calls: {len(calls)}, est. ${cost:.4f}, median latency {lat[len(lat) // 2]:.2f} s, "
                      f"invalid replies {sum(not c['valid'] for c in calls)}; all phases ${spent_so_far(OUT):.4f}"]
    print("\n".join(lines))


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("--episodes", default=str(EPISODES))
    b.add_argument("--out", required=True)
    r = sub.add_parser("run")
    r.add_argument("--sets", required=True)
    r.add_argument("--phase", choices=["dev", "test"], required=True)
    r.add_argument("--what", choices=["label", "judge", "both"], default="both")
    r.add_argument("--episodes")
    r.add_argument("--env", help="path to a .env holding NEBIUS_API_KEY (never printed)")
    r.add_argument("--cap", type=float, default=4.50)
    r.add_argument("--limit", type=int, default=0)
    r.add_argument("--dry-run", action="store_true")
    rep = sub.add_parser("report")
    rep.add_argument("--phase", choices=["dev", "test"], required=True)
    args = p.parse_args()
    if args.cmd == "build":
        sets = build_sets(Path(args.episodes))
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(json.dumps(sets, indent=1) + "\n", encoding="utf-8", newline="\n")  # LF, so the hash holds
        for phase in ("dev", "test"):
            j = sets[phase]["judge"]
            kinds = {k: sum(x["kind"] == k for x in j) for k in ("match", "object", "goal", "failed")}
            print(f"{phase}: {len(sets[phase]['label'])} label items, {len(j)} judge pairs {kinds}")
    elif args.cmd == "run":
        run(args)
    else:
        report(args)


if __name__ == "__main__":
    main()
