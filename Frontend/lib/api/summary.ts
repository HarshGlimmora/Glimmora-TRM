/**
 * Summary API client. The summary page renders the committed-regime recap
 * (income breakdown, deductions, tax computation, trace) and offers a PDF
 * download. Both endpoints hit Next.js route handlers under
 * /api/filings/{id}/summary and /api/filings/{id}/summary.pdf.
 */

export interface TaxComputationDTO {
  taxable_income: string;
  slab_tax: string;
  rebate_87a: string;
  flat_rate_tax: string;
  surcharge: string;
  cess: string;
  total_tax: string;
}

export interface UserSnapshotDTO {
  id: string;
  name: string;
  pan: string | null;
  email: string | null;
  phone: string | null;
}

export interface TraceStepDTO {
  step: number;
  op: string;
  section_ref?: string;
  rule_id?: string;
  rule_version?: number;
  input?: unknown;
  result: string;
  breakdown?: unknown[];
  human_explanation: string;
  [key: string]: unknown;
}

export interface RuleVersionDTO {
  version: number;
  statute: string;
  source: string;
  rule_id: string;
}

export interface CalculationTraceDTO {
  filing_id?: string;
  regime?: string;
  statute?: string;
  fy?: string;
  rule_versions?: Record<string, RuleVersionDTO>;
  final_total?: string;
  steps: TraceStepDTO[];
}

export interface SummaryDTO {
  filing_id: string;
  user: UserSnapshotDTO;
  tax_year: string;
  statute: string;
  regime_used: "old" | "new";
  income_breakdown: Record<string, string>;
  deductions: Record<string, string>;
  tax_computation: TaxComputationDTO;
  tds_paid: string;
  balance_payable: string;
  calculation_trace: CalculationTraceDTO;
  trace_id: string | null;
  generated_at: string;
}

interface ApiErrorEnvelope {
  detail?: { code?: string; message?: string };
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
    (e as Error & { code: string }).code = code;
    throw e;
  }
  return body as T;
}

export interface ExplainFieldDTO {
  label: string;
  value: string;
  raw: string;
}

export interface ExplainStepDTO {
  step: number;
  op: string;
  plain_text: string;
  fields: ExplainFieldDTO[];
  source: "gemini" | "deterministic";
}

export interface ExplainTraceDTO {
  filing_id: string;
  regime_used: "old" | "new";
  tax_year: string;
  explanations: ExplainStepDTO[];
  llm_used: boolean;
}

export async function explainCalculationTrace(
  filingId: string,
  options: { useLlm?: boolean } = {},
): Promise<ExplainTraceDTO> {
  const qs = new URLSearchParams();
  if (options.useLlm === false) qs.set("use_llm", "false");
  const q = qs.toString();
  const url = `/api/filings/${encodeURIComponent(filingId)}/calculation-trace/explain${q ? `?${q}` : ""}`;
  const res = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
  });
  return readJsonOrError<ExplainTraceDTO>(res);
}

export async function getSummary(filingId: string): Promise<SummaryDTO> {
  const res = await fetch(`/api/filings/${encodeURIComponent(filingId)}/summary`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  return readJsonOrError<SummaryDTO>(res);
}

/** Trigger a PDF download in the browser. Streams the binary from Next. */
export async function downloadSummaryPdf(filingId: string): Promise<void> {
  const res = await fetch(
    `/api/filings/${encodeURIComponent(filingId)}/summary.pdf`,
    { credentials: "same-origin", cache: "no-store" },
  );
  if (!res.ok) {
    // Server returned a JSON error envelope despite the .pdf URL — surface it.
    const text = await res.text();
    let parsed: ApiErrorEnvelope = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      /* ignore */
    }
    const code = parsed.detail?.code ?? parsed.code ?? `http_${res.status}`;
    const message = parsed.detail?.message ?? parsed.message ?? res.statusText;
    const e = new Error(message);
    (e as Error & { code: string }).code = code;
    throw e;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  // Honor server-supplied filename if present, else pick a sensible default.
  const disposition = res.headers.get("content-disposition") ?? "";
  const m = /filename="?([^"]+)"?/i.exec(disposition);
  a.download = m?.[1] ?? `glimmora-summary-${filingId}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
