"""Export an Isaac robot USD to a URDF + OBJ meshes (Isaac Sim's isaacsim.asset.exporter.urdf), for "Bring your
robot" test inputs: a built-in robot exported this way goes through the same upload path as a user's URDF.

Usage (headless, Isaac python):
    C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_worker\\scripts\\export_usd_urdf.py --usd <robot.usd> --out <dir>

Joints whose limits are [x, x] are written as fixed: Isaac's OpenArm locks openarm_hand_joint and
openarm_ee_tcp_joint that way (T2 note 2026-10-16, Task 5), and a locked joint is a fixed joint to the URDF importer
and to the role rules. Each one is printed. <out>/<name>.zip holds the URDF and its meshes, ready to upload.

--collision-only drops the <visual> elements and their meshes: the report run renders nothing, and Isaac's OpenArm
visual meshes export to 148 MB of OBJ, over the upload's 100 MB limit. Physics only reads collisions and inertials.
With --urdf, an earlier export is post-processed without Isaac.
"""

import argparse
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
parser.add_argument("--usd", type=Path, default=None)
parser.add_argument("--out", type=Path, required=True)
parser.add_argument("--name", default=None, help="URDF file name (default: the USD's)")
parser.add_argument("--physics-variant", default="PhysX", help="the USD's Physics variant (Isaac robots: PhysX)")
parser.add_argument("--collision-only", action="store_true", help="drop visuals and their meshes")
parser.add_argument("--urdf", type=Path, default=None, help="post-process this exported URDF instead (no Isaac)")
args = parser.parse_args()


def lock_to_fixed(path: Path) -> list[str]:
    tree = ET.parse(path)
    locked = []
    for j in tree.getroot().findall("joint"):
        lim = j.find("limit")
        if j.get("type") in ("revolute", "prismatic") and lim is not None and lim.get("lower") is not None \
                and float(lim.get("lower")) == float(lim.get("upper", "nan")):
            j.set("type", "fixed")
            for tag in ("limit", "axis", "dynamics", "mimic"):
                for el in j.findall(tag):
                    j.remove(el)
            locked.append(j.get("name"))
    tree.write(path, encoding="utf-8", xml_declaration=True)
    return locked


def drop_visuals(path: Path) -> list[Path]:
    """Remove every <visual>; returns the mesh files no element references any more."""
    tree = ET.parse(path)
    for link in tree.getroot().findall("link"):
        for v in link.findall("visual"):
            link.remove(v)
    tree.write(path, encoding="utf-8", xml_declaration=True)
    used = {(path.parent / m.get("filename")).resolve() for m in tree.getroot().iter("mesh")}
    stale = []
    for f in path.parent.rglob("*"):
        if f.suffix.lower() in (".obj", ".stl", ".dae") and f.resolve() not in used:
            stale += [f] + [m for m in (f.with_suffix(".mtl"),) if m.is_file()]
    return stale


def package(urdf: Path) -> None:
    for j in lock_to_fixed(urdf):
        print(f"LOCKED {j}: limits [x, x] -> fixed", flush=True)
    if args.collision_only:
        for f in drop_visuals(urdf):
            f.unlink()
    with zipfile.ZipFile(args.out / f"{urdf.stem}.zip", "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(args.out.rglob("*")):
            if f.is_file() and f.suffix != ".zip":
                z.write(f, f.relative_to(args.out).as_posix())
    print(f"URDF {urdf}", flush=True)


def export() -> Path:
    from isaacsim import SimulationApp

    app = SimulationApp({"headless": True})
    try:
        import omni.kit.app

        omni.kit.app.get_app().get_extension_manager().set_extension_enabled_immediate(
            "isaacsim.asset.exporter.urdf", True)
        from isaacsim.asset.exporter.urdf.converter import UsdToUrdfConverter

        args.out.mkdir(parents=True, exist_ok=True)
        conv = UsdToUrdfConverter(str(args.usd), variant_selections={"Physics": args.physics_variant})
        return Path(conv.convert(str(args.out / f"{args.name or args.usd.stem}.urdf")))
    finally:
        app.close()


if __name__ == "__main__":
    try:
        package(args.urdf if args.urdf is not None else export())
    except Exception:
        import traceback

        traceback.print_exc()
        sys.exit(1)
