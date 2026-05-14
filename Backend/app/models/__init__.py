"""Public model exports.

Importing this package registers every mapped class against ``Base.metadata``, which is
useful for tests and for ``Base.metadata.create_all()`` as a fallback path. The
authoritative schema definition still lives in ``app/db/migrations/sql/*.sql``.
"""

from app.models.consultant import (
    ConsultantAccessGrant,
    ConsultantInviteCode,
    FilingChangeSet,
)
from app.models.cross import AuditLog, Notification
from app.models.documents import Document, PendingRouterInbox, Transaction
from app.models.filing import CalculationTrace, TaxReturn
from app.models.fraud import EnforcementAccess, FraudCase
from app.models.identity import (
    CAProfile,
    RefreshToken,
    User,
    UserConsent,
    UserVerification,
)
from app.models.rules import CountryRule, KnowledgeChunk, RAGQueryLog

__all__ = [
    "CAProfile",
    "CalculationTrace",
    "ConsultantAccessGrant",
    "ConsultantInviteCode",
    "CountryRule",
    "Document",
    "EnforcementAccess",
    "FilingChangeSet",
    "FraudCase",
    "KnowledgeChunk",
    "Notification",
    "PendingRouterInbox",
    "RAGQueryLog",
    "RefreshToken",
    "AuditLog",
    "TaxReturn",
    "Transaction",
    "User",
    "UserConsent",
    "UserVerification",
]
