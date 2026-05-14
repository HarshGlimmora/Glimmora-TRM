"""Python-side enum constants that mirror the CHECK-constrained TEXT columns in SQLite.

These are deliberately ``str`` enums so values serialize naturally via SQLAlchemy/Pydantic.
The DB does not know about Postgres enum *types* — only TEXT with CHECK constraints — so
these classes are the canonical source of allowed values for application code.
"""

from enum import StrEnum


class UserRole(StrEnum):
    taxpayer = "taxpayer"
    consultant = "consultant"
    officer_l1 = "officer_l1"
    officer_l2 = "officer_l2"
    officer_l3 = "officer_l3"
    officer_l4 = "officer_l4"
    officer_l5 = "officer_l5"
    judicial_officer = "judicial_officer"
    enforcement_agency = "enforcement_agency"
    admin = "admin"


class ConsentType(StrEnum):
    document_processing = "document_processing"
    ai_analysis = "ai_analysis"
    data_retention = "data_retention"


class VerificationChannel(StrEnum):
    email = "email"
    phone = "phone"


class VerificationPurpose(StrEnum):
    signup_email = "signup_email"
    signup_phone = "signup_phone"
    submit_phone = "submit_phone"
    password_reset = "password_reset"
    login_new_device = "login_new_device"


class FilingStatus(StrEnum):
    draft = "draft"
    in_review_by_ca = "in_review_by_ca"
    revision_returned = "revision_returned"
    revision_requested = "revision_requested"
    submitted = "submitted"
    accepted = "accepted"
    rejected = "rejected"


class Regime(StrEnum):
    old = "old"
    new = "new"


class DocumentType(StrEnum):
    form16 = "form16"
    bank_csv = "bank_csv"
    ais_tis = "ais_tis"
    form_26as = "form_26as"
    salary_slip = "salary_slip"


class DocumentStatus(StrEnum):
    uploaded = "uploaded"
    processing = "processing"
    completed = "completed"
    failed = "failed"


class RoutingStatus(StrEnum):
    pending = "pending"
    routed = "routed"
    partially_routed = "partially_routed"
    unresolved = "unresolved"
    overridden = "overridden"


class RouterMethod(StrEnum):
    auto = "auto"
    manual_override = "manual_override"


class RouterInboxReason(StrEnum):
    invalid_date = "invalid_date"
    terminal_fy_conflict = "terminal_fy_conflict"
    ambiguous_fy = "ambiguous_fy"
    routing_review_required = "routing_review_required"


class CategorizationMethod(StrEnum):
    rule = "rule"
    ai_assisted = "ai_assisted"
    manual = "manual"


class TransactionStatus(StrEnum):
    unverified = "unverified"
    verified = "verified"
    rejected = "rejected"


class ConsultantAccessMode(StrEnum):
    full_access = "full_access"
    review_edit = "review_edit"


class GrantOrigin(StrEnum):
    directory_request = "directory_request"
    invite_code = "invite_code"


class ConsultantGrantStatus(StrEnum):
    pending = "pending"
    active = "active"
    rejected = "rejected"
    revoked = "revoked"
    expired = "expired"


class InviteCodeStatus(StrEnum):
    active = "active"
    exhausted = "exhausted"
    revoked = "revoked"
    expired = "expired"


class FraudCaseStatus(StrEnum):
    flagged = "flagged"
    judicial_review = "judicial_review"
    enforcement_assigned = "enforcement_assigned"
    closed = "closed"


class FraudFlagReason(StrEnum):
    income_mismatch = "income_mismatch"
    undisclosed_income = "undisclosed_income"
    fabricated_deduction = "fabricated_deduction"
    other = "other"


class JudicialDecision(StrEnum):
    dismiss = "dismiss"
    assigned_to_enforcement = "assigned_to_enforcement"


class EnforcementOutcome(StrEnum):
    tax_liability_confirmed = "tax_liability_confirmed"
    no_fraud_found = "no_fraud_found"
    partial_findings = "partial_findings"
    escalated_externally = "escalated_externally"


class RuleStatus(StrEnum):
    pending_approval = "pending_approval"
    active = "active"
    superseded = "superseded"
    rejected = "rejected"
