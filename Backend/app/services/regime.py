"""Section 115BAC regime-switch state machine.

Shared by:
  - POST /filings/{id}/precheck-regime  (informational evaluation)
  - POST /filings/{id}/calculate        (commit-time gate on a single regime)

Spec: Technical Docs/ARCHITECTURE.md §6, API_CONTRACTS.md §6.2.

Returns a `RegimeEvaluation` with a `level` in {OK, INFO, WARN_HIGH, BLOCK}
and the supporting metadata (previous_regime, lifetime counter, canonical
acknowledgment text + section reference). Higher layers decide whether to
surface a modal, write an audit row, or reject the request.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.filing import TaxReturn
from app.models.identity import User


# Canonical acknowledgment string. Must be hashed verbatim (UTF-8, no trailing
# newline) so the client and server agree on the sha256 digest.
ACK_TEXT = (
    "I have read and understood Section 115BAC(6) and confirm I am exercising "
    "my one-time lifetime switch back to the new regime."
)

SECTION_REF = "115BAC(6)"

Level = Literal["OK", "INFO", "WARN_HIGH", "BLOCK"]


@dataclass(frozen=True)
class RegimeEvaluation:
    level: Level
    code: str | None = None
    message: str | None = None
    previous_regime: str | None = None
    requested_regime: str | None = None
    lifetime_switch_backs_used: int = 0
    lifetime_switch_backs_remaining: int | None = None
    acknowledgment_text: str | None = None
    section_referenced: str | None = None
    form_10iea_required: bool = False


def ack_text_hash() -> str:
    return hashlib.sha256(ACK_TEXT.encode("utf-8")).hexdigest()


def _last_prior_year_filing(
    db: Session, user_id: str, current_tax_year: str
) -> TaxReturn | None:
    """Most recent filing in a strictly prior FY for the same user.

    Used as the 'previous_regime' anchor for the state machine. Only filings
    with a committed `regime_used` count.
    """
    stmt = (
        select(TaxReturn)
        .where(
            TaxReturn.user_id == user_id,
            TaxReturn.tax_year < current_tax_year,
            TaxReturn.regime_used.is_not(None),
            TaxReturn.deleted_at.is_(None),
        )
        .order_by(TaxReturn.tax_year.desc(), TaxReturn.created_at.desc())
        .limit(1)
    )
    return db.execute(stmt).scalar_one_or_none()


def evaluate_regime(
    db: Session,
    user: User,
    filing: TaxReturn,
    requested_regime: Literal["old", "new", "both"],
) -> RegimeEvaluation:
    """Run the §6.3 detection logic from ARCHITECTURE.md."""
    has_business = bool(user.has_business_income)
    last = _last_prior_year_filing(db, user.id, filing.tax_year)
    prev_regime = last.regime_used if last else None
    switch_backs = int(user.lifetime_switch_backs_to_new or 0)

    # "both" — pure preview, no commit, no warning.
    if requested_regime == "both":
        return RegimeEvaluation(
            level="OK",
            previous_regime=prev_regime,
            requested_regime="both",
            lifetime_switch_backs_used=switch_backs,
        )

    # Category A — no business income: free switching every year.
    if not has_business:
        if prev_regime is not None and prev_regime != requested_regime:
            return RegimeEvaluation(
                level="INFO",
                code="cat_a_free_switch",
                message=(
                    "Salaried / non-business taxpayers may switch regimes "
                    "every assessment year."
                ),
                previous_regime=prev_regime,
                requested_regime=requested_regime,
                lifetime_switch_backs_used=switch_backs,
            )
        return RegimeEvaluation(
            level="OK",
            previous_regime=prev_regime,
            requested_regime=requested_regime,
            lifetime_switch_backs_used=switch_backs,
        )

    # Category B — business / professional income.
    if requested_regime == "old":
        if switch_backs >= 1:
            return RegimeEvaluation(
                level="BLOCK",
                code="115bac_lifetime_lock",
                message=(
                    "You have already exercised your one-time switch back to "
                    "the new regime. Under Section 115BAC(6), you cannot opt "
                    "back to the old regime."
                ),
                previous_regime=prev_regime,
                requested_regime="old",
                lifetime_switch_backs_used=switch_backs,
                lifetime_switch_backs_remaining=0,
                section_referenced=SECTION_REF,
            )
        return RegimeEvaluation(
            level="WARN_HIGH",
            code="115bac_opt_out",
            message=(
                "You are opting out of the new regime. You must file Form "
                "10-IEA on or before the Section 139(1) due date. Your right "
                "to switch back to the new regime is a ONE-TIME lifetime option."
            ),
            previous_regime=prev_regime,
            requested_regime="old",
            lifetime_switch_backs_used=switch_backs,
            lifetime_switch_backs_remaining=1,
            acknowledgment_text=ACK_TEXT,
            section_referenced=SECTION_REF,
            form_10iea_required=True,
        )

    # requested_regime == "new"
    if prev_regime == "old":
        if switch_backs >= 1:
            return RegimeEvaluation(
                level="BLOCK",
                code="115bac_lifetime_lock",
                message=(
                    "You have already exercised your one-time switch back to "
                    "the new regime. Under Section 115BAC(6), this option "
                    "cannot be used a second time."
                ),
                previous_regime="old",
                requested_regime="new",
                lifetime_switch_backs_used=switch_backs,
                lifetime_switch_backs_remaining=0,
                section_referenced=SECTION_REF,
            )
        return RegimeEvaluation(
            level="WARN_HIGH",
            code="115bac_one_time_switch_back",
            message=(
                "This is your ONE-TIME lifetime switch back to the new regime "
                "under Section 115BAC(6). After this filing, you cannot opt "
                "back to the old regime for as long as you have business / "
                "professional income."
            ),
            previous_regime="old",
            requested_regime="new",
            lifetime_switch_backs_used=switch_backs,
            lifetime_switch_backs_remaining=1,
            acknowledgment_text=ACK_TEXT,
            section_referenced=SECTION_REF,
            form_10iea_required=False,
        )

    return RegimeEvaluation(
        level="OK",
        previous_regime=prev_regime,
        requested_regime="new",
        lifetime_switch_backs_used=switch_backs,
    )
