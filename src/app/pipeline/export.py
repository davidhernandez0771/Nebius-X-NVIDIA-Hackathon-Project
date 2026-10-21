"""What a finished pipeline run hands over, written to DATA_DIR/pipeline/runs/<id>/artifacts/ with an index
(artifacts.json: name, kind, bytes, sha256, url, note) and served only to the browser that asks (app/routers/pipeline):

- dataset_<cell>.zip   each trained cell's LeRobot dataset (the one training used: DATA_DIR/experiments/<run>/datasets/
                       <cell>); a run that stops at the grid assembles them first, in the LeRobot venv (`assemble`)
- robota_embed.zip     the Robota-Embed export of the multiplied cell (demo_pipeline.export_robota); its instruction
                       phrasings when demo_pipeline.instructions is there (pm/robota-instructions), else the task text
- results.json         the run's results (the Results page's shape), when it trained and evaluated
- report.md, .html     a readable report: the demos, each stage's outcome, the result, the downloads
- provenance.json      the frozen config, the demos' hashes, the pre-registration's hash, the code version, the
                       runner's arguments and every other artifact's hash
A part that fails (a Robota export with no verified episode, say) is noted in the report; the rest still exports.
"""
from __future__ import annotations

import hashlib
import html
import json
import os
import shutil
import subprocess
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from app.config import REPO_ROOT

KINDS = {".zip": "dataset", ".md": "report", ".html": "report", ".json": "other"}
LEROBOT_PY = Path(r"C:\venvs\lerobot\Scripts\python.exe")


def safe_name(name: str) -> str | None:
    """`name` if it is a plain file name (no folder, no ..), else None."""
    if not name or name in (".", "..") or "/" in name or "\\" in name or Path(name).name != name or name.startswith("."):
        return None
    return name


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _read_json(path: Path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _zip_dir(src: Path, dest: Path, arcroot: str) -> None:
    """src as dest (a zip; stored, the videos and parquet are compressed already), written via a .tmp."""
    tmp = dest.with_name(dest.name + ".tmp")
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as z:
        for p in sorted(src.rglob("*")):
            if p.is_file():
                z.write(p, f"{arcroot}/{p.relative_to(src).as_posix()}")
    os.replace(tmp, dest)


def _write(dest: Path, text: str) -> None:
    tmp = dest.with_name(dest.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, dest)


def git_commit() -> str | None:
    try:
        out = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=REPO_ROOT, capture_output=True, text=True,
                             timeout=10)
        return out.stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


def robota_export(dataset: Path, out: Path, *, nemotron: bool = False) -> dict:
    """The Robota-Embed export of `dataset` into `out`, with Nemotron's instruction phrasings when that code is here."""
    from demo_pipeline import export_robota

    try:
        from app.ai.instruction_variants import make_instruction_set  # pm/robota-instructions
        from demo_pipeline.rules import TASK_TEXT
    except ImportError:
        export_robota.export(dataset, out)
        return {"instructions": "the task text only (the instruction phrasings, pm/robota-instructions, aren't merged here)"}
    s = make_instruction_set(TASK_TEXT, n=8) if nemotron else make_instruction_set(TASK_TEXT, n=8, chat_fn=None)
    export_robota.export(dataset, out, instructions=s)
    return {"instructions": f"{len(s.phrasings)} phrasings from {s.provenance.get('generator')}"}


def assemble_in_lerobot_venv(grid: Path, out: Path) -> list[Path]:
    """The grid's cells as LeRobot datasets under `out` (lerobot_tools.assemble needs the lerobot package)."""
    env = {k: v for k, v in os.environ.items() if k != "VIRTUAL_ENV"}
    env["PYTHONPATH"] = f"{REPO_ROOT / 'src'}{os.pathsep}{REPO_ROOT}"
    code = ("import json,sys; from pathlib import Path; from lerobot_tools.assemble import Cell, assemble; "
            "g=json.load(open(sys.argv[1],encoding='utf-8')); "
            "print(json.dumps([str(assemble(Cell.model_validate(c), Path(sys.argv[2]))) for c in g['cells']]))")
    res = subprocess.run([str(LEROBOT_PY), "-c", code, str(grid), str(out)], cwd=REPO_ROOT, env=env, capture_output=True,
                         text=True, timeout=3600)
    if res.returncode != 0:
        raise RuntimeError(f"assembling the datasets failed: {res.stderr.strip()[-400:]}")
    return [Path(p) for p in json.loads(res.stdout.strip().splitlines()[-1])]


