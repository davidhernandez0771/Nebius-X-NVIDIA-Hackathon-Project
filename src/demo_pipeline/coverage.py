"""The coverage report (workflow step 6): how well an experiment's verified data covers a task's scene set (the
Record page's ScenePlans, e.g. S1-S8) and the eval distribution, and what to record next. Pure; it only reads.

- **Scenes.** scene_set() turns library entries into the facts the report needs: the goal cube's place, yaw and
  size, the goal bin's place, yaw and walls, extra objects, and whether the scene lies inside the eval sampler's
  distribution (multiply.SCENE_RANGES, a 5 cm cube, an unrotated BIN_INNER bin, nothing else; "outside" says why
  not). Entries with the same plan (Standard and S1) are one scene, the protocol's, with the other as an alias.
- **Demos.** assign_scene(): a human take goes to its scene_plan ref's scene; a take recorded before the picker (no
  ref) to the scene with today's bodies whose cube and bin are where its Scene has them; else None ("unassigned").
  Derived demos (repaired, variants) belong to their human root's scene.
- **Per scene:** takes; raw-verified (the take's own replay); repaired-verified (a repaired demo of it verified,
  the "_home" copies aside); verified takes (either); variants made and verified; the grasp (grasp_retime's stats:
  frames in the last 3 cm, close speed, swoops) of the takes and of the verified episodes; and the spread of the
  verified episodes' cube and bin places and cube yaw (wrapped to the nearest face, as the gripper sees it).
- **The pool** is what training can use: per human root its verified repaired demo (or its verified raw take), plus
  every verified variant.
- **The eval distribution:** the eval's scenes for seeds eval_seed0 .. eval_seed0 + eval_n - 1 (as
  sim_eval.scenes.eval_scenes makes them). Per axis (cube x, y, face yaw; bin x, y), bins over the sampler's range,
  with the eval scenes and the pool's episodes in each (a gap: eval scenes, no episode; thin: at least
  THIN_MIN_EVAL eval scenes, and the bin's share of the pool under THIN_SHARE of its share of the eval); and per eval scene, the
  nearest pool episode, covered if it is within NEAR (cube 5 cm, bin 8 cm, face yaw 15 degrees).
- **Requests**, from those numbers by rules, most useful first: takes still missing per scene (eval-distribution
  scenes before generalization ones), swoop grasps, axis gaps and thin bins, uncovered eval scenes, low variant yield.
  phrase_requests() can have Nemotron reword them; a rewording is kept only if every number in it is one of the
  rule's (so a fact), else the rule's own text stays.
"""

from __future__ import annotations

import json
import math
import re
from statistics import median
from typing import Callable, Iterable

import numpy as np

from .grasp_retime import grasp_stats, is_swoop
from .multiply import SCENE_RANGES, _yaw, nearest_face_yaw, sample_scene
from .scene_geometry import BIN_INNER, CUBE_SIZE
from .schemas import Demo, Scene
from .store import DemoStore

ROBOT = "franka"
TAKES_PER_SCENE = 2  # the research note's protocol: 12 scenes x 2 takes
NEAR = {"cube_m": 0.05, "bin_m": 0.08, "cube_face_yaw_deg": 15.0}
MATCH_M, MATCH_DEG = 0.01, 2.0  # a take without a scene ref matches a scene this close
AXIS_BINS = {"cube_x": 4, "cube_y": 4, "cube_face_yaw": 6, "bin_x": 5, "bin_y": 6}
AXIS_LABEL = {"cube_x": ("cube x", "m"), "cube_y": ("cube y", "m"), "cube_face_yaw": ("cube yaw (to its nearest face)", "deg"),
              "bin_x": ("bin x", "m"), "bin_y": ("bin y", "m")}
LOW_YIELD, MIN_VARIANTS = 0.5, 3  # a root whose variants verify less than half the time (of at least 3)
SWOOP_SHARE = 0.5
THIN_SHARE, THIN_MIN_EVAL = 0.25, 5  # a bin with >= 5 eval scenes whose share of the pool is under 1/4 of its eval share


# --- scenes -------------------------------------------------------------------------------------

def _goal_parts(plan):
    goal = plan.goals[0]
    return plan.object(goal.object), plan.object(goal.bin)


