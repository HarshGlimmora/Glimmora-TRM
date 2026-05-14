"""Pydantic schemas for the taxation API."""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field


class HousePropertyDeclaration(BaseModel):
    label: str | None = None
    occupancy: Literal["self_occupied", "let_out", "deemed_let_out"] = "self_occupied"
    gross_annual_value: Decimal = Decimal("0")
    municipal_taxes:     Decimal = Decimal("0")
    interest_paid:       Decimal = Decimal("0")   # §24(b) interest on borrowed capital


class CalculateRequest(BaseModel):
    regime: Literal["old", "new", "both"] = "both"
    acknowledged_regime_switch: bool = False

    # Overrides used when User row lacks fields (MVP: residency / DOB columns deferred).
    residency_override: Literal["resident", "non_resident", "rn_or"] | None = None
    senior_override:    Literal["<60", "60-79", "80+"] | None = None

    # Optional inline declarations — these are also persistable to
    # `tax_returns.summary_json` ahead of time and read from there.
    declared_house_property: list[HousePropertyDeclaration] | None = None
    declared_deductions:     dict[str, Decimal] | None = Field(
        default=None,
        description="Chapter VI-A declarations: {'80c': 150000, '80d': 25000, ...}",
    )


class RegimeResult(BaseModel):
    regime: Literal["old", "new"]
    fy: str
    statute: str
    gross_total_income: Decimal
    deductions: Decimal
    taxable_income: Decimal
    slab_tax: Decimal
    rebate_87a: Decimal
    flat_rate_tax: Decimal
    surcharge: Decimal
    cess: Decimal
    total_tax: Decimal
    tds_paid: Decimal
    balance_payable: Decimal
    trace_id: str | None
    trace: dict[str, Any] = Field(
        description="Step-by-step explanation with section refs and human_explanation per step."
    )


class CalculateResponse(BaseModel):
    filing_id: str
    fy: str
    statute: str
    regimes_computed: list[Literal["old", "new"]]
    old_regime: RegimeResult | None = None
    new_regime: RegimeResult | None = None
    recommended_regime: Literal["old", "new"] | None = None
    savings: Decimal | None = Field(
        default=None,
        description="Tax savings by choosing the recommended regime vs the other.",
    )
