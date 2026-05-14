/**
 * Core domain types for Glimmora TRM frontend.
 * Sensitive fields are marked with `Sensitive<T>` (a brand) so we can grep
 * for any place they cross the persistence boundary.
 */

export type Sensitive<T> = T & { readonly __sensitive?: true };

export type Role = "taxpayer" | "consultant";
export type IdentityChannel = "email" | "mobile";

export type VerificationStatus =
  | "unverified"
  | "pending"
  | "verified"
  | "expired"
  | "failed";

export type ProfileStatus =
  | "not_started"
  | "draft"
  | "submitted"
  | "verified"
  | "rejected";

export interface BaseUser {
  id: string;
  role: Role;
  /** Display name, never the raw legal name from documents until verified */
  displayName: string;
  email: string;
  /** Stored masked, never raw, after verification */
  mobile: string;
  emailVerified: boolean;
  mobileVerified: boolean;
  profileStatus: ProfileStatus;
  profileCompleteness: number; // 0-100
  createdAt: string;
  lastLoginAt: string;
}

export interface TaxpayerProfile extends BaseUser {
  role: "taxpayer";
  personal: {
    legalName: string;
    fatherName?: string;
    dateOfBirth: string; // YYYY-MM-DD
    gender: "male" | "female" | "other" | "prefer_not_to_say";
    residentialStatus: "resident" | "nri" | "rnor";
    age?: number;
    maritalStatus?:
      | "single"
      | "married"
      | "divorced"
      | "widowed"
      | "separated";
  };
  identity: {
    panMasked: string;
    panEntity: string;
    aadhaarMasked: string;
    panVerified: boolean;
    aadhaarVerified: boolean;
  };
  address: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pin: string;
    country: "IN";
  };
  taxProfile: {
    primaryIncomeType:
      | "salary"
      | "business"
      | "professional"
      | "capital_gains"
      | "house_property"
      | "other";
    regimePreference?: "old" | "new";
    hasBusinessIncome: boolean;
    consents: {
      documentProcessing: boolean;
      aiAnalysis: boolean;
      dataRetention: boolean;
    };
  };
}

export interface ConsultantProfile extends BaseUser {
  role: "consultant";
  personal: {
    legalName: string;
    dateOfBirth: string;
    gender: "male" | "female" | "other" | "prefer_not_to_say";
  };
  credentials: {
    icaiMembership: string;
    cop: boolean; // certificate of practice
    yearsExperience: number;
    specializations: Specialization[];
    firmName?: string;
    firmPanMasked?: string;
  };
  identity: {
    panMasked: string;
    aadhaarMasked: string;
    panVerified: boolean;
    aadhaarVerified: boolean;
  };
  practice: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pin: string;
    country: "IN";
    workingHours?: string;
  };
}

export type Specialization =
  | "individual_filing"
  | "business_tax"
  | "international_tax"
  | "gst"
  | "capital_gains"
  | "transfer_pricing"
  | "litigation"
  | "audit";

export const SPECIALIZATION_LABELS: Record<Specialization, string> = {
  individual_filing: "Individual filing",
  business_tax: "Business tax",
  international_tax: "International tax",
  gst: "GST",
  capital_gains: "Capital gains",
  transfer_pricing: "Transfer pricing",
  litigation: "Litigation",
  audit: "Audit",
};

export type AnyProfile = TaxpayerProfile | ConsultantProfile;

/** CA ↔ Taxpayer linking */
export type GrantStatus =
  | "pending"
  | "active"
  | "rejected"
  | "revoked"
  | "expired";

export type AccessMode = "full_access" | "review_edit";

export interface LinkGrant {
  id: string;
  consultantId: string;
  taxpayerId: string;
  consultantName: string;
  consultantFirm?: string;
  taxpayerName: string;
  taxpayerPanMasked: string;
  accessMode: AccessMode;
  status: GrantStatus;
  taxYears: string[];
  message?: string;
  requestedBy: "taxpayer" | "consultant";
  requestedAt: string;
  respondedAt?: string;
  revokedAt?: string;
  expiresAt?: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  actorRole: Role | "system";
  action:
    | "login"
    | "otp_sent"
    | "otp_verified"
    | "profile_updated"
    | "identity_verified"
    | "consent_granted"
    | "consent_revoked"
    | "link_requested"
    | "link_accepted"
    | "link_rejected"
    | "link_revoked"
    | "session_expired";
  target?: string;
  channel?: IdentityChannel;
  ip?: string;
  meta?: Record<string, string>;
}

export interface DashboardAlert {
  id: string;
  level: "info" | "warning" | "error" | "success";
  title: string;
  body: string;
  cta?: { label: string; href: string };
  createdAt: string;
}

export interface ActivityItem {
  id: string;
  at: string;
  title: string;
  description?: string;
  kind: "verification" | "linking" | "profile" | "system" | "advisory";
  actor?: string;
}

/** Public dashboard summary served to either role */
export interface DashboardSummary {
  profile: AnyProfile;
  alerts: DashboardAlert[];
  activity: ActivityItem[];
  links: LinkGrant[];
  upcoming?: {
    title: string;
    dueOn: string; // YYYY-MM-DD
    note?: string;
  }[];
  stats: {
    label: string;
    value: string | number;
    helper?: string;
    tone?: "default" | "accent" | "warning" | "success";
  }[];
}
