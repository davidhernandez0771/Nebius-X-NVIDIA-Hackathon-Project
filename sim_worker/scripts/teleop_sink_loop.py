r"""Run the webcam teleop sink so the Record page can change to scenes with other bodies (sim_worker.teleop_scenes).

    C:\isaac\env_isaaclab\Scripts\python.exe sim_worker\scripts\teleop_sink_loop.py --viz kit [--scene s1 |
        --scene-list s1,s2,s3 --takes-per-scene 2] [any other teleop_sink.py argument]

Isaac builds one scene per process. When the page picks a scene the running sim can't place (another cube size, a
second cube, a taller bin), the sink saves the request and exits with RESTART_EXIT; this loop starts it again in that
scene (and carries on a scene list). It imports no Isaac itself: each sink is its own process, in this python.
"""

import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(REPO / "src"), str(REPO)]

from demo_pipeline.paths import data_dir  # noqa: E402
from demo_pipeline.scene_library import SceneLibrary  # noqa: E402
from sim_worker.own_code import check_own_code  # noqa: E402
from sim_worker.teleop_scenes import sink_loop  # noqa: E402

SINK = REPO / "sim_worker" / "scripts" / "teleop_sink.py"


def _data_root(args: list[str]) -> Path:
    for i, a in enumerate(args):
        if a == "--data-dir" and i + 1 < len(args):
            return Path(args[i + 1])
        if a.startswith("--data-dir="):
            return Path(a.split("=", 1)[1])
    return data_dir()


def main() -> int:
    check_own_code()  # logs where demo_pipeline came from; stops if not this checkout
    args = sys.argv[1:]
    library = SceneLibrary(_data_root(args))
    return sink_loop(args, library, lambda a: subprocess.run([sys.executable, str(SINK), *a], env=os.environ).returncode)


if __name__ == "__main__":
    sys.exit(main())
