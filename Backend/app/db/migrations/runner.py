"""Backend-aware, forward-only SQL migration runner.

Boot semantics (matches the user's "create new schema if no db, migrate if behind" requirement):

1. Pick the migration directory based on the configured backend
   (``sql/sqlite/`` for SQLite, ``sql/postgres/`` for Supabase).
2. Open a connection (sqlite3 for SQLite, psycopg for Supabase).
3. Create ``schema_migrations`` if missing.
4. Read every ``*.sql`` file in that directory, ordered by the leading numeric prefix.
5. Apply each migration whose version > MAX(version) already recorded, inside a transaction.
6. Record the version + filename + applied_at on success.

A "new" database walks through all migrations; an existing database only runs the pending tail.
No down-migrations, no Alembic-style autogeneration. Hand-write each new file as
``NNNN_short_name.sql`` and the runner picks it up on next start.
"""

from __future__ import annotations

import logging
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from app.config import DatabaseBackend, Settings

logger = logging.getLogger(__name__)

SQL_ROOT = Path(__file__).resolve().parent / "sql"
FILENAME_RE = re.compile(r"^(\d{4})_[A-Za-z0-9_]+\.sql$")


@dataclass(frozen=True)
class Migration:
    version: int
    filename: str
    path: Path

    def read_sql(self) -> str:
        return self.path.read_text(encoding="utf-8")


# ---------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------


def _migration_dir(backend: DatabaseBackend) -> Path:
    return SQL_ROOT / backend.value


def _discover_migrations(backend: DatabaseBackend) -> list[Migration]:
    directory = _migration_dir(backend)
    if not directory.exists():
        return []
    found: list[Migration] = []
    for entry in sorted(directory.iterdir()):
        if not entry.is_file():
            continue
        match = FILENAME_RE.match(entry.name)
        if not match:
            logger.warning("Skipping migration file with unexpected name: %s", entry.name)
            continue
        found.append(Migration(version=int(match.group(1)), filename=entry.name, path=entry))
    seen = {m.version for m in found}
    if len(seen) != len(found):
        raise RuntimeError(f"Duplicate migration version numbers in {directory}")
    return found


# ---------------------------------------------------------------------
# Backend-specific connection helpers
# ---------------------------------------------------------------------


def _connect_sqlite(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)

    def _regexp(pattern, value):
        if value is None:
            return None
        return 1 if re.search(pattern, str(value)) else 0

    conn.create_function("REGEXP", 2, _regexp, deterministic=True)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _connect_postgres(dsn: str):
    try:
        import psycopg
    except ImportError as e:
        raise RuntimeError(
            "DATABASE_BACKEND=supabase requires the `psycopg` driver. "
            "Run `pip install -r requirements.txt`."
        ) from e
    # SQLAlchemy uses 'postgresql+psycopg://...' but psycopg.connect expects the raw URL.
    raw = dsn.replace("postgresql+psycopg://", "postgresql://", 1)
    return psycopg.connect(raw, autocommit=False)


def _connect(settings: Settings):
    if settings.database_backend is DatabaseBackend.sqlite:
        return _connect_sqlite(settings.db_path), DatabaseBackend.sqlite
    assert settings.supabase_db_url is not None
    return _connect_postgres(settings.supabase_db_url), DatabaseBackend.supabase


# ---------------------------------------------------------------------
# Migration table + execution
# ---------------------------------------------------------------------


def _ensure_tracking_table(conn, backend: DatabaseBackend) -> None:
    if backend is DatabaseBackend.sqlite:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version    INTEGER PRIMARY KEY,
                filename   TEXT NOT NULL,
                applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            )
            """
        )
    else:
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version    INTEGER PRIMARY KEY,
                filename   TEXT NOT NULL,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.close()
    conn.commit()


def _applied_versions(conn, backend: DatabaseBackend) -> set[int]:
    if backend is DatabaseBackend.sqlite:
        rows = conn.execute("SELECT version FROM schema_migrations").fetchall()
    else:
        cur = conn.cursor()
        cur.execute("SELECT version FROM schema_migrations")
        rows = cur.fetchall()
        cur.close()
    return {row[0] for row in rows}


def _execute_script(conn, backend: DatabaseBackend, sql: str) -> None:
    """Run a multi-statement migration as one atomic batch."""
    if backend is DatabaseBackend.sqlite:
        # sqlite3.executescript auto-commits and resets transactions, so wrap manually.
        conn.execute("BEGIN")
        conn.executescript(sql)
    else:
        # psycopg can run multi-statement SQL via a single cursor.execute().
        # We're already inside an implicit transaction (autocommit=False).
        cur = conn.cursor()
        try:
            cur.execute(sql)
        finally:
            cur.close()


def _record_applied(conn, backend: DatabaseBackend, m: Migration) -> None:
    if backend is DatabaseBackend.sqlite:
        conn.execute(
            "INSERT INTO schema_migrations (version, filename) VALUES (?, ?)",
            (m.version, m.filename),
        )
    else:
        cur = conn.cursor()
        try:
            cur.execute(
                "INSERT INTO schema_migrations (version, filename) VALUES (%s, %s)",
                (m.version, m.filename),
            )
        finally:
            cur.close()


# ---------------------------------------------------------------------
# Public entry points
# ---------------------------------------------------------------------


def apply_migrations(settings: Settings) -> list[Migration]:
    """Apply any pending migrations for the configured backend. Returns the list that ran."""
    migrations = _discover_migrations(settings.database_backend)
    if not migrations:
        logger.info(
            "No migration files found at %s; skipping.",
            _migration_dir(settings.database_backend),
        )
        return []

    conn, backend = _connect(settings)
    applied: list[Migration] = []
    try:
        _ensure_tracking_table(conn, backend)
        already = _applied_versions(conn, backend)

        pending = [m for m in migrations if m.version not in already]
        if not pending:
            logger.info(
                "Database (%s) is up to date (%d migrations applied).",
                backend.value,
                len(already),
            )
            return []

        logger.info(
            "Applying %d migration(s) on %s backend (already at %d).",
            len(pending),
            backend.value,
            max(already) if already else 0,
        )

        for migration in pending:
            logger.info("Running migration %04d (%s)...", migration.version, migration.filename)
            try:
                _execute_script(conn, backend, migration.read_sql())
                _record_applied(conn, backend, migration)
                conn.commit()
            except Exception:
                conn.rollback()
                logger.exception("Migration %s failed; rolled back.", migration.filename)
                raise
            applied.append(migration)
    finally:
        conn.close()

    logger.info("Applied %d migration(s).", len(applied))
    return applied


def list_status(settings: Settings) -> Iterable[dict[str, Any]]:
    migrations = _discover_migrations(settings.database_backend)
    conn, backend = _connect(settings)
    try:
        _ensure_tracking_table(conn, backend)
        applied = _applied_versions(conn, backend)
    finally:
        conn.close()
    for m in migrations:
        yield {"version": m.version, "filename": m.filename, "applied": m.version in applied}
