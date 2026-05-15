"""Filing-related endpoints. MVP: tax calculation.

  POST /api/v1/filings/{filing_id}/calculate
  GET  /api/v1/filings/{filing_id}/calculation-trace

Returns full step-by-step tax computation under the requested regime (or both),
with section references and human-readable explanations so the UI can render the
"why" panel without inventing strings.

Spec: Technical Docs/TAXATION_CALCULATION.md, Technical Docs/API_CONTRACTS.md §6.3
"""

from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.api.v1.workspace import _ensure_shadow_user, _now_iso
from app.db.session import get_db
from app.models.cross import AuditLog
from app.models.filing import TaxReturn
from app.schemas.taxation import CalculateRequest, CalculateResponse, RegimeResult
from app.services.regime import ack_text_hash, evaluate_regime
from app.services.taxation import RuleNotFoundError, compute_tax
from app.services.taxation.engine import TaxResult
from app.services.taxation.statute import resolve_statute

router = APIRouter(prefix="/api/v1/filings", tags=["filings"])


@router.post(
    "/{filing_id}/calculate",
    response_model=CalculateResponse,
    summary="Compute tax for a filing — old, new, or both regimes.",
)
def calculate(
    payload: CalculateRequest,
    filing_id: str = Path(..., min_length=1),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> CalculateResponse:
    filing = db.get(TaxReturn, filing_id)
    if filing is None or filing.deleted_at is not None or filing.user_id != current.id:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail={"code": "filing_not_found", "message": "Filing not found."},
        )

    user = _ensure_shadow_user(db, current)

    # Optional inline declarations are stashed onto the filing's summary_json so
    # the engine sees a single source of truth.
    if payload.declared_house_property is not None or payload.declared_deductions is not None:
        summary = dict(filing.summary_json or {})
        if payload.declared_house_property is not None:
            summary["house_property"] = [
                p.model_dump(mode="json") for p in payload.declared_house_property
            ]
        if payload.declared_deductions is not None:
            summary["declared_deductions"] = {
                k: str(v) for k, v in payload.declared_deductions.items()
            }
        filing.summary_json = summary
        db.flush()

    regimes_to_run: list[str] = (
        ["old", "new"] if payload.regime == "both" else [payload.regime]
    )

    # Section 115BAC gate (per ARCH §6.4 / API_CONTRACTS §6.2):
    #   - BLOCK            → 422 regime_switch_blocked   (no override path)
    #   - WARN_HIGH + no ack → 409 regime_acknowledgment_required
    #   - WARN_HIGH + ack  → require matching hash; proceed and commit
    evaluation = evaluate_regime(db, user, filing, payload.regime)

    if evaluation.level == "BLOCK":
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "regime_switch_blocked",
                "message": evaluation.message,
                "section_referenced": evaluation.section_referenced,
            },
        )

    if evaluation.level == "WARN_HIGH":
        if not payload.acknowledged_regime_switch:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail={
                    "code": "regime_acknowledgment_required",
                    "message": (
                        "Switching regime requires an explicit acknowledgement. "
                        "Run /precheck-regime, show the modal, and re-submit "
                        "with `acknowledged_regime_switch: true` and "
                        "`acknowledgment_text_hash` equal to sha256 of the "
                        "displayed text."
                    ),
                    "section_ref": evaluation.section_referenced,
                },
            )
        expected = ack_text_hash()
        if (payload.acknowledgment_text_hash or "").lower() != expected:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "code": "regime_acknowledgment_hash_mismatch",
                    "message": (
                        "Provided acknowledgment_text_hash does not match the "
                        "canonical Section 115BAC(6) text. Re-display the text "
                        "from /precheck-regime exactly and re-hash."
                    ),
                },
            )

    results: dict[str, TaxResult] = {}
    try:
        for regime in regimes_to_run:
            results[regime] = compute_tax(
                db,
                filing_id=filing_id,
                regime=regime,
                residency_override=payload.residency_override,
                senior_override=payload.senior_override,
            )
    except RuleNotFoundError as e:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "rules_not_configured", "message": str(e)},
        )

    response_kwargs: dict = {
        "filing_id": filing_id,
        "fy": filing.tax_year,
        "statute": resolve_statute(filing.tax_year),
        "regimes_computed": list(results.keys()),
    }
    if "old" in results:
        response_kwargs["old_regime"] = _to_regime_result(results["old"])
        filing.old_regime_total_tax = float(results["old"].total_tax)
    if "new" in results:
        response_kwargs["new_regime"] = _to_regime_result(results["new"])
        filing.new_regime_total_tax = float(results["new"].total_tax)

    if len(results) == 2:
        recommended = "old" if results["old"].total_tax <= results["new"].total_tax else "new"
        other = "new" if recommended == "old" else "old"
        savings = (results[other].total_tax - results[recommended].total_tax)
        response_kwargs["recommended_regime"] = recommended
        response_kwargs["savings"] = Decimal(str(savings))
        filing.recommended_regime = recommended
        filing.balance_payable = float(results[recommended].balance_payable)
    elif len(results) == 1:
        only = next(iter(results))
        filing.balance_payable = float(results[only].balance_payable)

    # Commit the regime choice when a single regime was calculated. Per
    # FILING_FLOW.md §3.5, /calculate is the regime commit point: it sets
    # regime_used + ack metadata + (if applicable) increments the lifetime
    # switch-back counter. The "both" path is a preview only.
    if payload.regime in ("old", "new"):
        prev_regime_used = filing.regime_used
        filing.regime_used = payload.regime
        filing.updated_at = _now_iso()

        if evaluation.level == "WARN_HIGH":
            filing.regime_switch_acknowledged = 1
            filing.regime_switch_acknowledged_at = _now_iso()
            filing.regime_switch_section_referenced = evaluation.section_referenced
            filing.regime_acknowledgment_text_hash = ack_text_hash()
            filing.form_10iea_required = 1 if evaluation.form_10iea_required else 0

            # Increment the lifetime counter only when this is the one-time
            # business-income switch back from old → new. Other WARN_HIGH cases
            # (cat-B opt-out new → old) do not consume the lifetime quota.
            if (
                evaluation.code == "115bac_one_time_switch_back"
                and prev_regime_used != "new"
            ):
                user.lifetime_switch_backs_to_new = (
                    int(user.lifetime_switch_backs_to_new or 0) + 1
                )

            db.add(
                AuditLog(
                    actor_user_id=current.id,
                    actor_role=current.role or "taxpayer",
                    action="regime_switch_acknowledged",
                    entity_type="tax_returns",
                    entity_id=filing.id,
                    tax_year=filing.tax_year,
                    before_state={"regime_used": prev_regime_used},
                    after_state={"regime_used": payload.regime},
                    metadata_={
                        "previous_regime": evaluation.previous_regime,
                        "requested_regime": evaluation.requested_regime,
                        "code": evaluation.code,
                        "section_referenced": evaluation.section_referenced,
                        "form_10iea_required": evaluation.form_10iea_required,
                        "lifetime_switch_backs_after": int(
                            user.lifetime_switch_backs_to_new or 0
                        ),
                        "acknowledged_text_hash": ack_text_hash(),
                    },
                )
            )
        elif prev_regime_used != payload.regime:
            db.add(
                AuditLog(
                    actor_user_id=current.id,
                    actor_role=current.role or "taxpayer",
                    action="regime_selected",
                    entity_type="tax_returns",
                    entity_id=filing.id,
                    tax_year=filing.tax_year,
                    before_state={"regime_used": prev_regime_used},
                    after_state={"regime_used": payload.regime},
                    metadata_={"level": evaluation.level, "code": evaluation.code},
                )
            )

    db.commit()
    return CalculateResponse(**response_kwargs)


