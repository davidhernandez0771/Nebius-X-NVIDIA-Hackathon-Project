"""Client for the Reali3 photogrammetry API (reali3.net): reconstructs a real
GLB mesh from a batch of ordinary photos of a room, as opposed to the vision
module's per-photo item-recognition calls -- this is genuine multi-photo 3D
reconstruction (structure-from-motion), not LLM inference, so it's its own
small client rather than going through nebius_llm. Costs real money per
reconstruction (see routers/phone_scans.py for the guardrails around that).

Endpoints verified directly against https://reali3.net/docs as of 2026-09-24
(no REALI3_API_KEY exists yet in this environment, so none of this has been
exercised against the real API -- see README for setup once a key exists).
"""
from __future__ import annotations

import os

import httpx

BASE_URL = os.environ.get("REALI3_BASE_URL") or "https://api.reali3.net/v1"


class Reali3Error(RuntimeError):
    """Raised for any Reali3 failure -- missing config, auth, network, or a
    non-2xx response. Callers map this to HTTP 502, the same convention
    TokenFactoryError gets everywhere else in this codebase."""


def _api_key() -> str:
    key = os.environ.get("REALI3_API_KEY", "").strip()
    if not key:
        raise Reali3Error(
            "REALI3_API_KEY is not set. Sign up at https://reali3.net, generate a key "
            "from the dashboard, and add it to your .env."
        )
    return key


def _raise_for_status(resp: httpx.Response, action: str) -> None:
    try:
        resp.raise_for_status()
    except httpx.HTTPStatusError as error:
        raise Reali3Error(f"Reali3 {action} failed (HTTP {resp.status_code}): {resp.text}") from error


def create_reconstruction(photos: list[tuple[bytes, str, str]]) -> str:
    """photos: list of (data, filename, content_type). Returns the new
    reconstruction's id."""
    files = [("files", (name, data, content_type)) for data, name, content_type in photos]
    try:
        resp = httpx.post(
            f"{BASE_URL}/reconstruction",
            headers={"Authorization": f"Bearer {_api_key()}"},
            files=files,
            timeout=60,
        )
    except httpx.HTTPError as error:
        raise Reali3Error(f"Reali3 request failed: {error}") from error
    _raise_for_status(resp, "reconstruction request")
    return resp.json()["id"]


def get_status(reconstruction_id: str) -> dict:
    """Raw status payload: {status: pending|processing|completed|failed, progress, ...}."""
    try:
        resp = httpx.get(
            f"{BASE_URL}/reconstruction/{reconstruction_id}/status",
            headers={"Authorization": f"Bearer {_api_key()}"},
            timeout=30,
        )
    except httpx.HTTPError as error:
        raise Reali3Error(f"Reali3 request failed: {error}") from error
    _raise_for_status(resp, "status check")
    return resp.json()


def download_model(reconstruction_id: str, file_type: str = "glb") -> bytes:
    """Resolves the time-limited download_url the API hands back, then fetches
    the actual binary from it."""
    try:
        resp = httpx.get(
            f"{BASE_URL}/reconstruction/{reconstruction_id}/download/{file_type}",
            headers={"Authorization": f"Bearer {_api_key()}"},
            timeout=30,
        )
    except httpx.HTTPError as error:
        raise Reali3Error(f"Reali3 request failed: {error}") from error
    _raise_for_status(resp, "download request")
    download_url = resp.json()["download_url"]
    try:
        file_resp = httpx.get(download_url, timeout=60)
    except httpx.HTTPError as error:
        raise Reali3Error(f"Reali3 model download failed: {error}") from error
    _raise_for_status(file_resp, "model download")
    return file_resp.content
