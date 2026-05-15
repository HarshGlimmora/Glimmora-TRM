"""Regime precheck endpoint.

  POST /api/v1/filings/{id}/precheck-regime

Evaluates the Section 115BAC switching state for the user + filing + requested
regime, BEFORE the user is asked to commit (commit happens via /calculate). The
caller renders the modal / banner / hard-stop based on the returned `level`.

Spec: FILING_FLOW.md §3.5, API_CONTRACTS.md §6.2, ARCHITECTURE.md §6.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.api.v1.workspace import _ensure_shadow_user
from app.db.session import get_db
from app.models.filing import TaxReturn
from app.services.regime import evaluate_regime


router = APIRouter(prefix="/api/v1/filings", tags=["regime"])


class PrecheckBody(BaseModel):
    regime: Literal["old", "new", "both"]


class PrecheckResponse(BaseModel):
    filing_id: str
    level: Literal["OK", "INFO", "WARN_HIGH", "BLOCK"]
    code: str | None = None
    message: str | None = None
    previous_regime: str | None = None
    requested_regime: str | None = None
    lifetime_switch_backs_used: int = 0
    lifetime_switch_backs_remaining: int | None = None
    acknowledgment_text: str | None = None
    section_referenced: str | None = None
    form_10iea_required: bool = False


@router.post(
    "/{filing_id}/precheck-regime",
    response_model=PrecheckResponse,
    summary="Evaluate Section 115BAC switching state for a regime choice.",
)
def precheck_regime(
    body: PrecheckBody,
    filing_id: str = Path(..., min_length=1),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> PrecheckResponse:
    filing = db.get(TaxReturn, filing_id)
    if filing is None or filing.deleted_at is not None or filing.user_id != current.id:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail={"code": "filing_not_found", "message": "Filing not found."},
        )

    user = _ensure_shadow_user(db, current)
    result = evaluate_regime(db, user, filing, body.regime)
    db.commit()

    return PrecheckResponse(
        filing_id=filing_id,
        level=result.level,
        code=result.code,
        message=result.message,
        previous_regime=result.previous_regime,
        requested_regime=result.requested_regime,
        lifetime_switch_backs_used=result.lifetime_switch_backs_used,
        lifetime_switch_backs_remaining=result.lifetime_switch_backs_remaining,
        acknowledgment_text=result.acknowledgment_text,
        section_referenced=result.section_referenced,
        form_10iea_required=result.form_10iea_required,
    )
