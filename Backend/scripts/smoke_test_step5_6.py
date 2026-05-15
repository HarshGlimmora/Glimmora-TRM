"""End-to-end smoke test for Steps 5 + 6.

Exercises:
  - POST /api/v1/filings/{id}/precheck-regime     (OK + WARN_HIGH + BLOCK)
  - POST /api/v1/filings/{id}/calculate           (with hashed ack)
  - GET  /api/v1/filings/{id}/summary
  - GET  /api/v1/filings/{id}/summary.pdf
  - GET  /api/v1/filings/{id}/calculation-trace/explain

Each request goes through the FastAPI app with a real HS256 JWT (same shape
the Next.js proxy mints), so auth + ownership + commit + audit are all on
the hot path.
"""

from __future__ import annotations

import hashlib
import os
import sys
import time
import uuid
from decimal import Decimal

# Force UTF-8 stdout so the unicode tick / box chars render on Windows consoles.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Make `app.*` importable.
HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..")))

# Configure the shared secret BEFORE the FastAPI app picks up settings.
SECRET = os.environ.setdefault("AUTH_SHARED_SECRET", "smoke-test-secret-please-do-not-use-in-prod")

from fastapi.testclient import TestClient  # noqa: E402

from app.db.session import SessionLocal  # noqa: E402
from app.db.init_db import init_database  # noqa: E402
from app.db.seed import run_seed  # noqa: E402
from app.main import app  # noqa: E402
from app.models.documents import Transaction  # noqa: E402
from app.models.filing import TaxReturn  # noqa: E402
from app.models.identity import User  # noqa: E402
from app.services.auth_jwt import sign_hs256  # noqa: E402
from app.services.regime import ACK_TEXT  # noqa: E402


GREEN = "\033[92m"
RED = "\033[91m"
DIM = "\033[2m"
CLR = "\033[0m"


def ok(msg: str) -> None:
    print(f"{GREEN}✓{CLR} {msg}")


def fail(msg: str) -> None:
    print(f"{RED}✗ {msg}{CLR}")
    sys.exit(1)


def info(msg: str) -> None:
    print(f"{DIM}  {msg}{CLR}")


def mint_jwt(user_id: str) -> str:
    now = int(time.time())
    return sign_hs256(
        {
            "sub": user_id,
            "role": "taxpayer",
            "email": "smoke@example.com",
            "phone": "9123456789",
            "name": "Smoke Test",
            "iat": now,
            "exp": now + 300,
        },
        SECRET,
    )


def seed_user_filing_txns(
    *, has_business: bool, prior_regime: str | None
) -> tuple[str, str]:
    """Create a fresh user + an open draft for FY2025-26 with two verified salary
    rows and an interest row. Returns (user_id, filing_id).

    `prior_regime` lets us simulate a previous-year filing (drives the
    Section 115BAC state machine: old → new triggers WARN_HIGH).
    """
    init_database()
    run_seed()

    user_id = str(uuid.uuid4())
    fy = "FY2025-26"
    digits = "".join(c for c in user_id.replace("-", "") if c.isdigit())
    phone = "9" + (digits + "000000000")[:9]

    with SessionLocal() as db:
        user = User(
            id=user_id,
            email=f"smoke-{user_id[:8]}@example.com",
            password_hash="!smoke!",
            name="Smoke Test User",
            role="taxpayer",
            country="IN",
            phone=phone,
            has_business_income=1 if has_business else 0,
            lifetime_switch_backs_to_new=0,
        )
        db.add(user)
        db.flush()

        # Optionally lay down a prior-year filing with a committed regime.
        if prior_regime is not None:
            prior = TaxReturn(
                id=str(uuid.uuid4()),
                user_id=user_id,
                tax_year="FY2024-25",
                country="IN",
                status="accepted",
                regime_used=prior_regime,
                tds_paid=0.0,
            )
            db.add(prior)
            db.flush()

        filing_id = str(uuid.uuid4())
        filing = TaxReturn(
            id=filing_id,
            user_id=user_id,
            tax_year=fy,
            country="IN",
            status="draft",
            summary_json={"declared_deductions": {"80c": "150000"}},
            tds_paid=85000.0,
        )
        db.add(filing)
        db.flush()

        salary = Transaction(
            id=str(uuid.uuid4()),
            filing_id=filing_id,
            user_id=user_id,
            tax_year=fy,
            txn_date="2025-04-25",
            amount=Decimal("1200000.00"),
            description="Salary credit",
            category="salary",
            categorization_method="rule",
            rule_matched="smoke.salary.v1",
            confidence_score=1.0,
            routing_method="auto",
            status="verified",
        )
        interest = Transaction(
            id=str(uuid.uuid4()),
            filing_id=filing_id,
            user_id=user_id,
            tax_year=fy,
            txn_date="2025-05-10",
            amount=Decimal("35000.00"),
            description="FD interest",
            category="interest_fd",
            categorization_method="rule",
            rule_matched="smoke.interest_fd.v1",
            confidence_score=1.0,
            routing_method="auto",
            status="verified",
        )
        db.add_all([salary, interest])
        db.commit()

    return user_id, filing_id


