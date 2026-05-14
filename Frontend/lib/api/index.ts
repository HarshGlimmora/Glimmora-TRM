/**
 * Typed service layer. Swap this module for a real backend client and
 * the rest of the app is unaffected. Every call returns a Promise<T> with
 * a small artificial latency to mimic network conditions.
 */
import { mockDB } from "@/lib/api/mock-db";
import type {
  AccessMode,
  ActivityItem,
  AnyProfile,
  ConsultantProfile,
  DashboardAlert,
  DashboardSummary,
  GrantStatus,
  IdentityChannel,
  LinkGrant,
  Role,
  TaxpayerProfile,
} from "@/lib/types";
import { maskAadhaar, maskPan } from "@/lib/security/mask";
import {
  validateAadhaar,
  validateEmail,
  validateMobile,
  validatePan,
  panEntityType,
  validateOtp,
} from "@/lib/validation/identity";

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function delay<T>(value: T, ms = 320): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function fail(code: string, message: string): never {
  const err = new Error(message) as Error & { code?: string };
  err.code = code;
  throw err;
}

function uid(prefix = "id"): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${ts}${rand}`;
}

/* -------------------------------------------------------------------------- */
/*  Auth + OTP                                                                */
/*  These now call real /api/auth/* endpoints. Sensitive OTP material         */
/*  never leaves the server.                                                  */
/* -------------------------------------------------------------------------- */

export interface BeginLoginResult {
  channel: IdentityChannel;
  target: string;
  /** Masked target for display, e.g. ka•••••@example.com */
  display: string;
  otpId: string;
  /** Seconds until a new OTP can be requested */
  cooldownSec: number;
  /** Optional UX hint from the server, e.g. mobile-forwarded note. */
  hint?: string | null;
  sentVia?: "smtp" | "resend" | "console";
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "same-origin",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* keep as null */
  }
  if (!res.ok) {
    const errObj =
      (json as { error?: string; code?: string } | null) ?? {};
    const message = errObj.error ?? `Request failed (${res.status})`;
    const err = new Error(message) as Error & { code?: string; status?: number };
    err.code = errObj.code;
    err.status = res.status;
    throw err;
  }
  return json as T;
}

export async function beginLogin(
  identifier: string,
  channel?: IdentityChannel,
): Promise<BeginLoginResult> {
  const looksEmail = identifier.includes("@");
  const ch: IdentityChannel = channel ?? (looksEmail ? "email" : "mobile");

  if (ch === "email") {
    const r = validateEmail(identifier);
    if (!r.ok) fail(r.code, r.message);
  } else {
    const r = validateMobile(identifier);
    if (!r.ok) fail(r.code, r.message);
  }

  const result = await postJson<{
    otpId: string;
    channel: IdentityChannel;
    target: string;
    display: string;
    cooldownSec: number;
    hint?: string | null;
    sentVia?: "smtp" | "resend" | "console";
  }>("/api/auth/send-otp", { identifier, channel: ch });

  return {
    channel: result.channel,
    target: result.target,
    display: result.display,
    otpId: result.otpId,
    cooldownSec: result.cooldownSec,
    hint: result.hint ?? null,
    sentVia: result.sentVia,
  };
}

export interface VerifyOtpResult {
  ok: true;
  sessionId: string;
  hasProfile: boolean;
  role?: Role;
  profileId?: string;
  isFirstTime: boolean;
}

export async function verifyOtp(args: {
  otpId: string;
  code: string;
  identifier: string;
}): Promise<VerifyOtpResult> {
  const r = validateOtp(args.code);
  if (!r.ok) fail(r.code, r.message);

  return postJson<VerifyOtpResult>("/api/auth/verify-otp", {
    otpId: args.otpId,
    code: args.code,
    identifier: args.identifier,
  });
}

export async function resendOtp(otpId: string): Promise<{ cooldownSec: number }> {
  return postJson<{ cooldownSec: number }>("/api/auth/resend-otp", {
    otpId,
  });
}

/* -------------------------------------------------------------------------- */
/*  Profile creation                                                          */
/* -------------------------------------------------------------------------- */

export type TaxpayerDraft = Omit<
  TaxpayerProfile,
  | "id"
  | "role"
  | "profileStatus"
  | "profileCompleteness"
  | "createdAt"
  | "lastLoginAt"
  | "emailVerified"
  | "mobileVerified"
  | "identity"
> & {
  /** Raw values entered during onboarding — masked in flight, never persisted. */
  rawPan: string;
  rawAadhaar: string;
};

export type ConsultantDraft = Omit<
  ConsultantProfile,
  | "id"
  | "role"
  | "profileStatus"
  | "profileCompleteness"
  | "createdAt"
  | "lastLoginAt"
  | "emailVerified"
  | "mobileVerified"
  | "identity"
> & {
  rawPan: string;
  rawAadhaar: string;
};

export async function createTaxpayerProfile(
  draft: TaxpayerDraft,
): Promise<TaxpayerProfile> {
  const panR = validatePan(draft.rawPan);
  if (!panR.ok) fail(panR.code, panR.message);
  const aR = validateAadhaar(draft.rawAadhaar);
  if (!aR.ok) fail(aR.code, aR.message);

  const profile: TaxpayerProfile = {
    id: uid("usr"),
    role: "taxpayer",
    displayName: draft.displayName,
    email: draft.email,
    mobile: draft.mobile,
    emailVerified: true,
    mobileVerified: true,
    profileStatus: "verified",
    profileCompleteness: 100,
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
    personal: draft.personal,
    identity: {
      panMasked: maskPan(draft.rawPan),
      panEntity: panEntityType(draft.rawPan),
      aadhaarMasked: maskAadhaar(draft.rawAadhaar),
      panVerified: true,
      aadhaarVerified: true,
    },
    address: draft.address,
    taxProfile: draft.taxProfile,
  };
  mockDB.users.set(profile.id, profile);
  return delay(profile, 520);
}

export async function createConsultantProfile(
  draft: ConsultantDraft,
): Promise<ConsultantProfile> {
  const panR = validatePan(draft.rawPan);
  if (!panR.ok) fail(panR.code, panR.message);
  const aR = validateAadhaar(draft.rawAadhaar);
  if (!aR.ok) fail(aR.code, aR.message);

  const profile: ConsultantProfile = {
    id: uid("usr"),
    role: "consultant",
    displayName: draft.displayName,
    email: draft.email,
    mobile: draft.mobile,
    emailVerified: true,
    mobileVerified: true,
    profileStatus: "verified",
    profileCompleteness: 100,
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
    personal: draft.personal,
    credentials: draft.credentials,
    identity: {
      panMasked: maskPan(draft.rawPan),
      aadhaarMasked: maskAadhaar(draft.rawAadhaar),
      panVerified: true,
      aadhaarVerified: true,
    },
    practice: draft.practice,
  };
  mockDB.users.set(profile.id, profile);
  return delay(profile, 520);
}

/* -------------------------------------------------------------------------- */
/*  Linking                                                                   */
/* -------------------------------------------------------------------------- */

export async function listLinksFor(userId: string): Promise<LinkGrant[]> {
  return delay(
    Array.from(mockDB.links.values()).filter(
      (g) => g.consultantId === userId || g.taxpayerId === userId,
    ),
  );
}

export async function requestLink(args: {
  fromRole: Role;
  fromUserId: string;
  fromName: string;
  consultantPan?: string;
  taxpayerPan?: string;
  accessMode: AccessMode;
  taxYears: string[];
  message?: string;
}): Promise<LinkGrant> {
  if (args.fromRole === "taxpayer") {
    if (!args.consultantPan) fail("PAN_REQUIRED", "Consultant PAN is required.");
    const pr = validatePan(args.consultantPan);
    if (!pr.ok) fail(pr.code, pr.message);
  } else {
    if (!args.taxpayerPan) fail("PAN_REQUIRED", "Taxpayer PAN is required.");
    const pr = validatePan(args.taxpayerPan);
    if (!pr.ok) fail(pr.code, pr.message);
  }

  // For demo: link goes to the seeded counterparty
  const counterparty =
    args.fromRole === "taxpayer"
      ? Array.from(mockDB.users.values()).find((u) => u.role === "consultant")
      : Array.from(mockDB.users.values()).find((u) => u.role === "taxpayer");

  const me = mockDB.users.get(args.fromUserId);

  const grant: LinkGrant = {
    id: uid("lnk"),
    consultantId:
      args.fromRole === "consultant" ? args.fromUserId : counterparty?.id ?? "usr_unknown",
    taxpayerId:
      args.fromRole === "taxpayer" ? args.fromUserId : counterparty?.id ?? "usr_unknown",
    consultantName:
      args.fromRole === "consultant"
        ? args.fromName
        : counterparty?.displayName ?? "Consultant",
    consultantFirm:
      counterparty && counterparty.role === "consultant"
        ? counterparty.credentials.firmName
        : undefined,
    taxpayerName:
      args.fromRole === "taxpayer"
        ? args.fromName
        : counterparty?.displayName ?? "Taxpayer",
    taxpayerPanMasked:
      args.fromRole === "taxpayer"
        ? me?.role === "taxpayer"
          ? me.identity.panMasked
          : maskPan(args.taxpayerPan ?? "")
        : maskPan(args.taxpayerPan ?? ""),
    accessMode: args.accessMode,
    status: "pending",
    taxYears: args.taxYears,
    message: args.message,
    requestedBy: args.fromRole,
    requestedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
  };
  mockDB.links.set(grant.id, grant);
  return delay(grant);
}

export async function updateLinkStatus(
  id: string,
  status: GrantStatus,
): Promise<LinkGrant> {
  const grant = mockDB.links.get(id);
  if (!grant) fail("LINK_NOT_FOUND", "Link grant not found.");
  const updated: LinkGrant = {
    ...grant,
    status,
    respondedAt: status !== "revoked" ? new Date().toISOString() : grant.respondedAt,
    revokedAt: status === "revoked" ? new Date().toISOString() : undefined,
  };
  mockDB.links.set(id, updated);
  return delay(updated);
}

/* -------------------------------------------------------------------------- */
/*  Dashboard                                                                 */
/* -------------------------------------------------------------------------- */

export async function fetchDashboard(userId: string): Promise<DashboardSummary> {
  const profile = mockDB.users.get(userId);
  if (!profile) fail("USER_NOT_FOUND", "Profile not found.");

  const links = (await listLinksFor(userId)).filter((l) => l.status !== "rejected");

  const alerts: DashboardAlert[] =
    profile.role === "taxpayer"
      ? [
          {
            id: "al_filing",
            level: "info",
            title: "FY 2024-25 return window is open",
            body: "You're eligible to begin filing once your linked consultant accepts the access request.",
            cta: { label: "Review connections", href: "/connections" },
            createdAt: new Date().toISOString(),
          },
          {
            id: "al_consent",
            level: "warning",
            title: "Consent renewal due in 8 days",
            body: "Your data retention consent expires on 2026-05-21. Renewing keeps your filings auditable.",
            createdAt: "2026-05-13T08:00:00Z",
          },
        ]
      : [
          {
            id: "al_client",
            level: "info",
            title: "1 new taxpayer request",
            body: "Aanya R. Kothari has requested review_edit access for FY 2024-25.",
            cta: { label: "Open requests", href: "/connections" },
            createdAt: new Date().toISOString(),
          },
        ];

  const activity: ActivityItem[] =
    profile.role === "taxpayer"
      ? [
          {
            id: "ac1",
            at: "2026-05-10T17:22:00Z",
            title: "Signed in",
            description: "From a known device · Bengaluru, IN",
            kind: "system",
          },
          {
            id: "ac2",
            at: "2026-04-21T17:42:00Z",
            title: "CA Vikram Iyer accepted access",
            description: "Mode: review_edit · FY 2024-25 · Expires 2026-08-31",
            kind: "linking",
          },
          {
            id: "ac3",
            at: "2026-04-12T09:08:00Z",
            title: "PAN and Aadhaar verified",
            description: "Identity verification recorded in audit log",
            kind: "verification",
          },
          {
            id: "ac4",
            at: "2026-03-12T09:14:00Z",
            title: "Profile created",
            kind: "profile",
          },
        ]
      : [
          {
            id: "ac1",
            at: "2026-05-12T08:00:00Z",
            title: "Signed in",
            description: "From a known device · Bengaluru, IN",
            kind: "system",
          },
          {
            id: "ac2",
            at: "2026-04-21T17:42:00Z",
            title: "Accepted access for Aanya R. Kothari",
            description: "Mode: review_edit · FY 2024-25",
            kind: "linking",
          },
          {
            id: "ac3",
            at: "2026-04-04T16:30:00Z",
            title: "ICAI membership verified",
            kind: "verification",
          },
        ];

  const stats =
    profile.role === "taxpayer"
      ? [
          { label: "Profile", value: `${profile.profileCompleteness}%`, helper: "Complete" },
          {
            label: "Identity",
            value: "Verified",
            helper: "PAN · Aadhaar",
            tone: "success" as const,
          },
          {
            label: "Linked CAs",
            value: links.filter((l) => l.status === "active").length,
            helper: "Active grants",
          },
          {
            label: "Open actions",
            value: 1,
            helper: "Renew consent",
            tone: "warning" as const,
          },
        ]
      : [
          {
            label: "Clients",
            value: links.filter((l) => l.status === "active").length,
            helper: "Active grants",
          },
          {
            label: "Pending",
            value: links.filter((l) => l.status === "pending").length,
            helper: "Awaiting your decision",
            tone: "warning" as const,
          },
          { label: "FY 2024-25", value: 4, helper: "Filings underway" },
          {
            label: "ICAI",
            value: (profile as ConsultantProfile).credentials.icaiMembership,
            helper: "Membership verified",
            tone: "accent" as const,
          },
        ];

  return delay({
    profile,
    alerts,
    activity,
    links,
    upcoming:
      profile.role === "taxpayer"
        ? [
            {
              title: "Consent renewal — data retention",
              dueOn: "2026-05-21",
              note: "Required to keep older filings auditable.",
            },
            {
              title: "Form 16 expected from employer",
              dueOn: "2026-06-15",
              note: "Will be auto-detected once uploaded.",
            },
          ]
        : [
            {
              title: "Aanya Kothari — FY 2024-25",
              dueOn: "2026-06-30",
              note: "Capital gains review",
            },
            {
              title: "Internal — Quarterly compliance memo",
              dueOn: "2026-06-10",
            },
          ],
    stats,
  });
}

/* -------------------------------------------------------------------------- */
/*  Profile lookup                                                            */
/* -------------------------------------------------------------------------- */

export async function getProfile(id: string): Promise<AnyProfile | null> {
  return delay(mockDB.users.get(id) ?? null);
}

export { mockDB };
