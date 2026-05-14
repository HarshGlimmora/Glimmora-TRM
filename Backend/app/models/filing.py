from __future__ import annotations

from sqlalchemy import ForeignKey, Integer, JSON, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models._types import new_uuid, utcnow_iso


class TaxReturn(Base):
    __tablename__ = "tax_returns"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id"), nullable=False)
    country: Mapped[str] = mapped_column(Text, nullable=False, default="IN")
    tax_year: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="draft")

    regime_used: Mapped[str | None] = mapped_column(Text)
    regime_switch_acknowledged: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    regime_switch_section_referenced: Mapped[str | None] = mapped_column(Text)
    regime_switch_acknowledged_at: Mapped[str | None] = mapped_column(Text)
    regime_acknowledgment_text_hash: Mapped[str | None] = mapped_column(Text)
    form_10iea_required: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    templated_from_tax_year: Mapped[str | None] = mapped_column(Text)

    summary_json: Mapped[dict | None] = mapped_column(JSON)
    old_regime_total_tax: Mapped[float | None] = mapped_column(Numeric)
    new_regime_total_tax: Mapped[float | None] = mapped_column(Numeric)
    recommended_regime: Mapped[str | None] = mapped_column(Text)
    tds_paid: Mapped[float | None] = mapped_column(Numeric)
    balance_payable: Mapped[float | None] = mapped_column(Numeric)

    current_officer_level: Mapped[str | None] = mapped_column(Text)
    current_officer_id: Mapped[str | None] = mapped_column(Text, ForeignKey("users.id"))
    last_escalated_at: Mapped[str | None] = mapped_column(Text)

    submitted_at: Mapped[str | None] = mapped_column(Text)
    submitted_by_user_id: Mapped[str | None] = mapped_column(Text, ForeignKey("users.id"))
    submit_otp_verification_id: Mapped[str | None] = mapped_column(
        Text, ForeignKey("user_verifications.id")
    )
    accepted_at: Mapped[str | None] = mapped_column(Text)
    rejected_at: Mapped[str | None] = mapped_column(Text)
    review_notes: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)
    deleted_at: Mapped[str | None] = mapped_column(Text)


class CalculationTrace(Base):
    __tablename__ = "calculation_traces"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=new_uuid)
    filing_id: Mapped[str] = mapped_column(
        Text, ForeignKey("tax_returns.id", ondelete="CASCADE"), nullable=False
    )
    regime: Mapped[str] = mapped_column(Text, nullable=False)
    trace_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    final_total: Mapped[float] = mapped_column(Numeric, nullable=False)
    rule_versions: Mapped[dict] = mapped_column(JSON, nullable=False)
    computed_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)
    computed_by_user_id: Mapped[str | None] = mapped_column(Text, ForeignKey("users.id"))
