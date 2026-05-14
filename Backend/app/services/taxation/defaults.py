"""Bundled rule defaults for development.

These mirror what the admin rule-approval flow should seed into `country_rules`.
The engine prefers DB-stored rules; bundled defaults are a development fallback
so `/calculate` works out-of-the-box. In production, run
`python -m scripts.seed_taxation_rules` after migration and rely on the DB.

Every constant here is traceable to a section of the Income Tax Act + the latest
Finance Act for that FY. See `Technical Docs/TAXATION_CALCULATION.md`.

Statute mapping:
  FY 2024-25, FY 2025-26 → IT Act 1961
  FY 2026-27 onward      → IT Act 2025 (in force 1 Apr 2026)
"""

from __future__ import annotations

# ──────────────────────────────────────────────────────────────────────────────
# Slab definitions reused across FYs
# ──────────────────────────────────────────────────────────────────────────────

_OLD_SLAB_GENERAL = {
    "slabs": [
        {"from": 0,       "to": 250000,  "rate": 0.00},
        {"from": 250000,  "to": 500000,  "rate": 0.05},
        {"from": 500000,  "to": 1000000, "rate": 0.20},
        {"from": 1000000, "to": None,    "rate": 0.30},
    ]
}
_OLD_SLAB_SENIOR = {
    "slabs": [
        {"from": 0,       "to": 300000,  "rate": 0.00},
        {"from": 300000,  "to": 500000,  "rate": 0.05},
        {"from": 500000,  "to": 1000000, "rate": 0.20},
        {"from": 1000000, "to": None,    "rate": 0.30},
    ]
}
_OLD_SLAB_SUPER_SENIOR = {
    "slabs": [
        {"from": 0,       "to": 500000,  "rate": 0.00},
        {"from": 500000,  "to": 1000000, "rate": 0.20},
        {"from": 1000000, "to": None,    "rate": 0.30},
    ]
}
_NEW_SLAB_FY_2024_25 = {
    "slabs": [
        {"from": 0,       "to": 300000,  "rate": 0.00},
        {"from": 300000,  "to": 700000,  "rate": 0.05},
        {"from": 700000,  "to": 1000000, "rate": 0.10},
        {"from": 1000000, "to": 1200000, "rate": 0.15},
        {"from": 1200000, "to": 1500000, "rate": 0.20},
        {"from": 1500000, "to": None,    "rate": 0.30},
    ]
}
_NEW_SLAB_FY_2025_26 = {
    "slabs": [
        {"from": 0,       "to": 400000,  "rate": 0.00},
        {"from": 400000,  "to": 800000,  "rate": 0.05},
        {"from": 800000,  "to": 1200000, "rate": 0.10},
        {"from": 1200000, "to": 1600000, "rate": 0.15},
        {"from": 1600000, "to": 2000000, "rate": 0.20},
        {"from": 2000000, "to": 2400000, "rate": 0.25},
        {"from": 2400000, "to": None,    "rate": 0.30},
    ]
}
_SURCHARGE_NEW = {
    "bands": [
        {"from_income": 5000000,  "to_income": 10000000, "rate": 0.10},
        {"from_income": 10000000, "to_income": 20000000, "rate": 0.15},
        {"from_income": 20000000, "to_income": None,     "rate": 0.25},
    ],
    "marginal_relief": True,
    "max_on_special_rate_income": 0.15,
}
_SURCHARGE_OLD = {
    "bands": [
        {"from_income": 5000000,  "to_income": 10000000, "rate": 0.10},
        {"from_income": 10000000, "to_income": 20000000, "rate": 0.15},
        {"from_income": 20000000, "to_income": 50000000, "rate": 0.25},
        {"from_income": 50000000, "to_income": None,     "rate": 0.37},
    ],
    "marginal_relief": True,
    "max_on_special_rate_income": 0.15,
}
_CESS = {"name": "Health and Education Cess", "rate": 0.04}

