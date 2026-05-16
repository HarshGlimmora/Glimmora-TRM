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
  next: string;
  hasProfile: boolean;
  user: {
    id: string;
    role: Role | null;
    email: string | null;
    phone: string | null;
    displayName: string | null;
    profileCompletedAt: string | null;
  };
}

export async function verifyOtp(args: {
  otpId: string;
  code: string;
  identifier: string;
  rememberMe?: boolean;
}): Promise<VerifyOtpResult> {
  const r = validateOtp(args.code);
  if (!r.ok) fail(r.code, r.message);

  return postJson<VerifyOtpResult>("/api/auth/verify-otp", {
    otpId: args.otpId,
    code: args.code,
    rememberMe: Boolean(args.rememberMe),
  });
}

export async function resendOtp(otpId: string): Promise<{ cooldownSec: number }> {
  return postJson<{ cooldownSec: number }>("/api/auth/resend-otp", {
    otpId,
  });
}

export async function setRole(role: Role): Promise<{ next: string }> {
  return postJson<{ next: string }>("/api/auth/set-role", { role });
}

export async function logoutApi(): Promise<void> {
  await postJson<{ ok: true }>("/api/auth/logout", {});
}

/**
 * Dev-only shortcut. Signs the caller in as a pre-baked admin user with a
 * complete profile so we don't burn OTPs during development. Returns 404 in
 * production (the route is gated by NODE_ENV).
 */
export async function adminLogin(
  role: "taxpayer" | "consultant",
): Promise<{
  next: string;
  user: {
    id: string;
    role: Role | null;
    email: string | null;
    phone: string | null;
    displayName: string | null;
  };
}> {
  return postJson<{
    ok: true;
    next: string;
    user: {
      id: string;
      role: Role | null;
      email: string | null;
      phone: string | null;
      displayName: string | null;
    };
  }>("/api/auth/admin-login", { role });
}

/* -------------------------------------------------------------------------- */
/*  Onboarding progress (server-persisted draft)                              */
/* -------------------------------------------------------------------------- */

export interface OnboardingProgress {
  role: Role | null;
  step: number;
  personal: Record<string, unknown>;
  contact: Record<string, unknown>;
  address: Record<string, unknown>;
  taxProfile: Record<string, unknown>;
  credentials: Record<string, unknown>;
  identityFlags: Record<string, unknown>;
}

