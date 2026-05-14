/**
 * Repository for `consultant_invite_codes` — the 5-digit game-ID-style
 * codes a CA shares with prospective clients. Each CA has at most one
 * *active* code at a time (uq_invite_active_per_consultant in 0005);
 * rotating issues a new row and revokes the old one.
 *
 * The code is also stored as a sha256 hash so a future feature can look
 * up by hash without exposing the plaintext column in joins/logs. We
 * still keep the plaintext for the consultant's own dashboard so they
 * can read it back without a decryption step.
 */
import "server-only";
import { query, withTransaction, type DbClient } from "@/lib/server/db/client";
import { sha256Hex } from "@/lib/server/auth/hash";

export interface InviteCodeRow {
  id: string;
  consultant_id: string;
  code: string;
  code_hash: string;
  label: string | null;
  max_uses: number;
  used_count: number;
  status: "active" | "revoked";
  default_access_mode: "full_access" | "review_edit";
  allowed_tax_years: string[] | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

const COLS = `id, consultant_id, code, code_hash, label, max_uses, used_count,
  status, default_access_mode, allowed_tax_years, expires_at, revoked_at, created_at`;

const FIVE_DIGIT_RE = /^\d{5}$/;

export function isValidInviteCode(code: string): boolean {
  return FIVE_DIGIT_RE.test(code);
}

function randomFiveDigit(): string {
  // 00000–99999 inclusive. crypto.randomInt gives [min, max), so [0, 100000).
  const n = require("node:crypto").randomInt(0, 100_000) as number;
  return String(n).padStart(5, "0");
}

export const consultantInvitesRepo = {
  /**
   * Return the consultant's currently-active code, or null. There can be
   * at most one (enforced by uq_invite_active_per_consultant).
   */
  async getActiveForConsultant(consultantId: string): Promise<InviteCodeRow | null> {
    const r = await query<InviteCodeRow>(
      `SELECT ${COLS} FROM consultant_invite_codes
       WHERE consultant_id = $1 AND status = 'active'
       LIMIT 1`,
      [consultantId],
    );
    return r.rows[0] ?? null;
  },

  /**
   * Issue a fresh 5-digit code for a consultant. Idempotent: if the CA
   * already has an active code, returns it. Otherwise generates a new
   * one with retries on the (very rare) global collision.
   */
  async getOrIssue(args: {
    consultantId: string;
    accessMode?: "full_access" | "review_edit";
    label?: string | null;
    maxUses?: number;
  }): Promise<InviteCodeRow> {
    const existing = await this.getActiveForConsultant(args.consultantId);
    if (existing) return existing;
    return this.issue(args);
  },

  /**
   * Force-issue a new code. Revokes any existing active code first so
   * the unique partial index doesn't fire. Up to 8 retry attempts to
   * dodge a `uq_invite_code_hash` collision.
   */
  async issue(args: {
    consultantId: string;
    accessMode?: "full_access" | "review_edit";
    label?: string | null;
    maxUses?: number;
    client?: DbClient;
  }): Promise<InviteCodeRow> {
    return withTransaction(async (client) => {
      // Revoke any current active code (rotation case).
      await client.query(
        `UPDATE consultant_invite_codes
         SET status = 'revoked', revoked_at = NOW()
         WHERE consultant_id = $1 AND status = 'active'`,
        [args.consultantId],
      );

      const mode = args.accessMode ?? "review_edit";
      const label = args.label ?? null;
      const maxUses = args.maxUses ?? 1000;

      for (let attempt = 0; attempt < 8; attempt += 1) {
        const code = randomFiveDigit();
        const codeHash = sha256Hex(code);
        try {
          // expires_at is NOT NULL in the original schema. We don't want a
          // game-ID-style code to silently rot, so set a 5-year horizon and
          // let the CA rotate (POST /api/consultants/my-code) whenever
          // they want a fresh one.
          const r = await client.query<InviteCodeRow>(
            `INSERT INTO consultant_invite_codes(
                consultant_id, code, code_hash, label, max_uses, status,
                default_access_mode, expires_at
             )
             VALUES($1, $2, $3, $4, $5, 'active', $6, NOW() + INTERVAL '5 years')
             RETURNING ${COLS}`,
            [args.consultantId, code, codeHash, label, maxUses, mode],
          );
          const row = r.rows[0];
          if (!row) throw new Error("Invite code insert returned no row");
          return row;
        } catch (err) {
          const e = err as { code?: string; constraint?: string };
          // 23505 = unique_violation. uq_invite_code_hash means we hit an
          // already-issued code; loop and try another.
          if (e.code === "23505" && e.constraint === "uq_invite_code_hash") {
            continue;
          }
          throw err;
        }
      }
      throw new Error("Could not generate a unique 5-digit invite code after 8 attempts");
    });
  },

  /**
   * Look up an active code. Only returns the row if the code is exactly
   * 5 digits, has status='active', is not past expiry, and still has
   * remaining uses.
   */
  async findRedeemable(code: string): Promise<InviteCodeRow | null> {
    if (!isValidInviteCode(code)) return null;
    const r = await query<InviteCodeRow>(
      `SELECT ${COLS} FROM consultant_invite_codes
       WHERE code = $1
         AND status = 'active'
         AND (expires_at IS NULL OR expires_at > NOW())
         AND used_count < max_uses
       LIMIT 1`,
      [code],
    );
    return r.rows[0] ?? null;
  },

  async incrementUseCount(id: string, client?: DbClient): Promise<void> {
    const text = `UPDATE consultant_invite_codes SET used_count = used_count + 1 WHERE id = $1`;
    const params: unknown[] = [id];
    if (client) await client.query(text, params);
    else await query(text, params);
  },
};
