/**
 * Human-friendly labels for extraction-payload fields.
 *
 * Two lookups:
 *   - SECTION_LABELS: keyed by the doc_type + top-level key, used for section
 *     headings and table titles. Falls back to a humanise() of the raw key.
 *   - COLUMN_LABELS: keyed by the *inner* field name (e.g. "buy_date"), used
 *     as column headers in tables and as field labels in scalar inputs. Same
 *     key may appear in many sections so we keep this dimension flat.
 *
 * Anything missing from these maps still renders — just with the auto-
 * humanised key (snake_case → Snake Case). Keep this file small + boring;
 * the goal is presentational only.
 */

export const SECTION_LABELS: Record<string, string> = {
  // capital_gains_statement / broker_pnl
  equity_stcg_111a: "Equity — Short-term capital gains (Section 111A)",
  equity_ltcg_112a: "Equity — Long-term capital gains (Section 112A)",
  mutual_fund_redemptions: "Mutual fund redemptions",
  equity_intraday: "Equity intraday (speculative business)",
  fno_trades: "F&O trades (non-speculative business)",
  dividends: "Dividend income (Other Sources)",
  summary: "Capital-gains summary",
  totals: "Totals",
  // form16
  salary_breakdown: "Salary breakdown",
  chapter_via_deductions: "Chapter VI-A deductions",
  tds_quarterly: "TDS quarterly",
  // form_26as
  part_a_tds_on_salary: "Part A — TDS on salary",
  part_a1_tds_other_than_salary: "Part A1 — TDS other than salary",
  part_b_details_of_tax_deducted_at_source_for_15g_15h: "Part B — 15G / 15H",
  part_c_details_of_tax_paid_other_than_tds_or_tcs: "Part C — Tax paid (advance / self-assessment)",
  part_d_details_of_refund: "Part D — Refund",
  part_e_high_value_transactions: "Part E — High-value transactions (SFT)",
  // ais_tis
  reported_information: "Reported information",
  // salary slip
  earnings: "Earnings",
  deductions: "Deductions",
  // bank_pdf
  transactions: "Transactions",
  statement_period: "Statement period",
  // generic sub-objects
  employer: "Employer",
  employee: "Employee",
  period: "Period",
  pay_period: "Pay period",
};

