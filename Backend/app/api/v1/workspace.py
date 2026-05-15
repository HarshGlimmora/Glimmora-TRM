"""Workspace-scoped filing CRUD (per FILING_FLOW.md §3.2, API_CONTRACTS §3.4–§3.5).

Filings are addressed by Financial Year (`tax_year` path param). The taxpayer
has at most one open draft per FY; `POST .../filing` is idempotent — it returns
the existing draft if one is already open.
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.db.session import get_db
from app.models.filing import TaxReturn
from app.models.identity import User


router = APIRouter(prefix="/api/v1/workspace", tags=["workspace"])

FY_PATTERN = r"^FY\d{4}-\d{2}$"
TAX_YEAR_PATH = Path(..., pattern=FY_PATTERN, examples=["FY2024-25"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CreateFilingBody(BaseModel):
    template_from_tax_year: str | None = Field(
        default=None,
        pattern=FY_PATTERN,
        description="Optional prior FY to carry forward declarations from.",
    )


class FilingOut(BaseModel):
    id: str
    tax_year: str
    status: str
    regime_used: str | None
    templated_from_tax_year: str | None
    created_at: str
    updated_at: str


class FYBundle(BaseModel):
    tax_year: str
    filing: FilingOut | None
    documents: list[dict[str, Any]] = Field(default_factory=list)
    transactions_summary: dict[str, Any] = Field(
        default_factory=lambda: {"total": 0, "verified": 0, "unverified": 0, "percent": 0.0}
    )
    previous_year: dict[str, Any] | None = None


class FYListItem(BaseModel):
    tax_year: str
    filing_id: str
    status: str
    updated_at: str


class FYListOut(BaseModel):
    items: list[FYListItem]
    active_tax_year: str | None


class PatchFilingBody(BaseModel):
    summary_json: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _to_out(t: TaxReturn) -> FilingOut:
    return FilingOut(
        id=t.id,
        tax_year=t.tax_year,
        status=t.status,
        regime_used=t.regime_used,
        templated_from_tax_year=t.templated_from_tax_year,
        created_at=t.created_at,
        updated_at=t.updated_at,
    )


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


_INDIAN_MOBILE_RE = re.compile(r"^\+?[6-9][0-9]{9}$")


def _synth_phone(user_id: str) -> str:
    """Deterministic 10-digit `[6-9][0-9]{9}` placeholder seeded by user id.

    Used only when the JWT carries no real phone — keeps the SCHEMA constraint
    `chk_users_taxpayer_phone` satisfied for dev runs where Frontend (PGlite)
    and Backend (SQLite) are separate databases. In a shared-DB deployment this
    branch is dead code.
    """
    digits = "".join(c for c in hashlib.sha256(user_id.encode()).hexdigest() if c.isdigit())
    return "9" + (digits + "000000000")[:9]


def _ensure_shadow_user(db: Session, current: CurrentUser) -> User:
    """Make sure a `users` row exists for the JWT subject.

    Production deployments will have Frontend and Backend share the same
    database, so this is effectively a no-op: the row is already there. In
    dev (separate DBs), we synthesise the minimum row needed to satisfy the
    FK on `tax_returns.user_id` and the CHECK constraints in SCHEMA.md §5.
    """
    existing = db.get(User, current.id)
    if existing is not None:
        return existing

    role = current.role if current.role in {
        "taxpayer", "consultant",
        "officer_l1", "officer_l2", "officer_l3", "officer_l4", "officer_l5",
        "judicial_officer", "enforcement_agency", "admin",
    } else "taxpayer"

    phone = current.phone if current.phone and _INDIAN_MOBILE_RE.match(current.phone) else None
    if role == "taxpayer" and phone is None:
        phone = _synth_phone(current.id)

    email = current.email or f"user-{current.id[:8]}@stub.local"
    name = current.name or "Glimmora user"

    user = User(
        id=current.id,
        email=email,
        password_hash="",  # auth is delegated to Next.js; no local password.
        name=name,
        role=role,
        country="IN",
        phone=phone,
    )
    db.add(user)
    db.flush()
    return user


def _find_open_draft(db: Session, user_id: str, tax_year: str) -> TaxReturn | None:
    stmt = (
        select(TaxReturn)
        .where(
            TaxReturn.user_id == user_id,
            TaxReturn.tax_year == tax_year,
            TaxReturn.deleted_at.is_(None),
            TaxReturn.status == "draft",
        )
        .order_by(TaxReturn.created_at.desc())
        .limit(1)
    )
    return db.execute(stmt).scalar_one_or_none()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post(
    "/years/{tax_year}/filing",
    response_model=FilingOut,
    summary="Create or return the user's open draft filing for a given FY (idempotent).",
)
def create_or_get_filing(
    response: Response,
    body: CreateFilingBody = CreateFilingBody(),
    tax_year: str = TAX_YEAR_PATH,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> FilingOut:
    user_row = _ensure_shadow_user(db, current)

    existing = _find_open_draft(db, current.id, tax_year)
    if existing is not None:
        response.status_code = status.HTTP_200_OK
        return _to_out(existing)

    now = _now_iso()
    filing = TaxReturn(
        user_id=current.id,
        country="IN",
        tax_year=tax_year,
        status="draft",
        regime_switch_acknowledged=0,
        form_10iea_required=0,
        templated_from_tax_year=body.template_from_tax_year,
        created_at=now,
        updated_at=now,
    )
    db.add(filing)

    # First-time write: keep users.active_tax_year in sync so future "default FY"
    # lookups land on the right workspace. Only sets if currently NULL — never
    # overwrites a user-chosen active year.
    if user_row.active_tax_year is None:
        user_row.active_tax_year = tax_year

    db.commit()
    db.refresh(filing)
    response.status_code = status.HTTP_201_CREATED
    return _to_out(filing)


@router.get(
    "/years/{tax_year}",
    response_model=FYBundle,
    summary="FY bundle — used by every step page to know where to resume.",
)
def get_year_bundle(
    tax_year: str = TAX_YEAR_PATH,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> FYBundle:
    stmt = (
        select(TaxReturn)
        .where(
            TaxReturn.user_id == current.id,
            TaxReturn.tax_year == tax_year,
            TaxReturn.deleted_at.is_(None),
        )
        .order_by(TaxReturn.created_at.desc())
        .limit(1)
    )
    filing = db.execute(stmt).scalar_one_or_none()
    return FYBundle(
        tax_year=tax_year,
        filing=_to_out(filing) if filing else None,
    )


@router.get(
    "/years",
    response_model=FYListOut,
    summary="List every FY the user has a filing in, plus the user's active FY.",
)
def list_years(
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> FYListOut:
    stmt = (
        select(TaxReturn)
        .where(TaxReturn.user_id == current.id, TaxReturn.deleted_at.is_(None))
        .order_by(TaxReturn.tax_year.desc(), TaxReturn.created_at.desc())
    )
    rows = db.execute(stmt).scalars().all()
    seen: set[str] = set()
    items: list[FYListItem] = []
    for r in rows:
        if r.tax_year in seen:
            continue
        seen.add(r.tax_year)
        items.append(
            FYListItem(
                tax_year=r.tax_year,
                filing_id=r.id,
                status=r.status,
                updated_at=r.updated_at,
            )
        )

    user_row = db.get(User, current.id)
    active = user_row.active_tax_year if user_row else None
    return FYListOut(items=items, active_tax_year=active)


# PATCH /filings/{id} is also part of filing CRUD (per FILING_FLOW.md §3.2). We
# mount it here so workspace + filing CRUD live in one router; the path prefix
# is rewritten to `/api/v1/filings/...` via an explicit route.
filings_patch_router = APIRouter(prefix="/api/v1/filings", tags=["filings"])


@filings_patch_router.patch(
    "/{filing_id}",
    response_model=FilingOut,
    summary="Patch filing-level fields (summary_json overrides).",
)
def patch_filing(
    body: PatchFilingBody,
    filing_id: str = Path(..., min_length=1),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> FilingOut:
    filing = db.get(TaxReturn, filing_id)
    if filing is None or filing.deleted_at is not None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail={"code": "filing_not_found", "message": "Filing not found."},
        )
    if filing.user_id != current.id:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail={"code": "filing_not_found", "message": "Filing not found."},
        )
    if filing.status in ("accepted", "rejected"):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={"code": "filing_locked", "message": "Filing is in a terminal state."},
        )

    if body.summary_json is not None:
        merged = dict(filing.summary_json or {})
        merged.update(body.summary_json)
        filing.summary_json = merged

    filing.updated_at = _now_iso()
    db.commit()
    db.refresh(filing)
    return _to_out(filing)