def scene_set(entries: Iterable) -> list[dict]:
    """The scenes as facts (see the module docstring), protocol order kept, same-plan entries merged."""
    ranges = SCENE_RANGES[ROBOT]
    out: dict[str, dict] = {}
    for e in entries:
        if e.hash in out:
            continue
        cube, box = _goal_parts(e.plan)
        outside = []
        if abs(cube.size - CUBE_SIZE) > 1e-9:
            outside.append(f"{cube.size * 100:g} cm cube")
        if cube.on is not None or cube.pose is None:
            outside.append("a stacked cube")
        else:
            for name, v, (lo, hi) in (("cube x", cube.pose.x, ranges.cube_x), ("cube y", cube.pose.y, ranges.cube_y)):
                if not lo - 1e-9 <= v <= hi + 1e-9:
                    outside.append(f"{name} {v:g} (eval {lo:g} to {hi:g})")
        for name, v, (lo, hi) in (("bin x", box.pose.x, ranges.bin_x), ("bin y", box.pose.y, ranges.bin_y)):
            if not lo - 1e-9 <= v <= hi + 1e-9:
                outside.append(f"{name} {v:g} (eval {lo:g} to {hi:g})")
        if abs(box.pose.yaw_deg) > 1e-6:
            outside.append(f"bin turned {box.pose.yaw_deg:g} degrees")
        if tuple(box.inner) != tuple(BIN_INNER):
            outside.append(f"bin walls {box.inner[2] * 100:g} cm (eval {BIN_INNER[2] * 100:g} cm)")
        extra = len(e.plan.objects) - 2
        if extra:
            outside.append(f"{extra} more object{'s' if extra > 1 else ''}")
        fact = {"id": e.id, "name": e.name, "aliases": [], "hash": e.hash, "needs_settle": e.needs_settle,
                "cube": None if cube.pose is None else {"x": cube.pose.x, "y": cube.pose.y, "yaw_deg": cube.pose.yaw_deg},
                "cube_size_m": cube.size, "bin": {"x": box.pose.x, "y": box.pose.y, "yaw_deg": box.pose.yaw_deg},
                "bin_walls_m": box.inner[2], "objects": len(e.plan.objects), "outside": outside,
                "in_eval": not outside}
        out[e.hash] = fact
    # the protocol's id for a plan the built-in Standard shares (S1)
    merged: dict[str, dict] = {}
    for e in entries:
        f = out[e.hash]
        if e.id != f["id"]:
            if e.source == "protocol" and f["id"] == "standard":
                f["aliases"].append("standard")
                f["id"], f["name"] = e.id, e.name
            else:
                f["aliases"].append(e.id)
    for f in out.values():
        merged[f["id"]] = f
    order = [e.id for e in entries if e.id in merged]
    return [merged[i] for i in sorted(merged, key=lambda i: order.index(i))]


def _deg(q) -> float:
    return math.degrees(_yaw(q))


def assign_scene(demo: Demo, scenes: list[dict]) -> str | None:
    """The scene id a human take was recorded in (see the module docstring), or None."""
    if demo.scene_plan is not None:
        for s in scenes:
            if demo.scene_plan.id == s["id"] or demo.scene_plan.id in s["aliases"] or demo.scene_plan.hash == s["hash"]:
                return s["id"]
        return None
    sc = demo.scene
    for s in scenes:
        if s["needs_settle"] or s["cube"] is None:  # before the picker there were only today's bodies
            continue
        if (math.dist(sc.cube_pose.pos[:2], (s["cube"]["x"], s["cube"]["y"])) <= MATCH_M
                and math.dist(sc.bin_pose.pos[:2], (s["bin"]["x"], s["bin"]["y"])) <= MATCH_M
                and abs(_deg(sc.cube_pose.quat_wxyz) - s["cube"]["yaw_deg"]) <= MATCH_DEG
                and abs(_deg(sc.bin_pose.quat_wxyz) - s["bin"]["yaw_deg"]) <= MATCH_DEG):
            return s["id"]
    return None


# --- the store ----------------------------------------------------------------------------------

def _ok(store: DemoStore, id: str) -> bool:
    pp = store.get_passport(id)
    return bool(pp is not None and pp.verification.success)


