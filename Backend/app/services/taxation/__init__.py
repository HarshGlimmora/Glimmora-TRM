"""Deterministic Indian income-tax engine.

Public entry point is `engine.compute_tax(db, filing_id, regime)`. Every other
module is an implementation detail.

Spec: Technical Docs/TAXATION_CALCULATION.md
"""

from app.services.taxation.engine import compute_tax
from app.services.taxation.rules import RuleNotFoundError

__all__ = ["compute_tax", "RuleNotFoundError"]
