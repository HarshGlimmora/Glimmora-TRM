"""Shared column helpers for the Postgres schema.

* ``new_uuid()`` produces a canonical 36-char UUID4 string — the default
  for primary-key columns. Models keep a Python ``str`` surface (rather
  than ``uuid.UUID``) to match every call site that passes IDs through
  as strings (JWT claims, JSON bodies, repo queries).
* ``utcnow_iso()`` produces a UTC ISO-8601 string with millisecond
  precision, matching the SQL DEFAULT in the migrations.
* ``GUID`` is the column type for every UUID id/foreign key. On Postgres
  it compiles to native ``UUID`` and binds parameters as ``::uuid`` so
  psycopg's default ``::VARCHAR`` cast doesn't trigger
  ``operator does not exist: uuid = character varying``.
* The ``*_enum`` instances mirror the ``CREATE TYPE`` blocks in
  ``0001_initial.sql``. We declare them once and reuse so SQLAlchemy
  binds enum parameters with the right Postgres type (``::user_role``,
  ``::filing_status``, …) instead of psycopg's default ``::VARCHAR``,
  which Postgres refuses to compare against a custom enum.
  ``create_type=False`` keeps SQLAlchemy from re-issuing CREATE TYPE
  at boot — the migration owns the schema.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from datetime import date

from sqlalchemy import Date, Uuid
from sqlalchemy.dialects.postgresql import ENUM, TIMESTAMP
from sqlalchemy.types import TypeDecorator

GUID = Uuid(as_uuid=False)


def new_uuid() -> str:
    return str(uuid.uuid4())


def _format_iso(dt: datetime) -> str:
    dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def utcnow_iso() -> str:
    return _format_iso(datetime.now(timezone.utc))


class ISOTimestamp(TypeDecorator):
    """Postgres ``TIMESTAMPTZ`` column with an ISO-8601 string API surface.

    The repo's models predate the Postgres switch — every ``*_at`` column
    was declared ``Text`` and the application passed/received ISO-8601
    strings. Postgres ``TIMESTAMPTZ`` rejects parameters bound as
    ``::VARCHAR`` (``column ... is of type timestamp with time zone but
    expression is of type character varying``), so we use this decorator
    to convert string ↔ ``datetime`` at the bind/result boundary while
    leaving every caller's ``str`` API unchanged.
    """

    impl = TIMESTAMP(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: Any, dialect: Any) -> datetime | None:  # noqa: ARG002
        if value is None:
            return None
        if isinstance(value, datetime):
            return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        s = str(value)
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt

    def process_result_value(self, value: Any, dialect: Any) -> str | None:  # noqa: ARG002
        if value is None:
            return None
        if isinstance(value, datetime):
            return _format_iso(value)
        return str(value)


ISOTimestampType = ISOTimestamp()


class ISODate(TypeDecorator):
    """Postgres ``DATE`` column with an ISO-8601 (``YYYY-MM-DD``) string API.

    Same motivation as :class:`ISOTimestamp`: every call site passes/expects
    plain strings (seed files, JSON bodies, transaction CSV rows) but the
    Postgres columns are typed ``DATE``. Without this, psycopg binds
    ``str`` as ``::VARCHAR`` and Postgres rejects the comparison/INSERT
    with ``column "effective_from" is of type date but expression is of
    type character varying``.
    """

    impl = Date()
    cache_ok = True

    def process_bind_param(self, value: Any, dialect: Any) -> date | None:  # noqa: ARG002
        if value is None:
            return None
        if isinstance(value, date):
            return value
        return date.fromisoformat(str(value))

    def process_result_value(self, value: Any, dialect: Any) -> str | None:  # noqa: ARG002
        if value is None:
            return None
        if isinstance(value, date):
            return value.isoformat()
        return str(value)


ISODateType = ISODate()


def _pg_enum(name: str, *values: str) -> ENUM:
    return ENUM(*values, name=name, create_type=False, validate_strings=False)


user_role_enum = _pg_enum(
    "user_role",
    "taxpayer", "consultant",
    "officer_l1", "officer_l2", "officer_l3", "officer_l4", "officer_l5",
    "judicial_officer", "enforcement_agency", "admin",
)
consent_type_enum = _pg_enum(
    "consent_type", "document_processing", "ai_analysis", "data_retention",
)
verification_channel_enum = _pg_enum("verification_channel", "email", "phone")
verification_purpose_enum = _pg_enum(
    "verification_purpose",
    "signup_email", "signup_phone", "submit_phone",
    "password_reset", "login_new_device",
)
filing_status_enum = _pg_enum(
    "filing_status",
    "draft", "in_review_by_ca", "revision_returned", "revision_requested",
    "submitted", "accepted", "rejected",
)
regime_enum = _pg_enum("regime", "old", "new")
document_type_enum = _pg_enum(
    "document_type",
    # From 0001_initial.sql
    "form16", "bank_csv", "ais_tis", "form_26as", "salary_slip",
    # Added by later migrations (0002–0004) and used by the routing pipeline
    # when it can't pin a PDF to a more specific type yet.
    "bank_pdf", "unknown_pdf", "capital_gains_statement", "broker_pnl",
)
document_status_enum = _pg_enum(
    "document_status", "uploaded", "processing", "completed", "failed",
)
routing_status_enum = _pg_enum(
    "routing_status", "pending", "routed", "partially_routed", "unresolved", "overridden",
)
router_method_enum = _pg_enum("router_method", "auto", "manual_override")
router_inbox_reason_enum = _pg_enum(
    "router_inbox_reason",
    "invalid_date", "terminal_fy_conflict", "ambiguous_fy", "routing_review_required",
)
categorization_method_enum = _pg_enum(
    "categorization_method", "rule", "ai_assisted", "manual",
)
transaction_status_enum = _pg_enum(
    "transaction_status", "unverified", "verified", "rejected",
)
consultant_access_mode_enum = _pg_enum(
    "consultant_access_mode", "full_access", "review_edit",
)
grant_origin_enum = _pg_enum("grant_origin", "directory_request", "invite_code")
consultant_grant_status_enum = _pg_enum(
    "consultant_grant_status", "pending", "active", "rejected", "revoked", "expired",
)
invite_code_status_enum = _pg_enum(
    "invite_code_status", "active", "exhausted", "revoked", "expired",
)
fraud_case_status_enum = _pg_enum(
    "fraud_case_status", "flagged", "judicial_review", "enforcement_assigned", "closed",
)
fraud_flag_reason_enum = _pg_enum(
    "fraud_flag_reason",
    "income_mismatch", "undisclosed_income", "fabricated_deduction", "other",
)
judicial_decision_enum = _pg_enum(
    "judicial_decision", "dismiss", "assigned_to_enforcement",
)
enforcement_outcome_enum = _pg_enum(
    "enforcement_outcome",
    "tax_liability_confirmed", "no_fraud_found",
    "partial_findings", "escalated_externally",
)
rule_status_enum = _pg_enum(
    "rule_status", "pending_approval", "active", "superseded", "rejected",
)
notification_type_enum = _pg_enum(
    "notification_type",
    "account_email_verified", "account_phone_verified", "account_password_changed",
    "account_login_new_device", "account_pan_verified", "account_consent_changed",
    "filing_draft_created", "new_tax_year_available", "filing_submitted_ack",
    "filing_review_complete", "regime_warning", "filing_under_officer_review",
    "filing_escalated_to_l2", "filing_escalated_to_l3", "filing_escalated_to_l4",
    "filing_escalated_to_l5", "filing_revision_requested", "filing_mismatch_detected",
    "consultant_access_request_accepted", "consultant_access_request_declined",
    "consultant_returned_filing", "consultant_submitted_filing",
    "consultant_access_request", "consultant_invite_code_used",
    "consultant_access_revoked", "consultant_client_filing_updated",
    "consultant_rule_change_impact", "officer_filing_assigned",
    "officer_sla_breach_warning", "officer_case_escalated_in",
    "fraud_case_assigned", "fraud_case_renewal_requested",
    "enforcement_access_granted", "enforcement_access_expiring_soon",
    "enforcement_access_expired",
    "admin_rule_pending_second_approval", "admin_system_health_alert",
)
