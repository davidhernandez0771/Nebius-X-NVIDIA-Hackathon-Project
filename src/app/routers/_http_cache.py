"""Conditional GET for the read-only JSON routes (/analysis, /flow): an ETag over the body and Cache-Control: no-cache,
so a browser revalidates every time (a live run or a new loop stage shows at once) and gets 304 when nothing changed."""
from __future__ import annotations

import hashlib
import json

from fastapi import Request, Response

HEADERS = {"Cache-Control": "no-cache"}


def etag_json(request: Request, body) -> Response:
    raw = json.dumps(body, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
    tag = '"' + hashlib.sha256(raw).hexdigest()[:32] + '"'
    headers = {**HEADERS, "ETag": tag}
    sent = request.headers.get("if-none-match", "")
    if tag in (t.strip() for t in sent.split(",")) or sent.strip() == "*":
        return Response(status_code=304, headers=headers)
    return Response(raw, media_type="application/json", headers=headers)
