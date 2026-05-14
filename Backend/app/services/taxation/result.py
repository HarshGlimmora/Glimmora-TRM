"""Result dataclasses shared across head pipelines and the engine."""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Literal

from app.services.taxation.money import Money, ZERO

ResidencyStatus = Literal["resident", "non_resident", "rn_or"]
SeniorStatus = Literal["<60", "60-79", "80+"]


@dataclass
class FlatRateBucket:
    """A bucket of income taxed at a flat (special) rate, bypassing slabs.

    Examples: §111A STCG @ 20%; §112A LTCG @ 12.5% above ₹1.25L; §115BB lottery @ 30%.
    """
    section: str                              # logical symbol — "stcg_111a", "ltcg_112a", ...
    taxable_amount: Money                     # amount in this bucket BEFORE any exemption
    rate: Decimal                             # tax rate as a Decimal fraction, e.g. 0.125
    threshold: Money = ZERO                   # exempt-below threshold (e.g. ₹1.25L on §112A)
    surcharge_cap: Decimal | None = None      # cap on surcharge rate for this bucket (e.g. 0.15)
    label: str = ""                           # human label, e.g. "LTCG on listed equity"


@dataclass
class HeadResult:
    """Output of a head pipeline."""
    head: str                                 # "salary" | "house_property" | ...
    slab_taxable: Money = ZERO                # part that flows into GTI for slab tax
    flat_rate_buckets: list[FlatRateBucket] = field(default_factory=list)

    @property
    def flat_total_income(self) -> Money:
        from app.services.taxation.money import quantize
        total = ZERO
        for b in self.flat_rate_buckets:
            total = quantize(total + b.taxable_amount)
        return total
