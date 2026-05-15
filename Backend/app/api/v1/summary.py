"""Filing summary + PDF.

  GET /api/v1/filings/{id}/summary       → structured JSON
  GET /api/v1/filings/{id}/summary.pdf   → ReportLab-rendered PDF

The summary is the user-facing recap of the chosen regime: income breakdown
(aggregated from verified transactions), Chapter VI-A deductions (from the
filing's declared_deductions), tax computation (taxable income, slab,
flat-rate, surcharge, cess, total), TDS paid, balance, plus the full
calculation trace replayed by the engine.

Spec: FILING_FLOW.md §3.6, API_CONTRACTS.md §6.4–§6.5,
TAXATION_CALCULATION.md §13.
"""

from __future__ import annotations

import io
from collections import defaultdict
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_current_user
from app.db.session import get_db
from app.models.documents import Transaction
from app.models.filing import TaxReturn
from app.models.identity import User
from app.services.taxation import RuleNotFoundError, compute_tax
from app.services.taxation.defaults import head_of
from app.services.taxation.engine import TaxResult
from app.services.taxation.explainer import explain_trace
from app.services.taxation.money import money, quantize
from app.services.taxation.statute import resolve_statute


router = APIRouter(prefix="/api/v1/filings", tags=["summary"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class TaxComputation(BaseModel):
    taxable_income: str
    slab_tax: str
    rebate_87a: str
    flat_rate_tax: str
    surcharge: str
    cess: str
    total_tax: str


class UserSnapshot(BaseModel):
    id: str
    name: str
    pan: str | None
    email: str | None
    phone: str | None


class SummaryOut(BaseModel):
    filing_id: str
    user: UserSnapshot
    tax_year: str
    statute: str
    regime_used: str
    income_breakdown: dict[str, str]
    deductions: dict[str, str]
    tax_computation: TaxComputation
    tds_paid: str
    balance_payable: str
    calculation_trace: dict[str, Any]
    trace_id: str | None
    generated_at: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _filing_not_found() -> HTTPException:
    return HTTPException(
        status.HTTP_404_NOT_FOUND,
        detail={"code": "filing_not_found", "message": "Filing not found."},
    )


def _filing_not_ready() -> HTTPException:
    return HTTPException(
        status.HTTP_409_CONFLICT,
        detail={
            "code": "filing_not_ready_for_summary",
            "message": (
                "Choose a tax regime before viewing the summary. Open the "
                "Regime tab and pick old or new."
            ),
        },
    )


def _income_breakdown(db: Session, filing_id: str) -> dict[str, Decimal]:
    """Aggregate VERIFIED transactions into rows for the summary panel.

    Keys mirror the taxation `head` taxonomy (salary, house_property, pgbp,
    capital_gains, other_sources) but split interest / dividend out of
    other_sources because the summary panel renders them as separate lines.
    """
    rows = (
        db.execute(
            select(Transaction.category, Transaction.amount)
            .where(Transaction.filing_id == filing_id)
            .where(Transaction.status == "verified")
        )
        .all()
    )
    by_key: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    for category, amount in rows:
        amt = money(amount)
        cat = (category or "").lower()
        head = head_of(cat)
        if head == "other_sources" and cat.startswith("interest"):
            key = "interest"
        elif head == "other_sources" and cat == "dividend":
            key = "dividend"
        else:
            key = head
        by_key[key] = quantize(by_key[key] + amt)
    return dict(by_key)


def _declared_deductions(filing: TaxReturn) -> dict[str, Decimal]:
    payload = (filing.summary_json or {}).get("declared_deductions") or {}
    out: dict[str, Decimal] = {}
    for k, v in payload.items():
        try:
            out[str(k)] = money(v)
        except Exception:
            continue
    return out


def _standard_deduction_from_trace(trace: dict[str, Any]) -> Decimal:
    for step in trace.get("steps", []):
        if step.get("op") == "standard_deduction":
            try:
                return money(step.get("result"))
            except Exception:
                return Decimal("0.00")
    return Decimal("0.00")


def _user_snapshot(user: User) -> UserSnapshot:
    return UserSnapshot(
        id=user.id,
        name=user.name,
        pan=user.pan,
        email=user.email,
        phone=user.phone,
    )


def _load_filing_owned(db: Session, filing_id: str, user_id: str) -> TaxReturn:
    filing = db.get(TaxReturn, filing_id)
    if filing is None or filing.deleted_at is not None or filing.user_id != user_id:
        raise _filing_not_found()
    return filing


def _build_summary(db: Session, filing: TaxReturn) -> tuple[SummaryOut, TaxResult]:
    if filing.regime_used not in ("old", "new"):
        raise _filing_not_ready()

    user = db.get(User, filing.user_id)
    if user is None:
        raise _filing_not_found()

    try:
        result = compute_tax(
            db,
            filing_id=filing.id,
            regime=filing.regime_used,  # type: ignore[arg-type]
            persist=True,
        )
    except RuleNotFoundError as e:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "rules_not_configured", "message": str(e)},
        )
    db.commit()

    income = _income_breakdown(db, filing.id)
    declared = _declared_deductions(filing)
    std_ded = _standard_deduction_from_trace(result.trace)

    deductions: dict[str, str] = {"standard": str(std_ded)}
    for sec, amt in declared.items():
        deductions[sec] = str(amt)

    summary = SummaryOut(
        filing_id=filing.id,
        user=_user_snapshot(user),
        tax_year=filing.tax_year,
        statute=resolve_statute(filing.tax_year),
        regime_used=filing.regime_used,  # type: ignore[arg-type]
        income_breakdown={k: str(v) for k, v in income.items()},
        deductions=deductions,
        tax_computation=TaxComputation(
            taxable_income=str(result.taxable_income),
            slab_tax=str(result.slab_tax),
            rebate_87a=str(result.rebate_87a),
            flat_rate_tax=str(result.flat_rate_tax),
            surcharge=str(result.surcharge),
            cess=str(result.cess),
            total_tax=str(result.total_tax),
        ),
        tds_paid=str(result.tds_paid),
        balance_payable=str(result.balance_payable),
        calculation_trace=result.trace,
        trace_id=result.trace_id,
        generated_at=filing.updated_at,
    )
    return summary, result


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get(
    "/{filing_id}/summary",
    response_model=SummaryOut,
    summary="Summary recap for the chosen regime (income, deductions, tax, trace).",
)
def get_summary(
    filing_id: str = Path(..., min_length=1),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> SummaryOut:
    filing = _load_filing_owned(db, filing_id, current.id)
    summary, _ = _build_summary(db, filing)
    return summary


@router.get(
    "/{filing_id}/summary.pdf",
    summary="PDF of the summary, ready for download.",
)
def get_summary_pdf(
    filing_id: str = Path(..., min_length=1),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> StreamingResponse:
    filing = _load_filing_owned(db, filing_id, current.id)
    summary, _ = _build_summary(db, filing)

    try:
        pdf_bytes = _render_pdf(summary)
    except ModuleNotFoundError as e:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "pdf_renderer_unavailable",
                "message": (
                    "ReportLab is not installed on the backend. Run "
                    "`pip install reportlab` and retry. "
                    f"(import error: {e})"
                ),
            },
        )

    fname = f"glimmora-summary-{summary.tax_year}-{summary.regime_used}.pdf"
    headers = {"content-disposition": f'attachment; filename="{fname}"'}
    return StreamingResponse(
        io.BytesIO(pdf_bytes), media_type="application/pdf", headers=headers
    )


