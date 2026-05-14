/**
 * POST /api/ca-link/by-code
 *
 * Taxpayer pastes the 5-digit code the CA shared. We look it up against
 * consultant_invite_codes, idempotently create an *active* grant
 * (no second-side accept — the CA pre-approved by issuing the code), and
 * increment used_count. Idempotent across re-submits.
 *
 * Strict format validation (^\d{5}$) happens both here and in the service
 * layer. Failure modes returned with friendly messages: invalid format,
 * unknown/expired/revoked, or self-redemption.
 */
import { NextResponse } from "next/server";
import {
  authService,
  BadRequestError,
  UnauthorizedError,
} from "@/lib/server/services/auth";
import { linksService } from "@/lib/server/services/links";
import { jsonError, readJson } from "@/lib/server/http";
import { sanitizeDigits, sanitizeText } from "@/lib/security/sanitize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  code?: string;
  message?: string;
}

export async function POST(req: Request) {
  try {
    const ctx = await authService.resolveCookieSession();
    if (!ctx) throw new UnauthorizedError("UNAUTHENTICATED", "Sign in first.");
    if (ctx.user.role !== "taxpayer") {
      throw new BadRequestError(
        "TAXPAYER_ONLY",
        "Only taxpayers can redeem an invite code.",
      );
    }
    const body = await readJson<Body>(req);
    const code = sanitizeDigits(body.code ?? "", 5);
    if (code.length !== 5) {
      throw new BadRequestError(
        "CODE_FORMAT",
        "Enter the 5-digit code your CA shared.",
      );
    }
    const result = await linksService.connectByCode({
      taxpayerUserId: ctx.user.id,
      code,
      message: body.message ? sanitizeText(body.message, 280) : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return jsonError(err);
  }
}