export async function fetchProgress(): Promise<OnboardingProgress> {
  const res = await fetch("/api/onboarding/progress", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load onboarding progress (${res.status})`);
  return res.json() as Promise<OnboardingProgress>;
}

export async function saveProgress(
  patch: Partial<OnboardingProgress>,
): Promise<OnboardingProgress> {
  const res = await fetch("/api/onboarding/progress", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Failed to save onboarding progress (${res.status})`);
  return res.json() as Promise<OnboardingProgress>;
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
): Promise<{ next: string; profile: TaxpayerProfile }> {
  const panR = validatePan(draft.rawPan);
  if (!panR.ok) fail(panR.code, panR.message);
  const aR = validateAadhaar(draft.rawAadhaar);
  if (!aR.ok) fail(aR.code, aR.message);

  const res = await postJson<{
    ok: true;
    next: string;
    user: {
      id: string;
      displayName: string | null;
      email: string | null;
      phone: string | null;
    };
  }>("/api/onboarding/taxpayer", {
    personal: draft.personal,
    contact: { email: draft.email, mobile: draft.mobile },
    address: draft.address,
    taxProfile: draft.taxProfile,
    rawPan: draft.rawPan,
    rawAadhaar: draft.rawAadhaar,
  });

  // Synthesise a TaxpayerProfile for the UI cache. The server has stored
  // masked-only identifiers; we never put raw PAN/Aadhaar in client state.
  const profile: TaxpayerProfile = {
    id: res.user.id,
    role: "taxpayer",
    displayName: res.user.displayName ?? draft.displayName,
    email: res.user.email ?? draft.email,
    mobile: res.user.phone ?? draft.mobile,
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
  return { next: res.next, profile };
}

export async function createConsultantProfile(
  draft: ConsultantDraft,
): Promise<{ next: string; profile: ConsultantProfile }> {
  const panR = validatePan(draft.rawPan);
  if (!panR.ok) fail(panR.code, panR.message);
  const aR = validateAadhaar(draft.rawAadhaar);
  if (!aR.ok) fail(aR.code, aR.message);

  const res = await postJson<{
    ok: true;
    next: string;
    user: {
      id: string;
      displayName: string | null;
      email: string | null;
      phone: string | null;
    };
  }>("/api/onboarding/consultant", {
    personal: draft.personal,
    credentials: draft.credentials,
    contact: { email: draft.email, mobile: draft.mobile },
    practice: draft.practice,
    rawPan: draft.rawPan,
    rawAadhaar: draft.rawAadhaar,
  });

  const profile: ConsultantProfile = {
    id: res.user.id,
    role: "consultant",
    displayName: res.user.displayName ?? draft.displayName,
    email: res.user.email ?? draft.email,
    mobile: res.user.phone ?? draft.mobile,
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
  return { next: res.next, profile };
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
/*  Server-backed consultant linking (browse + code)                          */
/*                                                                            */
/*  These hit /api/ca-link/* and /api/consultants/* directly — no mock DB.    */
/*  Kept separate from listLinksFor/requestLink (which are still mock) so     */
/*  the existing PAN-modal flow keeps working unchanged.                      */
/* -------------------------------------------------------------------------- */

export interface DirectoryConsultantDTO {
  id: string;
  displayName: string;
  legalName: string | null;
  firmName: string | null;
  city: string | null;
  state: string | null;
  yearsExperience: number | null;
  specializations: string[];
  bio: string | null;
  acceptingClients: boolean;
}

export interface InviteCodeDTO {
  code: string;
  status: "active" | "revoked";
  maxUses: number;
  usedCount: number;
  createdAt: string;
  expiresAt: string | null;
}

interface ServerGrantDTO {
  id: string;
  consultantId: string;
  taxpayerId: string;
  accessMode: AccessMode;
  status: GrantStatus;
  origin: "directory_request" | "invite_code";
  taxYears: string[];
  message: string | null;
  requestedAt: string;
  decidedAt: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
  counterpartyName: string;
  counterpartyPan: string | null;
  myRoleInGrant: "consultant" | "taxpayer";
}

export async function listDirectoryConsultants(): Promise<DirectoryConsultantDTO[]> {
  const res = await fetch("/api/consultants/directory", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!res.ok) {
    if (res.status === 401) fail("UNAUTHENTICATED", "Sign in first.");
    fail("DIRECTORY_FAILED", "Could not load consultants.");
  }
  const data = (await res.json()) as { consultants: DirectoryConsultantDTO[] };
  return data.consultants;
}

export async function connectConsultantById(args: {
  consultantId: string;
  accessMode?: AccessMode;
  taxYears?: string[];
  message?: string;
}): Promise<ServerGrantDTO> {
  const out = await postJson<{ grant: ServerGrantDTO }>("/api/ca-link/by-id", args);
  return out.grant;
}

export async function connectConsultantByCode(args: {
  code: string;
  message?: string;
}): Promise<ServerGrantDTO> {
  // Strict client-side format guard so we don't even round-trip a bad code.
  if (!/^\d{5}$/.test(args.code)) {
    fail("CODE_FORMAT", "Enter a 5-digit code (digits only).");
  }
  const out = await postJson<{ grant: ServerGrantDTO; consultantId: string }>(
    "/api/ca-link/by-code",
    args,
  );
  return out.grant;
}

export async function getMyInviteCode(): Promise<InviteCodeDTO> {
  const res = await fetch("/api/consultants/my-code", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!res.ok) {
    if (res.status === 401) fail("UNAUTHENTICATED", "Sign in first.");
    const body = (await res.json().catch(() => null)) as {
      error?: string;
      code?: string;
    } | null;
    fail(body?.code ?? "INVITE_CODE_FAILED", body?.error ?? "Could not load code.");
  }
  const data = (await res.json()) as { inviteCode: InviteCodeDTO };
  return data.inviteCode;
}

export async function rotateMyInviteCode(): Promise<InviteCodeDTO> {
  const out = await postJson<{ inviteCode: InviteCodeDTO }>(
    "/api/consultants/my-code",
    {},
  );
  return out.inviteCode;
}

/**
 * Read DB-backed grants for the current user. Mapped into the existing
 * `LinkGrant` shape so the connections page can render server-backed and
 * (legacy) mock grants in the same list.
 */
export async function fetchServerConnections(args: {
  myRole: Role;
  myName: string;
  myPanMasked: string;
}): Promise<LinkGrant[]> {
  const res = await fetch("/api/ca-link", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!res.ok) {
    if (res.status === 401) return [];
    return [];
  }
  const data = (await res.json()) as { grants: ServerGrantDTO[] };
  return data.grants.map((g) => {
    const iAmConsultant = g.myRoleInGrant === "consultant";
    const counterpartyPanMasked = g.counterpartyPan
      ? maskPan(g.counterpartyPan)
      : "—";
    // Origin tells us who initiated: invite_code is always taxpayer-driven;
    // directory_request from this side means the taxpayer pressed Connect.
    const requestedBy: "taxpayer" | "consultant" =
      g.origin === "invite_code" ? "taxpayer" : "taxpayer";
    return {
      id: g.id,
      consultantId: g.consultantId,
      taxpayerId: g.taxpayerId,
      consultantName: iAmConsultant ? args.myName : g.counterpartyName,
      taxpayerName: iAmConsultant ? g.counterpartyName : args.myName,
      taxpayerPanMasked: iAmConsultant ? counterpartyPanMasked : args.myPanMasked,
      accessMode: g.accessMode,
      status: g.status,
      taxYears: g.taxYears,
      message: g.message ?? undefined,
      requestedBy,
      requestedAt: g.requestedAt,
      respondedAt: g.decidedAt ?? undefined,
      revokedAt: g.revokedAt ?? undefined,
      expiresAt: g.expiresAt ?? undefined,
    } satisfies LinkGrant;
  });
}

export async function respondToServerGrant(args: {
  grantId: string;
  action: "accept" | "decline" | "revoke";
}): Promise<void> {
  await fetch("/api/ca-link", {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(args),
  });
}

/* -------------------------------------------------------------------------- */
/*  Dashboard                                                                 */
/* -------------------------------------------------------------------------- */

export async function fetchDashboard(
  userIdOrProfile: string | AnyProfile,
): Promise<DashboardSummary> {
  const profile =
    typeof userIdOrProfile === "string"
      ? mockDB.users.get(userIdOrProfile)
      : userIdOrProfile;
  if (!profile) fail("USER_NOT_FOUND", "Profile not found.");

  const userId = profile.id;
  const links = (await listLinksFor(userId)).filter((l) => l.status !== "rejected");

  const alerts: DashboardAlert[] =
    profile.role === "taxpayer"
      ? [
          {
            id: "al_filing",
            level: "info",
            title: "FY 2025-26 return window is open",
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
            body: "Aanya R. Kothari has requested review_edit access for FY 2025-26.",
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
            description: "Mode: review_edit · FY 2025-26 · Expires 2026-08-31",
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
            description: "Mode: review_edit · FY 2025-26",
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
          { label: "FY 2025-26", value: 4, helper: "Filings underway" },
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
              title: "Aanya Kothari — FY 2025-26",
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
