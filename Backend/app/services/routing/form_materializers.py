"""Turn structured form extractions (Form 16, Form 26AS, salary slip) into
the same `transactions` table rows that drive Step 4's review and Step 6's
calculation.

Each materializer:
  1. Resolves the document's owning FY from the document itself (AY or FY
     header — these forms are inherently per-FY, unlike bank statements).
  2. Attaches the document to that FY's filing (creating a sibling draft if
     needed via fy_router.ensure_filing_for_fy).
  3. Inserts `transactions` rows with `categorization_method='ai_assisted'`
     (the field values came from Gemini, not from deterministic rules).
  4. Rolls deducted / prepaid taxes into `tax_returns.tds_paid` so the
     engine's `balance = total_tax - tds_paid` line resolves correctly.

Returns `{fy: row_count}` for the routing report. Empty dict means nothing
material was produced — the caller falls back to `routing_status='overridden'`.
"""

from __future__ import annotations

from datetime import date as _date
from decimal import Decimal as _D, InvalidOperation
from typing import Any

from sqlalchemy.orm import Session

from app.models.documents import Document, Transaction
from app.services.routing import fy_router


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fy_end_date(fy: str) -> _date:
    """Last day of an FY tag like FY2024-25 → 2025-03-31."""
    try:
        start = int(fy[2:6])
        return _date(start + 1, 3, 31)
    except (ValueError, IndexError):
        return _date.today()


def _ay_to_fy(ay: str | None) -> str | None:
    """AY2026-27 → FY2025-26 (FY is one year before the AY).

    Tolerates loose forms: "AY 2026-27", "ay2026-27", "2026-27".
    Returns None on anything we can't parse.
    """
    if not ay:
        return None
    raw = ay.upper().replace(" ", "")
    if raw.startswith("AY"):
        raw = raw[2:]
    try:
        head, tail = raw.split("-", 1)
        start_year = int(head)
        return f"FY{start_year - 1}-{(start_year) % 100:02d}"
    except (ValueError, IndexError):
        return None


def _normalize_fy(fy: str | None) -> str | None:
    """Accept "FY2024-25", "FY 2024-25", "2024-25" → "FY2024-25"."""
    if not fy:
        return None
    raw = fy.upper().replace(" ", "")
    if raw.startswith("FY"):
        raw = raw[2:]
    try:
        head, tail = raw.split("-", 1)
        start = int(head)
        return f"FY{start}-{int(tail) % 100:02d}"
    except (ValueError, IndexError):
        return None


def _to_decimal(v: Any) -> _D | None:
    if v is None or v == "":
        return None
    try:
        return _D(str(v))
    except (InvalidOperation, TypeError):
        return None


def _parse_iso(s: Any) -> _date | None:
    if not isinstance(s, str) or len(s) < 10:
        return None
    try:
        y, m, d = (int(x) for x in s[:10].split("-"))
        return _date(y, m, d)
    except (ValueError, TypeError):
        return None


def _bump_tds(filing, amount: _D | None) -> None:
    if amount is None or amount <= 0:
        return
    current = _D(str(filing.tds_paid or 0))
    filing.tds_paid = float(current + amount)


def _now_iso() -> str:
    return fy_router._now_iso()  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Form 26AS
# ---------------------------------------------------------------------------

