import re
from typing import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.config import DatabaseBackend, get_settings


_settings = get_settings()


def _build_engine():
    if _settings.database_backend is DatabaseBackend.sqlite:
        # `check_same_thread=False` is required for FastAPI's threadpool usage of sync SQLAlchemy.
        return create_engine(
            _settings.database_url,
            echo=_settings.db_echo,
            future=True,
            connect_args={"check_same_thread": False},
        )
    # Supabase / Postgres: psycopg v3 via SQLAlchemy.
    return create_engine(
        _settings.database_url,
        echo=_settings.db_echo,
        future=True,
        pool_pre_ping=True,
    )


engine = _build_engine()


if _settings.database_backend is DatabaseBackend.sqlite:

    @event.listens_for(engine, "connect")
    def _sqlite_on_connect(dbapi_conn, _):
        """Per-connection setup for SQLite: foreign keys, WAL, and a REGEXP function.

        SCHEMA.md uses Postgres `~` regex CHECKs. SQLite has no built-in REGEXP, but the
        `REGEXP` operator dispatches to a function of that name if one is registered.
        Registering it here makes the CHECK constraints in sql/sqlite/0001_initial.sql work.
        """
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys = ON")
        cursor.execute("PRAGMA journal_mode = WAL")
        cursor.execute("PRAGMA synchronous = NORMAL")
        cursor.close()

        def _regexp(pattern: str, value):
            if value is None:
                return None
            return 1 if re.search(pattern, str(value)) else 0

        dbapi_conn.create_function("REGEXP", 2, _regexp, deterministic=True)


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db() -> Iterator[Session]:
    """FastAPI dependency: yields a SQLAlchemy session and closes it after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
