from __future__ import annotations

from sqlalchemy import ForeignKey, Integer, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models._types import (
    GUID,
    ISOTimestampType,
    consultant_access_mode_enum,
    consultant_grant_status_enum,
    grant_origin_enum,
    invite_code_status_enum,
    new_uuid,
    utcnow_iso,
)


class ConsultantInviteCode(Base):
    __tablename__ = "consultant_invite_codes"

    id: Mapped[str] = mapped_column(GUID, primary_key=True, default=new_uuid)
    consultant_id: Mapped[str] = mapped_column(GUID, ForeignKey("users.id"), nullable=False)
    code: Mapped[str] = mapped_column(Text, nullable=False)
    code_hash: Mapped[str] = mapped_column(Text, nullable=False)
    label: Mapped[str | None] = mapped_column(Text)
    max_uses: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    used_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(invite_code_status_enum, nullable=False, default="active")
    default_access_mode: Mapped[str | None] = mapped_column(consultant_access_mode_enum)
    allowed_tax_years: Mapped[list[str] | None] = mapped_column(JSON)
    expires_at: Mapped[str] = mapped_column(ISOTimestampType, nullable=False)
    revoked_at: Mapped[str | None] = mapped_column(ISOTimestampType)
    created_at: Mapped[str] = mapped_column(ISOTimestampType, nullable=False, default=utcnow_iso)


class ConsultantAccessGrant(Base):
    __tablename__ = "consultant_access_grants"

    id: Mapped[str] = mapped_column(GUID, primary_key=True, default=new_uuid)
    consultant_id: Mapped[str] = mapped_column(GUID, ForeignKey("users.id"), nullable=False)
    target_user_id: Mapped[str] = mapped_column(GUID, ForeignKey("users.id"), nullable=False)

    origin: Mapped[str] = mapped_column(grant_origin_enum, nullable=False)
    invite_code_id: Mapped[str | None] = mapped_column(
        GUID, ForeignKey("consultant_invite_codes.id")
    )

    access_mode: Mapped[str] = mapped_column(consultant_access_mode_enum, nullable=False)
    status: Mapped[str] = mapped_column(consultant_grant_status_enum, nullable=False)

    tax_years: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    message: Mapped[str | None] = mapped_column(Text)

    requested_at: Mapped[str] = mapped_column(ISOTimestampType, nullable=False, default=utcnow_iso)
    decided_at: Mapped[str | None] = mapped_column(ISOTimestampType)
    revoked_at: Mapped[str | None] = mapped_column(ISOTimestampType)
    expires_at: Mapped[str] = mapped_column(ISOTimestampType, nullable=False)
    created_at: Mapped[str] = mapped_column(ISOTimestampType, nullable=False, default=utcnow_iso)


class FilingChangeSet(Base):
    __tablename__ = "filing_change_sets"

    id: Mapped[str] = mapped_column(GUID, primary_key=True, default=new_uuid)
    filing_id: Mapped[str] = mapped_column(
        GUID, ForeignKey("tax_returns.id", ondelete="CASCADE"), nullable=False
    )
    grant_id: Mapped[str] = mapped_column(
        GUID, ForeignKey("consultant_access_grants.id"), nullable=False
    )
    consultant_id: Mapped[str] = mapped_column(GUID, ForeignKey("users.id"), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    changes: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[str] = mapped_column(ISOTimestampType, nullable=False, default=utcnow_iso)
    accepted_at: Mapped[str | None] = mapped_column(ISOTimestampType)
    rejected_at: Mapped[str | None] = mapped_column(ISOTimestampType)
    decided_by_user_id: Mapped[str | None] = mapped_column(GUID, ForeignKey("users.id"))
