/**
 * Identity validators for Indian tax identifiers.
 * All validators return a discriminated `ValidationResult`.
 */

export type ValidationResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

/**
 * PAN — 10 characters, structured: AAAAA9999A
 *   - First 5 letters [A-Z]
 *     - 4th letter encodes entity type. For individuals it's "P".
 *   - Next 4 digits [0-9]
 *   - Last 1 letter [A-Z]
 *
 * We accept any entity-type for CA firm onboarding (could be F = firm),
 * but flag clearly when the 4th char isn't a known code.
 */
const PAN_RE = /^[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]$/;
const PAN_LOOSE_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

export function validatePan(input: string): ValidationResult {
  const pan = (input ?? "").toUpperCase().trim();
  if (!pan) return { ok: false, code: "PAN_REQUIRED", message: "PAN is required." };
  if (pan.length !== 10)
    return { ok: false, code: "PAN_LENGTH", message: "PAN must be exactly 10 characters." };
  if (!PAN_LOOSE_RE.test(pan))
    return {
      ok: false,
      code: "PAN_FORMAT",
      message: "Use the format ABCDE1234F — 5 letters, 4 digits, 1 letter.",
    };
  if (!PAN_RE.test(pan))
    return {
      ok: false,
      code: "PAN_ENTITY",
      message: "4th character is not a recognised PAN entity code.",
    };
  return { ok: true };
}

/** PAN entity-type decoder for display only. */
export function panEntityType(pan: string): string {
  const c = pan?.toUpperCase()?.[3];
  switch (c) {
    case "P":
      return "Individual";
    case "F":
      return "Firm / LLP";
    case "C":
      return "Company";
    case "H":
      return "Hindu Undivided Family";
    case "A":
      return "Association of Persons";
    case "T":
      return "Trust";
    case "B":
      return "Body of Individuals";
    case "L":
      return "Local Authority";
    case "J":
      return "Artificial Juridical Person";
    case "G":
      return "Government";
    default:
      return "Unknown";
  }
}

/**
 * Aadhaar — 12 digits, validated with the Verhoeff checksum (UIDAI spec).
 */

// prettier-ignore
const D_TABLE: number[][] = [
  [0,1,2,3,4,5,6,7,8,9],
  [1,2,3,4,0,6,7,8,9,5],
  [2,3,4,0,1,7,8,9,5,6],
  [3,4,0,1,2,8,9,5,6,7],
  [4,0,1,2,3,9,5,6,7,8],
  [5,9,8,7,6,0,4,3,2,1],
  [6,5,9,8,7,1,0,4,3,2],
  [7,6,5,9,8,2,1,0,4,3],
  [8,7,6,5,9,3,2,1,0,4],
  [9,8,7,6,5,4,3,2,1,0],
];

// prettier-ignore
const P_TABLE: number[][] = [
  [0,1,2,3,4,5,6,7,8,9],
  [1,5,7,6,2,8,3,0,9,4],
  [5,8,0,3,7,9,6,1,4,2],
  [8,9,1,6,0,4,3,5,2,7],
  [9,4,5,3,1,2,6,8,7,0],
  [4,2,8,6,5,7,3,9,0,1],
  [2,7,9,3,8,0,6,4,1,5],
  [7,0,4,6,9,1,3,2,5,8],
];

function verhoeffCheck(digits: string): boolean {
  let c = 0;
  const arr = digits.split("").reverse().map((d) => parseInt(d, 10));
  if (arr.some((n) => Number.isNaN(n))) return false;
  for (let i = 0; i < arr.length; i++) {
    c = D_TABLE[c]![P_TABLE[i % 8]![arr[i]!]!]!;
  }
  return c === 0;
}

export function validateAadhaar(input: string): ValidationResult {
  const digits = (input ?? "").replace(/\D/g, "");
  if (!digits)
    return { ok: false, code: "AADHAAR_REQUIRED", message: "Aadhaar is required." };
  if (digits.length !== 12)
    return {
      ok: false,
      code: "AADHAAR_LENGTH",
      message: "Aadhaar must be 12 digits.",
    };
  if (digits.startsWith("0") || digits.startsWith("1"))
    return {
      ok: false,
      code: "AADHAAR_PREFIX",
      message: "Aadhaar numbers do not begin with 0 or 1.",
    };
  if (!verhoeffCheck(digits))
    return {
      ok: false,
      code: "AADHAAR_CHECKSUM",
      message: "Aadhaar checksum failed. Please re-check the number.",
    };
  return { ok: true };
}

/** Indian mobile — 10 digits, starts with 6/7/8/9 (DoT spec). */
export function validateMobile(input: string): ValidationResult {
  const digits = (input ?? "").replace(/\D/g, "");
  if (!digits)
    return { ok: false, code: "MOBILE_REQUIRED", message: "Mobile number is required." };
  if (digits.length !== 10)
    return {
      ok: false,
      code: "MOBILE_LENGTH",
      message: "Indian mobile numbers are 10 digits.",
    };
  if (!/^[6-9]/.test(digits))
    return {
      ok: false,
      code: "MOBILE_PREFIX",
      message: "Mobile numbers must start with 6, 7, 8, or 9.",
    };
  return { ok: true };
}

/** Email — pragmatic, not RFC-perfect. */
const EMAIL_RE = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i;
export function validateEmail(input: string): ValidationResult {
  const s = (input ?? "").trim();
  if (!s) return { ok: false, code: "EMAIL_REQUIRED", message: "Email is required." };
  if (s.length > 254)
    return { ok: false, code: "EMAIL_LENGTH", message: "Email is too long." };
  if (!EMAIL_RE.test(s))
    return { ok: false, code: "EMAIL_FORMAT", message: "Enter a valid email address." };
  return { ok: true };
}

/** ICAI membership numbers — 6–7 digits. */
export function validateIcaiMembership(input: string): ValidationResult {
  const digits = (input ?? "").replace(/\D/g, "");
  if (!digits)
    return {
      ok: false,
      code: "ICAI_REQUIRED",
      message: "ICAI membership number is required.",
    };
  if (digits.length < 6 || digits.length > 7)
    return {
      ok: false,
      code: "ICAI_LENGTH",
      message: "Membership numbers are typically 6 or 7 digits.",
    };
  return { ok: true };
}

/** PIN code — 6 digits, must not start with 0. */
export function validatePin(input: string): ValidationResult {
  const digits = (input ?? "").replace(/\D/g, "");
  if (!digits) return { ok: false, code: "PIN_REQUIRED", message: "PIN code is required." };
  if (digits.length !== 6 || digits.startsWith("0"))
    return { ok: false, code: "PIN_FORMAT", message: "Enter a valid 6-digit PIN code." };
  return { ok: true };
}

/** OTP — exactly 6 digits. */
export function validateOtp(input: string): ValidationResult {
  const digits = (input ?? "").replace(/\D/g, "");
  if (!digits) return { ok: false, code: "OTP_REQUIRED", message: "OTP is required." };
  if (digits.length !== 6)
    return { ok: false, code: "OTP_LENGTH", message: "OTP must be 6 digits." };
  return { ok: true };
}

/** Friendly composite — returns first error or null. */
export function firstError(
  ...results: ValidationResult[]
): string | null {
  for (const r of results) if (!r.ok) return r.message;
  return null;
}

/** Convenience: returns the error message of a result, or null when ok. */
export function errorMessage(r: ValidationResult): string | null {
  return r.ok ? null : r.message;
}
