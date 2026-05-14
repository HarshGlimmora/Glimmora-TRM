"""Reset the local DB and rebuild it from migrations.

For DATABASE_BACKEND=sqlite this deletes data/app.db (+ WAL/SHM) and re-runs migrations.
For DATABASE_BACKEND=supabase this is intentionally NOT supported — we never wipe a
remote database from a script. Drop / recreate the project from the Supabase dashboard
or run a targeted migration instead.

Usage:
    python -m scripts.reset_db
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import DatabaseBackend, get_settings  # noqa: E402
from app.db.init_db import init_database  # noqa: E402


def main() -> None:
    settings = get_settings()
    if settings.database_backend is DatabaseBackend.supabase:
        sys.exit("Refusing to wipe Supabase from a script. Use the Supabase dashboard.")
    for suffix in ("", "-wal", "-shm"):
        candidate = settings.db_path.with_name(settings.db_path.name + suffix)
        if candidate.exists():
            candidate.unlink()
            print(f"Removed {candidate}")
    init_database()
    print(f"Re-created DB at {settings.db_path}")


if __name__ == "__main__":
    main()
