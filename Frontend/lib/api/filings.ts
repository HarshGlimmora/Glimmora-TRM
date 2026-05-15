/**
 * Filing API client. All requests hit Next.js route handlers under
 * /api/workspace/* and /api/filings/* — those handlers proxy server-side to
 * FastAPI with the short-lived backend JWT.
 */

export interface FilingDTO {
  id: string;
  tax_year: string;
  status: string;
  regime_used: string | null;
  templated_from_tax_year: string | null;
  created_at: string;
  updated_at: string;
}

export interface FYBundleDTO {
  tax_year: string;
  filing: FilingDTO | null;
  documents: unknown[];
  transactions_summary: {
    total: number;
    verified: number;
    unverified: number;
    percent: number;
  };
  previous_year: unknown | null;
}

export interface FYListDTO {
  items: { tax_year: string; filing_id: string; status: string; updated_at: string }[];
  active_tax_year: string | null;
}

export interface ApiError {
  code: string;
  message: string;
}

async function readJsonOrError<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    /* keep raw text */
  }
  if (!res.ok) {
    const err = (body as { detail?: ApiError; code?: string; message?: string }) || {};
    const code = err.detail?.code ?? err.code ?? `http_${res.status}`;
    const message = err.detail?.message ?? err.message ?? res.statusText;
    const e = new Error(message);
    (e as Error & { code: string }).code = code;
    throw e;
  }
  return body as T;
}

export async function createOrGetFiling(args: {
  taxYear: string;
  templateFromTaxYear?: string;
}): Promise<FilingDTO> {
  const res = await fetch(
    `/api/workspace/years/${encodeURIComponent(args.taxYear)}/filing`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        args.templateFromTaxYear
          ? { template_from_tax_year: args.templateFromTaxYear }
          : {},
      ),
      cache: "no-store",
    },
  );
  return readJsonOrError<FilingDTO>(res);
}

export async function getYearBundle(taxYear: string): Promise<FYBundleDTO> {
  const res = await fetch(`/api/workspace/years/${encodeURIComponent(taxYear)}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  return readJsonOrError<FYBundleDTO>(res);
}

export async function listYears(): Promise<FYListDTO> {
  const res = await fetch("/api/workspace/years", {
    credentials: "same-origin",
    cache: "no-store",
  });
  return readJsonOrError<FYListDTO>(res);
}

export async function patchFiling(
  id: string,
  body: { summary_json?: Record<string, unknown> },
): Promise<FilingDTO> {
  const res = await fetch(`/api/filings/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return readJsonOrError<FilingDTO>(res);
}

/**
 * Default FY the user lands on when starting a new filing. Mirrors the badge
 * in PrimaryCta. Lifted to a single constant so we can swap to a server-driven
 * value (users.active_tax_year) in a later step without hunting through pages.
 */
export const DEFAULT_ACTIVE_FY = "FY2025-26";
