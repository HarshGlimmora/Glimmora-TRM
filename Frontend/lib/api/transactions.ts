/**
 * Transaction API client — talks to Next.js route handlers under
 * /api/filings/{id}/transactions/*, which proxy to FastAPI.
 *
 * Money is transported as STRINGS to preserve NUMERIC(18,2) precision
 * (per FILING_FLOW.md §0.3 + API_CONTRACTS).
 */

export type TxnStatus = "unverified" | "verified" | "rejected";
export type CategorizationMethod = "rule" | "ai_assisted" | "manual" | "unmatched";
export type RoutingMethod = "auto" | "manual_override";

export interface TransactionDTO {
  id: string;
  filing_id: string;
  document_id: string | null;
  tax_year: string;
  txn_date: string;
  amount: string;              // signed decimal as string
  description: string | null;
  counterparty: string | null;
  category: string | null;
  categorization_method: CategorizationMethod;
  rule_matched: string | null;
  confidence_score: number | null;
  routing_method: RoutingMethod;
  status: TxnStatus;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TxnListMeta {
  page: number;
  limit: number;
  total: number;
}

export interface TxnListResponse {
  items: TransactionDTO[];
  meta: TxnListMeta;
}

export interface TxnProgress {
  total: number;
  verified: number;
  unverified: number;
  rejected: number;
  percent: number;
}

export interface TxnListQuery {
  status?: "all" | TxnStatus;
  method?: CategorizationMethod;
  head?: string;
  page?: number;
  limit?: number;
}

export interface TxnPutBody {
  category?: string;
  amount?: string;
  txn_date?: string;
  description?: string;
  tax_year?: string;
  status?: TxnStatus;
  counterparty?: string;
  reason?: string;
}

export interface TxnCreateBody {
  txn_date: string;
  amount: string;
  description?: string;
  category?: string;
  counterparty?: string;
  tax_year?: string;
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
    const err =
      (body as { detail?: { code?: string; message?: string }; code?: string; message?: string }) || {};
    const code = err.detail?.code ?? err.code ?? `http_${res.status}`;
    const message = err.detail?.message ?? err.message ?? res.statusText;
    const e = new Error(message);
    (e as Error & { code: string }).code = code;
    throw e;
  }
  return body as T;
}

function buildQuery(q: TxnListQuery): string {
  const params = new URLSearchParams();
  if (q.status) params.set("status", q.status);
  if (q.method) params.set("method", q.method);
  if (q.head) params.set("head", q.head);
  if (q.page != null) params.set("page", String(q.page));
  if (q.limit != null) params.set("limit", String(q.limit));
  const s = params.toString();
  return s ? `?${s}` : "";
}

export async function listTransactions(
  filingId: string,
  query: TxnListQuery = {},
): Promise<TxnListResponse> {
  const res = await fetch(
    `/api/filings/${encodeURIComponent(filingId)}/transactions${buildQuery(query)}`,
    { credentials: "same-origin", cache: "no-store" },
  );
  return readJsonOrError<TxnListResponse>(res);
}

export async function getProgress(filingId: string): Promise<TxnProgress> {
  const res = await fetch(
    `/api/filings/${encodeURIComponent(filingId)}/transactions/progress`,
    { credentials: "same-origin", cache: "no-store" },
  );
  return readJsonOrError<TxnProgress>(res);
}

export async function getTransaction(
  filingId: string,
  txId: string,
): Promise<TransactionDTO> {
  const res = await fetch(
    `/api/filings/${encodeURIComponent(filingId)}/transactions/${encodeURIComponent(txId)}`,
    { credentials: "same-origin", cache: "no-store" },
  );
  return readJsonOrError<TransactionDTO>(res);
}

export async function putTransaction(
  filingId: string,
  txId: string,
  body: TxnPutBody,
): Promise<TransactionDTO> {
  const res = await fetch(
    `/api/filings/${encodeURIComponent(filingId)}/transactions/${encodeURIComponent(txId)}`,
    {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    },
  );
  return readJsonOrError<TransactionDTO>(res);
}

export async function verifyTransaction(
  filingId: string,
  txId: string,
): Promise<TransactionDTO> {
  const res = await fetch(
    `/api/filings/${encodeURIComponent(filingId)}/transactions/${encodeURIComponent(txId)}/verify`,
    { method: "POST", credentials: "same-origin", cache: "no-store" },
  );
  return readJsonOrError<TransactionDTO>(res);
}

export async function verifyAllTransactions(
  filingId: string,
  filter?: { method?: CategorizationMethod; head?: string },
): Promise<{ verified: number }> {
  const res = await fetch(
    `/api/filings/${encodeURIComponent(filingId)}/transactions/verify-all`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(filter ? { filter } : {}),
      cache: "no-store",
    },
  );
  return readJsonOrError<{ verified: number }>(res);
}

export async function createTransaction(
  filingId: string,
  body: TxnCreateBody,
): Promise<TransactionDTO> {
  const res = await fetch(
    `/api/filings/${encodeURIComponent(filingId)}/transactions`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    },
  );
  return readJsonOrError<TransactionDTO>(res);
}

export async function deleteTransaction(
  filingId: string,
  txId: string,
): Promise<void> {
  const res = await fetch(
    `/api/filings/${encodeURIComponent(filingId)}/transactions/${encodeURIComponent(txId)}`,
    { method: "DELETE", credentials: "same-origin" },
  );
  if (!res.ok && res.status !== 204) await readJsonOrError(res);
}
