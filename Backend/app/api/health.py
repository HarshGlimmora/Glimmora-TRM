from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import DatabaseBackend, Settings, get_settings
from app.db.migrations.runner import list_status
from app.db.session import get_db

router = APIRouter(tags=["meta"])


@router.get("/health")
def health(db: Session = Depends(get_db), settings: Settings = Depends(get_settings)) -> dict:
    """Liveness + DB reachability check. Also reports backend + migration state."""
    db.execute(text("SELECT 1"))
    migrations = list(list_status(settings))
    applied = [m for m in migrations if m["applied"]]
    pending = [m for m in migrations if not m["applied"]]

    target = (
        settings.db_path.as_posix()
        if settings.database_backend is DatabaseBackend.sqlite
        else "supabase"  # full DSN intentionally not exposed
    )
    return {
        "status": "ok",
        "env": settings.env,
        "backend": settings.database_backend.value,
        "target": target,
        "migrations": {
            "applied": len(applied),
            "pending": len(pending),
            "latest_applied": applied[-1]["filename"] if applied else None,
        },
    }
