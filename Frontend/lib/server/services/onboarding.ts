import "server-only";
import { withTransaction } from "@/lib/server/db/client";
import { auditRepo } from "@/lib/server/repos/audit";
import { usersRepo } from "@/lib/server/repos/identity";
import { onboardingRepo, type OnboardingRow } from "@/lib/server/repos/onboarding";
import {
  consultantProfilesRepo,
  taxpayerProfilesRepo,
} from "@/lib/server/repos/profiles";
import { BadRequestError } from "@/lib/server/services/auth";

const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
const AADHAAR_DIGITS_RE = /^\d{12}$/;

function panMasked(pan: string): string {
  return `${pan.slice(0, 3)}•••••${pan.slice(8)}`;
}

function aadhaarLast4(aadhaar: string): string {
  return aadhaar.slice(-4);
}

/**
 * Convert Postgres unique-violation errors raised by the users UPDATE into
 * friendly BadRequestErrors. The only unique column we still touch on users
 * from submit{Taxpayer,Consultant} is `pan` (login email/phone live on `users`
 * but are set by send-otp, never by submit). A PAN collision means the same
 * Permanent Account Number is already attached to a different live account —
 * almost always the user's own earlier row from before this fix landed.
 */
function rethrowUniqueViolation(err: unknown): void {
  const e = err as { code?: string; constraint?: string } | null;
  if (e?.code !== "23505") return;
  if (e.constraint === "uq_users_pan") {
    throw new BadRequestError(
      "PAN_ALREADY_LINKED",
      "This PAN is already linked to another Glimmora account. " +
        "Sign in with the email or phone you used to create that account, " +
        "or contact support to merge the two.",
    );
  }
  if (e.constraint === "uq_users_email" || e.constraint === "uq_users_phone") {
    // Should be unreachable — submit no longer writes these columns. Keep
    // the friendly message as defence-in-depth.
    throw new BadRequestError(
      "IDENTIFIER_TAKEN",
      "That email or phone is already linked to another Glimmora account.",
    );
  }
}

export interface TaxpayerSubmit {
  personal: {
    displayName: string;
    legalName: string;
    fatherName?: string;
    dateOfBirth: string;
    gender: "male" | "female" | "other" | "prefer_not_to_say";
    residentialStatus: "resident" | "nri" | "rnor";
    age: number;
    maritalStatus: "single" | "married" | "divorced" | "widowed" | "separated";
  };
  contact: {
    email: string;
    mobile: string;
  };
  address: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pin: string;
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
  };
  rawPan: string;
  rawAadhaar: string;
}

export interface ConsultantSubmit {
  personal: {
    displayName: string;
    legalName: string;
    dateOfBirth: string;
    gender: "male" | "female" | "other" | "prefer_not_to_say";
  };
  credentials: {
    icaiMembership: string;
    cop: boolean;
    yearsExperience: number;
    specializations: string[];
    firmName?: string;
  };
  contact: {
    email: string;
    mobile: string;
  };
  practice: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pin: string;
  };
  rawPan: string;
  rawAadhaar: string;
}

