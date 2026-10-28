"""A demo split into steps, from the gripper command and the objects' signals, so it reads like
"grasp red 1.0 s -> missed -> regrasp red 2.6 s -> place left bin 4.7 s".

Step kinds (per step, then merged into segments):
  reach    the gripper is open and nothing was just let go (before the first close, and between pick-places);
  grasp    closed on an object that is not yet lifted (robota.LIFT_M) and not over a container;
  regrasp  the same, for an object that was touched, missed or dropped before;
  carry    closed, holding a lifted object that is not over a container;
  place    closed, holding an object over a container's inner footprint;
  missed   closed on nothing (a close beside the object: the nearest one is named), or the object slipped out
           before it was lifted;
  drop     the lifted object fell out of the closed gripper off any container (the rest of that close);
  release  open after letting an object go: RELEASE_S, then reach if another close follows, else to the end.

On one cube and one bin with a single clean grasp the labels are exactly robota.phases' (tested); the footprint
test is robota.in_bin_footprint with each container's own size, and "lifted" is robota.LIFT_M above where the
object started. A demo's labels come from SceneSignals (demo_pipeline.goals).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import robota
from .goals import SceneSignals, object_series

RELEASE_S = 0.5  # s of "release" after an opening, before the next reach


@dataclass(frozen=True)
class Label:
    kind: str
    obj: str | None = None
    container: str | None = None


@dataclass(frozen=True)
class Segment:
    kind: str
    start: float  # s, the segment's first step
    end: float  # s, the next segment's first step (the last step for the last one)
    obj: str | None = None
    container: str | None = None


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """[start, stop) of each run of True."""
    edges = np.diff(np.concatenate([[0], mask.astype(np.int8), [0]]))
    return list(zip(np.flatnonzero(edges == 1).tolist(), np.flatnonzero(edges == -1).tolist()))


def step_labels(sig: SceneSignals) -> list[Label]:
    n = len(sig.t)
    closed = np.asarray(sig.gripper).astype(bool)
    series = {o: object_series(sig, o) for o in sig.objects}
    containers = list(sig.containers.values())

    def over(obj: str, i: int) -> str | None:
        xy = series[obj].pos[i, :2]
        for c in containers:
            if robota.in_bin_footprint(xy, c.pose.pos, c.pose.quat_wxyz, inner_xy=c.inner[:2]):
                return c.id
        return None

    labels: list[Label | None] = [None] * n
    touched: set[str] = set()
    failed: set[str] = set()
    released: dict[int, Label] = {}  # closed span's stop -> what the opening let go of
    spans = _runs(closed)
    for a, b in spans:
        contacted = {o: np.flatnonzero(s.held[a:b]) for o, s in series.items()}
        contacted = {o: idx[0] + a for o, idx in contacted.items() if idx.size}
        if not contacted:
            # Closed on nothing: name the object the hand was nearest to when it closed.
            near = min(series, key=lambda o: np.linalg.norm(series[o].pos[a] - sig.ee_pos[a])) if series else None
            labels[a:b] = [Label("missed", near)] * (b - a)
            if near:
                failed.add(near)
            continue
        obj = min(contacted, key=contacted.get)
        first, s = contacted[obj], series[obj]
        kind = "regrasp" if obj in touched or obj in failed else "grasp"
        touched.add(obj)
        lost: Label | None = None
        for i in range(a, b):
            if lost is not None:
                labels[i] = lost
                continue
            if i > first and not s.held[i]:
                # It left the fingers with the gripper still closed.
                c = over(obj, i)
                lost = Label("place", obj, c) if c else Label("drop" if s.lifted[i - 1] else "missed", obj)
                if lost.kind != "place":
                    failed.add(obj)
                labels[i] = lost
                continue
            c = over(obj, i) if i >= first else None
            labels[i] = Label("place", obj, c) if c else Label("carry", obj) if i >= first and s.lifted[i] else Label(kind, obj)
        if s.held[b - 1]:
            released[b] = Label("release", obj, over(obj, b - 1))

    # Open steps: reach before the first close; after an opening that let an object go, release (all of it if no
    # close follows, else RELEASE_S); otherwise reach.
    step = float(np.median(np.diff(sig.t))) if n > 1 else 1.0
    keep = max(1, int(round(RELEASE_S / step)))
    for a, b in _runs(~closed):
        rel = released.get(a)
        last = b == n
        for i in range(a, b):
            labels[i] = rel if rel is not None and (last or i - a < keep) else Label("reach")
    return [lab for lab in labels]  # every step is labelled by now


def segments(sig: SceneSignals) -> list[Segment]:
    labels = step_labels(sig)
    t = sig.t
    out: list[Segment] = []
    start = 0
    for i in range(1, len(labels) + 1):
        if i == len(labels) or labels[i] != labels[start]:
            lab = labels[start]
            out.append(Segment(lab.kind, float(t[start]), float(t[i] if i < len(labels) else t[-1]), lab.obj, lab.container))
            start = i
    return out


def describe(segs: list[Segment], names: dict[str, str] | None = None, verbose: bool = False) -> str:
    """The demo in one line. Short: grasps, misses, drops and places with their start times. verbose: every
    segment with its span."""
    names = names or {}

    def nm(x: str | None) -> str:
        return names.get(x, x.replace("_", " ")) if x else ""

    if verbose:
        parts = []
        for s in segs:
            words = [s.kind, nm(s.obj), nm(s.container) if s.kind in ("place", "release") else ""]
            parts.append(" ".join(w for w in words if w) + f" {s.start:.1f}-{s.end:.1f} s")
        return " -> ".join(parts)

    parts: list[str] = []
    placed = False  # one "place" per hold, however often the object crosses a bin's edge
    holding: str | None = None
    seen: set[str] = set()  # objects tried before: a close on nothing near one again is a regrasp
    for s in segs:
        if s.kind in ("grasp", "regrasp"):
            if holding != s.obj:
                parts.append(f"{s.kind} {nm(s.obj)} {s.start:.1f} s")
            holding, placed = s.obj, False
            seen.add(s.obj)
        elif s.kind == "missed":
            if holding != s.obj:
                parts.append(f"{'regrasp' if s.obj in seen else 'grasp'} {nm(s.obj)} {s.start:.1f} s")
            parts.append("missed")
            holding = None
            if s.obj:
                seen.add(s.obj)
        elif s.kind == "drop":
            parts.append(f"dropped {nm(s.obj)} {s.start:.1f} s")
            holding = None
        elif s.kind == "place" and not placed:
            parts.append(f"place {nm(s.container)} {s.start:.1f} s")
            placed = True
        elif s.kind in ("reach", "release"):
            holding = None
    return " -> ".join(parts)
