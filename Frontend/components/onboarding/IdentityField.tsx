"use client";

import * as React from "react";
import { Field, Input } from "@/components/ui/Input";
import { Icon } from "@/components/shared/Icon";
import { cn } from "@/lib/utils/cn";
import {
  sanitizePan,
  sanitizeAadhaar,
} from "@/lib/security/sanitize";
import {
  validatePan,
  validateAadhaar,
  panEntityType,
  type ValidationResult,
} from "@/lib/validation/identity";
import { maskPan, maskAadhaar } from "@/lib/security/mask";

/**
 * PAN input — uppercased, structure-validated. The raw value is held in
 * local component state only. The parent receives `{ raw, valid }`.
 */
export interface IdentityFieldHandle {
  raw: string;
  valid: boolean;
  reset: () => void;
}

interface PanFieldProps {
  onChange: (state: { raw: string; valid: boolean }) => void;
  initialValid?: boolean;
  required?: boolean;
}

export const PanField = React.forwardRef<IdentityFieldHandle, PanFieldProps>(
  ({ onChange, required }, ref) => {
    const [raw, setRaw] = React.useState("");
    const [reveal, setReveal] = React.useState(false);
    const [touched, setTouched] = React.useState(false);

    const result: ValidationResult = raw
      ? validatePan(raw)
      : { ok: false, code: "PAN_REQUIRED", message: "PAN is required." };

    const valid = result.ok;
    const showError = touched && raw.length > 0 && !valid;

    React.useImperativeHandle(ref, () => ({
      raw,
      valid,
      reset: () => {
        setRaw("");
        setTouched(false);
      },
    }));

    React.useEffect(() => {
      onChange({ raw, valid });
    }, [raw, valid, onChange]);

    const display = reveal ? raw : raw.length === 10 ? maskPan(raw) : raw;

    return (
      <Field
        label="Permanent Account Number (PAN)"
        required={required}
        htmlFor="pan"
        error={showError ? result.ok ? null : result.message : null}
        hint={
          valid
            ? `Validated · Entity: ${panEntityType(raw)}`
            : "Format: ABCDE1234F — letters in upper case."
        }
        trailingLabel={
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            disabled={raw.length !== 10}
            className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-2xs font-medium uppercase tracking-widest text-ink-muted hover:text-ink disabled:opacity-50"
          >
            {reveal ? <Icon.EyeOff size={12} /> : <Icon.Eye size={12} />}
            {reveal ? "Hide" : "Reveal"}
          </button>
        }
      >
        <Input
          id="pan"
          name="pan"
          sensitive
          inputMode="text"
          placeholder="ABCDE1234F"
          value={display}
          onChange={(e) => {
            if (reveal) {
              setRaw(sanitizePan(e.target.value));
            } else {
              // When masked, allow editing only by typing (append/backspace)
              const next = e.target.value;
              if (next.length > display.length) {
                // appended chars
                const added = next.slice(display.length);
                setRaw(sanitizePan(raw + added));
              } else if (next.length < display.length) {
                // backspaced
                setRaw(raw.slice(0, Math.max(0, raw.length - 1)));
              }
            }
          }}
          onBlur={() => setTouched(true)}
          invalid={showError}
          maxLength={10}
          className={cn("uppercase tracking-[0.04em] tabular")}
          autoCapitalize="characters"
        />
      </Field>
    );
  },
);
PanField.displayName = "PanField";

interface AadhaarFieldProps {
  onChange: (state: { raw: string; valid: boolean }) => void;
  required?: boolean;
}

export const AadhaarField = React.forwardRef<
  IdentityFieldHandle,
  AadhaarFieldProps
>(({ onChange, required }, ref) => {
  const [raw, setRaw] = React.useState("");
  const [reveal, setReveal] = React.useState(false);
  const [touched, setTouched] = React.useState(false);

  const result: ValidationResult = raw
    ? validateAadhaar(raw)
    : { ok: false, code: "AADHAAR_REQUIRED", message: "Aadhaar is required." };

  const valid = result.ok;
  const showError = touched && raw.length > 0 && !valid;

  React.useImperativeHandle(ref, () => ({
    raw,
    valid,
    reset: () => {
      setRaw("");
      setTouched(false);
    },
  }));

  React.useEffect(() => {
    onChange({ raw, valid });
  }, [raw, valid, onChange]);

  // Display: grouped 4-4-4 with mask when not revealed
  const grouped = (digits: string) => {
    const d = digits.replace(/\D/g, "");
    const parts: string[] = [];
    for (let i = 0; i < d.length; i += 4) parts.push(d.slice(i, i + 4));
    return parts.join(" ");
  };
  const display = reveal
    ? grouped(raw)
    : raw.length === 12
      ? maskAadhaar(raw)
      : grouped(raw);

  return (
    <Field
      label="Aadhaar number"
      required={required}
      htmlFor="aadhaar"
      error={showError ? (result.ok ? null : result.message) : null}
      hint={
        valid
          ? "Validated — Verhoeff checksum passed."
          : "12 digits. Spaces are added automatically."
      }
      trailingLabel={
        <button
          type="button"
          onClick={() => setReveal((v) => !v)}
          disabled={raw.length !== 12}
          className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-2xs font-medium uppercase tracking-widest text-ink-muted hover:text-ink disabled:opacity-50"
        >
          {reveal ? <Icon.EyeOff size={12} /> : <Icon.Eye size={12} />}
          {reveal ? "Hide" : "Reveal"}
        </button>
      }
    >
      <Input
        id="aadhaar"
        name="aadhaar"
        sensitive
        inputMode="numeric"
        placeholder="0000 0000 0000"
        value={display}
        onChange={(e) => {
          if (reveal) {
            setRaw(sanitizeAadhaar(e.target.value));
          } else {
            const next = e.target.value.replace(/\s/g, "");
            const prev = display.replace(/\s/g, "");
            if (next.length > prev.length) {
              const added = next.slice(prev.length);
              setRaw(sanitizeAadhaar(raw + added));
            } else if (next.length < prev.length) {
              setRaw(raw.slice(0, Math.max(0, raw.length - 1)));
            }
          }
        }}
        onBlur={() => setTouched(true)}
        invalid={showError}
        maxLength={14}
        className="tabular tracking-[0.06em]"
      />
    </Field>
  );
});
AadhaarField.displayName = "AadhaarField";
