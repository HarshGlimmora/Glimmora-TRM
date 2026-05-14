# GlimmoraTax — Indian Income-Tax Calculation Spec & Implementation Plan

> **Status:** design spec. The taxation service does not exist yet under `Backend/app/services/`. This document is the contract the implementation must satisfy.
>
> **Last verified:** 2026-05-14. Rules cited reflect the **Finance Act 2025** (in force for FY 2025-26, filings due 31 Jul 2026) and the **Income Tax Act 2025** (replaces the 1961 Act from 1 Apr 2026, applies FY 2026-27 onwards).
>
> **Scope:** resident individual taxpayers — salaried, business, professional, capital-gains, house-property, other-sources. HUFs and companies are out of scope for MVP.
>
> **Source-of-truth law:** Income Tax Act, 1961 (governs FY 2024-25 and FY 2025-26) **+** Income Tax Act, 2025 (governs FY 2026-27 onwards), each as amended by the latest Finance Act for the FY being filed.

---

## Table of contents

1. [Critical context — three FYs, two statutes](#1-critical-context--three-fys-two-statutes)
2. [Legal framework & vocabulary](#2-legal-framework--vocabulary)
3. [The two regimes (Section 115BAC / Section 202)](#3-the-two-regimes-section-115bac--section-202)
4. [The five heads of income](#4-the-five-heads-of-income)
5. [Deductions](#5-deductions)
6. [Slab rates — current and prior FYs](#6-slab-rates--current-and-prior-fys)
7. [Rebate under Section 87A / Section 156](#7-rebate-under-section-87a--section-156)
8. [Surcharge & marginal relief](#8-surcharge--marginal-relief)
9. [Health & Education Cess](#9-health--education-cess)
10. [Capital gains — special rates](#10-capital-gains--special-rates)
11. [TDS, advance tax, balance payable](#11-tds-advance-tax-balance-payable)
12. [The end-to-end calculation algorithm](#12-the-end-to-end-calculation-algorithm)
13. [Rule JSON shapes](#13-rule-json-shapes)
14. [Calculation trace — schema & user-facing explainability](#14-calculation-trace--schema--user-facing-explainability)
15. [Implementation plan](#15-implementation-plan)
16. [Correctness strategy](#16-correctness-strategy)
17. [Worked examples (FY 2025-26)](#17-worked-examples-fy-2025-26)
18. [Open questions / out-of-scope](#18-open-questions--out-of-scope)
19. [Appendix A — Statutory reference index (1961 ↔ 2025)](#appendix-a--statutory-reference-index)
20. [Appendix B — Finance Act history](#appendix-b--finance-act-history)

---

## 1. Critical context — three FYs, two statutes

Today is 14 May 2026. The taxation engine must support three financial years simultaneously, and **two different statutes**:

| FY | AY | Filing window | Statute | Status |
|---|---|---|---|---|
| **FY 2024-25** | AY 2025-26 | Original 31 Jul 2025 (done); **belated/revised by 31 Dec 2025** (closed) | IT Act 1961 | Past — supports only ITR-U (updated return, Section 139(8A)) |
| **FY 2025-26** | AY 2026-27 | **Filing OPEN — due 31 Jul 2026 (no audit) / 31 Oct 2026 (audit)** | IT Act 1961, as amended by Finance Act 2025 | **Active filing season — this is the primary use case** |
| **FY 2026-27** | AY 2027-28 | Period in progress; advance tax instalments due 15 Jun / 15 Sep / 15 Dec / 15 Mar | **Income Tax Act 2025** (effective 1 Apr 2026) | Live — only relevant for advance-tax estimation in MVP |

### 1.1 The Income Tax Act 2025

The **Income Tax Act, 2025** received Presidential assent in 2025 and came into force on **1 April 2026**. It replaces the entire Income Tax Act, 1961 going forward. Key implications for this engine:

- **Section numbers change** but tax computation rules (slabs, rebates, surcharge, cess) for FY 2026-27 are unchanged from FY 2025-26 (Budget 2026 announced no slab changes).
- Notable renumbering:
  - **§115BAC** (new regime) → **§202**
  - **§87A** (rebate) → **§156**
  - Most Chapter VI-A deduction sections are renumbered/restructured.
- The rule-store must support **statute scoping** alongside FY scoping, so a single `country_rules` row binds to `(country, tax_year, rule_type, statute)`.
- The trace's `section_ref` must use the section number **of the statute in force for that FY**, not a fixed number. A taxpayer filing FY 2025-26 sees "§115BAC"; a FY 2026-27 filing sees "§202".
- HRA 50% exemption was extended to **Bengaluru, Pune, Hyderabad, Ahmedabad** from 1 Apr 2026 (was 50% only for Mumbai, Delhi, Kolkata, Chennai before; now eight cities qualify).

### 1.2 Why this matters for the engine

> The codebase's prior examples ([ARCHITECTURE.md §5](ARCHITECTURE.md), [API_CONTRACTS.md §6.3](API_CONTRACTS.md)) use **FY2024-25 slab numbers** (5% band 3L–6L). These are **outdated** for current-season filings. Every rule cited in this document is the current (Finance Act 2025) version. The implementation **must** seed rules per-FY and not hard-code any constants.

---

## 2. Legal framework & vocabulary

| Term | Meaning |
|---|---|
| **Financial Year (FY)** | The year in which income is earned, 1 Apr → 31 Mar. e.g. `FY2025-26` = 1 Apr 2025 to 31 Mar 2026. |
| **Assessment Year (AY)** | The year following the FY in which the return is filed and assessed. `FY2025-26` → `AY2026-27`. |
| **Gross Total Income (GTI)** | Sum of income under all five heads, *before* Chapter VI-A deductions. |
| **Total Income / Taxable Income** | GTI minus eligible deductions. The number against which slabs are applied. |
| **Income Tax Act, 1961** | The base statute for FY 2024-25 and FY 2025-26. |
| **Income Tax Act, 2025** | The new base statute from FY 2026-27. Same arithmetic, different section numbers. |
| **Finance Act 2025** | The Finance Act passed July 2025 post-Union-Budget, amending the 1961 Act for FY 2025-26. **Source of current numbers.** |
| **CBDT** | Central Board of Direct Taxes — issues circulars/clarifications binding on the department. |
| **ITR forms** | ITR-1 (Sahaj), ITR-2, ITR-3, ITR-4 (Sugam) — the actual filing forms. MVP targets ITR-1 / ITR-2 shapes. |
| **ITR-U** | Updated return (§139(8A) of 1961 Act). For FY 2024-25, the window for ITR-U is now 24 months from end of AY (extended from 12 months by Finance Act 2025) — so until 31 Mar 2028. |

**Filing due dates** (§139(1) of 1961 Act / §263 of 2025 Act):

- Individuals without audit: **31 July** of the AY (31 Jul 2026 for FY 2025-26).
- Individuals subject to tax audit: **31 October** of the AY.
- Belated/revised: by **31 December** of the AY (with late fee under §234F / §391 of new act).

---

## 3. The two regimes (Section 115BAC / Section 202)

The Income Tax Act offers two parallel rate structures. The taxpayer picks one per FY.

### 3.1 Old Regime

- Pre-existing structure since the 1961 Act.
- Allows the **full set of Chapter VI-A deductions** (80C, 80D, 80CCD, 80E, 80G, 80TTA/TTB, etc.) and most head-level exemptions (HRA u/s 10(13A), LTA, home-loan interest u/s 24(b), etc.).
- Same slabs as the original Act, with senior/super-senior basic-exemption differences.
- **No structural changes in Finance Act 2025.** Slabs, 87A rebate (₹12,500 / ₹5L), surcharge bands and 37% top rate all unchanged from prior years.

### 3.2 New Regime (§115BAC of 1961 Act / §202 of 2025 Act)

Introduced by Finance Act 2020, restructured by Finance Acts 2023, 2024, and **substantially expanded by Finance Act 2025**.

- **Default regime from AY 2024-25 (FY 2023-24) onwards.**
- **Disallows** nearly all Chapter VI-A deductions (notable exceptions: employer NPS u/s 80CCD(2), Agniveer u/s 80CCH).
- **Disallows** HRA, LTA, professional tax (§16(iii)), entertainment allowance, most allowances under §10/§17.
- **Allows**: standard deduction (₹75,000), employer NPS u/s 80CCD(2) (up to 14% of salary), family-pension deduction u/s 57(iia) (₹25,000).
- Slabs are wider and lower-rated than old regime.
- **Finance Act 2025 raised the §87A rebate threshold to ₹12L and cap to ₹60,000** — making the new regime tax-free up to ₹12L taxable income (₹12.75L gross for salaried, after standard deduction).

### 3.3 §115BAC(6) — the lifetime lock for business income

Already specified in detail in [ARCHITECTURE.md §6](ARCHITECTURE.md). Summary the taxation engine must respect:

- **Category A** (no business/professional income): can switch every year, freely.
- **Category B** (has business/professional income): opting out of the new regime requires **Form 10-IEA** filed on or before §139(1) due date. Once exercised, the right to opt **back into** the new regime is a **one-time-lifetime** option. After that one switch back, opting out again is impossible.
- The engine must read `tax_returns.regime_switch_acknowledged` and refuse to calculate if a `WARN_HIGH` regime change is requested without acknowledgement (409 `regime_acknowledgment_required` per [API_CONTRACTS.md §6.3](API_CONTRACTS.md)).
- Under the 2025 Act, this lock lives in §202(6) but is functionally identical.

---

## 4. The five heads of income

GTI = sum of incomes under all five heads.

| # | Head | 1961 §§ | 2025 §§ (approx) | Examples | MVP scope |
|---|---|---|---|---|---|
| 1 | **Salaries** | 15 – 17 | 13 – 19 | Basic, DA, HRA, perquisites, profits-in-lieu | ✓ Form 16 / Form 12BA driven |
| 2 | **Income from House Property** | 22 – 27 | 20 – 25 | Rent received; self-occupied notional NIL; let-out actual; home-loan interest u/s 24(b) | ✓ basic |
| 3 | **Profits and Gains of Business or Profession** | 28 – 44DB | 26 – 66 | Sole-prop, freelance, professional fee | ✓ presumptive §44AD / §44ADA only in MVP |
| 4 | **Capital Gains** | 45 – 55A | 67 – 91 | STCG, LTCG on shares, MF, property | ✓ — see [§10](#10-capital-gains--special-rates) |
| 5 | **Income from Other Sources** | 56 – 59 | 92 – 95 | Interest (savings, FD), dividends, lottery, family pension | ✓ |

Each head has its own computation sub-rules (e.g. §24(a)/§22(a) standard 30% deduction on let-out property NAV). The taxation engine treats each head as a sub-pipeline that emits a single `head_total` plus its own trace fragment. Transactions are tagged with `head` and `category` at the transaction-review stage so the engine can group them.

---

## 5. Deductions

### 5.1 Standard deduction (§16(ia) / §13(ia))

| Regime | FY 2023-24 | FY 2024-25 | **FY 2025-26 (current)** | FY 2026-27 |
|---|---|---|---|---|
| Old | ₹50,000 | ₹50,000 | ₹50,000 | ₹50,000 |
| New | ₹50,000 | ₹75,000 | **₹75,000** | ₹75,000 |

Applies to salaried and pensioners only. Cannot exceed gross salary.

### 5.2 Chapter VI-A — old regime only (full set, FY 2025-26)

| Section (1961) | What | Cap | Notes |
|---|---|---|---|
| **80C** | LIC, PPF, EPF, ELSS, principal home loan, tuition fees, NSC, 5-yr tax-saver FD, Sukanya Samriddhi | **₹1,50,000** (combined with 80CCC, 80CCD(1)) | Most-used. |
| **80CCC** | Pension fund contributions | within 80C cap | — |
| **80CCD(1)** | Employee NPS contribution | within 80C cap; max 10% salary (20% self-employed) | — |
| **80CCD(1B)** | Additional NPS | **₹50,000** | **Over and above** 80C cap. |
| **80CCD(2)** | Employer NPS contribution | 10% of salary (private), 14% (govt); **14% in new regime** | Both regimes. Not in 80C cap. |
| **80D** | Health insurance premium | ₹25k self+family; +₹25k parents <60; +₹50k parents ≥60; +₹5k preventive within these | Senior citizen self: ₹50k. |
| **80DD** | Maintenance of disabled dependant | ₹75k / ₹1,25,000 (severe) | Flat. |
| **80DDB** | Specified medical treatment | ₹40k (₹1L senior) | Doctor cert required. |
| **80E** | Education loan interest | actual, no cap | 8-yr window from start of repayment. |
| **80EE / 80EEA** | First-time home-loan interest | ₹50k / ₹1,50,000 | Eligibility conditions; mutually exclusive overlap with §24(b). |
| **80EEB** | Electric vehicle loan interest | ₹1,50,000 | For loans sanctioned 1 Apr 2019 – 31 Mar 2023; sunset clause but existing loans continue. |
| **80G** | Donations to approved charities | 50% / 100% of donation; some subject to 10%-of-GTI cap | Cash > ₹2,000 disallowed. |
| **80GG** | Rent paid (no HRA received) | min(₹5,000/mo, 25% GTI, rent − 10% GTI) | Form 10BA required. |
| **80TTA** | Savings account interest (< 60) | **₹10,000** | Banks / post office / co-op. |
| **80TTB** | Interest income (≥ 60) | **₹50,000** | Replaces 80TTA for seniors. |
| **80U** | Self disability | ₹75k / ₹1,25,000 (severe) | — |
| **80CCH** | Agniveer Corpus Fund | actual | **Both regimes.** |

Cap total ≤ GTI: deductions can reduce taxable income to zero but not below.

### 5.3 New regime — what is still allowed (FY 2025-26)

- **§16(ia)** Standard deduction ₹75,000.
- **§16(iii)** Professional tax — **NOT** allowed under new regime.
- **§24(b)** Home-loan interest — allowed only for **let-out** property under new regime (not self-occupied).
- **§57(iia)** Family pension — deduction of 1/3 of pension or **₹25,000**, whichever less.
- **§80CCD(2)** Employer NPS contribution — up to **14% of salary** under new regime (raised from 10% by Finance Act 2024).
- **§80CCH** Agniveer Corpus Fund — both regimes.

Everything else under Chapter VI-A is denied under the new regime.

### 5.4 HRA exemption (§10(13A)) — old regime only

Exempt = least of: (a) actual HRA received, (b) rent paid − 10% of salary, (c) **50% of salary** for residents of Mumbai, Delhi, Kolkata, Chennai, **Bengaluru, Pune, Hyderabad, Ahmedabad** (last four added from 1 Apr 2026); **40% of salary** elsewhere.

> Engine implication: the city → 50%/40% mapping must be rule-driven and FY-pinned, because the city list **changes between FY 2025-26 and FY 2026-27**.

---

## 6. Slab rates — current and prior FYs

All slab tables are stored in `country_rules` with `rule_type` ∈ {`income_slab_new_regime`, `income_slab_old_regime`, `income_slab_old_regime_senior`, `income_slab_old_regime_super_senior`}, scoped by `tax_year`. Rule JSON shape in [§13](#13-rule-json-shapes).

### 6.1 New regime — FY 2025-26 (current) and FY 2026-27 (unchanged)

| Band | Rate |
|---|---|
| 0 – 4,00,000 | 0% |
| 4,00,001 – 8,00,000 | 5% |
| 8,00,001 – 12,00,000 | 10% |
| 12,00,001 – 16,00,000 | 15% |
| 16,00,001 – 20,00,000 | 20% |
| 20,00,001 – 24,00,000 | 25% |
| Above 24,00,000 | 30% |

Source: **Finance Act 2025**, amendment to §115BAC(1A) of the 1961 Act (carried forward as §202 of the 2025 Act). The basic exemption rose from ₹3L to **₹4L**; a new **25% slab** was inserted between 20L and 24L; the 30% rate now starts at ₹24L (was ₹15L).

### 6.2 New regime — FY 2024-25 (for late/revised filings only)

| Band | Rate |
|---|---|
| 0 – 3,00,000 | 0% |
| 3,00,001 – 7,00,000 | 5% |
| 7,00,001 – 10,00,000 | 10% |
| 10,00,001 – 12,00,000 | 15% |
| 12,00,001 – 15,00,000 | 20% |
| Above 15,00,000 | 30% |

Source: Finance Act 2024.

### 6.3 Old regime — individuals < 60 (FY 2024-25, 2025-26, 2026-27 — unchanged)

| Band | Rate |
|---|---|
| 0 – 2,50,000 | 0% |
| 2,50,001 – 5,00,000 | 5% |
| 5,00,001 – 10,00,000 | 20% |
| Above 10,00,000 | 30% |

Source: Income Tax Act, 1961 — Schedule I. Unchanged for over a decade.

### 6.4 Old regime — senior citizen (60 – 79)

Basic exemption raised to ₹3,00,000. Other bands unchanged.

### 6.5 Old regime — super senior citizen (≥ 80)

Basic exemption raised to ₹5,00,000. Bands: 0% up to ₹5L, 20% on ₹5L–₹10L, 30% above ₹10L (no 5% slab).

### 6.6 Slab math (the algorithm)

Slabs are **non-cumulative** and **piecewise-linear in taxable income**. For each band `b`:

```
contribution(b, taxable) = max(0, min(taxable, b.to) − b.from) × b.rate
slab_tax = Σ contribution(b, taxable) over all bands
```

The top band has `b.to = +∞` (stored as `null`).

---

## 7. Rebate under Section 87A / Section 156

**Resident individuals only** (not HUF, not non-residents). Single most important change in Finance Act 2025.

Rebate = `min(slab_tax_on_normal_income, cap)` if `taxable_income ≤ threshold`.

| Regime | FY 2024-25 | **FY 2025-26 (current)** | FY 2026-27 |
|---|---|---|---|
| Old | ₹5L / ₹12,500 | ₹5L / ₹12,500 | ₹5L / ₹12,500 |
| New | ₹7L / ₹25,000 | **₹12L / ₹60,000** | ₹12L / ₹60,000 |

### 7.1 What changed in Finance Act 2025

- Threshold under the new regime **jumped from ₹7L to ₹12L** (taxable income).
- Rebate cap **jumped from ₹25,000 to ₹60,000**.
- Net effect: salaried individual with gross salary up to **₹12.75L pays zero tax** under the new regime (₹12L taxable + ₹75,000 standard deduction).

### 7.2 Marginal relief on 87A (new regime)

Without marginal relief, a taxpayer with taxable income of ₹12,00,001 would jump from ₹0 tax to ₹60,000 tax — a ₹60,000 increase for a ₹1 income increase. **Marginal relief** caps the tax at:

```
tax_after_rebate ≤ taxable_income − 12,00,000
```

Effective marginal-relief range in FY 2025-26 is roughly ₹12,00,001 to **~₹12,75,000** (where slab tax catches up to the marginal-relief cap). Compute the exact upper bound by solving `slab_tax(x) = x − 12,00,000`.

### 7.3 What 87A does NOT apply to

- **Special-rate incomes under §§111A, 112, 112A, 115BB are excluded** from the rebate base. Rebate only on tax computed on "normal" income at slab rates.
- A taxpayer with ₹8L salary + ₹5L LTCG on equity has total income ₹13L → ineligible for 87A on slab portion **AND** ineligible on the LTCG portion regardless. The engine must split the calculation.
- Non-resident individuals are ineligible.

### 7.4 Under the 2025 Act (FY 2026-27)

The new-regime rebate is moved to **§156** of the Income Tax Act, 2025 (it is a distinct provision from the old-regime §87A, which itself remains as §156 for the old-regime taxpayers). Functionally identical to FY 2025-26.

---

## 8. Surcharge & marginal relief

Surcharge is an additional levy **on the tax amount** (not on income), kicking in at high income thresholds.

### 8.1 Surcharge rates (FY 2025-26)

| Total income | Old regime | New regime |
|---|---|---|
| ≤ ₹50,00,000 | 0% | 0% |
| > ₹50L ≤ ₹1Cr | 10% | 10% |
| > ₹1Cr ≤ ₹2Cr | 15% | 15% |
| > ₹2Cr ≤ ₹5Cr | 25% | **25% (capped)** |
| > ₹5Cr | **37%** | **25% (capped)** |

The new regime caps surcharge at 25% (§115BAC / §202).

**On §111A STCG, §112 LTCG, §112A LTCG, and dividend income**: surcharge is capped at **15%** regardless of regime (Finance Act 2022 amendment, carried forward).

### 8.2 Marginal relief on surcharge

At each surcharge threshold (₹50L, ₹1Cr, ₹2Cr, ₹5Cr under old; ₹50L, ₹1Cr, ₹2Cr under new), the **increase** in (tax + surcharge) caused by crossing the threshold must not exceed the **increase** in income above the threshold.

Formally, at threshold `T` with tax-at-threshold `tax_T` (slab tax only):

```
let surcharge_normal = slab_tax × rate_at(income)
let cap              = (income − T) − (slab_tax − tax_T)
        # "income above T, minus the extra slab tax already paid on it"
surcharge = min(surcharge_normal, max(0, cap))
```

This produces continuous tax curves at each notch. Without this, a ₹50,00,001 income would owe ~₹1.3L more tax than a ₹50,00,000 income — clearly absurd.

### 8.3 Order of operations

Surcharge depends on **total income** (the slab input) for threshold detection, but is applied **to the tax** (slab tax, minus 87A rebate, plus special-rate taxes). The engine order is:

```
slab_tax → 87A_rebate → flat_rate_taxes → surcharge → cess
```

---

## 9. Health & Education Cess

- **4%** of (slab tax after rebate + flat-rate taxes + surcharge).
- Applies to **every** taxpayer; no income threshold; no regime difference.
- Source: introduced by Finance Act 2018; rate unchanged.

```
cess = (slab_tax_after_rebate + flat_rate_taxes + surcharge) × 0.04
```

---

## 10. Capital gains — special rates

Capital-gains taxation was **substantially restructured by Finance Act 2024** (effective 23 Jul 2024) and remains in that form for FY 2025-26 and FY 2026-27.

### 10.1 Short-term capital gains

| Section | Asset class | Rate | Notes |
|---|---|---|---|
| **§111A** | Listed equity / equity MF / business-trust units (STT paid) | **20%** | Raised from 15% by Finance Act 2024 effective 23 Jul 2024. |
| Slab | All other STCG (debt MF, gold, property held < 24 months, etc.) | slab rate | Added to GTI. |

### 10.2 Long-term capital gains

| Section | Asset class | Rate | Threshold |
|---|---|---|---|
| **§112A** | Listed equity / equity MF / business-trust units (STT paid) | **12.5%** on amount above threshold | **₹1,25,000** per FY (raised from ₹1L by Finance Act 2024) |
| **§112** | Other long-term assets (property held ≥ 24 months, unlisted shares, gold, etc.) | **12.5% without indexation** | No threshold |
| **§112 (legacy)** | Immovable property acquired **before 23 Jul 2024** | Taxpayer choice: **12.5% without indexation** OR **20% with indexation** — whichever lower | Grandfather clause, taxpayer-favourable |

### 10.3 Indexation

- **Largely removed** by Finance Act 2024 for transfers on/after 23 Jul 2024.
- **One exception:** immovable property acquired before 23 Jul 2024 — taxpayer can choose old or new method (engine must compute both and pick lower).
- CII (Cost Inflation Index) table still maintained by CBDT for the grandfather scenarios.

### 10.4 §115BB — lottery, betting, race winnings

Flat **30%**, no basic exemption, no deductions. Applies to both regimes. Surcharge and cess apply on top.

### 10.5 Engine implications

- Each capital-gains transaction must carry: `acquisition_date`, `sale_date`, `asset_class` (`listed_equity_stt`, `unlisted_equity`, `property`, `debt_mf`, `gold`, etc.), `stt_paid` flag.
- The capital-gains head pipeline routes transactions into one of four buckets: `slab_taxable_stcg`, `flat_111a`, `flat_112`, `flat_112a`. Plus `flat_115bb` from other-sources for lottery winnings.
- 87A rebate **never** reduces tax on flat-rate buckets — keep them separate from `slab_tax` throughout the trace.

---

## 11. TDS, advance tax, balance payable

### 11.1 Components of "paid in advance"

| Source | Reflected in | Section (1961) |
|---|---|---|
| **TDS on salary** | Form 16 Part A | §192 |
| **TDS on interest, professional fees, contracts, rent, etc.** | Form 26AS, Annual Information Statement (AIS), TIS | §§194A, 194J, 194C, 194-I, 194-IA, etc. |
| **TCS** (tax collected at source) | Form 26AS | §206C |
| **Advance tax instalments** | Challan ITNS 280 | §211 (15 Jun 15%, 15 Sep 45%, 15 Dec 75%, 15 Mar 100% cumulative) |
| **Self-assessment tax** | Challan ITNS 280 | §140A |

### 11.2 Final reconciliation

```
total_tax     = slab_tax_after_rebate + flat_rate_taxes + surcharge + cess
prepaid       = TDS + TCS + advance_tax + self_assessment_tax
balance       = total_tax − prepaid
```

- `balance > 0` → payable (to be paid at filing via challan).
- `balance < 0` → refund (credited to taxpayer's bank account post-processing).
- `balance == 0` → nil.

### 11.3 Interest under §§234A/B/C (advisory display in MVP)

- **§234A**: 1%/month on unpaid tax × months past §139(1) due date.
- **§234B**: 1%/month if advance tax paid < 90% of assessed tax.
- **§234C**: 1%/month for shortfall in each of the four advance-tax instalments.

MVP: compute and **display as separate advisory line** in the summary, but do not fold into "balance payable" unless filing is after due date.

### 11.4 Late fee §234F

- ₹1,000 if total income ≤ ₹5L.
- ₹5,000 otherwise.
- Applies if filing after §139(1) due date but within §139(4) belated window.

---

## 12. The end-to-end calculation algorithm

Canonical pipeline. Every step emits **one trace entry** with `input`, `rule_id`, `rule_version`, `breakdown`, `result`.

```python
def compute_tax(filing_id: str, regime: Literal["old", "new"]) -> TaxResult:
    fy             = filing.tax_year                # e.g. "FY2025-26"
    statute        = resolve_statute(fy)            # "ITA1961" or "ITA2025"
    rules          = rule_resolver.bundle(country="IN", tax_year=fy,
                                          regime=regime, statute=statute)
    txns           = load_verified_transactions(filing_id)
    senior_status  = classify_age(user.dob, fy)     # "<60" | "60-79" | "80+"
    is_resident    = user.residency_status == "resident"

    trace          = TraceBuilder(filing_id, regime, statute=statute,
                                  rule_versions=rules.versions())

    # ── 1. Income aggregation per head ────────────────────────────────────
    salary_income       = compute_head_salary(txns, rules, trace)
    house_property_inc  = compute_head_house_property(txns, rules, regime, trace)
    pgbp_income         = compute_head_pgbp(txns, rules, regime, trace)
    capital_gains       = compute_head_capital_gains(txns, rules, trace)
        # → returns (slab_taxable_part, flat_rate_buckets[])
    other_sources       = compute_head_other_sources(txns, rules, regime, trace)
        # → returns (slab_taxable_part, flat_rate_buckets[])

    gti_normal = sum([
        salary_income,
        house_property_inc,
        pgbp_income,
        capital_gains.slab_part,
        other_sources.slab_part,
    ])
    trace.step("aggregate_gti", input=..., result=gti_normal)

    # ── 2. Deductions ────────────────────────────────────────────────────
    deductions = apply_deduction_rules(
        gti=gti_normal,
        regime=regime,
        declared_deductions=filing.declared_deductions,
        rules=rules,
        trace=trace,
    )
    taxable_normal = max(Decimal("0.00"), gti_normal - deductions)
    trace.step("taxable_income", input={"gti": gti_normal, "deductions": deductions},
               result=taxable_normal)

    # ── 3. Slab tax on normal income ─────────────────────────────────────
    slab_rule = rules.slab_for(regime, senior_status)
    slab_tax  = apply_slab(taxable_normal, slab_rule, trace)

    # ── 4. Flat-rate taxes (§§111A, 112, 112A, 115BB) ────────────────────
    flat_rate_tax = Decimal("0.00")
    for bucket in capital_gains.flat_rate_buckets + other_sources.flat_rate_buckets:
        flat_rate_tax += apply_flat_rate(bucket, rules, trace)

    # ── 5. Rebate u/s 87A (only on slab_tax, not flat-rate tax) ─────────
    rebate = apply_87a(
        taxable_normal=taxable_normal,
        slab_tax=slab_tax,
        regime=regime,
        is_resident=is_resident,
        rules=rules,
        trace=trace,            # emits applied / not_applied + marginal_relief if any
    )
    slab_tax_after_rebate = slab_tax - rebate

    # ── 6. Surcharge with marginal relief ────────────────────────────────
    surcharge = apply_surcharge(
        total_income=taxable_normal + capital_gains.flat_total + other_sources.flat_total,
        tax_before_surcharge=slab_tax_after_rebate + flat_rate_tax,
        slab_tax_after_rebate=slab_tax_after_rebate,
        flat_rate_tax=flat_rate_tax,                 # capped at 15% per §8.1
        regime=regime,
        rules=rules,
        trace=trace,
    )

    # ── 7. Cess ──────────────────────────────────────────────────────────
    cess = quantize((slab_tax_after_rebate + flat_rate_tax + surcharge) * Decimal("0.04"))
    trace.step("cess", input=..., rate=Decimal("0.04"), result=cess)

    # ── 8. Total & balance ───────────────────────────────────────────────
    total_tax = slab_tax_after_rebate + flat_rate_tax + surcharge + cess
    prepaid   = sum_prepaid_taxes(filing_id)
    balance   = total_tax - prepaid
    trace.step("total", input=..., result=total_tax)
    trace.step("balance", input={"total_tax": total_tax, "prepaid": prepaid},
               result=balance)

    trace.persist()
    return TaxResult(
        regime=regime, statute=statute,
        gti=gti_normal, deductions=deductions, taxable=taxable_normal,
        slab_tax=slab_tax, rebate_87a=rebate, flat_rate_tax=flat_rate_tax,
        surcharge=surcharge, cess=cess, total_tax=total_tax,
        prepaid=prepaid, balance=balance, trace_id=trace.id,
    )
```

### 12.1 Money discipline

- **All monetary values are `Decimal`**, never `float`. Use `from decimal import Decimal, ROUND_HALF_UP`.
- Define `quantize(x) = x.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)`.
- Quantize at every step's `result`; never at intermediate sub-expressions.
- ITR forms round to the nearest rupee at the **end** (`ROUND_HALF_UP` to `Decimal("1")`). MVP keeps two-decimal precision internally and rounds-to-rupee only on the final summary / PDF.

### 12.2 Why this order matters

- 87A applies **before** surcharge (rebate reduces the tax base on which surcharge sits).
- Flat-rate taxes are added **after** 87A (rebate ineligible) but **before** surcharge (surcharge applies to all tax).
- Cess is always **last** and on the full tax+surcharge.
- Marginal relief on surcharge is computed **as part of** `apply_surcharge` — it cannot be a post-hoc correction.
- Marginal relief on 87A is computed **as part of** `apply_87a` — likewise.

---

## 13. Rule JSON shapes

All rules persist in [`country_rules.rule_json`](SCHEMA.md#74-country_rules) as JSON, versioned, with dual-admin approval ([API_CONTRACTS.md §7](API_CONTRACTS.md)).

### 13.1 `income_slab_*` (FY 2025-26 new regime example)

```json
{
  "slabs": [
    { "from": 0,       "to": 400000,  "rate": 0.00 },
    { "from": 400000,  "to": 800000,  "rate": 0.05 },
    { "from": 800000,  "to": 1200000, "rate": 0.10 },
    { "from": 1200000, "to": 1600000, "rate": 0.15 },
    { "from": 1600000, "to": 2000000, "rate": 0.20 },
    { "from": 2000000, "to": 2400000, "rate": 0.25 },
    { "from": 2400000, "to": null,    "rate": 0.30 }
  ]
}
```

### 13.2 `rebate_87a` (FY 2025-26 new regime)

```json
{
  "threshold_income":              1200000,
  "rebate_cap":                    60000,
  "marginal_relief":               true,
  "applies_to_residents_only":     true,
  "excludes_flat_rate_tax":        true,
  "section_ref":                   "87A",
  "source_ref":                    "Finance Act 2025, amendment to Section 87A"
}
```

### 13.3 `surcharge` (FY 2025-26 new regime)

```json
{
  "bands": [
    { "from_income": 5000000,  "to_income": 10000000, "rate": 0.10 },
    { "from_income": 10000000, "to_income": 20000000, "rate": 0.15 },
    { "from_income": 20000000, "to_income": null,     "rate": 0.25 }
  ],
  "marginal_relief":            true,
  "max_on_special_rate_income": 0.15,
  "section_ref":                "115BAC"
}
```

### 13.4 `cess`

```json
{ "name": "Health and Education Cess", "rate": 0.04, "section_ref": "Finance Act 2018" }
```

### 13.5 `standard_deduction`

```json
{ "amount": 75000, "regimes": ["new"], "applies_to": ["salary", "pension"], "section_ref": "16(ia)" }
```

### 13.6 `deduction_*` (one rule per Chapter VI-A section)

```json
{
  "section":             "80C",
  "cap":                 150000,
  "shared_cap_with":     ["80CCC", "80CCD(1)"],
  "regimes":             ["old"],
  "eligible_components": ["lic", "ppf", "epf", "elss", "tuition", "home_loan_principal"]
}
```

### 13.7 `flat_rate_111a` / `112` / `112a` / `115bb`

```json
{
  "section":      "112A",
  "rate":         0.125,
  "threshold":    125000,
  "exempt_below": true,
  "indexation":   false,
  "regimes":      ["old", "new"]
}
```

Splitting the rule store by section (rather than one mega-rule) means a single Finance Act amendment touches only its own rule rows — the rest stay at their existing versions.

---

## 14. Calculation trace — schema & user-facing explainability

### 14.1 Why the trace exists

> "If you cannot replay the trace and reproduce the number, the engine has a bug." — [ARCHITECTURE.md §5.3](ARCHITECTURE.md)

The trace doubles as:

- **Audit evidence** for the officer review (L1 – L5).
- **User-facing explanation** ("why am I paying ₹X?").
- **Replay test fixture** in CI.

### 14.2 Trace schema (FY 2025-26 salaried example)

```jsonc
{
  "filing_id": "fil_d4…",
  "regime":  "new",
  "statute": "ITA1961",
  "fy":      "FY2025-26",
  "rule_versions": {
    "income_slab_new_regime": 4,
    "rebate_87a":             3,
    "surcharge":              2,
    "cess":                   1,
    "standard_deduction":     5
  },
  "steps": [
    {
      "step": 1,
      "op": "sum_head_salary",
      "section_ref": "15-17",
      "input": { "transactions": ["tx_1", "tx_2"] },
      "breakdown": [
        { "label": "Basic salary",   "amount": "960000.00" },
        { "label": "HRA",            "amount": "192000.00", "regime_treatment": "taxable_in_new" },
        { "label": "Special allow.", "amount": "48000.00"  }
      ],
      "result": "1200000.00",
      "human_explanation": "Sum of all salary components from your Form 16. HRA is fully taxable under the new regime."
    },
    {
      "step": 2,
      "op": "apply_standard_deduction",
      "rule_id": "rul_a1…", "rule_version": 5,
      "section_ref": "16(ia)",
      "input": "1200000.00", "amount": "75000.00",
      "result": "1125000.00",
      "human_explanation": "Standard deduction of ₹75,000 — available to salaried filers under the new regime (Finance Act 2024 raised this from ₹50,000)."
    },
    {
      "step": 3,
      "op": "apply_slab",
      "rule_id": "rul_a2…", "rule_version": 4,
      "section_ref": "115BAC",
      "input": "1125000.00",
      "breakdown": [
        { "band": "0 – 4,00,000",        "rate": 0.00, "amount_in_band": "400000.00", "tax": "0.00"     },
        { "band": "4,00,000 – 8,00,000", "rate": 0.05, "amount_in_band": "400000.00", "tax": "20000.00" },
        { "band": "8,00,000 – 11,25,000","rate": 0.10, "amount_in_band": "325000.00", "tax": "32500.00" }
      ],
      "result": "52500.00",
      "human_explanation": "Your ₹11,25,000 taxable income falls across three slabs of the new regime. You pay 0% on the first ₹4L, 5% on the next ₹4L, and 10% on the remaining ₹1.25L. Total slab tax: ₹52,500."
    },
    {
      "step": 4,
      "op": "apply_rebate_87a",
      "rule_id": "rul_a3…", "rule_version": 3,
      "section_ref": "87A",
      "input": { "taxable": "1125000.00", "slab_tax": "52500.00" },
      "applied": true,
      "rebate_amount": "52500.00",
      "rebate_cap": "60000.00",
      "result": "0.00",
      "human_explanation": "Section 87A rebate fully applied. Your taxable income (₹11,25,000) is under the ₹12,00,000 threshold (Finance Act 2025), so the rebate cancels your entire slab tax. You pay zero income tax."
    },
    {
      "step": 5,
      "op": "apply_surcharge",
      "rule_id": "rul_a4…",
      "input": { "tax_before_surcharge": "0.00", "total_income": "1125000.00" },
      "applied_rate": 0.00,
      "reason": "income_below_50_lakh",
      "result": "0.00",
      "human_explanation": "No surcharge — your total income is below ₹50,00,000."
    },
    {
      "step": 6,
      "op": "apply_cess",
      "rule_id": "rul_a5…",
      "input": "0.00", "rate": 0.04, "result": "0.00",
      "human_explanation": "Health and Education Cess is 4% of (tax + surcharge). Since tax is zero, cess is zero."
    },
    {
      "step": 7,
      "op": "total",
      "input": { "slab_after_rebate": "0.00", "surcharge": "0.00", "cess": "0.00" },
      "result": "0.00",
      "human_explanation": "Total tax payable: ₹0."
    },
    {
      "step": 8,
      "op": "balance",
      "input": { "total_tax": "0.00", "tds": "12000.00" },
      "result": "-12000.00",
      "human_explanation": "TDS of ₹12,000 was already deducted from your salary. Refund due: ₹12,000."
    }
  ],
  "final_total": "0.00"
}
```

### 14.3 The user-facing "why" panel

The frontend renders steps in plain English using each step's `human_explanation`. Layout:

```
┌────────────────────────────────────────────────────────────────────┐
│  How your tax was calculated — FY 2025-26 (New Regime)             │
├────────────────────────────────────────────────────────────────────┤
│  Gross salary income                                ₹12,00,000.00  │
│   ↓                                                                │
│  ─ Standard Deduction (§16(ia))                       −₹75,000.00  │
│     Available to salaried filers under new regime.                 │
│   ↓                                                                │
│  Taxable income                                     ₹11,25,000.00  │
│                                                                    │
│  Slab tax (§115BAC) — split into bands:                            │
│    First ₹4,00,000 @ 0%                                       ₹0   │
│    Next  ₹4,00,000 @ 5%                                ₹20,000     │
│    Next  ₹3,25,000 @ 10%                               ₹32,500     │
│                                                       ─────────    │
│    Slab tax                                            ₹52,500     │
│                                                                    │
│  − Section 87A rebate                                  ₹52,500     │
│    Why: Your taxable income ₹11.25L is under ₹12L,                 │
│    so the rebate cancels your slab tax entirely.                   │
│                                                       ─────────    │
│  Tax after rebate                                            ₹0    │
│                                                                    │
│  Surcharge                       Not applicable                    │
│  Why: Total income below ₹50L threshold.                           │
│                                                                    │
│  + Health & Education Cess (4%)                              ₹0    │
│                                                       ─────────    │
│  Total tax                                                   ₹0    │
│  − TDS paid (Form 16)                                  ₹12,000     │
│                                                       ─────────    │
│  Refund due                                            ₹12,000     │
│                                                                    │
│  [ View detailed trace ▾ ]   [ Compare with old regime ]           │
└────────────────────────────────────────────────────────────────────┘
```

Every "Why" comes from the corresponding trace step. No magic strings in the UI — the engine emits, the UI renders.

### 14.4 Replay verifier (in CI)

```python
def replay(trace: dict, rules_snapshot: dict) -> Decimal:
    """Pure function: takes a stored trace and the rule_versions snapshot,
       re-applies every op, and returns the recomputed final_total."""
    ...

def test_every_trace_replays(stored_trace):
    assert replay(stored_trace, stored_trace["rule_versions"]) == \
        Decimal(stored_trace["final_total"])
```

Any commit that breaks replay equality fails CI.

---

## 15. Implementation plan

### 15.1 Directory layout

```
Backend/app/
├── services/
│   └── taxation/
│       ├── __init__.py
│       ├── engine.py              # compute_tax(filing_id, regime) → TaxResult
│       ├── result.py              # TaxResult dataclass
│       ├── money.py               # Decimal helpers, quantize, ROUND_HALF_UP
│       ├── trace.py               # TraceBuilder, persist, replay
│       ├── rules.py               # RuleResolver, RuleBundle (FY-pinned)
│       ├── statute.py             # ITA1961 / ITA2025 dispatch
│       ├── heads/
│       │   ├── salary.py
│       │   ├── house_property.py
│       │   ├── pgbp.py
│       │   ├── capital_gains.py
│       │   └── other_sources.py
│       └── ops/
│           ├── deductions.py      # apply_deduction_rules
│           ├── slab.py            # apply_slab
│           ├── rebate.py          # apply_87a (incl. marginal relief)
│           ├── flat_rate.py       # apply_flat_rate for 111A/112/112A/115BB
│           ├── surcharge.py       # apply_surcharge (incl. marginal relief)
│           └── cess.py            # apply_cess
├── api/v1/
│   ├── filings.py                 # POST /precheck-regime, POST /calculate
│   └── rules.py                   # admin CRUD on country_rules
└── tests/
    └── taxation/
        ├── conftest.py            # rule fixtures per FY
        ├── test_slab.py
        ├── test_87a.py
        ├── test_surcharge_marginal.py
        ├── test_capital_gains.py
        ├── test_end_to_end.py     # golden vectors
        ├── test_replay.py         # every trace replays
        └── golden/
            ├── fy2025_26_new.yaml
            ├── fy2025_26_old.yaml
            └── fy2024_25_new.yaml
```

### 15.2 Build phases

Each phase ends with a green test suite and is independently demoable.

**Phase 0 — Plumbing (1 day)**

- `money.py` with `Decimal`, `quantize`, `ROUND_HALF_UP`.
- `trace.py` — `TraceBuilder.step(op, **kwargs)`, `persist(db)`, `replay(steps, rules)`.
- `RuleResolver` — pulls active rule for `(country, tax_year, rule_type, statute)` with version selection per [ARCHITECTURE.md §5.2](ARCHITECTURE.md).
- Seed migration: insert FY 2024-25, FY 2025-26, FY 2026-27 rules for slab / 87A / surcharge / cess / standard_deduction.

**Phase 1 — Slab + cess + total (1 day)**

- `apply_slab` with full band-walking, emits per-band breakdown.
- `apply_cess`.
- Compose into `compute_tax` for the simplest path: salary-only, no deductions, no surcharge, no rebate, both regimes, FY 2025-26.
- Tests: slab boundary fixtures at every band edge for current and prior FY.

**Phase 2 — Standard deduction + Chapter VI-A (2 days)**

- `apply_deduction_rules` — composable, per-section, regime-aware.
- Each Chapter VI-A section as its own rule.
- 80C shared-cap logic (80C + 80CCC + 80CCD(1) ≤ ₹1.5L).
- Trace emits per-section steps.

**Phase 3 — 87A rebate with marginal relief (1 day)**

- `apply_87a` — handles old/new thresholds, marginal-relief range, resident-only flag, flat-rate exclusion.
- Tests: cliff fixtures at:
  - **Old:** ₹4,99,999 / ₹5,00,000 / ₹5,00,001.
  - **New FY 2025-26:** ₹11,99,999 / ₹12,00,000 / ₹12,00,001 / ₹12,30,000 / ₹12,75,000.
  - **New FY 2024-25:** ₹6,99,999 / ₹7,00,000 / ₹7,00,001 / ₹7,10,000 (regression for old filings).

**Phase 4 — Surcharge with marginal relief (2 days)**

- `apply_surcharge` walks bands, computes normal-rate surcharge, computes marginal-relief cap at each threshold, takes min.
- New-regime 25% top cap.
- **15% cap on §111A / §112 / §112A / dividend** surcharge.
- Tests: notch fixtures at ₹50,00,000 / ₹50,00,001 / ₹51,00,000; ₹1Cr / ₹1Cr+1 / ₹1.1Cr; ₹2Cr; ₹5Cr.

**Phase 5 — Flat-rate sections §111A, §112A, §112, §115BB (2 days)**

- `apply_flat_rate` per section.
- §112A ₹1.25L exemption (FY 2025-26); ₹1L for FY 2024-25 (rule version difference).
- §112 grandfather: immovable property pre-23-Jul-2024 → compute both methods, pick lower.
- Capital-gains head pipeline produces `flat_rate_buckets`.
- Tests: STT-paid vs non-STT cases; pre/post 23 Jul 2024 split-FY scenarios; lottery winnings via §115BB.

**Phase 6 — Head pipelines (3 days)**

- Salary: Form 16 mapping → income components → standard deduction → professional tax (old only) → HRA (old only, city-rate from rule).
- House Property: NAV, 30% standard deduction §24(a), interest §24(b).
- Other Sources: interest, dividend, lottery (§115BB routing), family pension (§57(iia) deduction allowed in new regime).
- Capital Gains: STCG/LTCG bucketing, §111A/§112A/§112 routing by `asset_class` + `holding_period` + `stt_paid`.
- PGBP: presumptive §44AD / §44ADA only in MVP.

**Phase 7 — API surface (1 day)**

- `POST /api/v1/filings/{id}/precheck-regime` (already specified — [API_CONTRACTS.md §6.2](API_CONTRACTS.md)).
- `POST /api/v1/filings/{id}/calculate` — supports `regime: "old" | "new" | "both"`. When `both`, runs twice, returns both totals and `recommended_regime` (lower-total).
- `GET /api/v1/filings/{id}/summary` — renders trace into the "why panel" payload.
- Persists `calculation_traces` row(s); updates `tax_returns.{old_regime_total_tax, new_regime_total_tax, recommended_regime, balance_payable, tds_paid}`.

**Phase 8 — Frontend "why" panel (2 days)**

- Render trace as the panel in [§14.3](#143-the-user-facing-why-panel).
- Collapsible "View detailed trace" shows each step's `input` / `breakdown` / `result`.
- Side-by-side old-vs-new comparison view.

**Phase 9 — Admin rule console (2 days)**

- Versioned rule editor, dual-admin approval.
- Diff view between rule versions.
- Effective-date pinning.

**Phase 10 — Statute switch for FY 2026-27 (1 day)**

- `statute.py` dispatch.
- Section-ref rewriter (§115BAC → §202, §87A → §156) — rule-driven via a section-mapping table.
- Re-seed rules for FY 2026-27 with `statute = "ITA2025"`.
- Tests: same FY 2025-26 golden vectors should pass on FY 2026-27 (rates unchanged) but with §202 in the trace instead of §115BAC.

### 15.3 Total estimate

~16 working days for MVP-grade engine covering resident-individual ITR-1/ITR-2 shapes across FY 2024-25, FY 2025-26 and FY 2026-27, excluding indexation and pre-23-Jul-2024 split scenarios beyond the immovable-property grandfather.

---

## 16. Correctness strategy

| Layer | What it catches |
|---|---|
| **Decimal lint** | `float()` on any monetary path → CI fail. |
| **Boundary fixtures** | Off-by-rupee at every slab / 87A / surcharge boundary. |
| **Property test: monotone tax** | `tax(income+1) ≥ tax(income)` except across documented marginal-relief notches (explicit allow-list). |
| **Property test: regime parity** | At income = ₹0, both regimes return ₹0 tax. |
| **Property test: 87A continuity** | At threshold ± ₹1, tax difference ≤ ₹1 in marginal-relief range. |
| **Golden vectors** | ~50 cases from the income-tax department's published ready-reckoner / e-filing portal calculator; must match to the rupee. |
| **Replay verifier** | Every produced trace re-runs through `replay()` and equals stored `final_total`. |
| **Cross-section idempotence** | Recomputing the same filing twice produces the same trace (rule versions pinned). |
| **Mutation testing** | One rule constant flipped → at least one golden test must fail (no dead constants). |
| **Cross-statute parity** | FY 2025-26 (ITA1961) and FY 2026-27 (ITA2025) golden vectors with same inputs must match (rates unchanged) — proves the statute switch is purely cosmetic. |

### 16.1 Golden vector format

```yaml
# tests/taxation/golden/fy2025_26_new.yaml
- name: salaried_12L_zero_tax
  fy: FY2025-26
  regime: new
  inputs:
    salary_gross: 1275000
    standard_deduction_eligible: true
    age: 32
    residency: resident
  expected:
    gti: 1275000.00
    deductions: 75000.00
    taxable: 1200000.00
    slab_tax: 60000.00
    rebate_87a: 60000.00
    cess: 0.00
    total_tax: 0.00

- name: salaried_12L_plus_1_marginal_relief
  fy: FY2025-26
  regime: new
  inputs: { salary_gross: 1275001, standard_deduction_eligible: true }
  expected:
    taxable: 1200001.00
    slab_tax: 60000.10
    rebate_87a: 59999.10        # = 60000.10 − (1200001 − 1200000) ⇒ tax capped at ₹1
    cess: 0.04
    total_tax: 1.04

- name: salary_20L_with_25pct_slab
  fy: FY2025-26
  regime: new
  inputs: { salary_gross: 2075000, standard_deduction_eligible: true }
  expected:
    taxable: 2000000.00
    # 0 + 20000 (4L-8L @5%) + 40000 (8L-12L @10%) + 60000 (12L-16L @15%) + 80000 (16L-20L @20%) = 200000
    slab_tax: 200000.00
    rebate_87a: 0.00
    cess: 8000.00
    total_tax: 208000.00
```

The engine never sees these values directly. The test is: build the rule bundle from migrations + run `compute_tax` + assert each field of `expected`.

---

## 17. Worked examples (FY 2025-26)

### 17.1 Salaried ₹12.75L gross — the headline "zero tax" case

Inputs: gross salary ₹12,75,000; new regime; resident; age < 60.

1. **Standard deduction (§16(ia)):** −₹75,000 → **taxable = ₹12,00,000**.
2. **Slab tax (§115BAC, FY 2025-26):**
   - 0% on first ₹4L = ₹0
   - 5% on ₹4L–₹8L (₹4L) = ₹20,000
   - 10% on ₹8L–₹12L (₹4L) = ₹40,000
   - **Slab tax = ₹60,000.**
3. **87A rebate:** taxable ₹12L ≤ threshold ₹12L → rebate = `min(60000, 60000) = ₹60,000`. **Tax after rebate = ₹0.**
4. **Surcharge:** income ≤ ₹50L → ₹0.
5. **Cess:** 4% × ₹0 = ₹0.
6. **Total tax = ₹0.**

User-facing message: *"You owe nothing for FY 2025-26. The Finance Act 2025 raised the §87A rebate threshold to ₹12L, so a salaried income up to ₹12.75L is fully covered after standard deduction."*

### 17.2 87A marginal relief at ₹12,30,000 taxable

Inputs: gross ₹13,05,000 → standard deduction → taxable **₹12,30,000**.

1. **Slab tax:**
   - 0% on ₹4L = ₹0
   - 5% on ₹4L = ₹20,000
   - 10% on ₹4L = ₹40,000
   - 15% on ₹30,000 = ₹4,500
   - **Slab tax = ₹64,500.**
2. **87A:** taxable > ₹12L → rebate-cap unmet on full amount.
   - Without marginal relief: tax = ₹64,500 (rebate denied entirely → cliff).
   - **Marginal relief**: tax after rebate ≤ taxable − ₹12L = ₹30,000.
   - So rebate = max(0, 64,500 − 30,000) = **₹34,500**.
   - Tax after rebate = **₹30,000**.
3. **Cess:** 4% × ₹30,000 = ₹1,200.
4. **Total tax = ₹31,200.**

User-facing explanation: *"Without §87A marginal relief, earning ₹30,000 more than the ₹12L threshold would have cost you ₹64,500 extra in tax. The marginal-relief rule caps your tax at the income increase (₹30,000), so you pay ₹31,200 (₹30,000 + 4% cess) instead of ₹67,080."*

### 17.3 Salaried ₹20L — well above 87A range

Inputs: gross ₹20,75,000 → standard deduction → taxable **₹20,00,000**, new regime.

1. **Slab tax:**
   - 0% on ₹4L = ₹0
   - 5% on ₹4L = ₹20,000
   - 10% on ₹4L = ₹40,000
   - 15% on ₹4L = ₹60,000
   - 20% on ₹4L = ₹80,000
   - **Slab tax = ₹2,00,000.**
2. **87A:** taxable > ₹12L → not applicable.
3. **Surcharge:** income ≤ ₹50L → ₹0.
4. **Cess:** 4% × ₹2,00,000 = ₹8,000.
5. **Total tax = ₹2,08,000.**

### 17.4 Surcharge marginal relief at ₹50,00,001 (new regime)

Taxable ₹50,00,001, salary only.

1. **Slab tax (new regime FY 2025-26):**
   - 0% on ₹4L = ₹0
   - 5% on ₹4L = ₹20,000
   - 10% on ₹4L = ₹40,000
   - 15% on ₹4L = ₹60,000
   - 20% on ₹4L = ₹80,000
   - 25% on ₹4L = ₹1,00,000
   - 30% on ₹26,00,001 = ₹7,80,000.30
   - **Slab tax ≈ ₹10,80,000.30.**
2. **87A:** not applicable.
3. **Surcharge:** income > ₹50L → 10%.
   - Without marginal relief: ₹1,08,000.03 → tax+surcharge = ₹11,88,000.33.
   - At ₹50,00,000 exact: slab tax = ₹10,79,999.70, surcharge = ₹0, total = ₹10,79,999.70.
   - **Marginal-relief cap:** surcharge ≤ (₹50,00,001 − ₹50,00,000) − (slab_tax_delta of ₹0.60) ≈ **₹0.40**.
   - Effective surcharge after relief: **₹0.40**.
4. **Cess:** 4% × (₹10,80,000.30 + ₹0.40) = ₹43,200.03.
5. **Total tax ≈ ₹11,23,200.73.**

User-facing message: *"Without marginal relief you would have owed ₹1,08,000 more in surcharge for earning ₹0.30 more. Section 115BAC marginal-relief provisions cap your surcharge at the income increase above ₹50L."*

### 17.5 Old vs new comparison at ₹18,00,000 gross salary (FY 2025-26)

Assume the taxpayer has maxed 80C (₹1.5L), 80D (₹25k), and 80CCD(1B) NPS (₹50k) under old regime.

| | Old regime | New regime |
|---|---|---|
| Gross salary | ₹18,00,000 | ₹18,00,000 |
| Standard deduction | −₹50,000 | −₹75,000 |
| 80C | −₹1,50,000 | (n/a) |
| 80D | −₹25,000 | (n/a) |
| 80CCD(1B) NPS | −₹50,000 | (n/a) |
| **Taxable** | **₹15,25,000** | **₹17,25,000** |
| Slab tax | 12,500 + 1,00,000 + 1,57,500 = **₹2,70,000** | 0 + 20k + 40k + 60k + 25,000 = **₹1,45,000**\* |
| 87A | n/a | n/a (taxable > ₹12L) |
| Surcharge | 0 | 0 |
| Cess (4%) | ₹10,800 | ₹5,800 |
| **Total tax** | **₹2,80,800** | **₹1,50,800** |
| **Recommended** | | ✓ saves ₹1,30,000 |

\* New regime slab tax = 0 (0-4L) + ₹20,000 (4L-8L @ 5%) + ₹40,000 (8L-12L @ 10%) + ₹60,000 (12L-16L @ 15%) + ₹25,000 (16L-17.25L @ 20%) = **₹1,45,000**.

The summary panel renders both, highlights the lower one, and shows the savings number ([API_CONTRACTS.md §6.3](API_CONTRACTS.md) — `recommended_regime` + `savings`).

### 17.6 Salary + LTCG on equity (mixed slab + flat-rate)

Inputs: gross salary ₹10,00,000; LTCG under §112A on listed equity (STT paid) = ₹3,00,000 realised during FY 2025-26. New regime, resident, age < 60.

1. **Salary head:** ₹10,00,000 − ₹75,000 standard deduction = **₹9,25,000 normal taxable**.
2. **Slab tax on normal income:**
   - 0 + ₹20,000 (4-8L @ 5%) + ₹12,500 (8L-9.25L @ 10%) = **₹32,500**.
3. **87A:**
   - Total income for eligibility = ₹9,25,000 + ₹3,00,000 = ₹12,25,000.
   - **Total income exceeds ₹12L threshold → 87A NOT applicable** (even on the slab portion). Engine emits `applied: false, reason: total_income_exceeds_threshold_when_including_special_rate_income`.
   - Tax after rebate = **₹32,500.**
4. **§112A flat-rate tax:**
   - LTCG ₹3,00,000 − ₹1,25,000 exemption = ₹1,75,000 taxable.
   - Tax = ₹1,75,000 × 12.5% = **₹21,875**.
5. **Surcharge:** total income ₹12.25L < ₹50L → ₹0.
6. **Cess:** 4% × (₹32,500 + ₹21,875) = ₹2,175.
7. **Total tax = ₹56,550.**

User-facing explanation: *"Your ₹3L equity LTCG is taxed separately under §112A at 12.5% on the amount above ₹1.25L. Because your total income (salary + LTCG) exceeds ₹12L, the §87A rebate does not apply — not even to the salary portion. Total tax: ₹56,550."*

This case is the most-misunderstood one for new users — the engine **must** surface the "total-income test" explicitly so the user understands why their salary-only intuition (₹0 under 87A) doesn't hold.

---

## 18. Open questions / out-of-scope

### 18.1 Deferred to v1.1+

- **Indexation for §112 LTCG** on immovable property acquired before 23 Jul 2024 (the grandfather scenario). Needs CII table and dual computation.
- **AMT (§115JC) / MAT.**
- **Non-resident slabs and §115H provisions.**
- **HUF, AOP, BOI taxpayer types.**
- **Foreign tax credit (§90/91, Form 67).**
- **Interest under §§234A/B/C** — currently advisory-only display, not folded into balance.
- **ITR-U (updated return)** — Finance Act 2025 extended the window to 48 months but the calculation engine for additional-tax-on-updated-return is its own sub-spec.

### 18.2 Decisions to make

- **Rounding policy at PDF generation time** — round to rupee per ITR convention, or keep paisa? *Recommendation: round to rupee on the final PDF and submission payload; keep paisa internally for trace fidelity.*
- **How to surface a Finance Act mid-year amendment** that changes rates within an FY (rare, but happened with capital-gains in FY 2024-25). *Recommendation: store two rule rows with non-overlapping `effective_from`/`effective_to`; transactions resolve to the right version by transaction date, not filing date.*
- **Default to which regime for first-time filers** — §115BAC(1A) makes new the default; with FY 2025-26 rebate, this is now even more taxpayer-friendly. *Recommendation: pre-select new in UI; compute both; let user override.*
- **Audit log when rules change post-submission** — submitted filings must be **frozen** to the rule versions used at submission. The pinned `rule_versions` on `calculation_traces` is the freeze. Officer review must replay against pinned versions, not current.
- **Statute-switch handling for the AY 2027-28 transition** — when a taxpayer files FY 2026-27 in mid-2027, the engine uses ITA 2025 sections; but if they file a revised return for FY 2025-26 in the same period, the engine must use ITA 1961 sections. Statute is **per-filing**, not per-current-date.

---

## Appendix A — Statutory reference index

### A.1 Common references — IT Act 1961 (FY ≤ 2025-26)

| Section | Subject |
|---|---|
| §15–17 | Salaries |
| §16(ia) | Standard deduction (salaried) |
| §22–27 | Income from house property |
| §24(b) | Home-loan interest |
| §28–44DB | PGBP |
| §44AD / §44ADA | Presumptive taxation |
| §45–55A | Capital gains |
| §56–59 | Income from other sources |
| §57(iia) | Family pension deduction |
| §80C–80U | Chapter VI-A deductions |
| §87A | Rebate for residents |
| §111A | STCG on listed equity (STT paid) — 20% from 23 Jul 2024 |
| §112 | LTCG general — 12.5% without indexation from 23 Jul 2024 |
| §112A | LTCG on listed equity (STT paid) — 12.5% above ₹1.25L from 23 Jul 2024 |
| §115BAC | New regime; §115BAC(1A) default since FY 2023-24 |
| §115BAC(6) | Lifetime lock for business-income taxpayers |
| §115BB | Lottery, betting, race winnings — 30% flat |
| §139(1) | Return due dates |
| §139(8A) | Updated return (ITR-U); window extended to 48 months by Finance Act 2025 |
| §192–§206C | TDS / TCS provisions |
| §234A/B/C | Interest for default in payment |
| §234F | Late-fee for late filing |

### A.2 Renumbering map — IT Act 1961 → IT Act 2025 (FY ≥ 2026-27)

| 1961 Section | 2025 Section | Subject |
|---|---|---|
| §15–17 | §13–19 | Salaries |
| §16(ia) | §13(ia) | Standard deduction |
| §22–27 | §20–25 | House property |
| §24(b) | §22(b) | Home-loan interest |
| §28–44DB | §26–66 | PGBP |
| §45–55A | §67–91 | Capital gains |
| §56–59 | §92–95 | Other sources |
| §80C–80U | §123–151 (approx) | Chapter VI-A (renumbered & consolidated) |
| §87A | §156 (old-regime rebate) | Rebate — old regime |
| (new) | §156 (new-regime rebate) | Rebate — new regime (₹12L / ₹60k) |
| §111A | §195 | STCG listed equity |
| §112 | §196 | LTCG general |
| §112A | §197 | LTCG listed equity |
| §115BAC | **§202** | New regime |
| §115BB | §203 | Lottery / winnings |
| §139(1) | §263 | Return due dates |
| §234F | §391 | Late fee |

> The engine's `section_ref` field in the trace must be statute-aware. A single helper `section_ref(symbol, statute)` looks up the right number — e.g. `section_ref("new_regime", "ITA1961") → "115BAC"`, `section_ref("new_regime", "ITA2025") → "202"`.

## Appendix B — Finance Act history

- **Finance Act 2020** — introduced §115BAC (optional new regime).
- **Finance Act 2022** — capped surcharge on §111A / §112 / §112A / dividend at 15%.
- **Finance Act 2023** — made §115BAC the default; restructured slabs; raised standard deduction in new regime to ₹50k; raised §87A rebate to ₹25k / ₹7L in new regime.
- **Finance Act 2024** — widened new-regime slabs (5% band to ₹7L); raised standard deduction in new regime to ₹75k; raised §80CCD(2) cap to 14% in new regime; **restructured capital gains** (effective 23 Jul 2024): §111A 15% → 20%, §112A 10%/₹1L → 12.5%/₹1.25L, §112 indexation largely removed; raised family-pension deduction to ₹25k.
- **Finance Act 2025** — **biggest change in years**: new-regime slabs restructured (basic exemption ₹3L → ₹4L; 25% slab inserted; 30% starts at ₹24L); **§87A rebate threshold ₹7L → ₹12L** and **cap ₹25k → ₹60k**; ITR-U window extended to 48 months.
- **Income Tax Act 2025** — passed 2025, in force **1 Apr 2026**. Replaces the IT Act 1961 entirely. Section numbers change, rates do not.
- **Finance Act 2026** — no slab changes; HRA 50% city list expanded to add Bengaluru, Pune, Hyderabad, Ahmedabad (now 8 cities).

---

*End of spec. Implementation tracked against the phases in [§15.2](#152-build-phases).*

---

## Sources (verified 2026-05-14)

- [Income Tax Slabs FY 2025-26 (AY 2026-27): New & Old Tax Regime Rates — ClearTax](https://cleartax.in/s/income-tax-slabs)
- [New Income Tax Slabs and Rates for FY 2025-26 (AY 2026-27) — Bajaj Finserv](https://www.bajajfinserv.in/investments/income-tax-slabs)
- [As amended by Finance Act, 2025 — TAX RATES — incometaxindia.gov.in](https://incometaxindia.gov.in/Tutorials/2%20Tax%20Rates.pdf)
- [Salaried Individuals for AY 2026-27 — Income Tax Department](https://www.incometax.gov.in/iec/foportal/help/individual/return-applicable-1)
- [NO INCOME TAX ON ANNUAL INCOME UPTO ₹12 LAKH UNDER NEW TAX REGIME — PIB Press Release](https://www.pib.gov.in/PressReleaseIframePage.aspx?PRID=2098406&reg=3&lang=2)
- [Income tax rebate under Section 87A as per Union Budget 2025-26 — Bajaj Finserv](https://www.bajajfinserv.in/insurance/rebate-under-section-87a)
- [Income Tax Act 2025: Ultimate Change Guide — CACube](https://cacube.in/income-tax-act-2025-ultimate-change-guide-full-section-mapping-status-corrections-and-every-major-change-detailed/)
- [Section 115BAC → Section 202 in the Income Tax Bill 2025 — IndiaFilings](https://www.indiafilings.com/learn/section-115bac-changes-to-section-202-in-the-new-income-tax-bill-2025/)
- [Income Tax Surcharge Rate and Marginal Relief for AY 2026-27 — ClearTax](https://cleartax.in/s/marginal-relief-surcharge)
- [Tax Rates | Surcharge | Cess for AY 2025-26 and 2026-27 — Taxmann](https://www.taxmann.com/post/blog/tax-rates-surcharge-cess)
- [Key Capital Gains Tax Rules for FY 2025-26 (AY 2026-27) — AnpTaxCorp](https://anptaxcorp.com/key-capital-gains-tax-rules-for-fy-2025-26-ay-2026-27/)
- [As amended by Finance Act, 2025 — TAX ON SHORT-TERM CAPITAL GAINS — incometaxindia.gov.in](https://incometaxindia.gov.in/tutorials/14-%20stcg.pdf)
- [Standard Deduction for Salaried Individuals in New and Old Tax Regime — ClearTax](https://cleartax.in/s/standard-deduction-salary)
- [Budget 2026-27: Income Tax Act 2026, tax slabs, and STT hike — HDFC Bank](https://www.hdfc.bank.in/blogs/union-budget/budget-2026-27-income-tax-act-2026-tax-slabs-stt)
- [New Income Tax Act 2025: Slabs & Simplification for FY 2026-27 — South Indian Bank](https://www.southindianbank.bank.in/blog/general-topics/budget-2026-decoded-6-direct-tax-reforms-that-will-make-your-financial-life-easier)
