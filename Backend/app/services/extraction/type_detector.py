"""Layer 1 — fast deterministic classification of an upload.

Decisions:

  * `file_kind` ∈ {pdf, csv} — picked by extension + MIME + magic bytes.
    Files that don't fit raise UnsupportedMediaType.

  * `document_type` — derived ONLY from file *content*. Filename heuristics
    are deliberately not used (per the ingestion-pipeline contract: layouts
    and names vary, names are unreliable). PDFs that don't match a high-
    confidence content signature stay as `unknown_pdf`; Layer 3 (Gemini)
    refines the classification.

  * `confidence` — 1.0 for a clean content match (bank CSV header pattern,
    canonical PDF header text). 0.0 for `unknown_pdf` → forces Layer 3.

Anything between is reserved for the heuristic Layer 2 if we add textual
signals later.
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
    "capital_gains_statement", "broker_pnl",
]


class UnsupportedMediaType(ValueError):
    """Raised for extensions/MIME types we don't accept yet."""


@dataclass(frozen=True)
class DetectionResult:
    file_kind: FileKind
    document_type: DocumentType
    confidence: float            # 0.0 .. 1.0 — drives the LLM escalation gate.
    signals: list[str]           # human-readable list for the audit log.


# ---------------------------------------------------------------------------
# Content signatures
# ---------------------------------------------------------------------------

_PDF_MAGIC = b"%PDF-"


# PDF header text is the only reliable content signal. These regexes run over
# the first ~64 KB of bytes (good enough for the first page on most issuers).
_PDF_CONTENT_HINTS: list[tuple[re.Pattern[bytes], DocumentType]] = [
    (re.compile(rb"FORM\s*NO\.?\s*16\b", re.I), "form16"),
    (re.compile(rb"FORM\s*26\s*AS\b|\bTRACES\b", re.I), "form_26as"),
    (re.compile(rb"ANNUAL\s+INFORMATION\s+STATEMENT|\bAIS\b", re.I), "ais_tis"),
    (re.compile(rb"TAX\s+INFORMATION\s+SUMMARY|\bTIS\b", re.I), "ais_tis"),
    (re.compile(rb"SALARY\s*SLIP|PAY\s*SLIP|PAYSLIP", re.I), "salary_slip"),
    (re.compile(rb"STATEMENT\s+OF\s+ACCOUNT|ACCOUNT\s+STATEMENT", re.I), "bank_pdf"),
]


# CSV header gate — we look for at least a date column AND either a
# Debit/Credit pair or an Amount column. The detailed alias matching lives in
# csv_parser._find_header; here we just want a binary "looks like a bank CSV"
# answer that's good enough to set document_type.
_CSV_DATE_HINTS = ("txn date", "transaction date", "date", "post date", "posting date")
_CSV_DEBIT_HINTS = ("debit", "withdrawal", "withdrawal amt", "amount debited", "dr")
_CSV_CREDIT_HINTS = ("credit", "deposit", "deposit amt", "amount credited", "cr")
_CSV_AMOUNT_HINTS = ("amount", "txn amount", "transaction amount")

# Broker / capital-gains statement signals. A document is a CG statement when
# the file contains buy+sell columns (any case), an ISIN code, or one of the
# Schedule-CG section headers a typical brokerage P&L export prints.
_CG_HEADER_HINTS = (
    "isin",
    "buy date",
    "sell date",
    "buy price",
    "sell price",
    "buy value",
    "sell value",
    "realised p&l",
    "realized p&l",
    "holding (days)",
    "stcg",
    "ltcg",
    "section 111a",
    "section 112a",
    "intraday",
    "f&o",
    "speculative",
    "non-speculative",
)
_ISIN_RE = re.compile(rb"\b[A-Z]{2}[A-Z0-9]{9}[0-9]\b")


