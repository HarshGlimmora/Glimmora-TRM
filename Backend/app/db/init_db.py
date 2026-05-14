"""DB bootstrap: invoked once at FastAPI startup.

Behavior (matches the user's "check SQLite first, then Supabase" intent — explicit via env):
    DATABASE_BACKEND=sqlite   -> local file at db_path; runs sql/sqlite/ migrations.
    DATABASE_BACKEND=supabase -> Postgres at supabase_db_url; runs sql/postgres/ migrations.

If the target DB is empty/new, all migrations run. If it already has some applied,
only pending ones run.
"""

from __future__ import annotations

import logging

from app.config import DatabaseBackend, get_settings
from app.db.migrations.runner import apply_migrations

logger = logging.getLogger(__name__)


def init_database() -> None:
    settings = get_settings()
    if settings.database_backend is DatabaseBackend.sqlite:
        fresh = not settings.db_path.exists()
        if fresh:
            logger.info("No SQLite database at %s; bootstrapping from migrations.", settings.db_path)
        apply_migrations(settings)
        if fresh:
            logger.info("Bootstrapped new SQLite database at %s.", settings.db_path)
    else:
        logger.info("Connecting to Supabase Postgres and applying pending migrations.")
        apply_migrations(settings)
