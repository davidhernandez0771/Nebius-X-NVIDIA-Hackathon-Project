"""scripts/launch/fetch_mediapipe.ps1, run through Windows PowerShell against a fake web dir.

Nothing here downloads the real model: every run passes -ModelUrl pointing at a local fake server
(port 0) that counts its requests, and -WebDir pointing at a temp folder. The user runs the real
download.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(
    sys.platform != "win32" or shutil.which("powershell") is None, reason="Windows PowerShell scripts"
)

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "launch" / "fetch_mediapipe.ps1"
OFFICIAL_URL = ("https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/"
                "float16/1/hand_landmarker.task")
MODEL_BYTES = b"fake-task-model\x00\x01\x02" * 1000
WASM_FILES = {
    "vision_wasm_internal.js": b"// fake js\n",
    "vision_wasm_internal.wasm": b"\x00asm\x01\x00\x00\x00fake",
    "vision_wasm_nosimd_internal.wasm": b"\x00asm\x01\x00\x00\x00nosimd",
}


class FakeDownload:
    """Serves MODEL_BYTES at /hand_landmarker.task; counts requests. mode: ok | 404 | truncated."""

    def __init__(self, mode: str = "ok"):
        self.mode = mode
        self.hits = 0
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                owner.hits += 1
                if owner.mode == "404" or self.path != "/hand_landmarker.task":
                    self.send_response(404)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(len(MODEL_BYTES)))
                self.end_headers()
                if owner.mode == "truncated":
                    self.wfile.write(MODEL_BYTES[: len(MODEL_BYTES) // 2])
                    self.wfile.flush()
                    self.close_connection = True
                    return
                self.wfile.write(MODEL_BYTES)

            def log_message(self, *args):
                pass

        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.srv.daemon_threads = True
        self.url = f"http://127.0.0.1:{self.srv.server_address[1]}/hand_landmarker.task"
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def close(self):
        self.srv.shutdown()
        self.srv.server_close()


@pytest.fixture
def server():
    made = []

    def make(mode="ok"):
        s = FakeDownload(mode)
        made.append(s)
        return s

    yield make
    for s in made:
        s.close()


@pytest.fixture
def web(tmp_path) -> Path:
    web = tmp_path / "web"
    wasm = web / "node_modules" / "@mediapipe" / "tasks-vision" / "wasm"
    wasm.mkdir(parents=True)
    for name, data in WASM_FILES.items():
        (wasm / name).write_bytes(data)
    return web


def run(web: Path, url: str, *extra: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(SCRIPT),
         "-WebDir", str(web), "-ModelUrl", url, *extra],
        capture_output=True, text=True, timeout=120, env=dict(os.environ),
    )


def model(web: Path) -> Path:
    return web / "public" / "models" / "hand_landmarker.task"


def leftovers(web: Path) -> list[str]:
    models = web / "public" / "models"
    return sorted(p.name for p in models.iterdir() if p.name != "hand_landmarker.task") if models.exists() else []


def test_copies_the_wasm_files_and_downloads_the_model(web, server):
    s = server()
    r = run(web, s.url)
    assert r.returncode == 0, r.stdout + r.stderr
    dest = web / "public" / "mediapipe" / "wasm"
    assert {p.name: p.read_bytes() for p in dest.iterdir()} == WASM_FILES
    assert model(web).read_bytes() == MODEL_BYTES
    assert s.hits == 1
    assert leftovers(web) == []
    assert "3 files" in r.stdout


def test_an_existing_model_is_not_downloaded_again(web, server):
    s = server()
    model(web).parent.mkdir(parents=True)
    model(web).write_bytes(b"already here")
    r = run(web, s.url)
    assert r.returncode == 0, r.stdout + r.stderr
    assert s.hits == 0
    assert model(web).read_bytes() == b"already here"
    assert "already" in r.stdout
    assert (web / "public" / "mediapipe" / "wasm" / "vision_wasm_internal.wasm").exists()


def test_an_empty_model_file_counts_as_missing(web, server):
    s = server()
    model(web).parent.mkdir(parents=True)
    model(web).write_bytes(b"")
    r = run(web, s.url)
    assert r.returncode == 0, r.stdout + r.stderr
    assert s.hits == 1
    assert model(web).read_bytes() == MODEL_BYTES


def test_force_downloads_again(web, server):
    s = server()
    model(web).parent.mkdir(parents=True)
    model(web).write_bytes(b"old")
    r = run(web, s.url, "-Force")
    assert r.returncode == 0, r.stdout + r.stderr
    assert s.hits == 1
    assert model(web).read_bytes() == MODEL_BYTES


def test_refuses_without_node_modules_and_downloads_nothing(tmp_path, server):
    s = server()
    web = tmp_path / "web"
    web.mkdir()
    r = run(web, s.url)
    assert r.returncode == 1
    assert "npm --prefix web ci" in r.stdout
    assert s.hits == 0
    assert not (web / "public").exists()


def test_a_failed_download_leaves_no_model_file(web, server):
    s = server("404")
    r = run(web, s.url)
    assert r.returncode == 1
    assert "FAILED" in r.stdout
    assert not model(web).exists()
    assert leftovers(web) == []


def test_a_truncated_download_leaves_no_model_file(web, server):
    s = server("truncated")
    r = run(web, s.url)
    assert r.returncode == 1, r.stdout + r.stderr
    assert not model(web).exists()
    assert leftovers(web) == []


def test_a_failed_download_keeps_an_existing_model_when_forced(web, server):
    s = server("404")
    model(web).parent.mkdir(parents=True)
    model(web).write_bytes(b"keep me")
    r = run(web, s.url, "-Force")
    assert r.returncode == 1
    assert model(web).read_bytes() == b"keep me"
    assert leftovers(web) == []


def test_the_default_url_is_the_pinned_official_one():
    text = SCRIPT.read_text(encoding="ascii")  # 5.1 reads a BOM-less script as ANSI: keep it ASCII
    default = re.search(r'\[string\]\$ModelUrl\s*=\s*"([^"]+)"', text)
    assert default and default.group(1) == OFFICIAL_URL
    # the same URL the asset plan and the README pin (float16/1, not latest)
    assert OFFICIAL_URL in (ROOT / "HAND_INTERACTION_PLAN.md").read_text(encoding="utf-8")
    assert OFFICIAL_URL in (ROOT / "README.md").read_text(encoding="utf-8")
