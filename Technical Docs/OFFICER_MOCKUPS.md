# GlimmoraTax — Officer (L1 – L5) Frontend Mockups

> **Version:** 1.0 | **Date:** 2026-05-13
> **Role covered:** Officer L1 through L5
> **Companion to:** [TAXPAYER_MOCKUPS.md](TAXPAYER_MOCKUPS.md) · [CA_MOCKUPS.md](CA_MOCKUPS.md) · [API_CONTRACTS.md](API_CONTRACTS.md) · [SCHEMA.md](SCHEMA.md)

Visual mockups of the officer's review-and-escalation workflow. Officers operate the **routine review pipeline** (L1 intake → L5 final authority); escalation to the **fraud chain** is a separate side exit available to L2+.

![Officer storyboard](../../diagrams/officer-storyboard.svg)

**File:** [`diagrams/officer-storyboard.svg`](../../diagrams/officer-storyboard.svg)

| # | Screen | Route | What's shown |
|---|---|---|---|
| ① | **Worklist + KPIs** | `/officer/worklist` | Top bar with officer level badge (L2 · Mumbai-Zone-A). KPI strip (assigned · team · SLA breaches · escalated · flagged). Filter pills (My / Team / SLA / High risk). Risk-coded table rows: HIGH (red) / MED (amber) / LOW (green) with SLA remaining. AI risk-signals panel at the bottom showing 26AS mismatches, deduction outliers, regime irregularities. |
| ② | **Open filing for review** | `/officer/filings/{id}` | Filing header with status pill (L2 · deeper_review). **Income-mismatch alert** in red showing declared (₹12L) vs 26AS (₹18L) with a "View 26AS extract" CTA. Income-breakdown table with MISMATCH row highlighted. Calculation-trace card (replayable · 4 rule citations · trace_id). Officer note textarea at the bottom. |
| ③ | **Decision page** | `PUT /admin/filings/{id}/review` | Four large action cards in a 2×2 grid: **Accept** (green) · **Request revision** (amber) · **Escalate to L3** (amber) · **Flag for fraud** (red, L2+ only). Currently-selected action banner ("Escalate to L3") with notes textarea. |
| ④ | **Flag fraud modal** | `POST /fraud-cases` | Modal with structured `flag_reason` radio group (`income_mismatch` selected) and `flag_notes` textarea. **Slate "Taxpayer silence rule" card** prominently explains that the taxpayer will NOT be notified once flagged. Red **Flag fraud** CTA. Footnote on the partial unique index that prevents duplicate open cases. |
| ⑤ | **Request judicial review** | `POST /fraud-cases/{id}/request-judicial-review` | Case header (status: flagged · 2 days). Preferred-officer dropdown (defaults to auto-assign round-robin in jurisdiction). Long justification textarea. **Pink "After this handoff" panel** clarifying access transitions (officer keeps read-only · judicial gets full · taxpayer still silent). |
| ⑥ | **My flagged cases** | `/officer/fraud-cases?flagged_by=me` | Three cards showing the lifecycle: one in **judicial_review** (pink), one in **enforcement_assigned** (red), one **closed** (slate). Each card shows the next-stage handler and your read-only status. Indigo footer panel listing what the officer can do after flagging. |

**Key UX decisions:**

- **L1 cannot flag fraud** — the action card is hidden for L1, shown for L2+. Same RBAC rule lives in the API and the DB.
- **The taxpayer-silence rule has dedicated UI** — explicit, non-dismissible callout on the flag modal so officers can't ignore the rule.
- **The L1 → L5 review pipeline is visible to the taxpayer** through notifications; the fraud chain is not. Officers see both pipelines but in different surfaces.
- **AI risk signals never auto-act** — they only highlight rows in the worklist and add chips. Officer always decides.

---

## Color & shape conventions

Officer mockups use amber as the role color (`#92400e` headers, `#fef3c7` accents). Risk-level chips use the universal HIGH/MED/LOW color triple (red/amber/green). The fraud chain to the right (judicial pink / enforcement red) is shown as a downstream destination in Frame ⑤.

---

## What's not in these mockups (deferred)

- **L4 / L5 oversight views** — they reuse the L2/L3 layout with broader scope (team-wide instead of my-worklist).
- **Per-jurisdiction admin overrides** — admin manages, not the officer.
- **Bulk actions** — officers act on one filing at a time by policy.

---

> Living document.
