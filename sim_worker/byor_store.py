"""Where "Bring your robot" keeps each robot: DATA_DIR/robots/<id>/ (layout in docs/design/byor-api.md section 9).

Pure Python, shared by the backend routes (src/app/routers/robots.py) and the Isaac report run
(sim_worker/scripts/robot_report.py). An upload is a .urdf or a .zip with the URDF and its meshes; its id is
"byor_" + the first 10 hex characters of its SHA-256, so the same bytes are the same robot.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import re
import shutil
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from .urdf_import import Issue, Roles, Urdf, UrdfError, error, mesh_vertices, parse_urdf

MAX_BYTES = 100 * 1024 * 1024
MAX_FILES = 5000
MESH_EXTS = (".stl", ".obj", ".dae")
ROBOT_ID = re.compile(r"^byor_[0-9a-f]{10}$")


class UploadError(ValueError):
    def __init__(self, issue: Issue, status: int = 400):
        super().__init__(issue.message)
        self.issue, self.status = issue, status


def _write_json(path: Path, obj) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=1), encoding="utf-8")
    os.replace(tmp, path)


def _read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _extract(filename: str, data: bytes, dest: Path) -> str:
    """Write the upload into dest; returns the URDF's path relative to dest (posix)."""
    lower = filename.lower()
    if lower.endswith(".xacro"):
        raise UploadError(error("xacro", "a .xacro file: run `xacro robot.urdf.xacro > robot.urdf` and upload the .urdf"))
    if lower.endswith(".urdf"):
        name = PurePosixPath(filename.replace("\\", "/")).name
        (dest / name).write_bytes(data)
        return name
    if not lower.endswith(".zip"):
        raise UploadError(error("not_urdf", f"{filename!r} is not a .urdf or a .zip"))
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
        infos = zf.infolist()
    except zipfile.BadZipFile as e:
        raise UploadError(error("unsafe_zip", f"the zip does not open: {e}")) from None
    if len(infos) > MAX_FILES:
        raise UploadError(error("too_large", f"the zip has {len(infos)} files (at most {MAX_FILES})"), 413)
    if sum(i.file_size for i in infos) > MAX_BYTES:
        raise UploadError(error("too_large", f"the zip unpacks to more than {MAX_BYTES // 2**20} MB"), 413)
    names = []
    for info in infos:
        p = PurePosixPath(info.filename.replace("\\", "/"))
        is_link = (info.external_attr >> 16) & 0o170000 == 0o120000
        if p.is_absolute() or ".." in p.parts or re.match(r"^[A-Za-z]:", info.filename) or is_link:
            raise UploadError(error("unsafe_zip", f"the zip entry {info.filename!r} points outside the robot's folder"))
        if info.is_dir() or "__MACOSX" in p.parts:
            continue
        names.append(str(p))
    urdfs = [n for n in names if n.lower().endswith(".urdf")]
    if not urdfs:
        if any(n.lower().endswith(".xacro") for n in names):
            raise UploadError(error("xacro", "the zip has only xacro files: run `xacro` and add the .urdf it prints"))
        raise UploadError(error("no_urdf", "the zip has no .urdf file"))
    if len(urdfs) > 1:
        raise UploadError(error("multiple_urdfs", f"the zip has {len(urdfs)} .urdf files ({', '.join(urdfs)}); "
                                                  "upload one robot at a time"))
    for n in names:
        out = dest / n
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(zf.read(n))
    return urdfs[0]


def find_packages(source: Path) -> dict[str, Path]:
    """ROS package name -> folder: every folder by its own name, then package.xml <name> (which wins)."""
    pkgs: dict[str, Path] = {}
    for d in sorted(p for p in source.rglob("*") if p.is_dir()):
        pkgs.setdefault(d.name, d)
    for xml in sorted(source.rglob("package.xml")):
        try:
            name = ET.parse(xml).getroot().findtext("name")
        except ET.ParseError:
            continue
        if name:
            pkgs[name.strip()] = xml.parent
    return pkgs


