# Glimmora TRM — Vercel Deployment Folder

This folder is the **single deployment root** for Vercel. It bundles the
Next.js frontend (`../Frontend`) and the FastAPI backend (`../Backend`) into
one Vercel project so the browser only ever talks to one origin.

Nothing in `../Frontend` or `../Backend` was moved or duplicated. This folder
is just configuration + a mirror script + a 30-line Python ASGI wrapper.

The `app/`, `components/`, `lib/`, `middleware.ts`, `postcss.config.mjs`, and
`tailwind.config.ts` entries are **generated**, not committed — a tiny Node
script ([`scripts/mirror-frontend.mjs`](scripts/mirror-frontend.mjs)) builds a
mirror of `../Frontend` using real directories and per-file symlinks. It runs
automatically on `npm run dev` (`predev`) and `npm run build` (`prebuild`), so
edits in `../Frontend` are reflected instantly via the file symlinks.

> Why per-file symlinks instead of `app -> ../Frontend/app`? Next.js's app
> router refuses to register routes whose real path falls outside the
> configured app directory — so a parent-dir symlink at the top of `app/`
> causes every page to 404. Real dirs + file symlinks side-step that scan
> check while still avoiding code duplication.

---

## How it fits together

```
yourapp.vercel.app/
├── /                        ──►  Next.js  (../Frontend/app/page.tsx)
├── /dashboard, /login, …    ──►  Next.js  (../Frontend/app/(app)/**)
├── /api/auth/*, …           ──►  Next.js route handlers
│                                 (../Frontend/app/api/**)
└── /api/v1/*, /health,      ──►  FastAPI serverless (api/index.py)
    /docs, /openapi.json          which imports ../Backend/app/main.py
```

`vercel.json` rewrites send `/api/v1/*`, `/health`, `/docs`, and
`/openapi.json` to `api/index.py`. Everything else falls through to the
Next.js app router.

`backendProxy.ts` (Next.js → FastAPI) auto-resolves the backend URL to
`https://${VERCEL_URL}` when `BACKEND_BASE_URL` is unset, so internal calls
stay on the same deployment.

---

## Centralized env — one file, two runtimes, both contexts

There is **one** `.env`, at the repo root: [`../.env`](../.env). Both apps
read from it:

| Context           | Frontend (Next.js)                              | Backend (FastAPI)                                    |
| ----------------- | ----------------------------------------------- | ---------------------------------------------------- |
| Local dev         | `next.config.mjs` → `loadEnvConfig("..")`       | `app/config.py` → pydantic-settings reads `../.env`  |
| Vercel deploy     | `process.env` from dashboard (file ignored)     | `process.env` from dashboard (file ignored)          |

Add a new key in **one** place (`../.env`) and both runtimes pick it up
locally. For Vercel, paste the same key into the dashboard once and it's
visible to both the Node and Python runtimes.

---

## Deploying — one shot

1. **Push to GitHub.** Vercel needs to read this repo.
2. **Vercel → Add New… → Project → Import this repo.**
3. **Set "Root Directory"** to `vercel`. Framework auto-detects as Next.js.
4. **Environment Variables** — open [`../.env`](../.env) and paste every key
   into Vercel → Settings → Environment Variables (Production + Preview).
   For production, **override** these specific values:
   - `DATABASE_BACKEND=supabase`  (was `sqlite` for local)
   - `SUPABASE_DB_URL=postgresql+psycopg://…`
   - `DATABASE_URL=postgres://…`  (Frontend's PG)
   - `CORS_ORIGINS=["https://your-app.vercel.app"]`
   - `ENV=prod`, `DEBUG=false`
5. **Deploy.** Vercel runs `npm install` + `next build` for the frontend and
   `pip install -r requirements.txt` for the Python function in parallel.

That's it — no `BACKEND_BASE_URL` to set, no preview URL to wire back in.

---

## Hard constraints (don't skip)

- **No SQLite, no PGlite on Vercel.** The filesystem is read-only outside
  `/tmp`, and `/tmp` is wiped between invocations. You must point both apps
  at a real Postgres (Supabase pooler works well).
- **Run Backend migrations once against your Supabase DB** before first
  request — FastAPI's lifespan hook will try, but cold-start timing makes
  it fragile. Easiest: `cd Backend && DATABASE_BACKEND=supabase
  SUPABASE_DB_URL=… python -m scripts.run_migrations` (or whatever your
  Backend's migration runner is).
- **`AUTH_SHARED_SECRET` must be identical** for both runtimes. Setting it
  once in the Vercel dashboard satisfies both.
- **Cold starts.** The Python function imports SQLAlchemy + FastAPI on every
  cold start (~1–2s). For low-latency APIs, consider a paid Vercel plan with
  warmed functions, or move the backend to a long-running service.

---

## Local sanity check (optional)

```bash
cd vercel
npm install
# Refreshes the app/components/lib mirror, then starts Next.js.
npm run dev
```

`npm run dev` only serves the **Next.js** half. The `/api/v1/*` Python routes
are not handled by `next dev` — locally they 404, which is expected. Two ways
to test the full stack locally:

- **Run FastAPI alongside.** `cd ../Backend && uvicorn app.main:app --reload`,
  then in another shell run `npm run dev` here. The Next.js proxy will use
  `BACKEND_BASE_URL=http://127.0.0.1:8000` (default) to forward.
- **Use Vercel CLI.** `npm i -g vercel && vercel dev` mounts both the Next.js
  app and the Python serverless function on the same port (matches prod).

If you add new files inside `../Frontend/app`, restart `npm run dev` so the
mirror script re-runs and creates the new symlinks.
