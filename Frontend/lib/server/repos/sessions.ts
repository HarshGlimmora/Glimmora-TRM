import "server-only";
import { query } from "@/lib/server/db/client";

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  remember_me: boolean;
  user_agent: string | null;
  ip_address: string | null;
  issued_at: string;
  expires_at: string;
  last_seen_at: string;
  revoked_at: string | null;
}

const COLS = `id, user_id, token_hash, remember_me, user_agent, ip_address,
  issued_at, expires_at, last_seen_at, revoked_at`;

export const sessionsRepo = {
  async create(args: {
    userId: string;
    tokenHash: string;
    rememberMe: boolean;
    ttlMs: number;
    userAgent?: string | null;
    ipAddress?: string | null;
  }): Promise<SessionRow> {
    const r = await query<SessionRow>(
      `INSERT INTO sessions(user_id, token_hash, remember_me, expires_at, user_agent, ip_address)
       VALUES($1, $2, $3, NOW() + ($4 || ' milliseconds')::interval, $5, $6)
       RETURNING ${COLS}`,
      [
        args.userId,
        args.tokenHash,
        args.rememberMe,
        String(args.ttlMs),
        args.userAgent ?? null,
        args.ipAddress ?? null,
      ],
    );
    const row = r.rows[0];
    if (!row) throw new Error("Session insert returned no row");
    return row;
  },

  async findLiveByTokenHash(tokenHash: string): Promise<SessionRow | null> {
    const r = await query<SessionRow>(
      `SELECT ${COLS} FROM sessions
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
      [tokenHash],
    );
    return r.rows[0] ?? null;
  },

  async touch(sessionId: string): Promise<void> {
    await query("UPDATE sessions SET last_seen_at = NOW() WHERE id = $1", [sessionId]);
  },

  async revoke(sessionId: string): Promise<void> {
    await query(
      "UPDATE sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL",
      [sessionId],
    );
  },

  async revokeAllForUser(userId: string): Promise<void> {
    await query(
      "UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL",
      [userId],
    );
  },
};
