import "server-only";

/**
 * Canonical forms used by the OTP / lookup paths.
 * The frontend sanitizers (lib/security/sanitize.ts) already produce these
 * shapes — this is the server-side guarantee.
 */

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, "");
}

/**
 * Indian mobile, stored as 10 digits without the +91 prefix.
 * Input may include +91, 91, spaces, dashes — we strip all of them.
 */
export function normalizeMobile(input: string): string {
  const digits = (input ?? "").replace(/\D+/g, "");
  if (digits.startsWith("91") && digits.length === 12) return digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) return digits.slice(1);
  return digits.slice(-10);
}

export function detectChannel(raw: string): "email" | "mobile" {
  return raw.includes("@") ? "email" : "mobile";
}

export function maskEmail(email: string): string {
  if (!email.includes("@")) return email;
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const visible = Math.min(2, Math.max(1, local.length - 2));
  return `${local.slice(0, visible)}${"•".repeat(Math.max(2, local.length - visible))}@${domain}`;
}

export function maskMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, "");
  const last = digits.slice(-10);
  if (last.length !== 10) return mobile;
  return `+91 ${last.slice(0, 2)}••• ${last.slice(7)}`;
}
