from __future__ import annotations

from sqlalchemy import ForeignKey, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models._types import new_uuid, utcnow_iso


class FraudCase(Base):
    __tablename__ = "fraud_cases"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=new_uuid)
    filing_id: Mapped[str] = mapped_column(Text, ForeignKey("tax_returns.id"), nullable=False)
    taxpayer_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id"), nullable=False)
    tax_year: Mapped[str] = mapped_column(Text, nullable=False)
    jurisdiction: Mapped[str | None] = mapped_column(Text)

    flagged_by: Mapped[str] = mapped_column(Text, ForeignKey("users.id"), nullable=False)
    flag_reason: Mapped[str] = mapped_column(Text, nullable=False)
    flag_notes: Mapped[str | None] = mapped_column(Text)
    flagged_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)

    status: Mapped[str] = mapped_column(Text, nullable=False, default="flagged")

    judicial_officer_id: Mapped[str | None] = mapped_column(Text, ForeignKey("users.id"))
    judicial_assigned_at: Mapped[str | None] = mapped_column(Text)
    judicial_decision: Mapped[str | None] = mapped_column(Text)
    judicial_notes: Mapped[str | None] = mapped_column(Text)
    judicial_reviewed_at: Mapped[str | None] = mapped_column(Text)

    enforcement_agency_id: Mapped[str | None] = mapped_column(Text, ForeignKey("users.id"))
    enforcement_assigned_at: Mapped[str | None] = mapped_column(Text)
    enforcement_outcome: Mapped[str | None] = mapped_column(Text)
    enforcement_notes: Mapped[str | None] = mapped_column(Text)
    closed_at: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)


class EnforcementAccess(Base):
    __tablename__ = "enforcement_access"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=new_uuid)
    target_user_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id"), nullable=False)
    granted_to: Mapped[str] = mapped_column(Text, ForeignKey("users.id"), nullable=False)
    granted_by: Mapped[str] = mapped_column(Text, ForeignKey("users.id"), nullable=False)
    fraud_case_id: Mapped[str | None] = mapped_column(Text, ForeignKey("fraud_cases.id"))
    access_type: Mapped[str] = mapped_column(Text, nullable=False, default="read_only")

    reason: Mapped[str] = mapped_column(Text, nullable=False)
    case_reference: Mapped[str | None] = mapped_column(Text)
    tax_years: Mapped[list[str] | None] = mapped_column(JSON)

    granted_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)
    expires_at: Mapped[str] = mapped_column(Text, nullable=False)
    revoked_at: Mapped[str | None] = mapped_column(Text)
