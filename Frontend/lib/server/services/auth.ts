/**
 * Auth service. Owns the OTP lifecycle and the session lifecycle.
 *
 * Routing decision (where a returning user should land after verify) is
 * computed here, not in the route handler, so the same logic runs for both
 * `verify-otp` and `me`. The decision reads:
 *   - users.{email_verified_at, phone_verified_at, role, profile_completed_at}
 *   - onboarding_progress.{role, step}
 *
 * Outputs `{ next: "/dashboard" | "/role-select" | "/onboarding/...?step=N" }`.
 */
import "server-only";
import { runMigrations } from "@/lib/server/db/migrate";
import { auditRepo } from "@/lib/server/repos/audit";
import { otpRepo, usersRepo, type UserRow } from "@/lib/server/repos/identity";
import { onboardingRepo } from "@/lib/server/repos/onboarding";
import { sessionsRepo } from "@/lib/server/repos/sessions";
import {
  generateOtp,
  randomToken,
  sha256Hex,
  timingSafeEqualHex,
} from "@/lib/server/auth/hash";
import {
  LONG_TTL_SECONDS,
  SHORT_TTL_SECONDS,
  clearSessionCookie,
  readSessionCookie,
  setSessionCookie,
} from "@/lib/server/auth/cookies";
import {
  maskEmail,
  maskMobile,
  normalizeEmail,
  normalizeMobile,
} from "@/lib/server/auth/normalize";
import { sendOtpEmail } from "@/lib/server/email";

let migrationsReady: Promise<unknown> | null = null;
async function ensureMigrations(): Promise<void> {
  if (!migrationsReady) migrationsReady = runMigrations();
  await migrationsReady;
}

interface RequestMeta {
  userAgent?: string | null;
  ipAddress?: string | null;
}

interface BeginOtpInput {
  identifier: string;
  channel: "email" | "mobile";
}

interface BeginOtpResult {
  otpId: string;
  channel: "email" | "mobile";
  target: string;
  display: string;
  cooldownSec: number;
  hint: string | null;
  sentVia?: "smtp" | "resend" | "console";
}

interface VerifyOtpInput {
  otpId: string;
  code: string;
  rememberMe?: boolean;
}

interface VerifyOtpResult {
  ok: true;
  next: string;
  hasProfile: boolean;
  user: AuthMeUser;
}

