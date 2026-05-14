import "server-only";
import { query, type DbClient } from "@/lib/server/db/client";

export interface GrantRow {
  id: string;
  consultant_id: string;
  target_user_id: string;
  origin: "directory_request" | "invite_code";
  access_mode: "full_access" | "review_edit";
  status: "pending" | "active" | "rejected" | "revoked" | "expired";
  tax_years: string[];
  message: string | null;
  requested_at: string;
  decided_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface GrantWithCounterparty extends GrantRow {
  counterparty_name: string | null;
  counterparty_display_name: string | null;
  counterparty_pan: string | null;
  counterparty_firm: string | null;
}

const COLS = `id, consultant_id, target_user_id, origin, access_mode, status,
  tax_years, message, requested_at, decided_at, revoked_at, expires_at, created_at`;

export const caGrantsRepo = {
  async create(args: {
    consultantId: string;
    targetUserId: string;
    accessMode: "full_access" | "review_edit";
    taxYears: string[];
    message?: string;
    origin: "directory_request" | "invite_code";
    status?: "pending" | "active";
    expiresAt?: string | null;
  }): Promise<GrantRow> {
    // Default the status in JS rather than via `COALESCE($5, 'pending')` in
    // SQL — PG would have to coerce the literal to the grant_status enum
    // and PGlite refuses (42804). Always passing a non-null status keeps
    // the bind list trivially typed.
    const status = args.status ?? "pending";
    const r = await query<GrantRow>(
      `INSERT INTO consultant_access_grants(
          consultant_id, target_user_id, origin, access_mode, status,
          tax_years, message, expires_at
       )
       VALUES($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${COLS}`,
      [
        args.consultantId,
        args.targetUserId,
        args.origin,
        args.accessMode,
        status,
        args.taxYears,
        args.message ?? null,
        args.expiresAt ?? null,
      ],
    );
    const row = r.rows[0];
    if (!row) throw new Error("Grant insert returned no row");
    return row;
  },

  async findLiveBetween(
    consultantId: string,
    taxpayerId: string,
    client?: DbClient,
  ): Promise<GrantRow | null> {
    const text = `SELECT ${COLS} FROM consultant_access_grants
       WHERE consultant_id = $1 AND target_user_id = $2
         AND status IN ('pending', 'active')`;
    const params = [consultantId, taxpayerId];
    const r = client
      ? await client.query<GrantRow>(text, params)
      : await query<GrantRow>(text, params);
    return r.rows[0] ?? null;
  },

  async listForUser(userId: string): Promise<GrantWithCounterparty[]> {
    const r = await query<GrantWithCounterparty>(
      `SELECT g.${COLS.split(",").map((c) => c.trim()).join(", g.")},
              u.name AS counterparty_name,
              u.display_name AS counterparty_display_name,
              u.pan  AS counterparty_pan,
              NULL::text AS counterparty_firm
       FROM consultant_access_grants g
       JOIN users u ON u.id = CASE WHEN g.consultant_id = $1 THEN g.target_user_id ELSE g.consultant_id END
       WHERE g.consultant_id = $1 OR g.target_user_id = $1
       ORDER BY g.requested_at DESC`,
      [userId],
    );
    return r.rows;
  },

  async updateStatus(args: {
    id: string;
    status: "active" | "rejected" | "revoked";
  }): Promise<GrantRow | null> {
    const decided = args.status === "active" || args.status === "rejected";
    const revoked = args.status === "revoked";
    const r = await query<GrantRow>(
      `UPDATE consultant_access_grants
       SET status = $2,
           decided_at = CASE WHEN $3::bool AND decided_at IS NULL THEN NOW() ELSE decided_at END,
           revoked_at = CASE WHEN $4::bool THEN NOW() ELSE revoked_at END
       WHERE id = $1
       RETURNING ${COLS}`,
      [args.id, args.status, decided, revoked],
    );
    return r.rows[0] ?? null;
  },
};
