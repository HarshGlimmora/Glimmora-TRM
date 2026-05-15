"""Auto-classify an uploaded file into (file_kind, document_type).

Per FILING_FLOW.md §3.3, the client never supplies these. We decide from:
  1. Extension + MIME (gate: pdf vs csv-family vs reject).
  2. Filename heuristics (form16, 26as, ais, payslip, etc.).
  3. Content sniff (first few KB).

Returns:
  file_kind: "pdf" | "csv" — the parsing pipeline branch.
  document_type: one of form16 | form_26as | ais_tis | salary_slip | bank_csv | bank_pdf
  | unknown_pdf — stored on documents.document_type. `unknown_pdf` lets us
  accept a PDF in Step 2 without forcing a doc-type decision before Gemini
  runs in Step 3.

Raises:
  UnsupportedMediaType — extension/MIME not in {pdf, csv, txt, xls, xlsx}.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal


FileKind = Literal["pdf", "csv"]
DocumentType = Literal[
    "form16", "form_26as", "ais_tis", "salary_slip",
    "bank_csv", "bank_pdf", "unknown_pdf",
]


class UnsupportedMediaType(ValueError):
    """Raised for extensions/MIME types we don't accept yet."""


@dataclass(frozen=True)
class DetectionResult:
    file_kind: FileKind
    document_type: DocumentType


PDF_EXT_MIME = {("pdf", "application/pdf")}
CSV_EXT_MIME = {
    ("csv", "text/csv"),
    ("csv", "text/plain"),
    ("csv", "application/csv"),
    ("csv", "application/vnd.ms-excel"),
    ("csv", "application/octet-stream"),
    ("txt", "text/plain"),
    ("txt", "text/csv"),
    ("txt", "application/octet-stream"),
}
# Excel-family files would route through CSV after server-side conversion. The
# conversion is deferred to Step 2.5; we accept the extension so the contract
# is final, but raise on actual parse if the file isn't valid CSV.
EXCEL_EXTS = {"xls", "xlsx"}


_FILENAME_HINTS: list[tuple[re.Pattern[str], DocumentType]] = [
    (re.compile(r"form[\s_-]*16", re.I), "form16"),
    (re.compile(r"(form[\s_-]*)?26[\s_-]*as", re.I), "form_26as"),
    (re.compile(r"\bais\b|annual[\s_-]*information", re.I), "ais_tis"),
    (re.compile(r"\btis\b|tax[\s_-]*information[\s_-]*summary", re.I), "ais_tis"),
    (re.compile(r"pay[\s_-]*slip|salary[\s_-]*slip", re.I), "salary_slip"),
    (re.compile(r"statement|account|bank", re.I), "bank_pdf"),  # PDF only
]

_CONTENT_HINTS_PDF: list[tuple[re.Pattern[bytes], DocumentType]] = [
    (re.compile(rb"FORM\s*NO\.?\s*16", re.I), "form16"),
    (re.compile(rb"FORM\s*26AS|TRACES", re.I), "form_26as"),
    (re.compile(rb"ANNUAL\s+INFORMATION\s+STATEMENT", re.I), "ais_tis"),
    (re.compile(rb"TAX\s+INFORMATION\s+SUMMARY", re.I), "ais_tis"),
    (re.compile(rb"SALARY\s*SLIP|PAY\s*SLIP|PAYSLIP", re.I), "salary_slip"),
    (re.compile(rb"STATEMENT\s+OF\s+ACCOUNT|ACCOUNT\s+STATEMENT", re.I), "bank_pdf"),
]


def detect(
    *,
    file_name: str,
    mime_type: str | None,
    content_sample: bytes,
) -> DetectionResult:
    ext = Path(file_name).suffix.lower().lstrip(".")
    mime = (mime_type or "").lower()

    # 1. Gate: which pipeline?
    if (ext, mime) in PDF_EXT_MIME or ext == "pdf":
        return DetectionResult(file_kind="pdf", document_type=_classify_pdf(file_name, content_sample))
    if (ext, mime) in CSV_EXT_MIME or ext in {"csv", "txt"}:
        return DetectionResult(file_kind="csv", document_type="bank_csv")
    if ext in EXCEL_EXTS:
        # Step 2.5 territory. Accept the extension so the contract is final,
        # but the parser will reject when it can't decode as CSV.
        return DetectionResult(file_kind="csv", document_type="bank_csv")

    raise UnsupportedMediaType(
        f"Unsupported upload: extension={ext!r}, mime={mime!r}. "
        "Accepted: pdf, csv, txt, xls, xlsx."
    )


def _classify_pdf(file_name: str, content: bytes) -> DocumentType:
    # First-page text is unreliable to extract without a PDF library; rely on
    # filename hints + a raw byte sniff over the first ~64 KB. That catches
    # most clear-cut cases. Ambiguous PDFs fall through to `unknown_pdf` and
    # Gemini (Step 3) does the final tiebreak.
    sample = content[:65536]
    for pattern, doc_type in _CONTENT_HINTS_PDF:
        if pattern.search(sample):
            return doc_type
    for pattern, doc_type in _FILENAME_HINTS:
        if pattern.search(file_name):
            # filename says "statement" → bank_pdf; otherwise as marked.
            return doc_type
    return "unknown_pdf"
