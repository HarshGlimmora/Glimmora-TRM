"""Transaction-level endpoints for a filing's review screen.

Per FILING_FLOW.md §3.4 + API_CONTRACTS §6.9–§6.10. Eight endpoints:

  GET    /api/v1/filings/{id}/transactions          (filters + pagination)
  GET    /api/v1/filings/{id}/transactions/progress (verified/unverified tally)
  GET    /api/v1/filings/{id}/transactions/{tx_id}  (single row)
  PUT    /api/v1/filings/{id}/transactions/{tx_id}  (edit)
  POST   /api/v1/filings/{id}/transactions/{tx_id}/verify   (single verify)
  POST   /api/v1/filings/{id}/transactions/verify-all       (bulk)
  POST   /api/v1/filings/{id}/transactions          (manual create)
  DELETE /api/v1/filings/{id}/transactions/{tx_id}

Editing rule:
  any user edit → categorization_method='manual', confidence_score=1.000,
  routing_method='manual_override'.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.api.v1.workspace import _ensure_shadow_user
from app.db.session import get_db
from app.models.documents import Transaction
from app.models.filing import TaxReturn


router = APIRouter(prefix="/api/v1", tags=["transactions"])

FY_PATTERN = r"^FY\d{4}-\d{2}$"


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class TxnOut(BaseModel):
    id: str
    filing_id: str
    document_id: str | None
    tax_year: str
    txn_date: str
    amount: str                         # NUMERIC as string, per API_CONTRACTS
    description: str | None
    counterparty: str | None
    category: str | None
    categorization_method: str          # rule | ai_assisted | manual | unmatched
    rule_matched: str | None
    confidence_score: float | None
    routing_method: str                 # auto | manual_override
    status: str                         # unverified | verified | rejected
    verified_at: str | None
    created_at: str
    updated_at: str


class TxnListMeta(BaseModel):
    page: int
    limit: int
    total: int


class TxnListOut(BaseModel):
    items: list[TxnOut]
    meta: TxnListMeta


class TxnProgressOut(BaseModel):
    total: int
    verified: int
    unverified: int
    rejected: int
    percent: float


class TxnPutBody(BaseModel):
    category: str | None = None
    amount: str | None = None           # accept string to preserve precision
    txn_date: str | None = None         # ISO YYYY-MM-DD
    description: str | None = None
    tax_year: str | None = Field(default=None, pattern=FY_PATTERN)
    status: Literal["unverified", "verified", "rejected"] | None = None
    counterparty: str | None = None
    reason: str | None = Field(default=None, max_length=500)


class TxnCreateBody(BaseModel):
    txn_date: str
    amount: str
    description: str | None = None
    category: str | None = None
    counterparty: str | None = None
    tax_year: str | None = Field(default=None, pattern=FY_PATTERN)


class VerifyAllFilter(BaseModel):
    method: Literal["rule", "ai_assisted", "manual", "unmatched"] | None = None
    head: str | None = None             # informal: matches against `category`


class VerifyAllBody(BaseModel):
    filter: VerifyAllFilter | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _http_error(code: int, error_code: str, message: str) -> HTTPException:
    return HTTPException(code, detail={"code": error_code, "message": message})


def _to_out(t: Transaction) -> TxnOut:
    return TxnOut(
        id=t.id,
        filing_id=t.filing_id,
        document_id=t.document_id,
        tax_year=t.tax_year,
        txn_date=t.txn_date,
        amount=str(t.amount) if t.amount is not None else "0",
        description=t.description,
        counterparty=t.counterparty,
        category=t.category,
        categorization_method=t.categorization_method,
        rule_matched=t.rule_matched,
        confidence_score=t.confidence_score,
        routing_method=t.routing_method,
        status=t.status,
        verified_at=t.verified_at,
        created_at=t.created_at,
        updated_at=t.updated_at,
    )


def _load_owned_filing(db: Session, filing_id: str, user_id: str) -> TaxReturn:
    filing = db.get(TaxReturn, filing_id)
    if filing is None or filing.deleted_at is not None or filing.user_id != user_id:
        raise _http_error(404, "filing_not_found", "Filing not found.")
    return filing


def _load_owned_transaction(
    db: Session, filing_id: str, tx_id: str, user_id: str
) -> Transaction:
    _load_owned_filing(db, filing_id, user_id)
    tx = db.get(Transaction, tx_id)
    if tx is None or tx.filing_id != filing_id or tx.user_id != user_id:
        raise _http_error(404, "transaction_not_found", "Transaction not found.")
    return tx


def _parse_decimal(s: str, field: str) -> Decimal:
    try:
        return Decimal(s)
    except (InvalidOperation, TypeError):
        raise _http_error(422, "invalid_amount", f"Field {field!r} must be a numeric string.")


def _parse_date(s: str, field: str) -> str:
    try:
        datetime.strptime(s, "%Y-%m-%d")
    except ValueError:
        raise _http_error(422, "invalid_date", f"Field {field!r} must be ISO YYYY-MM-DD.")
    return s


# ---------------------------------------------------------------------------
# GET list (with filters + pagination)
# ---------------------------------------------------------------------------

@router.get(
    "/filings/{filing_id}/transactions",
    response_model=TxnListOut,
    summary="List transactions for a filing, with filters + pagination.",
)
def list_transactions(
    filing_id: str = Path(..., min_length=1),
    status_filter: Literal["unverified", "verified", "rejected", "all"] = Query(
        default="all", alias="status"
    ),
    method: Literal["rule", "ai_assisted", "manual", "unmatched"] | None = Query(default=None),
    head: str | None = Query(default=None, description="Substring match on `category`."),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> TxnListOut:
    _load_owned_filing(db, filing_id, current.id)

    conditions = [Transaction.filing_id == filing_id]
    if status_filter != "all":
        conditions.append(Transaction.status == status_filter)
    if method is not None:
        conditions.append(Transaction.categorization_method == method)
    if head:
        # Informal "head of income" filter — matches the `category` column.
        conditions.append(Transaction.category.ilike(f"%{head}%"))

    where = and_(*conditions)

    total = db.execute(
        select(func.count()).select_from(Transaction).where(where)
    ).scalar_one()

    rows = (
        db.execute(
            select(Transaction)
            .where(where)
            .order_by(Transaction.txn_date.desc(), Transaction.created_at.desc())
            .offset((page - 1) * limit)
            .limit(limit)
        )
        .scalars()
        .all()
    )

    return TxnListOut(
        items=[_to_out(t) for t in rows],
        meta=TxnListMeta(page=page, limit=limit, total=int(total)),
    )


# ---------------------------------------------------------------------------
# GET progress (drives the verify-progress bar)
# ---------------------------------------------------------------------------

@router.get(
    "/filings/{filing_id}/transactions/progress",
    response_model=TxnProgressOut,
    summary="Aggregated verify/unverified counts for the filing.",
)
def transactions_progress(
    filing_id: str = Path(..., min_length=1),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> TxnProgressOut:
    _load_owned_filing(db, filing_id, current.id)
    rows = db.execute(
        select(Transaction.status, func.count())
        .where(Transaction.filing_id == filing_id)
        .group_by(Transaction.status)
    ).all()
    tally = {status_: int(count) for status_, count in rows}
    total = sum(tally.values())
    verified = tally.get("verified", 0)
    unverified = tally.get("unverified", 0)
    rejected = tally.get("rejected", 0)
    percent = (verified / total * 100.0) if total > 0 else 0.0
    return TxnProgressOut(
        total=total,
        verified=verified,
        unverified=unverified,
        rejected=rejected,
        percent=round(percent, 2),
    )


# ---------------------------------------------------------------------------
# GET detail
# ---------------------------------------------------------------------------

@router.get(
    "/filings/{filing_id}/transactions/{tx_id}",
    response_model=TxnOut,
    summary="Single-transaction detail (drives the edit drawer).",
)
def get_transaction(
    filing_id: str = Path(..., min_length=1),
    tx_id: str = Path(..., min_length=1),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> TxnOut:
    tx = _load_owned_transaction(db, filing_id, tx_id, current.id)
    return _to_out(tx)


# ---------------------------------------------------------------------------
# PUT edit
# ---------------------------------------------------------------------------

@router.put(
    "/filings/{filing_id}/transactions/{tx_id}",
    response_model=TxnOut,
    summary="Edit a transaction. Any edit demotes it to manual / manual_override.",
)
def put_transaction(
    body: TxnPutBody = Body(...),
    filing_id: str = Path(..., min_length=1),
    tx_id: str = Path(..., min_length=1),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> TxnOut:
    tx = _load_owned_transaction(db, filing_id, tx_id, current.id)

    if body.amount is not None:
        tx.amount = float(_parse_decimal(body.amount, "amount"))
    if body.txn_date is not None:
        tx.txn_date = _parse_date(body.txn_date, "txn_date")
    if body.description is not None:
        tx.description = body.description.strip() or None
    if body.counterparty is not None:
        tx.counterparty = body.counterparty.strip() or None
    if body.category is not None:
        tx.category = body.category.strip() or None
    if body.tax_year is not None and body.tax_year != tx.tax_year:
        # Cross-FY edits also re-target the row to the matching sibling filing
        # so the row shows up in the correct workspace.
        from app.services.routing.fy_router import ensure_filing_for_fy
        sibling = ensure_filing_for_fy(db, user_id=current.id, tax_year=body.tax_year)
        tx.tax_year = body.tax_year
        tx.filing_id = sibling.id
    if body.status is not None:
        if body.status == "verified" and tx.status != "verified":
            tx.verified_by_user_id = current.id
            tx.verified_at = _now_iso()
        elif body.status != "verified":
            tx.verified_at = None
            tx.verified_by_user_id = None
        tx.status = body.status

    # Per spec: any user edit demotes the row to manual classification.
    tx.categorization_method = "manual"
    tx.confidence_score = 1.0
    tx.routing_method = "manual_override"
    tx.updated_at = _now_iso()

    db.commit()
    db.refresh(tx)
    return _to_out(tx)


# ---------------------------------------------------------------------------
# POST verify (single)
# ---------------------------------------------------------------------------

@router.post(
    "/filings/{filing_id}/transactions/{tx_id}/verify",
    response_model=TxnOut,
    summary="Mark a single transaction as verified. Idempotent.",
)
def verify_transaction(
    filing_id: str = Path(..., min_length=1),
    tx_id: str = Path(..., min_length=1),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> TxnOut:
    tx = _load_owned_transaction(db, filing_id, tx_id, current.id)
    if tx.status != "verified":
        tx.status = "verified"
        tx.verified_at = _now_iso()
        tx.verified_by_user_id = current.id
        tx.updated_at = _now_iso()
        db.commit()
        db.refresh(tx)
    return _to_out(tx)


# ---------------------------------------------------------------------------
# POST verify-all (bulk)
# ---------------------------------------------------------------------------

class VerifyAllResult(BaseModel):
    verified: int


@router.post(
    "/filings/{filing_id}/transactions/verify-all",
    response_model=VerifyAllResult,
    summary="Bulk verify unverified transactions. Filter optional (method/head).",
)
def verify_all_transactions(
    body: VerifyAllBody = Body(default=VerifyAllBody()),
    filing_id: str = Path(..., min_length=1),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> VerifyAllResult:
    _load_owned_filing(db, filing_id, current.id)

    conditions = [
        Transaction.filing_id == filing_id,
        Transaction.status == "unverified",
    ]
    if body.filter:
        if body.filter.method:
            conditions.append(Transaction.categorization_method == body.filter.method)
        if body.filter.head:
            conditions.append(Transaction.category.ilike(f"%{body.filter.head}%"))

    now = _now_iso()
    updated = (
        db.query(Transaction)
        .filter(and_(*conditions))
        .update(
            {
                Transaction.status: "verified",
                Transaction.verified_at: now,
                Transaction.verified_by_user_id: current.id,
                Transaction.updated_at: now,
            },
            synchronize_session=False,
        )
    )
    db.commit()
    return VerifyAllResult(verified=int(updated))


# ---------------------------------------------------------------------------
# POST create (manual row)
# ---------------------------------------------------------------------------

@router.post(
    "/filings/{filing_id}/transactions",
    response_model=TxnOut,
    status_code=status.HTTP_201_CREATED,
    summary="Manually add a transaction not present in any document.",
)
def create_transaction(
    body: TxnCreateBody = Body(...),
    filing_id: str = Path(..., min_length=1),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> TxnOut:
    filing = _load_owned_filing(db, filing_id, current.id)
    _ensure_shadow_user(db, current)

    amount = _parse_decimal(body.amount, "amount")
    date_iso = _parse_date(body.txn_date, "txn_date")
    tax_year = body.tax_year or filing.tax_year

    now = _now_iso()
    tx = Transaction(
        filing_id=filing.id,
        document_id=None,
        user_id=current.id,
        tax_year=tax_year,
        txn_date=date_iso,
        amount=float(amount),
        description=(body.description or "").strip() or None,
        counterparty=(body.counterparty or "").strip() or None,
        raw_payload=None,
        category=(body.category or "").strip() or None,
        categorization_method="manual",
        rule_matched=None,
        confidence_score=1.0,
        routing_method="manual_override",
        routing_source_field=None,
        routed_at=now,
        status="unverified",
        created_at=now,
        updated_at=now,
    )
    db.add(tx)
    db.commit()
    db.refresh(tx)
    return _to_out(tx)


# ---------------------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------------------

@router.delete(
    "/filings/{filing_id}/transactions/{tx_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a transaction. Intended for clearly bad extractions.",
)
def delete_transaction(
    filing_id: str = Path(..., min_length=1),
    tx_id: str = Path(..., min_length=1),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    tx = _load_owned_transaction(db, filing_id, tx_id, current.id)
    db.delete(tx)
    db.commit()
    return None
