"""Smoke test for Form-document routing (26AS / 16 / salary slip).

Exercises the materializers directly against an in-memory user + draft,
verifying:

  - Form 26AS with AY2026-27 → document attached to FY2025-26 filing,
    salary + interest transactions created, TDS rolled into filing.tds_paid.
  - Form 16 for FY2024-25 → salary transaction + Chapter VI-A mirrored into
    summary_json.declared_deductions.
  - Salary slip for May 2025 → salary transaction routed to FY2025-26.
"""

from __future__ import annotations

import os
import sys
import uuid
from decimal import Decimal

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..")))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

os.environ.setdefault("AUTH_SHARED_SECRET", "smoke-form-routing")

from sqlalchemy import select  # noqa: E402

from app.db.init_db import init_database  # noqa: E402
from app.db.seed import run_seed  # noqa: E402
from app.db.session import SessionLocal, engine  # noqa: E402
from sqlalchemy import event  # noqa: E402


# The dev FastAPI server may be running and holding a connection to the same
# SQLite file. Bump busy_timeout so writes wait for the lock instead of failing.
@event.listens_for(engine, "connect")
def _bump_busy_timeout(dbapi_conn, _):  # noqa: D401
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA busy_timeout = 15000")
    cur.close()
from app.models.documents import Document, Transaction  # noqa: E402
from app.models.filing import TaxReturn  # noqa: E402
from app.models.identity import User  # noqa: E402
from app.services.routing.form_materializers import (  # noqa: E402
    route_form_16,
    route_form_26as,
    route_salary_slip,
)


GREEN = "\033[92m"
RED = "\033[91m"
DIM = "\033[2m"
CLR = "\033[0m"


def ok(msg: str) -> None:
    print(f"{GREEN}OK{CLR} {msg}")


def fail(msg: str) -> None:
    print(f"{RED}FAIL {msg}{CLR}")
    sys.exit(1)


def info(msg: str) -> None:
    print(f"{DIM}   {msg}{CLR}")


def fresh_user_and_doc(db, name: str) -> tuple[User, Document]:
    digits = "".join(c for c in uuid.uuid4().hex if c.isdigit())
    user = User(
        id=str(uuid.uuid4()),
        email=f"smoke-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="!smoke!",
        name=name,
        role="taxpayer",
        country="IN",
        phone="9" + (digits + "000000000")[:9],
    )
    db.add(user)
    db.flush()
    doc = Document(
        id=str(uuid.uuid4()),
        user_id=user.id,
        filing_id=None,
        tax_year=None,
        document_type="form_26as",
        file_name="form26AS.pdf",
        storage_path=f"/tmp/{uuid.uuid4().hex}.pdf",
        mime_type="application/pdf",
        size_bytes=1024,
        sha256="x" * 64,
        status="uploaded",
        routing_status="pending",
    )
    db.add(doc)
    db.flush()
    return user, doc


def test_form_26as() -> None:
    print("\n-- Form 26AS routing (AY2026-27 -> FY2025-26) --")
    init_database()
    run_seed()

    payload = {
        "assessment_year": "AY2026-27",
        "permanent_account_number": "ABCDE1234F",
        "name_of_assessee": "Rajesh Sharma",
        "part_a_tds_on_salary": [
            {
                "deductor_name": "Acme Pvt Ltd",
                "deductor_tan": "ACME12345A",
                "total_amount_paid": "1200000",
                "total_tax_deducted": "120000",
                "total_tax_deposited": "120000",
                "transactions": [
                    {
                        "booking_date": "2025-06-30",
                        "date_of_credit": "2025-06-30",
                        "amount_paid": "300000",
                        "tax_deducted": "30000",
                        "tax_deposited": "30000",
                        "status": "F",
                    },
                    {
                        "booking_date": "2025-09-30",
                        "date_of_credit": "2025-09-30",
                        "amount_paid": "300000",
                        "tax_deducted": "30000",
                        "tax_deposited": "30000",
                        "status": "F",
                    },
                ],
            }
        ],
        "part_a1_tds_other_than_salary": [
            {
                "deductor_name": "HDFC Bank",
                "deductor_tan": "HDFC23456B",
                "total_amount_paid": "45000",
                "total_tax_deducted": "4500",
                "total_tax_deposited": "4500",
                "transactions": [
                    {
                        "date_of_credit": "2026-03-15",
                        "amount_paid": "45000",
                        "tax_deducted": "4500",
                        "tax_deposited": "4500",
                        "status": "F",
                    }
                ],
            }
        ],
        "part_c_details_of_tax_paid_other_than_tds_or_tcs": [
            {
                "bsr_code": "0510308",
                "date_of_deposit": "2026-03-25",
                "challan_serial_number": "01234",
                "total_tax_paid": "15000",
            }
        ],
        "grand_total_tds": "124500",
    }

    notes: list[str] = []
    with SessionLocal() as db:
        user, doc = fresh_user_and_doc(db, "Form26AS Tester")
        result = route_form_26as(db, doc=doc, user_id=user.id, payload=payload, notes=notes)
        db.commit()
        if result != {"FY2025-26": 3}:
            fail(f"expected {{FY2025-26: 3}}, got {result}")
        ok(f"route returned {result}")
        for n in notes:
            info(n)

        # Verify doc attached
        db.refresh(doc)
        if doc.filing_id is None or doc.tax_year != "FY2025-26":
            fail(f"doc not attached: filing_id={doc.filing_id} tax_year={doc.tax_year}")
        ok(f"document attached: filing_id={doc.filing_id[:8]}… tax_year={doc.tax_year}")

        filing = db.get(TaxReturn, doc.filing_id)
        # 30k + 30k (salary TDS rows) + 4500 (interest TDS row) + 15000 (challan)
        expected_tds = Decimal("79500")
        actual = Decimal(str(filing.tds_paid or 0))
        if actual != expected_tds:
            fail(f"tds_paid expected {expected_tds}, got {actual}")
        ok(f"filing.tds_paid = ₹{actual}")

        txns = db.execute(
            select(Transaction).where(Transaction.filing_id == filing.id)
        ).scalars().all()
        cats = sorted([t.category for t in txns])
        if cats != ["interest_income", "salary", "salary"]:
            fail(f"expected categories=salary,salary,interest_income; got {cats}")
        salary_total = sum(Decimal(str(t.amount)) for t in txns if t.category == "salary")
        interest_total = sum(Decimal(str(t.amount)) for t in txns if t.category == "interest_income")
        if salary_total != Decimal("600000"):
            fail(f"salary total expected 600000, got {salary_total}")
        if interest_total != Decimal("45000"):
            fail(f"interest total expected 45000, got {interest_total}")
        ok(f"materialized 3 txns: salary ₹{salary_total}, interest ₹{interest_total}")
        for t in txns:
            info(f"  {t.txn_date}  {t.category:18s}  ₹{Decimal(str(t.amount)):>10}  ({t.description})")


