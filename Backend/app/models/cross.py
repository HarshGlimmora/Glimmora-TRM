from __future__ import annotations

from sqlalchemy import ForeignKey, Integer, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models._types import GUID, ISOTimestampType, new_uuid, notification_type_enum, utcnow_iso


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(GUID, primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(
        GUID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[str] = mapped_column(notification_type_enum, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    body: Mapped[str | None] = mapped_column(Text)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    read_at: Mapped[str | None] = mapped_column(ISOTimestampType)
    created_at: Mapped[str] = mapped_column(ISOTimestampType, nullable=False, default=utcnow_iso)


class AuditLog(Base):
    """Append-only. Postgres triggers in 0001_initial.sql block UPDATE/DELETE."""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor_user_id: Mapped[str | None] = mapped_column(GUID, ForeignKey("users.id"))
    actor_role: Mapped[str | None] = mapped_column(Text)
    action: Mapped[str] = mapped_column(Text, nullable=False)
    entity_type: Mapped[str | None] = mapped_column(Text)
    entity_id: Mapped[str | None] = mapped_column(GUID)
    fraud_case_id: Mapped[str | None] = mapped_column(GUID, ForeignKey("fraud_cases.id"))
    tax_year: Mapped[str | None] = mapped_column(Text)

    before_state: Mapped[dict | None] = mapped_column(JSON)
    after_state: Mapped[dict | None] = mapped_column(JSON)
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, nullable=False, default=dict)

    occurred_at: Mapped[str] = mapped_column(ISOTimestampType, nullable=False, default=utcnow_iso)
