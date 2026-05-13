"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import {
  FormSection,
  FormGrid,
  FormRow,
} from "@/components/onboarding/FormSection";
import { Field, Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { RadioGroup } from "@/components/ui/Radio";
import { Checkbox } from "@/components/ui/Checkbox";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/shared/Icon";
import {
  PanField,
  AadhaarField,
  type IdentityFieldHandle,
} from "@/components/onboarding/IdentityField";
import {
  SecurityNote,
  InfoAside,
} from "@/components/onboarding/AsidePanels";
import { useAuthStore } from "@/lib/store/auth-store";
import { useOnboardingStore } from "@/lib/store/onboarding-store";
import {
  sanitizeText,
  sanitizeEmail,
  sanitizeMobile,
  sanitizeDigits,
} from "@/lib/security/sanitize";
import {
  validateEmail,
  validateMobile,
  validatePin,
} from "@/lib/validation/identity";
import { createTaxpayerProfile } from "@/lib/api";
import { maskPan, maskAadhaar } from "@/lib/security/mask";

const STEPS = [
  { key: "personal", label: "Personal", description: "Legal name & basics" },
  { key: "identity", label: "Identity", description: "PAN & Aadhaar" },
  { key: "contact", label: "Contact", description: "Email & mobile" },
  { key: "tax", label: "Tax profile", description: "Regime & consents" },
  { key: "review", label: "Review", description: "Confirm & submit" },
];

const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
];

