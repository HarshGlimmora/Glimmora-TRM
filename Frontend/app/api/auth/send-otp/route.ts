import { NextResponse } from "next/server";
import { authService } from "@/lib/server/services/auth";
import { jsonError, readJson } from "@/lib/server/http";
import {
  validateEmail,
  validateMobile,
} from "@/lib/validation/identity";
import {
  detectChannel,
  normalizeEmail,
  normalizeMobile,
} from "@/lib/server/auth/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  identifier?: string;
  channel?: "email" | "mobile";
}

export async function POST(req: Request) {
  try {
    const body = await readJson<Body>(req);
    const raw = String(body.identifier ?? "").trim();
    const channel: "email" | "mobile" = body.channel ?? detectChannel(raw);
    const normalised = channel === "email" ? normalizeEmail(raw) : normalizeMobile(raw);
    const v = channel === "email" ? validateEmail(normalised) : validateMobile(normalised);
    if (!v.ok) {
      return NextResponse.json({ error: v.message, code: v.code }, { status: 400 });
    }
    const result = await authService.beginOtp({ identifier: normalised, channel });
    return NextResponse.json(result);
  } catch (err) {
    return jsonError(err);
  }
}
