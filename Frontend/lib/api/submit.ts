/**
 * Submit-flow API client. Two endpoints, both behind the Next proxy:
 *
 *   POST /api/auth/request-submit-otp     → mints a phone OTP bound to filing
 *   POST /api/filings/{id}/submit         → consumes OTP, flips status, audits
 */

export interface RequestSubmitOtpResponse {
  verification_id: string;
  filing_id: string;
  sent_to: string;
  expires_at: string;
  /** Only populated in dev when GLIMMORA_DEV_REVEAL_OTP=1. */
  dev_plain_code: string | null;
}

export interface SubmitResponse {
  id: string;
  status: string;
  submitted_at: string;
  submitted_by: string;
  submit_otp_verification_id: string;
}

interface ApiErrorEnvelope {
  detail?: { code?: string; message?: string; [k: string]: unknown };
  code?: string;
  message?: string;
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
    const env = (body as ApiErrorEnvelope) || {};
    const code = env.detail?.code ?? env.code ?? `http_${res.status}`;
    const message = env.detail?.message ?? env.message ?? res.statusText;
    const e = new Error(message);
    (e as Error & { code: string; detail?: typeof env.detail }).code = code;
    (e as Error & { code: string; detail?: typeof env.detail }).detail = env.detail;
    throw e;
  }
  return body as T;
}

export async function requestSubmitOtp(
  filingId: string,
): Promise<RequestSubmitOtpResponse> {
  const res = await fetch("/api/auth/request-submit-otp", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filing_id: filingId }),
    cache: "no-store",
  });
  return readJsonOrError<RequestSubmitOtpResponse>(res);
}

export async function submitFiling(
  filingId: string,
  body: { acknowledgment: boolean; verification_id: string; otp: string },
): Promise<SubmitResponse> {
  const res = await fetch(
    `/api/filings/${encodeURIComponent(filingId)}/submit`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    },
  );
  return readJsonOrError<SubmitResponse>(res);
}
