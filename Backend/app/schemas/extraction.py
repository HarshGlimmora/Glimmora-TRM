"""Strict Pydantic schemas for Vertex AI Gemini extractions.

The model is constrained via `response_schema` to return JSON matching these
shapes. Every field is Optional so the model can return null when something
isn't visible — the spec is "never infer, never guess, never fill". Validation
on our end refuses unknown keys (`model_config = ConfigDict(extra='forbid')`).
"""

from __future__ import annotations

from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Shared sub-schemas
# ---------------------------------------------------------------------------

class _Strict(BaseModel):
    """Base: any unexpected key surfaces a validation error rather than silently
    becoming part of the persisted payload."""
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Employer(_Strict):
    name: Optional[str] = None
    tan: Optional[str] = None
    pan: Optional[str] = None
    address: Optional[str] = None


class Employee(_Strict):
    name: Optional[str] = None
    pan: Optional[str] = None
    designation: Optional[str] = None
    employee_id: Optional[str] = None
    department: Optional[str] = None


class Period(_Strict):
    from_date: Optional[str] = None  # ISO YYYY-MM-DD
    to_date: Optional[str] = None


class NamedAmount(_Strict):
    name: str
    amount: Optional[Decimal] = None


class SectionAmount(_Strict):
    section: str            # "80C", "80D", ...
    amount: Optional[Decimal] = None


class TdsQuarter(_Strict):
    quarter: Optional[str] = None
    receipt_number: Optional[str] = None
    amount_paid: Optional[Decimal] = None
    tds_deducted: Optional[Decimal] = None
    deposit_date: Optional[str] = None


# ---------------------------------------------------------------------------
# Form 16
# ---------------------------------------------------------------------------

class SalaryBreakdown(_Strict):
    gross_salary: Optional[Decimal] = None
    section_17_1_salary: Optional[Decimal] = None
    section_17_2_perquisites: Optional[Decimal] = None
    section_17_3_profits_in_lieu: Optional[Decimal] = None
    exempt_allowances: list[NamedAmount] = Field(default_factory=list)
    standard_deduction: Optional[Decimal] = None
    professional_tax: Optional[Decimal] = None
    net_salary: Optional[Decimal] = None


class Form16Extraction(_Strict):
    employer: Optional[Employer] = None
    employee: Optional[Employee] = None
    assessment_year: Optional[str] = None    # AY####-##
    financial_year: Optional[str] = None     # FY####-##
    period: Optional[Period] = None
    salary_breakdown: Optional[SalaryBreakdown] = None
    chapter_via_deductions: list[SectionAmount] = Field(default_factory=list)
    tds_quarterly: list[TdsQuarter] = Field(default_factory=list)
    total_tds_deducted: Optional[Decimal] = None


# ---------------------------------------------------------------------------
# Form 26AS
# ---------------------------------------------------------------------------

class Form26ASTxn(_Strict):
    booking_date: Optional[str] = None
    date_of_credit: Optional[str] = None
    amount_paid: Optional[Decimal] = None
    tax_deducted: Optional[Decimal] = None
    tax_deposited: Optional[Decimal] = None
    status: Optional[str] = None


class Form26ASDeductorBlock(_Strict):
    deductor_name: Optional[str] = None
    deductor_tan: Optional[str] = None
    total_amount_paid: Optional[Decimal] = None
    total_tax_deducted: Optional[Decimal] = None
    total_tax_deposited: Optional[Decimal] = None
    transactions: list[Form26ASTxn] = Field(default_factory=list)


class ChallanRow(_Strict):
    bsr_code: Optional[str] = None
    date_of_deposit: Optional[str] = None
    challan_serial_number: Optional[str] = None
    total_tax_paid: Optional[Decimal] = None


class Form26ASExtraction(_Strict):
    assessment_year: Optional[str] = None
    permanent_account_number: Optional[str] = None
    name_of_assessee: Optional[str] = None
    part_a_tds_on_salary: list[Form26ASDeductorBlock] = Field(default_factory=list)
    part_a1_tds_other_than_salary: list[Form26ASDeductorBlock] = Field(default_factory=list)
    part_b_details_of_tax_deducted_at_source_for_15g_15h: Optional[dict] = None
    part_c_details_of_tax_paid_other_than_tds_or_tcs: list[ChallanRow] = Field(default_factory=list)
    part_d_details_of_refund: Optional[dict] = None
    part_e_high_value_transactions: Optional[dict] = None
    grand_total_tds: Optional[Decimal] = None


# ---------------------------------------------------------------------------
# AIS / TIS
# ---------------------------------------------------------------------------

class AisInformationRow(_Strict):
    information_code: Optional[str] = None
    information_description: Optional[str] = None
    information_source: Optional[str] = None
    amount_reported: Optional[Decimal] = None
    date_or_period: Optional[str] = None
    status: Optional[str] = None


class AisExtraction(_Strict):
    pan: Optional[str] = None
    financial_year: Optional[str] = None
    reported_information: list[AisInformationRow] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Salary slip
# ---------------------------------------------------------------------------

class PayPeriod(_Strict):
    month: Optional[str] = None
    year: Optional[int] = None
    from_date: Optional[str] = None
    to_date: Optional[str] = None


class SalarySlipExtraction(_Strict):
    employee: Optional[Employee] = None
    employer: Optional[Employer] = None
    pay_period: Optional[PayPeriod] = None
    earnings: list[NamedAmount] = Field(default_factory=list)
    deductions: list[NamedAmount] = Field(default_factory=list)
    gross_earnings_total: Optional[Decimal] = None
    total_deductions: Optional[Decimal] = None
    net_pay: Optional[Decimal] = None
    bank_account_credited: Optional[str] = None


