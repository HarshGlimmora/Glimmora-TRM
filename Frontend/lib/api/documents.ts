/**
 * Document API client — talks to the Next.js route handlers under
 * /api/documents/* and /api/filings/{id}/documents, which proxy to FastAPI.
 */

export type DocumentType =
  | "form16"
  | "form_26as"
  | "ais_tis"
  | "salary_slip"
  | "bank_csv"
  | "bank_pdf"
  | "unknown_pdf";

export type DocumentStatus = "uploaded" | "processing" | "completed" | "failed";
export type RoutingStatus = "pending" | "routed" | "partially_routed" | "unresolved" | "overridden";

export interface DocumentDTO {
  id: string;
  filing_id: string | null;
  tax_year: string | null;
  document_type: DocumentType;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  status: DocumentStatus;
  routing_status: RoutingStatus;
  routing_report: RoutingReportShape | null;
  created_at: string;
  updated_at: string;
}

export interface RoutingReportShape {
  document_id?: string;
  routing_status?: RoutingStatus;
  document_type?: DocumentType;
  transactions_routed?: Record<string, number>;
  unresolved?: { reason: string; raw?: unknown }[];
  notes?: string[];
  extraction_pending?: boolean;
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
    const err = (body as { detail?: { code?: string; message?: string }; code?: string; message?: string }) || {};
    const code = err.detail?.code ?? err.code ?? `http_${res.status}`;
    const message = err.detail?.message ?? err.message ?? res.statusText;
    const e = new Error(message);
    (e as Error & { code: string }).code = code;
    throw e;
  }
  return body as T;
}

export async function uploadDocument(args: {
  file: File;
  hintTaxYear?: string;
  onProgress?: (loaded: number, total: number) => void;
}): Promise<DocumentDTO> {
  const form = new FormData();
  form.append("file", args.file, args.file.name);

  // XHR is the only way to observe upload progress in 2026 browsers; fetch
  // still has no upload-side ProgressEvent. We keep this in one tight place.
  return new Promise<DocumentDTO>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/documents/upload");
    xhr.withCredentials = true;
    if (args.hintTaxYear) xhr.setRequestHeader("X-Hint-Tax-Year", args.hintTaxYear);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && args.onProgress) args.onProgress(e.loaded, e.total);
    };
    xhr.onerror = () => reject(new Error("Network error while uploading."));
    xhr.onload = () => {
      let parsed: unknown = xhr.responseText;
      try {
        parsed = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch {
        /* keep raw */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(parsed as DocumentDTO);
        return;
      }
      const err = (parsed as { detail?: { code?: string; message?: string }; code?: string; message?: string }) || {};
      const code = err.detail?.code ?? err.code ?? `http_${xhr.status}`;
      const message = err.detail?.message ?? err.message ?? xhr.statusText;
      const e = new Error(message);
      (e as Error & { code: string }).code = code;
      reject(e);
    };
    xhr.send(form);
  });
}

export async function listFilingDocuments(filingId: string): Promise<DocumentDTO[]> {
  const res = await fetch(`/api/filings/${encodeURIComponent(filingId)}/documents`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  return readJsonOrError<DocumentDTO[]>(res);
}

export async function getDocument(id: string): Promise<DocumentDTO> {
  const res = await fetch(`/api/documents/${encodeURIComponent(id)}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  return readJsonOrError<DocumentDTO>(res);
}

export async function getRoutingReport(id: string): Promise<RoutingReportShape> {
  const res = await fetch(`/api/documents/${encodeURIComponent(id)}/routing-report`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  return readJsonOrError<RoutingReportShape>(res);
}

export async function reassignDocument(
  id: string,
  body: { tax_year?: string; file_name?: string; reason?: string },
): Promise<DocumentDTO> {
  const res = await fetch(`/api/documents/${encodeURIComponent(id)}`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return readJsonOrError<DocumentDTO>(res);
}

export async function deleteDocument(id: string): Promise<void> {
  const res = await fetch(`/api/documents/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!res.ok && res.status !== 204) {
    await readJsonOrError(res);
  }
}

export function downloadDocumentUrl(id: string): string {
  return `/api/documents/${encodeURIComponent(id)}/download`;
}

export const ACCEPTED_EXTENSIONS = [".pdf", ".csv", ".txt", ".xls", ".xlsx"] as const;
export const ACCEPTED_MIME = [
  "application/pdf",
  "text/csv",
  "text/plain",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;
