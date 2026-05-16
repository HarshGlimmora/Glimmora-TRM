"""End-to-end smoke test for Step 7 — Submit + OTP.

Scenarios:
  A. Happy path — preconditions satisfied → request OTP → submit with the
     dev-revealed code → status flips to 'submitted', audit row written,
     filing.submit_otp_verification_id populated.
  B. Precondition gates — unverified transactions / no regime committed
     → 409 / 422 with the canonical error codes.
  C. OTP error paths — wrong code, expired code, cross-filing OTP, replay
     after consumption.
  D. Re-submit attempt — 409 filing_locked once status='submitted'.
  E. Cross-user — 404 filing_not_found on /request-submit-otp and /submit.

All traffic goes through FastAPI's TestClient with real HS256 JWTs (the
same shape the Next proxy mints), and `GLIMMORA_DEV_REVEAL_OTP=1` so the
client can read the plain OTP from the response.
"""

from __future__ import annotations

import os
import sys
import time
import uuid
from decimal import Decimal

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..")))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Configure BEFORE importing app so settings pick these up.
SECRET = os.environ.setdefault("AUTH_SHARED_SECRET", "smoke-step7-secret")
# pydantic-settings maps field `dev_reveal_otp` → env var `DEV_REVEAL_OTP`
# (case-insensitive, no prefix). The doc string uses the GLIMMORA_ prefix
# colloquially but the actual env name is just the field name uppercased.
os.environ["DEV_REVEAL_OTP"] = "1"
os.environ["SUBMIT_OTP_TTL_SECONDS"] = "600"
# Force the console-only mailer so the smoke test doesn't ask Gmail to
# deliver OTPs to the fake `step7-xxx@example.com` addresses we seed.
os.environ["EMAIL_PROVIDER"] = "console"

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import event, select  # noqa: E402

from app.db.init_db import init_database  # noqa: E402
from app.db.seed import run_seed  # noqa: E402
from app.db.session import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models.cross import AuditLog  # noqa: E402
from app.models.documents import Transaction  # noqa: E402
from app.models.filing import TaxReturn  # noqa: E402
from app.models.identity import User, UserVerification  # noqa: E402
from app.services.auth_jwt import sign_hs256  # noqa: E402


@event.listens_for(engine, "connect")
def _bump_busy_timeout(dbapi_conn, _):  # noqa: D401
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA busy_timeout = 15000")
    cur.close()


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


def mint_jwt(user_id: str) -> str:
    now = int(time.time())
    return sign_hs256(
        {
            "sub": user_id,
            "role": "taxpayer",
            "email": "smoke@example.com",
            "phone": "9999999999",
            "name": "Smoke",
            "iat": now,
            "exp": now + 600,
        },
        SECRET,
    )


