"""Statute resolution.

  - FY 2024-25 → IT Act 1961
  - FY 2025-26 → IT Act 1961
  - FY 2026-27 onward → IT Act 2025 (in force from 1 Apr 2026)

The statute determines which set of section numbers the trace cites. The rates
and computation logic are identical between the two statutes for FY 2026-27
(Budget 2026 introduced no slab changes); only section numbers differ.
"""

from __future__ import annotations

import re
from typing import Literal

Statute = Literal["ITA1961", "ITA2025"]

_FY_RE = re.compile(r"^FY(\d{4})-(\d{2})$")


def resolve_statute(fy: str) -> Statute:
    """Map an FY string to the statute in force for it."""
    m = _FY_RE.match(fy)
    if not m:
        raise ValueError(f"Invalid FY format: {fy!r}; expected 'FYYYYY-YY'")
    start_year = int(m.group(1))
    return "ITA2025" if start_year >= 2026 else "ITA1961"


# Section symbol → number mapping. Engine ops reference symbols; this resolves
# to the right number for the trace based on statute.
_SECTION_MAP: dict[Statute, dict[str, str]] = {
    "ITA1961": {
        "salary":              "15-17",
        "standard_deduction":  "16(ia)",
        "house_property":      "22-27",
        "house_property_std":  "24(a)",
        "house_property_int":  "24(b)",
        "pgbp":                "28-44DB",
        "capital_gains":       "45-55A",
        "stcg_111a":           "111A",
        "ltcg_112":            "112",
        "ltcg_112a":           "112A",
        "other_sources":       "56-59",
        "family_pension":      "57(iia)",
        "lottery_115bb":       "115BB",
        "gti":                 "14",
        "chapter_via":         "VI-A",
        "rebate_87a":          "87A",
        "new_regime":          "115BAC",
        "new_regime_lock":     "115BAC(6)",
        "surcharge":           "115BAC (new) / Schedule (old)",
        "cess":                "Finance Act 2018",
    },
    "ITA2025": {
        "salary":              "13-19",
        "standard_deduction":  "13(ia)",
        "house_property":      "20-25",
        "house_property_std":  "22(a)",
        "house_property_int":  "22(b)",
        "pgbp":                "26-66",
        "capital_gains":       "67-91",
        "stcg_111a":           "195",
        "ltcg_112":            "196",
        "ltcg_112a":           "197",
        "other_sources":       "92-95",
        "family_pension":      "93(iia)",
        "lottery_115bb":       "203",
        "gti":                 "12",
        "chapter_via":         "VIII",
        "rebate_87a":          "156",
        "new_regime":          "202",
        "new_regime_lock":     "202(6)",
        "surcharge":           "202 (new) / Schedule (old)",
        "cess":                "Finance Act 2018",
    },
}


def section_ref(symbol: str, statute: Statute) -> str:
    """Look up the statute-correct section number for a logical symbol."""
    return _SECTION_MAP.get(statute, {}).get(symbol, symbol)