def _report(run: dict, config: dict, sim: dict, results: dict | None, arts: list[dict], notes: list[str]) -> str:
    ids = config.get("ids", [])
    n = len(ids)
    lines = [f"# SANT pipeline run: {run.get('name') or run['id']}", "",
             f"Run `{run['id']}`, created {run.get('created')}. {n} demos: {', '.join(f'`{i}`' for i in ids)}.", ""]
    if config.get("smoke") or (results or {}).get("sample"):
        lines += ["**SMOKE TEST.** This run proves every stage works. It measures nothing, and no number in it is a result.", ""]
    lines += ["## What each stage did", ""]
    if sim:
        rep = sim.get("repair") or {}
        mul = sim.get("multiply") or {}
        lines += [f"- physics: {sim.get('physics_verified', 0)}/{n} verified as recorded",
                  f"- repair: {rep.get('perfected', 0)} perfected, {rep.get('kept', 0)} kept, {rep.get('discarded', 0)} discarded",
                  f"- multiply: {mul.get('successes', 0)}/{mul.get('attempts', 0)} variants verified"]
    else:
        lines.append("- the sim stages didn't finish")
    head = ((results or {}).get("experiment") or {}).get("headline") or {}
    if head:
        lines += ["", "## Result", ""]
        for arm in ("raw", "multiplied"):
            if arm in head:
                lines.append(f"- {arm}: {head[arm].get('successes')}/{head[arm].get('n')} successes on the eval seeds")
        if head.get("fisher_p") is not None:
            lines.append(f"- two-sided Fisher exact p = {head['fisher_p']:.3g}")
    lines += ["", "## Downloads", ""]
    lines += [f"- `{a['name']}` ({a['bytes']:,} bytes, sha256 `{a['sha256'][:12]}…`)" + (f": {a['note']}" if a.get("note") else "")
              for a in arts] or ["- none"]
    if notes:
        lines += ["", "## Notes", "", *[f"- {x}" for x in notes]]
    return "\n".join(lines) + "\n"


def _html(md: str, title: str) -> str:
    """The report as a plain page: escaped text, headings and lists, no scripts."""
    body = []
    in_list = False
    for line in md.splitlines():
        if line.startswith("- "):
            if not in_list:
                body.append("<ul>")
                in_list = True
            body.append(f"<li>{html.escape(line[2:])}</li>")
            continue
        if in_list:
            body.append("</ul>")
            in_list = False
        if line.startswith("## "):
            body.append(f"<h2>{html.escape(line[3:])}</h2>")
        elif line.startswith("# "):
            body.append(f"<h1>{html.escape(line[2:])}</h1>")
        elif line.strip():
            body.append(f"<p>{html.escape(line)}</p>")
    if in_list:
        body.append("</ul>")
    return (f"<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><title>{html.escape(title)}</title>"
            "<style>body{font:15px/1.55 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#111}"
            "code{font-family:ui-monospace,monospace}</style></head><body>\n" + "\n".join(body) + "\n</body></html>\n")


