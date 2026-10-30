"""FastAPI app: mounts routers, initializes the SQLite schema on startup.

Run with:
    uv run uvicorn app.main:app --reload --app-dir src
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import cors_origins
from .db import init_db
from .routers import analysis, ask, flow, candidates, chat, corrections, demos, items, organize, phone_scans, photos, pipeline, results, review, robots, rooms, scans, scenes, showcase, teleop, twin


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Room assistant API", lifespan=lifespan)

_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


class OriginGuard:
    """Refuse writes and websockets sent by a browser page from another site (security pass, 2026-10-29).

    CORS hides the answer from a foreign page but doesn't stop a "simple" POST (no preflight) from running, and
    POST /api/photos/{id}/analyze, /api/rooms/{id}/phone-scans and others spend money. A request whose Origin header
    isn't one of cors_origins() gets 403 (a websocket is closed with 1008). No Origin (curl, scripts, the sim and
    teleop clients, tests) passes. Every response also gets X-Content-Type-Options: nosniff."""

    def __init__(self, app, allowed: list[str]):
        self.app, self.allowed = app, frozenset(allowed)

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        origin = next((v.decode("latin-1") for k, v in scope["headers"] if k == b"origin"), None)
        foreign = origin is not None and origin not in self.allowed
        if scope["type"] == "websocket":
            if foreign:
                await send({"type": "websocket.close", "code": 1008})
                return
            return await self.app(scope, receive, send)
        if foreign and scope["method"] not in _SAFE_METHODS:
            body = b'{"detail":"cross-site request refused"}'
            await send({"type": "http.response.start", "status": 403,
                        "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()),
                                    (b"x-content-type-options", b"nosniff")]})
            await send({"type": "http.response.body", "body": body})
            return

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                message.setdefault("headers", [])
                message["headers"] = [*message["headers"], (b"x-content-type-options", b"nosniff")]
            await send(message)

        return await self.app(scope, receive, send_with_headers)


app.add_middleware(OriginGuard, allowed=cors_origins())
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),  # the Vite dev server, by either name (+ SANT_CORS_ORIGINS, local only)
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(rooms.router)
app.include_router(scans.router)
app.include_router(phone_scans.router)
app.include_router(photos.router)
app.include_router(candidates.router)
app.include_router(items.router)
app.include_router(organize.router)
app.include_router(chat.router)
app.include_router(ask.router)
app.include_router(teleop.router)
app.include_router(demos.router)
app.include_router(demos.jobs_router)
app.include_router(review.router)
app.include_router(results.router)
app.include_router(robots.router)
app.include_router(twin.router)
app.include_router(showcase.router)
app.include_router(pipeline.router)  # starting runs is off unless SANT_PIPELINE=1
app.include_router(corrections.router)
app.include_router(scenes.router)
app.include_router(analysis.router)  # live Nemotron runs are off unless SANT_ANALYST_LIVE=1
app.include_router(flow.router)  # GET /flow: the whole pipeline's summary, read-only


@app.get("/api/health")
def health():
    return {"status": "ok"}
