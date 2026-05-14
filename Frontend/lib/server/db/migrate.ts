/**
 * Forward-only SQL migration runner that works against either driver:
 *
 *   - pg (Postgres / Supabase): uses pg_advisory_lock so multiple boots
 *     don't race
 *   - PGlite (embedded): the in-process lock in client.ts already
 *     serialises everything, so no advisory lock needed
 *
 * Reads the same `Backend/app/db/migrations/sql/postgres/` files the
 * Python runner reads. State lives in `schema_migrations`, shared with
 * whichever runner reaches the DB first.
 */
import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { activeDriver, execMultiStatement, query } from "./client";

const ADVISORY_LOCK_KEY = 8131347612n;

async function migrationsDir(): Promise<string> {
  const cwd = process.cwd();
  const candidates = [
    path.resolve(cwd, "..", "Backend", "app", "db", "migrations", "sql", "postgres"),
    path.resolve(cwd, "Backend", "app", "db", "migrations", "sql", "postgres"),
    process.env.MIGRATIONS_DIR ?? "",
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      await fs.stat(c);
      return c;
    } catch {
      /* keep trying */
    }
  }
  throw new Error(
    `Migrations directory not found. Tried:\n  ${candidates.join("\n  ")}\n` +
      `Set MIGRATIONS_DIR to override.`,
  );
}

interface MigrationFile {
  version: string;
  filename: string;
  fullPath: string;
}

async function listFiles(): Promise<MigrationFile[]> {
  const dir = await migrationsDir();
  const entries = await fs.readdir(dir);
  return entries
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((filename) => {
      const m = /^(\d{4})_/.exec(filename);
      if (!m) {
        throw new Error(
          `Migration filename "${filename}" must start with NNNN_ (four digits).`,
        );
      }
      return {
        version: m[1]!,
        filename,
        fullPath: path.join(dir, filename),
      };
    });
}

async function ensureLedger(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    VARCHAR(16) PRIMARY KEY,
      filename   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function appliedVersions(): Promise<Set<string>> {
  const res = await query<{ version: string }>(
    "SELECT version FROM schema_migrations",
  );
  return new Set(res.rows.map((r) => r.version));
}

async function acquireAdvisoryLock(): Promise<void> {
  if (activeDriver() === "pg") {
    await query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
  }
  // PGlite serialises through the in-process lock; nothing to do.
}

async function releaseAdvisoryLock(): Promise<void> {
  if (activeDriver() === "pg") {
    try {
      await query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
    } catch {
      /* connection may be dead */
    }
  }
}

let runOncePromise: Promise<{ applied: number; pending: number }> | null = null;

export function runMigrations(): Promise<{ applied: number; pending: number }> {
  if (!runOncePromise) {
    runOncePromise = (async () => {
      let appliedCount = 0;
      try {
        await acquireAdvisoryLock();
        await ensureLedger();
        const files = await listFiles();
        const already = await appliedVersions();

        for (const f of files) {
          if (already.has(f.version)) continue;
          const sql = await fs.readFile(f.fullPath, "utf8");
          try {
            await execMultiStatement(sql);
            await query(
              "INSERT INTO schema_migrations(version, filename) VALUES($1, $2)",
              [f.version, f.filename],
            );
            appliedCount += 1;
            console.log(`[migrate] applied ${f.filename}`);
          } catch (err) {
            throw new Error(
              `Migration ${f.filename} failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        return {
          applied: appliedCount,
          pending: files.length - already.size - appliedCount,
        };
      } finally {
        await releaseAdvisoryLock();
      }
    })().catch((err) => {
      runOncePromise = null;
      throw err;
    });
  }
  return runOncePromise;
}
