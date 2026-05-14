import { NextResponse } from "next/server";
import { authService } from "@/lib/server/services/auth";
import { jsonError, readJson, requestMeta } from "@/lib/server/http";
import { sanitizeDigits } from "@/lib/security/sanitize";
import { validateOtp } from "@/lib/validation/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  otpId?: string;
  code?: string;
  /** When true, the cookie persists across browser restarts (30-day TTL). */
  rememberMe?: boolean;
}

export async function POST(req: Request) {
  try {
    const body = await readJson<Body>(req);
    const otpId = String(body.otpId ?? "");
    const code = sanitizeDigits(body.code ?? "", 6);
    const v = validateOtp(code);
    if (!v.ok) {
      return NextResponse.json({ error: v.message, code: v.code }, { status: 400 });
    }
    if (!otpId) {
      return NextResponse.json(
        { error: "Missing otpId.", code: "OTP_ID_REQUIRED" },
        { status: 400 },
      );
    }
    const result = await authService.verifyOtp(
      { otpId, code, rememberMe: Boolean(body.rememberMe) },
      requestMeta(req),
    );
    return NextResponse.json(result);
  } catch (err) {
    return jsonError(err);
  }
}