# Flat-rate (special) sections — rates from Finance Act 2024 effective 23 Jul 2024.
_FLAT_RATE_RULES = {
    "flat_rate_stcg_111a": {
        "source_reference": "Section 111A, as amended by Finance Act 2024 (rate raised 15% → 20% from 23 Jul 2024)",
        "section_ref": "111A",
        "rule_json": {"rate": 0.20, "threshold": 0, "surcharge_cap": 0.15},
    },
    "flat_rate_ltcg_112a": {
        "source_reference": "Section 112A, as amended by Finance Act 2024 (rate 10% → 12.5%; threshold ₹1L → ₹1.25L from 23 Jul 2024)",
        "section_ref": "112A",
        "rule_json": {"rate": 0.125, "threshold": 125000, "surcharge_cap": 0.15},
    },
    "flat_rate_ltcg_112": {
        "source_reference": "Section 112, as amended by Finance Act 2024 (12.5% without indexation from 23 Jul 2024)",
        "section_ref": "112",
        "rule_json": {"rate": 0.125, "threshold": 0, "surcharge_cap": 0.15},
    },
    "flat_rate_lottery_115bb": {
        "source_reference": "Section 115BB — winnings from lotteries, crossword puzzles, races, card games (30% flat). Surcharge capped at 15% per Finance Act 2022.",
        "section_ref": "115BB",
        "rule_json": {"rate": 0.30, "threshold": 0, "surcharge_cap": 0.15},
    },
}

# Standard deductions.
_SD_NEW_75K = {
    "source_reference": "Finance Act 2024 raised standard deduction under new regime to ₹75,000",
    "section_ref": "16(ia)",
    "rule_json": {"amount": 75000, "applies_to": ["salary", "pension"]},
}
_SD_NEW_50K = {
    "source_reference": "Standard deduction under new regime — ₹50,000 (pre-Finance Act 2024)",
    "section_ref": "16(ia)",
    "rule_json": {"amount": 50000, "applies_to": ["salary", "pension"]},
}
_SD_OLD = {
    "source_reference": "Section 16(ia) of the Income Tax Act, 1961",
    "section_ref": "16(ia)",
    "rule_json": {"amount": 50000, "applies_to": ["salary", "pension"]},
}

# Chapter VI-A (old regime) — MVP coverage.
_VIA_RULES = {
    "deduction_80c": {
        "source_reference": "Section 80C of the Income Tax Act, 1961",
        "section_ref": "80C",
        "rule_json": {"cap": 150000, "shared_cap_with": ["80CCC", "80CCD(1)"], "regimes": ["old"]},
    },
    "deduction_80ccd_1b": {
        "source_reference": "Section 80CCD(1B) — additional NPS deduction over and above §80C cap",
        "section_ref": "80CCD(1B)",
        "rule_json": {"cap": 50000, "regimes": ["old"]},
    },
    "deduction_80d": {
        "source_reference": "Section 80D — health insurance premium",
        "section_ref": "80D",
        "rule_json": {
            "cap_self_family_under60": 25000,
            "cap_self_family_senior":  50000,
            "regimes": ["old"],
        },
    },
    "deduction_80tta": {
        "source_reference": "Section 80TTA — savings-account interest (under 60)",
        "section_ref": "80TTA",
        "rule_json": {"cap": 10000, "regimes": ["old"]},
    },
    "deduction_80ttb": {
        "source_reference": "Section 80TTB — interest income (senior citizens ≥ 60)",
        "section_ref": "80TTB",
        "rule_json": {"cap": 50000, "regimes": ["old"]},
    },
}


# ──────────────────────────────────────────────────────────────────────────────
# FY 2025-26 (current filing season — Finance Act 2025)
# ──────────────────────────────────────────────────────────────────────────────

