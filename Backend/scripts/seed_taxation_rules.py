"""Seed the `country_rules` table with FY 2025-26 taxation rules.

Idempotent: skips rules that already exist active. In production, rules should
flow through the dual-admin approval API; this script is for local dev /
demos / CI fixtures.

    python -m scripts.seed_taxation_rules
"""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.identity import User
from app.models.rules import CountryRule
from app.services.taxation.defaults import RULES_FY_2025_26

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s | %(message)s")
logger = logging.getLogger("seed_taxation_rules")

FY = "FY2025-26"
COUNTRY = "IN"
EFFECTIVE_FROM = "2025-04-01"
EFFECTIVE_TO = "2026-03-31"

SYSTEM_CREATOR_EMAIL = "system-seed-creator@glimmora.internal"
SYSTEM_APPROVER_EMAIL = "system-seed-approver@glimmora.internal"


def _ensure_system_user(db, email: str, name: str) -> User:
    existing = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if existing is not None:
        return existing
    user = User(
        id=str(uuid.uuid4()),
        email=email,
        password_hash="!disabled-seed-user!",
        name=name,
        role="admin",
        country=COUNTRY,
        phone=None,
    )
    db.add(user)
    db.flush()
    logger.info("Created seed user %s", email)
    return user


def main() -> int:
    with SessionLocal() as db:
        creator = _ensure_system_user(db, SYSTEM_CREATOR_EMAIL, "Seed Creator")
        approver = _ensure_system_user(db, SYSTEM_APPROVER_EMAIL, "Seed Approver")

        seeded = 0
        for rule_type, spec in RULES_FY_2025_26.items():
            already = db.execute(
                select(CountryRule)
                .where(CountryRule.country == COUNTRY)
                .where(CountryRule.tax_year == FY)
                .where(CountryRule.rule_type == rule_type)
                .where(CountryRule.status == "active")
            ).scalar_one_or_none()
            if already is not None:
                logger.info("skip %s — already active (v%d)", rule_type, already.version)
                continue

            payload = dict(spec["rule_json"])
            payload.setdefault("section_ref", spec["section_ref"])

            row = CountryRule(
                id=str(uuid.uuid4()),
                country=COUNTRY,
                tax_year=FY,
                rule_type=rule_type,
                version=1,
                rule_json=payload,
                source_reference=spec["source_reference"],
                effective_from=EFFECTIVE_FROM,
                effective_to=EFFECTIVE_TO,
                status="active",
                created_by_user_id=creator.id,
                approved_by_user_id=approver.id,
                approved_at="2025-04-01T00:00:00Z",
            )
            db.add(row)
            seeded += 1
            logger.info("seeded %s (%s)", rule_type, spec["section_ref"])

        db.commit()
        logger.info("Done. %d rule(s) seeded for %s.", seeded, FY)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
