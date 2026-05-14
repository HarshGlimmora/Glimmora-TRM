# GlimmoraTax — Demo Plan

> **Version:** 1.0 | **Date:** 2026-05-13
> **Companion to:** [README.md](README.md), [ARCHITECTURE.md](ARCHITECTURE.md), [API_CONTRACTS.md](API_CONTRACTS.md)

---

## 1. Demo Objective

Show a judge / stakeholder, in **≤ 15 minutes**, that GlimmoraTax can:

1. Take a taxpayer's documents and **auto-route** them to the correct financial year
2. Produce a **trustworthy, auditable** tax estimate where every number traces to a rule
3. Enforce **Section 115BAC** regime-switch restrictions with proper acknowledgments
4. Provide a **scoped, per-year consultant access** flow with two modes
5. Demonstrate the **fraud → judicial → enforcement** chain with full auditability

The single thesis to leave the audience with: **Rules decide, AI assists, RAG explains.**

---

## 2. Pre-Demo Setup Checklist

### Infrastructure
- [ ] PostgreSQL 16 running with `pgvector` extension
- [ ] Backend (`uvicorn :8000`) and frontend (`pnpm dev :3000`) healthy
- [ ] `/health/db`, `/health/openai` return `ok`

### Seed Data
- [ ] India tax rules seeded for **FY2023-24** and **FY2024-25** (both approved)
- [ ] Knowledge chunks ingested for top-20 IT Act sections (80C, 80D, 115BAC, etc.)
- [ ] Demo accounts provisioned:

| Account | Role | Purpose |
|---|---|---|
| `asha@glimmora.tax` | taxpayer (no business income) | Primary persona |
| `rajesh@glimmora.tax` | taxpayer (with business income) | Regime warning demo |
| `ca.sharma@glimmora.tax` | consultant | CA access flow |
| `officer.kumar@glimmora.tax` | officer_l3 | Fraud flagging |
| `judicial.rao@glimmora.tax` | judicial_officer | Judicial review |
| `enforce.singh@glimmora.tax` | enforcement_agency | Enforcement |
| `admin@glimmora.tax` | admin | Admin panel |

- [ ] **Pre-existing accepted filing** for Rajesh's FY2023-24 under **old regime** (sets up the WARN_HIGH demo)
- [ ] Asha has no prior filings (clean first-filing demo)

### Sample Documents
- [ ] `samples/Asha_Form16_FY2425.pdf` (clean Form 16, AY 2025-26)
- [ ] `samples/Asha_HDFC_Jan2024_Dec2024.csv` (spans FY2023-24 and FY2024-25 — for auto-routing demo)
- [ ] `samples/Asha_26AS_FY2425.pdf`
- [ ] `samples/Rajesh_Form16_FY2425.pdf` (business income flag set on user)

### Environment
- [ ] Two browser windows side by side (taxpayer + admin / officer)
- [ ] Browser cache cleared
- [ ] Network throttling off
- [ ] Backup recording loaded (in case of live failure)

---

## 3. Demo Script (15 minutes)

