"""The Record page's scene library: ScenePlans (demo_pipeline.scene_plan) to record demos in, stored one per file as
DATA_DIR/scenes/<id>.json, plus the built-in "standard" (the live sink's one cube and one bin, STANDARD_SCENE).

Every entry carries its plan's hash (plan_hash: sha256 of the plan's canonical JSON, 16 hex), which each demo saves
with the entry's id, and whether the plan needs the Isaac settle check before anyone records in it (needs_settle:
any body today's scene doesn't have, i.e. anything but one table cube of CUBE_SIZE and one BIN_INNER bin; poses alone
never need it). The sim records a settle result per entry (record_settle), for that exact plan hash.

protocol_entries() are the 8 ready-made plans for the recording protocol (S1 standard ... S8 taller bin); every one
passes validate_plan. seed_protocol() writes the missing ones and never overwrites an existing file.
Pure: pydantic + the plan code, no Isaac.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .scene_geometry import BIN_INNER, CUBE_SIZE
from .scene_plan import BinSpec, CubeSpec, Goal, ScenePlan, TablePose, validate_plan
from .schemas import Pose, Scene
from .store import write_atomic

STANDARD_ID = "standard"
# The live teleop sink's scene before the picker (sim_worker/scripts/teleop_sink.py base_scene): where every recorded
# demo had the cube and the bin. It is NOT ScenePlan.default() (the middle of the sampling ranges).
STANDARD_SCENE = Scene(cube_pose=Pose(pos=(0.5, 0.0, CUBE_SIZE / 2), quat_wxyz=(1.0, 0.0, 0.0, 0.0)),
                       bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=(1.0, 0.0, 0.0, 0.0)), robot="franka", seed=0)
PROTOCOL_IDS = ("s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8")
SCENES_DIR = "scenes"
_SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")

SceneSource = Literal["standard", "protocol", "nemotron", "saved"]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SettleResult(_Model):
    ok: bool
    errors: list[str] = Field(default_factory=list)
    hash: str  # the plan it was checked for
    at: str


class SceneEntry(_Model):
    id: str
    name: str
    description: str = ""
    source: SceneSource
    plan: ScenePlan
    hash: str
    needs_settle: bool
    settle: SettleResult | None = None
    created_at: str


def plan_hash(plan: ScenePlan) -> str:
    """sha256 of the plan's canonical JSON (keys sorted, no spaces), first 16 hex digits."""
    text = json.dumps(plan.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def needs_settle(plan: ScenePlan) -> bool:
    """False only for today's bodies (one table cube of CUBE_SIZE, one BIN_INNER bin) in any pose: physics then is
    today's, which every recorded demo already exercised. Anything else (another size, another cube, a stack, another
    bin) is checked in Isaac first."""
    cubes = [o for o in plan.objects if o.kind == "cube"]
    bins = [o for o in plan.objects if o.kind == "bin"]
    return not (len(cubes) == 1 and len(bins) == 1 and cubes[0].on is None and cubes[0].size == CUBE_SIZE
                and tuple(bins[0].inner) == BIN_INNER)


def standard_plan() -> ScenePlan:
    """The live sink's scene as a plan: a red CUBE_SIZE cube "cube" into a blue BIN_INNER bin "bin"."""
    return ScenePlan.from_scene(STANDARD_SCENE)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _entry(id: str, name: str, description: str, source: SceneSource, plan: ScenePlan, created_at: str) -> SceneEntry:
    return SceneEntry(id=id, name=name, description=description, source=source, plan=plan, hash=plan_hash(plan),
                      needs_settle=needs_settle(plan), created_at=created_at)


# --- the recording protocol's 8 plans -------------------------------------------------------------

def _plan(cube: dict | None = None, bin: dict | None = None, extra: list | None = None) -> ScenePlan:
    """The standard scene with changes: cube / bin fields over the standard's, extra objects (goal: cube -> bin)."""
    std = standard_plan()
    c, b = std.object("cube"), std.object("bin")
    cube = cube or {}
    bin = bin or {}
    cpose = TablePose(**{**c.pose.model_dump(), **cube.pop("pose", {})})
    bpose = TablePose(**{**b.pose.model_dump(), **bin.pop("pose", {})})
    objects = [CubeSpec(**{**c.model_dump(), "pose": cpose, **cube}), BinSpec(**{**b.model_dump(), "pose": bpose, **bin})]
    return ScenePlan(robot=std.robot, objects=objects + (extra or []), goals=[Goal(object="cube", bin="bin")])


def protocol_entries() -> list[SceneEntry]:
    """S1-S8, in order. Ids s1..s8; names "S1 ...". The goal is always the red cube into the blue bin."""
    rows = [
        ("s1", "S1 Standard", "Today's scene: the red cube and the blue bin where every earlier demo had them.",
         _plan()),
        ("s2", "S2 Cube at the edge of reach", "The cube far out and to the right, 2 cm inside the arm's reach.",
         _plan(cube={"pose": {"x": 0.63, "y": -0.26}})),
        ("s3", "S3 Bin turned, other side", "The bin turned 90 degrees and moved to the robot's right; the cube stays.",
         _plan(bin={"pose": {"x": 0.55, "y": -0.20, "yaw_deg": 90.0}})),
        ("s4", "S4 Small cube", "A 4 cm cube instead of 5 cm.", _plan(cube={"size": 0.04})),
        ("s5", "S5 Large cube", "A 6 cm cube instead of 5 cm (the fingers open to 8 cm).", _plan(cube={"size": 0.06})),
        ("s6", "S6 Cube turned 35 degrees", "The cube yawed 35 degrees: line the fingers up with its faces.",
         _plan(cube={"pose": {"yaw_deg": 35.0}})),
        ("s7", "S7 Yellow distractor", "A yellow cube right next to the red one. The goal stays red into the bin.",
         _plan(extra=[CubeSpec(id="distractor", kind="cube", color="yellow", size=CUBE_SIZE,
                               pose=TablePose(x=0.50, y=-0.085, yaw_deg=0.0))])),
        ("s8", "S8 Taller bin", "The bin's walls 11 cm high instead of 8 cm: a higher rim to clear.",
         _plan(bin={"inner": (BIN_INNER[0], BIN_INNER[1], 0.11)})),
    ]
    return [_entry(i, n, d, "protocol", p, "2026-10-20T00:00:00+00:00") for i, n, d, p in rows]


def standard_entry() -> SceneEntry:
    return _entry(STANDARD_ID, "Standard", "Today's scene: one red cube, one blue bin.", "standard",
                  standard_plan(), "2026-10-15T00:00:00+00:00")


# --- the library on disk --------------------------------------------------------------------------

class SceneLibrary:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self.dir = self.root / SCENES_DIR

    def _path(self, id: str) -> Path:
        if not isinstance(id, str) or not _SAFE_ID.match(id) or id == STANDARD_ID:
            raise KeyError(id)
        return self.dir / f"{id}.json"

    def get(self, id: str) -> SceneEntry:
        """KeyError if there is no such scene; ValueError if its file is corrupt."""
        if id == STANDARD_ID:
            return standard_entry()
        path = self._path(id)
        if not path.is_file():
            raise KeyError(id)
        return SceneEntry.model_validate_json(path.read_text(encoding="utf-8"))

    def list(self) -> list[SceneEntry]:
        """Standard first, then the protocol's in order, then the rest oldest first. Unreadable files are skipped."""
        found = []
        if self.dir.is_dir():
            for p in self.dir.glob("*.json"):
                try:
                    found.append(self.get(p.stem))
                except (KeyError, ValueError):
                    continue
        order = {pid: i for i, pid in enumerate(PROTOCOL_IDS)}
        found.sort(key=lambda e: (order.get(e.id, len(order)), e.created_at, e.id))
        return [standard_entry(), *found]

    def _write(self, entry: SceneEntry) -> None:
        write_atomic(self._path(entry.id), entry.model_dump_json(indent=1))

    def seed_protocol(self) -> list[str]:
        """Write the protocol plans that aren't there yet; return their ids. Never overwrites."""
        written = []
        for e in protocol_entries():
            if not self._path(e.id).exists():
                self._write(e)
                written.append(e.id)
        return written

    def save(self, *, name: str, description: str, plan: ScenePlan, source: SceneSource) -> SceneEntry:
        """A new entry (id: the name's slug + the hash's first 6), or the existing one with the same name and plan.
        ValueError if validate_plan finds problems."""
        errors = validate_plan(plan)
        if errors:
            raise ValueError("; ".join(errors))
        slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:40] or "scene"
        h = plan_hash(plan)
        id = f"{slug}_{h[:6]}"
        try:
            return self.get(id)
        except KeyError:
            pass
        entry = _entry(id, name.strip() or "Scene", description, source, plan, _now())
        self._write(entry)
        return entry

    def record_settle(self, id: str, *, ok: bool, errors: list[str]) -> SceneEntry:
        """Keep the Isaac settle check's result with the entry (for its current plan hash)."""
        entry = self.get(id)
        if id == STANDARD_ID:
            return entry  # today's bodies: nothing to keep
        entry = entry.model_copy(update={"settle": SettleResult(ok=ok, errors=list(errors), hash=entry.hash, at=_now())})
        self._write(entry)
        return entry
