import { NextResponse } from "next/server";
import { authService } from "@/lib/server/services/auth";
import { jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  otpId?: string;
}

export async function POST(req: Request) {
  try {
    const body = await readJson<Body>(req);
    const otpId = String(body.otpId ?? "");
    if (!otpId) {
      return NextResponse.json(
        { error: "Missing otpId.", code: "OTP_ID_REQUIRED" },
        { status: 400 },
      );
    }
    const result = await authService.resendOtp(otpId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return jsonError(err);
  }
}
