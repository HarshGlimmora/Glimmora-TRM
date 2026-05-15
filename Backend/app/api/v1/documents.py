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

    try:
        detection = detect_type(
            file_name=file.filename or "upload",
            mime_type=file.content_type,
            content_sample=content,
        )
    except UnsupportedMediaType as e:
        raise _http_error(415, "unsupported_media_type", str(e))

    _ensure_shadow_user(db, current)

    # Idempotency on (user_id, sha256): the documents table has a partial UNIQUE
    # index `uq_documents_user_sha` for live rows. Computing the hash up front
    # lets us return the existing document instead of 500-ing on a duplicate
    # re-upload (same behaviour as POST /workspace/years/{fy}/filing).
    file_sha256 = hashlib.sha256(content).hexdigest()
    existing = db.execute(
        select(Document).where(
            Document.user_id == current.id,
            Document.sha256 == file_sha256,
            Document.deleted_at.is_(None),
        )
    ).scalar_one_or_none()
    if existing is not None:
        return _to_out(existing)

    # Persist the document row first so we have a stable id for the storage path.
    document_id = str(uuid.uuid4())
    try:
        stored: StoredFile = save_upload(
            user_id=current.id,
            document_id=document_id,
            file_name=file.filename or "upload",
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
        file_name=file.filename or "upload",
        storage_path=stored.storage_path,
        mime_type=file.content_type or "application/octet-stream",
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
            _process_csv_upload(db, doc=doc, current=current, content=content)
        else:
            _process_pdf_upload(doc=doc)
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
            file_name=file.filename or "upload",
            storage_path=stored.storage_path,
            mime_type=file.content_type or "application/octet-stream",
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
            file_name=file.filename or "upload",
            storage_path=stored.storage_path,
            mime_type=file.content_type or "application/octet-stream",
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
) -> None:
    try:
        rows = parse_bank_csv(content)
    except CsvParseError as e:
        # Constraint chk_documents_routed: any non-'pending' routing_status must
        # have routed_at set. Stamp it on every terminal path.
        doc.status = "failed"
        doc.routing_status = "unresolved"
        doc.routed_at = _now_iso()
        doc.extraction_error = str(e)
        doc.routing_report = {
            "document_id": doc.id,
            "routing_status": "unresolved",
            "document_type": doc.document_type,
            "transactions_routed": {},
            "unresolved": [],
            "notes": [
                f"CSV parse failed: {e}",
                "Expected the first non-empty row to be a header containing a "
                "date column (Txn Date / Transaction Date / Date) and either "
                "Debit+Credit columns or a single Amount column.",
            ],
        }
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
        doc.routing_status = "unresolved"
        doc.routed_at = _now_iso()
        doc.status = "failed"
        doc.routing_report = {
            "document_id": doc.id,
            "routing_status": "unresolved",
            "document_type": doc.document_type,
            "transactions_routed": {},
            "unresolved": [],
            "notes": ["CSV parsed but produced no recognisable transaction rows."],
        }
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
        "notes": [],
    }


# ---------------------------------------------------------------------------
# PDF processing — Step 2 just accepts and stages for Step 3
# ---------------------------------------------------------------------------

def _process_pdf_upload(*, doc: Document) -> None:
    doc.status = "uploaded"
    doc.routing_status = "pending"
    doc.routing_report = {
        "document_id": doc.id,
        "routing_status": "pending",
        "document_type": doc.document_type,
        "transactions_routed": {},
        "unresolved": [],
        "notes": [
            "PDF accepted. Extraction will run when Step 3 wires Vertex AI Gemini.",
        ],
        "extraction_pending": True,
    }


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
