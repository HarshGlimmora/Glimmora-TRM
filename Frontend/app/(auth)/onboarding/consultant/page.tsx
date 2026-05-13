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
import { Alert } from "@/components/ui/Alert";
import { Checkbox } from "@/components/ui/Checkbox";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/shared/Icon";
import {
  PanField,
  AadhaarField,
  type IdentityFieldHandle,
} from "@/components/onboarding/IdentityField";
import { SecurityNote } from "@/components/onboarding/AsidePanels";
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
  validateIcaiMembership,
} from "@/lib/validation/identity";
import { createConsultantProfile } from "@/lib/api";
import { maskPan, maskAadhaar } from "@/lib/security/mask";
import type { Specialization } from "@/lib/types";
import { SPECIALIZATION_LABELS } from "@/lib/types";

const STEPS = [
  { key: "personal", label: "Personal", description: "Identity basics" },
  { key: "credentials", label: "Credentials", description: "ICAI & firm" },
  { key: "identity", label: "Identity", description: "PAN & Aadhaar" },
  { key: "practice", label: "Practice", description: "Office & contact" },
  { key: "review", label: "Review", description: "Confirm & submit" },
];

const INDIAN_STATES = [
  "Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh","Delhi","Goa","Gujarat","Haryana","Himachal Pradesh","Jharkhand","Karnataka","Kerala","Madhya Pradesh","Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Punjab","Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand","West Bengal",
];

