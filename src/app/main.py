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
from .routers import ask, candidates, chat, corrections, demos, items, organize, phone_scans, photos, pipeline, results, review, robots, rooms, scans, scenes, showcase, teleop, twin


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Room assistant API", lifespan=lifespan)

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


@app.get("/api/health")
def health():
    return {"status": "ok"}