def _point(scene: Scene) -> dict:
    return {"cube_x": scene.cube_pose.pos[0], "cube_y": scene.cube_pose.pos[1],
            "cube_face_yaw": math.degrees(nearest_face_yaw(_yaw(scene.cube_pose.quat_wxyz))),
            "bin_x": scene.bin_pose.pos[0], "bin_y": scene.bin_pose.pos[1]}


def _grasp(trajs: list) -> dict:
    stats = [s for s in (grasp_stats(t) for t in trajs) if s is not None]
    if not stats:
        return {"n": 0}
    return {"n": len(stats), "swoops": sum(is_swoop(s) for s in stats),
            "frames_in_3cm_median": median(s.frames_near for s in stats),
            "close_speed_median_m_s": round(median(s.close_speed for s in stats), 4)}


def _spread(points: list[dict]) -> dict:
    if not points:
        return {}
    return {k: [round(min(p[k] for p in points), 3), round(max(p[k] for p in points), 3)] for k in AXIS_BINS}


def eval_scene_list(n: int, seed0: int) -> list[Scene]:
    """As sim_eval.scenes.eval_scenes (a test pins them equal)."""
    return [sample_scene(np.random.default_rng(seed), ROBOT, seed) for seed in range(seed0, seed0 + n)]


def _axis_edges() -> dict[str, np.ndarray]:
    r = SCENE_RANGES[ROBOT]
    span = {"cube_x": r.cube_x, "cube_y": r.cube_y, "cube_face_yaw": (-45.0, 45.0), "bin_x": r.bin_x, "bin_y": r.bin_y}
    return {k: np.linspace(*span[k], AXIS_BINS[k] + 1) for k in AXIS_BINS}


def _bin_of(edges: np.ndarray, v: float) -> int:
    return int(np.clip(np.searchsorted(edges, v, side="right") - 1, 0, len(edges) - 2))


