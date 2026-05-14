/**
 * Database client with a two-way dispatcher:
 *
 *   - DATABASE_URL set → real Postgres via `pg` (production / Supabase)
 *   - DATABASE_URL unset → embedded PGlite (Postgres compiled to WASM) at
 *     ./.data/pglite/  — no docker, no setup, `npm run dev` just works
 *
 * Both code paths expose the same `query()` and `withTransaction()` so the
 * repository layer doesn't care which driver is underneath.
 */
import "server-only";
import path from "node:path";
import fs from "node:fs";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

export interface QueryResultLike<T> {
  rows: T[];
}

/**
 * Minimal client interface shared by `pg.PoolClient` (real Postgres) and
 * PGlite's transaction handle. Repos that take an optional `client` arg
 * use this type so they can run inside either driver's transaction.
 */
export interface DbClient {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<QueryResultLike<T>>;
}

declare global {
  // eslint-disable-next-line no-var
  var __glmra_pg_pool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __glmra_pglite: Promise<PGlite> | undefined;
  // eslint-disable-next-line no-var
  var __glmra_pglite_lock: Promise<unknown> | undefined;
}

const driver: "pg" | "pglite" = process.env.DATABASE_URL ? "pg" : "pglite";

function pgPool(): Pool {
  if (!globalThis.__glmra_pg_pool) {
    globalThis.__glmra_pg_pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PGPOOL_MAX ?? "10"),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: "glmra-next",
    });
    globalThis.__glmra_pg_pool.on("error", (err) => {
      console.error("[pg] idle client error:", err.message);
    });
  }
  return globalThis.__glmra_pg_pool;
}

function pgliteDataDir(): string {
  return path.resolve(process.cwd(), ".data", "pglite");
}

function pglite(): Promise<PGlite> {
  if (!globalThis.__glmra_pglite) {
    const dataDir = pgliteDataDir();
    // PGlite's nodefs uses mkdirSync (non-recursive), so create the parent
    // tree first or the engine throws ENOENT on first launch.
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`[db] starting embedded PGlite at ${dataDir}`);
    globalThis.__glmra_pglite = PGlite.create({
      dataDir,
      extensions: { vector, pg_trgm, pgcrypto },
    });
  }
  return globalThis.__glmra_pglite;
}

/**
 * PGlite is a single-connection in-process database. To keep concurrent
 * route handlers from interleaving queries (and to make transactions
 * actually serialize), we funnel all calls through this lock.
 */
function withPgliteLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = globalThis.__glmra_pglite_lock ?? Promise.resolve();
  const next = prev.then(fn, fn);
  globalThis.__glmra_pglite_lock = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: ReadonlyArray<unknown>,
): Promise<QueryResultLike<T>> {
  if (driver === "pg") {
    return pgPool().query<T>(text, params as unknown[] | undefined);
  }
  const db = await pglite();
  return withPgliteLock(async () => {
    const r = await db.query<T>(text, (params ?? []) as unknown[]);
    return { rows: r.rows };
  });
}

/**
 * Execute a multi-statement SQL string (used by the migration runner).
 * `pg` accepts this through its simple query protocol when there are no
 * placeholders; PGlite has a dedicated `exec` for this.
 */
export async function execMultiStatement(sql: string): Promise<void> {
  if (driver === "pg") {
    const client = await pgPool().connect();
    try {
      await client.query(sql);
    } finally {
      client.release();
    }
    return;
  }
  const db = await pglite();
  await withPgliteLock(async () => {
    await db.exec(sql);
  });
}

export async function withTransaction<T>(
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  if (driver === "pg") {
    const client = await pgPool().connect();
    try {
      await client.query("BEGIN");
      const out = await fn(client as unknown as DbClient);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* connection may already be dead */
      }
      throw err;
    } finally {
      client.release();
    }
  }
  const db = await pglite();
  return withPgliteLock(async () => {
    return db.transaction(async (tx) => {
      const adapter: DbClient = {
        query: async <T extends QueryResultRow = QueryResultRow>(
          text: string,
          params?: ReadonlyArray<unknown>,
        ) => {
          const r = await tx.query<T>(text, (params ?? []) as unknown[]);
          return { rows: r.rows };
        },
      };
      return fn(adapter);
    }) as Promise<T>;
  });
}

/** Currently active driver — exposed for debugging / health checks. */
export function activeDriver(): "pg" | "pglite" {
  return driver;
}

/** Re-export so existing repo files don't need to change their type imports. */
export type { PoolClient };
