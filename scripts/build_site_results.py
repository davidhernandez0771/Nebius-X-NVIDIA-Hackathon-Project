"""Regenerate the Results page's store numbers (web/src/site/results/stores.json) from the experiment stores.

    uv run --no-sync python scripts/build_site_results.py --data-dir C:\\dev\\pm-t6\\data [--check] [--watch 300]

Read only: it opens the experiment stores (DATA_DIR/human_exp/<name>/..., DATA_DIR/evals/...) and three notes, and
writes nothing but --out. The output uses the Results page's schema (web/src/site/results/data.ts): experiments,
groups and arms, every count with a source. A source is a note and lines (CITES below, each with the text it
quotes, which tests/test_build_site_results.py checks against the note) or a store file.

What comes from where:
- webcam (human10c): physics markers, results.json's repair/multiply counts and policy headline, the eval file's
  reasons (drops). The 9/10 and 927 N of live test #10 are quoted from its note: no store records the forces.
- repair_ab (repair_ab1, repair_ab2): each ab_summary.json; the demos repaired at least once are the union of
  both runs' per-demo statuses.
- mouse (mouse20261020): physics and repair markers; the live pass, path error and contact are read from T4's
  results note table; raw vs SANT fills in from the run's results.json once it exists and isn't a smoke run.

--check exits 1 if --out is out of date (nothing written). --watch N rebuilds every N s until the mouse run's
result is in, then exits.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "web" / "src" / "site" / "results" / "stores.json"
NOTES_DIR = "docs/superpowers/notes"

WEBCAM, AB_RUNS, MOUSE = "human10c", ("repair_ab1", "repair_ab2"), "mouse20261020"
REPAIRED = ("perfected", "kept")

NOTES = {
    "live10": {"name": "Live test #10 results note", "path": f"{NOTES_DIR}/2026-10-19-live-test-10-results.md"},
    "h10c": {"name": "human10c training note", "path": f"{NOTES_DIR}/2026-10-20-human10c-multiplied-only.md"},
    "repair": {"name": "Nemotron repairer note", "path": f"{NOTES_DIR}/2026-10-20-nemotron-repair.md"},
    "mouse": {"name": "Mouse demos results note", "path": f"{NOTES_DIR}/2026-10-20-mouse20261020-results.md"},
    "prereg": {"name": "Raw vs SANT pre-registration note", "path": f"{NOTES_DIR}/2026-10-20-kb-raw-vs-sant-prereg.md"},
}

# Each citation and the text it quotes from those lines (checked by the tests, so a moved number fails them).
CITES = {
    "webcam_raw": {"note": "live10", "lines": "325", "quote": "Raw physics passes: 0/10"},
    "webcam_pressed": {"note": "live10", "lines": "342", "quote": "9/10, up to 927 N"},
    "webcam_repaired": {"note": "live10", "lines": "434", "quote": "Perfected: **3/10**"},
    "webcam_copies": {"note": "live10", "lines": "435", "quote": "24/30"},
    "webcam_policy": {"note": "h10c", "lines": "97", "quote": "3/40 successes (7.5%), Wilson 95% CI [2.6%, 19.9%]"},
    "webcam_drops": {"note": "h10c", "lines": "115", "quote": "dropped 26"},
    "webcam_roots": {"note": "h10c", "lines": "123", "quote": "27 episodes from 3 human roots"},
    "ab1": {"note": "repair", "lines": "171", "quote": "rules 3/10 (Wilson 95% 0.11–0.60) vs Nemotron edits 5/10"},
    "ab1_p": {"note": "repair", "lines": "172–173", "quote": "p = 0.50"},
    "ab1_cost": {"note": "repair", "lines": "168", "quote": "$0.207"},
    "ab2": {"note": "repair", "lines": "346", "quote": "rules 3/10 (Wilson 95% 0.11–0.60) vs Nemotron edits 2/10"},
    "ab2_p": {"note": "repair", "lines": "347", "quote": "McNemar **p = 1.0**"},
    "ab2_cost": {"note": "repair", "lines": "348", "quote": "$0.278"},
    "union": {"note": "repair", "lines": "379–380", "quote": "Demos repaired at least once: Nemotron 6"},
    "mouse_physics": {"note": "mouse", "lines": "38", "quote": "**Live:** 10/10 pass. **Replay:** 10/10 pass."},
    "mouse_table": {"note": "mouse", "lines": "25–36", "quote": "Path error, mean / max"},
    "mouse_repair": {"note": "mouse", "lines": "39", "quote": "all 10 perfected"},
    "mouse_test": {"note": "prereg", "lines": "74", "quote": "two-sided Fisher exact, **α = 0.05**"},
    "mouse_amendment": {"note": "prereg", "lines": "8", "quote": "`--input mouse`"},
    "mouse_result": {"note": "mouse", "lines": "94", "quote": "**Not significant** at α = 0.05"},
    "mouse_training": {"note": "mouse", "lines": "71–72", "quote": "final loss **0.085**"},
    "mouse_drops": {"note": "mouse", "lines": "101", "quote": "26/40 episodes record a drop"},
    "mouse_collisions": {"note": "mouse", "lines": "103", "quote": "27/40 episodes pushed the arm into the bin or table"},
    "mouse_soft_floor": {"note": "mouse", "lines": "105–107", "quote": "T6 is investigating this"},
}

PENDING_MOUSE = ("T4's run is training and evaluating it now. It fills in when human_exp/mouse20261020/results.json "
                 "lands: then run scripts/build_site_results.py again.")


class StoreError(RuntimeError):
    """A store file the page needs is missing or unreadable."""


def cite(key: str) -> dict:
    c = CITES[key]
    return {"note": c["note"], "lines": c["lines"]}


def _read(path: Path, read: list[Path]) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise StoreError(f"can't read {path}: {e}") from e
    read.append(path)
    return data


def _markers(dir: Path, read: list[Path]) -> list[dict]:
    if not dir.is_dir():
        raise StoreError(f"no stage markers in {dir}")
    return [_read(p, read) for p in sorted(dir.glob("*.json"))]


def arm(key: str, label: str, k: int | None, n: int, source: dict | None, *, ci=None, detail=None, highlight=False,
        drops=None) -> dict:
    return {"key": key, "label": label, "detail": detail, "k": k, "n": n, "ci": ci, "highlight": highlight,
            "source": source, "outcomes": None, "outcomesSource": None, "passes": None, "passesSource": None,
            "drops": drops}


def _rel(data: Path, path: Path) -> str:
    return path.relative_to(data).as_posix()


# --- webcam (live test #10, human10c) -----------------------------------------------------------------

def webcam(data: Path, read: list[Path]) -> dict:
    root = data / "human_exp" / WEBCAM
    if not root.is_dir():
        raise StoreError(f"no {WEBCAM} experiment in {data / 'human_exp'}")
    physics = _markers(root / "stages" / "physics", read)
    res = _read(root / "results.json", read)["experiment"]
    head, d = res["headline"]["multiplied"], res["data"]
    eval_file = data / "evals" / res["run_id"] / Path(head["file"].replace("\\", "/")).name
    reasons = _read(eval_file, read)["summary"]["reasons"]
    failures = head["n"] - head["successes"]
    repaired = sum(d["repair"].get(s, 0) for s in REPAIRED)
    n = len(physics)
    return {
        "id": "webcam",
        "title": "Real webcam demos: checked, repaired, multiplied, trained",
        "question": f"One person recorded {n} demos with a webcam, driving the simulated Franka live. What does "
                    "physics make of them, and what does a policy learn from what SANT keeps?",
        "setup": "Live test #10 (2026-10-19). Replays use the path the arm reached, lookahead 0; every repair and copy is "
                 "re-verified in Isaac Lab. The policy is ACT, 30k steps, batch 8, trained only on SANT's output.",
        "seeds": "5020–5059 (40 unseen scenes) for the policy",
        "test": "Counts with a Wilson 95% CI. One arm: no comparison test.",
        "pending": None,
        "groups": [
            {"label": "Physics check of the demos as recorded", "comparisons": [], "arms": [
                arm("webcam_raw", "Webcam demos that pass", sum(bool(m["success"]) for m in physics), n,
                    cite("webcam_raw"), detail="Live, every demo put the cube in the bin, but 9 pressed into it")]},
            {"label": "Repair, then multiply", "comparisons": [], "arms": [
                arm("webcam_repaired", "Repaired by the rules and verified", repaired, n, cite("webcam_repaired")),
                arm("webcam_copies", "Multiplied copies that verify", d["multiply"]["successes"], d["multiply"]["attempts"],
                    cite("webcam_copies"), detail="10 new scenes per repaired demo")]},
            {"label": "A policy trained only on SANT's output, 40 unseen scenes", "comparisons": [], "arms": [
                arm("webcam_policy", "ACT on the 27 episodes from 3 repaired demos", head["successes"], head["n"],
                    cite("webcam_policy"), ci=head["ci"], highlight=True,
                    detail=f"{reasons.get('dropped', 0)} of its {failures} failures dropped the cube",
                    drops={"k": reasons.get("dropped", 0), "of": failures, "source": cite("webcam_drops")})]},
        ],
        "finding": "Real hands make demos that physics rejects, which is the gap SANT is for. Repair turned 3 of the 10 into "
                   "demos that pass, and those multiplied well. But 3 repaired demos weren't enough to train on: 3/40, one "
                   "arm, not a comparison (the raw arm would have trained on 10 failed replays). For reference only, the "
                   "scripted run above got 17/40 from 10 demos; that suggests the number of distinct repaired demos "
                   "matters, but the runs also differ in source and size, so it doesn't show why.",
        "caveats": ["10 demos, from one person, in one session.",
                    "Replays reproduce live outcomes only 2–4 times in 10 for these demos.",
                    "The rules' two newest ops were written after seeing these same failures."],
        "sources": [cite("webcam_raw"), cite("webcam_repaired"), cite("webcam_policy"), cite("webcam_roots"),
                    {"file": _rel(data, root / "results.json")}, {"file": _rel(data, eval_file)}],
    }


# --- the blind repair A/B -------------------------------------------------------------------------------

def repair_ab(data: Path, read: list[Path]) -> dict:
    runs = []
    for name in AB_RUNS:
        path = data / "human_exp" / name / "ab_summary.json"
        if not path.is_file():
            raise StoreError(f"no {name} summary at {path}")
        runs.append((name, _read(path, read)))
    groups, union = [], {"rules": set(), "nemotron-edits": set()}
    for i, (name, s) in enumerate(runs, start=1):
        rules, edits = s["arms"]["rules"], s["arms"]["nemotron-edits"]
        for side, a in (("rules", rules), ("nemotron-edits", edits)):
            union[side] |= {id for id, st in a["status"].items() if st in REPAIRED}
        tag = f"ab{i}"
        groups.append({
            "label": f"Run {i} ({name}): repaired demos that pass physics, of the same {s['n']}",
            "arms": [arm(f"{tag}_rules", "The rules", rules["pass"], rules["of"], cite(tag), ci=rules["wilson_95"]),
                     arm(f"{tag}_edits", "Nemotron edits", edits["pass"], edits["of"], cite(tag), ci=edits["wilson_95"],
                         highlight=True)],
            "comparisons": [{"a": f"{tag}_rules", "b": f"{tag}_edits", "p": s["mcnemar_p"],
                             "verdict": "not significant (exact McNemar, paired)" if s["mcnemar_p"] >= 0.05
                             else "significant (exact McNemar, paired)", "source": cite(f"{tag}_p")}],
        })
    n = runs[0][1]["n"]
    groups.append({"label": "Demos repaired at least once, over both runs", "comparisons": [], "arms": [
        arm("union_rules", "The rules", len(union["rules"]), n, cite("union")),
        arm("union_edits", "Nemotron edits", len(union["nemotron-edits"]), n, cite("union"), highlight=True)]})
    cost = " and ".join(f"${s['nemotron_cost_usd']:.2f}" for _, s in runs)
    return {
        "id": "repair_ab",
        "title": "Blind repair A/B: Nemotron's edits vs the hand-written rules",
        "question": "On the same 10 failed webcam demos, does Nemotron's trajectory editing repair as many demos to a "
                    "physics pass as the rules? Nemotron is never shown a hand-written fix.",
        "setup": "Pre-registered, run twice. Nemotron reads what the simulator measured and writes edits; code caps each at "
                 "5 cm and checks it's smooth; Isaac Lab replays every plan with the same success check as the rules.",
        "seeds": "The 10 webcam demos of live test #10",
        "test": "Exact two-sided McNemar on the paired outcomes, α = 0.05; Wilson 95% CI per arm.",
        "pending": None,
        "groups": groups,
        "finding": f"Nemotron repaired 5/10, then 2/10, against the rules' 3/10 both times: not significant either time, "
                   f"and its plans change from run to run while the rules' don't. Across the two runs it repaired "
                   f"{len(union['nemotron-edits'])} different demos at least once, the rules {len(union['rules'])}. "
                   f"Nemotron cost {cost} for the two runs.",
        "caveats": ["10 demos; two runs side by side, not one pooled test.",
                    "The rules' two newest ops were written after seeing these same 10 failures; Nemotron saw neither.",
                    "PhysX is not deterministic, so a demo can pass or fail by luck in either arm."],
        "sources": [cite("ab1"), cite("ab2"), cite("union"), cite("ab1_cost"), cite("ab2_cost"),
                    *({"file": _rel(data, data / "human_exp" / name / "ab_summary.json")} for name, _ in runs)],
    }


# --- the mouse demos (tonight) ---------------------------------------------------------------------------

def _note_lines(key: str) -> list[str]:
    return (REPO / NOTES[key]["path"]).read_text(encoding="utf-8").splitlines()


def mouse_table() -> dict:
    """T4's per-demo physics table: the live pass, the replay path error and the live peak force."""
    rows = [re.search(r"\| (\d+(?:\.\d+)?) / (\d+(?:\.\d+)?) mm \| (\d+(?:\.\d+)?) N \|", line)
            for line in _note_lines("mouse")]
    rows = [m for m in rows if m]
    live = re.search(r"\*\*Live:\*\* (\d+)/(\d+) pass", "\n".join(_note_lines("mouse")))
    if not rows or not live:
        raise StoreError(f"the mouse note's physics table is missing from {NOTES['mouse']['path']}")
    means, maxes, peaks = ([float(m.group(i)) for m in rows] for i in (1, 2, 3))
    return {"live": (int(live.group(1)), int(live.group(2))), "mean": (min(means), max(means)), "max": max(maxes),
            "peak": max(peaks)}


