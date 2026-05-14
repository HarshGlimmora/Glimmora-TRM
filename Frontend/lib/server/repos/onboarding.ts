import "server-only";
import { query, type DbClient } from "@/lib/server/db/client";

export interface OnboardingRow {
  user_id: string;
  role: "taxpayer" | "consultant" | null;
  step: number;
  personal: Record<string, unknown>;
  contact: Record<string, unknown>;
  address: Record<string, unknown>;
  tax_profile: Record<string, unknown>;
  credentials: Record<string, unknown>;
  identity_flags: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

const COLS = `user_id, role, step, personal, contact, address,
  tax_profile, credentials, identity_flags, created_at, updated_at`;

export const onboardingRepo = {
  async getOrInit(userId: string): Promise<OnboardingRow> {
    const r = await query<OnboardingRow>(
      `INSERT INTO onboarding_progress(user_id) VALUES($1)
       ON CONFLICT(user_id) DO UPDATE SET user_id = EXCLUDED.user_id
       RETURNING ${COLS}`,
      [userId],
    );
    const row = r.rows[0];
    if (!row) throw new Error("Onboarding row upsert returned nothing");
    return row;
  },

  async get(userId: string): Promise<OnboardingRow | null> {
    const r = await query<OnboardingRow>(
      `SELECT ${COLS} FROM onboarding_progress WHERE user_id = $1`,
      [userId],
    );
    return r.rows[0] ?? null;
  },

  async setRole(args: {
    userId: string;
    role: "taxpayer" | "consultant";
    client?: DbClient;
  }): Promise<void> {
    const text = `INSERT INTO onboarding_progress(user_id, role)
       VALUES($1, $2)
       ON CONFLICT(user_id) DO UPDATE SET role = EXCLUDED.role`;
    const params: unknown[] = [args.userId, args.role];
    if (args.client) await args.client.query(text, params);
    else await query(text, params);
  },

  async patch(args: {
    userId: string;
    step?: number;
    personal?: Record<string, unknown>;
    contact?: Record<string, unknown>;
    address?: Record<string, unknown>;
    tax_profile?: Record<string, unknown>;
    credentials?: Record<string, unknown>;
    identity_flags?: Record<string, unknown>;
  }): Promise<OnboardingRow> {
    const sets: string[] = [];
    const params: unknown[] = [args.userId];
    const push = (col: string, val: unknown): void => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (args.step !== undefined) push("step", args.step);
    if (args.personal !== undefined) push("personal", args.personal);
    if (args.contact !== undefined) push("contact", args.contact);
    if (args.address !== undefined) push("address", args.address);
    if (args.tax_profile !== undefined) push("tax_profile", args.tax_profile);
    if (args.credentials !== undefined) push("credentials", args.credentials);
    if (args.identity_flags !== undefined) push("identity_flags", args.identity_flags);
    if (sets.length === 0) {
      const cur = await this.getOrInit(args.userId);
      return cur;
    }
    const insertCols = ["user_id", ...sets.map((s) => s.split(" = ")[0]!)];
    const insertVals = ["$1", ...sets.map((s) => s.split(" = ")[1]!)];
    const r = await query<OnboardingRow>(
      `INSERT INTO onboarding_progress(${insertCols.join(", ")})
       VALUES(${insertVals.join(", ")})
       ON CONFLICT(user_id) DO UPDATE SET ${sets.join(", ")}
       RETURNING ${COLS}`,
      params,
    );
    const row = r.rows[0];
    if (!row) throw new Error("Onboarding patch returned no row");
    return row;
  },

  async clearAfterCompletion(userId: string, client?: DbClient): Promise<void> {
    const text = "DELETE FROM onboarding_progress WHERE user_id = $1";
    const params: unknown[] = [userId];
    if (client) await client.query(text, params);
    else await query(text, params);
  },
};