export default function TaxpayerOnboardingPage() {
  return (
    <React.Suspense
      fallback={
        <div className="p-10 text-ink-muted">Loading onboarding…</div>
      }
    >
      <Inner />
    </React.Suspense>
  );
}

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const session = useAuthStore((s) => s.session);
  const expired = useAuthStore((s) => s.isExpired());
  const setProfile = useAuthStore((s) => s.setProfile);

  const store = useOnboardingStore();

  React.useEffect(() => {
    if (!session || expired) router.replace("/login");
  }, [session, expired, router]);

  // Sensitive values live ONLY in component state (refs + state below).
  const panRef = React.useRef<IdentityFieldHandle>(null);
  const aadhaarRef = React.useRef<IdentityFieldHandle>(null);
  const [panState, setPanState] = React.useState({ raw: "", valid: false });
  const [aadhaarState, setAadhaarState] = React.useState({ raw: "", valid: false });

  // Sync URL step <-> store step
  const urlStep = Math.max(
    0,
    Math.min(STEPS.length - 1, Number(sp.get("step") ?? store.step ?? 0)),
  );
  const [step, setStep] = React.useState<number>(urlStep);
  React.useEffect(() => {
    setStep(urlStep);
  }, [urlStep]);
  const goto = (i: number) => {
    const next = Math.max(0, Math.min(STEPS.length - 1, i));
    setStep(next);
    store.setStep(next);
    const params = new URLSearchParams(window.location.search);
    params.set("step", String(next));
    router.replace(`?${params.toString()}`, { scroll: false });
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  };

  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  React.useEffect(() => {
    const t = setTimeout(() => setSavedAt(Date.now()), 400);
    return () => clearTimeout(t);
  }, [
    store.personal,
    store.address,
    store.contact.email,
    store.contact.mobile,
    store.taxProfile,
  ]);

  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  /* ---------------------- per-step validation gates ----------------------- */
  const personalValid =
    sanitizeText(store.personal.legalName).length >= 3 &&
    sanitizeText(store.personal.displayName).length >= 2 &&
    /^\d{4}-\d{2}-\d{2}$/.test(store.personal.dateOfBirth) &&
    store.personal.gender !== "" &&
    store.personal.residentialStatus !== undefined;

  const identityValid = panState.valid && aadhaarState.valid;

  const contactEmailErr = (() => {
    const v = sanitizeEmail(store.contact.email);
    if (!v) return null;
    const r = validateEmail(v);
    return r.ok ? null : r.message;
  })();
  const contactMobileErr = (() => {
    const v = sanitizeMobile(store.contact.mobile);
    if (!v) return null;
    const r = validateMobile(v);
    return r.ok ? null : r.message;
  })();
  const addressOk =
    sanitizeText(store.address.line1).length >= 3 &&
    sanitizeText(store.address.city).length >= 2 &&
    sanitizeText(store.address.state).length >= 2 &&
    validatePin(store.address.pin).ok;

  const contactValid =
    !contactEmailErr &&
    !contactMobileErr &&
    sanitizeEmail(store.contact.email).length > 0 &&
    sanitizeMobile(store.contact.mobile).length === 10 &&
    addressOk;

  const taxValid =
    store.taxProfile.primaryIncomeType !== "" &&
    !!store.taxProfile.regimePreference &&
    store.taxProfile.consents.documentProcessing &&
    store.taxProfile.consents.dataRetention;

  const canProceed = [personalValid, identityValid, contactValid, taxValid, true][
    step
  ];

  const proceed = () => {
    if (!canProceed) return;
    if (step < STEPS.length - 1) goto(step + 1);
  };

  const submit = async () => {
    setSubmitError(null);
    if (!personalValid || !identityValid || !contactValid || !taxValid) {
      setSubmitError("Some fields are incomplete. Please review each step.");
      return;
    }
    try {
      setSubmitting(true);
      const profile = await createTaxpayerProfile({
        displayName: sanitizeText(store.personal.displayName, 80),
        email: sanitizeEmail(store.contact.email),
        mobile: sanitizeMobile(store.contact.mobile),
        personal: {
          legalName: sanitizeText(store.personal.legalName, 120),
          fatherName: sanitizeText(store.personal.fatherName ?? "", 120),
          dateOfBirth: store.personal.dateOfBirth,
          gender: store.personal.gender as
            | "male"
            | "female"
            | "other"
            | "prefer_not_to_say",
          residentialStatus:
            store.personal.residentialStatus ?? "resident",
        },
        address: {
          line1: sanitizeText(store.address.line1, 120),
          line2: sanitizeText(store.address.line2, 120),
          city: sanitizeText(store.address.city, 80),
          state: sanitizeText(store.address.state, 80),
          pin: sanitizeDigits(store.address.pin, 6),
          country: "IN",
        },
        taxProfile: {
          primaryIncomeType:
            store.taxProfile.primaryIncomeType as
              | "salary"
              | "business"
              | "professional"
              | "capital_gains"
              | "house_property"
              | "other",
          regimePreference: store.taxProfile.regimePreference,
          hasBusinessIncome: store.taxProfile.hasBusinessIncome,
          consents: store.taxProfile.consents,
        },
        rawPan: panState.raw,
        rawAadhaar: aadhaarState.raw,
      });
      setProfile(profile);
      // Reset draft + sensitive values
      store.reset();
      panRef.current?.reset();
      aadhaarRef.current?.reset();
      router.push("/dashboard");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Submission failed.";
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const draftSaved = savedAt !== null;

  return (
    <OnboardingShell
      role="taxpayer"
      steps={STEPS}
      current={step}
      onJump={(i) => goto(i)}
      draftSaved={draftSaved}
      aside={
        <SecurityNote
          items={[
            {
              title: "Sensitive values stay in memory",
              body: "PAN, Aadhaar, and OTPs are never written to local or session storage. Only masked previews persist.",
            },
            {
              title: "Validated before submit",
              body: "PAN structure, Aadhaar checksum, and mobile prefix are validated on-device before they leave.",
            },
            {
              title: "Every action is auditable",
              body: "Profile creation produces an append-only audit record you can review at any time.",
            },
          ]}
        />
      }
    >
      <div className="flex flex-col gap-6">
        {step === 0 && (
          <FormSection
            eyebrow="Step 1 of 5 · Personal"
            title="Tell us who you are."
            description="Use details exactly as they appear on your identity documents. This is what your filings will be associated with."
            footer={
              <>
                <span className="text-xs text-ink-muted">
                  Press <kbd className="rounded border border-line bg-surface-sunken px-1.5 py-0.5 text-2xs">Enter</kbd>{" "}
                  to advance once each step is valid.
                </span>
                <Button
                  size="md"
                  onClick={proceed}
                  disabled={!personalValid}
                  rightIcon={<Icon.ArrowRight size={14} />}
                >
                  Continue
                </Button>
              </>
            }
          >
            <FormRow>
              <FormGrid>
                <Field label="Display name" required htmlFor="display">
                  <Input
                    id="display"
                    value={store.personal.displayName}
                    onChange={(e) =>
                      store.patchPersonal({
                        displayName: sanitizeText(e.target.value, 80),
                      })
                    }
                    placeholder="How we address you"
                    autoComplete="nickname"
                  />
                </Field>
                <Field label="Legal name (as per PAN)" required htmlFor="legal">
                  <Input
                    id="legal"
                    value={store.personal.legalName}
                    onChange={(e) =>
                      store.patchPersonal({
                        legalName: sanitizeText(e.target.value, 120),
                      })
                    }
                    placeholder="First Middle Last"
                    autoComplete="name"
                  />
                </Field>
              </FormGrid>
              <FormGrid>
                <Field
                  label="Father's name"
                  htmlFor="father"
                  hint="Optional — required by some employer-reported forms."
                >
                  <Input
                    id="father"
                    value={store.personal.fatherName}
                    onChange={(e) =>
                      store.patchPersonal({
                        fatherName: sanitizeText(e.target.value, 120),
                      })
                    }
                    placeholder=""
                  />
                </Field>
                <Field label="Date of birth" required htmlFor="dob">
                  <Input
                    id="dob"
                    type="date"
                    max={new Date().toISOString().slice(0, 10)}
                    value={store.personal.dateOfBirth}
                    onChange={(e) =>
                      store.patchPersonal({ dateOfBirth: e.target.value })
                    }
                  />
                </Field>
              </FormGrid>
              <FormGrid>
                <Field label="Gender" required htmlFor="gender">
                  <Select
                    id="gender"
                    value={store.personal.gender}
                    onChange={(e) =>
                      store.patchPersonal({
                        gender: e.target.value as
                          | "male"
                          | "female"
                          | "other"
                          | "prefer_not_to_say"
                          | "",
                      })
                    }
                  >
                    <option value="" disabled>
                      Select
                    </option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="other">Other</option>
                    <option value="prefer_not_to_say">
                      Prefer not to say
                    </option>
                  </Select>
                </Field>
                <Field label="Residential status" required>
                  <Select
                    value={store.personal.residentialStatus ?? ""}
                    onChange={(e) =>
                      store.patchPersonal({
                        residentialStatus: (e.target.value || undefined) as
                          | "resident"
                          | "nri"
                          | "rnor"
                          | undefined,
                      })
                    }
                  >
                    <option value="" disabled>
                      Select
                    </option>
                    <option value="resident">Resident of India</option>
                    <option value="nri">Non-Resident (NRI)</option>
                    <option value="rnor">Resident but Not Ordinarily Resident</option>
                  </Select>
                </Field>
              </FormGrid>
            </FormRow>
          </FormSection>
        )}

        {step === 1 && (
          <FormSection
            eyebrow="Step 2 of 5 · Identity"
            title="Verify your tax identity."
            description="Your PAN and Aadhaar are masked the moment they're validated. Only the last few characters are visible after that point."
            footer={
              <>
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => goto(step - 1)}
                  leftIcon={<Icon.ChevronLeft size={14} />}
                >
                  Back
                </Button>
                <Button
                  size="md"
                  onClick={proceed}
                  disabled={!identityValid}
                  rightIcon={<Icon.ArrowRight size={14} />}
                >
                  Continue
                </Button>
              </>
            }
          >
            <FormRow>
              <Alert tone="info" compact>
                Glimmora never stores raw PAN or Aadhaar values in your
                browser. Identity verification happens in real-time and only
                masked equivalents are persisted.
              </Alert>

              <FormGrid>
                <PanField
                  ref={panRef}
                  onChange={setPanState}
                  required
                />
                <AadhaarField
                  ref={aadhaarRef}
                  onChange={setAadhaarState}
                  required
                />
              </FormGrid>

              {(panState.valid || aadhaarState.valid) && (
                <div className="rounded-lg border border-signal-success/20 bg-signal-success-soft px-4 py-3">
                  <p className="flex items-center gap-2 text-2xs font-medium uppercase tracking-widest text-signal-success">
                    <Icon.Check size={12} /> Verified · masked preview
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                    {panState.valid && (
                      <span className="tabular text-ink">
                        PAN:{" "}
                        <span className="font-medium">
                          {maskPan(panState.raw)}
                        </span>
                      </span>
                    )}
                    {aadhaarState.valid && (
                      <span className="tabular text-ink">
                        Aadhaar:{" "}
                        <span className="font-medium">
                          {maskAadhaar(aadhaarState.raw)}
                        </span>
                      </span>
                    )}
                  </div>
                </div>
              )}
            </FormRow>
          </FormSection>
        )}

        {step === 2 && (
          <FormSection
            eyebrow="Step 3 of 5 · Contact"
            title="Where can we reach you?"
            description="Used for OTP verification on sensitive actions, official notices, and audit trail correlation."
            footer={
              <>
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => goto(step - 1)}
                  leftIcon={<Icon.ChevronLeft size={14} />}
                >
                  Back
                </Button>
                <Button
                  size="md"
                  onClick={proceed}
                  disabled={!contactValid}
                  rightIcon={<Icon.ArrowRight size={14} />}
                >
                  Continue
                </Button>
              </>
            }
          >
            <FormRow>
              <FormGrid>
                <Field
                  label="Email address"
                  required
                  htmlFor="email"
                  error={contactEmailErr}
                >
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={store.contact.email}
                    onChange={(e) =>
                      store.patchContact({
                        email: sanitizeEmail(e.target.value),
                      })
                    }
                    placeholder="you@example.in"
                    invalid={Boolean(contactEmailErr)}
                  />
                </Field>
                <Field
                  label="Mobile number"
                  required
                  htmlFor="mobile"
                  error={contactMobileErr}
                >
                  <Input
                    id="mobile"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    leadingAddon="+91"
                    value={store.contact.mobile}
                    onChange={(e) =>
                      store.patchContact({
                        mobile: sanitizeMobile(e.target.value),
                      })
                    }
                    invalid={Boolean(contactMobileErr)}
                    maxLength={10}
                  />
                </Field>
              </FormGrid>

              <div className="rounded-xl border border-line bg-surface-sunken/40 p-5">
                <div className="flex items-center justify-between">
                  <p className="micro-label">Address on file</p>
                  <Badge tone="info" size="sm" withDot>
                    Required for FY filings
                  </Badge>
                </div>
                <FormRow className="mt-4">
                  <FormGrid>
                    <Field label="Address line 1" required htmlFor="line1">
                      <Input
                        id="line1"
                        value={store.address.line1}
                        onChange={(e) =>
                          store.patchAddress({
                            line1: sanitizeText(e.target.value, 120),
                          })
                        }
                        autoComplete="address-line1"
                        placeholder="Flat / House / Building"
                      />
                    </Field>
                    <Field label="Address line 2" htmlFor="line2">
                      <Input
                        id="line2"
                        value={store.address.line2}
                        onChange={(e) =>
                          store.patchAddress({
                            line2: sanitizeText(e.target.value, 120),
                          })
                        }
                        autoComplete="address-line2"
                        placeholder="Street / Area"
                      />
                    </Field>
                  </FormGrid>
                  <FormGrid>
                    <Field label="City" required htmlFor="city">
                      <Input
                        id="city"
                        value={store.address.city}
                        onChange={(e) =>
                          store.patchAddress({
                            city: sanitizeText(e.target.value, 80),
                          })
                        }
                        autoComplete="address-level2"
                      />
                    </Field>
                    <Field label="State" required>
                      <Select
                        value={store.address.state}
                        onChange={(e) =>
                          store.patchAddress({ state: e.target.value })
                        }
                      >
                        <option value="" disabled>
                          Select
                        </option>
                        {INDIAN_STATES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </FormGrid>
                  <Field
                    label="PIN code"
                    required
                    htmlFor="pin"
                    className="max-w-[200px]"
                  >
                    <Input
                      id="pin"
                      inputMode="numeric"
                      maxLength={6}
                      value={store.address.pin}
                      onChange={(e) =>
                        store.patchAddress({
                          pin: sanitizeDigits(e.target.value, 6),
                        })
                      }
                      autoComplete="postal-code"
                      className="tabular tracking-[0.06em]"
                    />
                  </Field>
                </FormRow>
              </div>
            </FormRow>
          </FormSection>
        )}

        {step === 3 && (
          <FormSection
            eyebrow="Step 4 of 5 · Tax profile"
            title="Tell us about your tax position."
            description="This shapes how your dashboard works, what we ask for, and which regime defaults apply."
            footer={
              <>
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => goto(step - 1)}
                  leftIcon={<Icon.ChevronLeft size={14} />}
                >
                  Back
                </Button>
                <Button
                  size="md"
                  onClick={proceed}
                  disabled={!taxValid}
                  rightIcon={<Icon.ArrowRight size={14} />}
                >
                  Continue
                </Button>
              </>
            }
          >
            <FormRow>
              <div>
                <p className="field-label">Primary income type</p>
                <RadioGroup
                  name="income"
                  value={store.taxProfile.primaryIncomeType}
                  onChange={(v) => {
                    const inc = v as
                      | "salary"
                      | "business"
                      | "professional"
                      | "capital_gains"
                      | "house_property"
                      | "other";
                    store.patchTaxProfile({
                      primaryIncomeType: inc,
                      hasBusinessIncome:
                        inc === "business" || inc === "professional",
                    });
                  }}
                  options={[
                    {
                      value: "salary",
                      label: "Salary",
                      description: "Employer-paid income with Form 16.",
                    },
                    {
                      value: "business",
                      label: "Business",
                      description: "Self-employed / proprietorship income.",
                    },
                    {
                      value: "professional",
                      label: "Professional",
                      description:
                        "Independent professional income (consulting, freelance).",
                    },
                    {
                      value: "capital_gains",
                      label: "Capital gains",
                      description: "Equity, mutual fund, or property gains.",
                    },
                    {
                      value: "house_property",
                      label: "House property",
                      description: "Rental income from property.",
                    },
                    {
                      value: "other",
                      label: "Other",
                      description: "Interest, dividend, or unclassified income.",
                    },
                  ]}
                />
              </div>

              <div>
                <p className="field-label">Regime preference</p>
                <RadioGroup
                  name="regime"
                  layout="row"
                  value={store.taxProfile.regimePreference ?? ""}
                  onChange={(v) =>
                    store.patchTaxProfile({
                      regimePreference: v as "old" | "new",
                    })
                  }
                  options={[
                    {
                      value: "new",
                      label: "New regime (default)",
                      description: "Lower rates, fewer deductions.",
                    },
                    {
                      value: "old",
                      label: "Old regime",
                      description:
                        "Higher rates, but allows 80C / HRA / standard deductions.",
                    },
                  ]}
                />
                {store.taxProfile.hasBusinessIncome &&
                  store.taxProfile.regimePreference === "old" && (
                    <Alert tone="warning" compact className="mt-3">
                      Under Section 115BAC(6), business taxpayers opting out of
                      the new regime must file Form 10-IEA. You can switch back
                      to the new regime only once in your lifetime.
                    </Alert>
                  )}
              </div>

              <div>
                <p className="field-label">Consents</p>
                <div className="grid gap-3">
                  <Checkbox
                    checked={store.taxProfile.consents.documentProcessing}
                    onChange={(e) =>
                      store.patchTaxProfile({
                        consents: {
                          documentProcessing: e.target.checked,
                        },
                      })
                    }
                    label="Document processing"
                    description="Permit Glimmora to extract structured data from documents you upload (Form 16, 26AS, AIS/TIS). Required for filing."
                  />
                  <Checkbox
                    checked={store.taxProfile.consents.aiAnalysis}
                    onChange={(e) =>
                      store.patchTaxProfile({
                        consents: { aiAnalysis: e.target.checked },
                      })
                    }
                    label="AI-assisted categorisation"
                    description="Optional. Use AI to suggest transaction categories. Deterministic rules always make the final decision."
                  />
                  <Checkbox
                    checked={store.taxProfile.consents.dataRetention}
                    onChange={(e) =>
                      store.patchTaxProfile({
                        consents: { dataRetention: e.target.checked },
                      })
                    }
                    label="Long-term data retention"
                    description="Retain your filings and audit trail for 7 years per the Income Tax Act. Required to keep older filings auditable."
                  />
                </div>
              </div>
            </FormRow>
          </FormSection>
        )}

        {step === 4 && (
          <FormSection
            eyebrow="Step 5 of 5 · Review"
            title="Review and submit."
            description="Confirm the details below. After submission, your profile is created, identity is marked verified, and you'll be taken to your dashboard."
            footer={
              <>
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => goto(step - 1)}
                  leftIcon={<Icon.ChevronLeft size={14} />}
                >
                  Back
                </Button>
                <Button
                  size="md"
                  onClick={submit}
                  loading={submitting}
                  disabled={
                    !personalValid ||
                    !identityValid ||
                    !contactValid ||
                    !taxValid
                  }
                  rightIcon={<Icon.Check size={14} />}
                >
                  Create profile
                </Button>
              </>
            }
          >
            <ReviewSummary
              personal={store.personal}
              contact={store.contact}
              address={store.address}
              taxProfile={store.taxProfile}
              panMasked={panState.valid ? maskPan(panState.raw) : "—"}
              aadhaarMasked={
                aadhaarState.valid ? maskAadhaar(aadhaarState.raw) : "—"
              }
              onEdit={(i) => goto(i)}
            />
            {submitError && (
              <Alert tone="error" compact className="mt-4">
                {submitError}
              </Alert>
            )}
          </FormSection>
        )}
      </div>
    </OnboardingShell>
  );
}