class RobotStore:
    def __init__(self, root: Path | None = None):
        if root is None:
            from demo_pipeline.paths import data_dir

            root = Path(data_dir()) / "robots"
        self.root = Path(root)

    def dir(self, robot_id: str) -> Path:
        if not ROBOT_ID.match(robot_id) or not (self.root / robot_id / "robot.json").is_file():
            raise KeyError(robot_id)
        return self.root / robot_id

    # --- upload ---------------------------------------------------------------------------------------------------

    def add(self, filename: str, data: bytes) -> tuple[dict, bool]:
        """(robot.json, created). Raises UploadError, or UrdfError for a URDF that does not parse."""
        if len(data) > MAX_BYTES:
            raise UploadError(error("too_large", f"the upload is over {MAX_BYTES // 2**20} MB"), 413)
        sha = hashlib.sha256(data).hexdigest()
        robot_id = "byor_" + sha[:10]
        if (self.root / robot_id / "robot.json").is_file():
            return self.summary_file(robot_id), False
        self.root.mkdir(parents=True, exist_ok=True)
        tmp = Path(tempfile.mkdtemp(prefix=f".{robot_id}_", dir=self.root))
        try:
            (tmp / "source").mkdir()
            rel = _extract(filename, data, tmp / "source")
            urdf = parse_urdf((tmp / "source" / rel).read_text(encoding="utf-8", errors="replace"))
            info = {"id": robot_id, "name": urdf.name, "urdf": rel, "sha256": sha,
                    "uploaded_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "n_links": len(urdf.links), "n_joints": len(urdf.joints)}
            _write_json(tmp / "robot.json", info)
            os.replace(tmp, self.root / robot_id)
        except BaseException:
            shutil.rmtree(tmp, ignore_errors=True)
            if (self.root / robot_id / "robot.json").is_file():  # a concurrent identical upload won
                return self.summary_file(robot_id), False
            raise
        return info, True

    def summary_file(self, robot_id: str) -> dict:
        return _read_json(self.dir(robot_id) / "robot.json")

    def list(self) -> list[dict]:
        if not self.root.is_dir():
            return []
        rows = [_read_json(d / "robot.json") for d in self.root.iterdir() if ROBOT_ID.match(d.name)]
        return sorted((r for r in rows if r), key=lambda r: r["uploaded_at"], reverse=True)

    # --- the URDF and its meshes ----------------------------------------------------------------------------------

    def urdf_path(self, robot_id: str) -> Path:
        return self.dir(robot_id) / "source" / self.summary_file(robot_id)["urdf"]

    def urdf(self, robot_id: str) -> Urdf:
        return parse_urdf(self.urdf_path(robot_id).read_text(encoding="utf-8", errors="replace"))

    def packages(self, robot_id: str) -> dict[str, Path]:
        return find_packages(self.dir(robot_id) / "source")

    def resolve_mesh(self, robot_id: str, filename: str) -> tuple[Path | None, Issue | None]:
        source = self.dir(robot_id) / "source"
        name = filename.replace("\\", "/")
        if name.startswith("package://"):
            pkg, _, rest = name[len("package://"):].partition("/")
            base = self.packages(robot_id).get(pkg)
            if base is None:
                return None, error("package_unresolved", f"{filename}: no folder or package.xml for package {pkg!r} "
                                                         "in the upload", filename)
            path = base / rest
        elif name.startswith("file://") or PurePosixPath(name).is_absolute() or re.match(r"^[A-Za-z]:", name):
            return None, error("missing_mesh", f"{filename}: an absolute path; use a path relative to the URDF or "
                                               "package://", filename)
        else:
            path = self.urdf_path(robot_id).parent / name
        path = path.resolve()
        if not path.is_relative_to(source.resolve()):
            return None, error("missing_mesh", f"{filename} points outside the upload", filename)
        if path.suffix.lower() not in MESH_EXTS:
            return None, error("mesh_format", f"{filename}: {path.suffix or 'no extension'} meshes are not supported; "
                                              "convert it to STL, OBJ or DAE", filename)
        if not path.is_file():
            return None, error("missing_mesh", f"{filename} is not in the upload", filename)
        return path, None

    def mesh_issues(self, robot_id: str, urdf: Urdf) -> list[Issue]:
        out, seen = [], set()
        for link in urdf.links.values():
            for g in link.visuals + link.collisions:
                if g.kind == "mesh" and g.filename not in seen:
                    seen.add(g.filename)
                    _, issue = self.resolve_mesh(robot_id, g.filename)
                    if issue is not None and issue.message not in {i.message for i in out}:
                        out.append(issue)
        return out

    def mesh_loader(self, robot_id: str):
        def load(filename: str):
            path, issue = self.resolve_mesh(robot_id, filename)
            if issue is not None:
                return None
            try:
                return mesh_vertices(path)
            except (OSError, ValueError, ET.ParseError):
                return None
        return load

    # --- roles, status, report ------------------------------------------------------------------------------------

    def save_roles(self, robot_id: str, roles: Roles, spec: dict) -> None:
        _write_json(self.dir(robot_id) / "roles.json", {"roles": roles.model_dump(mode="json"), "spec": spec})

    def roles(self, robot_id: str) -> dict | None:
        return _read_json(self.dir(robot_id) / "roles.json")

    def status(self, robot_id: str) -> dict | None:
        return _read_json(self.dir(robot_id) / "report_status.json")

    def write_status(self, robot_id: str, status: dict) -> None:
        _write_json(self.dir(robot_id) / "report_status.json", status)

    def progress(self, robot_id: str) -> dict | None:
        return _read_json(self.dir(robot_id) / "report_progress.json")

    def clear_progress(self, robot_id: str) -> None:
        (self.dir(robot_id) / "report_progress.json").unlink(missing_ok=True)

    def report(self, robot_id: str) -> dict | None:
        return _read_json(self.dir(robot_id) / "report.json")


__all__ = ["RobotStore", "UploadError", "UrdfError", "find_packages", "MAX_BYTES"]
