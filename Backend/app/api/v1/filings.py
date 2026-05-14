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

from app.db.session import get_db
from app.models.filing import TaxReturn
from app.schemas.taxation import CalculateRequest, CalculateResponse, RegimeResult
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
) -> CalculateResponse:
    filing = db.get(TaxReturn, filing_id)
    if filing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "filing_not_found")

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

    if not payload.acknowledged_regime_switch and filing.regime_switch_acknowledged == 0:
        if filing.regime_used and filing.regime_used != payload.regime and payload.regime != "both":
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail={
                    "code": "regime_acknowledgment_required",
                    "message": (
                        "Switching regime requires an explicit acknowledgement. "
                        "Run /precheck-regime and re-submit with "
                        "`acknowledged_regime_switch: true`."
                    ),
                    "section_ref": "115BAC(6)",
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