def build_artifacts(run: dict, *, data: Path, out: Path, robota: Callable[[Path, Path], dict] | None = None,
                    assemble: Callable[[Path, Path], list[Path]] | None = None, commit: str | None = None,
                    progress: Callable[[str], None] = lambda s: None) -> list[dict]:
    """Write the run's artifacts to `out` and return the index (also written to out/artifacts.json)."""
    data, out = Path(data), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    root = data / "human_exp" / run["id"]
    config = _read_json(root / "config.json") or {}
    sim = _read_json(root / "stages" / "sim.json") or {}
    train = _read_json(root / "stages" / "train.json") or {}
    results = _read_json(root / "results.json")
    notes: list[str] = []
    made: list[tuple[str, str | None]] = []  # (file name, note)

    # The datasets: the ones training used, or assembled now for a run that stopped at the grid.
    datasets: dict[str, Path] = {c: Path(v["dataset"]) for c, v in (train.get("cells") or {}).items()
                                 if v.get("dataset") and Path(v["dataset"]).is_dir()}
    tmp_root = None
    if not datasets and assemble is not None and (root / "grid.json").is_file():
        tmp_root = Path(tempfile.mkdtemp(prefix="sant-export-"))
        try:
            progress("assembling the LeRobot datasets")
            datasets = {p.name: p for p in assemble(root / "grid.json", tmp_root)}
        except Exception as e:  # noqa: BLE001: noted, the rest still exports
            notes.append(f"LeRobot datasets couldn't be assembled: {type(e).__name__}: {e}")
    if not datasets:
        notes.append("no LeRobot dataset: the run didn't reach the grid with verified episodes")
    try:
        for cell, path in datasets.items():
            progress(f"zipping {cell}")
            _zip_dir(path, out / f"dataset_{cell}.zip", cell)
            made.append((f"dataset_{cell}.zip", None))

        # Robota-Embed, from the multiplied cell (the most episodes)
        mult = next((p for c, p in datasets.items() if c.startswith("perfected_multiply")), None) or next(iter(datasets.values()), None)
        if mult is not None and robota is not None:
            progress("the Robota-Embed export")
            work = Path(tempfile.mkdtemp(prefix="sant-robota-")) / "robota_embed"
            try:
                info = robota(mult, work) or {}
                _zip_dir(work, out / "robota_embed.zip", "robota_embed")
                made.append(("robota_embed.zip", f"instructions: {info.get('instructions')}" if info.get("instructions") else None))
            except Exception as e:  # noqa: BLE001
                notes.append(f"Robota-Embed export failed: {type(e).__name__}: {e}")
            finally:
                shutil.rmtree(work.parent, ignore_errors=True)
    finally:
        if tmp_root is not None:
            shutil.rmtree(tmp_root, ignore_errors=True)

    if results is not None:
        shutil.copyfile(root / "results.json", out / "results.json")
        made.append(("results.json", None))

    def entry(name: str, note: str | None) -> dict:
        p = out / name
        kind = "robota" if name.startswith("robota") else KINDS.get(p.suffix, "other")
        return {"name": name, "kind": kind, "bytes": p.stat().st_size, "sha256": _sha256(p),
                "url": f"/pipeline/runs/{run['id']}/artifacts/{name}", **({"note": note} if note else {})}

    arts = [entry(n, note) for n, note in made]
    md = _report(run, config, sim, results, arts, notes)
    _write(out / "report.md", md)
    _write(out / "report.html", _html(md, f"SANT pipeline run {run.get('name') or run['id']}"))
    arts += [entry("report.md", None), entry("report.html", None)]
    prereg = root / "preregistration.md"
    prov = {
        "run_id": run["id"], "name": run.get("name"), "created": run.get("created"),
        "exported": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "git_commit": commit, "pipeline_version": config.get("pipeline_version"),
        "recipe": run.get("recipe"), "runner_args": run.get("args"), "config": config,
        "demo_sha256": config.get("demo_sha256", {}),
        "preregistration_sha256": _sha256(prereg) if prereg.is_file() else None,
        "training_run": train.get("run_id"), "artifacts": [{k: a[k] for k in ("name", "bytes", "sha256")} for a in arts],
        "notes": notes,
    }
    _write(out / "provenance.json", json.dumps(prov, indent=1, default=str))
    arts.append(entry("provenance.json", None))
    _write(out / "artifacts.json", json.dumps(arts, indent=1))
    return arts
