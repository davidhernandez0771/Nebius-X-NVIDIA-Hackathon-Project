"""Export a SANT store's verified demos as an Isaac Lab Mimic source dataset (one annotated HDF5 file).

    C:\\isaac\\env_isaaclab\\Scripts\\python.exe scripts\\export_mimic.py --store <store dir> --out <file.hdf5>
        [--select sources|all] [--env-name SANT-PickPlace-Franka-IK-Abs-Mimic-v0]

It needs h5py, which Isaac Lab's Python has and SANT's venv doesn't (run it with Isaac Lab's Python, as above; no
simulator starts, nothing touches the GPU). The store is a pipeline store (`<store>/demos/<id>/passport.json` and
`<store>/demos/<id>/episode/`), e.g. data/human_exp/human10c/store.

--select sources (default): the verified demos that aren't multiplied variants and start at the robot's home pose,
the perfected demos Mimic should multiply. --select all adds SANT's own verified variants.

The conversion is demo_pipeline.mimic; the layout is Isaac Lab's HDF5DatasetFileHandler's (format_version 1,
`data/demo_N`, `env_args`, per-demo `num_samples`, `success`, `seed`), plus SANT's provenance in `sant*` attributes.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))  # repo root, for `sim_worker`
from sim_worker.own_code import check_own_code, put_own_code_first  # noqa: E402

put_own_code_first()  # this checkout's src first: the venv's editable install (if any) points at another worktree

from demo_pipeline import mimic  # noqa: E402

DEFAULT_ENV = mimic.ENV_NAME


@dataclass(frozen=True)
class DemoRef:
    demo_id: str
    folder: Path
    passport: dict

    @property
    def episode(self) -> Path:
        return self.folder / "episode"

    @property
    def verified(self) -> bool:
        return bool((self.passport.get("verification") or {}).get("success"))

    @property
    def variant(self) -> bool:
        return self.passport.get("variant_seed") is not None


def find_demos(store: Path) -> list[DemoRef]:
    """Every demo in the store that has an episode folder, by id."""
    out = []
    for d in sorted((Path(store) / "demos").iterdir()):
        pp, ep = d / "passport.json", d / "episode"
        if pp.exists() and (ep / "steps.npz").exists():
            out.append(DemoRef(d.name, d, json.loads(pp.read_text(encoding="utf-8"))))
    return out


def _trajectory(ref: DemoRef) -> dict:
    return json.loads((ref.episode / "trajectory.json").read_text(encoding="utf-8"))


def select(refs: list[DemoRef], mode: str = "sources") -> list[DemoRef]:
    """Verified demos that start at home; `sources` drops SANT's multiplied variants, `all` keeps them."""
    if mode not in ("sources", "all"):
        raise ValueError(f"unknown selection {mode!r}")
    keep = [r for r in refs if r.verified and (mode == "all" or not r.variant)]
    return [r for r in keep if (r.episode / "trajectory.json").exists() and mimic.starts_at_home(_trajectory(r))]


def load_demo(ref: DemoRef) -> dict:
    """The demo's episode folder -> its Mimic demo dict (demo_pipeline.mimic.episode_to_mimic)."""
    with np.load(ref.episode / "steps.npz") as z:
        steps = {k: z[k] for k in z.files}
    with np.load(ref.episode / "signals.npz") as z:
        cube = z["cube_pos"]
    scene = json.loads((ref.episode / "scene.json").read_text(encoding="utf-8"))
    return mimic.episode_to_mimic(steps, _trajectory(ref), cube, scene)


def _write_group(h5, name: str, value) -> None:
    if isinstance(value, dict):
        g = h5.create_group(name)
        for k, v in value.items():
            _write_group(g, k, v)
    else:
        # As HDF5DatasetFileHandler.write_episode does.
        h5.create_dataset(name, data=np.asarray(value), compression="gzip", compression_opts=2)


def write(out: Path, demos: list[tuple[DemoRef, dict]], env_name: str) -> dict:
    """Write the demos to a new HDF5 file in Isaac Lab's dataset layout; return a summary."""
    import h5py

    out.parent.mkdir(parents=True, exist_ok=True)
    total = 0
    with h5py.File(out, "w") as f:
        f.attrs["format_version"] = mimic.FORMAT_VERSION
        data = f.create_group("data")
        # robomimic's env type 2 (gym), as Isaac Lab writes it.
        data.attrs["env_args"] = json.dumps({"env_name": env_name, "type": 2})
        data.attrs["sant"] = json.dumps({"eef": mimic.EEF, "subtasks": mimic.SUBTASKS, "action": "tool_pos(3) tool_quat_xyzw(4) gripper(+1 open, -1 close)",
                                         "frame": "env frame, robot base at the origin; tool = fingertip centre"})
        for i, (ref, demo) in enumerate(demos):
            g = data.create_group(f"demo_{i}")
            n = len(demo["actions"])
            g.attrs["num_samples"] = n
            g.attrs["success"] = True
            seed = json.loads((ref.episode / "scene.json").read_text(encoding="utf-8")).get("seed")
            if seed is not None:
                g.attrs["seed"] = int(seed)
            g.attrs["sant_demo_id"] = ref.demo_id
            g.attrs["sant_lineage"] = json.dumps(ref.passport.get("lineage") or [ref.demo_id])
            g.attrs["sant_repairs"] = json.dumps(ref.passport.get("repairs_applied") or [])
            g.attrs["sant_verification"] = json.dumps(ref.passport.get("verification") or {})
            for k, v in demo.items():
                _write_group(g, k, v)
            total += n
        data.attrs["total"] = total
    return {"out": str(out), "demos": len(demos), "steps": total, "env_name": env_name}


def main(argv: list[str] | None = None) -> dict:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--store", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--select", choices=("sources", "all"), default="sources")
    ap.add_argument("--env-name", default=DEFAULT_ENV)
    args = ap.parse_args(argv)
    check_own_code()  # logs where demo_pipeline came from; stops if not this checkout

    if args.out.exists():
        raise SystemExit(f"{args.out} exists; pick a new file")
    picked = select(find_demos(args.store), args.select)
    if not picked:
        raise SystemExit(f"{args.store}: no demos to export (verified, starting at home{', not variants' if args.select == 'sources' else ''})")
    demos = []
    for ref in picked:
        demo = load_demo(ref)
        bounds = mimic.check(demo)
        print(f"{ref.demo_id}: {len(demo['actions'])} steps, grasp {bounds[0]}, place {bounds[1]}")
        demos.append((ref, demo))
    try:
        summary = write(args.out, demos, args.env_name)
    except ImportError as e:
        raise SystemExit(f"h5py is missing ({e}): run this with Isaac Lab's Python, C:\\isaac\\env_isaaclab\\Scripts\\python.exe") from e
    print(json.dumps(summary))
    return summary


if __name__ == "__main__":
    main()