@router.get(
    "/{filing_id}/calculation-trace",
    summary="Latest persisted calculation trace(s) for the filing.",
)
def get_traces(
    filing_id: str = Path(..., min_length=1),
    db: Session = Depends(get_db),
) -> dict:
    from sqlalchemy import select

    from app.models.filing import CalculationTrace

    filing = db.get(TaxReturn, filing_id)
    if filing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "filing_not_found")

    rows = (
        db.execute(
            select(CalculationTrace)
            .where(CalculationTrace.filing_id == filing_id)
            .order_by(CalculationTrace.computed_at.desc())
        )
        .scalars()
        .all()
    )
    return {
        "filing_id": filing_id,
        "traces": [
            {
                "id": r.id,
                "regime": r.regime,
                "computed_at": r.computed_at,
                "final_total": str(r.final_total),
                "rule_versions": r.rule_versions,
                "trace": r.trace_json,
            }
            for r in rows
        ],
    }


def _to_regime_result(r: TaxResult) -> RegimeResult:
    return RegimeResult(
        regime=r.regime,
        fy=r.fy,
        statute=r.statute,
        gross_total_income=r.gross_total_income,
        deductions=r.deductions,
        taxable_income=r.taxable_income,
        slab_tax=r.slab_tax,
        rebate_87a=r.rebate_87a,
        flat_rate_tax=r.flat_rate_tax,
        surcharge=r.surcharge,
        cess=r.cess,
        total_tax=r.total_tax,
        tds_paid=r.tds_paid,
        balance_payable=r.balance_payable,
        trace_id=r.trace_id,
        trace=r.trace,
    )
