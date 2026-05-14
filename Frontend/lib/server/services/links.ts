import "server-only";
import { query, withTransaction } from "@/lib/server/db/client";
import { auditRepo } from "@/lib/server/repos/audit";
import {
  consultantInvitesRepo,
  isValidInviteCode,
} from "@/lib/server/repos/invites";
import { caGrantsRepo, type GrantRow } from "@/lib/server/repos/links";
import { usersRepo } from "@/lib/server/repos/identity";
import {
  BadRequestError,
  ForbiddenError,
} from "@/lib/server/services/auth";

/** Default tax year applied to grants when the user doesn't pick one. */
const DEFAULT_TAX_YEAR = "FY 2024-25";

export interface DirectoryConsultant {
  id: string;
  displayName: string;
  legalName: string | null;
  firmName: string | null;
  city: string | null;
  state: string | null;
  yearsExperience: number | null;
  specializations: string[];
  bio: string | null;
  acceptingClients: boolean;
}

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

  /* ------------------------------------------------------------------ */
  /*  Browse-and-connect: directory listing                              */
  /* ------------------------------------------------------------------ */

  /**
   * Return consultants flagged `listed_in_directory` and `accepting_clients`
   * whose profile is complete. The shape is deliberately limited to fields
   * a taxpayer needs to *choose* a CA — no PAN, no Aadhaar, no contact.
   * Those are revealed only after a grant is active.
   */
  async listDirectory(): Promise<DirectoryConsultant[]> {
    const r = await query<{
      id: string;
      display_name: string | null;
      legal_name: string | null;
      bio: string | null;
      specializations: string[] | null;
      years_experience: number | null;
      accepting_clients: boolean | null;
      city: string | null;
      state: string | null;
    }>(
      `SELECT u.id, u.display_name, u.legal_name, c.bio, c.specializations,
              c.years_experience, c.accepting_clients, u.city, u.state
         FROM users u
         JOIN ca_profiles c ON c.user_id = u.id
        WHERE u.role = 'consultant'
          AND u.profile_completed_at IS NOT NULL
          AND u.deleted_at IS NULL
          AND COALESCE(c.listed_in_directory, FALSE) = TRUE
        ORDER BY c.years_experience DESC NULLS LAST, u.display_name ASC`,
    );
    return r.rows.map((row) => ({
      id: row.id,
      displayName: row.display_name ?? row.legal_name ?? "Consultant",
      legalName: row.legal_name,
      // `bio` carries the firm name in the existing onboarding flow.
      firmName: row.bio,
      city: row.city,
      state: row.state,
      yearsExperience: row.years_experience,
      specializations: row.specializations ?? [],
      bio: row.bio,
      acceptingClients: row.accepting_clients ?? true,
    }));
  },

  /**
   * Idempotently create a pending grant when a taxpayer clicks "Connect"
   * on a consultant card. The CA still has to accept it — same semantics
   * as the existing PAN-based flow, just keyed by the consultant's id
   * instead of looking them up by PAN.
   */
  async connectById(args: {
    taxpayerUserId: string;
    consultantUserId: string;
    accessMode?: "full_access" | "review_edit";
    taxYears?: string[];
    message?: string;
  }): Promise<GrantRow> {
    if (args.taxpayerUserId === args.consultantUserId) {
      throw new BadRequestError("CONSULTANT_SELF", "You can't link to yourself.");
    }
    const consultant = await usersRepo.findById(args.consultantUserId);
    if (!consultant || consultant.role !== "consultant") {
      throw new BadRequestError(
        "CONSULTANT_NOT_FOUND",
        "That consultant is no longer available.",
      );
    }

    const live = await caGrantsRepo.findLiveBetween(
      args.consultantUserId,
      args.taxpayerUserId,
    );
    if (live) return live;

    const grant = await caGrantsRepo.create({
      consultantId: args.consultantUserId,
      targetUserId: args.taxpayerUserId,
      accessMode: args.accessMode ?? "review_edit",
      taxYears: args.taxYears?.length ? args.taxYears : [DEFAULT_TAX_YEAR],
      message: args.message,
      origin: "directory_request",
      status: "pending",
    });
    await auditRepo.write({
      actorUserId: args.taxpayerUserId,
      action: "ca_link_requested",
      entityType: "consultant_access_grants",
      entityId: grant.id,
      metadata: {
        consultantId: args.consultantUserId,
        origin: "directory_request",
        via: "directory_card",
      },
    });
    return grant;
  },

  /* ------------------------------------------------------------------ */
  /*  Code-based connect                                                 */
  /* ------------------------------------------------------------------ */

  /**
   * Redeem a 5-digit invite code. The CA pre-issued the code so the grant
   * lands `active` immediately (no second-side accept needed). Idempotent
   * on (consultantId, taxpayerId).
   */
  async connectByCode(args: {
    taxpayerUserId: string;
    code: string;
    taxYears?: string[];
    message?: string;
  }): Promise<{ grant: GrantRow; consultantId: string }> {
    const code = String(args.code ?? "").trim();
    if (!isValidInviteCode(code)) {
      throw new BadRequestError(
        "CODE_FORMAT",
        "Enter a 5-digit code (digits only).",
      );
    }
    const invite = await consultantInvitesRepo.findRedeemable(code);
    if (!invite) {
      throw new BadRequestError(
        "CODE_INVALID",
        "That code is invalid, expired, or has been revoked.",
      );
    }
    if (invite.consultant_id === args.taxpayerUserId) {
      throw new BadRequestError(
        "CODE_SELF",
        "You can't redeem your own invite code.",
      );
    }

    return withTransaction(async (client) => {
      const live = await caGrantsRepo.findLiveBetween(
        invite.consultant_id,
        args.taxpayerUserId,
        client,
      );
      if (live) {
        return { grant: live, consultantId: invite.consultant_id };
      }

      const accessMode = invite.default_access_mode;
      const taxYears =
        args.taxYears?.length
          ? args.taxYears
          : invite.allowed_tax_years?.length
            ? invite.allowed_tax_years
            : [DEFAULT_TAX_YEAR];

      const r = await client.query<GrantRow>(
        `INSERT INTO consultant_access_grants(
            consultant_id, target_user_id, origin, invite_code_id,
            access_mode, status, tax_years, message, expires_at
         )
         VALUES($1, $2, 'invite_code', $3, $4, 'active', $5, $6, NULL)
         RETURNING id, consultant_id, target_user_id, origin, access_mode,
                   status, tax_years, message, requested_at, decided_at,
                   revoked_at, expires_at, created_at`,
        [
          invite.consultant_id,
          args.taxpayerUserId,
          invite.id,
          accessMode,
          taxYears,
          args.message ?? null,
        ],
      );
      const grant = r.rows[0];
      if (!grant) throw new Error("Code-grant insert returned no row");

      // Mark `decided_at` since the grant is active immediately. updateStatus
      // sets it conditionally; we re-use that to keep the timestamp logic
      // in one place.
      await client.query(
        `UPDATE consultant_access_grants
            SET decided_at = COALESCE(decided_at, NOW())
          WHERE id = $1`,
        [grant.id],
      );

      await consultantInvitesRepo.incrementUseCount(invite.id, client);

      await auditRepo.write(
        {
          actorUserId: args.taxpayerUserId,
          action: "ca_link_code_redeemed",
          entityType: "consultant_access_grants",
          entityId: grant.id,
          metadata: {
            consultantId: invite.consultant_id,
            inviteCodeId: invite.id,
            via: "invite_code",
          },
        },
        client,
      );

      return { grant, consultantId: invite.consultant_id };
    });
  },

  /* ------------------------------------------------------------------ */
  /*  Consultant: read/issue my own code                                 */
  /* ------------------------------------------------------------------ */

  async getOrIssueMyCode(args: {
    consultantUserId: string;
    rotate?: boolean;
    accessMode?: "full_access" | "review_edit";
  }) {
    if (args.rotate) {
      return consultantInvitesRepo.issue({
        consultantId: args.consultantUserId,
        accessMode: args.accessMode,
      });
    }
    return consultantInvitesRepo.getOrIssue({
      consultantId: args.consultantUserId,
      accessMode: args.accessMode,
    });
  },
};