def auth_headers(user_id: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {mint_jwt(user_id)}"}


# ---------------------------------------------------------------------------
# Test scenarios
# ---------------------------------------------------------------------------

def scenario_cat_a_no_prior(client: TestClient) -> None:
    print("\n── Scenario A: Cat-A (salaried), no prior filing ──")
    user_id, filing_id = seed_user_filing_txns(has_business=False, prior_regime=None)
    h = auth_headers(user_id)

    # Precheck with both → OK
    r = client.post(f"/api/v1/filings/{filing_id}/precheck-regime", json={"regime": "both"}, headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["level"] == "OK", body
    ok(f"precheck (both) → level=OK")

    # Calculate with both regimes (preview)
    r = client.post(f"/api/v1/filings/{filing_id}/calculate", json={"regime": "both"}, headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body["regimes_computed"]) == {"old", "new"}, body["regimes_computed"]
    ok(f"calculate (both) — recommended={body['recommended_regime']}, savings={body['savings']}")
    info(f"old total={body['old_regime']['total_tax']}, new total={body['new_regime']['total_tax']}")

    # Commit new regime
    r = client.post(f"/api/v1/filings/{filing_id}/calculate", json={"regime": "new"}, headers=h)
    assert r.status_code == 200, r.text
    ok("calculate (new) committed — no ack needed for Cat-A")

    # Summary
    r = client.get(f"/api/v1/filings/{filing_id}/summary", headers=h)
    assert r.status_code == 200, r.text
    summ = r.json()
    assert summ["regime_used"] == "new"
    assert "salary" in summ["income_breakdown"]
    assert summ["income_breakdown"]["salary"] == "1200000.00"
    ok(f"summary — regime={summ['regime_used']}, taxable={summ['tax_computation']['taxable_income']}, balance={summ['balance_payable']}")
    info(f"income_breakdown={summ['income_breakdown']}")
    info(f"deductions={summ['deductions']}")

    # PDF
    r = client.get(f"/api/v1/filings/{filing_id}/summary.pdf", headers=h)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("application/pdf"), r.headers
    assert r.content[:4] == b"%PDF", r.content[:20]
    ok(f"summary.pdf — {len(r.content)} bytes, %PDF header present")

    # Explain
    r = client.get(f"/api/v1/filings/{filing_id}/calculation-trace/explain", headers=h)
    assert r.status_code == 200, r.text
    exp = r.json()
    assert exp["explanations"], "explanations empty"
    sample = exp["explanations"][0]
    ok(f"explain — {len(exp['explanations'])} step(s), llm_used={exp['llm_used']}, first source={sample['source']}")
    info(f"first plain_text='{sample['plain_text'][:90]}…'")
    info(f"first fields={[f['label'] for f in sample['fields']]}")


def scenario_cat_b_warn_high(client: TestClient) -> None:
    print("\n── Scenario B: Cat-B (business), prior=old, requested=new → WARN_HIGH ──")
    user_id, filing_id = seed_user_filing_txns(has_business=True, prior_regime="old")
    h = auth_headers(user_id)

    # Precheck → WARN_HIGH
    r = client.post(f"/api/v1/filings/{filing_id}/precheck-regime", json={"regime": "new"}, headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["level"] == "WARN_HIGH", body
    assert body["code"] == "115bac_one_time_switch_back", body
    assert body["acknowledgment_text"] == ACK_TEXT
    ok(f"precheck (new) → WARN_HIGH ({body['code']})")
    info(f"ack text length={len(body['acknowledgment_text'])}")

    # Calculate without ack → 409 regime_acknowledgment_required
    r = client.post(f"/api/v1/filings/{filing_id}/calculate", json={"regime": "new"}, headers=h)
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["code"] == "regime_acknowledgment_required", r.text
    ok("calculate (new, no ack) → 409 regime_acknowledgment_required")

    # Calculate with wrong hash → 422 regime_acknowledgment_hash_mismatch
    r = client.post(
        f"/api/v1/filings/{filing_id}/calculate",
        json={
            "regime": "new",
            "acknowledged_regime_switch": True,
            "acknowledgment_text_hash": "deadbeef",
        },
        headers=h,
    )
    assert r.status_code == 422, r.text
    assert r.json()["detail"]["code"] == "regime_acknowledgment_hash_mismatch", r.text
    ok("calculate (new, bad hash) → 422 regime_acknowledgment_hash_mismatch")

    # Calculate with correct hash → 200, regime committed, counter bumped
    ack_hash = hashlib.sha256(ACK_TEXT.encode("utf-8")).hexdigest()
    r = client.post(
        f"/api/v1/filings/{filing_id}/calculate",
        json={
            "regime": "new",
            "acknowledged_regime_switch": True,
            "acknowledgment_text_hash": ack_hash,
        },
        headers=h,
    )
    assert r.status_code == 200, r.text
    ok("calculate (new, correct ack hash) → 200 committed")

    # Verify DB side-effects
    with SessionLocal() as db:
        user = db.get(User, user_id)
        filing = db.get(TaxReturn, filing_id)
        assert user is not None and filing is not None
        assert user.lifetime_switch_backs_to_new == 1, user.lifetime_switch_backs_to_new
        assert filing.regime_used == "new"
        assert filing.regime_switch_acknowledged == 1
        assert filing.regime_acknowledgment_text_hash == ack_hash
        assert filing.regime_switch_section_referenced == "115BAC(6)"
    ok("DB: lifetime_switch_backs_to_new=1, regime_used=new, ack hash stored, section=115BAC(6)")

    # Now request OLD again — should BLOCK (counter exhausted).
    r = client.post(f"/api/v1/filings/{filing_id}/precheck-regime", json={"regime": "old"}, headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["level"] == "BLOCK", body
    assert body["code"] == "115bac_lifetime_lock", body
    ok(f"precheck (old after switch-back) → BLOCK ({body['code']})")

    r = client.post(f"/api/v1/filings/{filing_id}/calculate", json={"regime": "old"}, headers=h)
    assert r.status_code == 422, r.text
    assert r.json()["detail"]["code"] == "regime_switch_blocked", r.text
    ok("calculate (old after switch-back) → 422 regime_switch_blocked")


def scenario_summary_not_ready(client: TestClient) -> None:
    print("\n── Scenario C: Summary before regime committed ──")
    user_id, filing_id = seed_user_filing_txns(has_business=False, prior_regime=None)
    h = auth_headers(user_id)

    r = client.get(f"/api/v1/filings/{filing_id}/summary", headers=h)
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["code"] == "filing_not_ready_for_summary", r.text
    ok("summary without regime → 409 filing_not_ready_for_summary")


def scenario_ownership_isolation(client: TestClient) -> None:
    print("\n── Scenario D: Cross-user filing access ──")
    user_a, filing_a = seed_user_filing_txns(has_business=False, prior_regime=None)
    user_b, _ = seed_user_filing_txns(has_business=False, prior_regime=None)
    hb = auth_headers(user_b)

    r = client.post(f"/api/v1/filings/{filing_a}/precheck-regime", json={"regime": "new"}, headers=hb)
    assert r.status_code == 404, r.text
    ok("precheck on someone else's filing → 404 filing_not_found")

    r = client.get(f"/api/v1/filings/{filing_a}/summary", headers=hb)
    assert r.status_code == 404, r.text
    ok("summary on someone else's filing → 404 filing_not_found")


def main() -> None:
    print(f"AUTH_SHARED_SECRET={SECRET[:8]}…")
    with TestClient(app) as client:
        scenario_cat_a_no_prior(client)
        scenario_cat_b_warn_high(client)
        scenario_summary_not_ready(client)
        scenario_ownership_isolation(client)
    print(f"\n{GREEN}All smoke checks passed.{CLR}")


if __name__ == "__main__":
    main()