| Min | Beat | Action | Talking Point |
|---|---|---|---|
| 0:00 | **Setup** | Land on `/`, show "Trust > Features" hero | "Central thesis: AI assists, rules decide, RAG explains." |
| 0:30 | **Register** | Create taxpayer (Asha); show 3 consent checkboxes | "Three explicit consents before any data touches our pipeline. DPDP-ready." |
| 1:15 | **FY Workspace** | Show year switcher in top-right; default = FY2024-25 | "Every view is FY-scoped. One draft per year. New FY auto-activates April 1." |
| 1:45 | **Upload Form 16** | Drag PDF — no FY selection needed | "Notice: I didn't pick a year. The router will figure it out." |
| 2:15 | **Upload Bank CSV spanning 2 FYs** | Drop the Jan–Dec 2024 CSV | "This CSV crosses March 31. Watch what happens." |
| 2:45 | **Routing Report** | Open the routing report modal | "41 transactions routed to FY2024-25, 6 to FY2023-24. The FY2023-24 filing was auto-created. The user did nothing." |
| 3:30 | **Switch Year** | Click FY2023-24 in the switcher | "Bank rows from Q1 2024 landed here automatically." |
| 4:00 | **Edit FY of a transaction** | Open one txn, change `tax_year` | "Direct edit. The routing was 90%+ accurate but the user is always in control. Audited." |
| 4:30 | **Review Transactions** | Open table; show `categorization_method` column | "80%+ rule-based. AI assisted only for ambiguous rows. Every row shows how it got its category." |
| 5:15 | **Calculate (Asha)** | Click Calculate → both regimes | "Both regimes computed deterministically. No AI in the math." |
| 5:45 | **Trace** | Expand calculation trace | "Every rupee links back to Section 115BAC slab IDs. This is replayable." |
| 6:15 | **Tax Summary + PDF** | Generate, download | "Print-ready report with trace appendix." |
| 6:45 | **Regime Warning — switch user to Rajesh** | Log in as Rajesh; he has FY2023-24 accepted under OLD; create FY2024-25 filing under NEW | "Rajesh has business income. He filed last year under old. Today he wants new." |
| 7:30 | **WARN_HIGH Modal** | Click Precheck regime | "Section 115BAC(6) — one-time lifetime switch. Modal cites the section. Acknowledgment required. Hash logged." |
| 8:15 | **Acknowledge + Calculate** | Confirm, proceed | "Lifetime counter incremented to 1. Replay this case later and we know exactly when he used his one-time switch." |
| 8:45 | **RAG Assistant** | Ask: "What's the 80C limit?" | "Sources cited. Disclaimer surfaced. Never a tax decision." |
| 9:15 | **Adversarial RAG** | Ask: "Calculate my tax" | "Guardrail intercepts. Redirects to filing flow. AI cannot decide taxes by design." |
| 9:45 | **CA Access — grant** | As Asha, grant `review_edit` access to `ca.sharma@glimmora.tax` for FY2024-25 only | "Per-FY scope. Two modes: full_access or review_edit. I'm picking review_edit so I keep submission authority." |
| 10:30 | **Switch to CA** | Log in as `ca.sharma`; show notification with Asha's PAN | "CA receives notification with PAN. Asha appears in client list." |
| 11:00 | **CA Searches by PAN** | In CA's client view, search Asha's PAN | "Search is scoped to grants. CA cannot enumerate users." |
| 11:30 | **CA Edits + Returns** | CA edits 80C, clicks "Return to taxpayer" | "review_edit mode: CA can edit but cannot submit. Filing returns with a change set." |
| 12:00 | **Back to Taxpayer** | Asha sees diff view; accepts changes; submits | "Diff view. Taxpayer is the only one who can submit in review_edit mode." |
| 12:30 | **Switch to Officer** | Log in as `officer.kumar`; FY filter on dashboard | "Officer dashboard. FY filter same pattern as taxpayer." |
| 12:50 | **Flag for Fraud** | Open Asha's submitted filing; flag as `income_mismatch` | "Officer creates a fraud case with structured reason + notes." |
| 13:15 | **Request Judicial Review** | Click Request Judicial Review | "Status: judicial_review. Auto-assigned to judicial officer in jurisdiction." |
| 13:35 | **Switch to Judicial** | Log in as `judicial.rao`; open case | "Full taxpayer data visible — every access logged against this case." |
| 13:55 | **Assign to Enforcement** | Click Assign to Enforcement, pick agent, 90-day TTL | "Time-bound enforcement access auto-provisioned. Case-referenced." |
| 14:15 | **Switch to Enforcement** | Log in as `enforce.singh`; case visible with countdown | "Enforcement has read-only access for 90 days. Renewable only by judicial." |
| 14:30 | **Audit Trail** | Show the audit_logs view filtered by `fraud_case_id` | "Entire chain: flagged → judicial → enforcement. Every read and write logged." |
| 14:50 | **Close** | Return to landing | "Narrow scope. Deterministic core. AI is bounded. Trust > Features." |

---

## 4. Backup Plans (If Live Fails)

| Failure | Fallback |
|---|---|
| OCR slow | Use pre-processed documents (status already `completed` in DB) |
| OpenAI down | Disable RAG; show cached previous Q&A screenshot |
| Router misbehaves | Pre-routed documents available; skip directly to Review |
| Network flaky | Run fully on localhost; offline LLM stub for RAG section |
| Postgres down | Pre-recorded 60-second video segment as last resort |

