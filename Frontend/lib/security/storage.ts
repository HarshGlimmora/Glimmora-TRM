/**
 * Safe storage adapter.
 *
 * Rules:
 *   1. `localStorage` is NEVER used for sensitive values (PAN, Aadhaar, OTP, raw mobile, tokens).
 *   2. `sessionStorage` is allowed only for non-sensitive UI / draft state and is cleared on tab close.
 *   3. In-memory store is used for anything sensitive — it is dropped on full page reload by design.
 *
 * These wrappers exist so any future audit can grep for raw `localStorage.setItem` usage
 * and flag it as a regression.
 */

const SENSITIVE_KEYS = [
  "pan",
  "aadhaar",
  "otp",
  "mobileRaw",
  "token",
  "accessToken",
  "refreshToken",
  "password",
  "secret",
];

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEYS.some((s) => k.includes(s));
}

function safeWindow(): Window | null {
  return typeof window === "undefined" ? null : window;
}

export const sessionDraft = {
  get<T>(key: string, fallback: T): T {
    const w = safeWindow();
    if (!w) return fallback;
    try {
      const raw = w.sessionStorage.getItem(`glmra.draft.${key}`);
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },
  set<T>(key: string, value: T): void {
    const w = safeWindow();
    if (!w) return;
    if (isSensitiveKey(key)) {
      console.warn(`[security] refused to persist sensitive key "${key}"`);
      return;
    }
    try {
      w.sessionStorage.setItem(`glmra.draft.${key}`, JSON.stringify(value));
    } catch {
      // sessionStorage may be unavailable (private mode, quota) — fail silent
    }
  },
  remove(key: string): void {
    const w = safeWindow();
    if (!w) return;
    try {
      w.sessionStorage.removeItem(`glmra.draft.${key}`);
    } catch {
      /* noop */
    }
  },
  clearAll(): void {
    const w = safeWindow();
    if (!w) return;
    try {
      for (let i = w.sessionStorage.length - 1; i >= 0; i--) {
        const k = w.sessionStorage.key(i);
        if (k?.startsWith("glmra.draft.")) w.sessionStorage.removeItem(k);
      }
    } catch {
      /* noop */
    }
  },
};

/**
 * Strip sensitive fields from a payload before any persistence or logging.
 * Pass through anything not on the deny-list.
 */
export function redactSensitive<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (isSensitiveKey(k)) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}
