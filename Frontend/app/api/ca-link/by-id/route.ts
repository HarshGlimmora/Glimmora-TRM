/**
 * POST /api/ca-link/by-id
 *
 * Taxpayer-driven "Connect" CTA from a directory card. Body:
 *   { consultantId: string, accessMode?, taxYears?, message? }
 *
 * Creates a pending grant (idempotent) and returns the grant row. Same
 * accept/decline semantics as the existing PAN-based flow — the CA must
 * still confirm. We don't reveal whether the consultantId exists for
 * unauthenticated callers; this route requires a session cookie.
 */
import { NextResponse } from "next/server";
import {
  authService,
  BadRequestError,
  UnauthorizedError,
} from "@/lib/server/services/auth";
import { linksService } from "@/lib/server/services/links";
import { jsonError, readJson } from "@/lib/server/http";
import { sanitizeText } from "@/lib/security/sanitize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  consultantId?: string;
  accessMode?: "full_access" | "review_edit";
  taxYears?: string[];
  message?: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  try {
    const ctx = await authService.resolveCookieSession();
    if (!ctx) throw new UnauthorizedError("UNAUTHENTICATED", "Sign in first.");
    if (ctx.user.role !== "taxpayer") {
      throw new BadRequestError(
        "TAXPAYER_ONLY",
        "Only taxpayers can link to a consultant from the directory.",
      );
    }
    const body = await readJson<Body>(req);
    const consultantId = String(body.consultantId ?? "").trim();
    if (!UUID_RE.test(consultantId)) {
      throw new BadRequestError(
        "CONSULTANT_ID_INVALID",
        "Bad consultant reference.",
      );
    }
    const grant = await linksService.connectById({
      taxpayerUserId: ctx.user.id,
      consultantUserId: consultantId,
      accessMode:
        body.accessMode === "full_access" || body.accessMode === "review_edit"
          ? body.accessMode
          : "review_edit",
      taxYears:
        Array.isArray(body.taxYears) && body.taxYears.length > 0
          ? body.taxYears
          : undefined,
      message: body.message ? sanitizeText(body.message, 280) : undefined,
    });
    return NextResponse.json({ grant });
  } catch (err) {
    return jsonError(err);
  }
}
