/**
 * Identity masking for display.
 *
 * Sensitive values must NEVER be rendered in full once verified.
 * These helpers produce the canonical masked forms used across the UI.
 */

export function maskPan(pan: string): string {
  const p = pan?.toUpperCase().trim();
  if (!p || p.length !== 10) return p ?? "";
  return `${p.slice(0, 3)}•••••${p.slice(8)}`;
}

export function maskAadhaar(aadhaar: string): string {
  const digits = aadhaar?.replace(/\D/g, "") ?? "";
  if (digits.length !== 12) return aadhaar ?? "";
  return `XXXX XXXX ${digits.slice(8)}`;
}

export function maskMobile(mobile: string): string {
  const digits = mobile?.replace(/\D/g, "") ?? "";
  if (digits.length < 4) return mobile ?? "";
  const last = digits.slice(-10);
  if (last.length !== 10) return mobile;
  return `+91 ${last.slice(0, 2)}••• ${last.slice(7)}`;
}

export function maskEmail(email: string): string {
  if (!email || !email.includes("@")) return email;
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const visible = Math.min(2, Math.max(1, local.length - 2));
  return `${local.slice(0, visible)}${"•".repeat(Math.max(2, local.length - visible))}@${domain}`;
}

/** Generic numeric masking with last-N visibility. */
export function maskLastN(value: string, n = 4, char = "•"): string {
  if (!value) return "";
  if (value.length <= n) return value;
  return char.repeat(value.length - n) + value.slice(-n);
}