def coverage_report(store: DemoStore, entries: Iterable, *, eval_n: int = 40, eval_seed0: int = 5020,
                    takes_per_scene: int = TAKES_PER_SCENE) -> dict:
    """The report (see the module docstring) as a JSON-able dict."""
    entries = list(entries)
    scenes = scene_set(entries)
    demos = {d.id: d for d in store.list_demos()}
    humans = sorted(i for i, d in demos.items() if d.source == "human")
    root_of = {i: store.lineage(i)[0] for i in demos}
    scene_of = {h: assign_scene(demos[h], scenes) for h in humans}

    pool: list[dict] = []
    per_root: dict[str, dict] = {}
    for h in humans:
        derived = [i for i in demos if root_of[i] == h and i != h]
        repaired = [i for i in derived if demos[i].source == "repaired" and i != f"{h}_home"]
        variants = [i for i in derived if demos[i].source == "variant"]
        rep_ok = [i for i in repaired if _ok(store, i)]
        raw_ok = _ok(store, h)
        var_ok = [i for i in variants if _ok(store, i)]
        best = rep_ok[0] if rep_ok else (h if raw_ok else None)
        per_root[h] = {"raw": raw_ok, "repaired": bool(rep_ok), "variants": len(variants), "variants_ok": len(var_ok),
                       "episodes": ([best] if best else []) + var_ok}
        for i in per_root[h]["episodes"]:
            pool.append({"id": i, "root": h, "scene": scene_of[h], **_point(demos[i].scene)})

    rows = {}
    for s in scenes:
        roots = [h for h in humans if scene_of[h] == s["id"]]
        eps = [i for h in roots for i in per_root[h]["episodes"]]
        rows[s["id"]] = {
            "name": s["name"], "in_eval": s["in_eval"], "outside": s["outside"], "takes": len(roots),
            "raw_verified": sum(per_root[h]["raw"] for h in roots),
            "repaired_verified": sum(per_root[h]["repaired"] for h in roots),
            "verified_takes": sum(per_root[h]["raw"] or per_root[h]["repaired"] for h in roots),
            "variants": sum(per_root[h]["variants"] for h in roots),
            "variants_verified": sum(per_root[h]["variants_ok"] for h in roots),
            "grasp": {"takes": _grasp([demos[h].trajectory for h in roots]),
                      "verified_episodes": _grasp([demos[i].trajectory for i in eps])},
            "spread": _spread([p for p in pool if p["scene"] == s["id"]]),
        }

    ev = eval_scene_list(eval_n, eval_seed0)
    ev_points = [{"seed": sc.seed, **_point(sc)} for sc in ev]
    edges = _axis_edges()
    axes = {}
    for k, e in edges.items():
        ec = [0] * (len(e) - 1)
        pc = [0] * (len(e) - 1)
        for p in ev_points:
            ec[_bin_of(e, p[k])] += 1
        for p in pool:
            pc[_bin_of(e, p[k])] += 1
        axes[k] = [{"lo": round(float(e[j]), 3), "hi": round(float(e[j + 1]), 3), "eval": ec[j], "pool": pc[j],
                    "gap": ec[j] > 0 and pc[j] == 0,
                    "thin": pc[j] > 0 and ec[j] >= THIN_MIN_EVAL and pool != [] and
                    pc[j] / len(pool) < THIN_SHARE * ec[j] / len(ev_points)} for j in range(len(ec))]
    covered, uncovered, dists = 0, [], []
    for p in ev_points:
        best, best_d = None, math.inf
        for q in pool:
            dc = math.dist((p["cube_x"], p["cube_y"]), (q["cube_x"], q["cube_y"]))
            db = math.dist((p["bin_x"], p["bin_y"]), (q["bin_x"], q["bin_y"]))
            dy = abs((p["cube_face_yaw"] - q["cube_face_yaw"] + 45) % 90 - 45)
            d = math.hypot(dc / NEAR["cube_m"], db / NEAR["bin_m"], dy / NEAR["cube_face_yaw_deg"])
            if d < best_d:
                best, best_d = (dc, db, dy), d
        ok = best is not None and best[0] <= NEAR["cube_m"] and best[1] <= NEAR["bin_m"] and \
            best[2] <= NEAR["cube_face_yaw_deg"]
        covered += ok
        if not ok:
            uncovered.append(p["seed"])
        if best is not None:
            dists.append(best_d)
    report = {
        "takes_per_scene": takes_per_scene,
        "scenes": rows,
        "unassigned": [h for h in humans if scene_of[h] is None],
        "pool": {"n": len(pool), "episodes": [p["id"] for p in pool]},
        "eval": {"n": eval_n, "seeds": [eval_seed0, eval_seed0 + eval_n - 1], "axes": axes,
                 "nearest": {"tolerance": NEAR, "covered": covered, "uncovered_seeds": uncovered,
                             "median_scaled_distance": round(median(dists), 2) if dists else None}},
        "sources": {h: {"scene": scene_of[h], **{k: v for k, v in per_root[h].items() if k != "episodes"}}
                    for h in humans},
    }
    report["requests"] = requests(report, scenes)
    return report


# --- requests -------------------------------------------------------------------------------------

