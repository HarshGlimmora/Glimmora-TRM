/**
 * In-memory mock database for demo flows.
 *
 * No values here are persisted to localStorage; they live for the duration
 * of the page session and reset on full reload — by design.
 */
import type {
  AnyProfile,
  AuditEvent,
  ConsultantProfile,
  LinkGrant,
  TaxpayerProfile,
} from "@/lib/types";

interface DB {
  users: Map<string, AnyProfile>;
  links: Map<string, LinkGrant>;
  audit: AuditEvent[];
  otpAttempts: Map<string, { count: number; lockedUntil?: number }>;
}

const sampleTaxpayer: TaxpayerProfile = {
  id: "usr_demo_taxpayer",
  role: "taxpayer",
  displayName: "Demo Taxpayer",
  email: "taxpayer@demo.glimmora.in",
  mobile: "9876543210",
  emailVerified: true,
  mobileVerified: true,
  profileStatus: "verified",
  profileCompleteness: 95,
  createdAt: "2026-03-12T09:14:00Z",
  lastLoginAt: "2026-05-10T17:22:00Z",
  personal: {
    legalName: "Aanya R. Kothari",
    fatherName: "Rohan Kothari",
    dateOfBirth: "1991-08-04",
    gender: "female",
    residentialStatus: "resident",
  },
  identity: {
    panMasked: "ABK•••••2C",
    panEntity: "Individual",
    aadhaarMasked: "XXXX XXXX 4421",
    panVerified: true,
    aadhaarVerified: true,
  },
  address: {
    line1: "Flat 9B, Brindavan Apartments",
    line2: "Indiranagar 2nd Stage",
    city: "Bengaluru",
    state: "Karnataka",
    pin: "560038",
    country: "IN",
  },
  taxProfile: {
    primaryIncomeType: "salary",
    regimePreference: "new",
    hasBusinessIncome: false,
    consents: {
      documentProcessing: true,
      aiAnalysis: true,
      dataRetention: true,
    },
  },
};

const sampleConsultant: ConsultantProfile = {
  id: "usr_demo_ca",
  role: "consultant",
  displayName: "CA Demo",
  email: "ca@demo.glimmora.in",
  mobile: "9988776655",
  emailVerified: true,
  mobileVerified: true,
  profileStatus: "verified",
  profileCompleteness: 100,
  createdAt: "2026-01-18T11:00:00Z",
  lastLoginAt: "2026-05-12T08:00:00Z",
  personal: {
    legalName: "Vikram Iyer, FCA",
    dateOfBirth: "1978-11-21",
    gender: "male",
  },
  credentials: {
    icaiMembership: "402178",
    cop: true,
    yearsExperience: 17,
    specializations: ["individual_filing", "capital_gains", "business_tax"],
    firmName: "Iyer & Narayan Associates",
    firmPanMasked: "AAFFI•••••K",
  },
  identity: {
    panMasked: "AVK•••••3M",
    aadhaarMasked: "XXXX XXXX 8810",
    panVerified: true,
    aadhaarVerified: true,
  },
  practice: {
    line1: "Suite 402, Prestige Atrium",
    line2: "Central Street, Ashok Nagar",
    city: "Bengaluru",
    state: "Karnataka",
    pin: "560001",
    country: "IN",
    workingHours: "Mon–Fri · 10:00–18:30",
  },
};

const sampleGrant: LinkGrant = {
  id: "lnk_seed_1",
  consultantId: "usr_demo_ca",
  taxpayerId: "usr_demo_taxpayer",
  consultantName: "CA Vikram Iyer",
  consultantFirm: "Iyer & Narayan Associates",
  taxpayerName: "Aanya R. Kothari",
  taxpayerPanMasked: "ABK•••••2C",
  accessMode: "review_edit",
  status: "active",
  taxYears: ["FY 2024-25"],
  message: "Reviewing capital gains schedule and 80C deductions for this FY.",
  requestedBy: "taxpayer",
  requestedAt: "2026-04-21T12:08:00Z",
  respondedAt: "2026-04-21T17:42:00Z",
  expiresAt: "2026-08-31T23:59:59Z",
};

const db: DB = {
  users: new Map<string, AnyProfile>([
    [sampleTaxpayer.id, sampleTaxpayer],
    [sampleConsultant.id, sampleConsultant],
  ]),
  links: new Map<string, LinkGrant>([[sampleGrant.id, sampleGrant]]),
  audit: [
    {
      id: "evt_seed_1",
      at: "2026-05-10T17:22:00Z",
      actor: "Aanya R. Kothari",
      actorRole: "taxpayer",
      action: "login",
      channel: "email",
      ip: "•••.•••.•••.42",
    },
    {
      id: "evt_seed_2",
      at: "2026-04-21T17:42:00Z",
      actor: "CA Vikram Iyer",
      actorRole: "consultant",
      action: "link_accepted",
      target: "Aanya R. Kothari",
    },
  ],
  otpAttempts: new Map(),
};

export const mockDB = db;
export const seeded = { sampleTaxpayer, sampleConsultant, sampleGrant };
