/**
 * In-memory OTP store with TTL, attempt tracking, and resend cooldown.
 *
 * Server-only. Attached to globalThis so Next.js's dev-mode HMR doesn't
 * blow away in-flight verifications.
 *
 * Replace this with Redis / Postgres if you need horizontal scaling.
 */

import crypto from "node:crypto";

export interface OtpRecord {
  otpId: string;
  /** The 6-digit code — kept only in server memory, never returned to client. */
  code: string;
  /** The identifier the OTP belongs to (email or 10-digit mobile). */
  identifier: string;
  channel: "email" | "mobile";
  createdAt: number;
  expiresAt: number;
  attempts: number;
  /** Timestamp when the OTP was last sent — used for resend cooldown. */
  lastSentAt: number;
  /** If set, no verification accepted until this time (ms epoch). */
  lockedUntil?: number;
}

type Store = Map<string, OtpRecord>;

declare global {
  // eslint-disable-next-line no-var
  var __glmra_otp_store: Store | undefined;
  // eslint-disable-next-line no-var
  var __glmra_otp_sweeper: NodeJS.Timeout | undefined;
}

const store: Store =
  globalThis.__glmra_otp_store ??
  (globalThis.__glmra_otp_store = new Map<string, OtpRecord>());

if (!globalThis.__glmra_otp_sweeper) {
  globalThis.__glmra_otp_sweeper = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of store.entries()) {
      if (v.expiresAt < now - 60_000) store.delete(k);
    }
  }, 30_000).unref?.() as unknown as NodeJS.Timeout;
}

export function generateOtp(): string {
  // 6 digits, zero-padded, cryptographically random
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(6, "0");
}

export function generateOtpId(): string {
  return `otp_${crypto.randomBytes(12).toString("hex")}`;
}

export function createOtp(args: {
  identifier: string;
  channel: "email" | "mobile";
  ttlMs: number;
}): OtpRecord {
  const now = Date.now();
  const otpId = generateOtpId();
  const record: OtpRecord = {
    otpId,
    code: generateOtp(),
    identifier: args.identifier,
    channel: args.channel,
    createdAt: now,
    expiresAt: now + args.ttlMs,
    attempts: 0,
    lastSentAt: now,
  };
  store.set(otpId, record);
  return record;
}

export function getOtp(otpId: string): OtpRecord | undefined {
  const r = store.get(otpId);
  if (!r) return undefined;
  if (r.expiresAt < Date.now()) {
    store.delete(otpId);
    return undefined;
  }
  return r;
}

export function rotateOtp(
  otpId: string,
  ttlMs: number,
): OtpRecord | undefined {
  const r = store.get(otpId);
  if (!r) return undefined;
  const now = Date.now();
  r.code = generateOtp();
  r.createdAt = now;
  r.expiresAt = now + ttlMs;
  r.attempts = 0;
  r.lastSentAt = now;
  r.lockedUntil = undefined;
  store.set(otpId, r);
  return r;
}

export function recordAttempt(
  otpId: string,
  ok: boolean,
  maxAttempts: number,
  lockMs: number,
): OtpRecord | undefined {
  const r = store.get(otpId);
  if (!r) return undefined;
  if (ok) {
    store.delete(otpId);
    return r;
  }
  r.attempts += 1;
  if (r.attempts >= maxAttempts) {
    r.lockedUntil = Date.now() + lockMs;
  }
  store.set(otpId, r);
  return r;
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function maskEmailServer(email: string): string {
  if (!email.includes("@")) return email;
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const visible = Math.min(2, Math.max(1, local.length - 2));
  return `${local.slice(0, visible)}${"•".repeat(Math.max(2, local.length - visible))}@${domain}`;
}

export function maskMobileServer(mobile: string): string {
  const digits = mobile.replace(/\D/g, "");
  const last = digits.slice(-10);
  if (last.length !== 10) return mobile;
  return `+91 ${last.slice(0, 2)}••• ${last.slice(7)}`;
}