export default function ConsultantOnboardingPage() {
  return (
    <React.Suspense fallback={<div className="p-10 text-ink-muted">Loading onboarding…</div>}>
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

  const panRef = React.useRef<IdentityFieldHandle>(null);
  const aadhaarRef = React.useRef<IdentityFieldHandle>(null);
  const [panState, setPanState] = React.useState({ raw: "", valid: false });
  const [aadhaarState, setAadhaarState] = React.useState({ raw: "", valid: false });

  const urlStep = Math.max(
    0,
    Math.min(STEPS.length - 1, Number(sp.get("step") ?? store.step ?? 0)),
  );
  const [step, setStep] = React.useState<number>(urlStep);
  React.useEffect(() => setStep(urlStep), [urlStep]);
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
  }, [store.personal, store.credentials, store.address, store.contact]);

  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const personalValid =
    sanitizeText(store.personal.displayName).length >= 2 &&
    sanitizeText(store.personal.legalName).length >= 3 &&
    /^\d{4}-\d{2}-\d{2}$/.test(store.personal.dateOfBirth) &&
    store.personal.gender !== "";

  const icaiResult = validateIcaiMembership(store.credentials.icaiMembership);
  const credentialsValid =
    icaiResult.ok &&
    store.credentials.yearsExperience >= 0 &&
    store.credentials.specializations.length > 0;

  const identityValid = panState.valid && aadhaarState.valid;

  const emailErr = (() => {
    const v = sanitizeEmail(store.contact.email);
    if (!v) return null;
    const r = validateEmail(v);
    return r.ok ? null : r.message;
  })();
  const mobileErr = (() => {
    const v = sanitizeMobile(store.contact.mobile);
    if (!v) return null;
    const r = validateMobile(v);
    return r.ok ? null : r.message;
  })();

  const practiceValid =
    !emailErr &&
    !mobileErr &&
    sanitizeEmail(store.contact.email).length > 0 &&
    sanitizeMobile(store.contact.mobile).length === 10 &&
    sanitizeText(store.address.line1).length >= 3 &&
    sanitizeText(store.address.city).length >= 2 &&
    sanitizeText(store.address.state).length >= 2 &&
    validatePin(store.address.pin).ok;

  const canProceed = [
    personalValid,
    credentialsValid,
    identityValid,
    practiceValid,
    true,
  ][step];

  const proceed = () => {
    if (!canProceed) return;
    if (step < STEPS.length - 1) goto(step + 1);
  };

  const submit = async () => {
    setSubmitError(null);
    if (!personalValid || !credentialsValid || !identityValid || !practiceValid) {
      setSubmitError("Some fields are incomplete. Please review each step.");
      return;
    }
    try {
      setSubmitting(true);
      const profile = await createConsultantProfile({
        displayName: sanitizeText(store.personal.displayName, 80),
        email: sanitizeEmail(store.contact.email),
        mobile: sanitizeMobile(store.contact.mobile),
        personal: {
          legalName: sanitizeText(store.personal.legalName, 120),
          dateOfBirth: store.personal.dateOfBirth,
          gender: store.personal.gender as
            | "male"
            | "female"
            | "other"
            | "prefer_not_to_say",
        },
        credentials: {
          icaiMembership: sanitizeDigits(store.credentials.icaiMembership, 7),
          cop: store.credentials.cop,
          yearsExperience: store.credentials.yearsExperience,
          specializations: store.credentials.specializations,
          firmName: sanitizeText(store.credentials.firmName, 120) || undefined,
        },
        practice: {
          line1: sanitizeText(store.address.line1, 120),
          line2: sanitizeText(store.address.line2, 120),
          city: sanitizeText(store.address.city, 80),
          state: sanitizeText(store.address.state, 80),
          pin: sanitizeDigits(store.address.pin, 6),
          country: "IN",
        },
        rawPan: panState.raw,
        rawAadhaar: aadhaarState.raw,
      });
      setProfile(profile);
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
  const ALL_SPECS = Object.keys(SPECIALIZATION_LABELS) as Specialization[];

  return (
    <OnboardingShell
      role="consultant"
      steps={STEPS}
      current={step}
      onJump={(i) => goto(i)}
      draftSaved={draftSaved}
      aside={
        <SecurityNote
          items={[
            {
              title: "Identity verification on submit",
              body: "ICAI membership, PAN, and Aadhaar are validated together. Sensitive values stay in memory only.",
            },
            {
              title: "Audit-traceable access",
              body: "Every client grant you accept produces an append-only audit log entry visible to the taxpayer.",
            },
            {
              title: "Scope of access",
              body: "Taxpayers choose full or review-only access per filing. You'll always know the scope before you act.",
            },
          ]}
        />
      }
    >
      <div className="flex flex-col gap-6">
        {step === 0 && (
          <FormSection
            eyebrow="Step 1 of 5 · Personal"
            title="Set up your consultant identity."
            description="We display the legal name on records you share with clients. Display name appears on dashboards and notifications."
            footer={
              <>
                <span />
                <Button
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
                    placeholder="CA <surname>"
                    value={store.personal.displayName}
                    onChange={(e) =>
                      store.patchPersonal({
                        displayName: sanitizeText(e.target.value, 80),
                      })
                    }
                    autoComplete="nickname"
                  />
                </Field>
                <Field
                  label="Legal name (as per ICAI roll)"
                  required
                  htmlFor="legal"
                >
                  <Input
                    id="legal"
                    value={store.personal.legalName}
                    onChange={(e) =>
                      store.patchPersonal({
                        legalName: sanitizeText(e.target.value, 120),
                      })
                    }
                    autoComplete="name"
                  />
                </Field>
              </FormGrid>
              <FormGrid>
                <Field label="Date of birth" required>
                  <Input
                    type="date"
                    value={store.personal.dateOfBirth}
                    onChange={(e) =>
                      store.patchPersonal({ dateOfBirth: e.target.value })
                    }
                    max={new Date().toISOString().slice(0, 10)}
                  />
                </Field>
                <Field label="Gender" required>
                  <Select
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
              </FormGrid>
            </FormRow>
          </FormSection>
        )}

        {step === 1 && (
          <FormSection
            eyebrow="Step 2 of 5 · Credentials"
            title="ICAI credentials & practice profile."
            description="Membership and CoP status are verified against the ICAI roll on submission. Firm details are optional but shown to taxpayers when they choose to link with you."
            footer={
              <>
                <Button
                  variant="ghost"
                  onClick={() => goto(step - 1)}
                  leftIcon={<Icon.ChevronLeft size={14} />}
                >
                  Back
                </Button>
                <Button
                  onClick={proceed}
                  disabled={!credentialsValid}
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
                  label="ICAI membership number"
                  required
                  htmlFor="icai"
                  error={
                    store.credentials.icaiMembership && !icaiResult.ok
                      ? (icaiResult as Extract<typeof icaiResult, { ok: false }>).message
                      : null
                  }
                  hint="6–7 digits — printed on your ICAI membership certificate."
                >
                  <Input
                    id="icai"
                    inputMode="numeric"
                    value={store.credentials.icaiMembership}
                    onChange={(e) =>
                      store.patchCredentials({
                        icaiMembership: sanitizeDigits(e.target.value, 7),
                      })
                    }
                    placeholder="402178"
                    className="tabular tracking-widest"
                    maxLength={7}
                  />
                </Field>
                <Field label="Years of experience" required>
                  <Input
                    type="number"
                    min={0}
                    max={70}
                    value={store.credentials.yearsExperience || ""}
                    onChange={(e) =>
                      store.patchCredentials({
                        yearsExperience: Math.max(
                          0,
                          Math.min(70, Number(e.target.value) || 0),
                        ),
                      })
                    }
                  />
                </Field>
              </FormGrid>
              <Field label="Firm name" htmlFor="firm">
                <Input
                  id="firm"
                  placeholder="Optional"
                  value={store.credentials.firmName}
                  onChange={(e) =>
                    store.patchCredentials({
                      firmName: sanitizeText(e.target.value, 120),
                    })
                  }
                />
              </Field>
              <Checkbox
                checked={store.credentials.cop}
                onChange={(e) =>
                  store.patchCredentials({ cop: e.target.checked })
                }
                label="I hold a current Certificate of Practice (CoP)"
                description="Required to attest filings and act on a taxpayer's behalf."
              />
              <div>
                <p className="field-label">Specializations</p>
                <p className="-mt-1 text-xs text-ink-muted">
                  Choose the areas your practice covers. Taxpayers filter by
                  these when discovering consultants.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {ALL_SPECS.map((s) => {
                    const active = store.credentials.specializations.includes(s);
                    return (
                      <button
                        type="button"
                        key={s}
                        onClick={() => {
                          const set = new Set(
                            store.credentials.specializations,
                          );
                          if (active) set.delete(s);
                          else set.add(s);
                          store.patchCredentials({
                            specializations: Array.from(set) as Specialization[],
                          });
                        }}
                        aria-pressed={active}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                          active
                            ? "border-accent/40 bg-accent-soft text-accent-deep"
                            : "border-line bg-surface-raised text-ink-muted hover:border-line-strong hover:text-ink"
                        }`}
                      >
                        {active && <Icon.Check size={11} />}
                        {SPECIALIZATION_LABELS[s]}
                      </button>
                    );
                  })}
                </div>
              </div>
            </FormRow>
          </FormSection>
        )}

        {step === 2 && (
          <FormSection
            eyebrow="Step 3 of 5 · Identity"
            title="Verify your tax identity."
            description="As with every other Glimmora user, your PAN and Aadhaar are validated locally and masked the moment they're verified."
            footer={
              <>
                <Button
                  variant="ghost"
                  onClick={() => goto(step - 1)}
                  leftIcon={<Icon.ChevronLeft size={14} />}
                >
                  Back
                </Button>
                <Button
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
                Your PAN may be a firm PAN (4th character F) or individual PAN
                (4th character P). Both are valid for consultant profiles.
              </Alert>
              <FormGrid>
                <PanField ref={panRef} onChange={setPanState} required />
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

        {step === 3 && (
          <FormSection
            eyebrow="Step 4 of 5 · Practice"
            title="Where do you practice from?"
            description="Used for client matching, regulatory correspondence, and the practice card shown when taxpayers consider linking with you."
            footer={
              <>
                <Button
                  variant="ghost"
                  onClick={() => goto(step - 1)}
                  leftIcon={<Icon.ChevronLeft size={14} />}
                >
                  Back
                </Button>
                <Button
                  onClick={proceed}
                  disabled={!practiceValid}
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
                  label="Professional email"
                  required
                  error={emailErr}
                  htmlFor="email"
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
                    invalid={Boolean(emailErr)}
                  />
                </Field>
                <Field
                  label="Mobile number"
                  required
                  error={mobileErr}
                  htmlFor="mobile"
                >
                  <Input
                    id="mobile"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    leadingAddon="+91"
                    maxLength={10}
                    value={store.contact.mobile}
                    onChange={(e) =>
                      store.patchContact({
                        mobile: sanitizeMobile(e.target.value),
                      })
                    }
                    invalid={Boolean(mobileErr)}
                  />
                </Field>
              </FormGrid>
              <div className="rounded-xl border border-line bg-surface-sunken/40 p-5">
                <div className="flex items-center justify-between">
                  <p className="micro-label">Office address</p>
                  <Badge tone="info" size="sm" withDot>
                    Shown to taxpayers
                  </Badge>
                </div>
                <FormRow className="mt-4">
                  <FormGrid>
                    <Field label="Address line 1" required>
                      <Input
                        autoComplete="address-line1"
                        value={store.address.line1}
                        onChange={(e) =>
                          store.patchAddress({
                            line1: sanitizeText(e.target.value, 120),
                          })
                        }
                      />
                    </Field>
                    <Field label="Address line 2">
                      <Input
                        autoComplete="address-line2"
                        value={store.address.line2}
                        onChange={(e) =>
                          store.patchAddress({
                            line2: sanitizeText(e.target.value, 120),
                          })
                        }
                      />
                    </Field>
                  </FormGrid>
                  <FormGrid>
                    <Field label="City" required>
                      <Input
                        autoComplete="address-level2"
                        value={store.address.city}
                        onChange={(e) =>
                          store.patchAddress({
                            city: sanitizeText(e.target.value, 80),
                          })
                        }
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
                    className="max-w-[200px]"
                  >
                    <Input
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

        {step === 4 && (
          <FormSection
            eyebrow="Step 5 of 5 · Review"
            title="Review and submit."
            description="On submit we'll record your verified consultant profile and you'll land on your consultant dashboard, ready to accept linking requests."
            footer={
              <>
                <Button
                  variant="ghost"
                  onClick={() => goto(step - 1)}
                  leftIcon={<Icon.ChevronLeft size={14} />}
                >
                  Back
                </Button>
                <Button
                  onClick={submit}
                  loading={submitting}
                  disabled={
                    !personalValid ||
                    !credentialsValid ||
                    !identityValid ||
                    !practiceValid
                  }
                  rightIcon={<Icon.Check size={14} />}
                >
                  Create consultant profile
                </Button>
              </>
            }
          >
            <ConsultantReviewSummary
              personal={store.personal}
              credentials={store.credentials}
              contact={store.contact}
              address={store.address}
              panMasked={panState.valid ? maskPan(panState.raw) : "—"}
              aadhaarMasked={
                aadhaarState.valid ? maskAadhaar(aadhaarState.raw) : "—"
              }
              onEdit={goto}
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

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-2.5">
      <dt className="text-xs font-medium uppercase tracking-widest text-ink-subtle">
        {label}
      </dt>
      <dd className="text-sm text-ink text-pretty">{value || "—"}</dd>
    </div>
  );
}
function SectionTitle({ title, onEdit }: { title: string; onEdit: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-line-subtle pb-2">
      <h3 className="text-sm font-semibold tracking-[-0.005em] text-ink">{title}</h3>
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

function ConsultantReviewSummary({
  personal,
  credentials,
  contact,
  address,
  panMasked,
  aadhaarMasked,
  onEdit,
}: {
  personal: ReturnType<typeof useOnboardingStore.getState>["personal"];
  credentials: ReturnType<typeof useOnboardingStore.getState>["credentials"];
  contact: ReturnType<typeof useOnboardingStore.getState>["contact"];
  address: ReturnType<typeof useOnboardingStore.getState>["address"];
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
          <Row label="Date of birth" value={personal.dateOfBirth} />
          <Row label="Gender" value={personal.gender} />
        </dl>
      </section>
      <section className="rounded-xl border border-line bg-surface-sunken/40 p-5">
        <SectionTitle title="Credentials" onEdit={() => onEdit(1)} />
        <dl className="mt-2 divide-y divide-line-subtle">
          <Row
            label="ICAI no."
            value={
              <span className="tabular tracking-widest">
                {credentials.icaiMembership}
              </span>
            }
          />
          <Row
            label="Experience"
            value={`${credentials.yearsExperience} years`}
          />
          <Row label="CoP" value={credentials.cop ? "Active" : "—"} />
          <Row label="Firm" value={credentials.firmName} />
          <Row
            label="Specs."
            value={
              <div className="flex flex-wrap gap-1">
                {credentials.specializations.map((s) => (
                  <span
                    key={s}
                    className="inline-flex rounded-md border border-line-strong bg-surface-raised px-1.5 py-0.5 text-2xs font-medium text-ink-muted"
                  >
                    {SPECIALIZATION_LABELS[s]}
                  </span>
                ))}
              </div>
            }
          />
        </dl>
      </section>
      <section className="rounded-xl border border-line bg-surface-sunken/40 p-5">
        <SectionTitle title="Identity" onEdit={() => onEdit(2)} />
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
        <SectionTitle title="Practice" onEdit={() => onEdit(3)} />
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
    </div>
  );
}