def test_form_16() -> None:
    print("\n-- Form 16 routing (FY2024-25) --")
    payload = {
        "employer": {"name": "Acme Pvt Ltd"},
        "employee": {"name": "Asha"},
        "assessment_year": "AY2025-26",
        "financial_year": "FY2024-25",
        "period": {"from_date": "2024-04-01", "to_date": "2025-03-31"},
        "salary_breakdown": {
            "gross_salary": "1100000",
            "section_17_1_salary": "1000000",
            "standard_deduction": "75000",
        },
        "chapter_via_deductions": [
            {"section": "80c", "amount": "150000"},
            {"section": "80d", "amount": "25000"},
        ],
        "total_tds_deducted": "85000",
    }

    notes: list[str] = []
    with SessionLocal() as db:
        user, doc = fresh_user_and_doc(db, "Form16 Tester")
        doc.document_type = "form16"
        result = route_form_16(db, doc=doc, user_id=user.id, payload=payload, notes=notes)
        db.commit()
        if result != {"FY2024-25": 1}:
            fail(f"expected {{FY2024-25: 1}}, got {result}")
        ok(f"route returned {result}")
        for n in notes:
            info(n)

        db.refresh(doc)
        filing = db.get(TaxReturn, doc.filing_id)
        if Decimal(str(filing.tds_paid or 0)) != Decimal("85000"):
            fail(f"tds_paid expected 85000, got {filing.tds_paid}")
        ok(f"filing.tds_paid = ₹{filing.tds_paid}")

        declared = (filing.summary_json or {}).get("declared_deductions") or {}
        if declared.get("80c") != "150000" or declared.get("80d") != "25000":
            fail(f"declared_deductions mirrored wrong: {declared}")
        ok(f"declared_deductions mirrored: {declared}")

        txns = db.execute(
            select(Transaction).where(Transaction.filing_id == filing.id)
        ).scalars().all()
        if len(txns) != 1 or txns[0].category != "salary":
            fail(f"expected 1 salary txn, got {[(t.category, t.amount) for t in txns]}")
        ok(f"materialized 1 salary txn ₹{Decimal(str(txns[0].amount))} on {txns[0].txn_date}")


def test_salary_slip() -> None:
    print("\n-- Salary slip routing (May 2025) --")
    payload = {
        "employee": {"name": "Asha"},
        "employer": {"name": "Acme Pvt Ltd"},
        "pay_period": {
            "month": "May",
            "year": 2025,
            "from_date": "2025-05-01",
            "to_date": "2025-05-31",
        },
        "earnings": [
            {"component_name": "Basic", "amount": "50000"},
            {"component_name": "HRA", "amount": "25000"},
        ],
        "deductions": [
            {"component_name": "PF", "amount": "6000"},
            {"component_name": "TDS", "amount": "7500"},
        ],
        "gross_earnings_total": "90000",
        "net_pay": "76500",
    }

    notes: list[str] = []
    with SessionLocal() as db:
        user, doc = fresh_user_and_doc(db, "Slip Tester")
        doc.document_type = "salary_slip"
        result = route_salary_slip(db, doc=doc, user_id=user.id, payload=payload, notes=notes)
        db.commit()
        if result != {"FY2025-26": 1}:
            fail(f"expected {{FY2025-26: 1}}, got {result}")
        ok(f"route returned {result}")
        for n in notes:
            info(n)
        db.refresh(doc)
        filing = db.get(TaxReturn, doc.filing_id)
        if Decimal(str(filing.tds_paid or 0)) != Decimal("7500"):
            fail(f"tds_paid expected 7500, got {filing.tds_paid}")
        ok(f"filing.tds_paid (from TDS deduction line) = ₹{filing.tds_paid}")


def main() -> None:
    test_form_26as()
    test_form_16()
    test_salary_slip()
    print(f"\n{GREEN}All form-routing smoke checks passed.{CLR}")


if __name__ == "__main__":
    main()
