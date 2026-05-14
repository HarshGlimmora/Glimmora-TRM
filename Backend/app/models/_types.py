"""Shared column helpers for the SQLite-translated schema.

* ``new_uuid()`` produces a canonical 36-char UUID4 string — used as default for PK columns.
* ``utcnow_iso()`` produces a UTC ISO-8601 string matching the SQL DEFAULT in 0001_initial.sql.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone


def new_uuid() -> str:
    return str(uuid.uuid4())


def utcnow_iso() -> str:
    # Matches SQLite's strftime('%Y-%m-%dT%H:%M:%fZ', 'now') format.
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"
