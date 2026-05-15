"""Vercel serverless entrypoint that mounts the FastAPI app from ../../Backend.

Vercel's @vercel/python runtime detects a module-level `app` (ASGI callable)
and serves it for every request routed here by vercel.json's `rewrites`.

The Backend tree is bundled into the deployment via `includeFiles` in
vercel.json — at runtime we add its absolute path to sys.path so
`from app.main import app` resolves the FastAPI instance defined in
Backend/app/main.py.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


# Resolve <repo-root>/Backend regardless of where Vercel mounts the bundle.
# Layout once bundled:
#   /var/task/api/index.py          <-- this file
#   /var/task/Backend/app/main.py   <-- included via includeFiles
_HERE = Path(__file__).resolve().parent
_CANDIDATES = [
    _HERE.parent / "Backend",          # local: vercel/Backend (when copied)
    _HERE.parent.parent / "Backend",   # local dev: <repo>/Backend
    Path("/var/task/Backend"),         # Vercel bundle root
]
for _p in _CANDIDATES:
    if _p.is_dir():
        sys.path.insert(0, str(_p))
        os.environ.setdefault("BACKEND_ROOT", str(_p))
        break

# Force the SQLite data dir into /tmp on Vercel — the rest of the filesystem
# is read-only. Real deployments should set DATABASE_BACKEND=supabase and
# SUPABASE_DB_URL so this fallback is never exercised.
if os.environ.get("VERCEL") == "1":
    os.environ.setdefault("DB_PATH", "/tmp/glimmora.db")

from app.main import app  # noqa: E402  -- import after sys.path mutation

# Vercel's Python runtime auto-detects ASGI when a top-level `app` is exposed.
__all__ = ["app"]
