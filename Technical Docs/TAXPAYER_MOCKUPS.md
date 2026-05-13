# GlimmoraTax — Taxpayer Frontend Mockups

> **Version:** 1.0 | **Date:** 2026-05-13
> **Role covered:** Taxpayer (other roles follow this same shape)
> **Companion to:** [README.md](README.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [API_CONTRACTS.md](API_CONTRACTS.md) · [SCHEMA.md](SCHEMA.md) · [USER_FLOWS.md](../../USER_FLOWS.md)

Visual mockups of every screen the taxpayer sees, grouped into three phases of the journey. Each mockup is a real SVG image — open it in any browser, VSCode preview, or GitHub for full fidelity.

---

## Phase 1 · First-time experience (Onboarding)

What a brand-new taxpayer sees from sign-up to a fully verified account.

![Taxpayer onboarding storyboard](../../diagrams/taxpayer-01-onboarding.svg)

**File:** [`diagrams/taxpayer-01-onboarding.svg`](../../diagrams/taxpayer-01-onboarding.svg)

| # | Screen | Route | What's shown |
|---|---|---|---|
| ① | **Register** | `/register` | Single-page form: name, email, password (with strength meter), PAN (monospace mask), phone (+91 prefix), city (drives CA directory), business-income toggle (with 115BAC hint), three consent checkboxes (DPDP). Primary CTA: **Create account**. |
| ② | **Verify email** | `/verify-email?token=…` | Email-client mock at top showing the verification email, then the green success state after the user clicks the link. Auto-redirects to phone verification after 2s. |
| ③ | **Verify phone (OTP)** | `/verify-phone` | Six split-input boxes auto-advancing, masked phone destination, resend timer (60s cooldown), and the 5-attempts lockout warning. Schema note: writes `users.phone_verified_at` and consumes the `user_verifications` row. |
| ④ | **Grant consents** | `/onboarding/consents` | Three large toggle cards — document processing, AI analysis, data retention — each with its cascade-on-revoke effect spelled out underneath. Green **All set** CTA at the bottom. |

**Key state at the end of Phase 1:**

- `users.email_verified_at` ✓
- `users.phone_verified_at` ✓
- `user_consents` rows for all three types `granted = true`
- The user is allowed to upload documents and (later) submit a filing.

---

## Phase 2 · Portal core — filing a return

What a verified user sees once they start their FY 2024-25 return. Six panels covering the entire filing lifecycle.

![Taxpayer portal core storyboard](../../diagrams/taxpayer-02-portal-core.svg)

**File:** [`diagrams/taxpayer-02-portal-core.svg`](../../diagrams/taxpayer-02-portal-core.svg)

| # | Screen | Route | What's shown |
|---|---|---|---|
| ① | **Home — onboarded** | `/home` | Top bar with FY switcher, lock/bell/profile icons. Welcome banner. Green "Account fully verified" panel. Hero card with 4-step progress (Consent ✓ → Upload → Review → Submit) and the **Begin filing** CTA. Side panels for "What you'll need" and the three-layer trust principle. |
| ② | **Upload documents** | `/filings/{id}/documents` | Drag-drop upload zone (no FY required). List of uploaded docs with status pills and routing reasons — including a bank CSV that auto-routed to **two** FYs. Bottom "FY Router report" callout explains the magic. |
| ③ | **Review transactions** | `/filings/{id}/transactions` | Progress bar (32 of 47 verified · 68%), filter chips, table with RULE / AI / MANUAL method pills, confidence scores, FY tags, and a per-row Verify button. Bottom legend explains the methods. Continue button disabled until 100% verified. |
| ④ | **Regime + 115BAC** | `/filings/{id}/regime` | Side-by-side old vs new regime cards (faded). **115BAC(6) modal** in front with full statutory text, the acknowledgment checkbox (text hash logged), source citation, and the red "I acknowledge" CTA. |
| ⑤ | **Summary** | `/filings/{id}/summary` | Income breakdown, tax computation, expandable calculation trace with rule citations (Finance Act 2024, Section 115BAC), TDS paid, balance payable, **Download PDF** and **Submit** buttons. |
| ⑥ | **Submit with OTP** | `/filings/{id}/submit` | Pre-submission checklist (5 green ticks), six-digit OTP input bound to the filing, acknowledgment checkbox, **Submit filing** CTA. Server notes at the bottom describe how `submit_otp_verification_id` is recorded on `tax_returns`. |

**Critical UX moments in Phase 2:**

- **No FY needed at upload** — the router does this for the user. This eliminates the most common error in legacy tools.
- **115BAC modal** — uses statutory language, requires explicit acknowledgment, logs a hash. The modal cannot be dismissed by clicking outside.
- **Submit-OTP** — bound to a specific `filing_id` so the OTP cannot be replayed against another filing. This is enforced by `chk_tax_returns_submit_otp` at the DB level.

---

## Phase 3 · Collaboration & portal features

What the taxpayer sees once they want to collaborate with a CA, or once their filing starts moving through the system.

![Taxpayer collaboration storyboard](../../diagrams/taxpayer-03-collaboration.svg)

**File:** [`diagrams/taxpayer-03-collaboration.svg`](../../diagrams/taxpayer-03-collaboration.svg)

| # | Screen | Route | What's shown |
|---|---|---|---|
| ① | **Consultant access — two paths** | `/consultant-access` | Side-by-side green **Path A · Directory** card with three real CA preview rows in Mumbai, and the amber **Path B · Invite code** card with the code-entry field and the CA-policy preview after lookup. |
| ② | **CA detail + grant request** | `/consultants/{id}` | CA profile (faded behind the modal): photo, ICAI #, bio, specializations, languages, service area. Self-attested warning banner. The **grant request modal** in front: access-mode radios, tax-year checkboxes, optional message, **Send request** CTA. |
| ③ | **Review CA's change-set** | `/filings/{id}/change-sets/{cs_id}` | Green return-banner with CA's note. Two diff panels (before in red, after in green) — one for a transaction category change, one for an 80C deduction. **Impact summary** showing tax savings. Three action buttons: reject, accept, accept-and-submit. |
| ④ | **Notifications inbox** | `/notifications` | Five sample notifications showing the lifecycle: officer L2 picked up filing, mismatch detected vs 26AS, CA returned filing, submission ack, phone verified. Plus a "What you'll never see here" 🔇 callout explaining the fraud-silence rule. |
| ⑤ | **Consent management** | `/settings/consent` | Settings sub-nav on the left, three large green consent rows on the right (each with its cascade-on-revoke explanation), bottom verification-status banner. |
| ⑥ | **RAG assistant (side panel)** | `/assistant` or floating launcher | Filing page faded behind, blue assistant panel on the right with suggested topics, a Q&A bubble (source-cited answer with section reference), the "Informational only" disclaimer, and a guardrail card demonstrating that "calculate my tax" is intercepted. |

**Three things to notice in Phase 3:**

- **Two paths to engage a CA** are presented at exactly equal weight — the directory for in-city, the invite code for out-of-city or pre-arranged.
- **Diff viewer is honest about impact** — the change-set screen shows the user *exactly* how the CA's edits change their tax, before they accept.
- **Fraud silence is explicit** — the notification inbox has a dedicated 🔇 callout listing what the taxpayer will never see, so trust is built through transparency about opacity.

---

## Color & shape conventions

All three storyboards use a consistent visual language:

| Element | Style |
|---|---|
| Frame header bar | Blue (`#1e40af`) for taxpayer flow · Green (`#166534`) for CA-collab flow |
| Primary CTA | Blue button, white text |
| Destructive / gate | Red (`#dc2626`) — also used for 115BAC modal |
| Soft warning / AI | Amber (`#fbbf24`) backgrounds, brown (`#78350f`) text |
| Success / verified | Green (`#16a34a`) |
| Trust / rule-cited | Indigo (`#3730a3`) |
| Metadata / schema notes | Italic slate (`#64748b`) at the bottom of each panel |
| Diff before/after | Red box (before) → arrow → green box (after) |

Status pills, OTP boxes, file-drop zones, regime cards, and the diff-viewer pattern are all reused across phases — and the SVGs document the canonical look for each one.

---

## What's not in these mockups (deferred)

- **Mobile / responsive layouts** — MVP is desktop-first per [README §What's NOT in MVP](README.md#whats-not-in-mvp)
- **Filing history / older FYs page** — straightforward derivative of the dashboard
- **Audit log page** (`/audit`) — simple timeline table; not visually distinctive
- **Forgot/reset password** — standard flow
- **Profile / address edit** — standard form, covered structurally in [HOMEPAGE_PLAN](HOMEPAGE_PLAN.md)

These will be added if needed during implementation. The 18 panels in the three storyboards cover every screen that has unique UX value or domain-specific design decisions.

---

## Next steps for other roles

The same storyboard format is planned for the remaining roles. Each will get a `<ROLE>_MOCKUPS.md` and a set of SVGs under `diagrams/`:

| Role | Phases to cover |
|---|---|
| **Consultant (CA)** | Onboarding (register, verify, profile, directory opt-in, generate invite code) · Portal (client list, client detail, edit transactions, return-to-taxpayer, full_access submit) |
| **Officer (L1 – L5)** | Worklist · Filing review · Escalation L1→L5 · Flagging fraud |
| **Judicial Officer** | Inbox · Case workspace · Decision (dismiss / assign-enforcement) |
| **Enforcement Agency** | Active cases · Time-bound access window · Investigate · Close |
| **Admin** | Rule change board (dual-approval) · User management · System health · Audit search |

---

> Living document. Update whenever a screen's layout, fields, or CTAs change in [API_CONTRACTS.md](API_CONTRACTS.md) or [USER_FLOWS.md](../../USER_FLOWS.md).
