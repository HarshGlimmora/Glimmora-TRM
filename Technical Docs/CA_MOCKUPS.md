# GlimmoraTax — Consultant (CA) Frontend Mockups

> **Version:** 1.0 | **Date:** 2026-05-13
> **Role covered:** Consultant (CA)
> **Companion to:** [TAXPAYER_MOCKUPS.md](TAXPAYER_MOCKUPS.md) · [README.md](README.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [API_CONTRACTS.md](API_CONTRACTS.md) · [SCHEMA.md](SCHEMA.md)

Visual mockups of every screen a CA sees, in two phases: **onboarding & engagement** (how clients find you) and **client management** (what you do once you have grants).

---

## Phase 1 · Onboarding & Engagement Strategy

How a CA registers, builds their profile, and chooses how taxpayers will find them — directory listing, invite codes, or both.

![CA onboarding storyboard](../../diagrams/ca-01-onboarding.svg)

**File:** [`diagrams/ca-01-onboarding.svg`](../../diagrams/ca-01-onboarding.svg)

| # | Screen | Route | What's shown |
|---|---|---|---|
| ① | **Register as Consultant** | `/register?role=consultant` | Same fields as a taxpayer (name, email, password, phone, city) plus a self-attested **ICAI membership #**. Amber banner makes the self-attestation explicit. Same DPDP three-consent block at the bottom. |
| ② | **Build your CA profile** | `/consultant/profile` | Photo, bio, specializations (chips), languages, years of experience, fee range indicator (budget / mid / premium). All fields write to `ca_profiles`. |
| ③ | **Path A · Directory listing** | `/consultant/profile` (toggles) | Green eligibility check ("✓ Email + ✓ Phone verified"), big **List me in the directory** toggle, "Accepting clients" sub-toggle, additional `serves_cities` chips. Live preview of how the card will appear in `/consultants?city=Mumbai`, plus a 4-step explainer of what happens next. |
| ④ | **Path B · Generate invite code** | `/consultant/invite-codes` | Code generation form (label, max_uses, default_access_mode ceiling, allowed_tax_years, validity days) on the left; the generated code `CA-7K3PQX` shown in monospace on the right with Copy / WhatsApp / Email buttons. Server stores only `code_hash` — the plaintext is shown **once**. |

**Key trust moments in Phase 1:**

- **Self-attested ICAI #** is surfaced both at registration and on the public profile so taxpayers can verify out-of-band.
- **Directory eligibility is gated** on email + phone verification at the DB query layer — you cannot be listed if you haven't verified.
- **Invite-code policy is a ceiling** — taxpayers redeeming the code cannot exceed `default_access_mode` or `allowed_tax_years`.

---

## Phase 2 · Client Management

What the CA sees once grants start coming in: pending requests, client list, opening a client, editing transactions, and either returning the filing (review_edit) or submitting on the taxpayer's behalf (full_access).

![CA client management storyboard](../../diagrams/ca-02-client-management.svg)

**File:** [`diagrams/ca-02-client-management.svg`](../../diagrams/ca-02-client-management.svg)

| # | Screen | Route | What's shown |
|---|---|---|---|
| ① | **Pending requests + client list** | `/consultant/dashboard` | KPI strip (active clients · pending · in review · needs attention · filed this FY). Two pending requests: one from the **directory** (needs accept/decline) and one auto-active from an **invite code**. Below: 7-client table with mode pills, status pills, last activity. |
| ② | **Client detail** | `/consultant/clients/{user_id}` | Identity card with PAN, email, phone, grant origin/mode, revoke button. Shared filings list. Tabs: Overview, Documents (3), **Transactions (47)**, Regime, Summary. Below: two transaction rows the CA has just edited (`category` flipped to `elss_80c` / `insurance_80c`). Green "edits captured to change_set" confirmation. Bottom CTA: **Return to Asha for her review & submission**. |
| ③ | **review_edit · Return to taxpayer** | Return modal | Change-set summary (2 transactions + 80C deduction change · projected ₹12,920 saving). Notes textarea for the taxpayer. Amber banner reminding the CA that submission authority stays with the taxpayer. Green **Return now** CTA. After-return success banner. |
| ④ | **full_access · CA submits** | Submit page | Red identity banner ("Submitting AS: Rajesh Patel · full_access grant"). Five-tick pre-submission checklist (transactions verified, regime chosen, calc up-to-date, CA's own email + phone verified, grant still active). **CA's own** OTP input + authorization checkbox. Red **Submit filing on Rajesh's behalf** CTA. |
| ⑤ | **Activity log (audit trail)** | `/consultant/audit` | Wide read-only table of every action the CA performed: `cag_directory_accepted`, `transaction_categorized` (before → after), `filing_calculated`, `filing_change_set_created`. Indigo "Trust by transparency" callout explaining that the same view is available to the client. Notifications the CA received during the engagement listed below. |

**Key UX moments in Phase 2:**

- **One-click "View client"** from notifications and from the client list — no PAN search needed. The notification payload carries `client_detail_url` precisely so this works.
- **Mode-driven CTAs**: `review_edit` shows **Return to taxpayer**, `full_access` shows **Submit on behalf** with the CA's own OTP. The two modes share no submit affordance.
- **Audit transparency** is a feature, not a side effect: the activity log explicitly notes that the same data is visible to the client. This is how trust is built — by making the asymmetry visible.

---

## Color & shape conventions

CA mockups use the green role color (`#166534` headers, `#dcfce7` accents). Within them:

- **Green chips** — active grants, accepted requests, verified items
- **Amber** — pending directory requests, AI-categorized transactions
- **Red** — full_access mode, revoke buttons, danger gates (submit-on-behalf)
- **Indigo / purple** — trust / audit panels
- **Slate italic at the bottom of every frame** — schema columns and API endpoints

Frame-level navigation: arrows show the canonical flow (register → profile → directory + codes → dashboard → client → return/submit → audit).

---

## What's not in these mockups (deferred)

- **Mobile / responsive** — desktop-first MVP
- **Client search by PAN** — straightforward derivative of the client list
- **Notification preferences** — generic settings UI, covered in HOMEPAGE_PLAN
- **Edit invite code** — codes are revoke-and-reissue, never edit (security)

---

> Living document. Update whenever a CA-facing screen or grant flow changes.