def detect(
    *,
    file_name: str,
    mime_type: str | None,
    content_sample: bytes,
) -> DetectionResult:
    """Classify the upload. `file_name` is used only for extension parsing —
    NOT for content classification."""
    ext = Path(file_name).suffix.lower().lstrip(".")
    mime = (mime_type or "").lower()
    signals: list[str] = []

    # ---- File kind ----
    if _looks_like_pdf(ext, mime, content_sample):
        signals.append(f"pdf:ext={ext or '?'} mime={mime or '?'} magic={content_sample[:5] == _PDF_MAGIC}")
        return _classify_pdf(content_sample, signals)

    if _looks_like_csv(ext, mime):
        signals.append(f"csv:ext={ext} mime={mime or '?'}")
        # We declare bank_csv from the gate; the CSV parser validates the
        # actual layout downstream. Confidence stays high because the
        # downstream parser is the authority on whether rows materialise.
        return _classify_csv(content_sample, signals)

    if ext in {"xls", "xlsx"}:
        signals.append(f"excel:ext={ext} (deferred xls→csv conversion)")
        return DetectionResult(
            file_kind="csv",
            document_type="bank_csv",
            confidence=0.6,
            signals=signals,
        )

    raise UnsupportedMediaType(
        f"Unsupported upload: extension={ext!r}, mime={mime!r}. "
        "Accepted: pdf, csv, txt, xls, xlsx."
    )


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

def _looks_like_pdf(ext: str, mime: str, sample: bytes) -> bool:
    if sample.lstrip()[:5] == _PDF_MAGIC:
        return True
    if ext == "pdf":
        return True
    if mime == "application/pdf":
        return True
    return False


def _looks_like_csv(ext: str, mime: str) -> bool:
    if ext in {"csv", "txt"}:
        return True
    if mime in {"text/csv", "text/plain", "application/csv"}:
        return True
    return False


def _classify_pdf(content: bytes, signals: list[str]) -> DetectionResult:
    sample = content[:65536]
    for pattern, doc_type in _PDF_CONTENT_HINTS:
        if pattern.search(sample):
            signals.append(f"content_hit={pattern.pattern.decode(errors='replace')[:40]}")
            return DetectionResult(
                file_kind="pdf",
                document_type=doc_type,
                confidence=1.0,
                signals=signals,
            )
    signals.append("content=no_canonical_header_found")
    return DetectionResult(
        file_kind="pdf",
        document_type="unknown_pdf",
        confidence=0.0,        # forces Gemini classification
        signals=signals,
    )


def _classify_csv(content: bytes, signals: list[str]) -> DetectionResult:
    # Decode just enough to scan the first ~40 lines for a header. We scan
    # broker-statement signals BEFORE bank-statement signals because
    # capital-gains exports often contain a "Date" column that would
    # otherwise satisfy the bank gate by accident.
    try:
        text = content[:16384].decode("utf-8", errors="ignore")
    except Exception:
        text = ""

    lowered = "\n".join(line.lower() for line in text.splitlines()[:40])

    # ---- Broker / capital-gains gate ----
    cg_hits = [h for h in _CG_HEADER_HINTS if h in lowered]
    has_isin = bool(_ISIN_RE.search(content[:16384]))
    if len(cg_hits) >= 2 or has_isin:
        signals.append(
            f"csv_header=capital_gains "
            f"(cg_hits={cg_hits[:4]}, isin={has_isin})"
        )
        return DetectionResult(
            file_kind="csv",
            document_type="capital_gains_statement",
            confidence=1.0,
            signals=signals,
        )

    # ---- Bank gate ----
    has_date = any(h in lowered for h in _CSV_DATE_HINTS)
    has_dr_cr = (
        any(h in lowered for h in _CSV_DEBIT_HINTS)
        and any(h in lowered for h in _CSV_CREDIT_HINTS)
    )
    has_amount = any(h in lowered for h in _CSV_AMOUNT_HINTS)
    if has_date and (has_dr_cr or has_amount):
        signals.append("csv_header=date+amount")
        return DetectionResult(
            file_kind="csv",
            document_type="bank_csv",
            confidence=1.0,
            signals=signals,
        )

    # Header is ambiguous — let downstream (CSV parser → if-fail Gemini)
    # decide. Mark as bank_csv at low confidence so the LLM escalation gate
    # fires.
    signals.append("csv_header=ambiguous")
    return DetectionResult(
        file_kind="csv",
        document_type="bank_csv",
        confidence=0.4,
        signals=signals,
    )