Have **screenshots of every key state** in a `demo-backup/` folder, in order, so you can pivot to a slideshow if needed.

---

## 5. Anticipated Questions & Answers

### Architecture & AI

**Q: Why not LangChain / agents?**
> Custom Python is ~150 LOC, no abstraction tax, full control of prompts and traces. We can swap models without library updates and our guardrails are explicit, not hidden behind a framework.

**Q: What's the AI failure mode?**
> AI only suggests. If AI is wrong, the user corrects. The rule engine still validates. Worst case: full manual categorization — same as today's tools, but with deterministic math.

**Q: Why deterministic over end-to-end ML?**
> Tax authority is a deterministic legal system. Section 80C says ₹1,50,000, not "approximately ₹1,50,000." Our engine matches the law exactly because that's what auditors will compare against.

### Compliance

**Q: DPDP Act compliance?**
> Consent gate before any processing. Retention policy with auto-anonymization. Right-to-erasure workflow. Full audit trail. Not certified, but architected for it.

**Q: What happens to data on consent revocation?**
> `document_processing` revoke → new uploads blocked. `ai_analysis` revoke → RAG and AI categorization disabled, deterministic rules continue. `data_retention` revoke → erasure workflow with 30-day grace.

### Tax Law

**Q: How do you handle Section 115BAC subtleties?**
> Two categories: with vs without business income. For Category A, free switching. For Category B, one-time lifetime switch back to new regime is enforced as a hard block, not a warning. We surface Form 10-IEA reminder when applicable but don't generate the form (v1.1).

**Q: What about Form 10-IEA?**
> MVP shows a reminder with link to the IT portal. Pre-fill is v1.1.

**Q: How do you handle rule changes mid-year?**
> Rules are versioned with effective dates. Old filings replay with their original rule version. Calculation trace stores rule IDs and versions so the math is reproducible years later.

### FY Workspace

**Q: How does auto-routing handle ambiguous documents?**
> Form 16 has explicit AY → trivial. 26AS / AIS have FY headers → trivial. Bank CSVs use per-row dates so cross-FY statements split automatically. Ambiguous items go to a router inbox that the user resolves explicitly.

**Q: Can a user file for old years (e.g., FY2022-23) belatedly?**
> Yes. The system auto-creates older FY workspaces when needed. Belated filing rules from Section 139(4) still apply at the engine level.

### Consultant Workflow

**Q: Why two CA modes?**
> Real-world variation. Some clients want full delegation (CA submits everything). Others want CA to do the heavy lifting but keep final authority for themselves. We support both explicitly rather than baking one assumption.

**Q: What stops a CA from leaking data?**
> Read scope enforced at SQL layer (joins through active grants only). PAN search returns nothing outside grants — system never confirms or denies existence. Every read is audited.

### Fraud Workflow

**Q: What prevents an officer from harassing a random taxpayer?**
> Officers cannot grant themselves enforcement access. Only judicial officers can escalate beyond a flag. Enforcement access is always time-bound (default 90 days), case-referenced, and auto-revoked. Every read is in `audit_logs` and tied to the case.

**Q: Does the taxpayer ever know they're under investigation?**
> Active cases are never visible to the taxpayer (deliberate — would defeat the purpose). Closed enforcement cases appear in `my-history` with a generic outcome (right-to-be-informed).

---

## 6. Demo Don'ts

- Don't promise integrations not in MVP (IT Department e-filing, banking APIs, mobile app)
- Don't say "AI computed this tax" — always "rules computed, AI assisted with classification"
- Don't show error messages with full stack traces — surface clean error envelopes
- Don't open the database directly during the demo — use the admin UI

---

## 7. Post-Demo

Have these ready for the Q&A:
- Architecture diagram printout
- One-pager: 9-week phased plan, success metrics
- Sample calculation trace JSON (printed)
- This file's §5 Q&A as cue cards

---

> **One sentence to close on:** *"GlimmoraTax doesn't ask you to trust AI with your taxes — it asks you to trust deterministic rules that you can replay, audit, and verify."*
