"""Idempotent seed data loaded after migrations.

Currently seeds:
  - Two synthetic admin users (`system-creator-…`, `system-approver-…`) used
    to satisfy `chk_rules_dual_approver` / `chk_rules_active_approval` when
    inserting platform-owned `country_rules` rows.
  - The `csv_categorization` rule set from
    `Backend/data/seed/category_rules.json` for a fixed list of FYs.

Every operation is `INSERT … IF NOT EXISTS` so re-running on an existing DB is
a no-op.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.identity import User
from app.models.rules import CountryRule
from app.services.categorization.rules import load_seed_payload


logger = logging.getLogger(__name__)

# Stable UUIDs so re-seeding picks up the same rows across restarts.
SYSTEM_CREATOR_ID = "00000000-0000-0000-0000-000000000001"
SYSTEM_APPROVER_ID = "00000000-0000-0000-0000-000000000002"

# FYs the platform ships categorization rules for. Add new years here when
# they go live — the rule_json itself is FY-agnostic.
SEEDED_FYS = ("FY2023-24", "FY2024-25", "FY2025-26")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _ensure_system_user(db: Session, user_id: str, suffix: str) -> User:
    existing = db.get(User, user_id)
    if existing is not None:
        return existing
    user = User(
        id=user_id,
        email=f"system-{suffix}@glimmora.platform",
        password_hash="",
        name=f"Glimmora system ({suffix})",
        role="admin",
        country="IN",
    )
    db.add(user)
    db.flush()
    return user


def _seed_csv_categorization_rules(db: Session) -> int:
    creator = _ensure_system_user(db, SYSTEM_CREATOR_ID, "creator")
    approver = _ensure_system_user(db, SYSTEM_APPROVER_ID, "approver")
    payload = load_seed_payload()
    now = _now_iso()
    today = datetime.now(timezone.utc).date().isoformat()

    seeded = 0
    for fy in SEEDED_FYS:
        existing = db.execute(
            select(CountryRule).where(
                CountryRule.country == "IN",
                CountryRule.tax_year == fy,
                CountryRule.rule_type == "csv_categorization",
                CountryRule.status == "active",
            )
        ).scalar_one_or_none()
        if existing is not None:
            continue
        row = CountryRule(
            country="IN",
            tax_year=fy,
            rule_type="csv_categorization",
            version=int(payload.get("version", 1)),
            rule_json=payload,
            source_reference="Backend/data/seed/category_rules.json",
            effective_from=today,
            status="active",
            created_by_user_id=creator.id,
            approved_by_user_id=approver.id,
            approved_at=now,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
        seeded += 1
    return seeded


def run_seed() -> None:
    """Entry point invoked from FastAPI startup. Quietly does nothing when
    the data is already present.
    """
    db = SessionLocal()
    try:
        seeded = _seed_csv_categorization_rules(db)
        if seeded:
            db.commit()
            logger.info("Seeded %d csv_categorization rule rows.", seeded)
        else:
            db.rollback()
    except Exception:
        db.rollback()
        logger.exception("Seed failed; database left unchanged.")
    finally:
        db.close()
