"""FY router — derive the financial-year tag for an Indian tax transaction.

Per ARCHITECTURE.md §7.3:

    if date.month >= 4: FY{year}-{(year+1) % 100}
    else:               FY{year-1}-{year % 100}

So 2024-04-01 → FY2024-25. 2024-03-31 → FY2023-24.

Returns the canonical `FY####-##` string. Caller is responsible for sibling-
filing auto-creation; see `ensure_filing_for_fy` for that.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.filing import TaxReturn


def fy_for_date(d: date) -> str:
    if d.month >= 4:
        end = (d.year + 1) % 100
        return f"FY{d.year}-{end:02d}"
    start = d.year - 1
    end = d.year % 100
    return f"FY{start}-{end:02d}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def ensure_filing_for_fy(
    db: Session,
    *,
    user_id: str,
    tax_year: str,
) -> TaxReturn:
    """Return the user's open draft for that FY, creating a sibling draft if
    none exists. Used by the uploader when CSV rows span multiple FYs.

    The caller is responsible for committing — this function only adds to the
    session (matches the pattern in workspace.create_or_get_filing).
    """
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
    existing = db.execute(stmt).scalar_one_or_none()
    if existing is not None:
        return existing

    now = _now_iso()
    sibling = TaxReturn(
        user_id=user_id,
        country="IN",
        tax_year=tax_year,
        status="draft",
        regime_switch_acknowledged=0,
        form_10iea_required=0,
        created_at=now,
        updated_at=now,
    )
    db.add(sibling)
    db.flush()
    return sibling


# ---------------------------------------------------------------------------
# Reasons for pending_router_inbox entries
# ---------------------------------------------------------------------------

INVALID_DATE = "invalid_date"
TERMINAL_FY_CONFLICT = "terminal_fy_conflict"
AMBIGUOUS_FY = "ambiguous_fy"
ROUTING_REVIEW_REQUIRED = "routing_review_required"
