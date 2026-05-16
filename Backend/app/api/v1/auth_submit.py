"""Submit-time OTP issuance.

  POST /api/v1/auth/request-submit-otp

The Next.js side handles login OTPs. This endpoint is specific to the
submit gate: it mints a 6-digit code bound to a particular filing, with a
short TTL and a max-attempts ceiling. The user must then pass the code
to `POST /api/v1/filings/{id}/submit`.

Spec: FILING_FLOW.md §3.7, API_CONTRACTS.md §2.9.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.api.v1.workspace import _ensure_shadow_user
from app.db.session import get_db
from app.models.documents import Transaction
from app.models.filing import TaxReturn
from app.services.submit_otp import OtpError, issue_submit_otp


router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


SUBMITTABLE_STATUSES = {"draft", "revision_returned", "revision_requested"}


class RequestSubmitOtpBody(BaseModel):
    filing_id: str = Field(..., min_length=1)


class RequestSubmitOtpOut(BaseModel):
    verification_id: str
    filing_id: str
    sent_to: str
    expires_at: str
    # Only populated when GLIMMORA_DEV_REVEAL_OTP=1 — never in production.
    dev_plain_code: str | None = None


def _http(code: int, error_code: str, message: str, **extra) -> HTTPException:
    detail = {"code": error_code, "message": message}
    detail.update(extra)
    return HTTPException(code, detail=detail)


def _assert_filing_submittable(db: Session, filing: TaxReturn) -> None:
    """Enforce every precondition we know before issuing an OTP.

    These mirror the checks inside `POST /filings/{id}/submit` so we fail
    fast — no point texting someone a code if the form will be rejected.
    """
    if filing.status not in SUBMITTABLE_STATUSES:
        raise _http(
            status.HTTP_409_CONFLICT,
            "filing_not_ready_for_submit",
            f"Filing status '{filing.status}' is not submittable.",
        )

    if filing.regime_used not in ("old", "new"):
        raise _http(
            status.HTTP_409_CONFLICT,
            "filing_not_ready_for_submit",
            "Pick a tax regime on the Regime tab before requesting a submit OTP.",
        )

    # 100% verified gate — the engine refuses to compute final tax otherwise.
    counts = dict(
        db.execute(
            select(Transaction.status, func.count())
            .where(Transaction.filing_id == filing.id)
            .group_by(Transaction.status)
        ).all()
    )
    total = sum(counts.values())
    unverified = int(counts.get("unverified", 0))
    if total == 0:
        raise _http(
            status.HTTP_409_CONFLICT,
            "filing_not_ready_for_submit",
            "No transactions found on this filing. Upload documents first.",
        )
    if unverified > 0:
        raise _http(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "unverified_transactions",
            f"{unverified} transaction(s) still need to be verified.",
            unverified_count=unverified,
        )


@router.post(
    "/request-submit-otp",
    response_model=RequestSubmitOtpOut,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Issue a phone OTP bound to a filing; required before /submit.",
)
def request_submit_otp(
    body: RequestSubmitOtpBody,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> RequestSubmitOtpOut:
    filing = db.get(TaxReturn, body.filing_id)
    if filing is None or filing.deleted_at is not None or filing.user_id != current.id:
        # Match the cross-user 404 pattern used by every other filing endpoint.
        raise _http(
            status.HTTP_404_NOT_FOUND, "filing_not_found", "Filing not found."
        )

    user = _ensure_shadow_user(db, current)

    # Submission requires a verified email (ARCH §6.7 / SCHEMA §5). The OTP
    # is delivered there. In split-DB dev the shadow user carries the email
    # the Next.js auth layer attached to the JWT; we treat its presence as
    # sufficient evidence and rely on the Next.js auth layer to gate login.
    if not user.email:
        raise _http(
            status.HTTP_403_FORBIDDEN,
            "verification_required",
            "A verified email address is required to submit a filing.",
        )

    _assert_filing_submittable(db, filing)

    try:
        issued = issue_submit_otp(db, user=user, filing_id=filing.id)
    except OtpError as e:
        raise _http(status.HTTP_403_FORBIDDEN, e.code, e.message)
    db.commit()

    return RequestSubmitOtpOut(
        verification_id=issued.verification_id,
        filing_id=issued.filing_id,
        sent_to=issued.sent_to_masked,
        expires_at=issued.expires_at,
        dev_plain_code=issued.dev_plain_code,
    )
