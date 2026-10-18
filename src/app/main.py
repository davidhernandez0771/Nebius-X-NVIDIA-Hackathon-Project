"""FastAPI app: mounts routers, initializes the SQLite schema on startup.

Run with:
    uv run uvicorn app.main:app --reload --app-dir src
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import init_db
from .routers import candidates, chat, demos, items, organize, phone_scans, photos, results, robots, rooms, scans, teleop


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Room assistant API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],  # the Vite dev server, by either name
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
app.include_router(teleop.router)
app.include_router(demos.router)
app.include_router(demos.jobs_router)
app.include_router(results.router)
app.include_router(robots.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
