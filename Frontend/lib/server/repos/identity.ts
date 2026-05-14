/**
 * Identity repository — users and OTP verifications.
 *
 * All queries are parameterised. Email/mobile are stored normalised
 * (lowercase + 10-digit). The unique partial indexes on `users` (see
 * 0001_initial.sql §5) handle idempotency.
 */
import "server-only";
import { query, withTransaction, type DbClient } from "@/lib/server/db/client";

export interface UserRow {
  id: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  display_name: string | null;
  legal_name: string | null;
  name: string | null;
  email_verified_at: string | null;
  phone_verified_at: string | null;
  pan: string | null;
  pan_verified_at: string | null;
  profile_completed_at: string | null;
  last_login_at: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  created_at: string;
  updated_at: string;
}

const USER_COLS = `id, email, phone, role, display_name, legal_name, name,
  email_verified_at, phone_verified_at, pan, pan_verified_at,
  profile_completed_at, last_login_at, city, state, pincode,
  created_at, updated_at`;

export const usersRepo = {
  async findById(id: string): Promise<UserRow | null> {
    const r = await query<UserRow>(
      `SELECT ${USER_COLS} FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return r.rows[0] ?? null;
  },

  async findByEmail(email: string): Promise<UserRow | null> {
    const r = await query<UserRow>(
      `SELECT ${USER_COLS} FROM users WHERE email = $1 AND deleted_at IS NULL`,
      [email],
    );
    return r.rows[0] ?? null;
  },

  async findByPhone(phone: string): Promise<UserRow | null> {
    const r = await query<UserRow>(
      `SELECT ${USER_COLS} FROM users WHERE phone = $1 AND deleted_at IS NULL`,
      [phone],
    );
    return r.rows[0] ?? null;
  },

  /**
   * Upsert by identifier. Returns the user row plus a flag indicating
   * whether the row was newly created — the caller uses that to write the
   * right audit event (`account_created` vs `login_attempted`).
   */
  async findOrCreateByIdentifier(args: {
    channel: "email" | "mobile";
    identifier: string;
  }): Promise<{ user: UserRow; created: boolean }> {
    return withTransaction(async (client) => {
      const col = args.channel === "email" ? "email" : "phone";
      const existing = await client.query<UserRow>(
        `SELECT ${USER_COLS} FROM users WHERE ${col} = $1 AND deleted_at IS NULL FOR UPDATE`,
        [args.identifier],
      );
      if (existing.rows[0]) {
        return { user: existing.rows[0], created: false };
      }
      const inserted = await client.query<UserRow>(
        `INSERT INTO users(${col}) VALUES($1) RETURNING ${USER_COLS}`,
        [args.identifier],
      );
      const user = inserted.rows[0];
      if (!user) throw new Error("Failed to create user row");
      return { user, created: true };
    });
  },

  async markChannelVerified(args: {
    userId: string;
    channel: "email" | "mobile";
    client?: DbClient;
  }): Promise<void> {
    const col = args.channel === "email" ? "email_verified_at" : "phone_verified_at";
    const text = `UPDATE users SET ${col} = COALESCE(${col}, NOW()), last_login_at = NOW() WHERE id = $1`;
    const params: unknown[] = [args.userId];
    if (args.client) await args.client.query(text, params);
    else await query(text, params);
  },

  async setRole(args: {
    userId: string;
    role: "taxpayer" | "consultant";
    client?: DbClient;
  }): Promise<void> {
    const text = "UPDATE users SET role = $1 WHERE id = $2";
    const params: unknown[] = [args.role, args.userId];
    if (args.client) await args.client.query(text, params);
    else await query(text, params);
  },

  async touchLastLogin(userId: string): Promise<void> {
    await query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [userId]);
  },
};

/* -------------------------------------------------------------------------- */
/*  OTP verifications                                                         */
/* -------------------------------------------------------------------------- */

export interface OtpRow {
  id: string;
  user_id: string;
  channel: "email" | "phone";
  purpose: string;
  secret_hash: string;
  destination: string;
  expires_at: string;
  consumed_at: string | null;
  attempts: number;
  max_attempts: number;
  created_at: string;
}

const OTP_COLS = `id, user_id, channel, purpose, secret_hash, destination,
  expires_at, consumed_at, attempts, max_attempts, created_at`;

function channelToPurpose(ch: "email" | "mobile"): string {
  return ch === "email" ? "signup_email" : "signup_phone";
}

export const otpRepo = {
  /**
   * Create or rotate the outstanding OTP for (user, purpose). Postgres'
   * `uq_verif_outstanding` partial unique index permits at most one live
   * OTP per (user, purpose), so we delete-then-insert atomically.
   */
  async upsertOutstanding(args: {
    userId: string;
    channel: "email" | "mobile";
    secretHash: string;
    destination: string;
    ttlMs: number;
    maxAttempts: number;
  }): Promise<OtpRow> {
    const purpose = channelToPurpose(args.channel);
    const dbChannel = args.channel === "email" ? "email" : "phone";
    return withTransaction(async (client) => {
      // Consume any outstanding (live OR expired-but-unconsumed) OTP for
      // this purpose. The partial unique index `uq_verif_outstanding` only
      // permits one row where consumed_at IS NULL, regardless of expiry.
      await client.query(
        `UPDATE user_verifications
         SET consumed_at = NOW()
         WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
        [args.userId, purpose],
      );
      const r = await client.query<OtpRow>(
        `INSERT INTO user_verifications(
            user_id, channel, purpose, secret_hash, destination,
            expires_at, max_attempts
         ) VALUES($1, $2, $3, $4, $5, NOW() + ($6 || ' milliseconds')::interval, $7)
         RETURNING ${OTP_COLS}`,
        [
          args.userId,
          dbChannel,
          purpose,
          args.secretHash,
          args.destination,
          String(args.ttlMs),
          args.maxAttempts,
        ],
      );
      const row = r.rows[0];
      if (!row) throw new Error("OTP insert returned no row");
      return row;
    });
  },

  async findLive(otpId: string): Promise<OtpRow | null> {
    const r = await query<OtpRow>(
      `SELECT ${OTP_COLS} FROM user_verifications
       WHERE id = $1 AND consumed_at IS NULL AND expires_at > NOW()`,
      [otpId],
    );
    return r.rows[0] ?? null;
  },

  async incrementAttempts(otpId: string): Promise<OtpRow | null> {
    const r = await query<OtpRow>(
      `UPDATE user_verifications SET attempts = attempts + 1
       WHERE id = $1 AND consumed_at IS NULL
       RETURNING ${OTP_COLS}`,
      [otpId],
    );
    return r.rows[0] ?? null;
  },

  async consume(otpId: string, client?: DbClient): Promise<void> {
    const text = "UPDATE user_verifications SET consumed_at = NOW() WHERE id = $1";
    const params: unknown[] = [otpId];
    if (client) await client.query(text, params);
    else await query(text, params);
  },

  /**
   * Rotate the OTP secret + extend expiry without changing the row id, so
   * the frontend's outstanding `otpId` keeps working on resend.
   */
  async rotate(args: {
    otpId: string;
    secretHash: string;
    ttlMs: number;
  }): Promise<OtpRow | null> {
    const r = await query<OtpRow>(
      `UPDATE user_verifications
       SET secret_hash = $2,
           expires_at = NOW() + ($3 || ' milliseconds')::interval,
           attempts = 0
       WHERE id = $1 AND consumed_at IS NULL
       RETURNING ${OTP_COLS}`,
      [args.otpId, args.secretHash, String(args.ttlMs)],
    );
    return r.rows[0] ?? null;
  },

  async findLatestForUserPurpose(args: {
    userId: string;
    channel: "email" | "mobile";
  }): Promise<OtpRow | null> {
    const purpose = channelToPurpose(args.channel);
    const r = await query<OtpRow>(
      `SELECT ${OTP_COLS} FROM user_verifications
       WHERE user_id = $1 AND purpose = $2
       ORDER BY created_at DESC LIMIT 1`,
      [args.userId, purpose],
    );
    return r.rows[0] ?? null;
  },
};
