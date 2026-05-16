from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, Integer, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models._types import (
    GUID,
    ISOTimestampType,
    consent_type_enum,
    new_uuid,
    user_role_enum,
    utcnow_iso,
    verification_channel_enum,
    verification_purpose_enum,
)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(GUID, primary_key=True, default=new_uuid)
    email: Mapped[str] = mapped_column(Text, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(user_role_enum, nullable=False)
    country: Mapped[str] = mapped_column(Text, nullable=False, default="IN")

    pan: Mapped[str | None] = mapped_column(Text)
    pan_verified_at: Mapped[str | None] = mapped_column(ISOTimestampType)

    phone: Mapped[str | None] = mapped_column(Text)
    email_verified_at: Mapped[str | None] = mapped_column(ISOTimestampType)
    phone_verified_at: Mapped[str | None] = mapped_column(ISOTimestampType)

    has_business_income: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    lifetime_switch_backs_to_new: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    active_tax_year: Mapped[str | None] = mapped_column(Text)

    jurisdiction: Mapped[str | None] = mapped_column(Text)
    city: Mapped[str | None] = mapped_column(Text)
    state: Mapped[str | None] = mapped_column(Text)
    pincode: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[str] = mapped_column(ISOTimestampType, nullable=False, default=utcnow_iso)
    updated_at: Mapped[str] = mapped_column(ISOTimestampType, nullable=False, default=utcnow_iso)
    deleted_at: Mapped[str | None] = mapped_column(ISOTimestampType)

    consents: Mapped[list["UserConsent"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    verifications: Mapped[list["UserVerification"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", foreign_keys="UserVerification.user_id"
    )
    ca_profile: Mapped["CAProfile | None"] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )


class UserConsent(Base):
    __tablename__ = "user_consents"

    user_id: Mapped[str] = mapped_column(
        GUID, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    consent_type: Mapped[str] = mapped_column(consent_type_enum, primary_key=True)
    granted: Mapped[bool] = mapped_column(Boolean, nullable=False)
    granted_at: Mapped[str | None] = mapped_column(ISOTimestampType)
    revoked_at: Mapped[str | None] = mapped_column(ISOTimestampType)
    updated_at: Mapped[str] = mapped_column(ISOTimestampType, nullable=False, default=utcnow_iso)

    user: Mapped[User] = relationship(back_populates="consents")


class UserVerification(Base):
    __tablename__ = "user_verifications"

    id: Mapped[str] = mapped_column(GUID, primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(
        GUID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    channel: Mapped[str] = mapped_column(verification_channel_enum, nullable=False)
    purpose: Mapped[str] = mapped_column(verification_purpose_enum, nullable=False)
    secret_hash: Mapped[str] = mapped_column(Text, nullable=False)
    destination: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[str] = mapped_column(ISOTimestampType, nullable=False)
    consumed_at: Mapped[str | None] = mapped_column(ISOTimestampType)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    filing_id: Mapped[str | None] = mapped_column(GUID, ForeignKey("tax_returns.id"))
    created_at: Mapped[str] = mapped_column(ISOTimestampType, nullable=False, default=utcnow_iso)

    user: Mapped[User] = relationship(back_populates="verifications", foreign_keys=[user_id])


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[str] = mapped_column(GUID, primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(
        GUID, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    issued_at: Mapped[str] = mapped_column(ISOTimestampType, nullable=False, default=utcnow_iso)
    expires_at: Mapped[str] = mapped_column(ISOTimestampType, nullable=False)
    revoked_at: Mapped[str | None] = mapped_column(ISOTimestampType)
    user_agent: Mapped[str | None] = mapped_column(Text)
    ip_address: Mapped[str | None] = mapped_column(Text)


class CAProfile(Base):
    __tablename__ = "ca_profiles"

    user_id: Mapped[str] = mapped_column(
        GUID, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    icai_membership: Mapped[str] = mapped_column(Text, nullable=False)
    bio: Mapped[str | None] = mapped_column(Text)
    specializations: Mapped[list | None] = mapped_column(JSON)
    years_experience: Mapped[int | None] = mapped_column(Integer)
    languages: Mapped[list | None] = mapped_column(JSON)
    fee_range_indicator: Mapped[str | None] = mapped_column(Text)
    photo_url: Mapped[str | None] = mapped_column(Text)

    listed_in_directory: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    accepting_clients: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    serves_cities: Mapped[list | None] = mapped_column(JSON)

    created_at: Mapped[str] = mapped_column(ISOTimestampType, nullable=False, default=utcnow_iso)
    updated_at: Mapped[str] = mapped_column(ISOTimestampType, nullable=False, default=utcnow_iso)

    user: Mapped[User] = relationship(back_populates="ca_profile")
