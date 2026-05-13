import { NextResponse } from "next/server";
import { getOtp, rotateOtp } from "@/lib/server/otp-store";
import { sendOtpEmail } from "@/lib/server/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  otpId?: string;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const otpId = String(body.otpId ?? "");
  const existing = getOtp(otpId);
  if (!existing) {
    return NextResponse.json(
      { error: "This session has expired. Start a fresh sign-in.", code: "OTP_NOT_FOUND" },
      { status: 410 },
    );
  }

  const cooldownSec = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS ?? "30");
  const since = Math.floor((Date.now() - existing.lastSentAt) / 1000);
  if (since < cooldownSec) {
    const remaining = cooldownSec - since;
    return NextResponse.json(
      {
        error: `Please wait ${remaining}s before requesting another code.`,
        code: "OTP_COOLDOWN",
        cooldownSec: remaining,
      },
      { status: 429 },
    );
  }

  const ttlSeconds = Number(process.env.OTP_TTL_SECONDS ?? "600");
  const record = rotateOtp(otpId, ttlSeconds * 1000);
  if (!record) {
    return NextResponse.json(
      { error: "Could not refresh code.", code: "OTP_NOT_FOUND" },
      { status: 410 },
    );
  }

  const target =
    record.channel === "email"
      ? record.identifier
      : process.env.EMAIL_FROM ?? record.identifier;
  const forwardForMobile =
    record.channel === "mobile" ? record.identifier : undefined;

  const send = await sendOtpEmail({
    to: target,
    code: record.code,
    channel: record.channel,
    forwardForMobile,
    ttlMinutes: Math.round(ttlSeconds / 60),
  });

  if (!send.ok) {
    return NextResponse.json(
      { error: "We couldn't resend the code right now. Please try again." },
      { status: 502 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      cooldownSec,
      sentVia: send.via,
    },
    { status: 200 },
  );
}
