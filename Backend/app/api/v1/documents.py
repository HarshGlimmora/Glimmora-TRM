"""Document upload + listing endpoints.

Per FILING_FLOW.md §3.3, there is a single upload endpoint:

    POST /api/v1/documents/upload

The client supplies no `document_type` or `tax_year`. The server:

  1. Saves the bytes under `data/uploads/{user_id}/{document_id}.{ext}`.
  2. Auto-detects the file kind (pdf vs csv) and document type by extension +
     MIME + content sniff (see `services/extraction/type_detector.py`).
  3. For CSVs, parses rows, applies the rule engine, and routes each row to
     the right FY filing (auto-creating sibling drafts when rows span FYs).
  4. For PDFs in Step 2, accepts and saves but defers extraction to Step 3.
     The document is marked `status='uploaded'`, `routing_status='pending'`
     and a routing_report explaining the deferral.

Every state-changing path appends an `audit_logs` row when that table is
populated — for v1 we leave the audit row as a TODO until Step 12 wires
audit_logs end-to-end.
"""

from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import (
    APIRouter,
    Body,
    Depends,
    File,
    Header,
    HTTPException,
    Path,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.api.v1.workspace import _ensure_shadow_user
from app.db.session import get_db
from app.models.documents import Document, PendingRouterInbox, Transaction
from app.models.filing import TaxReturn
from app.services.categorization import rules as rules_engine
from app.services.extraction.csv_parser import (
    CsvParseError,
    ParsedRow,
    parse_bank_csv,
)
from app.services.extraction.type_detector import (
    UnsupportedMediaType,
    detect as detect_type,
)
from app.services.routing import fy_router
from app.services.storage import (
    MAX_UPLOAD_BYTES,
    StoredFile,
    UploadTooLarge,
    delete_file,
    open_for_download,
    save_upload,
)


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["documents"])

FY_PATTERN = r"^FY\d{4}-\d{2}$"


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class DocumentOut(BaseModel):
    id: str
    filing_id: str | None
    tax_year: str | None
    document_type: str
    file_name: str
    mime_type: str
    size_bytes: int
    sha256: str
    status: str
    routing_status: str
    routing_report: dict[str, Any] | None
    extraction_payload: dict[str, Any] | None
    extraction_started_at: str | None
    extraction_finished_at: str | None
    extraction_error: str | None
    created_at: str
    updated_at: str


class RoutingReportOut(BaseModel):
    document_id: str
    routing_status: str
    document_type: str
    transactions_routed: dict[str, int] = Field(default_factory=dict)
    unresolved: list[dict[str, Any]] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    extraction_pending: bool = False


class ReassignDocumentBody(BaseModel):
    tax_year: str | None = Field(default=None, pattern=FY_PATTERN)
    file_name: str | None = Field(default=None, min_length=1, max_length=255)
    reason: str | None = Field(default=None, max_length=500)


class ExtractionPatchBody(BaseModel):
    """User edits to an extracted payload. Stored as a layered override on top
    of `raw` so we never lose what the model said. Keys are domain-specific
    paths (e.g. "salary_breakdown.gross_salary") with their replacement value.
    The merged view is `raw + user_overrides`."""
    fields: dict[str, Any] = Field(default_factory=dict)
    reason: str | None = Field(default=None, max_length=500)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _to_out(d: Document) -> DocumentOut:
    return DocumentOut(
        id=d.id,
        filing_id=d.filing_id,
        tax_year=d.tax_year,
        document_type=d.document_type,
        file_name=d.file_name,
        mime_type=d.mime_type,
        size_bytes=d.size_bytes,
        sha256=d.sha256,
        status=d.status,
        routing_status=d.routing_status,
        routing_report=d.routing_report,
        extraction_payload=d.extraction_payload,
        extraction_started_at=d.extraction_started_at,
        extraction_finished_at=d.extraction_finished_at,
        extraction_error=d.extraction_error,
        created_at=d.created_at,
        updated_at=d.updated_at,
    )


def _http_error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code, detail={"code": code, "message": message})


def _load_owned_document(db: Session, doc_id: str, user_id: str) -> Document:
    doc = db.get(Document, doc_id)
    if doc is None or doc.deleted_at is not None or doc.user_id != user_id:
        raise _http_error(404, "document_not_found", "Document not found.")
    return doc


# ---------------------------------------------------------------------------
# POST /documents/upload
# ---------------------------------------------------------------------------

