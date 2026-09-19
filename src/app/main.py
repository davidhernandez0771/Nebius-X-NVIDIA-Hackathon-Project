"""FastAPI app: mounts routers, initializes the SQLite schema on startup.

Run with:
    uv run uvicorn app.main:app --reload --app-dir src
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import init_db
from .routers import candidates, chat, items, organize, photos, rooms, scans


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Room assistant API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # the Vite dev server
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(rooms.router)
app.include_router(scans.router)
app.include_router(photos.router)
app.include_router(candidates.router)
app.include_router(items.router)
app.include_router(organize.router)
app.include_router(chat.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