export interface AuthMeUser {
  id: string;
  role: "taxpayer" | "consultant" | null;
  email: string | null;
  phone: string | null;
  displayName: string | null;
  legalName: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  profileCompletedAt: string | null;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function ttlMsForOtp(): number {
  return envInt("OTP_TTL_SECONDS", 600) * 1000;
}

function cooldownSec(): number {
  return envInt("OTP_RESEND_COOLDOWN_SECONDS", 30);
}

function maxAttempts(): number {
  return envInt("OTP_MAX_ATTEMPTS", 5);
}

function lockMs(): number {
  return envInt("OTP_LOCK_SECONDS", 60) * 1000;
}

function rowToMe(user: UserRow): AuthMeUser {
  return {
    id: user.id,
    role: (user.role as "taxpayer" | "consultant" | null) ?? null,
    email: user.email,
    phone: user.phone,
    displayName: user.display_name,
    legalName: user.legal_name,
    emailVerified: user.email_verified_at != null,
    phoneVerified: user.phone_verified_at != null,
    profileCompletedAt: user.profile_completed_at,
  };
}

/**
 * Where should this user go next after a successful verify or a fresh /me?
 * Pure function of the user row + onboarding state. Kept here so the same
 * decision runs everywhere.
 */
export async function decideNext(user: UserRow): Promise<string> {
  if (user.profile_completed_at) return "/dashboard";
  if (!user.email_verified_at && !user.phone_verified_at) return "/login";
  const onb = await onboardingRepo.get(user.id);
  const role = (user.role ?? onb?.role) as "taxpayer" | "consultant" | null;
  if (!role) return "/role-select";
  const step = onb?.step ?? 0;
  const base = role === "consultant" ? "/onboarding/consultant" : "/onboarding/taxpayer";
  return `${base}?step=${step}`;
}

export const authService = {
  async beginOtp(input: BeginOtpInput): Promise<BeginOtpResult> {
    await ensureMigrations();
    const rawIdentifier =
      input.channel === "email"
        ? normalizeEmail(input.identifier)
        : normalizeMobile(input.identifier);
    if (!rawIdentifier) {
      throw new BadRequestError(
        "IDENTIFIER_REQUIRED",
        input.channel === "email"
          ? "Please enter your email address."
          : "Please enter your mobile number.",
      );
    }

    const { user, created } = await usersRepo.findOrCreateByIdentifier({
      channel: input.channel,
      identifier: rawIdentifier,
    });

    const code = generateOtp();
    const ttlMs = ttlMsForOtp();

    const otp = await otpRepo.upsertOutstanding({
      userId: user.id,
      channel: input.channel,
      secretHash: sha256Hex(code),
      destination: rawIdentifier,
      ttlMs,
      maxAttempts: maxAttempts(),
    });

    // For mobile (no SMS provider in MVP), forward the OTP to the platform
    // email so the demo flow stays functional — same behaviour as before.
    const target =
      input.channel === "email"
        ? rawIdentifier
        : process.env.EMAIL_FROM ?? rawIdentifier;
    const forwardForMobile = input.channel === "mobile" ? rawIdentifier : undefined;

    const send = await sendOtpEmail({
      to: target,
      code,
      channel: input.channel,
      forwardForMobile,
      ttlMinutes: Math.round(ttlMs / 60_000),
    });
    if (!send.ok) {
      throw new BadGatewayError(
        "EMAIL_SEND_FAILED",
        "We couldn't send the code right now. Please try again in a moment.",
      );
    }

    if (created) {
      await auditRepo.write({
        actorUserId: user.id,
        action: "account_created",
        entityType: "user",
        entityId: user.id,
        metadata: { channel: input.channel },
      });
    }
    await auditRepo.write({
      actorUserId: user.id,
      action: "otp_sent",
      entityType: "user_verifications",
      entityId: otp.id,
      metadata: { channel: input.channel, via: send.via },
    });

    return {
      otpId: otp.id,
      channel: input.channel,
      target: rawIdentifier,
      display: input.channel === "email" ? maskEmail(rawIdentifier) : maskMobile(rawIdentifier),
      cooldownSec: cooldownSec(),
      hint:
        input.channel === "mobile"
          ? `For this demo, mobile OTPs are forwarded to ${maskEmail(process.env.EMAIL_FROM ?? "")}.`
          : null,
      sentVia: send.via,
    };
  },

  async resendOtp(otpId: string): Promise<{ cooldownSec: number; sentVia?: string }> {
    await ensureMigrations();
    const existing = await otpRepo.findLive(otpId);
    if (!existing) {
      throw new GoneError(
        "OTP_NOT_FOUND",
        "This session has expired. Start a fresh sign-in.",
      );
    }
    const since =
      (Date.now() - Number(new Date(existing.created_at))) / 1000;
    const cd = cooldownSec();
    if (since < cd) {
      throw new TooManyError(
        "OTP_COOLDOWN",
        `Please wait ${Math.ceil(cd - since)}s before requesting another code.`,
      );
    }
    const code = generateOtp();
    const ttlMs = ttlMsForOtp();
    const rotated = await otpRepo.rotate({
      otpId,
      secretHash: sha256Hex(code),
      ttlMs,
    });
    if (!rotated) {
      throw new GoneError(
        "OTP_NOT_FOUND",
        "Could not refresh code. Start a fresh sign-in.",
      );
    }
    const channel: "email" | "mobile" =
      rotated.channel === "email" ? "email" : "mobile";
    const target =
      channel === "email" ? rotated.destination : process.env.EMAIL_FROM ?? rotated.destination;
    const send = await sendOtpEmail({
      to: target,
      code,
      channel,
      forwardForMobile: channel === "mobile" ? rotated.destination : undefined,
      ttlMinutes: Math.round(ttlMs / 60_000),
    });
    if (!send.ok) {
      throw new BadGatewayError(
        "EMAIL_SEND_FAILED",
        "We couldn't resend the code right now. Please try again.",
      );
    }
    await auditRepo.write({
      actorUserId: rotated.user_id,
      action: "otp_resent",
      entityType: "user_verifications",
      entityId: rotated.id,
      metadata: { channel, via: send.via },
    });
    return { cooldownSec: cd, sentVia: send.via };
  },

  async verifyOtp(input: VerifyOtpInput, meta: RequestMeta = {}): Promise<VerifyOtpResult> {
    await ensureMigrations();
    const otp = await otpRepo.findLive(input.otpId);
    if (!otp) {
      throw new GoneError(
        "OTP_NOT_FOUND",
        "This verification session has expired. Please request a new code.",
      );
    }
    // Attempt-lock check based on attempts so far.
    const codeHash = sha256Hex(input.code);
    const ok = timingSafeEqualHex(codeHash, otp.secret_hash);
    if (!ok) {
      const updated = await otpRepo.incrementAttempts(input.otpId);
      const attempts = updated?.attempts ?? otp.attempts + 1;
      const cap = otp.max_attempts;
      await auditRepo.write({
        actorUserId: otp.user_id,
        action: "otp_failed",
        entityType: "user_verifications",
        entityId: otp.id,
        metadata: { attempts, cap },
      });
      if (attempts >= cap) {
        // Mark consumed to prevent further attempts; user must request fresh OTP.
        await otpRepo.consume(otp.id);
        throw new LockedError(
          "OTP_LOCKED",
          `Verification locked after ${cap} failed attempts. Please request a new code.`,
        );
      }
      const remaining = Math.max(0, cap - attempts);
      throw new BadRequestError(
        "OTP_INVALID",
        `Incorrect code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`,
      );
    }

    // OTP good. Mark consumed, mark channel verified, mint session, decide route.
    const channel: "email" | "mobile" = otp.channel === "email" ? "email" : "mobile";
    await otpRepo.consume(otp.id);
    await usersRepo.markChannelVerified({ userId: otp.user_id, channel });

    const rememberMe = Boolean(input.rememberMe);
    const ttlMs = (rememberMe ? LONG_TTL_SECONDS : SHORT_TTL_SECONDS) * 1000;
    const token = randomToken(32);
    const session = await sessionsRepo.create({
      userId: otp.user_id,
      tokenHash: sha256Hex(token),
      rememberMe,
      ttlMs,
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ipAddress ?? null,
    });
    setSessionCookie({ token, rememberMe });

    await auditRepo.write({
      actorUserId: otp.user_id,
      action: "otp_verified",
      entityType: "user_verifications",
      entityId: otp.id,
      metadata: { channel },
    });
    await auditRepo.write({
      actorUserId: otp.user_id,
      action: "session_created",
      entityType: "sessions",
      entityId: session.id,
      metadata: { rememberMe },
    });

    const fresh = await usersRepo.findById(otp.user_id);
    if (!fresh) throw new Error("User vanished mid-verify");
    const next = await decideNext(fresh);
    return {
      ok: true,
      next,
      hasProfile: fresh.profile_completed_at != null,
      user: rowToMe(fresh),
    };
  },

  /**
   * Resolves the cookie → DB session. Returns null when the cookie is
   * missing, malformed, expired, or revoked. Touches `last_seen_at` for
   * live sessions.
   */
  async resolveCookieSession(): Promise<{
    user: UserRow;
    sessionId: string;
    rememberMe: boolean;
  } | null> {
    const token = readSessionCookie();
    if (!token) return null;
    const session = await sessionsRepo.findLiveByTokenHash(sha256Hex(token));
    if (!session) return null;
    const user = await usersRepo.findById(session.user_id);
    if (!user) return null;
    await sessionsRepo.touch(session.id);
    return { user, sessionId: session.id, rememberMe: session.remember_me };
  },

  async logout(): Promise<void> {
    const token = readSessionCookie();
    if (token) {
      const session = await sessionsRepo.findLiveByTokenHash(sha256Hex(token));
      if (session) {
        await sessionsRepo.revoke(session.id);
        await auditRepo.write({
          actorUserId: session.user_id,
          action: "session_revoked",
          entityType: "sessions",
          entityId: session.id,
          metadata: { reason: "logout" },
        });
      }
    }
    clearSessionCookie();
  },

  rowToMe,
};

/* -------------------------------------------------------------------------- */
/*  Errors                                                                    */
/* -------------------------------------------------------------------------- */

export class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}
export class BadRequestError extends HttpError {
  constructor(code: string, message: string) {
    super(400, code, message);
  }
}
export class UnauthorizedError extends HttpError {
  constructor(code: string, message: string) {
    super(401, code, message);
  }
}
export class ForbiddenError extends HttpError {
  constructor(code: string, message: string) {
    super(403, code, message);
  }
}
export class GoneError extends HttpError {
  constructor(code: string, message: string) {
    super(410, code, message);
  }
}
export class LockedError extends HttpError {
  constructor(code: string, message: string) {
    super(423, code, message);
  }
}
export class TooManyError extends HttpError {
  constructor(code: string, message: string) {
    super(429, code, message);
  }
}
export class BadGatewayError extends HttpError {
  constructor(code: string, message: string) {
    super(502, code, message);
  }
}
