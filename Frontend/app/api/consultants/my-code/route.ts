/**
 * GET  /api/consultants/my-code   — return the CA's active 5-digit code,
 *                                   auto-issuing one on first call.
 * POST /api/consultants/my-code   — rotate (issue a fresh code, revoke the
 *                                   previous active one).
 *
 * Only the consultant themselves can read or rotate their own code; we
 * derive the consultant id from the session cookie. The code body is
 * returned to the caller because a CA needs to read it back to share
 * with clients — there's no point hashing it for storage and then making
 * the owner re-prove possession.
 */
import { NextResponse } from "next/server";
import {
  authService,
  BadRequestError,
  UnauthorizedError,
} from "@/lib/server/services/auth";
import { linksService } from "@/lib/server/services/links";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function guard(ctxRole: string | null): void {
  if (ctxRole !== "consultant") {
    throw new BadRequestError(
      "CONSULTANT_ONLY",
      "Only consultants can issue or read invite codes.",
    );
  }
}

function payload(row: {
  code: string;
  status: string;
  max_uses: number;
  used_count: number;
  created_at: string;
  expires_at: string | null;
}) {
  return {
    code: row.code,
    status: row.status,
    maxUses: row.max_uses,
    usedCount: row.used_count,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export async function GET() {
  try {
    const ctx = await authService.resolveCookieSession();
    if (!ctx) throw new UnauthorizedError("UNAUTHENTICATED", "Sign in first.");
    guard(ctx.user.role);
    const row = await linksService.getOrIssueMyCode({
      consultantUserId: ctx.user.id,
    });
    return NextResponse.json({ inviteCode: payload(row) });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST() {
  try {
    const ctx = await authService.resolveCookieSession();
    if (!ctx) throw new UnauthorizedError("UNAUTHENTICATED", "Sign in first.");
    guard(ctx.user.role);
    const row = await linksService.getOrIssueMyCode({
      consultantUserId: ctx.user.id,
      rotate: true,
    });
    return NextResponse.json({ inviteCode: payload(row) });
  } catch (err) {
    return jsonError(err);
  }
}
