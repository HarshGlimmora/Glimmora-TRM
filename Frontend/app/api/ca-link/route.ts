import { NextResponse } from "next/server";
import {
  authService,
  UnauthorizedError,
  BadRequestError,
} from "@/lib/server/services/auth";
import { linksService } from "@/lib/server/services/links";
import { jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PostBody {
  consultantPan?: string;
  taxpayerPan?: string;
  accessMode?: "full_access" | "review_edit";
  taxYears?: string[];
  message?: string;
}

interface PatchBody {
  grantId?: string;
  action?: "accept" | "decline" | "revoke";
}

export async function GET() {
  try {
    const ctx = await authService.resolveCookieSession();
    if (!ctx) throw new UnauthorizedError("UNAUTHENTICATED", "Sign in first.");
    const rows = await linksService.listForUser(ctx.user.id);
    return NextResponse.json({
      grants: rows.map((g) => ({
        id: g.id,
        consultantId: g.consultant_id,
        taxpayerId: g.target_user_id,
        accessMode: g.access_mode,
        status: g.status,
        origin: g.origin,
        taxYears: g.tax_years,
        message: g.message,
        requestedAt: g.requested_at,
        decidedAt: g.decided_at,
        revokedAt: g.revoked_at,
        expiresAt: g.expires_at,
        counterpartyName:
          g.counterparty_display_name ?? g.counterparty_name ?? "User",
        counterpartyPan: g.counterparty_pan,
        myRoleInGrant: g.consultant_id === ctx.user.id ? "consultant" : "taxpayer",
      })),
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await authService.resolveCookieSession();
    if (!ctx) throw new UnauthorizedError("UNAUTHENTICATED", "Sign in first.");
    const role = ctx.user.role;
    if (role !== "taxpayer" && role !== "consultant") {
      throw new BadRequestError("ROLE_REQUIRED", "Pick a role before requesting a link.");
    }
    const body = await readJson<PostBody>(req);
    if (body.accessMode !== "full_access" && body.accessMode !== "review_edit") {
      throw new BadRequestError("ACCESS_MODE_INVALID", "Pick an access mode.");
    }
    if (!Array.isArray(body.taxYears) || body.taxYears.length === 0) {
      throw new BadRequestError("TAX_YEARS_REQUIRED", "Pick at least one tax year.");
    }
    const grant = await linksService.request({
      actorUserId: ctx.user.id,
      actorRole: role,
      consultantPan: body.consultantPan,
      taxpayerPan: body.taxpayerPan,
      accessMode: body.accessMode,
      taxYears: body.taxYears,
      message: body.message,
    });
    return NextResponse.json({ grant });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PATCH(req: Request) {
  try {
    const ctx = await authService.resolveCookieSession();
    if (!ctx) throw new UnauthorizedError("UNAUTHENTICATED", "Sign in first.");
    const body = await readJson<PatchBody>(req);
    if (!body.grantId) throw new BadRequestError("GRANT_ID_REQUIRED", "Missing grantId.");
    if (body.action !== "accept" && body.action !== "decline" && body.action !== "revoke") {
      throw new BadRequestError("ACTION_INVALID", "Pick accept | decline | revoke.");
    }
    const grant = await linksService.respond({
      actorUserId: ctx.user.id,
      grantId: body.grantId,
      action: body.action,
    });
    return NextResponse.json({ grant });
  } catch (err) {
    return jsonError(err);
  }
}