def route_form_26as(
    db: Session,
    *,
    doc: Document,
    user_id: str,
    payload: dict,
    notes: list[str],
) -> dict[str, int]:
    """Materialize Form 26AS income rows + roll TDS / advance tax into tds_paid.

    - Part A (TDS on salary)         → salary transactions, sum TDS
    - Part A1 (TDS other than salary)→ interest_income transactions, sum TDS
    - Part C (challan tax paid)      → no transaction, but counts as prepaid

    All transactions land in the FY derived from `assessment_year`. Form 26AS
    is always per-AY, so every row goes to the same filing.
    """
    fy = _ay_to_fy(payload.get("assessment_year"))
    if fy is None:
        notes.append(
            "Form 26AS extraction did not include a usable assessment_year; "
            "cannot determine the filing's FY."
        )
        return {}

    filing = fy_router.ensure_filing_for_fy(db, user_id=user_id, tax_year=fy)
    doc.filing_id = filing.id
    doc.tax_year = fy

    fy_end = _fy_end_date(fy)
    counts = 0

    # Part A: TDS on salary → salary transactions
    for block in payload.get("part_a_tds_on_salary") or []:
        deductor = block.get("deductor_name") or "Employer"
        tan = block.get("deductor_tan")
        block_total = _to_decimal(block.get("total_amount_paid"))
        block_tds = _to_decimal(
            block.get("total_tax_deposited") or block.get("total_tax_deducted")
        )

        # Prefer per-row breakdown when present, else one row at the FY level.
        rows = block.get("transactions") or []
        if rows:
            for r in rows:
                amount = _to_decimal(r.get("amount_paid"))
                if amount is None or amount <= 0:
                    continue
                tx_date = _parse_iso(r.get("date_of_credit") or r.get("booking_date")) or fy_end
                db.add(_build_txn(
                    filing=filing, doc=doc, user_id=user_id, fy=fy,
                    txn_date=tx_date, amount=amount,
                    description=f"Salary credit ({deductor})",
                    counterparty=deductor,
                    category="salary",
                    raw_payload={"section": "26AS_part_a", "tan": tan, **r},
                ))
                counts += 1
                _bump_tds(filing, _to_decimal(r.get("tax_deposited") or r.get("tax_deducted")))
        else:
            if block_total is not None and block_total > 0:
                db.add(_build_txn(
                    filing=filing, doc=doc, user_id=user_id, fy=fy,
                    txn_date=fy_end, amount=block_total,
                    description=f"Salary paid by {deductor} (Form 26AS Part A)",
                    counterparty=deductor,
                    category="salary",
                    raw_payload={"section": "26AS_part_a", "tan": tan, "block": block},
                ))
                counts += 1
            _bump_tds(filing, block_tds)

    # Part A1: TDS other than salary → interest_income transactions
    for block in payload.get("part_a1_tds_other_than_salary") or []:
        deductor = block.get("deductor_name") or "Bank / payer"
        tan = block.get("deductor_tan")
        block_total = _to_decimal(block.get("total_amount_paid"))
        block_tds = _to_decimal(
            block.get("total_tax_deposited") or block.get("total_tax_deducted")
        )

        rows = block.get("transactions") or []
        if rows:
            for r in rows:
                amount = _to_decimal(r.get("amount_paid"))
                if amount is None or amount <= 0:
                    continue
                tx_date = _parse_iso(r.get("date_of_credit") or r.get("booking_date")) or fy_end
                db.add(_build_txn(
                    filing=filing, doc=doc, user_id=user_id, fy=fy,
                    txn_date=tx_date, amount=amount,
                    description=f"Interest / other income ({deductor})",
                    counterparty=deductor,
                    category="interest_income",
                    raw_payload={"section": "26AS_part_a1", "tan": tan, **r},
                ))
                counts += 1
                _bump_tds(filing, _to_decimal(r.get("tax_deposited") or r.get("tax_deducted")))
        else:
            if block_total is not None and block_total > 0:
                db.add(_build_txn(
                    filing=filing, doc=doc, user_id=user_id, fy=fy,
                    txn_date=fy_end, amount=block_total,
                    description=f"Interest / other income from {deductor} (Form 26AS Part A1)",
                    counterparty=deductor,
                    category="interest_income",
                    raw_payload={"section": "26AS_part_a1", "tan": tan, "block": block},
                ))
                counts += 1
            _bump_tds(filing, block_tds)

    # Part C: challan tax paid (advance tax / self-assessment) → tds_paid only
    challan_total = _D("0")
    for row in payload.get("part_c_details_of_tax_paid_other_than_tds_or_tcs") or []:
        amt = _to_decimal(row.get("total_tax_paid"))
        if amt is not None and amt > 0:
            challan_total += amt
    if challan_total > 0:
        _bump_tds(filing, challan_total)
        notes.append(f"Form 26AS Part C — advance / self-assessment tax ₹{challan_total} added to TDS paid.")

    # Grand total TDS field, if present, lets us reconcile.
    grand = _to_decimal(payload.get("grand_total_tds"))
    if grand is not None:
        notes.append(f"Form 26AS grand_total_tds reported: ₹{grand}.")

    if counts == 0 and challan_total == 0:
        notes.append("Form 26AS extracted but no income rows or challan amounts were produced.")
        return {}

    notes.append(f"Form 26AS → attached to {fy}; materialized {counts} transaction(s).")
    return {fy: counts}


# ---------------------------------------------------------------------------
# Form 16
# ---------------------------------------------------------------------------

