# GlimmoraTax — Enforcement Agency Frontend Mockups

> **Version:** 1.0 | **Date:** 2026-05-13
> **Role covered:** Enforcement Agency (PMLA / CBI / FIU / ED units)
> **Companion to:** [JUDICIAL_MOCKUPS.md](JUDICIAL_MOCKUPS.md) · [API_CONTRACTS.md](API_CONTRACTS.md) · [SCHEMA.md](SCHEMA.md)

Visual mockups of the enforcement workflow. Access is **always time-bound**, **case-referenced**, and **auto-revokes** on closure or TTL — these constraints define the UX.

![Enforcement storyboard](../../diagrams/enforcement-storyboard.svg)

**File:** [`diagrams/enforcement-storyboard.svg`](../../diagrams/enforcement-storyboard.svg)

| # | Screen | Route | What's shown |
|---|---|---|---|
| ① | **Active cases dashboard** | `/enforcement/cases?status=enforcement_assigned` | KPI strip (active · expiring &lt; 48h · renewals pending · closed/quarter · confirmed rate). **Amber expiring banner** for 3 cases under 48h. Case table sorted by expiry: cases under 24h are red, under 48h are amber, fresh assignments are white. **Slate "no global search" callout** at the bottom making the case-scoping rule visible. |
| ② | **Case workspace** | `/enforcement/cases/{id}` | **Permanent red countdown banner** at the top with the progress bar showing time remaining. Case header with case ref + external case # (`PMLA/2026/0823`). Evidence-checklist tabs (✓ retrieved items in green · ○ pending items with retrieve links). **Amber "out of scope" callout** for any FY not in `enforcement_access.tax_years`. |
| ③ | **Renewal request** | `POST /enforcement/cases/{id}/renew` | Red expiring banner pinned at top. Justification textarea (must include rationale). Requested-extension input (60 days) + optional scope-change chip (`+ FY 2022-23`). Red **Request renewal from Judicial** CTA. Notes confirming the notification is `fraud_case_renewal_requested` and the taxpayer is NOT informed. |
| ④ | **Close case** | `POST /enforcement/cases/{id}/close` | Case header. Four mutually-exclusive outcome cards: `tax_liability_confirmed` (selected, red) · `no_fraud_found` · `partial_findings` · `escalated_externally`. Notes textarea visible to judicial. Red **Close case → access auto-revoked** CTA. Footer confirming `enforcement_access.revoked_at` is set automatically. |

**Key UX decisions:**

- **Time pressure is visible everywhere** — the countdown is not a tucked-away clock; it's a permanent red banner on the case page. Designed to make TTL impossible to ignore.
- **No "extend it yourself" affordance** — renewal must go through judicial. The renewal form is the only way to ask for more time. This prevents enforcement from self-extending.
- **Scope creep is structurally prevented** — accessing a tax year outside `enforcement_access.tax_years` shows an amber "out of scope" panel with a "request scope extension" CTA, not a "force open" button.
- **Closure outcome is structured** — the four enum values map directly to `enforcement_outcome` so reporting and downstream actions (penalty calc, escalation paths) are unambiguous.

---

## Color & shape conventions

Red as the role color (`#991b1b` headers, `#fee2e2` accents) — chosen to communicate the gravity of enforcement access. The dual relationship with judicial (pink) is preserved on the renewal screen.

---

## What's not in these mockups (deferred)

- **Inter-agency handoff** (PMLA → CBI) — `escalated_externally` outcome closes the case in GlimmoraTax; the external system is out of scope
- **Evidence export bundle** — generic PDF/ZIP export, conventional UX
- **Notifications-only enforcement dashboard** — covered by the cases list

---

> Living document.