/* -------------------------------------------------------------------------- */
/*  Review summary                                                            */
/* -------------------------------------------------------------------------- */

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-2.5">
      <dt className="text-xs font-medium uppercase tracking-widest text-ink-subtle">
        {label}
      </dt>
      <dd className="text-sm text-ink text-pretty">{value || "—"}</dd>
    </div>
  );
}

function SectionTitle({
  title,
  onEdit,
}: {
  title: string;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-b border-line-subtle pb-2">
      <h3 className="text-sm font-semibold tracking-[-0.005em] text-ink">
        {title}
      </h3>
      <button
        type="button"
        onClick={onEdit}
        className="inline-flex items-center gap-1 text-xs font-medium text-navy hover:underline underline-offset-4"
      >
        <Icon.Edit size={12} /> Edit
      </button>
    </div>
  );
}

function ReviewSummary({
  personal,
  contact,
  address,
  taxProfile,
  panMasked,
  aadhaarMasked,
  onEdit,
}: {
  personal: ReturnType<typeof useOnboardingStore.getState>["personal"];
  contact: ReturnType<typeof useOnboardingStore.getState>["contact"];
  address: ReturnType<typeof useOnboardingStore.getState>["address"];
  taxProfile: ReturnType<typeof useOnboardingStore.getState>["taxProfile"];
  panMasked: string;
  aadhaarMasked: string;
  onEdit: (i: number) => void;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-xl border border-line bg-surface-sunken/40 p-5">
        <SectionTitle title="Personal" onEdit={() => onEdit(0)} />
        <dl className="mt-2 divide-y divide-line-subtle">
          <Row label="Display name" value={personal.displayName} />
          <Row label="Legal name" value={personal.legalName} />
          <Row label="Father's name" value={personal.fatherName} />
          <Row label="Date of birth" value={personal.dateOfBirth} />
          <Row label="Gender" value={personal.gender} />
          <Row
            label="Residency"
            value={personal.residentialStatus}
          />
        </dl>
      </section>

      <section className="rounded-xl border border-line bg-surface-sunken/40 p-5">
        <SectionTitle title="Identity" onEdit={() => onEdit(1)} />
        <dl className="mt-2 divide-y divide-line-subtle">
          <Row
            label="PAN"
            value={<span className="tabular">{panMasked}</span>}
          />
          <Row
            label="Aadhaar"
            value={<span className="tabular">{aadhaarMasked}</span>}
          />
        </dl>
      </section>

      <section className="rounded-xl border border-line bg-surface-sunken/40 p-5">
        <SectionTitle title="Contact" onEdit={() => onEdit(2)} />
        <dl className="mt-2 divide-y divide-line-subtle">
          <Row label="Email" value={contact.email} />
          <Row label="Mobile" value={`+91 ${contact.mobile}`} />
          <Row
            label="Address"
            value={
              <>
                {address.line1}
                {address.line2 ? `, ${address.line2}` : ""}
                <br />
                {address.city}, {address.state} – {address.pin}
              </>
            }
          />
        </dl>
      </section>

      <section className="rounded-xl border border-line bg-surface-sunken/40 p-5">
        <SectionTitle title="Tax profile" onEdit={() => onEdit(3)} />
        <dl className="mt-2 divide-y divide-line-subtle">
          <Row
            label="Income type"
            value={taxProfile.primaryIncomeType.replace("_", " ")}
          />
          <Row
            label="Regime"
            value={
              taxProfile.regimePreference
                ? `${taxProfile.regimePreference} regime`
                : "—"
            }
          />
          <Row
            label="Consents"
            value={
              <ul className="flex flex-wrap gap-1.5">
                {(["documentProcessing", "aiAnalysis", "dataRetention"] as const).map(
                  (k) => (
                    <li
                      key={k}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${
                        taxProfile.consents[k]
                          ? "border-signal-success/20 bg-signal-success-soft text-signal-success"
                          : "border-line bg-surface-raised text-ink-subtle"
                      }`}
                    >
                      {taxProfile.consents[k] ? (
                        <Icon.Check size={11} />
                      ) : (
                        <Icon.X size={11} />
                      )}
                      {k === "documentProcessing"
                        ? "Document processing"
                        : k === "aiAnalysis"
                          ? "AI analysis"
                          : "Data retention"}
                    </li>
                  ),
                )}
              </ul>
            }
          />
        </dl>
      </section>
    </div>
  );
}
