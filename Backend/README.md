# GlimmoraTax Backend

FastAPI + SQLAlchemy backend for the GlimmoraTax TRM platform. Supports two database backends:

- **SQLite** (default) — local file, zero-config, for development and demos. Uses a
  lossy translation of [`Technical Docs/SCHEMA.md`](../Technical%20Docs/SCHEMA.md)
  (UUID → TEXT, JSONB → TEXT, no pgvector, etc.).
- **Supabase** — cloud Postgres with the full-fidelity schema (pgvector, pg_trgm,
  native enums, JSONB, partial + GIN indexes, append-only audit triggers).

Selection is driven by `DATABASE_BACKEND` in the environment. We do **not** auto-fall-back
between the two; the choice is explicit so dev/CI/prod stay predictable.

## Quick start (SQLite — default)

```powershell
cd Backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env       # optional
uvicorn app.main:app --reload
```

Then open `http://127.0.0.1:8000/docs`. On first boot the lifespan hook creates
`data/app.db` and runs every migration in `app/db/migrations/sql/sqlite/`. Subsequent
boots only apply pending migrations.

## Quick start (Supabase)

1. Create a Supabase project. Make sure **`pgvector`** and **`pg_trgm`** extensions are
   enabled (Database → Extensions). `pgcrypto` is enabled by default.
2. Copy the Postgres connection URI from **Project Settings → Database → Connection
   string → URI** and prefix it with `postgresql+psycopg://`.
3. In `.env`:

   ```env
   DATABASE_BACKEND=supabase
   SUPABASE_DB_URL=postgresql+psycopg://postgres:YOUR_PASSWORD@db.<ref>.supabase.co:5432/postgres
   ```

4. Start the app:

   ```powershell
   uvicorn app.main:app --reload
   ```

   The lifespan hook applies migrations from `app/db/migrations/sql/postgres/` against
   the Supabase project. Pending migrations are detected via the `schema_migrations`
   table (auto-created on first run).

## Layout

```
Backend/
├── app/
│   ├── main.py                # FastAPI + lifespan: runs migrations for the chosen backend
│   ├── config.py              # DATABASE_BACKEND, db_path, supabase_db_url
│   ├── api/
│   │   └── health.py          # /health reports backend + migration state
│   ├── db/
│   │   ├── base.py            # SQLAlchemy DeclarativeBase
│   │   ├── session.py         # Engine + per-backend connect hooks (REGEXP UDF on SQLite)
│   │   ├── init_db.py         # Bootstrap entry
│   │   └── migrations/
│   │       ├── runner.py      # Backend-aware forward-only runner (sqlite3 / psycopg)
│   │       └── sql/
│   │           ├── sqlite/    # Lossy SQLite migrations
│   │           │   └── 0001_initial.sql
│   │           └── postgres/  # Full-fidelity Postgres migrations (Supabase)
│   │               └── 0001_initial.sql
│   └── models/                # SQLAlchemy ORM (shared across backends)
│       ├── enums.py
│       ├── identity.py
│       ├── filing.py
│       ├── documents.py
│       ├── rules.py
│       ├── consultant.py
│       ├── fraud.py
│       └── cross.py
├── data/                      # SQLite file lives here (gitignored)
├── scripts/
│   └── reset_db.py            # Drop + recreate local SQLite (refuses to touch Supabase)
├── requirements.txt
├── .env.example
└── README.md
```

## DB lifecycle

Startup is forward-only and idempotent for both backends:

1. `app/db/init_db.py` is called from the FastAPI lifespan hook.
2. The runner reads `DATABASE_BACKEND` and connects accordingly:
   - **sqlite**: opens `data/app.db` (SQLite creates the file if missing).
   - **supabase**: opens a psycopg connection to `SUPABASE_DB_URL`.
3. `schema_migrations` table is ensured (a tiny `(version, filename, applied_at)` ledger).
4. Every `*.sql` in `app/db/migrations/sql/<backend>/` is sorted by `NNNN_` prefix.
5. Anything whose version isn't already recorded is applied in a single transaction per file.

So a brand-new database walks through all migrations; an existing one only runs the pending tail.

### Adding a new migration

Drop a new SQL file in the relevant `sql/<backend>/` directory named `NNNN_short_name.sql`
(four-digit, monotonically increasing). When you add the SQLite version, add a matching
Postgres version with the same number so the two backends evolve together. Restart the app.

### Resetting locally (SQLite only)

```powershell
python -m scripts.reset_db
```

This refuses to run against Supabase — wipe a remote DB from the dashboard, not a script.

## Translation choices: SQLite vs. Postgres

| Postgres / Supabase                  | SQLite (lossy)                                         |
|--------------------------------------|--------------------------------------------------------|
| `UUID DEFAULT gen_random_uuid()`     | `TEXT`, default from `uuid.uuid4()` in Python          |
| `TIMESTAMPTZ`                        | `TEXT` ISO-8601 UTC                                    |
| `JSONB`                              | `TEXT`, encoded by SQLAlchemy `JSON` type              |
| `NUMERIC(18,2)`                      | `NUMERIC` (REAL/TEXT under the hood)                   |
| `TEXT[]`                             | `TEXT` (JSON array)                                    |
| `INET`                               | `TEXT`                                                 |
| `vector(1536)` (pgvector)            | `TEXT` JSON array; no ANN index                        |
| Custom `ENUM` types                  | `TEXT` + `CHECK (col IN (...))`                        |
| Regex `CHECK` (`col ~ '...'`)        | `REGEXP` function registered on connect                |
| `pg_trgm` GIN indexes                | Dropped — falls back to app-side LIKE/contains         |
| `ivfflat` vector indexes             | Dropped — RAG search performed externally              |
| `BIGSERIAL`                          | `INTEGER PRIMARY KEY AUTOINCREMENT`                    |
| BEFORE UPDATE/DELETE triggers        | SQLite triggers (audit-log block + `updated_at` touch) |

The Postgres migration is the source-of-truth schema (matches SCHEMA.md exactly). The
SQLite migration is the development-time mirror — keep them in lockstep when adding
new migrations.

## Health check

```
GET /health
→ {
    "status": "ok",
    "env": "dev",
    "backend": "sqlite",          // or "supabase"
    "target": "data/app.db",      // or "supabase"
    "migrations": { "applied": 1, "pending": 0, "latest_applied": "0001_initial.sql" }
  }
```
