/**
 * Test helpers that talk to Postgres directly.
 *
 * Used by the Playwright API specs in this folder. Lets a test:
 *   - peek the secret_hash of the latest live OTP for a given email
 *   - delete a test user (and their cascades) between specs so each spec
 *     starts from a known state
 *
 * NOTE: The secret is hashed in the DB, so we generate the OTP code in the
 * test, hash it, and write that hash directly into the row — overriding the
 * randomly-generated server-side value. This mirrors what an OTP-aware mock
 * SMS gateway would do; it's strictly a test affordance.
 */
import { Pool } from "pg";
import crypto from "node:crypto";

const DEFAULT_DATABASE_URL = "postgres://glmra:glmra_dev@localhost:5432/glmra";

let pool: Pool | null = null;
function getPool(): Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
    pool = new Pool({ connectionString: url });
  }
  return pool;
}

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Forces the latest live OTP for the given identifier to be `code`. Returns
 * the OTP row id so the test can pass it to verify-otp.
 */
export async function setLatestOtpCode(args: {
  channel: "email" | "mobile";
  destination: string;
  code: string;
}): Promise<string> {
  const purpose = args.channel === "email" ? "signup_email" : "signup_phone";
  const r = await getPool().query<{ id: string }>(
    `UPDATE user_verifications uv
     SET secret_hash = $3,
         attempts = 0
     FROM users u
     WHERE uv.user_id = u.id
       AND uv.purpose = $1
       AND uv.consumed_at IS NULL
       AND uv.expires_at > NOW()
       AND u.${args.channel === "email" ? "email" : "phone"} = $2
     RETURNING uv.id`,
    [purpose, args.destination, sha256Hex(args.code)],
  );
  const row = r.rows[0];
  if (!row) throw new Error("No live OTP for this destination.");
  return row.id;
}

export async function deleteTestUser(args: {
  channel: "email" | "mobile";
  destination: string;
}): Promise<void> {
  const col = args.channel === "email" ? "email" : "phone";
  await getPool().query(
    `DELETE FROM users WHERE ${col} = $1`,
    [args.destination],
  );
}

export async function userExists(args: {
  channel: "email" | "mobile";
  destination: string;
}): Promise<{ id: string; profile_completed_at: string | null } | null> {
  const col = args.channel === "email" ? "email" : "phone";
  const r = await getPool().query<{ id: string; profile_completed_at: string | null }>(
    `SELECT id, profile_completed_at FROM users WHERE ${col} = $1`,
    [args.destination],
  );
  return r.rows[0] ?? null;
}

export async function countUsersByDestination(args: {
  channel: "email" | "mobile";
  destination: string;
}): Promise<number> {
  const col = args.channel === "email" ? "email" : "phone";
  const r = await getPool().query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM users WHERE ${col} = $1`,
    [args.destination],
  );
  return Number(r.rows[0]?.c ?? "0");
}

export async function countSessionsForUser(userId: string): Promise<number> {
  const r = await getPool().query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
  return Number(r.rows[0]?.c ?? "0");
}

export async function markOnboardingStep(args: {
  userId: string;
  role: "taxpayer" | "consultant";
  step: number;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO onboarding_progress(user_id, role, step)
     VALUES($1, $2, $3)
     ON CONFLICT(user_id) DO UPDATE SET role = EXCLUDED.role, step = EXCLUDED.step`,
    [args.userId, args.role, args.step],
  );
}

export async function markProfileComplete(userId: string): Promise<void> {
  await getPool().query(
    `UPDATE users SET profile_completed_at = COALESCE(profile_completed_at, NOW()),
                     role = COALESCE(role, 'taxpayer'),
                     display_name = COALESCE(display_name, 'Test User')
     WHERE id = $1`,
    [userId],
  );
}

export async function shutdown(): Promise<void> {
  if (pool) await pool.end();
  pool = null;
}