def _s(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def requests(report: dict, scenes: list[dict]) -> list[dict]:
    """The report's requests by rule, most useful first (see the module docstring)."""
    target = report["takes_per_scene"]
    out: list[dict] = []
    record = []
    for s in scenes:
        r = report["scenes"][s["id"]]
        missing = target - r["verified_takes"]
        if missing <= 0:
            continue
        text = (f"Record {_s(missing, 'more take')} in {s['name']}: {r['verified_takes']} verified of "
                f"{r['takes']} recorded.")
        if not s["in_eval"]:
            text += f" Generalization only, not in the eval distribution ({'; '.join(s['outside'])})."
        record.append({"kind": "record", "scene": s["id"], "scene_name": s["name"], "in_eval": s["in_eval"],
                       "text": text})
    out += sorted(record, key=lambda r: not r["in_eval"])

    for s in scenes:
        r = report["scenes"][s["id"]]
        g, v = r["grasp"]["takes"], r["grasp"]["verified_episodes"]
        if g["n"] and g["swoops"] / g["n"] >= SWOOP_SHARE and (not v["n"] or v["swoops"] / v["n"] >= SWOOP_SHARE):
            out.append({"kind": "swoop", "scene": s["id"], "scene_name": s["name"], "text": (
                f"In {s['name']}, {g['swoops']} of {_s(g['n'], 'take')} {'closes' if g['swoops'] == 1 else 'close'} "
                f"while still moving (median "
                f"{g['close_speed_median_m_s']:.2f} m/s, {g['frames_in_3cm_median']:g} frames in the last 3 cm; the "
                f"scripted grasp stops and spends 16): retake with a stop before closing, or repair with "
                f"--grasp-retime.")})

    n_eval = report["eval"]["n"]
    for k, rows in report["eval"]["axes"].items():
        label, unit = AXIS_LABEL[k]
        for row in rows:
            if row["gap"]:
                near = [s["name"] for s in scenes if s["in_eval"] and s["cube"] is not None and
                        row["lo"] <= _scene_value(s, k) <= row["hi"]]
                hint = f"record in {near[0]}" if near else "record a take there or add variants"
                out.append({"kind": "eval_gap", "axis": k, "text": (
                    f"No verified episode has the {label} between {row['lo']:g} and {row['hi']:g} {unit}, where "
                    f"{row['eval']} of {n_eval} eval scenes put it: {hint}.")})
            elif row["thin"]:
                out.append({"kind": "eval_thin", "axis": k, "text": (
                    f"Only {row['pool']} of {report['pool']['n']} verified episodes have the {label} between "
                    f"{row['lo']:g} and {row['hi']:g} {unit}, where {row['eval']} of {n_eval} eval scenes put it: "
                    f"add variants or takes there.")})
    near = report["eval"]["nearest"]
    if near["uncovered_seeds"]:
        u = near["uncovered_seeds"]
        out.append({"kind": "eval_uncovered", "text": (
            f"{len(u)} of {n_eval} eval scenes have no verified episode within {NEAR['cube_m'] * 100:g} cm (cube), "
            f"{NEAR['bin_m'] * 100:g} cm (bin) and {NEAR['cube_face_yaw_deg']:g} degrees (cube yaw): seeds "
            f"{', '.join(map(str, u[:12]))}{f' and {len(u) - 12} more' if len(u) > 12 else ''}.")})
    for h, src in report["sources"].items():
        if src["variants"] >= MIN_VARIANTS and src["variants_ok"] / src["variants"] < LOW_YIELD:
            out.append({"kind": "variant_yield", "source": h, "text": (
                f"{h}: {src['variants_ok']} of {src['variants']} variants verified; look at why before adding "
                f"more from it.")})
    return out


def _scene_value(s: dict, k: str) -> float:
    return {"cube_x": s["cube"]["x"], "cube_y": s["cube"]["y"],
            "cube_face_yaw": math.degrees(nearest_face_yaw(math.radians(s["cube"]["yaw_deg"]))),
            "bin_x": s["bin"]["x"], "bin_y": s["bin"]["y"]}[k]


# --- Nemotron's wording, checked against the facts -----------------------------------------------------

_NUM = re.compile(r"(?<![\w.])-?\d+(?:\.\d+)?(?![\w])|(?<=-)\d+(?:\.\d+)?(?![\w])")
PHRASE_SYSTEM = """You rewrite data-collection requests for the person recording robot demonstrations at the Record
page, in your own words: start with what to do, then why, in plain words, without parentheses. Keep each request's
scene name and its numbers as they are; you may leave out a detail, but never add a number, a scene or advice that
isn't in it. One or two short sentences each.
Reply with ONE JSON object only: {"requests": ["...", ...]}, one per request, in the same order."""


def numbers(text: str) -> set[float]:
    """The numbers in a text, as floats (a digit inside a name, like S4, is not one; 5020-5059 is two)."""
    return {float(m) for m in _NUM.findall(text)}


def _check(rule: str, new, scene_name: str | None = None) -> str | None:
    """Why a rewording can't stand in for the rule's text, or None: every number in it must be one of the rule's
    (a fact), the rule's first number (what to do: "2 more takes", "7 of 10", "22 of 40") must still be there, and
    so must the scene's name, word for word."""
    if not isinstance(new, str) or not new.strip():
        return "not text"
    if scene_name and scene_name not in new:
        return f"changed or left out the scene name {scene_name!r}"
    if len(new) > 400:
        return "too long"
    extra = numbers(new) - numbers(rule)
    if extra:
        return f"numbers not in the facts: {sorted(extra)}"
    first = _NUM.findall(rule)
    if first and float(first[0]) not in numbers(new):
        return f"left out the request's count {first[0]}"
    return None


def _json(text: str) -> dict | None:
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def phrase_requests(reqs: list[dict], *, chat_fn: Callable | None, tier: str = "super") -> dict:
    """{"texts": one per request, "provenance": ...}: Nemotron's rewording where every number in it is one of the
    rule's, else the rule's text. chat_fn=None, an error or a reply that isn't the right JSON: all the rules' texts."""
    rules = [r["text"] for r in reqs]
    prov: dict = {"model": None, "tier": tier, "kept": [False] * len(rules), "rejected": [], "error": None,
                  "cost_usd": 0.0}
    if chat_fn is None or not rules:
        return {"texts": rules, "provenance": {**prov, "error": None if rules else "no requests"}}
    prompt = "Requests (JSON):\n" + json.dumps(rules, indent=1)
    try:
        reply = chat_fn(prompt, tier=tier, system=PHRASE_SYSTEM, max_tokens=2000, temperature=0.0, think=False)
    except Exception as e:  # an API or auth error: the rules' words
        return {"texts": rules, "provenance": {**prov, "error": f"{type(e).__name__}: {e}"}}
    prov["model"] = getattr(reply, "model", None)
    prov["cost_usd"] = float(getattr(reply, "est_cost_usd", 0.0) or 0.0)
    got = (_json(reply.text) or {}).get("requests")
    if not isinstance(got, list) or len(got) != len(rules):
        return {"texts": rules, "provenance": {**prov, "error": "the reply was not one JSON list of the same length"}}
    texts = []
    for i, (rule, new) in enumerate(zip(rules, got)):
        reason = _check(rule, new, reqs[i].get("scene_name"))
        if reason is None:
            texts.append(new.strip())
            prov["kept"][i] = True
        else:
            prov["rejected"].append({"i": i, "text": new, "reason": reason})
            texts.append(rule)
    return {"texts": texts, "provenance": prov}


# --- the table ---------------------------------------------------------------------------------------

def render_markdown(report: dict, texts: list[str] | None = None) -> str:
    """The readable report: the scene table, the eval coverage, and the requests (Nemotron's wording if given)."""
    lines = ["| scene | in eval | takes | raw verified | repaired verified | verified takes | variants verified | "
             "swoops (takes) | frames in last 3 cm (takes -> verified) |", "|" + "---|" * 9]
    for sid, r in report["scenes"].items():
        g, v = r["grasp"]["takes"], r["grasp"]["verified_episodes"]
        frames = f"{g.get('frames_in_3cm_median', '-')} -> {v.get('frames_in_3cm_median', '-')}" if g["n"] else "-"
        lines.append(f"| {r['name']} | {'yes' if r['in_eval'] else 'no'} | {r['takes']} | {r['raw_verified']} | "
                     f"{r['repaired_verified']} | {r['verified_takes']} | {r['variants_verified']} / {r['variants']} | "
                     f"{g.get('swoops', 0)} / {g['n']} | {frames} |")
    ev = report["eval"]
    lines += ["", f"**Eval distribution** (seeds {ev['seeds'][0]}-{ev['seeds'][1]}, {ev['n']} scenes; pool "
              f"{report['pool']['n']} verified episodes): {ev['nearest']['covered']} of {ev['n']} eval scenes have a "
              f"verified episode within {NEAR['cube_m'] * 100:g} cm (cube), {NEAR['bin_m'] * 100:g} cm (bin) and "
              f"{NEAR['cube_face_yaw_deg']:g} degrees (cube yaw).", "",
              "| axis | bins: eval scenes / verified episodes |", "|---|---|"]
    for k, rows in ev["axes"].items():
        label, unit = AXIS_LABEL[k]
        cells = ", ".join(f"{r['lo']:g}..{r['hi']:g}: {r['eval']}/{r['pool']}"
                          f"{' GAP' if r['gap'] else ' thin' if r['thin'] else ''}" for r in rows)
        lines.append(f"| {label} ({unit}) | {cells} |")
    if report["unassigned"]:
        lines += ["", f"Takes in no scene of the set: {', '.join(report['unassigned'])}."]
    lines += ["", "**Requests**", ""]
    texts = texts or [r["text"] for r in report["requests"]]
    lines += [f"{i}. {t}" for i, t in enumerate(texts, 1)] or ["None: the data covers the scene set."]
    return "\n".join(lines) + "\n"