def _mouse_failures(data: Path, res: dict, read: list[Path]) -> str:
    """How each policy failed, from the per-seed eval files (descriptive: the test is the Fisher p)."""
    head = res["experiment"]["headline"]
    evals = data / "evals" / res["experiment"]["run_id"]
    reasons = {k: _read(evals / Path(head[k]["file"].replace("\\", "/")).name, read)["summary"]["reasons"]
               for k in ("raw", "multiplied")}
    raw, sant = reasons["raw"], reasons["multiplied"]
    n = head["multiplied"]["n"]
    return (f"How they fail differs: SANT's policy gets the cube into its fingers ({sant.get('dropped', 0)}/{n} episodes "
            f"lose it before the bin; raw: {raw.get('dropped', 0)}) but hits the bin or table above 5 N in "
            f"{sant.get('collision', 0)}/{n} (raw: {raw.get('collision', 0)}).")


def mouse(data: Path, read: list[Path], table: dict) -> dict:
    root = data / "human_exp" / MOUSE
    if not root.is_dir():
        raise StoreError(f"no {MOUSE} experiment in {data / 'human_exp'}")
    n = _read(root / "config.json", read)["n_human"]
    physics = _markers(root / "stages" / "physics", read)
    repair_dir = root / "stages" / "repair"
    repairs = _markers(repair_dir, read) if repair_dir.is_dir() else []
    res_path = root / "results.json"
    res = _read(res_path, read) if res_path.is_file() else None
    head = None
    if res and not res.get("sample") and not res.get("experiment", {}).get("smoke"):
        head = res["experiment"]["headline"]
    src = {"file": _rel(data, res_path)}
    raw = (arm("mouse_raw", "The 10 mouse demos as recorded", head["raw"]["successes"], head["raw"]["n"], src,
               ci=head["raw"]["ci"]) if head else arm("mouse_raw", "The 10 mouse demos as recorded", None, 40, None))
    sant = (arm("mouse_sant", "Repaired + multiplied by SANT", head["multiplied"]["successes"], head["multiplied"]["n"],
                src, ci=head["multiplied"]["ci"], highlight=True)
            if head else arm("mouse_sant", "Repaired + multiplied by SANT", None, 40, None, highlight=True))
    p = head["fisher_p"] if head else None
    verdict = None if p is None else ("significant (Fisher, α = 0.05)" if p < 0.05 else "not significant (Fisher, α = 0.05)")
    lo, hi = table["mean"]
    return {
        "id": "mouse",
        "title": "Tonight's mouse demos: clean live, and raw vs SANT",
        "question": f"The same person recorded {n} demos driving the arm with the mouse, with the soft floor on. Do they hold "
                    "up in physics, and does a policy trained on SANT's output beat one trained on the demos as recorded?",
        "setup": "Live test #11 (2026-10-20), pre-registered before the first demo (amendment 1: input = mouse). ACT, 30k "
                 "steps, batch 8, one training run per arm.",
        "seeds": "5020–5059 (40 unseen scenes) for the policies",
        "test": "Two-sided Fisher exact, α = 0.05, with a Wilson 95% CI per arm.",
        "pending": None,
        "groups": [
            {"label": "Physics check, live and on replay", "comparisons": [], "arms": [
                arm("mouse_live", "Pass live", table["live"][0], table["live"][1], cite("mouse_physics")),
                arm("mouse_replay", "Pass on replay", sum(bool(m["success"]) for m in physics), len(physics),
                    cite("mouse_physics"), detail=f"replay path within {lo:.1f}–{hi:.1f} mm on average (max "
                                                  f"{table['max']:.0f} mm); peak contact {table['peak']:.1f} N"),
                *([arm("mouse_repaired", "Cleaned up by the rules and verified",
                       sum(m.get("status") in REPAIRED for m in repairs), len(repairs), cite("mouse_repair"))]
                  if repairs else [])]},
            {"label": "Policies on 40 unseen scenes (pre-registered)", "arms": [raw, sant],
             "comparisons": [{"a": "mouse_raw", "b": "mouse_sant", "p": p, "verdict": verdict,
                              "source": src if head else cite("mouse_test")}]},
        ],
        "finding": (f"Every mouse demo passed live and on replay, with no hard contact, so here the raw arm is 10 good demos, "
                    f"not 10 failed replays. "
                    + (f"Raw {head['raw']['successes']}/{head['raw']['n']} vs SANT {head['multiplied']['successes']}/"
                       f"{head['multiplied']['n']}, p = {p:.2f}: "
                       + ("significant." if head["significant"] else
                          "not significant, so this does not show SANT's data trains a better policy. ")
                       + _mouse_failures(data, res, read) if head else PENDING_MOUSE)),
        "caveats": ["10 demos, from one person, in one session.",
                    "The soft floor was on for every demo (9 of 10 had it hold the target up); they are labelled, not filtered.",
                    "One training run per arm.",
                    *(["Whether the soft floor taught SANT's policy to push down is open: T6 is looking into it."]
                      if head else [])],
        "sources": [cite("mouse_physics"), cite("mouse_table"), cite("mouse_test"), cite("mouse_amendment"),
                    *([cite("mouse_result"), cite("mouse_training"), cite("mouse_drops"), cite("mouse_collisions"),
                       cite("mouse_soft_floor")] if head else []),
                    {"file": _rel(data, root / "stages" / "physics")}, src],
    }


