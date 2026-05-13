import { NextResponse } from "next/server";
import {
  getOtp,
  recordAttempt,
  timingSafeEqual,
} from "@/lib/server/otp-store";
import { sanitizeDigits } from "@/lib/security/sanitize";
import { validateOtp } from "@/lib/validation/identity";
import { mockDB } from "@/lib/api/mock-db";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  otpId?: string;
  code?: string;
  identifier?: string;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const otpId = String(body.otpId ?? "");
  const code = sanitizeDigits(body.code ?? "", 6);
  const identifier = String(body.identifier ?? "").trim().toLowerCase();

  const r = validateOtp(code);
  if (!r.ok) {
    return NextResponse.json({ error: r.message, code: r.code }, { status: 400 });
  }

  const record = getOtp(otpId);
  if (!record) {
    return NextResponse.json(
      { error: "This verification session has expired. Please request a new code.", code: "OTP_NOT_FOUND" },
      { status: 410 },
    );
  }

  if (record.lockedUntil && record.lockedUntil > Date.now()) {
    const secs = Math.ceil((record.lockedUntil - Date.now()) / 1000);
    return NextResponse.json(
      { error: `Too many incorrect attempts. Try again in ${secs} seconds.`, code: "OTP_LOCKED" },
      { status: 423 },
    );
  }

  const maxAttempts = Number(process.env.OTP_MAX_ATTEMPTS ?? "5");
  const lockSec = Number(process.env.OTP_LOCK_SECONDS ?? "60");

  // Optional: bind verification to the identifier supplied at send-time
  if (identifier && record.identifier.toLowerCase() !== identifier) {
    return NextResponse.json(
      { error: "This code does not belong to that identifier.", code: "OTP_MISMATCH" },
      { status: 400 },
    );
  }

  const ok = timingSafeEqual(record.code, code);
  recordAttempt(otpId, ok, maxAttempts, lockSec * 1000);

  if (!ok) {
    // `recordAttempt` has already incremented `record.attempts` in-place.
    const remaining = Math.max(0, maxAttempts - record.attempts);
    if (remaining <= 0) {
      return NextResponse.json(
        {
          error: `Verification locked for ${lockSec} seconds after ${maxAttempts} failed attempts.`,
          code: "OTP_LOCKED",
        },
        { status: 423 },
      );
    }
    return NextResponse.json(
      {
        error: `Incorrect code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`,
        code: "OTP_INVALID",
        remaining,
      },
      { status: 400 },
    );
  }

  // Successful — look up a seeded user if the identifier matches
  let role: "taxpayer" | "consultant" | undefined;
  let hasProfile = false;
  for (const u of mockDB.users.values()) {
    if (u.email === record.identifier || u.mobile === record.identifier) {
      role = u.role;
      hasProfile = true;
      break;
    }
  }

  const sessionId = `ses_${crypto.randomBytes(12).toString("hex")}`;

  return NextResponse.json(
    {
      ok: true,
      sessionId,
      hasProfile,
      role,
      isFirstTime: !hasProfile,
    },
    { status: 200 },
  );
}