# ---------------------------------------------------------------------------
# Calculation-trace explanation (plain-English rendering of each step)
# ---------------------------------------------------------------------------

class StepFieldOut(BaseModel):
    label: str
    value: str
    raw: str


class StepExplanationOut(BaseModel):
    step: int
    op: str
    plain_text: str
    fields: list[StepFieldOut]
    source: str  # "gemini" | "deterministic"


class ExplainTraceOut(BaseModel):
    filing_id: str
    regime_used: str
    tax_year: str
    explanations: list[StepExplanationOut]
    llm_used: bool


@router.get(
    "/{filing_id}/calculation-trace/explain",
    response_model=ExplainTraceOut,
    summary="Plain-English explanation for every step of the latest trace.",
)
def explain_calculation_trace(
    filing_id: str = Path(..., min_length=1),
    use_llm: bool = True,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> ExplainTraceOut:
    filing = _load_filing_owned(db, filing_id, current.id)
    summary, result = _build_summary(db, filing)
    items = explain_trace(result.trace, use_llm=use_llm)
    return ExplainTraceOut(
        filing_id=filing.id,
        regime_used=summary.regime_used,
        tax_year=filing.tax_year,
        explanations=[
            StepExplanationOut(
                step=e.step,
                op=e.op,
                plain_text=e.plain_text,
                fields=[
                    StepFieldOut(label=f.label, value=f.value, raw=f.raw)
                    for f in e.fields
                ],
                source=e.source,
            )
            for e in items
        ],
        llm_used=any(e.source == "gemini" for e in items),
    )


# ---------------------------------------------------------------------------
# ReportLab PDF rendering
# ---------------------------------------------------------------------------

def _inr(s: str) -> str:
    """Format a decimal string with Indian grouping (12,34,567.89)."""
    try:
        n = Decimal(s)
    except Exception:
        return s
    neg = n < 0
    n = abs(n)
    integer, _, frac = f"{n:.2f}".partition(".")
    if len(integer) <= 3:
        grouped = integer
    else:
        head = integer[:-3]
        tail = integer[-3:]
        # Group head every 2 digits, right-to-left.
        parts: list[str] = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        grouped = ",".join(parts) + "," + tail
    formatted = f"{grouped}.{frac}"
    return f"-{formatted}" if neg else formatted


def _render_pdf(summary: SummaryOut) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        SimpleDocTemplate,
        Paragraph,
        Spacer,
        Table,
        TableStyle,
    )

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        title=f"Glimmora summary {summary.tax_year}",
        author="GlimmoraTax",
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
    )
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle(
        "h1", parent=styles["Title"], fontSize=18, spaceAfter=4, alignment=0,
    )
    h2 = ParagraphStyle(
        "h2", parent=styles["Heading2"], fontSize=12,
        textColor=colors.HexColor("#1F2A44"),
        spaceBefore=10, spaceAfter=4,
    )
    body = ParagraphStyle(
        "body", parent=styles["BodyText"], fontSize=9.5, leading=13,
    )
    muted = ParagraphStyle(
        "muted", parent=body, textColor=colors.HexColor("#5C6478"),
    )

    story: list = []

    story.append(Paragraph("GlimmoraTax — Filing Summary", h1))
    story.append(
        Paragraph(
            f"FY {summary.tax_year} &nbsp;·&nbsp; {summary.statute} &nbsp;·&nbsp; "
            f"Regime: <b>{summary.regime_used.upper()}</b>",
            muted,
        )
    )
    story.append(Spacer(1, 6))

    pan = summary.user.pan or "—"
    story.append(
        Paragraph(
            f"<b>{summary.user.name}</b> &nbsp; <font color='#5C6478'>"
            f"PAN: {pan} &nbsp;·&nbsp; {summary.user.email or '—'}</font>",
            body,
        )
    )
    story.append(Spacer(1, 8))

    # Income breakdown -------------------------------------------------------
    story.append(Paragraph("Income breakdown", h2))
    income_rows = [["Head", "Amount (₹)"]]
    for k in sorted(summary.income_breakdown.keys()):
        income_rows.append([k.replace("_", " ").title(), _inr(summary.income_breakdown[k])])
    if len(income_rows) == 1:
        income_rows.append(["No verified income transactions", "0.00"])
    story.append(_table(income_rows))

    # Deductions -------------------------------------------------------------
    story.append(Paragraph("Deductions", h2))
    ded_rows = [["Item", "Amount (₹)"]]
    for k in sorted(summary.deductions.keys()):
        label = "Standard deduction (§16(ia))" if k == "standard" else f"§{k.upper()}"
        ded_rows.append([label, _inr(summary.deductions[k])])
    story.append(_table(ded_rows))

    # Tax computation --------------------------------------------------------
    story.append(Paragraph("Tax computation", h2))
    tc = summary.tax_computation
    tc_rows = [
        ["Line", "Amount (₹)"],
        ["Taxable income", _inr(tc.taxable_income)],
        ["Slab tax", _inr(tc.slab_tax)],
        ["Less: §87A rebate", _inr(tc.rebate_87a)],
        ["Flat-rate tax (§§111A/112/112A/115BB)", _inr(tc.flat_rate_tax)],
        ["Surcharge", _inr(tc.surcharge)],
        ["Health and Education Cess @ 4%", _inr(tc.cess)],
        ["Total tax payable", _inr(tc.total_tax)],
    ]
    story.append(_table(tc_rows, emphasize_last=True))

    # Balance ----------------------------------------------------------------
    story.append(Paragraph("Balance", h2))
    bal_rows = [
        ["Item", "Amount (₹)"],
        ["Total tax", _inr(tc.total_tax)],
        ["Less: TDS / prepaid taxes", _inr(summary.tds_paid)],
        ["Balance payable / (refund)", _inr(summary.balance_payable)],
    ]
    story.append(_table(bal_rows, emphasize_last=True))

    story.append(Spacer(1, 14))
    story.append(
        Paragraph(
            "Generated by GlimmoraTax. Amounts are quantized to paisa during "
            "computation and rendered as Decimal strings — no float arithmetic "
            "is used. This document is informational; it is not an ITR-V.",
            muted,
        )
    )

    doc.build(story)
    return buf.getvalue()


def _table(rows: list[list[str]], *, emphasize_last: bool = False):
    from reportlab.lib import colors
    from reportlab.lib.units import mm
    from reportlab.platypus import Table, TableStyle

    style_cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F2F4F8")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#1F2A44")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.HexColor("#C7CCD8")),
        ("LINEBELOW", (0, -2), (-1, -2), 0.25, colors.HexColor("#E1E4EC")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
    ]
    if emphasize_last:
        style_cmds.append(("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"))
        style_cmds.append(("LINEABOVE", (0, -1), (-1, -1), 0.5, colors.HexColor("#1F2A44")))
    t = Table(rows, colWidths=[110 * mm, 60 * mm], hAlign="LEFT")
    t.setStyle(TableStyle(style_cmds))
    return t