RULES_FY_2025_26 = {
    "income_slab_new_regime": {
        "source_reference": "Finance Act 2025, amendment to §115BAC — basic exemption ₹4L, 25% slab inserted, 30% from ₹24L",
        "section_ref": "115BAC",
        "rule_json": _NEW_SLAB_FY_2025_26,
    },
    "income_slab_old_regime": {
        "source_reference": "Income Tax Act, 1961, First Schedule (Part I) — individual < 60",
        "section_ref": "Schedule I",
        "rule_json": _OLD_SLAB_GENERAL,
    },
    "income_slab_old_regime_senior": {
        "source_reference": "Income Tax Act, 1961, First Schedule (Part I) — senior citizen 60–79",
        "section_ref": "Schedule I",
        "rule_json": _OLD_SLAB_SENIOR,
    },
    "income_slab_old_regime_super_senior": {
        "source_reference": "Income Tax Act, 1961, First Schedule (Part I) — super senior ≥ 80",
        "section_ref": "Schedule I",
        "rule_json": _OLD_SLAB_SUPER_SENIOR,
    },
    "rebate_87a_new_regime": {
        "source_reference": "Finance Act 2025 amendment to §87A — threshold ₹7L → ₹12L; cap ₹25k → ₹60k",
        "section_ref": "87A",
        "rule_json": {
            "threshold_income": 1200000,
            "rebate_cap":       60000,
            "marginal_relief":  True,
            "applies_to_residents_only": True,
            "excludes_flat_rate_tax":    True,
        },
    },
    "rebate_87a_old_regime": {
        "source_reference": "Section 87A of the Income Tax Act, 1961 — unchanged for old regime",
        "section_ref": "87A",
        "rule_json": {
            "threshold_income": 500000,
            "rebate_cap":       12500,
            "marginal_relief":  False,
            "applies_to_residents_only": True,
            "excludes_flat_rate_tax":    True,
        },
    },
    "surcharge_new_regime": {
        "source_reference": "§115BAC; Finance Act 2023 caps surcharge at 25% under new regime",
        "section_ref": "115BAC",
        "rule_json": _SURCHARGE_NEW,
    },
    "surcharge_old_regime": {
        "source_reference": "Income Tax Act, 1961 — surcharge schedule, top rate 37%",
        "section_ref": "Surcharge schedule",
        "rule_json": _SURCHARGE_OLD,
    },
    "cess": {
        "source_reference": "Finance Act 2018 — Health and Education Cess @ 4%",
        "section_ref": "Finance Act 2018",
        "rule_json": _CESS,
    },
    "standard_deduction_new_regime": _SD_NEW_75K,
    "standard_deduction_old_regime": _SD_OLD,
    **_VIA_RULES,
    **_FLAT_RATE_RULES,
}


# ──────────────────────────────────────────────────────────────────────────────
# FY 2024-25 (for belated / revised / ITR-U filings)
# ──────────────────────────────────────────────────────────────────────────────

RULES_FY_2024_25 = {
    "income_slab_new_regime": {
        "source_reference": "Finance Act 2024 — new-regime slabs effective FY 2024-25",
        "section_ref": "115BAC",
        "rule_json": _NEW_SLAB_FY_2024_25,
    },
    "income_slab_old_regime":              RULES_FY_2025_26["income_slab_old_regime"],
    "income_slab_old_regime_senior":       RULES_FY_2025_26["income_slab_old_regime_senior"],
    "income_slab_old_regime_super_senior": RULES_FY_2025_26["income_slab_old_regime_super_senior"],
    "rebate_87a_new_regime": {
        "source_reference": "§87A pre-FA 2025 — threshold ₹7L, cap ₹25k under new regime",
        "section_ref": "87A",
        "rule_json": {
            "threshold_income": 700000,
            "rebate_cap":       25000,
            "marginal_relief":  True,
            "applies_to_residents_only": True,
            "excludes_flat_rate_tax":    True,
        },
    },
    "rebate_87a_old_regime":           RULES_FY_2025_26["rebate_87a_old_regime"],
    "surcharge_new_regime":            RULES_FY_2025_26["surcharge_new_regime"],
    "surcharge_old_regime":            RULES_FY_2025_26["surcharge_old_regime"],
    "cess":                            RULES_FY_2025_26["cess"],
    "standard_deduction_new_regime":   _SD_NEW_75K,   # FA 2024 raised this from 50k
    "standard_deduction_old_regime":   _SD_OLD,
    **_VIA_RULES,
    **_FLAT_RATE_RULES,
}