def auth_headers(user_id: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {mint_jwt(user_id)}"}


def seed_ready_filing(*, verify_all: bool = True, regime: str | None = "new") -> tuple[str, str]:
    """Returns (user_id, filing_id). Filing has one verified salary txn and an
    optional committed regime."""
    init_database()
    run_seed()

    user_id = str(uuid.uuid4())
    digits = "".join(c for c in user_id.replace("-", "") if c.isdigit())
    phone = "9" + (digits + "000000000")[:9]
    fy = "FY2025-26"

    with SessionLocal() as db:
        user = User(
            id=user_id,
            email=f"step7-{user_id[:8]}@example.com",
            password_hash="!smoke!",
            name="Step7 Tester",
            role="taxpayer",
            country="IN",
            phone=phone,
        )
        db.add(user)
        db.flush()

        filing_id = str(uuid.uuid4())
        filing = TaxReturn(
            id=filing_id,
            user_id=user_id,
            tax_year=fy,
            country="IN",
            status="draft",
            regime_used=regime,
            tds_paid=85000.0,
        )
        db.add(filing)
        db.flush()

        txn = Transaction(
            id=str(uuid.uuid4()),
            filing_id=filing_id,
            user_id=user_id,
            tax_year=fy,
            txn_date="2025-04-25",
            amount=Decimal("1200000.00"),
            description="Salary",
            category="salary",
            categorization_method="rule",
            rule_matched="smoke.salary.v1",
            confidence_score=1.0,
            routing_method="auto",
            status="verified" if verify_all else "unverified",
        )
        db.add(txn)
        db.commit()
    return user_id, filing_id


# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------

def scenario_happy_path(c: TestClient) -> None:
    print("\n-- Scenario A: happy path --")
    user_id, filing_id = seed_ready_filing()
    h = auth_headers(user_id)

    r = c.post("/api/v1/auth/request-submit-otp", json={"filing_id": filing_id}, headers=h)
    if r.status_code != 202:
        fail(f"request-submit-otp expected 202, got {r.status_code}: {r.text}")
    payload = r.json()
    if not payload.get("dev_plain_code"):
        fail(f"dev_plain_code missing — is GLIMMORA_DEV_REVEAL_OTP=1? body={payload}")
    ok(f"request-submit-otp → 202 sent_to={payload['sent_to']} otp={payload['dev_plain_code']}")
    verification_id = payload["verification_id"]
    code = payload["dev_plain_code"]

    r = c.post(
        f"/api/v1/filings/{filing_id}/submit",
        json={"acknowledgment": True, "verification_id": verification_id, "otp": code},
        headers=h,
    )
    if r.status_code != 200:
        fail(f"submit expected 200, got {r.status_code}: {r.text}")
    out = r.json()
    ok(f"submit → 200 status={out['status']} submitted_at={out['submitted_at']}")

    # DB side-effects
    with SessionLocal() as db:
        filing = db.get(TaxReturn, filing_id)
        if filing.status != "submitted":
            fail(f"filing.status = {filing.status}")
        if filing.submit_otp_verification_id != verification_id:
            fail("submit_otp_verification_id not stamped")
        if filing.submitted_by_user_id != user_id:
            fail("submitted_by_user_id wrong")
        v = db.get(UserVerification, verification_id)
        if v.consumed_at is None:
            fail("verification row not consumed")
        audits = db.execute(
            select(AuditLog).where(AuditLog.entity_id == filing_id, AuditLog.action == "filing_submitted")
        ).scalars().all()
        if not audits:
            fail("audit row missing")
        ok(f"DB: status=submitted, OTP consumed, audit row present (metadata={audits[-1].metadata_})")


def scenario_replay_blocked(c: TestClient) -> None:
    print("\n-- Scenario A2: replay blocked --")
    user_id, filing_id = seed_ready_filing()
    h = auth_headers(user_id)

    r = c.post("/api/v1/auth/request-submit-otp", json={"filing_id": filing_id}, headers=h)
    payload = r.json()
    verification_id = payload["verification_id"]
    code = payload["dev_plain_code"]
    c.post(
        f"/api/v1/filings/{filing_id}/submit",
        json={"acknowledgment": True, "verification_id": verification_id, "otp": code},
        headers=h,
    )

    # Try the same OTP again → must fail (status now 'submitted' → 409 filing_locked).
    r = c.post(
        f"/api/v1/filings/{filing_id}/submit",
        json={"acknowledgment": True, "verification_id": verification_id, "otp": code},
        headers=h,
    )
    if r.status_code != 409 or r.json()["detail"]["code"] != "filing_locked":
        fail(f"replay should have hit filing_locked, got {r.status_code}: {r.text}")
    ok("replay after submission → 409 filing_locked")


def scenario_unverified_transactions(c: TestClient) -> None:
    print("\n-- Scenario B1: unverified transactions block --")
    user_id, filing_id = seed_ready_filing(verify_all=False)
    h = auth_headers(user_id)

    r = c.post("/api/v1/auth/request-submit-otp", json={"filing_id": filing_id}, headers=h)
    if r.status_code != 422 or r.json()["detail"]["code"] != "unverified_transactions":
        fail(f"expected 422 unverified_transactions, got {r.status_code}: {r.text}")
    ok("request-otp with unverified txns → 422 unverified_transactions")


def scenario_no_regime(c: TestClient) -> None:
    print("\n-- Scenario B2: no regime committed --")
    user_id, filing_id = seed_ready_filing(regime=None)
    h = auth_headers(user_id)

    r = c.post("/api/v1/auth/request-submit-otp", json={"filing_id": filing_id}, headers=h)
    if r.status_code != 409 or r.json()["detail"]["code"] != "filing_not_ready_for_submit":
        fail(f"expected 409 filing_not_ready_for_submit, got {r.status_code}: {r.text}")
    ok("request-otp with no regime → 409 filing_not_ready_for_submit")


def scenario_bad_otp(c: TestClient) -> None:
    print("\n-- Scenario C1: wrong OTP --")
    user_id, filing_id = seed_ready_filing()
    h = auth_headers(user_id)

    r = c.post("/api/v1/auth/request-submit-otp", json={"filing_id": filing_id}, headers=h)
    payload = r.json()
    verification_id = payload["verification_id"]

    r = c.post(
        f"/api/v1/filings/{filing_id}/submit",
        json={"acknowledgment": True, "verification_id": verification_id, "otp": "000000"},
        headers=h,
    )
    if r.status_code != 422 or r.json()["detail"]["code"] != "invalid_or_expired_otp":
        fail(f"expected 422 invalid_or_expired_otp, got {r.status_code}: {r.text}")
    ok("wrong OTP → 422 invalid_or_expired_otp")

    # Attempts counter should have ticked.
    with SessionLocal() as db:
        v = db.get(UserVerification, verification_id)
        if v.attempts != 1:
            fail(f"attempts should be 1, got {v.attempts}")
    ok("verification.attempts incremented to 1")


def scenario_cross_filing_otp(c: TestClient) -> None:
    print("\n-- Scenario C2: OTP issued for filing A used for filing B --")
    user_id, filing_a = seed_ready_filing()
    h = auth_headers(user_id)

    r = c.post("/api/v1/auth/request-submit-otp", json={"filing_id": filing_a}, headers=h)
    payload_a = r.json()

    # Create a second filing for the same user (different FY so the
    # one-draft-per-FY rule is honored). Flush between the parent and
    # child inserts — SQLite's FK check fires at row-insert time, not at
    # end-of-transaction, so the parent must hit disk first.
    filing_b = str(uuid.uuid4())
    with SessionLocal() as db:
        f = TaxReturn(
            id=filing_b,
            user_id=user_id,
            tax_year="FY2024-25",
            country="IN",
            status="draft",
            regime_used="new",
            tds_paid=0.0,
        )
        db.add(f)
        db.flush()
        db.add(Transaction(
            id=str(uuid.uuid4()),
            filing_id=filing_b,
            user_id=user_id,
            tax_year="FY2024-25",
            txn_date="2024-04-25",
            amount=Decimal("500000"),
            description="Salary",
            category="salary",
            categorization_method="rule",
            rule_matched="r",
            confidence_score=1.0,
            routing_method="auto",
            status="verified",
        ))
        db.commit()

    r = c.post(
        f"/api/v1/filings/{filing_b}/submit",
        json={
            "acknowledgment": True,
            "verification_id": payload_a["verification_id"],
            "otp": payload_a["dev_plain_code"],
        },
        headers=h,
    )
    if r.status_code != 422 or r.json()["detail"]["code"] != "otp_filing_mismatch":
        fail(f"expected 422 otp_filing_mismatch, got {r.status_code}: {r.text}")
    ok("cross-filing OTP → 422 otp_filing_mismatch")


def scenario_expired_otp(c: TestClient) -> None:
    print("\n-- Scenario C3: expired OTP --")
    user_id, filing_id = seed_ready_filing()
    h = auth_headers(user_id)

    r = c.post("/api/v1/auth/request-submit-otp", json={"filing_id": filing_id}, headers=h)
    payload = r.json()
    verification_id = payload["verification_id"]
    code = payload["dev_plain_code"]

    # The schema's chk_verif_expires_future forbids us from backdating
    # expires_at past created_at. Instead, rewrite both columns to ages-old
    # ISO strings (created_at first to keep the constraint happy if SQLite
    # re-evaluates row-level CHECKs).
    with SessionLocal() as db:
        v = db.get(UserVerification, verification_id)
        v.created_at = "2019-12-31T00:00:00Z"
        v.expires_at = "2020-01-01T00:00:00Z"
        db.commit()

    r = c.post(
        f"/api/v1/filings/{filing_id}/submit",
        json={"acknowledgment": True, "verification_id": verification_id, "otp": code},
        headers=h,
    )
    if r.status_code != 422 or r.json()["detail"]["code"] != "invalid_or_expired_otp":
        fail(f"expected 422 invalid_or_expired_otp, got {r.status_code}: {r.text}")
    ok("expired OTP → 422 invalid_or_expired_otp")

    with SessionLocal() as db:
        v = db.get(UserVerification, verification_id)
        if v.consumed_at is None:
            fail("expired row should be consumed so it doesn't linger")
    ok("expired row marked consumed (no lingering outstanding OTP)")


def scenario_unauthenticated(c: TestClient) -> None:
    print("\n-- Scenario E: cross-user / unauthenticated --")
    user_a, filing_a = seed_ready_filing()
    user_b, _ = seed_ready_filing()
    hb = auth_headers(user_b)

    r = c.post("/api/v1/auth/request-submit-otp", json={"filing_id": filing_a}, headers=hb)
    if r.status_code != 404 or r.json()["detail"]["code"] != "filing_not_found":
        fail(f"cross-user request-otp expected 404, got {r.status_code}: {r.text}")
    ok("request-otp on someone else's filing → 404 filing_not_found")

    r = c.post(
        f"/api/v1/filings/{filing_a}/submit",
        json={"acknowledgment": True, "verification_id": "bogus", "otp": "000000"},
        headers=hb,
    )
    if r.status_code != 404 or r.json()["detail"]["code"] != "filing_not_found":
        fail(f"cross-user submit expected 404, got {r.status_code}: {r.text}")
    ok("submit on someone else's filing → 404 filing_not_found")


def main() -> None:
    with TestClient(app) as c:
        scenario_happy_path(c)
        scenario_replay_blocked(c)
        scenario_unverified_transactions(c)
        scenario_no_regime(c)
        scenario_bad_otp(c)
        scenario_cross_filing_otp(c)
        scenario_expired_otp(c)
        scenario_unauthenticated(c)
    print(f"\n{GREEN}All Step 7 smoke checks passed.{CLR}")


if __name__ == "__main__":
    main()
