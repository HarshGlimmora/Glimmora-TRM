import { NextResponse } from "next/server";
import { createOtp, maskEmailServer, maskMobileServer } from "@/lib/server/otp-store";
import { sendOtpEmail } from "@/lib/server/email";
import { validateEmail, validateMobile } from "@/lib/validation/identity";
import { sanitizeEmail, sanitizeMobile } from "@/lib/security/sanitize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  identifier?: string;
  channel?: "email" | "mobile";
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json(
      { error: "Malformed request body." },
      { status: 400 },
    );
  }

  const rawIdentifier = String(body.identifier ?? "").trim();
  let channel: "email" | "mobile" =
    body.channel === "mobile" ? "mobile" : "email";

  if (!body.channel) {
    channel = rawIdentifier.includes("@") ? "email" : "mobile";
  }

  let identifier: string;
  if (channel === "email") {
    identifier = sanitizeEmail(rawIdentifier);
    const r = validateEmail(identifier);
    if (!r.ok) {
      return NextResponse.json(
        { error: r.message, code: r.code },
        { status: 400 },
      );
    }
  } else {
    identifier = sanitizeMobile(rawIdentifier);
    const r = validateMobile(identifier);
    if (!r.ok) {
      return NextResponse.json(
        { error: r.message, code: r.code },
        { status: 400 },
      );
    }
  }

  const ttlSeconds = Number(process.env.OTP_TTL_SECONDS ?? "600");
  const cooldownSec = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS ?? "30");

  const record = createOtp({
    identifier,
    channel,
    ttlMs: ttlSeconds * 1000,
  });

  // For mobile (no SMS provider configured), forward the OTP to the
  // platform email so the demo flow stays functional.
  const target =
    channel === "email" ? identifier : process.env.EMAIL_FROM ?? identifier;
  const forwardForMobile = channel === "mobile" ? identifier : undefined;

  const send = await sendOtpEmail({
    to: target,
    code: record.code,
    channel,
    forwardForMobile,
    ttlMinutes: Math.round(ttlSeconds / 60),
  });

  if (!send.ok) {
    return NextResponse.json(
      {
        error:
          "We couldn't send the code right now. Please try again in a moment.",
      },
      { status: 502 },
    );
  }

  const display =
    channel === "email"
      ? maskEmailServer(identifier)
      : maskMobileServer(identifier);

  return NextResponse.json(
    {
      otpId: record.otpId,
      channel,
      target: identifier,
      display,
      cooldownSec,
      // Helpful hint shown in the UI — kept generic, no code is leaked.
      hint:
        channel === "mobile"
          ? `For this demo, mobile OTPs are forwarded to ${maskEmailServer(
              process.env.EMAIL_FROM ?? "",
            )}.`
          : null,
      ttlSeconds,
      sentVia: send.via,
    },
    { status: 200 },
  );
}
