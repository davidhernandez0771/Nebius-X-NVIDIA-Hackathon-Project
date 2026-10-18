"""Export the Review example's Nemotron verdict from the pre-registered labeler/judge test (real model replies).

The Review page's recorded example is s1_0002 (raw) -> s1_0002_rules (perfected). The 2026-10-18 test
(docs/superpowers/notes/2026-10-18-nemotron-judge.md on pm/nemotron-judge) labelled s1_0002's recording
and judged one copy multiplied from s1_0002_rules (clip s1_0002_rules_mx_102000 = store demo
s1_0002_rules_m102000). s1_0002_rules itself was not judged, so the match is the copy's, and the file
says which copy.

The card is composed by the rules of docs/design/nemotron-judge.md (review_verdict() on pm/nemotron-judge,
mirrored in compose() below until that branch merges): physics from the copy's passport, the model's label
and match verbatim, its confidence left out.

    git show 47cc4cd:docs/superpowers/notes/2026-10-18-nemotron-judge/outcomes.jsonl > <tmp>/outcomes.jsonl
    uv run python scripts/export_review_verdict.py --outcomes <tmp>/outcomes.jsonl \\
        --outcomes-ref "pm/nemotron-judge@47cc4cd:docs/superpowers/notes/2026-10-18-nemotron-judge/outcomes.jsonl" \\
        --store C:\\dev\\pm-t4\\data\\demos --episodes C:\\dev\\pm-t2\\data\\episodes \\
        --label s1_0002_raw --judge "match:s1_0002_raw|s1_0002_rules_mx_102000" \\
        --human s1_0002 --copy s1_0002_rules_m102000 --out web/src/site/review/example/verdict.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

CHECKS = ("same_object", "same_goal", "same_order", "copy_completes")


def compose(verification: dict, label: dict | None, verdict: dict | None, *,
            label_error: str | None = None, verdict_error: str | None = None) -> dict:
    """The ReviewVerdict card, by the rules of docs/design/nemotron-judge.md (same as review_verdict())."""
    success = bool(verification["success"])
    physics = {"status": "verified" if success else "failed", "reasons": list(verification.get("reasons", []))}
    if label is not None:
        card_label = {"status": "ok", "task": label["task"], "object": label["object"],
                      "destination": label["destination"], "steps": label["steps"], "error": None}
    else:
        card_label = {"status": "unavailable", "task": None, "object": None, "destination": None, "steps": [],
                      "error": label_error or "no label"}

    conflict = None
    if verdict is not None and bool(verdict["copy_completes"]) != success:
        conflict = (f"Nemotron says the copy {'completes' if verdict['copy_completes'] else 'does not complete'} the task, "
                    f"but the physics check {'passed' if success else 'failed'}; physics decides.")
    if verdict is None:
        match = {"status": "unavailable" if verdict_error else "not_checked", "checks": None, "reason": verdict_error}
    elif not success:
        match = {"status": "not_checked", "checks": None, "reason": "The physics check failed, so this copy is not kept."}
    else:
        match = {"status": verdict["matches"], "checks": {k: bool(verdict[k]) for k in CHECKS}, "reason": verdict["reason"]}
    return {"physics": physics, "label": card_label, "match": match, "conflict": conflict}


def _outcome(outcomes: dict, set_: str, id: str) -> dict:
    try:
        return outcomes[(set_, id)]
    except KeyError:
        raise SystemExit(f"no {set_} item {id!r} in the outcomes file") from None


def _clip_matches_demo(episodes: Path, clip: str, store: Path, demo: str) -> bool:
    """True when the eval clip's recorded trajectory is the store demo's, step for step."""
    clip_traj = json.loads((episodes / clip / "trajectory.json").read_text(encoding="utf-8"))
    clip_traj = clip_traj.get("trajectory", clip_traj)
    demo_traj = json.loads((store / demo / "demo.json").read_text(encoding="utf-8"))["trajectory"]
    return all(clip_traj[k] == demo_traj[k] for k in ("t", "ee_pos", "gripper"))


def export(outcomes_path: Path, outcomes_ref: str, store: Path, episodes: Path | None,
           label_id: str, judge_id: str, human: str, copy: str) -> dict:
    text = outcomes_path.read_bytes()
    outcomes = {(r["set"], r["id"]): r for r in map(json.loads, text.decode("utf-8").splitlines()) if r}
    lab, jud = _outcome(outcomes, "label", label_id), _outcome(outcomes, "judge", judge_id)
    raw_clip, copy_clip = judge_id.split(":", 1)[1].split("|")
    if raw_clip != label_id:
        raise SystemExit(f"the judge item compares {raw_clip!r}, not the labelled {label_id!r}")
    passport = json.loads((store / copy / "passport.json").read_text(encoding="utf-8"))
    if passport["lineage"][0] != human:
        raise SystemExit(f"{copy!r} descends from {passport['lineage'][0]!r}, not {human!r}")

    provenance = {
        "outcomes": outcomes_ref,
        "outcomes_sha256": hashlib.sha256(text).hexdigest(),
        "label_item": label_id,
        "judge_item": judge_id,
        "model_error": {"label": lab.get("model_error"), "judge": jud.get("model_error")},
        "human_demo": human,
        "copy_demo": copy,
        "copy_lineage": passport["lineage"],
        "physics": f"{copy}/passport.json verification",
    }
    if episodes is not None:
        provenance["trajectories_match"] = {
            f"{raw_clip}={human}": _clip_matches_demo(episodes, raw_clip, store, human),
            f"{copy_clip}={copy}": _clip_matches_demo(episodes, copy_clip, store, copy),
        }
        if not all(provenance["trajectories_match"].values()):
            raise SystemExit(f"an eval clip is not the store demo it is mapped to: {provenance['trajectories_match']}")

    return {
        "about": ("Real Nemotron 3.5 Super VL replies from the pre-registered 2026-10-18 labeler/judge test, "
                  "composed into a ReviewVerdict. Not a fixture. The label is of the human demo; the match is "
                  "for copy_id, a copy multiplied from the perfected demo."),
        "copy_id": copy,
        "verdict": compose(passport["verification"], lab.get("model"), jud.get("model"),
                           label_error=lab.get("model_error"), verdict_error=jud.get("model_error")),
        "provenance": provenance,
    }


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--outcomes", type=Path, required=True)
    p.add_argument("--outcomes-ref", required=True, help="where the outcomes file is committed (branch@commit:path)")
    p.add_argument("--store", type=Path, required=True, help="the demo store's demos/ folder")
    p.add_argument("--episodes", type=Path, help="the eval clips' folder, to check each clip is its store demo")
    p.add_argument("--label", required=True)
    p.add_argument("--judge", required=True)
    p.add_argument("--human", required=True)
    p.add_argument("--copy", required=True)
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args(argv)
    out = export(a.outcomes, a.outcomes_ref, a.store, a.episodes, a.label, a.judge, a.human, a.copy)
    a.out.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {a.out}: label {out['verdict']['label']['status']}, match {out['verdict']['match']['status']}")


if __name__ == "__main__":
    main()
