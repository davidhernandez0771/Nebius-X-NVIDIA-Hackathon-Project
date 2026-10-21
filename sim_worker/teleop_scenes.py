"""Changing the live teleop scene from the Record page (control "set_scene"). Pure: no Isaac.

Isaac builds one scene per process (replay._session), so a plan can be switched to in the running sim only when it
has the same bodies (plan_layout.body_key: the same cubes and bins, other poses: S1, S2, S3, S6 of the protocol);
the session then places them again (a scene reset). A plan with other bodies (another size, another cube, a taller
bin) needs a new sim: the switcher asks for a restart (the sink exits and comes back in that scene) and the page sees
"switching" in the status until it does.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Callable

from demo_pipeline.scene_library import SceneEntry, SceneLibrary
from demo_pipeline.scene_plan import ScenePlan, resolve
from demo_pipeline.schemas import Pose, Scene, ScenePlanRef
from demo_pipeline.store import write_atomic

from .plan_layout import body_key, layout_for_plan

RESTART_EXIT = 75  # the sink's exit code for "start me again in the requested scene" (EX_TEMPFAIL)
NEXT_SCENE_FILE = "_next_scene.txt"  # under DATA_DIR/scenes: the scene the restarted sink should load


def _yaw_quat(deg: float) -> tuple[float, float, float, float]:
    h = math.radians(deg) / 2
    return (math.cos(h), 0.0, 0.0, math.sin(h))


def scene_for_plan(plan: ScenePlan, seed: int = 0) -> Scene:
    """The Demo.scene of a plan's demo: its first goal's cube and bin (centre and floor-underside poses). The whole plan
    is saved beside the episode (plan.json); this keeps Demo.scene meaningful for single-cube tools."""
    placed = resolve(plan)
    goal = plan.goals[0]
    c, b = placed[goal.object], placed[goal.bin]
    return Scene(cube_pose=Pose(pos=c.pos, quat_wxyz=_yaw_quat(c.yaw_deg)),
                 bin_pose=Pose(pos=b.pos, quat_wxyz=_yaw_quat(b.yaw_deg)), robot=plan.robot, seed=seed)


def scene_ref(entry: SceneEntry) -> ScenePlanRef:
    return ScenePlanRef(id=entry.id, hash=entry.hash, name=entry.name)


class SceneSwitcher:
    """session.on_control("set_scene") calls switch(id). current_key: the body_key of the scene the sim was built with;
    restart(entry): ask for a new sim in that scene (the sink's job)."""

    def __init__(self, library: SceneLibrary, session, *, current_key: tuple, restart: Callable[[SceneEntry], None],
                 playlist: "ScenePlaylist | None" = None):
        self.library, self.session, self.current_key, self.restart = library, session, current_key, restart
        self.playlist = playlist  # a recording session's scene list (the sink's --scene-list), or None

    def after_save(self) -> str | None:
        """A take was saved: with a scene list, move on when it's time; returns what happened, for the status line."""
        if self.playlist is None:
            return None
        nxt = self.playlist.after_save()
        return None if nxt is None else self.switch(nxt)

    def switch(self, scene_id: str) -> str:
        try:
            entry = self.library.get(scene_id)
        except KeyError:
            raise ValueError(f"no scene {scene_id!r} in {self.library.dir}") from None
        if body_key(layout_for_plan(entry.plan)) == self.current_key:
            self.session.set_plan(entry.plan, scene_ref(entry))
            return f"scene: {entry.name}"
        self.session.switching = entry.id
        self.restart(entry)
        return f"scene {entry.name}: restarting the sim to build it (about a minute)"


PLAYLIST_FILE = "_playlist.json"  # under DATA_DIR/scenes: the recording session's scene list and where it is


@dataclass
class ScenePlaylist:
    """A recording session's scene list: after each saved take the session moves to the next scene (after
    takes_per_scene takes), round and round, so e.g. 12 scenes x 2 demos are recorded in one go. Its position is kept
    in DATA_DIR/scenes/_playlist.json, so a sim restart (a scene with other bodies) carries on where it was."""

    library: SceneLibrary
    ids: list[str]
    takes_per_scene: int = 1
    index: int = 0
    take: int = 0  # takes saved in the current scene

    @classmethod
    def start(cls, library: SceneLibrary, ids: list[str], takes_per_scene: int = 1) -> "ScenePlaylist":
        if not ids:
            raise ValueError("the scene list is empty")
        if takes_per_scene < 1:
            raise ValueError("takes_per_scene must be at least 1")
        for sid in ids:
            try:
                library.get(sid)
            except KeyError:
                raise ValueError(f"no scene {sid!r} in {library.dir}") from None
        pl = cls(library, list(ids), takes_per_scene)
        pl.save()
        return pl

    @classmethod
    def resume(cls, library: SceneLibrary) -> "ScenePlaylist | None":
        path = library.dir / PLAYLIST_FILE
        if not path.is_file():
            return None
        d = json.loads(path.read_text(encoding="utf-8"))
        return cls(library, list(d["ids"]), int(d["takes_per_scene"]), int(d["index"]), int(d["take"]))

    def current(self) -> str:
        return self.ids[self.index]

    def after_save(self) -> str | None:
        """Count a saved take; the next scene's id when it's time to move on, else None."""
        self.take += 1
        moved = None
        if self.take >= self.takes_per_scene:
            self.index, self.take = (self.index + 1) % len(self.ids), 0
            moved = self.current()
        self.save()
        return moved

    def status(self) -> dict:
        return {"index": self.index, "of": len(self.ids), "take": self.take, "takes_per_scene": self.takes_per_scene}

    def save(self) -> None:
        self.library.dir.mkdir(parents=True, exist_ok=True)
        write_atomic(self.library.dir / PLAYLIST_FILE, json.dumps(
            {"ids": self.ids, "takes_per_scene": self.takes_per_scene, "index": self.index, "take": self.take}))


# --- the sink's scene start and restart (pure; sim_worker/scripts/teleop_sink.py and teleop_sink_loop.py) ---------

def prepare_scene(library: SceneLibrary, *, scene: str | None, scene_list: list[str] | None, takes_per_scene: int,
                  resume: bool) -> tuple[SceneEntry | None, "ScenePlaylist | None"]:
    """The sink's starting scene and scene list. --scene-list starts a new list (at its first scene); --resume-playlist
    (the restart loop) carries on the saved one, in --scene; --scene alone starts there. None of them: (None, None),
    today's sink exactly."""
    if scene_list:
        playlist = ScenePlaylist.start(library, scene_list, takes_per_scene)
        return library.get(playlist.current()), playlist
    if resume:
        playlist = ScenePlaylist.resume(library)
        if playlist is None:
            raise ValueError(f"--resume-playlist: no scene list in {library.dir}")
        return library.get(scene or playlist.current()), playlist
    if scene:
        return library.get(scene), None
    return None, None


def should_settle(entry: SceneEntry) -> bool:
    """New bodies are checked in Isaac before recording, until a check has passed for this exact plan."""
    return entry.needs_settle and not (entry.settle is not None and entry.settle.ok and entry.settle.hash == entry.hash)


def request_restart(library: SceneLibrary, entry: SceneEntry) -> None:
    """Leave the scene the restarted sink should load (the sink then exits with RESTART_EXIT)."""
    library.dir.mkdir(parents=True, exist_ok=True)
    write_atomic(library.dir / NEXT_SCENE_FILE, entry.id)


def read_next_scene(library: SceneLibrary) -> str | None:
    """The requested scene, once (the file is removed)."""
    path = library.dir / NEXT_SCENE_FILE
    if not path.is_file():
        return None
    sid = path.read_text(encoding="utf-8").strip()
    path.unlink()
    return sid or None


_SCENE_FLAGS = {"--scene": True, "--scene-list": True, "--takes-per-scene": True, "--resume-playlist": False}


def next_sink_args(args: list[str], next_id: str, *, playlist: bool) -> list[str]:
    """The restarted sink's arguments: the same, minus the scene choice, plus --scene next_id (and
    --resume-playlist when a scene list is running)."""
    out, skip = [], False
    for a in args:
        if skip:
            skip = False
            continue
        flag = a.split("=", 1)[0]
        if flag in _SCENE_FLAGS:
            skip = _SCENE_FLAGS[flag] and "=" not in a
            continue
        out.append(a)
    return out + ["--scene", next_id] + (["--resume-playlist"] if playlist else [])


def sink_loop(args: list[str], library: SceneLibrary, run: Callable[[list[str]], int], *,
              log: Callable[[str], None] = print, max_restarts: int = 100) -> int:
    """Run the sink (run(args) -> exit code) and, each time it exits with RESTART_EXIT, again in the scene it asked for
    (read_next_scene), keeping a running scene list (--scene-list / --resume-playlist). Any other exit ends the loop
    with that code."""
    playlist = any(a.split("=", 1)[0] in ("--scene-list", "--resume-playlist") for a in args)
    for _ in range(max_restarts + 1):
        code = run(args)
        if code != RESTART_EXIT:
            return code
        nxt = read_next_scene(library)
        if nxt is None:
            log("[sink-loop] the sink asked for a restart but named no scene; stopping")
            return 1
        log(f"[sink-loop] restarting the sink in scene {nxt}")
        args = next_sink_args(args, nxt, playlist=playlist)
    log(f"[sink-loop] {max_restarts} restarts; stopping")
    return 1