export const onboardingService = {
  async getProgress(userId: string): Promise<OnboardingRow> {
    return onboardingRepo.getOrInit(userId);
  },

  async setRole(args: {
    userId: string;
    role: "taxpayer" | "consultant";
  }): Promise<OnboardingRow> {
    await withTransaction(async (client) => {
      await usersRepo.setRole({ userId: args.userId, role: args.role, client });
      await onboardingRepo.setRole({
        userId: args.userId,
        role: args.role,
        client,
      });
      await auditRepo.write(
        {
          actorUserId: args.userId,
          action: "role_selected",
          entityType: "users",
          entityId: args.userId,
          metadata: { role: args.role },
        },
        client,
      );
    });
    return onboardingRepo.getOrInit(args.userId);
  },

  async patchProgress(args: {
    userId: string;
    step?: number;
    personal?: Record<string, unknown>;
    contact?: Record<string, unknown>;
    address?: Record<string, unknown>;
    tax_profile?: Record<string, unknown>;
    credentials?: Record<string, unknown>;
    identity_flags?: Record<string, unknown>;
  }): Promise<OnboardingRow> {
    const row = await onboardingRepo.patch(args);
    await auditRepo.write({
      actorUserId: args.userId,
      action: "onboarding_step_saved",
      entityType: "onboarding_progress",
      entityId: args.userId,
      metadata: { step: row.step },
    });
    return row;
  },

  async submitTaxpayer(args: {
    userId: string;
    payload: TaxpayerSubmit;
  }): Promise<void> {
    const p = args.payload;
    const pan = p.rawPan.trim().toUpperCase();
    if (!PAN_RE.test(pan)) {
      throw new BadRequestError("PAN_FORMAT", "PAN format is invalid.");
    }
    const aadhaarDigits = p.rawAadhaar.replace(/\D/g, "");
    if (!AADHAAR_DIGITS_RE.test(aadhaarDigits)) {
      throw new BadRequestError("AADHAAR_FORMAT", "Aadhaar must be 12 digits.");
    }
    if (!p.taxProfile.primaryIncomeType) {
      throw new BadRequestError("TAX_PROFILE_INCOMPLETE", "Tax profile is incomplete.");
    }

    const contactEmail = p.contact.email
      ? p.contact.email.trim().toLowerCase()
      : null;
    const contactPhone = p.contact.mobile
      ? p.contact.mobile.replace(/\D/g, "").slice(-10)
      : null;

    await withTransaction(async (client) => {
      // INVARIANT: users.email and users.phone are the LOGIN identifiers.
      // They were set at send-otp time by findOrCreateByIdentifier and verified
      // by verify-otp; they are NEVER touched here. Doing so would (a) allow
      // a profile form to hijack a login identifier, and (b) race against the
      // partial unique indexes uq_users_email / uq_users_phone.
      // Contact-step values live on taxpayer_profiles.contact_{email,phone}
      // where they are explicitly non-unique.
      try {
        await client.query(
          `UPDATE users SET
              display_name = $2,
              legal_name = $3,
              pan = $4,
              pan_verified_at = COALESCE(pan_verified_at, NOW()),
              has_business_income = $5,
              city = $6,
              state = $7,
              pincode = $8,
              role = 'taxpayer',
              profile_completed_at = NOW(),
              last_login_at = NOW()
           WHERE id = $1`,
          [
            args.userId,
            p.personal.displayName,
            p.personal.legalName,
            pan,
            p.taxProfile.hasBusinessIncome,
            p.address.city,
            p.address.state,
            p.address.pin,
          ],
        );
      } catch (err) {
        rethrowUniqueViolation(err);
        throw err;
      }

      await taxpayerProfilesRepo.upsert({
        userId: args.userId,
        fatherName: p.personal.fatherName ?? null,
        dateOfBirth: p.personal.dateOfBirth,
        gender: p.personal.gender,
        residentialStatus: p.personal.residentialStatus,
        primaryIncomeType: p.taxProfile.primaryIncomeType,
        regimePreference: p.taxProfile.regimePreference ?? null,
        aadhaarLast4: aadhaarLast4(aadhaarDigits),
        aadhaarVerified: true,
        addressLine1: p.address.line1,
        addressLine2: p.address.line2 ?? null,
        contactEmail,
        contactPhone,
        age: p.personal.age,
        maritalStatus: p.personal.maritalStatus,
        client,
      });

      await onboardingRepo.clearAfterCompletion(args.userId, client);

      await auditRepo.write(
        {
          actorUserId: args.userId,
          action: "profile_completed",
          entityType: "users",
          entityId: args.userId,
          metadata: {
            role: "taxpayer",
            pan_masked: panMasked(pan),
            aadhaar_last4: aadhaarLast4(aadhaarDigits),
          },
        },
        client,
      );
    });
  },

  async submitConsultant(args: {
    userId: string;
    payload: ConsultantSubmit;
  }): Promise<void> {
    const p = args.payload;
    const pan = p.rawPan.trim().toUpperCase();
    if (!PAN_RE.test(pan)) {
      throw new BadRequestError("PAN_FORMAT", "PAN format is invalid.");
    }
    const aadhaarDigits = p.rawAadhaar.replace(/\D/g, "");
    if (!AADHAAR_DIGITS_RE.test(aadhaarDigits)) {
      throw new BadRequestError("AADHAAR_FORMAT", "Aadhaar must be 12 digits.");
    }
    if (p.credentials.specializations.length === 0) {
      throw new BadRequestError(
        "SPECIALIZATIONS_REQUIRED",
        "Pick at least one specialization.",
      );
    }

    const contactEmail = p.contact.email
      ? p.contact.email.trim().toLowerCase()
      : null;
    const contactPhone = p.contact.mobile
      ? p.contact.mobile.replace(/\D/g, "").slice(-10)
      : null;

    await withTransaction(async (client) => {
      // Same login-identifier invariant as submitTaxpayer: the contact step
      // never writes to users.{email,phone}. Contact values live on
      // ca_profiles.contact_{email,phone}.
      try {
        await client.query(
          `UPDATE users SET
              display_name = $2,
              legal_name = $3,
              pan = $4,
              pan_verified_at = COALESCE(pan_verified_at, NOW()),
              city = $5,
              state = $6,
              pincode = $7,
              role = 'consultant',
              profile_completed_at = NOW(),
              last_login_at = NOW()
           WHERE id = $1`,
          [
            args.userId,
            p.personal.displayName,
            p.personal.legalName,
            pan,
            p.practice.city,
            p.practice.state,
            p.practice.pin,
          ],
        );
      } catch (err) {
        rethrowUniqueViolation(err);
        throw err;
      }

      await consultantProfilesRepo.upsert({
        userId: args.userId,
        icaiMembership: p.credentials.icaiMembership,
        bio: p.credentials.firmName ?? null,
        specializations: p.credentials.specializations,
        yearsExperience: p.credentials.yearsExperience,
        contactEmail,
        contactPhone,
        client,
      });

      await onboardingRepo.clearAfterCompletion(args.userId, client);

      await auditRepo.write(
        {
          actorUserId: args.userId,
          action: "profile_completed",
          entityType: "users",
          entityId: args.userId,
          metadata: {
            role: "consultant",
            pan_masked: panMasked(pan),
            aadhaar_last4: aadhaarLast4(aadhaarDigits),
            icai: p.credentials.icaiMembership,
          },
        },
        client,
      );
    });
  },
};
