"""FastAPI entrypoint.

Run locally:
    uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

The lifespan hook handles DB bootstrap before the first request: if no SQLite file
exists at the configured path, the migration runner creates and populates it; if it
exists, only pending migrations are applied.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Importing the models package registers every mapped class against Base.metadata.
# Useful for tests and tooling. The SQL migrations remain the source of truth.
import app.models  # noqa: F401
from app.api.health import router as health_router
from app.api.v1.documents import router as documents_router
from app.api.v1.filings import router as filings_router
from app.api.v1.workspace import (
    filings_patch_router as workspace_filings_patch_router,
    router as workspace_router,
)
from app.config import get_settings
from app.db.init_db import init_database
from app.db.seed import run_seed


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
)
logger = logging.getLogger("glimmora.backend")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_database()
    run_seed()
    logger.info("Backend ready.")
    yield


settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    debug=settings.debug,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(filings_router)
app.include_router(workspace_router)
app.include_router(workspace_filings_patch_router)
app.include_router(documents_router)


@app.get("/")
def root() -> dict:
    return {"name": settings.app_name, "version": app.version, "docs": "/docs"}
