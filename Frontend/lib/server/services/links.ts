import "server-only";
import { auditRepo } from "@/lib/server/repos/audit";
import { caGrantsRepo, type GrantRow } from "@/lib/server/repos/links";
import { usersRepo } from "@/lib/server/repos/identity";
import {
  BadRequestError,
  ForbiddenError,
} from "@/lib/server/services/auth";

interface RequestLinkInput {
  actorUserId: string;
  actorRole: "taxpayer" | "consultant";
  consultantPan?: string;
  taxpayerPan?: string;
  accessMode: "full_access" | "review_edit";
  taxYears: string[];
  message?: string;
}

export const linksService = {
  /**
   * Create or return an existing live grant between the two parties. PAN
   * matching is exact and case-normalised (PAN is uppercase per the spec
   * regex `[A-Z]{5}\d{4}[A-Z]`).
   */
  async request(input: RequestLinkInput): Promise<GrantRow> {
    if (input.taxYears.length === 0) {
      throw new BadRequestError("TAX_YEARS_REQUIRED", "At least one tax year is required.");
    }
    const otherPan =
      input.actorRole === "taxpayer" ? input.consultantPan : input.taxpayerPan;
    if (!otherPan) {
      throw new BadRequestError(
        "PAN_REQUIRED",
        input.actorRole === "taxpayer"
          ? "Consultant PAN is required."
          : "Taxpayer PAN is required.",
      );
    }
    const pan = otherPan.trim().toUpperCase();
    const counterparty = await this.findUserByPan(pan);
    if (!counterparty) {
      throw new BadRequestError(
        "PAN_NOT_FOUND",
        "No user with that PAN exists yet on Glimmora.",
      );
    }
    if (counterparty.id === input.actorUserId) {
      throw new BadRequestError("PAN_SELF", "You can't link to your own PAN.");
    }

    const consultantId =
      input.actorRole === "consultant" ? input.actorUserId : counterparty.id;
    const targetUserId =
      input.actorRole === "taxpayer" ? input.actorUserId : counterparty.id;

    const live = await caGrantsRepo.findLiveBetween(consultantId, targetUserId);
    if (live) return live;

    const grant = await caGrantsRepo.create({
      consultantId,
      targetUserId,
      accessMode: input.accessMode,
      taxYears: input.taxYears,
      message: input.message,
      origin: "directory_request",
      status: "pending",
    });
    await auditRepo.write({
      actorUserId: input.actorUserId,
      action: "ca_link_requested",
      entityType: "consultant_access_grants",
      entityId: grant.id,
      metadata: {
        consultantId,
        targetUserId,
        accessMode: input.accessMode,
        taxYears: input.taxYears,
      },
    });
    return grant;
  },

  async respond(args: {
    actorUserId: string;
    grantId: string;
    action: "accept" | "decline" | "revoke";
  }): Promise<GrantRow> {
    // For the demo we trust the actor — in production we'd check
    // (actor === consultant_id) for accept/decline and (actor in {consultant_id,target_user_id}) for revoke.
    const grants = await caGrantsRepo.listForUser(args.actorUserId);
    const grant = grants.find((g) => g.id === args.grantId);
    if (!grant) {
      throw new ForbiddenError("GRANT_NOT_VISIBLE", "Grant not found in your scope.");
    }
    const newStatus =
      args.action === "accept" ? "active" : args.action === "decline" ? "rejected" : "revoked";
    const updated = await caGrantsRepo.updateStatus({ id: grant.id, status: newStatus });
    if (!updated) throw new Error("Grant update returned no row");
    await auditRepo.write({
      actorUserId: args.actorUserId,
      action: args.action === "revoke" ? "ca_link_revoked" : "ca_link_responded",
      entityType: "consultant_access_grants",
      entityId: updated.id,
      metadata: { status: newStatus },
    });
    return updated;
  },

  async listForUser(userId: string): Promise<ReturnType<typeof caGrantsRepo.listForUser>> {
    return caGrantsRepo.listForUser(userId);
  },

  async findUserByPan(pan: string): Promise<{ id: string } | null> {
    // Tiny helper kept local to avoid leaking PAN-lookup repo methods elsewhere.
    const r = await import("@/lib/server/db/client").then(({ query }) =>
      query<{ id: string }>(
        "SELECT id FROM users WHERE pan = $1 AND deleted_at IS NULL",
        [pan],
      ),
    );
    return r.rows[0] ?? null;
  },
};