def route_form_16(
    db: Session,
    *,
    doc: Document,
    user_id: str,
    payload: dict,
    notes: list[str],
) -> dict[str, int]:
    """Materialize Form 16 into a single salary transaction + roll TDS in.

    FY resolution prefers the explicit `financial_year` field, falling back
    to `assessment_year`. Chapter VI-A deductions are mirrored into the
    filing's `summary_json.declared_deductions` so the old-regime engine
    picks them up automatically.
    """
    fy = _normalize_fy(payload.get("financial_year")) or _ay_to_fy(payload.get("assessment_year"))
    if fy is None:
        notes.append("Form 16 extraction did not include FY or AY; cannot route.")
        return {}

    filing = fy_router.ensure_filing_for_fy(db, user_id=user_id, tax_year=fy)
    doc.filing_id = filing.id
    doc.tax_year = fy

    breakdown = payload.get("salary_breakdown") or {}
    gross = _to_decimal(breakdown.get("gross_salary"))
    employer = (payload.get("employer") or {}).get("name") or "Employer"
    period = payload.get("period") or {}
    tx_date = (
        _parse_iso(period.get("to_date"))
        or _parse_iso(period.get("from_date"))
        or _fy_end_date(fy)
    )

    count = 0
    if gross is not None and gross > 0:
        db.add(_build_txn(
            filing=filing, doc=doc, user_id=user_id, fy=fy,
            txn_date=tx_date, amount=gross,
            description=f"Salary (Form 16) — {employer}",
            counterparty=employer,
            category="salary",
            raw_payload={"section": "form16_gross_salary", "breakdown": breakdown},
        ))
        count = 1

    _bump_tds(filing, _to_decimal(payload.get("total_tds_deducted")))
    for q in payload.get("tds_quarterly") or []:
        # If the line-level TDS is present, use it; otherwise rely on the
        # total above. Either way, we never double-count: when both exist,
        # quarterly entries are detail and total is the sum — we only count
        # one. We bias to the quarterly detail when it's present.
        # (Form 16's `total_tds_deducted` is preferred as the canonical sum,
        # so we skip per-quarter here.)
        del q

    # Mirror Chapter VI-A declarations into the filing so /calculate picks
    # them up under the old regime. Doesn't overwrite values the user has
    # already typed in — Form 16 is an additive source.
    via_rows = payload.get("chapter_via_deductions") or []
    if via_rows:
        summary = dict(filing.summary_json or {})
        declared = dict(summary.get("declared_deductions") or {})
        for r in via_rows:
            section = (r.get("section") or "").strip().lower()
            amt = _to_decimal(r.get("amount"))
            if not section or amt is None or amt <= 0:
                continue
            if section not in declared:
                declared[section] = str(amt)
        summary["declared_deductions"] = declared
        filing.summary_json = summary
        notes.append(
            f"Form 16 → mirrored {len(via_rows)} Chapter VI-A section(s) into "
            f"declared_deductions."
        )

    if count == 0:
        notes.append("Form 16 extracted but no gross-salary amount was produced.")
        return {}

    notes.append(f"Form 16 → attached to {fy}; salary ₹{gross} materialized.")
    return {fy: count}


# ---------------------------------------------------------------------------
# Salary slip (monthly)
# ---------------------------------------------------------------------------

def route_salary_slip(
    db: Session,
    *,
    doc: Document,
    user_id: str,
    payload: dict,
    notes: list[str],
) -> dict[str, int]:
    """One transaction = one month of gross earnings. FY is derived from the
    pay period."""
    period = payload.get("pay_period") or {}
    tx_date = (
        _parse_iso(period.get("to_date"))
        or _parse_iso(period.get("from_date"))
        or None
    )
    if tx_date is None:
        year = period.get("year")
        if isinstance(year, int) and 2000 <= year <= 2100:
            tx_date = _date(year, 3, 31)
    if tx_date is None:
        notes.append("Salary slip has no usable pay_period dates; cannot route.")
        return {}

    fy = fy_router.fy_for_date(tx_date)
    filing = fy_router.ensure_filing_for_fy(db, user_id=user_id, tax_year=fy)
    doc.filing_id = filing.id
    doc.tax_year = fy

    gross = _to_decimal(payload.get("gross_earnings_total"))
    if gross is None or gross <= 0:
        # Fallback: sum earnings array.
        total = _D("0")
        for e in payload.get("earnings") or []:
            a = _to_decimal(e.get("amount"))
            if a is not None:
                total += a
        gross = total if total > 0 else None

    employer = (payload.get("employer") or {}).get("name") or "Employer"
    month_label = period.get("month") or tx_date.isoformat()

    if gross is None or gross <= 0:
        notes.append("Salary slip has no usable gross earnings; nothing to materialize.")
        return {}

    db.add(_build_txn(
        filing=filing, doc=doc, user_id=user_id, fy=fy,
        txn_date=tx_date, amount=gross,
        description=f"Salary ({month_label}) — {employer}",
        counterparty=employer,
        category="salary",
        raw_payload={"section": "salary_slip", "payload": payload},
    ))

    # Treat any TDS-shaped deduction in the slip's `deductions` array as TDS.
    for d in payload.get("deductions") or []:
        name = (d.get("component_name") or "").lower()
        if "tds" in name or "tax deducted" in name:
            _bump_tds(filing, _to_decimal(d.get("amount")))

    notes.append(f"Salary slip → attached to {fy}; gross ₹{gross} ({month_label}).")
    return {fy: 1}


# ---------------------------------------------------------------------------
# Shared transaction factory
# ---------------------------------------------------------------------------

def _build_txn(
    *,
    filing,
    doc: Document,
    user_id: str,
    fy: str,
    txn_date: _date,
    amount: _D,
    description: str,
    counterparty: str | None,
    category: str,
    raw_payload: dict,
) -> Transaction:
    return Transaction(
        filing_id=filing.id,
        document_id=doc.id,
        user_id=user_id,
        tax_year=fy,
        txn_date=txn_date.isoformat(),
        amount=float(amount),
        description=description,
        counterparty=counterparty,
        raw_payload=raw_payload,
        category=category,
        # Gemini-extracted income rows — must be ai_assisted (NOT rule, which
        # the chk_txn_method_rule CHECK would require a rule_matched for).
        categorization_method="ai_assisted",
        rule_matched=None,
        confidence_score=0.85,
        routing_method="auto",
        routing_source_field="form_section",
        routed_at=_now_iso(),
        status="unverified",
    )