# ---------------------------------------------------------------------------
# Bank statement PDF
# ---------------------------------------------------------------------------

class BankTxn(_Strict):
    txn_date: Optional[str] = None
    value_date: Optional[str] = None
    description: Optional[str] = None
    cheque_or_ref_number: Optional[str] = None
    debit_amount: Optional[Decimal] = None
    credit_amount: Optional[Decimal] = None
    balance_after: Optional[Decimal] = None
    counterparty_hint: Optional[str] = None


class BankPdfExtraction(_Strict):
    account_holder_name: Optional[str] = None
    account_number_masked: Optional[str] = None
    bank_name: Optional[str] = None
    branch: Optional[str] = None
    statement_period: Optional[Period] = None
    opening_balance: Optional[Decimal] = None
    closing_balance: Optional[Decimal] = None
    transactions: list[BankTxn] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Capital-gains statement (broker / portfolio P&L export)
#
# Matches the Schedule CG structure of ITR-2/3: STCG u/s 111A, LTCG u/s 112A,
# mutual fund redemptions (mixed-period), intraday (speculative business),
# F&O (non-speculative business), dividends (other sources).
# ---------------------------------------------------------------------------

class EquityTradeRow(_Strict):
    symbol: Optional[str] = None
    isin: Optional[str] = None
    quantity: Optional[Decimal] = None
    buy_date: Optional[str] = None        # ISO YYYY-MM-DD
    buy_price: Optional[Decimal] = None
    buy_value: Optional[Decimal] = None
    sell_date: Optional[str] = None
    sell_price: Optional[Decimal] = None
    sell_value: Optional[Decimal] = None
    realised_pnl: Optional[Decimal] = None
    holding_days: Optional[int] = None


class MutualFundRedemption(_Strict):
    scheme_name: Optional[str] = None
    folio_no: Optional[str] = None
    units: Optional[Decimal] = None
    buy_date: Optional[str] = None
    buy_nav: Optional[Decimal] = None
    buy_value: Optional[Decimal] = None
    sell_date: Optional[str] = None
    sell_nav: Optional[Decimal] = None
    sell_value: Optional[Decimal] = None
    realised_pnl: Optional[Decimal] = None
    holding_days: Optional[int] = None
    tax_treatment: Optional[str] = None   # "LTCG u/s 112A" / "STCG u/s 111A" / "STCG at slab"


class IntradayTradeRow(_Strict):
    symbol: Optional[str] = None
    trade_date: Optional[str] = None
    buy_qty: Optional[Decimal] = None
    buy_price: Optional[Decimal] = None
    sell_qty: Optional[Decimal] = None
    sell_price: Optional[Decimal] = None
    realised_pnl: Optional[Decimal] = None


class FnoTradeRow(_Strict):
    instrument: Optional[str] = None
    trade_date: Optional[str] = None
    lot_size: Optional[int] = None
    premium_paid: Optional[Decimal] = None
    premium_received: Optional[Decimal] = None
    realised_pnl: Optional[Decimal] = None


class DividendRow(_Strict):
    symbol: Optional[str] = None
    date: Optional[str] = None
    dividend_per_share: Optional[Decimal] = None
    quantity_held: Optional[Decimal] = None
    gross_dividend: Optional[Decimal] = None
    tds_194: Optional[Decimal] = None
    net_credit: Optional[Decimal] = None


class CapitalGainsSummaryRow(_Strict):
    category: str
    sale_value: Optional[Decimal] = None
    cost: Optional[Decimal] = None
    realised_pnl: Optional[Decimal] = None
    applicable_tax_rate: Optional[str] = None


class CapitalGainsExtraction(_Strict):
    """Broker / portfolio P&L statement covering Schedule CG inputs."""
    financial_year: Optional[str] = None
    broker_name: Optional[str] = None
    client_code: Optional[str] = None

    equity_stcg_111a: list[EquityTradeRow] = Field(default_factory=list)
    equity_ltcg_112a: list[EquityTradeRow] = Field(default_factory=list)
    mutual_fund_redemptions: list[MutualFundRedemption] = Field(default_factory=list)
    equity_intraday: list[IntradayTradeRow] = Field(default_factory=list)
    fno_trades: list[FnoTradeRow] = Field(default_factory=list)
    dividends: list[DividendRow] = Field(default_factory=list)
    summary: list[CapitalGainsSummaryRow] = Field(default_factory=list)

    totals: Optional[dict] = None  # free-form bucket: broker may print custom totals


# ---------------------------------------------------------------------------
# Classification probe (used when content sniff abstains)
# ---------------------------------------------------------------------------

class ClassificationProbe(_Strict):
    doc_type: Literal[
        "form16", "form_26as", "ais_tis", "salary_slip",
        "bank_pdf", "unknown_pdf",
        "capital_gains_statement", "broker_pnl",
    ]
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: Optional[str] = None


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

SCHEMA_BY_TYPE: dict[str, type[_Strict]] = {
    "form16": Form16Extraction,
    "form_26as": Form26ASExtraction,
    "ais_tis": AisExtraction,
    "salary_slip": SalarySlipExtraction,
    "bank_pdf": BankPdfExtraction,
    "capital_gains_statement": CapitalGainsExtraction,
    "broker_pnl": CapitalGainsExtraction,
}


def schema_for(doc_type: str) -> type[_Strict] | None:
    return SCHEMA_BY_TYPE.get(doc_type)
