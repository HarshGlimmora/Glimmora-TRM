"""Deterministic rule-based categorization for CSV transactions.

Rules live in `country_rules` rows with `rule_type='csv_categorization'` and
the rule list under `rule_json.rules`. Highest-priority match wins. No match →
`category=None` and `categorization_method='unmatched'`. The UI surfaces those
rows as "needs category".

Per FILING_FLOW.md §5, this engine is purely deterministic — no AI in the loop
on CSV rows. AI categorization is reserved for PDF extraction (Step 3+).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal
from functools import lru_cache
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.rules import CountryRule


@dataclass(frozen=True)
class CompiledRule:
    id: str
    label: str
    priority: int
    direction: str | None       # 'debit' | 'credit' | None (either)
    pattern: re.Pattern[str] | None
    keywords: tuple[str, ...]
    amount_min: Decimal | None
    amount_max: Decimal | None
    category: str
    head: str | None


@dataclass(frozen=True)
class RuleMatch:
    rule_id: str
    category: str
    head: str | None


# Cached compile of the rule list. Invalidated when the rule_json version (the
# DB row's `version` column) changes — see `load_rules_for_fy`.
_compiled_cache: dict[tuple[str, str, int], list[CompiledRule]] = {}


def load_rules_for_fy(db: Session, *, country: str, tax_year: str) -> list[CompiledRule]:
    """Pull the active `csv_categorization` rule for (country, tax_year) and
    compile it. Falls back to the most recent rule in the same country if no
    active rule exists for the requested FY — keeps Step 2 working without a
    per-FY reseed every year.
    """
    stmt = (
        select(CountryRule)
        .where(
            CountryRule.country == country,
            CountryRule.rule_type == "csv_categorization",
            CountryRule.status == "active",
        )
        .order_by(CountryRule.tax_year.desc(), CountryRule.version.desc())
    )
    rows = db.execute(stmt).scalars().all()
    if not rows:
        return []

    chosen = next((r for r in rows if r.tax_year == tax_year), rows[0])
    cache_key = (country, chosen.tax_year, chosen.version)
    cached = _compiled_cache.get(cache_key)
    if cached is not None:
        return cached
    compiled = _compile(chosen.rule_json)
    _compiled_cache[cache_key] = compiled
    return compiled


def categorize(
    *,
    rules: Iterable[CompiledRule],
    direction: str,
    description: str,
    amount: Decimal,
) -> RuleMatch | None:
    """Apply the rule list in descending priority. Returns the first match
    (which, since rules is pre-sorted, is the highest-priority match).
    """
    # `rules` is already sorted descending by priority when produced by
    # `_compile`; iterating is enough.
    abs_amount = abs(amount)
    for rule in rules:
        if rule.direction is not None and rule.direction != direction:
            continue
        if rule.amount_min is not None and abs_amount < rule.amount_min:
            continue
        if rule.amount_max is not None and abs_amount > rule.amount_max:
            continue
        text = description or ""
        if rule.pattern is not None and rule.pattern.search(text):
            return RuleMatch(rule_id=rule.id, category=rule.category, head=rule.head)
        if rule.keywords:
            upper = text.upper()
            if any(kw in upper for kw in rule.keywords):
                return RuleMatch(rule_id=rule.id, category=rule.category, head=rule.head)
    return None


def _compile(rule_json: dict) -> list[CompiledRule]:
    items = rule_json.get("rules") or []
    out: list[CompiledRule] = []
    for r in items:
        pattern = None
        if r.get("pattern_regex"):
            try:
                pattern = re.compile(r["pattern_regex"])
            except re.error:
                pattern = None
        keywords = tuple((k or "").upper() for k in (r.get("keyword_any") or []) if k)
        out.append(
            CompiledRule(
                id=str(r["id"]),
                label=str(r.get("label", r["id"])),
                priority=int(r.get("priority", 0)),
                direction=r.get("txn_direction"),
                pattern=pattern,
                keywords=keywords,
                amount_min=_to_decimal(r.get("amount_min")),
                amount_max=_to_decimal(r.get("amount_max")),
                category=str(r["category"]),
                head=r.get("head"),
            )
        )
    out.sort(key=lambda c: c.priority, reverse=True)
    return out


def _to_decimal(v: object) -> Decimal | None:
    if v is None or v == "":
        return None
    try:
        return Decimal(str(v))
    except Exception:
        return None


@lru_cache(maxsize=1)
def _seed_path():
    from app.config import BACKEND_ROOT
    return BACKEND_ROOT / "data" / "seed" / "category_rules.json"


def load_seed_payload() -> dict:
    """Read the seed JSON shipped at Backend/data/seed/category_rules.json."""
    import json

    path = _seed_path()
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)