export const COLUMN_LABELS: Record<string, string> = {
  // dates
  txn_date: "Date",
  trade_date: "Date",
  buy_date: "Buy date",
  sell_date: "Sell date",
  date_of_credit: "Credit date",
  booking_date: "Booking date",
  date_of_deposit: "Deposit date",
  date_or_period: "Period",
  date: "Date",
  value_date: "Value date",
  deposit_date: "Deposit date",
  from_date: "From",
  to_date: "To",

  // identifiers
  symbol: "Symbol",
  isin: "ISIN",
  scheme_name: "Scheme",
  folio_no: "Folio",
  instrument: "Instrument",
  cheque_or_ref_number: "Ref / Cheque",
  information_code: "Code",
  information_description: "Description",
  information_source: "Source",
  description: "Description",
  counterparty_hint: "Counterparty",
  account_number_masked: "Account no (masked)",
  account_holder_name: "Account holder",
  bank_name: "Bank",
  branch: "Branch",

  // quantities / metrics
  quantity: "Qty",
  units: "Units",
  buy_qty: "Buy qty",
  sell_qty: "Sell qty",
  lot_size: "Lot size",
  dividend_per_share: "Div/share",
  quantity_held: "Qty held",
  holding_days: "Holding (days)",

  // money
  buy_price: "Buy price",
  sell_price: "Sell price",
  buy_value: "Buy value",
  sell_value: "Sell value",
  buy_nav: "Buy NAV",
  sell_nav: "Sell NAV",
  realised_pnl: "Realised P&L",
  amount: "Amount",
  amount_paid: "Amount paid",
  amount_reported: "Reported amount",
  amount_debited: "Debited",
  amount_credited: "Credited",
  debit_amount: "Debit",
  credit_amount: "Credit",
  balance_after: "Balance",
  opening_balance: "Opening balance",
  closing_balance: "Closing balance",
  gross_salary: "Gross salary",
  net_salary: "Net salary",
  gross_dividend: "Gross dividend",
  net_credit: "Net credit",
  net_pay: "Net pay",
  total_tds_deducted: "Total TDS deducted",
  tds_194: "TDS u/s 194",
  tds_deducted: "TDS",
  tax_deducted: "Tax deducted",
  tax_deposited: "Tax deposited",
  total_tax_paid: "Total tax paid",
  total_tax_deducted: "Total tax deducted",
  total_tax_deposited: "Total tax deposited",
  total_amount_paid: "Total amount paid",
  grand_total_tds: "Grand total TDS",
  standard_deduction: "Standard deduction",
  professional_tax: "Professional tax",
  premium_paid: "Premium paid",
  premium_received: "Premium received",
  gross_earnings_total: "Gross earnings",
  total_deductions: "Total deductions",
  section_17_1_salary: "§17(1) salary",
  section_17_2_perquisites: "§17(2) perquisites",
  section_17_3_profits_in_lieu: "§17(3) profits in lieu",
  sale_value: "Sale value",
  cost: "Cost",
  applicable_tax_rate: "Tax rate",

  // misc
  category: "Category",
  tax_treatment: "Tax treatment",
  status: "Status",
  quarter: "Quarter",
  receipt_number: "Receipt no",
  section: "Section",
  name: "Name",
  pan: "PAN",
  tan: "TAN",
  address: "Address",
  designation: "Designation",
  employee_id: "Employee ID",
  department: "Department",
  client_code: "Client code",
  broker_name: "Broker",
  bank_account_credited: "Bank a/c credited",
  financial_year: "FY",
  assessment_year: "AY",
  permanent_account_number: "PAN",
  name_of_assessee: "Assessee",
  deductor_name: "Deductor",
  deductor_tan: "Deductor TAN",
  bsr_code: "BSR code",
  challan_serial_number: "Challan no",
  month: "Month",
  year: "Year",
  component_name: "Component",
  reasoning: "Reasoning",
};

export function humanise(key: string): string {
  return key
    .replace(/[_\[\]]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function sectionLabel(key: string): string {
  return SECTION_LABELS[key] ?? humanise(key);
}

export function columnLabel(key: string): string {
  return COLUMN_LABELS[key] ?? humanise(key);
}

/** Columns for which a number should be Indian-formatted as ₹. */
const MONEY_KEYS = new Set([
  "amount", "amount_paid", "amount_reported", "amount_debited", "amount_credited",
  "debit_amount", "credit_amount", "balance_after", "opening_balance", "closing_balance",
  "buy_price", "sell_price", "buy_value", "sell_value", "buy_nav", "sell_nav",
  "realised_pnl", "gross_salary", "net_salary", "section_17_1_salary",
  "section_17_2_perquisites", "section_17_3_profits_in_lieu", "standard_deduction",
  "professional_tax", "net_pay", "gross_earnings_total", "total_deductions",
  "gross_dividend", "tds_194", "net_credit", "tds_deducted", "tax_deducted",
  "tax_deposited", "total_tax_paid", "total_tax_deducted", "total_tax_deposited",
  "total_amount_paid", "grand_total_tds", "total_tds_deducted",
  "premium_paid", "premium_received", "dividend_per_share",
  "sale_value", "cost",
]);

const DATE_KEYS = new Set([
  "txn_date", "trade_date", "buy_date", "sell_date", "date_of_credit",
  "booking_date", "date_of_deposit", "deposit_date", "date", "value_date",
  "from_date", "to_date",
]);

export function isMoneyKey(key: string): boolean {
  return MONEY_KEYS.has(key);
}
export function isDateKey(key: string): boolean {
  return DATE_KEYS.has(key);
}

export function formatINR(value: unknown): string {
  if (value == null || value === "") return "—";
  const n = typeof value === "number" ? value : Number(String(value));
  if (Number.isNaN(n)) return String(value);
  const sign = n < 0 ? "−" : "";
  const abs = Math.abs(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}₹${abs}`;
}
