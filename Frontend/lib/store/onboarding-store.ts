"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Role, Specialization } from "@/lib/types";

/**
 * Onboarding draft state.
 *
 * Note: raw PAN, Aadhaar and any other sensitive identifiers live OUTSIDE
 * this store, in component-local state only, and are never written to sessionStorage.
 * Only display/non-sensitive draft progress is persisted here so the user can
 * resume after a tab refresh.
 */

export interface PersonalDraft {
  displayName: string;
  legalName: string;
  fatherName?: string;
  dateOfBirth: string;
  gender: "male" | "female" | "other" | "prefer_not_to_say" | "";
  residentialStatus?: "resident" | "nri" | "rnor";
  /** Age in years. Asked alongside DOB; the user is the source of truth. */
  age: number | "";
  maritalStatus:
    | "single"
    | "married"
    | "divorced"
    | "widowed"
    | "separated"
    | "";
}

export interface ContactDraft {
  email: string;
  mobile: string;
  emailVerified: boolean;
  mobileVerified: boolean;
}

export interface AddressDraft {
  line1: string;
  line2: string;
  city: string;
  state: string;
  pin: string;
}

export interface TaxProfileDraft {
  primaryIncomeType:
    | "salary"
    | "business"
    | "professional"
    | "capital_gains"
    | "house_property"
    | "other"
    | "";
  regimePreference?: "old" | "new";
  hasBusinessIncome: boolean;
  consents: {
    documentProcessing: boolean;
    aiAnalysis: boolean;
    dataRetention: boolean;
  };
}

export interface CredentialsDraft {
  icaiMembership: string;
  cop: boolean;
  yearsExperience: number;
  specializations: Specialization[];
  firmName: string;
}

export interface IdentityDraftFlags {
  panEntered: boolean;
  panValid: boolean;
  aadhaarEntered: boolean;
  aadhaarValid: boolean;
}

interface OnboardingState {
  role: Role | null;
  step: number;
  personal: PersonalDraft;
  contact: ContactDraft;
  address: AddressDraft;
  taxProfile: TaxProfileDraft;
  credentials: CredentialsDraft;
  identityFlags: IdentityDraftFlags;

  setRole: (role: Role) => void;
  setStep: (step: number) => void;
  patchPersonal: (p: Partial<PersonalDraft>) => void;
  patchContact: (p: Partial<ContactDraft>) => void;
  patchAddress: (p: Partial<AddressDraft>) => void;
  patchTaxProfile: (p: Partial<Omit<TaxProfileDraft, "consents">> & { consents?: Partial<TaxProfileDraft["consents"]> }) => void;
  patchCredentials: (p: Partial<CredentialsDraft>) => void;
  patchIdentityFlags: (p: Partial<IdentityDraftFlags>) => void;
  reset: () => void;
}

const initial = {
  role: null as Role | null,
  step: 0,
  personal: {
    displayName: "",
    legalName: "",
    fatherName: "",
    dateOfBirth: "",
    gender: "" as PersonalDraft["gender"],
    age: "" as PersonalDraft["age"],
    maritalStatus: "" as PersonalDraft["maritalStatus"],
  },
  contact: {
    email: "",
    mobile: "",
    emailVerified: false,
    mobileVerified: false,
  },
  address: {
    line1: "",
    line2: "",
    city: "",
    state: "",
    pin: "",
  },
  taxProfile: {
    primaryIncomeType: "" as TaxProfileDraft["primaryIncomeType"],
    regimePreference: undefined as "old" | "new" | undefined,
    hasBusinessIncome: false,
    consents: {
      documentProcessing: false,
      aiAnalysis: false,
      dataRetention: false,
    },
  },
  credentials: {
    icaiMembership: "",
    cop: true,
    yearsExperience: 0,
    specializations: [] as Specialization[],
    firmName: "",
  },
  identityFlags: {
    panEntered: false,
    panValid: false,
    aadhaarEntered: false,
    aadhaarValid: false,
  },
};

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      ...initial,
      setRole: (role) => set({ role }),
      setStep: (step) => set({ step }),
      patchPersonal: (p) =>
        set((s) => ({ personal: { ...s.personal, ...p } })),
      patchContact: (p) => set((s) => ({ contact: { ...s.contact, ...p } })),
      patchAddress: (p) => set((s) => ({ address: { ...s.address, ...p } })),
      patchTaxProfile: (p) =>
        set((s) => ({
          taxProfile: {
            ...s.taxProfile,
            ...p,
            consents: { ...s.taxProfile.consents, ...(p.consents ?? {}) },
          },
        })),
      patchCredentials: (p) =>
        set((s) => ({ credentials: { ...s.credentials, ...p } })),
      patchIdentityFlags: (p) =>
        set((s) => ({ identityFlags: { ...s.identityFlags, ...p } })),
      reset: () => set({ ...initial }),
    }),
    {
      name: "glmra.onboarding",
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") {
          return {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          };
        }
        return window.sessionStorage;
      }),
      // identityFlags carry only booleans (valid/entered) — never the value itself.
      partialize: (s) => ({
        role: s.role,
        step: s.step,
        personal: s.personal,
        contact: {
          email: s.contact.email,
          mobile: s.contact.mobile,
          emailVerified: s.contact.emailVerified,
          mobileVerified: s.contact.mobileVerified,
        },
        address: s.address,
        taxProfile: s.taxProfile,
        credentials: s.credentials,
        identityFlags: s.identityFlags,
      }),
    },
  ),
);
