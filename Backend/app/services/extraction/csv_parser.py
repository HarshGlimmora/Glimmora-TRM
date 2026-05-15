"""Indian bank statement CSV parser.

Recognises the generic column set most retail banks export:

    Txn Date | Value Date | Description | Cheque/Ref | Debit | Credit | Balance

Headers are matched case-insensitively with reasonable synonyms (e.g.
`Transaction Date`, `Withdrawal Amt`, `Deposit Amt`, `Particulars`,
`Narration`).

Output rows are normalised to:

    ParsedRow(
        txn_date: ISO 'YYYY-MM-DD',
        amount: Decimal       — signed: negative for debits, positive for credits,
        direction: 'debit' | 'credit',
        description: str,
        counterparty_hint: str | None,
        raw: dict             — verbatim original row (preserved for audit),
    )

Date format ambiguity (e.g. `01/02/24` = Jan 2 vs Feb 1) is resolved by
trying DD/MM/YY first (most common in IN bank exports), falling back to MM/DD/YY
and ISO. Callers can pass `hint_dd_first=False` to flip the default for known
US-style sources.
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Iterable


class CsvParseError(ValueError):
    """Raised when the CSV is unreadable or has no recognisable header row."""


@dataclass(frozen=True)
class ParsedRow:
    txn_date: date
    amount: Decimal       # signed: debits negative, credits positive
    direction: str        # 'debit' | 'credit'
    description: str
    counterparty_hint: str | None
    raw: dict


# Column synonyms — values are aliases that map to the canonical key on the left.
COLUMN_ALIASES: dict[str, set[str]] = {
    "txn_date": {
        "txn date", "transaction date", "date", "txn_date", "post date",
        "posting date", "trans date",
    },
    "value_date": {"value date", "val date", "value_date"},
    "description": {
        "description", "narration", "particulars", "details", "remarks",
        "transaction details",
    },
    "ref": {"chq no", "cheque no", "cheque/ref", "ref no", "reference",
            "ref", "cheque_or_ref_number"},
    "debit": {"debit", "withdrawal amt", "withdrawal", "dr", "debit amount",
              "amount debited"},
    "credit": {"credit", "deposit amt", "deposit", "cr", "credit amount",
               "amount credited"},
    "amount": {"amount", "txn amount", "transaction amount"},
    "balance": {"balance", "running balance", "closing balance", "balance after"},
}


def parse_bank_csv(content: bytes, *, hint_dd_first: bool = True) -> list[ParsedRow]:
    text = _decode(content)
    delimiter = _sniff_delimiter(text)
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    rows = [
        r for r in reader
        if any(c.strip() for c in r)
        # Skip xlsx→csv sheet markers and human comments.
        and not (r and r[0].strip().startswith("#"))
    ]
    if not rows:
        raise CsvParseError("CSV is empty.")

    header_idx, header = _find_header(rows)
    column_map = _map_columns(header)
    if "txn_date" not in column_map:
        raise CsvParseError(
            "Could not locate a transaction date column. "
            "Expected one of: Txn Date / Transaction Date / Date."
        )
    if not ({"debit", "credit"} & column_map.keys()) and "amount" not in column_map:
        raise CsvParseError(
            "Could not locate amount columns. "
            "Expected Debit/Credit pair or a single Amount column."
        )

    parsed: list[ParsedRow] = []
    for row in rows[header_idx + 1:]:
        if not any(c.strip() for c in row):
            continue
        if len(row) < len(header):
            row = row + [""] * (len(header) - len(row))
        raw = {header[i]: (row[i].strip() if i < len(row) else "") for i in range(len(header))}
        try:
            parsed.append(_normalise_row(raw, column_map, hint_dd_first=hint_dd_first))
        except CsvRowSkip:
            continue  # row that's not a transaction (subtotal / closing line)
    return parsed


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

class CsvRowSkip(Exception):
    """Row is intentionally skipped (not a transaction)."""


def _decode(content: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return content.decode(enc)
        except UnicodeDecodeError:
            continue
    raise CsvParseError("Could not decode CSV bytes as utf-8 or latin-1.")


_DELIMITERS = (",", "\t", ";", "|")


def _sniff_delimiter(text: str) -> str:
    """Pick the delimiter that produces the most consistent column count over
    the first few non-empty lines. csv.Sniffer is too eager to declare commas
    on free-form text; this counter-based approach is more reliable for the
    tabular exports we see in practice (HDFC CSV = comma, Zerodha TSV = tab,
    European banks = semicolon)."""
    sample_lines = [
        ln for ln in text.splitlines()[:40]
        if ln.strip() and not ln.strip().startswith("#")
    ]
    if not sample_lines:
        return ","

    best_delim = ","
    best_score = -1
    for delim in _DELIMITERS:
        # Count occurrences per line, ignoring lines that have zero of this
        # delimiter (free-text / blank-ish lines). Stability = how often the
        # modal count appears across the sample.
        counts = [ln.count(delim) for ln in sample_lines if delim in ln]
        if not counts:
            continue
        from collections import Counter
        modal_count, modal_freq = Counter(counts).most_common(1)[0]
        if modal_count == 0:
            continue
        # Score favours both: high modal count (lots of columns) and high
        # stability (most lines agree on the count).
        score = modal_count * modal_freq
        if score > best_score:
            best_score = score
            best_delim = delim
    return best_delim


def _find_header(rows: list[list[str]]) -> tuple[int, list[str]]:
    """Scan the first ~50 rows for a header line with a date column AND
    either debit/credit pair or amount. Real bank exports often prepend
    10-20 metadata rows (account info, period, opening balance, blank
    separators) before the transaction table. Substring matching tolerates
    decorated column names like 'Date (DD/MM/YYYY)' or 'Withdrawal Amt.'.
    """
    for i, row in enumerate(rows[:50]):
        normalised = [_norm(c) for c in row]
        if not normalised:
            continue
        has_date = any(_cell_matches(c, COLUMN_ALIASES["txn_date"]) for c in normalised)
        has_amount = (
            (any(_cell_matches(c, COLUMN_ALIASES["debit"]) for c in normalised)
             and any(_cell_matches(c, COLUMN_ALIASES["credit"]) for c in normalised))
            or any(_cell_matches(c, COLUMN_ALIASES["amount"]) for c in normalised)
        )
        if has_date and has_amount:
            return i, [c.strip() for c in row]
    raise CsvParseError("Could not locate a header row.")


def _cell_matches(normalised_cell: str, aliases: set[str]) -> bool:
    """Substring-aware alias match. Header cells in the wild come decorated:
    `Date (DD/MM/YYYY)`, `Withdrawal Amt.`, `Particulars / Narration`. We
    treat any alias appearing inside the cell as a match. Short aliases
    (length 1-2) require exact match to avoid false positives like `dr` in
    `drug`."""
    if not normalised_cell:
        return False
    for alias in aliases:
        if len(alias) <= 2:
            if normalised_cell == alias:
                return True
        elif alias in normalised_cell:
            return True
    return False


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip().lower())


def _map_columns(header: list[str]) -> dict[str, int]:
    out: dict[str, int] = {}
    for idx, col in enumerate(header):
        n = _norm(col)
        for canonical, aliases in COLUMN_ALIASES.items():
            if canonical in out:
                continue
            if _cell_matches(n, aliases):
                out[canonical] = idx
                break
    return out


def _normalise_row(
    raw: dict[str, str],
    cmap: dict[str, int],
    *,
    hint_dd_first: bool,
) -> ParsedRow:
    header = list(raw.keys())

    def cell(key: str) -> str:
        i = cmap.get(key)
        if i is None or i >= len(header):
            return ""
        return raw[header[i]].strip()

    date_str = cell("txn_date")
    if not date_str:
        raise CsvRowSkip
    try:
        txn_date = _parse_date(date_str, hint_dd_first=hint_dd_first)
    except ValueError:
        raise CsvRowSkip

    debit_str = cell("debit")
    credit_str = cell("credit")
    amount_str = cell("amount")

    amount: Decimal
    direction: str
    if debit_str or credit_str:
        debit = _decimal_or_none(debit_str)
        credit = _decimal_or_none(credit_str)
        if debit is None and credit is None:
            raise CsvRowSkip
        if debit and credit:
            # Pathological row — both populated. Net them out, treat sign as direction.
            net = credit - debit
            amount = net
            direction = "credit" if net >= 0 else "debit"
        elif debit:
            amount = -debit
            direction = "debit"
        else:
            assert credit is not None
            amount = credit
            direction = "credit"
    else:
        amt = _decimal_or_none(amount_str)
        if amt is None:
            raise CsvRowSkip
        amount = amt
        direction = "debit" if amt < 0 else "credit"

    description = cell("description") or cell("ref") or ""
    return ParsedRow(
        txn_date=txn_date,
        amount=amount,
        direction=direction,
        description=description,
        counterparty_hint=_extract_counterparty(description),
        raw=dict(raw),
    )


def _decimal_or_none(s: str) -> Decimal | None:
    if not s or s in {"-", "0", "0.0", "0.00"}:
        if s in {"0", "0.0", "0.00"}:
            return Decimal("0")
        return None
    cleaned = s.replace(",", "").replace("INR", "").replace("Rs.", "").replace("Rs", "").strip()
    cleaned = re.sub(r"[^\d.\-]", "", cleaned)
    if not cleaned or cleaned in {"-", "."}:
        return None
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None


_DATE_FORMATS_DD_FIRST = ("%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y", "%d-%m-%y", "%Y-%m-%d", "%d %b %Y", "%d-%b-%Y")
_DATE_FORMATS_MM_FIRST = ("%m/%d/%Y", "%m-%d-%Y", "%m/%d/%y", "%m-%d-%y", "%Y-%m-%d", "%d %b %Y", "%d-%b-%Y")


def _parse_date(s: str, *, hint_dd_first: bool) -> date:
    from datetime import datetime as _dt
    formats = _DATE_FORMATS_DD_FIRST if hint_dd_first else _DATE_FORMATS_MM_FIRST
    for fmt in formats:
        try:
            return _dt.strptime(s, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Unrecognised date format: {s!r}")


_COUNTERPARTY_RE = re.compile(
    r"(?:NEFT|RTGS|IMPS|UPI|ACH|TPT|FUND[\s_]+TRANSFER)[\s\-/_:]+"
    r"(?:[A-Z0-9]+/)*([A-Za-z][A-Za-z0-9 .&\-]{2,40})",
    re.I,
)


def _extract_counterparty(description: str) -> str | None:
    if not description:
        return None
    m = _COUNTERPARTY_RE.search(description)
    if m:
        return m.group(1).strip().rstrip(".")
    return None


def iter_dates(rows: Iterable[ParsedRow]) -> list[date]:
    return [r.txn_date for r in rows]
