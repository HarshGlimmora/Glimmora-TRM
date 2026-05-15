import "server-only";
import { query, type DbClient } from "@/lib/server/db/client";

export type AuditAction =
  | "account_created"
  | "otp_sent"
  | "otp_resent"
  | "otp_verified"
  | "otp_failed"
  | "session_created"
  | "session_revoked"
  | "role_selected"
  | "onboarding_step_saved"
  | "profile_completed"
  | "ca_link_requested"
  | "ca_link_responded"
  | "ca_link_revoked"
  | "ca_link_code_redeemed"
  | "chat_attachment_shared"
  | "admin_login";

export interface AuditInput {
  actorUserId: string | null;
  action: AuditAction;
  entityType?: string;
  entityId?: string | null;
  beforeState?: unknown;
  afterState?: unknown;
  metadata?: Record<string, unknown>;
}

export const auditRepo = {
  async write(input: AuditInput, client?: DbClient): Promise<void> {
    const text = `INSERT INTO audit_logs(actor_user_id, action, entity_type, entity_id,
                              before_state, after_state, metadata)
       VALUES($1, $2, $3, $4, $5, $6, COALESCE($7, '{}'::jsonb))`;
    const params: unknown[] = [
      input.actorUserId,
      input.action,
      input.entityType ?? null,
      input.entityId ?? null,
      input.beforeState === undefined ? null : input.beforeState,
      input.afterState === undefined ? null : input.afterState,
      input.metadata ?? {},
    ];
    if (client) {
      await client.query(text, params);
    } else {
      await query(text, params);
    }
  },
};