# --- the file ------------------------------------------------------------------------------------------

def build(data: Path) -> dict:
    data = Path(data)
    read: list[Path] = []
    table = mouse_table()
    experiments = [webcam(data, read), repair_ab(data, read), mouse(data, read, table)]
    newest = max((p.stat().st_mtime for p in read), default=0)
    lo, hi = table["mean"]
    facts = {
        "webcam_pressed": {"text": "9/10", "source": cite("webcam_pressed")},
        "webcam_peak_n": {"text": "927 N", "source": cite("webcam_pressed")},
        "mouse_path_mean_mm": {"text": f"{lo:.1f}–{hi:.1f} mm", "source": cite("mouse_table")},
        "mouse_path_max_mm": {"text": f"{table['max']:.1f} mm", "source": cite("mouse_table")},
        "mouse_peak_n": {"text": f"{table['peak']:.1f} N", "source": cite("mouse_table")},
    }
    return {"as_of": datetime.fromtimestamp(newest).strftime("%Y-%m-%d %H:%M"),
            "generated_by": "scripts/build_site_results.py", "notes": NOTES, "facts": facts, "experiments": experiments}


def _text(out: dict) -> str:
    return json.dumps(out, ensure_ascii=False, indent=2) + "\n"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--data-dir", type=Path, default=Path(os.environ["DATA_DIR"]) if os.environ.get("DATA_DIR") else REPO / "data")
    p.add_argument("--out", type=Path, default=OUT)
    p.add_argument("--check", action="store_true", help="exit 1 if --out is out of date; write nothing")
    p.add_argument("--watch", type=float, default=0, help="rebuild every N s until the mouse result is in")
    args = p.parse_args(argv)
    while True:
        try:
            text = _text(build(args.data_dir))
        except StoreError as e:
            print(f"REFUSED: {e}")
            return 1
        old = args.out.read_text(encoding="utf-8") if args.out.is_file() else None
        if args.check:
            print("up to date" if old == text else f"{args.out} is out of date: run without --check")
            return 0 if old == text else 1
        if old != text:
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(text, encoding="utf-8", newline="\n")  # LF, as git stores it
            print(f"wrote {args.out}")
        mouse_in = next(a for e in json.loads(text)["experiments"] if e["id"] == "mouse"
                        for g in e["groups"] for a in g["arms"] if a["key"] == "mouse_sant")["k"] is not None
        if not args.watch or mouse_in:
            return 0
        time.sleep(args.watch)


if __name__ == "__main__":
    sys.exit(main())