@router.post(
    "/documents/upload",
    response_model=DocumentOut,
    summary="Upload a single document (CSV or PDF). Server auto-detects type and routes by FY.",
)
async def upload_document(
    file: UploadFile = File(...),
    hint_tax_year: str | None = Header(default=None, alias="X-Hint-Tax-Year", pattern=FY_PATTERN),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> DocumentOut:
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise _http_error(413, "file_too_large", f"Upload exceeds {MAX_UPLOAD_BYTES} bytes.")

    # Excel (.xlsx) files are zipped XML; the CSV parser and CSV→PDF renderer
    # both choke on the binary bytes. Detect by magic and convert to CSV in
    # memory BEFORE classification so the rest of the pipeline sees clean text.
    # Legacy .xls (Compound Document) is rejected with a clear error.
    file_name = file.filename or "upload"
    mime_type = file.content_type or "application/octet-stream"
    from app.services.extraction.excel_to_csv import (
        ExcelDecodeError,
        looks_like_legacy_xls,
        looks_like_xlsx,
        xlsx_bytes_to_csv,
    )
    if looks_like_legacy_xls(content[:8]):
        raise _http_error(
            415,
            "unsupported_media_type",
            "Legacy .xls (Excel 97-2003) isn't supported. "
            "Re-save the file as .xlsx or .csv and try again.",
        )
    if looks_like_xlsx(content[:4]):
        try:
            converted = xlsx_bytes_to_csv(content)
        except ExcelDecodeError as e:
            raise _http_error(415, "unsupported_media_type", str(e))
        logger.info(
            "Upload %r is .xlsx — converted to CSV in-memory (%d → %d bytes).",
            file_name, len(content), len(converted),
        )
        content = converted
        # Force the rest of the pipeline to treat it as CSV. The original .xlsx
        # extension is misleading once converted; rename to .csv so type_detector
        # and Gemini logs both reflect what we're actually processing.
        if file_name.lower().endswith(".xlsx"):
            file_name = file_name[:-5] + ".converted.csv"
        mime_type = "text/csv"

    try:
        detection = detect_type(
            file_name=file_name,
            mime_type=mime_type,
            content_sample=content,
        )
    except UnsupportedMediaType as e:
        raise _http_error(415, "unsupported_media_type", str(e))

    # Trace what we just decided. Surfaces classification mistakes early
    # when an unexpected pipeline runs (e.g. PDFs hitting the CSV parser).
    logger.info(
        "Upload %r (mime=%s, %d bytes, magic=%s): file_kind=%s document_type=%s "
        "confidence=%.2f signals=%s",
        file_name, mime_type, len(content), content[:5],
        detection.file_kind, detection.document_type, detection.confidence,
        detection.signals,
    )

    _ensure_shadow_user(db, current)

    # Idempotency on (user_id, sha256): the documents table has a partial UNIQUE
    # index `uq_documents_user_sha` for live rows. If we find a previous live
    # doc with the same sha and it's in a stale failed state (no extraction,
    # status=failed), drop it so this upload runs fresh — the user resubmitted
    # because they wanted a different outcome.
    file_sha256 = hashlib.sha256(content).hexdigest()
    existing = db.execute(
        select(Document).where(
            Document.user_id == current.id,
            Document.sha256 == file_sha256,
            Document.deleted_at.is_(None),
        )
    ).scalar_one_or_none()
    if existing is not None:
        is_stale_failure = (
            existing.status == "failed"
            or (existing.extraction_payload is None
                and existing.routing_status in ("pending", "unresolved"))
        )
        if is_stale_failure:
            logger.info(
                "Re-upload of %s found stale failed doc %s — soft-deleting and reprocessing.",
                file_name, existing.id,
            )
            existing.deleted_at = _now_iso()
            db.flush()
        else:
            return _to_out(existing)

    # Persist the document row first so we have a stable id for the storage path.
    document_id = str(uuid.uuid4())
    try:
        stored: StoredFile = save_upload(
            user_id=current.id,
            document_id=document_id,
            file_name=file_name,
            content=content,
        )
    except UploadTooLarge as e:
        raise _http_error(413, "file_too_large", str(e))

    now = _now_iso()
    doc = Document(
        id=document_id,
        user_id=current.id,
        filing_id=None,
        tax_year=None,
        document_type=detection.document_type,
        file_name=file_name,
        storage_path=stored.storage_path,
        mime_type=mime_type,
        size_bytes=stored.size_bytes,
        sha256=stored.sha256,
        status="uploaded",
        routing_status="pending",
        hint_tax_year=hint_tax_year,
        created_at=now,
        updated_at=now,
    )
    db.add(doc)
    db.flush()  # makes doc.id available for FK on transactions

    # Dispatch by file kind. Anything unexpected from the parser / rules /
    # router gets caught and converted to a clean failed-document record so
    # the UI sees the row (not a 500) and can show the reason. The original
    # exception is logged for debugging.
    try:
        if detection.file_kind == "csv":
            _process_csv_upload(
                db,
                doc=doc,
                current=current,
                content=content,
                initial_doc_type=detection.document_type,
                detection_confidence=detection.confidence,
            )
        else:
            _process_pdf_upload(
                db,
                doc=doc,
                current=current,
                pdf_bytes=content,
                initial_doc_type=detection.document_type,
                detection_confidence=detection.confidence,
            )
    except Exception as e:
        logger.exception("Unexpected error while processing upload %s", doc.id)
        db.rollback()
        # The rollback dropped our doc row too. Recreate a minimal "failed"
        # row so the user sees what happened. The file on disk is harmless;
        # it'll be cleaned up on the next manual delete.
        now2 = _now_iso()
        doc_failed = Document(
            id=document_id,
            user_id=current.id,
            filing_id=None,
            tax_year=None,
            document_type=detection.document_type,
            file_name=file_name,
            storage_path=stored.storage_path,
            mime_type=mime_type,
            size_bytes=stored.size_bytes,
            sha256=stored.sha256,
            status="failed",
            routing_status="unresolved",
            routed_at=now2,
            hint_tax_year=hint_tax_year,
            extraction_error=str(e),
            routing_report={
                "document_id": document_id,
                "routing_status": "unresolved",
                "document_type": detection.document_type,
                "transactions_routed": {},
                "unresolved": [],
                "notes": [f"Internal error while processing the upload: {e}"],
            },
            created_at=now,
            updated_at=now2,
        )
        db.add(doc_failed)
        db.commit()
        db.refresh(doc_failed)
        return _to_out(doc_failed)

    doc.updated_at = _now_iso()
    try:
        db.commit()
    except Exception as e:
        # Constraint violations on the commit itself (e.g. chk_documents_routed)
        # land here. Mark the document failed in a fresh tx so the user gets
        # a clean record back instead of a 500.
        logger.exception("DB commit failed for upload %s", doc.id)
        db.rollback()
        now2 = _now_iso()
        doc_failed = Document(
            id=document_id,
            user_id=current.id,
            filing_id=None,
            tax_year=None,
            document_type=detection.document_type,
            file_name=file_name,
            storage_path=stored.storage_path,
            mime_type=mime_type,
            size_bytes=stored.size_bytes,
            sha256=stored.sha256,
            status="failed",
            routing_status="unresolved",
            routed_at=now2,
            hint_tax_year=hint_tax_year,
            extraction_error=str(e),
            routing_report={
                "document_id": document_id,
                "routing_status": "unresolved",
                "document_type": detection.document_type,
                "transactions_routed": {},
                "unresolved": [],
                "notes": [f"DB integrity error while committing: {e}"],
            },
            created_at=now,
            updated_at=now2,
        )
        db.add(doc_failed)
        db.commit()
        db.refresh(doc_failed)
        return _to_out(doc_failed)
    db.refresh(doc)
    return _to_out(doc)


# ---------------------------------------------------------------------------
# CSV processing
# ---------------------------------------------------------------------------

def _process_csv_upload(
    db: Session,
    *,
    doc: Document,
    current: CurrentUser,
    content: bytes,
    initial_doc_type: str = "bank_csv",
    detection_confidence: float = 1.0,
) -> None:
    """CSV pipeline.

      * If `initial_doc_type == 'bank_csv'` and detection is confident, try
        the deterministic bank-CSV parser first. On success, route rows
        through the FY router (same path as before).
      * If the deterministic parser fails *or* detection picked a non-bank
        type (e.g. `capital_gains_statement`) *or* confidence is below the
        LLM threshold, escalate to Vertex AI Gemini for structured
        extraction. Per-type extraction routes the result through the same
        downstream FY-routing logic as the PDF path.
    """
    from app.config import get_settings
    settings = get_settings()
    notes: list[str] = []

    # ---- Try deterministic CSV parsing only when it makes sense ---------
    rows: list[ParsedRow] | None = None
    parser_error: str | None = None
    if initial_doc_type == "bank_csv" and detection_confidence >= settings.extraction_llm_threshold:
        try:
            rows = parse_bank_csv(content)
            notes.append(f"Deterministic CSV parser produced {len(rows)} rows.")
        except CsvParseError as e:
            parser_error = str(e)
            notes.append(f"Deterministic CSV parse failed: {e}. Escalating to Gemini.")
    else:
        notes.append(
            f"Detector emitted {initial_doc_type} at confidence "
            f"{detection_confidence:.2f}; routing to Gemini extractor."
        )

    # ---- Gemini fallback path -------------------------------------------
    if rows is None:
        _csv_gemini_fallback(
            db,
            doc=doc,
            current=current,
            content=content,
            initial_doc_type=initial_doc_type,
            notes=notes,
            parser_error=parser_error,
        )
        return

    routed_by_fy: dict[str, int] = {}
    unresolved: list[dict[str, Any]] = []

    # Group rows by their derived FY so we touch each sibling filing once.
    rows_by_fy: dict[str, list[ParsedRow]] = {}
    for row in rows:
        try:
            fy = fy_router.fy_for_date(row.txn_date)
        except Exception:
            unresolved.append({"reason": fy_router.INVALID_DATE, "raw": row.raw})
            inbox = PendingRouterInbox(
                user_id=current.id,
                document_id=doc.id,
                raw_payload={"row": row.raw, "reason": "invalid_date"},
                reason=fy_router.INVALID_DATE,
                created_at=_now_iso(),
            )
            db.add(inbox)
            continue
        rows_by_fy.setdefault(fy, []).append(row)

    if not rows_by_fy and not unresolved:
        # Deterministic path found a header but no valid transactions. Per the
        # 3-layer architecture, this is exactly when Layer 3 should fire — the
        # column-synonym map evidently doesn't cover this format. Hand off to
        # Gemini instead of giving up.
        notes.append(
            "Deterministic parser found header but produced 0 transactions "
            "(unrecognised date/amount format). Escalating to Gemini."
        )
        _csv_gemini_fallback(
            db,
            doc=doc,
            current=current,
            content=content,
            initial_doc_type=initial_doc_type,
            notes=notes,
            parser_error="header_matched_but_no_rows",
        )
        return

    # Set the "primary" filing the document attaches to: the most-rows FY.
    primary_fy: str | None = None
    if rows_by_fy:
        primary_fy = max(rows_by_fy.keys(), key=lambda k: len(rows_by_fy[k]))

    for fy, fy_rows in rows_by_fy.items():
        filing = fy_router.ensure_filing_for_fy(db, user_id=current.id, tax_year=fy)
        compiled = rules_engine.load_rules_for_fy(db, country="IN", tax_year=fy)

        for row in fy_rows:
            match = rules_engine.categorize(
                rules=compiled,
                direction=row.direction,
                description=row.description,
                amount=row.amount,
            )
            method = "rule" if match else "unmatched"
            category = match.category if match else None
            tx = Transaction(
                filing_id=filing.id,
                document_id=doc.id,
                user_id=current.id,
                tax_year=fy,
                txn_date=row.txn_date.isoformat(),
                amount=float(row.amount),
                description=row.description or None,
                counterparty=row.counterparty_hint,
                raw_payload=row.raw,
                category=category,
                categorization_method=method,
                rule_matched=match.rule_id if match else None,
                confidence_score=1.0 if match else None,
                routing_method="auto",
                routing_source_field="txn_date",
                routed_at=_now_iso(),
                status="unverified",
            )
            db.add(tx)
        routed_by_fy[fy] = len(fy_rows)

    if primary_fy is not None:
        primary_filing = fy_router.ensure_filing_for_fy(
            db, user_id=current.id, tax_year=primary_fy
        )
        doc.filing_id = primary_filing.id
        doc.tax_year = primary_fy

    spans = len(rows_by_fy)
    if spans == 0:
        doc.routing_status = "unresolved"
    elif spans == 1 and not unresolved:
        doc.routing_status = "routed"
    else:
        doc.routing_status = "partially_routed"
    doc.routed_at = _now_iso()
    doc.status = "completed"
    doc.extraction_started_at = doc.created_at
    doc.extraction_finished_at = _now_iso()

    doc.routing_report = {
        "document_id": doc.id,
        "routing_status": doc.routing_status,
        "document_type": doc.document_type,
        "transactions_routed": routed_by_fy,
        "unresolved": unresolved,
        "notes": notes,
    }


def _csv_gemini_fallback(
    db: Session,
    *,
    doc: Document,
    current: CurrentUser,
    content: bytes,
    initial_doc_type: str,
    notes: list[str],
    parser_error: str | None,
) -> None:
    """When the deterministic CSV parser abstains, decode the bytes as text
    and ask Gemini what kind of document this is + extract the structured
    payload. For capital-gains statements we route the per-trade rows into
    the right FY by sell-date (or buy-date if sell-date is missing). For any
    other doc-type returned by Gemini, we just persist the payload and let
    the user verify in the editor; Step 4 will wire the downstream tax
    treatment for each variant."""
    from app.services.extraction.csv_to_pdf import csv_bytes_to_pdf
    from app.services.extraction.gemini import ExtractionError, get_extractor

    extractor = get_extractor()
    doc.extraction_started_at = _now_iso()

    # Convert CSV → PDF in memory: Gemini variants (and gemini-3.x in
    # particular) accept PDF Parts more reliably than free-form text for
    # tabular data with mixed-width columns and multi-section layouts.
    try:
        pdf_bytes = csv_bytes_to_pdf(content, file_name=doc.file_name)
        notes.append(
            f"Converted CSV → PDF in-memory ({len(pdf_bytes)} bytes) for Gemini ingestion."
        )
    except Exception as e:
        # Fall back to text_sample if the converter dies — better to try than
        # to fail outright. The text path was the original Layer-3 input.
        logger.exception("CSV→PDF conversion failed for %s; falling back to text payload.", doc.id)
        notes.append(f"CSV→PDF conversion failed: {e}. Falling back to text payload.")
        pdf_bytes = None

    text_sample = ""
    if pdf_bytes is None:
        for enc in ("utf-8-sig", "utf-8", "latin-1"):
            try:
                text_sample = content.decode(enc)
                break
            except UnicodeDecodeError:
                continue

    # Classify if Layer 1 abstained or picked something obviously stale.
    used_doc_type = initial_doc_type
    if initial_doc_type in ("bank_csv", "unknown_pdf") or parser_error is not None:
        if pdf_bytes is not None:
            probe = extractor.classify(
                file_bytes=pdf_bytes,
                mime_type="application/pdf",
                fallback_hint=initial_doc_type if initial_doc_type != "bank_csv" else None,
            )
        else:
            probe = extractor.classify(
                text_sample=text_sample,
                mime_type="text/csv",
                fallback_hint=initial_doc_type if initial_doc_type != "bank_csv" else None,
            )
        notes.append(
            f"Gemini classify → {probe.doc_type} (confidence={probe.confidence:.2f}, "
            f"reasoning={probe.reasoning or '—'})"
        )
        if probe.doc_type in (
            "capital_gains_statement", "broker_pnl",
            "form16", "form_26as", "ais_tis", "salary_slip",
            "bank_pdf",
        ):
            used_doc_type = probe.doc_type
            doc.document_type = used_doc_type

    extraction_payload: dict | None = None
    extraction_failed = False

    # bank_csv is an alias for bank_pdf when going through Gemini — same
    # schema (BankPdfExtraction). Normalise so the extractor lookup works.
    extract_doc_type = used_doc_type
    if extract_doc_type == "bank_csv":
        extract_doc_type = "bank_pdf"

    if extract_doc_type not in (
        "capital_gains_statement", "broker_pnl",
        "form16", "form_26as", "ais_tis", "salary_slip",
        "bank_pdf",
    ):
        # We don't have a structured extractor for this — treat as a failed
        # deterministic parse and surface the reason to the UI.
        doc.status = "failed"
        doc.routing_status = "unresolved"
        doc.routed_at = _now_iso()
        doc.extraction_finished_at = _now_iso()
        doc.extraction_error = parser_error or "Could not identify the document type."
        doc.routing_report = {
            "document_id": doc.id,
            "routing_status": "unresolved",
            "document_type": doc.document_type,
            "transactions_routed": {},
            "unresolved": [],
            "notes": [
                *notes,
                "Supported CSV layouts: bank statement (Date + Debit/Credit), "
                "capital-gains export (Symbol + ISIN + Buy/Sell dates).",
            ],
        }
        return

    try:
        if pdf_bytes is not None:
            result = extractor.extract(
                doc_type=extract_doc_type,
                file_bytes=pdf_bytes,
                mime_type="application/pdf",
            )
        else:
            result = extractor.extract(
                doc_type=extract_doc_type,
                text_sample=text_sample,
                mime_type="text/csv",
            )
        extraction_payload = {
            "version": "v1",
            "model_used": result.model_used,
            "doc_type": result.doc_type,
            "extracted_at": result.extracted_at,
            "confidence": result.confidence,
            "raw": result.payload,
            "user_overrides": {},
        }
        doc.extraction_payload = extraction_payload
        notes.append(
            f"Gemini extract → {result.doc_type} ({result.model_used}, "
            f"confidence={result.confidence:.2f})"
        )
    except ExtractionError as e:
        extraction_failed = True
        doc.extraction_error = str(e)
        notes.append(f"Extraction failed: {e}")

    doc.extraction_finished_at = _now_iso()

    # Route extracted rows into the FY they belong to.
    routed_by_fy: dict[str, int] = {}
    if extraction_payload is not None:
        if extract_doc_type in ("capital_gains_statement", "broker_pnl"):
            routed_by_fy = _route_capital_gains_to_fy(
                db,
                doc=doc,
                current=current,
                payload=extraction_payload["raw"],
                notes=notes,
            )
        elif extract_doc_type == "bank_pdf":
            # Bank statement extracted from a CSV. Same per-row routing as the
            # PDF path: feed `BankPdfExtraction.transactions` through the FY
            # router so the row table populates normally.
            routed_by_fy = _route_bank_pdf_transactions(
                db,
                doc=doc,
                current=current,
                extracted_payload=extraction_payload["raw"],
                notes=notes,
            )

    # Final status + routing_report.
    if extraction_failed:
        doc.status = "failed"
        doc.routing_status = "unresolved"
        doc.routed_at = _now_iso()
    elif extract_doc_type in (
        "capital_gains_statement", "broker_pnl", "bank_pdf"
    ):
        if not routed_by_fy:
            doc.routing_status = "unresolved"
        elif len(routed_by_fy) == 1:
            doc.routing_status = "routed"
        else:
            doc.routing_status = "partially_routed"
        doc.routed_at = _now_iso()
        doc.status = "completed"
    else:
        # Non-transactional summary docs (Form 16 etc.). Just persist the payload.
        doc.routing_status = "overridden"
        doc.routed_at = _now_iso()
        doc.status = "completed"

    doc.routing_report = {
        "document_id": doc.id,
        "routing_status": doc.routing_status,
        "document_type": doc.document_type,
        "transactions_routed": routed_by_fy,
        "unresolved": [],
        "notes": notes,
        "extraction_pending": False,
    }


def _route_capital_gains_to_fy(
    db: Session,
    *,
    doc: Document,
    current: CurrentUser,
    payload: dict,
    notes: list[str],
) -> dict[str, int]:
    """Tally trade rows by FY-of-sell-date so we can pick the primary filing
    and create siblings for any FY with hits. We don't write to the
    transactions table for capital gains (shape mismatch) — the structured
    payload lives in `documents.extraction_payload` and Step 4 / the tax
    engine will read it from there."""
    from datetime import date as _date

    sections = (
        "equity_stcg_111a",
        "equity_ltcg_112a",
        "mutual_fund_redemptions",
        "equity_intraday",
        "fno_trades",
        "dividends",
    )
    counts: dict[str, int] = {}
    for sec in sections:
        for row in payload.get(sec) or []:
            iso = (
                row.get("sell_date")
                or row.get("trade_date")
                or row.get("date")
                or row.get("buy_date")
            )
            if not isinstance(iso, str):
                continue
            try:
                year, month, day = (int(x) for x in iso.split("-"))
                d = _date(year, month, day)
            except Exception:
                continue
            fy = fy_router.fy_for_date(d)
            counts[fy] = counts.get(fy, 0) + 1

    if not counts:
        notes.append("Capital-gains extraction produced no datable rows.")
        return {}

    primary_fy = max(counts.keys(), key=lambda k: counts[k])
    primary = fy_router.ensure_filing_for_fy(db, user_id=current.id, tax_year=primary_fy)
    doc.filing_id = primary.id
    doc.tax_year = primary_fy
    # Pre-create sibling drafts for the other FYs so they show up in the workspace.
    for fy in counts:
        if fy != primary_fy:
            fy_router.ensure_filing_for_fy(db, user_id=current.id, tax_year=fy)
    return counts


# ---------------------------------------------------------------------------
# PDF processing — Step 3: Gemini classify + extract, then route bank rows
# ---------------------------------------------------------------------------

def _process_pdf_upload(
    db: Session,
    *,
    doc: Document,
    current: CurrentUser,
    pdf_bytes: bytes,
    initial_doc_type: str,
    detection_confidence: float,
) -> None:
    """Layer-1 detection has already labeled the PDF. If confidence is below
    the LLM threshold (`settings.extraction_llm_threshold`, default 0.9), or
    we couldn't classify deterministically (unknown_pdf), we escalate to
    Vertex AI Gemini for a classify-then-extract round-trip. Anything Gemini
    pulls out is validated against the per-type Pydantic schema and stored
    verbatim in `documents.extraction_payload`.

    For bank PDFs (the only document type whose extraction produces
    transactions), each extracted row is fed through the same FY router that
    handles CSVs so the downstream filing UX is uniform.
    """
    from app.config import get_settings
    from app.services.extraction.gemini import ExtractionError, get_extractor

    extractor = get_extractor()
    settings = get_settings()
    notes: list[str] = []
    used_doc_type = initial_doc_type

    doc.extraction_started_at = _now_iso()

    # ---- Classify (Layer 3) if Layer 1 abstained or low-confidence -------
    needs_llm_classify = (
        initial_doc_type == "unknown_pdf"
        or detection_confidence < settings.extraction_llm_threshold
    )
    if needs_llm_classify:
        probe = extractor.classify(
            pdf_bytes=pdf_bytes,
            fallback_hint=initial_doc_type if initial_doc_type != "unknown_pdf" else None,
        )
        notes.append(
            f"Gemini classify → {probe.doc_type} (confidence={probe.confidence:.2f}, "
            f"reasoning={probe.reasoning or '—'})"
        )
        if probe.doc_type != "unknown_pdf":
            used_doc_type = probe.doc_type
            doc.document_type = used_doc_type

    # ---- Extract (Layer 3) if we have a concrete doc_type ----------------
    extraction_payload: dict | None = None
    extraction_failed = False
    if used_doc_type and used_doc_type != "unknown_pdf":
        try:
            result = extractor.extract(doc_type=used_doc_type, pdf_bytes=pdf_bytes)
            extraction_payload = {
                "version": "v1",
                "model_used": result.model_used,
                "doc_type": result.doc_type,
                "extracted_at": result.extracted_at,
                "confidence": result.confidence,
                "raw": result.payload,
                "user_overrides": {},
            }
            doc.extraction_payload = extraction_payload
            notes.append(
                f"Gemini extract → {result.doc_type} ({result.model_used}, "
                f"confidence={result.confidence:.2f})"
            )
        except ExtractionError as e:
            extraction_failed = True
            doc.extraction_error = str(e)
            notes.append(f"Extraction failed: {e}")

    doc.extraction_finished_at = _now_iso()

    # ---- Bank PDFs: route extracted transactions through the FY router ---
    routed_by_fy: dict[str, int] = {}
    if (
        used_doc_type == "bank_pdf"
        and extraction_payload is not None
        and not extraction_failed
    ):
        routed_by_fy = _route_bank_pdf_transactions(
            db,
            doc=doc,
            current=current,
            extracted_payload=extraction_payload["raw"],
            notes=notes,
        )

    # ---- Persist routing report + final statuses -------------------------
    if extraction_failed and not routed_by_fy:
        doc.status = "failed"
        doc.routing_status = "unresolved"
        doc.routed_at = _now_iso()
    elif used_doc_type == "unknown_pdf":
        # No deterministic classification, no Gemini classification either.
        # Leave the document pending so a re-extract or manual override can
        # rescue it; this is not a hard failure.
        doc.status = "uploaded"
        doc.routing_status = "pending"
    elif used_doc_type == "bank_pdf":
        spans = len(routed_by_fy)
        if spans == 0:
            doc.routing_status = "unresolved"
        elif spans == 1:
            doc.routing_status = "routed"
        else:
            doc.routing_status = "partially_routed"
        doc.routed_at = _now_iso()
        doc.status = "completed"
    else:
        # Non-transactional documents (Form 16, 26AS, AIS, salary slip).
        # They produce summaries, not rows — nothing for the FY router to do.
        # Status flips to completed; routing_status='overridden' indicates we
        # bypassed the router by design.
        doc.routing_status = "overridden"
        doc.routed_at = _now_iso()
        doc.status = "completed"

    doc.routing_report = {
        "document_id": doc.id,
        "routing_status": doc.routing_status,
        "document_type": doc.document_type,
        "transactions_routed": routed_by_fy,
        "unresolved": [],
        "notes": notes or ["PDF accepted."],
        "extraction_pending": extraction_payload is None and not extraction_failed,
    }


def _route_bank_pdf_transactions(
    db: Session,
    *,
    doc: Document,
    current: CurrentUser,
    extracted_payload: dict,
    notes: list[str],
) -> dict[str, int]:
    """Take Gemini's `BankPdfExtraction.transactions` and turn them into rows
    in the same `transactions` table the CSV path writes to. Each row goes
    through the FY router by its `txn_date` and lands in the appropriate
    (sibling) filing draft. Categorization runs the same rule engine — these
    rows are marked `categorization_method='ai_assisted'` because the
    description came from Gemini, not from a deterministic CSV row.
    """
    from decimal import Decimal as _D

    from app.services.categorization import rules as rules_engine
    from app.services.routing import fy_router

    txns = extracted_payload.get("transactions") or []
    if not txns:
        notes.append("Bank PDF extracted but no transaction rows produced.")
        return {}

    rows_by_fy: dict[str, list[dict]] = {}
    for raw_txn in txns:
        date_str = raw_txn.get("txn_date") or raw_txn.get("value_date")
        if not isinstance(date_str, str) or not date_str:
            continue
        try:
            from datetime import date as _date
            year, month, day = map(int, date_str.split("-"))
            d = _date(year, month, day)
        except Exception:
            continue
        fy = fy_router.fy_for_date(d)
        rows_by_fy.setdefault(fy, []).append({**raw_txn, "_date": d})

    routed: dict[str, int] = {}
    primary_fy = (
        max(rows_by_fy.keys(), key=lambda k: len(rows_by_fy[k])) if rows_by_fy else None
    )

    for fy, fy_rows in rows_by_fy.items():
        filing = fy_router.ensure_filing_for_fy(db, user_id=current.id, tax_year=fy)
        compiled = rules_engine.load_rules_for_fy(db, country="IN", tax_year=fy)
        for raw_txn in fy_rows:
            debit = raw_txn.get("debit_amount")
            credit = raw_txn.get("credit_amount")
            amount: _D
            direction: str
            if debit is not None and str(debit) not in {"", "0", "0.0", "0.00", "None"}:
                try:
                    amount = -_D(str(debit))
                    direction = "debit"
                except Exception:
                    continue
            elif credit is not None and str(credit) not in {"", "0", "0.0", "0.00", "None"}:
                try:
                    amount = _D(str(credit))
                    direction = "credit"
                except Exception:
                    continue
            else:
                continue

            description = raw_txn.get("description") or ""
            match = rules_engine.categorize(
                rules=compiled,
                direction=direction,
                description=description,
                amount=amount,
            )

            tx = Transaction(
                filing_id=filing.id,
                document_id=doc.id,
                user_id=current.id,
                tax_year=fy,
                txn_date=raw_txn["_date"].isoformat(),
                amount=float(amount),
                description=description or None,
                counterparty=raw_txn.get("counterparty_hint"),
                raw_payload={k: v for k, v in raw_txn.items() if k != "_date"},
                category=match.category if match else None,
                categorization_method="ai_assisted",  # description came from Gemini
                rule_matched=match.rule_id if match else None,
                confidence_score=0.85 if match else None,
                routing_method="auto",
                routing_source_field="txn_date",
                routed_at=_now_iso(),
                status="unverified",
            )
            db.add(tx)
        routed[fy] = len(fy_rows)

    if primary_fy is not None:
        primary_filing = fy_router.ensure_filing_for_fy(
            db, user_id=current.id, tax_year=primary_fy
        )
        doc.filing_id = primary_filing.id
        doc.tax_year = primary_fy

    return routed


# ---------------------------------------------------------------------------
# Read endpoints
# ---------------------------------------------------------------------------

@router.get(
    "/filings/{filing_id}/documents",
    response_model=list[DocumentOut],
    summary="List documents attached to a filing.",
)
def list_filing_documents(
    filing_id: str = Path(..., min_length=1),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> list[DocumentOut]:
    filing = db.get(TaxReturn, filing_id)
    if filing is None or filing.deleted_at is not None or filing.user_id != current.id:
        raise _http_error(404, "filing_not_found", "Filing not found.")
    stmt = (
        select(Document)
        .where(Document.filing_id == filing_id, Document.deleted_at.is_(None))
        .order_by(Document.created_at.desc())
    )
    rows = db.execute(stmt).scalars().all()
    return [_to_out(r) for r in rows]


@router.get(
    "/documents/{document_id}",
    response_model=DocumentOut,
    summary="Document detail.",
)
def get_document(
    document_id: str = Path(..., min_length=1),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> DocumentOut:
    return _to_out(_load_owned_document(db, document_id, current.id))


@router.get(
    "/documents/{document_id}/routing-report",
    response_model=RoutingReportOut,
    summary="Routing report — which FYs the document's rows landed in.",
)
def get_routing_report(
    document_id: str = Path(..., min_length=1),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> RoutingReportOut:
    doc = _load_owned_document(db, document_id, current.id)
    if doc.routing_status == "pending" and (doc.routing_report or {}).get("extraction_pending") is not True:
        # CSV in flight — current implementation is synchronous so this is rare,
        # but the contract surface stays correct for future async pipelines.
        raise _http_error(409, "routing_in_progress", "Routing is still running.")
    report = doc.routing_report or {}
    return RoutingReportOut(
        document_id=doc.id,
        routing_status=doc.routing_status,
        document_type=doc.document_type,
        transactions_routed=report.get("transactions_routed", {}) or {},
        unresolved=report.get("unresolved", []) or [],
        notes=report.get("notes", []) or [],
        extraction_pending=bool(report.get("extraction_pending", False)),
    )


@router.get(
    "/documents/{document_id}/download",
    summary="Download the original uploaded file.",
)
def download_document(
    document_id: str = Path(..., min_length=1),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> FileResponse:
    doc = _load_owned_document(db, document_id, current.id)
    try:
        path = open_for_download(doc.storage_path)
    except FileNotFoundError:
        raise _http_error(410, "file_gone", "The stored file is no longer available.")
    return FileResponse(path, media_type=doc.mime_type, filename=doc.file_name)


# ---------------------------------------------------------------------------
# PUT /documents/{id} — reassign FY (and/or rename) the whole document
# ---------------------------------------------------------------------------

@router.put(
    "/documents/{document_id}",
    response_model=DocumentOut,
    summary="Reassign the document (and all its transactions) to a different FY.",
)
def reassign_document(
    body: ReassignDocumentBody = Body(...),
    document_id: str = Path(..., min_length=1),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> DocumentOut:
    doc = _load_owned_document(db, document_id, current.id)

    if body.tax_year is None and body.file_name is None:
        raise _http_error(
            400,
            "no_changes",
            "Nothing to update. Provide tax_year and/or file_name.",
        )

    if body.file_name is not None:
        doc.file_name = body.file_name.strip()

    if body.tax_year is not None:
        target_filing = fy_router.ensure_filing_for_fy(
            db, user_id=current.id, tax_year=body.tax_year
        )
        # Move the document.
        doc.filing_id = target_filing.id
        doc.tax_year = body.tax_year
        doc.routing_status = "overridden"
        doc.routed_at = _now_iso()
        # Move every transaction this document produced.
        now = _now_iso()
        moved = (
            db.query(Transaction)
            .filter(Transaction.document_id == doc.id)
            .update(
                {
                    Transaction.filing_id: target_filing.id,
                    Transaction.tax_year: body.tax_year,
                    Transaction.routing_method: "manual_override",
                    Transaction.routed_at: now,
                    Transaction.updated_at: now,
                },
                synchronize_session=False,
            )
        )
        # Refresh the routing report to reflect the override.
        prior_notes = (doc.routing_report or {}).get("notes", []) or []
        note = f"Reassigned to {body.tax_year} by user."
        if body.reason:
            note += f" Reason: {body.reason}"
        doc.routing_report = {
            "document_id": doc.id,
            "routing_status": "overridden",
            "document_type": doc.document_type,
            "transactions_routed": {body.tax_year: moved},
            "unresolved": [],
            "notes": [*prior_notes, note],
        }

    doc.updated_at = _now_iso()
    db.commit()
    db.refresh(doc)
    return _to_out(doc)


# ---------------------------------------------------------------------------
# PATCH /documents/{id}/extraction — user edits to the extracted payload
# ---------------------------------------------------------------------------

@router.patch(
    "/documents/{document_id}/extraction",
    response_model=DocumentOut,
    summary="Edit Gemini-extracted fields. Stored as a layered override; raw is preserved.",
)
def patch_extraction(
    body: ExtractionPatchBody = Body(...),
    document_id: str = Path(..., min_length=1),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> DocumentOut:
    doc = _load_owned_document(db, document_id, current.id)
    if doc.extraction_payload is None:
        raise _http_error(409, "no_extraction_yet", "This document has no extraction to edit.")

    payload = dict(doc.extraction_payload)
    overrides = dict(payload.get("user_overrides") or {})
    overrides.update(body.fields or {})
    payload["user_overrides"] = overrides
    if body.reason:
        payload.setdefault("override_reasons", []).append(
            {"reason": body.reason, "at": _now_iso(), "fields": list(body.fields.keys())}
        )
    doc.extraction_payload = payload
    doc.updated_at = _now_iso()
    db.commit()
    db.refresh(doc)
    return _to_out(doc)


# ---------------------------------------------------------------------------
# POST /documents/{id}/reextract — re-run Gemini on the stored file
# ---------------------------------------------------------------------------

@router.post(
    "/documents/{document_id}/reextract",
    response_model=DocumentOut,
    summary="Re-run Vertex AI Gemini extraction on the stored file.",
)
def reextract_document(
    document_id: str = Path(..., min_length=1),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> DocumentOut:
    doc = _load_owned_document(db, document_id, current.id)
    is_pdf = doc.mime_type == "application/pdf"
    is_csvish = (
        doc.mime_type in {"text/csv", "text/plain", "application/csv"}
        or doc.file_name.lower().endswith((".csv", ".txt", ".tsv"))
    )
    if not (is_pdf or is_csvish):
        raise _http_error(
            409,
            "reextract_not_supported",
            "Re-extraction runs only for PDF and CSV/TSV files.",
        )

    try:
        path = open_for_download(doc.storage_path)
        file_bytes = path.read_bytes()
    except FileNotFoundError:
        raise _http_error(410, "file_gone", "The stored file is no longer available.")

    # Drop transactions this document produced so the re-routed set is clean.
    db.execute(Transaction.__table__.delete().where(Transaction.document_id == doc.id))
    doc.extraction_payload = None
    doc.extraction_error = None
    doc.routing_status = "pending"
    doc.routed_at = None
    doc.filing_id = None
    doc.tax_year = None

    try:
        if is_pdf:
            _process_pdf_upload(
                db,
                doc=doc,
                current=current,
                pdf_bytes=file_bytes,
                initial_doc_type=doc.document_type or "unknown_pdf",
                detection_confidence=0.0,  # force LLM classify on reextract
            )
        else:
            _process_csv_upload(
                db,
                doc=doc,
                current=current,
                content=file_bytes,
                initial_doc_type=doc.document_type or "bank_csv",
                detection_confidence=0.0,  # force LLM fallback on reextract
            )
    except Exception as e:
        logger.exception("Re-extract failed for %s", doc.id)
        db.rollback()
        raise _http_error(500, "reextract_failed", str(e))

    doc.updated_at = _now_iso()
    db.commit()
    db.refresh(doc)
    return _to_out(doc)


# ---------------------------------------------------------------------------
# DELETE /documents/{id} — cascades transactions
# ---------------------------------------------------------------------------

@router.delete(
    "/documents/{document_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete a document and remove its transactions.",
)
def delete_document(
    document_id: str = Path(..., min_length=1),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    doc = _load_owned_document(db, document_id, current.id)
    db.execute(
        Transaction.__table__.delete().where(Transaction.document_id == doc.id)
    )
    # Soft-delete on the document row, hard-delete the file on disk.
    doc.deleted_at = _now_iso()
    delete_file(doc.storage_path)
    db.commit()
    return None
