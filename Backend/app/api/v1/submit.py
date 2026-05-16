"""Filing submission — the OTP-gated terminal action.

  POST /api/v1/filings/{id}/submit

Atomic transaction:
  1. Re-check every precondition (100% verified, regime committed, ack
     state coherent, both email and phone on file).
  2. Verify the OTP via `submit_otp.consume_submit_otp` — wrong / expired
     / cross-filing all raise OtpError mapped to 422.
  3. Flip the filing into 'submitted', stamp submitted_at +
     submitted_by_user_id + submit_otp_verification_id.
  4. Append an `audit_logs` row with the verification_id in metadata.

The DB-level `chk_tax_returns_submit_otp` CHECK guarantees no row can
reach `submitted_at IS NOT NULL` without `submit_otp_verification_id`
populated — so even a bug in this code path can't ship a submission
without OTP provenance.

Spec: FILING_FLOW.md §3.7, API_CONTRACTS.md §6.7, SCHEMA.md §6.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.api.v1.auth_submit import _assert_filing_submittable
from app.api.v1.workspace import _ensure_shadow_user
from app.db.session import get_db
from app.models.cross import AuditLog
from app.models.filing import TaxReturn
from app.services.submit_otp import (
    OtpError,
    OtpFilingMismatch,
    OtpInvalidOrExpired,
    consume_submit_otp,
)


router = APIRouter(prefix="/api/v1/filings", tags=["submit"])


class SubmitBody(BaseModel):
    acknowledgment: bool = Field(
        ...,
        description=(
            "Must be true. The user has affirmed the return is accurate. The "
            "literal acknowledgment text is recorded on the audit log; this "
            "field is the gate."
        ),
    )
    verification_id: str = Field(..., min_length=1)
    otp: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")


class SubmitOut(BaseModel):
    id: str
    status: str
    submitted_at: str
    submitted_by: str
    submit_otp_verification_id: str


def _http(code: int, error_code: str, message: str, **extra) -> HTTPException:
    detail = {"code": error_code, "message": message}
    detail.update(extra)
    return HTTPException(code, detail=detail)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


@router.post(
    "/{filing_id}/submit",
    response_model=SubmitOut,
    summary="Submit a filing — OTP-gated, atomic with status flip and audit row.",
)
def submit_filing(
    body: SubmitBody,
    filing_id: str = Path(..., min_length=1),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> SubmitOut:
    filing = db.get(TaxReturn, filing_id)
    if filing is None or filing.deleted_at is not None or filing.user_id != current.id:
        raise _http(
            status.HTTP_404_NOT_FOUND, "filing_not_found", "Filing not found."
        )

    if not body.acknowledgment:
        raise _http(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "acknowledgment_required",
            "You must acknowledge the accuracy declaration before submitting.",
        )

    user = _ensure_shadow_user(db, current)
    if not user.email:
        raise _http(
            status.HTTP_403_FORBIDDEN,
            "verification_required",
            "A verified email address is required to submit a filing.",
        )

    # Terminal status is a separate failure than "not ready" — keep them split.
    if filing.status in ("submitted", "accepted", "rejected"):
        raise _http(
            status.HTTP_409_CONFLICT, "filing_locked",
            f"Filing is already in status '{filing.status}'.",
        )

    # Regime ack coherence: if the user is on the new regime AND they have
    # business income AND their prior filing was on old, then the ack flag
    # must already be set. The /calculate commit guarantees that — but we
    # re-check here so a malformed client can't bypass.
    if filing.regime_used == "new" and bool(user.has_business_income):
        if filing.regime_acknowledgment_text_hash is None and filing.regime_switch_acknowledged != 1:
            # Only block when a prior old-regime filing exists. Cheap check.
            from sqlalchemy import desc

            prior = db.execute(
                select(TaxReturn)
                .where(
                    TaxReturn.user_id == current.id,
                    TaxReturn.tax_year < filing.tax_year,
                    TaxReturn.regime_used == "old",
                    TaxReturn.deleted_at.is_(None),
                )
                .order_by(desc(TaxReturn.tax_year))
                .limit(1)
            ).scalar_one_or_none()
            if prior is not None:
                raise _http(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    "regime_acknowledgment_required",
                    "Section 115BAC(6) acknowledgment is required. Re-open the "
                    "Regime tab to confirm.",
                )

    # Re-run the same precondition battery the OTP-issue endpoint used.
    _assert_filing_submittable(db, filing)

    # ---- OTP verify + consume ------------------------------------------
    # Commit the partial state (attempts increment, expiry consumption)
    # before raising — otherwise the session close() on the HTTPException
    # path rolls back the lockout side-effect and the user gets unlimited
    # tries.
    try:
        consumed = consume_submit_otp(
            db,
            user_id=current.id,
            filing_id=filing.id,
            verification_id=body.verification_id,
            otp=body.otp,
        )
    except OtpFilingMismatch as e:
        # Filing-mismatch doesn't bump attempts — nothing to persist.
        raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, e.code, e.message)
    except OtpInvalidOrExpired as e:
        db.commit()
        raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, e.code, e.message)
    except OtpError as e:
        db.commit()
        raise _http(status.HTTP_422_UNPROCESSABLE_ENTITY, e.code, e.message)

    # ---- Flip status + stamp metadata ----------------------------------
    submitted_at = _now_iso()
    filing.status = "submitted"
    filing.submitted_at = submitted_at
    filing.submitted_by_user_id = current.id
    filing.submit_otp_verification_id = consumed.id
    filing.updated_at = submitted_at

    db.add(
        AuditLog(
            actor_user_id=current.id,
            actor_role=current.role or "taxpayer",
            action="filing_submitted",
            entity_type="tax_returns",
            entity_id=filing.id,
            tax_year=filing.tax_year,
            before_state={"status": "draft"},
            after_state={"status": "submitted"},
            metadata_={
                "verification_id": consumed.id,
                "submitted_at": submitted_at,
                "regime_used": filing.regime_used,
            },
        )
    )

    db.commit()

    return SubmitOut(
        id=filing.id,
        status=filing.status,
        submitted_at=submitted_at,
        submitted_by=current.id,
        submit_otp_verification_id=consumed.id,
    )