# ──────────────────────────────────────────────────────────────────────────────
# FY 2026-27 (current FY, IT Act 2025 in force — Budget 2026: no slab changes)
# ──────────────────────────────────────────────────────────────────────────────

RULES_FY_2026_27 = {
    # Rates identical to FY 2025-26; only the statute changes (handled in trace).
    "income_slab_new_regime": {
        "source_reference": "Income Tax Act 2025, Section 202 — slabs unchanged from FY 2025-26 (Budget 2026)",
        "section_ref": "202",
        "rule_json": _NEW_SLAB_FY_2025_26,
    },
    "income_slab_old_regime":              RULES_FY_2025_26["income_slab_old_regime"],
    "income_slab_old_regime_senior":       RULES_FY_2025_26["income_slab_old_regime_senior"],
    "income_slab_old_regime_super_senior": RULES_FY_2025_26["income_slab_old_regime_super_senior"],
    "rebate_87a_new_regime": {
        "source_reference": "Income Tax Act 2025, §156 (new-regime rebate) — ₹12L / ₹60k carried forward",
        "section_ref": "156",
        "rule_json": RULES_FY_2025_26["rebate_87a_new_regime"]["rule_json"],
    },
    "rebate_87a_old_regime":           RULES_FY_2025_26["rebate_87a_old_regime"],
    "surcharge_new_regime": {
        "source_reference": "Income Tax Act 2025, §202 — surcharge capped at 25% under new regime",
        "section_ref": "202",
        "rule_json": _SURCHARGE_NEW,
    },
    "surcharge_old_regime":            RULES_FY_2025_26["surcharge_old_regime"],
    "cess":                            RULES_FY_2025_26["cess"],
    "standard_deduction_new_regime": {
        "source_reference": "Income Tax Act 2025, §13(ia) — standard deduction ₹75,000 new regime",
        "section_ref": "13(ia)",
        "rule_json": _SD_NEW_75K["rule_json"],
    },
    "standard_deduction_old_regime":   _SD_OLD,
    **_VIA_RULES,
    **_FLAT_RATE_RULES,
}


# ──────────────────────────────────────────────────────────────────────────────
# Category → head mapping (extend as transaction taxonomy grows)
# ──────────────────────────────────────────────────────────────────────────────

CATEGORY_TO_HEAD: dict[str, str] = {
    "salary":            "salary",
    "salary_basic":      "salary",
    "salary_hra":        "salary",
    "salary_allowance":  "salary",
    "salary_perquisite": "salary",
    "pension":           "salary",
    "interest_income":   "other_sources",
    "interest_savings":  "other_sources",
    "interest_fd":       "other_sources",
    "dividend":          "other_sources",
    "family_pension":    "other_sources",
    "other_income":      "other_sources",
    "lottery_115bb":     "other_sources",   # routed inside other-sources to lottery bucket
    "lottery":           "other_sources",
    "betting":           "other_sources",
    "race_winnings":     "other_sources",
    "crossword_winnings":"other_sources",
    "game_show_winnings":"other_sources",
    "gambling":          "other_sources",
    "rental_income":     "house_property",
    "business_income":   "pgbp",
    "professional_fee":  "pgbp",
    "stcg_111a":         "capital_gains",
    "ltcg_112a":         "capital_gains",
    "ltcg_112":          "capital_gains",
    "stcg_other":        "capital_gains",
    "stcg_debt":         "capital_gains",
    "stcg_gold":         "capital_gains",
    "stcg_property_short":"capital_gains",
}


def head_of(category: str | None) -> str:
    if not category:
        return "other_sources"
    return CATEGORY_TO_HEAD.get(category.lower(), "other_sources")


def bundled_rules_for(fy: str) -> dict | None:
    """Return the bundled rule pack for a given FY, or None if unsupported."""
    return {
        "FY2024-25": RULES_FY_2024_25,
        "FY2025-26": RULES_FY_2025_26,
        "FY2026-27": RULES_FY_2026_27,
    }.get(fy)
