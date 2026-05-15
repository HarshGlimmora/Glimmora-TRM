from __future__ import annotations

from sqlalchemy import ForeignKey, Integer, JSON, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models._types import new_uuid, utcnow_iso


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id"), nullable=False)
    filing_id: Mapped[str | None] = mapped_column(Text, ForeignKey("tax_returns.id"))
    tax_year: Mapped[str | None] = mapped_column(Text)

    document_type: Mapped[str] = mapped_column(Text, nullable=False)
    file_name: Mapped[str] = mapped_column(Text, nullable=False)
    storage_path: Mapped[str] = mapped_column(Text, nullable=False)
    mime_type: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="uploaded")

    routing_status: Mapped[str] = mapped_column(Text, nullable=False, default="pending")
    routing_report: Mapped[dict | None] = mapped_column(JSON)
    routed_at: Mapped[str | None] = mapped_column(Text)
    hint_tax_year: Mapped[str | None] = mapped_column(Text)

    extraction_started_at: Mapped[str | None] = mapped_column(Text)
    extraction_finished_at: Mapped[str | None] = mapped_column(Text)
    extraction_error: Mapped[str | None] = mapped_column(Text)
    extraction_payload: Mapped[dict | None] = mapped_column(JSON)

    created_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)
    deleted_at: Mapped[str | None] = mapped_column(Text)


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=new_uuid)
    filing_id: Mapped[str] = mapped_column(
        Text, ForeignKey("tax_returns.id", ondelete="CASCADE"), nullable=False
    )
    document_id: Mapped[str | None] = mapped_column(Text, ForeignKey("documents.id"))
    user_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id"), nullable=False)
    tax_year: Mapped[str] = mapped_column(Text, nullable=False)

    txn_date: Mapped[str] = mapped_column(Text, nullable=False)
    amount: Mapped[float] = mapped_column(Numeric, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    counterparty: Mapped[str | None] = mapped_column(Text)
    raw_payload: Mapped[dict | None] = mapped_column(JSON)

    category: Mapped[str | None] = mapped_column(Text)
    categorization_method: Mapped[str] = mapped_column(Text, nullable=False, default="rule")
    rule_matched: Mapped[str | None] = mapped_column(Text)
    confidence_score: Mapped[float | None] = mapped_column(Numeric)

    routing_method: Mapped[str] = mapped_column(Text, nullable=False, default="auto")
    routing_source_field: Mapped[str | None] = mapped_column(Text)
    routed_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)

    status: Mapped[str] = mapped_column(Text, nullable=False, default="unverified")
    verified_by_user_id: Mapped[str | None] = mapped_column(Text, ForeignKey("users.id"))
    verified_at: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)


class PendingRouterInbox(Base):
    __tablename__ = "pending_router_inbox"

    id: Mapped[str] = mapped_column(Text, primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(Text, ForeignKey("users.id"), nullable=False)
    document_id: Mapped[str | None] = mapped_column(Text, ForeignKey("documents.id"))

    raw_payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    suggested_tax_year: Mapped[str | None] = mapped_column(Text)

    resolved: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    resolved_tax_year: Mapped[str | None] = mapped_column(Text)
    resolved_at: Mapped[str | None] = mapped_column(Text)
    resolved_by_user_id: Mapped[str | None] = mapped_column(Text, ForeignKey("users.id"))
    resolution_action: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)
