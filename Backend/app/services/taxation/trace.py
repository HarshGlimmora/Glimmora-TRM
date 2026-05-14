"""Calculation trace — the audit + explainability backbone.

Every op the engine performs emits one step. The trace doubles as:

  - regulatory audit evidence (officer review),
  - user-facing explanation (the "why" panel),
  - replay fixture for CI (replay must equal final_total to the paisa).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from app.services.taxation.money import Money, ZERO


@dataclass
class TraceStep:
    step: int
    op: str
    section_ref: str | None
    rule_id: str | None
    rule_version: int | None
    input: Any
    result: Money
    breakdown: list[dict] | None
    human_explanation: str
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        out: dict[str, Any] = {
            "step": self.step,
            "op": self.op,
            "input": _jsonable(self.input),
            "result": str(self.result),
            "human_explanation": self.human_explanation,
        }
        if self.section_ref is not None:
            out["section_ref"] = self.section_ref
        if self.rule_id is not None:
            out["rule_id"] = self.rule_id
        if self.rule_version is not None:
            out["rule_version"] = self.rule_version
        if self.breakdown is not None:
            out["breakdown"] = [_jsonable(b) for b in self.breakdown]
        if self.extra:
            out.update({k: _jsonable(v) for k, v in self.extra.items()})
        return out


class TraceBuilder:
    """Append-only builder. One per (filing, regime) calculation."""

    def __init__(self, filing_id: str, regime: str, statute: str, fy: str,
                 rule_versions: dict[str, int]):
        self.filing_id = filing_id
        self.regime = regime
        self.statute = statute
        self.fy = fy
        self.rule_versions = dict(rule_versions)
        self._steps: list[TraceStep] = []

    def step(
        self,
        op: str,
        *,
        input: Any,
        result: Money,
        human_explanation: str,
        section_ref: str | None = None,
        rule_id: str | None = None,
        rule_version: int | None = None,
        breakdown: list[dict] | None = None,
        **extra: Any,
    ) -> TraceStep:
        s = TraceStep(
            step=len(self._steps) + 1,
            op=op,
            section_ref=section_ref,
            rule_id=rule_id,
            rule_version=rule_version,
            input=input,
            result=result,
            breakdown=breakdown,
            human_explanation=human_explanation,
            extra=extra,
        )
        self._steps.append(s)
        return s

    @property
    def steps(self) -> list[TraceStep]:
        return list(self._steps)

    def final_total(self) -> Money:
        if not self._steps:
            return ZERO
        for s in reversed(self._steps):
            if s.op == "total":
                return s.result
        return self._steps[-1].result

    def to_dict(self) -> dict:
        return {
            "filing_id": self.filing_id,
            "regime": self.regime,
            "statute": self.statute,
            "fy": self.fy,
            "rule_versions": dict(self.rule_versions),
            "steps": [s.to_dict() for s in self._steps],
            "final_total": str(self.final_total()),
        }


def _jsonable(v: Any) -> Any:
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, dict):
        return {k: _jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_jsonable(x) for x in v]
    return v
