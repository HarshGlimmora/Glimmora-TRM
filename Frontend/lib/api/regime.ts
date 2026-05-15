/**
 * Regime API client. Two endpoints power Step 5 — Regime:
 *
 *   POST /api/filings/{id}/precheck-regime   → state-machine evaluation
 *   POST /api/filings/{id}/calculate         → preview AND commit
 *
 * Both hit Next.js route handlers that proxy to FastAPI with the
 * short-lived backend JWT (see lib/server/backendProxy.ts).
 */

export type Regime = "old" | "new";
export type RegimeOrBoth = Regime | "both";

export type PrecheckLevel = "OK" | "INFO" | "WARN_HIGH" | "BLOCK";

export interface PrecheckResponse {
  filing_id: string;
  level: PrecheckLevel;
  code: string | null;
  message: string | null;
  previous_regime: string | null;
  requested_regime: string | null;
  lifetime_switch_backs_used: number;
  lifetime_switch_backs_remaining: number | null;
  acknowledgment_text: string | null;
  section_referenced: string | null;
  form_10iea_required: boolean;
}

export interface RegimeResultDTO {
  regime: Regime;
  fy: string;
  statute: string;
  gross_total_income: string;
  deductions: string;
  taxable_income: string;
  slab_tax: string;
  rebate_87a: string;
  flat_rate_tax: string;
  surcharge: string;
  cess: string;
  total_tax: string;
  tds_paid: string;
  balance_payable: string;
  trace_id: string | null;
  trace: Record<string, unknown>;
}

export interface CalculateResponse {
  filing_id: string;
  fy: string;
  statute: string;
  regimes_computed: Regime[];
  old_regime: RegimeResultDTO | null;
  new_regime: RegimeResultDTO | null;
  recommended_regime: Regime | null;
  savings: string | null;
}

export interface CalculateRequestBody {
  regime: RegimeOrBoth;
  acknowledged_regime_switch?: boolean;
  acknowledgment_text_hash?: string | null;
}

export interface ApiError {
  code: string;
  message: string;
  section_ref?: string;
  section_referenced?: string;
}

async function readJsonOrError<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    /* keep raw */
  }
  if (!res.ok) {
    const env = (body as { detail?: ApiError; code?: string; message?: string }) || {};
    const code = env.detail?.code ?? env.code ?? `http_${res.status}`;
    const message = env.detail?.message ?? env.message ?? res.statusText;
    const e = new Error(message);
    (e as Error & { code: string; detail?: ApiError }).code = code;
    (e as Error & { code: string; detail?: ApiError }).detail = env.detail;
    throw e;
  }
  return body as T;
}

export async function precheckRegime(
  filingId: string,
  regime: RegimeOrBoth,
): Promise<PrecheckResponse> {
  const res = await fetch(
    `/api/filings/${encodeURIComponent(filingId)}/precheck-regime`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ regime }),
      cache: "no-store",
    },
  );
  return readJsonOrError<PrecheckResponse>(res);
}

export async function calculate(
  filingId: string,
  body: CalculateRequestBody,
): Promise<CalculateResponse> {
  const res = await fetch(
    `/api/filings/${encodeURIComponent(filingId)}/calculate`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    },
  );
  return readJsonOrError<CalculateResponse>(res);
}

/** SHA-256 hex digest of a UTF-8 string, using Web Crypto. */
export async function sha256Hex(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
