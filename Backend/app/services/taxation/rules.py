"""Rule resolution.

Per ARCHITECTURE.md §5.2 — for `(country, tax_year, rule_type)` find the active
rule. Multiple matches: highest `version` wins. Zero matches: bundled defaults
fall back (development) with a logged warning; production should run
`scripts.seed_taxation_rules` to populate the table.

Each resolved rule carries the *statute* it belongs to. Statute is derived from
the FY (FY ≥ 2026-27 → ITA2025; otherwise ITA1961), shared by every rule in a
resolver instance.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.rules import CountryRule
from app.services.taxation.defaults import bundled_rules_for
from app.services.taxation.statute import Statute, resolve_statute

logger = logging.getLogger("glimmora.taxation.rules")


class RuleNotFoundError(LookupError):
    """Raised when no DB rule and no bundled default exists for a (FY, type)."""


@dataclass(frozen=True)
class ResolvedRule:
    rule_id: str | None        # None when sourced from bundled defaults
    version: int
    rule_json: dict
    section_ref: str
    source_reference: str
    source: str                # "db" | "bundled"
    statute: Statute = "ITA1961"


class RuleResolver:
    """Per-request resolver. Cached lookups so each rule is loaded at most once.

    Statute is inferred from the FY; every resolved rule is tagged with it so
    the trace can faithfully record which statute the computation was made under.
    """

    def __init__(self, db: Session, country: str, tax_year: str):
        self.db = db
        self.country = country
        self.tax_year = tax_year
        self.statute: Statute = resolve_statute(tax_year)
        self._cache: dict[tuple[str, str, str, Statute], ResolvedRule] = {}
        self._bundled = bundled_rules_for(tax_year)

    def _cache_key(self, rule_type: str) -> tuple[str, str, str, Statute]:
        return (self.country, self.tax_year, rule_type, self.statute)

    def get(self, rule_type: str) -> ResolvedRule:
        key = self._cache_key(rule_type)
        if key in self._cache:
            return self._cache[key]

        row = (
            self.db.execute(
                select(CountryRule)
                .where(CountryRule.country == self.country)
                .where(CountryRule.tax_year == self.tax_year)
                .where(CountryRule.rule_type == rule_type)
                .where(CountryRule.status == "active")
                .order_by(CountryRule.version.desc())
            )
            .scalars()
            .first()
        )

        if row is not None:
            resolved = ResolvedRule(
                rule_id=row.id,
                version=row.version,
                rule_json=row.rule_json,
                section_ref=(
                    str(row.rule_json.get("section_ref", ""))
                    or _bundled_section(self._bundled, rule_type)
                ),
                source_reference=row.source_reference,
                source="db",
                statute=self.statute,
            )
            self._cache[key] = resolved
            return resolved

        if self._bundled and rule_type in self._bundled:
            bundled = self._bundled[rule_type]
            logger.warning(
                "rule_type=%s missing in country_rules for %s/%s/%s — using bundled default. "
                "Run `python -m scripts.seed_taxation_rules` to seed.",
                rule_type, self.country, self.tax_year, self.statute,
            )
            resolved = ResolvedRule(
                rule_id=None,
                version=0,
                rule_json=bundled["rule_json"],
                section_ref=bundled["section_ref"],
                source_reference=bundled["source_reference"],
                source="bundled",
                statute=self.statute,
            )
            self._cache[key] = resolved
            return resolved

        raise RuleNotFoundError(
            f"No active rule for country={self.country} tax_year={self.tax_year} "
            f"statute={self.statute} rule_type={rule_type}. Seed via the admin "
            f"rules console or extend bundled defaults."
        )

    def versions(self) -> dict[str, dict]:
        """Snapshot of every rule consulted — pinned onto the trace.

        Returns a dict of {rule_type: {version, statute, source, rule_id}} so the
        replay verifier knows exactly which rule binding produced each step.
        """
        return {
            rt: {
                "version":  v.version,
                "statute":  v.statute,
                "source":   v.source,
                "rule_id":  v.rule_id,
            }
            for (_country, _fy, rt, _st), v in self._cache.items()
        }


def _bundled_section(bundled: dict[str, Any] | None, rule_type: str) -> str:
    if not bundled or rule_type not in bundled:
        return ""
    return bundled[rule_type].get("section_ref", "")
