# GlimmoraTax — Judicial Officer Frontend Mockups

> **Version:** 1.0 | **Date:** 2026-05-13
> **Role covered:** Judicial Officer
> **Companion to:** [OFFICER_MOCKUPS.md](OFFICER_MOCKUPS.md) · [ENFORCEMENT_MOCKUPS.md](ENFORCEMENT_MOCKUPS.md) · [API_CONTRACTS.md](API_CONTRACTS.md) · [SCHEMA.md](SCHEMA.md)

Visual mockups of the judicial workflow: receiving escalations, opening a case with full taxpayer data, and deciding whether to dismiss or assign to enforcement.

![Judicial storyboard](../../diagrams/judicial-storyboard.svg)

**File:** [`diagrams/judicial-storyboard.svg`](../../diagrams/judicial-storyboard.svg)

| # | Screen | Route | What's shown |
|---|---|---|---|
| ① | **Inbox** | `/judicial/cases?assigned_to_me=true` | KPI strip (pending · in deliberation · dismissed/30d · enforcement/30d · avg days). Queue of 5 cases color-coded by risk (HIGH red / MED amber / LOW green) with case ID, flag reason, taxpayer summary, flagging officer, age. **Recuse** tool at the bottom for conflict-of-interest declarations. |
| ② | **Case workspace** | `/judicial/cases/{id}` | Case header (pink). Tabs: Filing · Documents · Transactions · Trace · **Prior cases** · Officer note. Filing income breakdown with mismatch row in red. Calculation trace summary. **Amber "2 prior cases in this jurisdiction" callout** for cross-reference. **Slate audit-ribbon** at the bottom showing every read this session being logged (`fraud_case_data_accessed`). |
| ③ | **Decision modal** | `POST /judicial/cases/{id}/decide` | Two equal-weight options side-by-side: **Dismiss** (slate, with reason/notes textarea) and **Assign to Enforcement** (red, expanded with enforcement-agency dropdown · access duration · tax-year scope chips · justification textarea). Effects of each choice spelled out. |
| ④ | **Decisions log + renewal requests** | `/judicial/decisions` | Success banner confirming the assignment. Recent-decisions table (today's enforcement assignment highlighted). **Amber renewal-request widget** showing the enforcement agency's incoming request for +60 days. **Statute reference panel** with quick links to Sections 131, 271, 153A, 277. |

**Key UX decisions:**

- **No SLA on judicial review** — the deliberate "no clock" is itself communicated in the case header ("⏱ No SLA — taxpayer not notified · investigate at your pace"). This is a feature: due process should not be rushed.
- **Every read is audited** — the audit ribbon is a permanent fixture on the workspace page, not a hidden panel. The judicial officer should be conscious that their access is logged.
- **Enforcement assignment is a precision tool** — the modal collects agency, duration, **and specific tax_years** so the access can be scoped. A judicial officer can grant FY 2024-25 access without exposing FY 2022-23.
- **Renewal requests come back to judicial** — enforcement can request more time, but only judicial can grant. The widget is amber, not red, because it's a routine review item.

---

## Color & shape conventions

Pink as the role color (`#9d174d` headers, `#fce7f3` accents). The downstream enforcement role (red) is referenced at the assignment moment. Audit panel uses slate to mark its system-level nature.

---

## What's not in these mockups (deferred)

- **Decision archive search** — straightforward derivative of the decisions log
- **Recusal workflow detail** — single textarea modal, conventional UX
- **Judicial-to-judicial peer review** — out of MVP

---

> Living document.
