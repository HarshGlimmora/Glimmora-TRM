# GlimmoraTax — Architecture

> **Version:** 1.1 | **Date:** 2026-05-13
> **Companion to:** [README.md](README.md) and [API_CONTRACTS.md](API_CONTRACTS.md)

This document describes the system architecture, trust model, and core workflows including regime-switch warnings (aligned with Section 115BAC), consultant access (two modes), and the fraud → judicial → enforcement chain.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Three-Layer Trust Model](#2-three-layer-trust-model)
3. [Component Map](#3-component-map)
4. [Service Boundaries](#4-service-boundaries)
5. [Tax Engine Internals](#5-tax-engine-internals)
6. [Regime Switch Warning (Section 115BAC)](#6-regime-switch-warning-section-115bac)
7. [Consultant Access Workflow](#7-consultant-access-workflow)
8. [Fraud → Judicial → Enforcement Workflow](#8-fraud--judicial--enforcement-workflow)
9. [RAG Pipeline](#9-rag-pipeline)
10. [Security & Compliance Architecture](#10-security--compliance-architecture)
11. [Database Schema (Updated)](#11-database-schema-updated)
12. [Deployment Topology](#12-deployment-topology)

---

## 1. System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                              │
│  Next.js 14 (App Router) + TailwindCSS + TypeScript              │
└──────────────────────────────────────────────────────────────────┘
                              │ HTTPS / JSON
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                     API GATEWAY (FastAPI)                        │
│  CORS · Rate limit · JWT verify · RBAC · Audit emit              │
└──────────────────────────────────────────────────────────────────┘
   │       │        │         │         │         │         │
   ▼       ▼        ▼         ▼         ▼         ▼         ▼
 Auth   Docs    AI/OCR    Taxation    RAG    Consultant  Fraud
                                              Access     Cases
   │       │        │         │         │         │         │
   └───────┴────────┴─────────┴─────────┴─────────┴─────────┘
                              │
                ┌─────────────┴──────────────┐
                ▼                            ▼
       PostgreSQL 16 + pgvector     Local Filesystem
                              │
                              ▼
                       OpenAI API
                  (chat + embeddings)
```

---

## 2. Three-Layer Trust Model

```
┌─────────────────────────────────────────────────────┐
│  Layer 1: DETERMINISTIC CORE (Authority)            │
│  Tax calculations, slabs, deductions, validations   │
│  Reads rules from DB. 100% reproducible.            │
│  → DECIDES taxes                                    │
├─────────────────────────────────────────────────────┤
│  Layer 2: AI ASSIST (Subordinate)                   │
│  OCR + ambiguous categorization                     │
│  AI suggests → human confirms → rules validate      │
│  → SUGGESTS classifications                         │
├─────────────────────────────────────────────────────┤
│  Layer 3: RAG EXPLANATION (Read-only)               │
│  Tax law explanations, policy lookup, FAQ           │
│  No write access to tax data                        │
│  → EXPLAINS but never changes anything              │
└─────────────────────────────────────────────────────┘
```

If Layer 2 fails, Layer 1 still works (with manual categorization).
If Layer 3 fails, nothing else is affected.

---

## 3. Component Map

| Component | Owns | Reads | Writes | External |
|---|---|---|---|---|
| **Auth Service** | Users, sessions | `users`, `user_consents` | `users`, `user_consents`, `audit_logs` | bcrypt |
| **Document Service** | Uploads, metadata | `documents` | `documents`, FS | — |
| **AI/OCR Service** | Extraction, categorization | `documents`, `country_rules` | `transactions`, `audit_logs` | PaddleOCR, pdfplumber, OpenAI |
| **Taxation Service** | Filings, calculations | `transactions`, `country_rules`, `tax_returns` | `tax_returns`, `audit_logs` | — |
| **Rules Service** | Tax rules | `country_rules` | `country_rules`, `audit_logs` | — |
| **RAG Service** | Tax knowledge Q&A | `knowledge_chunks` | `knowledge_chunks`, `audit_logs` | OpenAI |
| **Consultant Access Service** | CA ↔ taxpayer grants | `consultant_access_grants` | `consultant_access_grants`, `notifications`, `audit_logs` | — |
| **Fraud Case Service** | Fraud lifecycle | `fraud_cases`, `tax_returns` | `fraud_cases`, `enforcement_access`, `audit_logs` | — |
| **Compliance Service** | Consent, retention | `user_consents` | `user_consents`, `audit_logs` | — |

### Cross-Service Rules

1. No service writes outside its owned tables.
2. `audit_logs` is append-only, written by all services through a shared emitter.
3. Tax calculations only happen in the Taxation service.
4. RAG is strictly read-only over user data — it can only read `knowledge_chunks`.

---

## 4. Service Boundaries

Trust boundaries crossed by data, in order of sensitivity:

| Boundary | From → To | Required Checks |
|---|---|---|
| **B1** | Browser → API | JWT verify, schema validate, CSRF |
| **B2** | API → Service | RBAC scope, consent gate |
| **B3** | Service → DB | Parameterized queries, row-level access filters |
| **B4** | Service → FS | Path traversal guard, type whitelist |
| **B5** | Service → OpenAI | PII redaction, `ai_analysis` consent active |

> [!IMPORTANT]
> B5 is the most sensitive. No user-derived text leaves to OpenAI without an active `ai_analysis` consent and PII redaction.

---

## 5. Tax Engine Internals

### 5.1 Calculation Algorithm

```python
def compute_tax(filing_id, regime):
    rules     = load_active_rules(country, tax_year)
    txns      = load_verified_transactions(filing_id)
    trace     = []

    income    = sum_income_by_category(txns)
    deductions = apply_deduction_rules(txns, rules, regime, trace)
    taxable   = income - deductions
    slab_tax  = apply_slab_rules(taxable, rules[regime + "_slab"], trace)
    surcharge = apply_surcharge(slab_tax, taxable, rules["surcharge"], trace)
    cess      = (slab_tax + surcharge) * rules["cess"]["rate"]
    total     = slab_tax + surcharge + cess

    persist_trace(filing_id, trace)
    return TaxResult(...)
```

### 5.2 Rule Resolution

For `(country, tax_year, rule_type)`:
1. `SELECT FROM country_rules WHERE is_active=true AND effective_from <= today AND (effective_to IS NULL OR effective_to >= today)`
2. If multiple match, pick highest `version`.
3. If none match, raise `RuleNotFoundError` — never fall back to defaults.

### 5.3 Calculation Trace

Every produced tax number must be derivable from `calculation_trace`. If you cannot replay the trace and reproduce the number, the engine has a bug.

```json
{
  "filing_id": "fil_d4…",
  "regime": "new",
  "steps": [
    { "step": 1, "op": "sum_income", "category": "salary",
      "tx_ids": ["tx_1…","tx_2…"], "result": "1200000.00" },
    { "step": 2, "op": "apply_slab", "rule_id": "rul_a1…",
      "rule_source": "Finance Act 2024, Section 115BAC",
      "rule_version": 1, "input": "1175000.00",
      "breakdown": [...], "result": "86250.00" }
  ],
  "final_total": "89700.00"
}
```

---

## 6. Regime Switch Warning (Section 115BAC)

**Source of truth:** Section 115BAC of the Income Tax Act, 1961 (as amended by Finance Act 2023 and Finance Act 2024). The new regime is the **default** from AY 2024-25 (FY 2023-24) onwards.

### 6.1 The Actual Government Rules

Section 115BAC creates two distinct taxpayer categories with different switching rights:

#### Category A — Taxpayer **without** income from business or profession
*(salaried, pensioner, capital gains, house property, other sources only)*

- **Can switch freely every assessment year.**
- The choice is made by simply selecting the regime when filing the return (no Form 10-IEA required).
- No restriction on the number of switches over a lifetime.

#### Category B — Taxpayer **with** income from business or profession
*(business income, professional income, etc.)*

Governed by **Section 115BAC(6)**:
- The new regime applies by default.
- To opt **out** of the new regime (i.e., elect the old regime), the taxpayer must file **Form 10-IEA on or before the due date** under Section 139(1) for that AY.
- Once opted out of the new regime, the taxpayer **may opt back into the new regime only ONCE in their lifetime**.
- After that one-time switch back to the new regime, they **lose the right to opt back into the old regime ever again** (for as long as they have business income).

### 6.2 System Behavior Matrix

The system tracks each taxpayer's filing history and classifies their switching state. Detection produces one of these outcomes per calculation request:

| Taxpayer Category | Previous Regime | Requested Regime | Lifetime Switch-Backs Used | System Response |
|---|---|---|---|---|
| **A (no business)** | none / any | any | n/a | `INFO` — Salaried taxpayers may switch every year |
| **A (no business)** | new | old | n/a | `INFO` — Switch allowed; no restriction |
| **A (no business)** | old | new | n/a | `INFO` — Switch allowed; no restriction |
| **B (business)** | none | new | 0 | `OK` — Default regime; no warning |
| **B (business)** | none | old | 0 | `WARN_HIGH` — Form 10-IEA required; switching back to new is a one-time right |
| **B (business)** | new | old | 0 | `WARN_HIGH` — Opting out of new regime. Form 10-IEA required. Switch back is one-time only |
| **B (business)** | old | new | 0 | `WARN_HIGH` — This is your **one-time** lifetime switch back to new regime. After this, you cannot opt back to old |
| **B (business)** | old | new | ≥1 | `BLOCK` — One-time switch-back already exercised; cannot return to new regime |
| **B (business)** | new (after switch-back) | old | ≥1 | `BLOCK` — Cannot opt back to old regime; one-time switch-back already used |

### 6.3 Detection Logic (pseudocode)

```python
def evaluate_regime_request(user_id, requested_regime, tax_year):
    history = load_filing_history(user_id)
    has_business = user_has_business_or_professional_income(user_id, tax_year)
    last         = history.most_recent_submitted(tax_year_lt=tax_year)
    switch_backs = history.count_switch_backs_to_new()   # lifetime

    # Category A — no business income
    if not has_business:
        if last and last.regime_used != requested_regime:
            return Result(level="INFO",
                code="cat_a_free_switch",
                message="You're switching regimes. Salaried/non-business taxpayers may switch every year.")
        return Result(level="OK")

    # Category B — business / professional income
    prev_regime = last.regime_used if last else None

    if requested_regime == "old":
        if switch_backs >= 1:
            return Result(level="BLOCK",
                code="115bac_lifetime_lock",
                message="You have already exercised your one-time switch back to the new regime. "
                        "Under Section 115BAC(6), you cannot opt back to the old regime.")
        return Result(level="WARN_HIGH",
            code="115bac_opt_out",
            requires_form="10-IEA",
            message="You are opting out of the new regime. You must file Form 10-IEA "
                    "on or before the Section 139(1) due date. Your right to switch back to "
                    "the new regime is a ONE-TIME lifetime option.")

    # requested_regime == "new"
    if prev_regime == "old":
        if switch_backs >= 1:
            return Result(level="BLOCK", code="115bac_lifetime_lock", ...)
        return Result(level="WARN_HIGH",
            code="115bac_one_time_switch_back",
            message="This is your ONE-TIME lifetime switch back to the new regime under "
                    "Section 115BAC(6). After this filing, you cannot opt back to the old "
                    "regime for as long as you have business/professional income.")

    return Result(level="OK")
```

### 6.4 Behavior by Level

| Level | UI Treatment | API Behavior |
|---|---|---|
| `OK` | No banner | Calculation proceeds normally |
| `INFO` | Soft banner, no acknowledgment required | Calculation proceeds |
| `WARN_HIGH` | Modal with Section 115BAC citation, Form 10-IEA reminder where applicable | Calculation request must include `acknowledged_regime_switch: true` + signed acknowledgment text; rejected otherwise with `regime_acknowledgment_required` |
| `BLOCK` | Modal explaining the lifetime lock; user cannot proceed | API returns 422 `regime_switch_blocked`; no override path |

### 6.5 User Experience (WARN_HIGH example)

```
┌──────────────────────────────────────────────────────────────────┐
│ ⚠ Section 115BAC(6) — One-Time Lifetime Switch                   │
│                                                                  │
│ You filed FY2023-24 under the OLD regime.                        │
│ You are now requesting the NEW regime for FY2024-25.             │
│                                                                  │
│ Because you have business/professional income, Section 115BAC(6) │
│ permits this switch ONLY ONCE in your lifetime. After this       │
│ filing, you will not be able to return to the old regime for as  │
│ long as you continue to have business income.                    │
│                                                                  │
│ I have read and understood Section 115BAC(6) and confirm I am    │
│ exercising my one-time lifetime switch back to the new regime.   │
│                                                                  │
│ Source: Income Tax Act, 1961 — Section 115BAC(6)                 │
│                                                                  │
│        [ Cancel ]                  [ I acknowledge — Proceed ]   │
└──────────────────────────────────────────────────────────────────┘
```

### 6.6 Audit & Traceability

Every `WARN_HIGH` acknowledgment writes an audit record:

```json
{
  "action": "regime_switch_acknowledged",
  "user_id": "...",
  "filing_id": "...",
  "previous_regime": "old",
  "requested_regime": "new",
  "lifetime_switch_backs_before": 0,
  "lifetime_switch_backs_after": 1,
  "section_referenced": "115BAC(6)",
  "form_10iea_required": false,
  "acknowledged_text_hash": "sha256:...",
  "ip_address": "...",
  "timestamp": "..."
}
```

The `tax_returns` table records `regime_used` and `regime_switch_acknowledged` on the filing itself. The `users` table maintains a derived counter `lifetime_switch_backs_to_new` that the engine reads to enforce the block.

### 6.7 Edge Cases

- **First filing ever**: no warning. Default to new regime per the law.
- **Category change** (a taxpayer gains business income for the first time): warning shown explaining that future switching is now restricted.
- **Form 10-IEA**: MVP does not generate the form. It surfaces a reminder with a link to the official form on the IT Department portal. v1.1 will pre-fill.
- **Mid-year rule change**: if Section 115BAC is amended, rules are re-versioned (see [§5.2](#52-rule-resolution)) and the engine uses the version in effect at the start of the tax year.

See [API_CONTRACTS.md §5.2](API_CONTRACTS.md#52-filing-calculation) for the request / response contract.

---

## 7. Consultant Access Workflow

**Principle:** A CA has zero access to any taxpayer's data unless that taxpayer explicitly grants it. There is no broad "search all users" capability. The taxpayer also chooses **how much** access to grant.

### 7.1 Two Access Modes

When granting access to a CA, the taxpayer selects one of two modes:

| Mode | Read | Edit | Submit / Apply to IT Portal | Return to Taxpayer |
|---|---|---|---|---|
| **`full_access`** | ✓ | ✓ | ✓ — CA can finalize and submit on taxpayer's behalf | not required |
| **`review_edit`** | ✓ | ✓ | ✗ — CA cannot submit | ✓ — CA must return filing to taxpayer; only the taxpayer can submit |

#### `full_access` — Complete delegation
- CA can do everything the taxpayer can: edit transactions, recalculate, submit the filing, and (when integrated) auto-apply to the IT Department e-filing portal.
- Suitable for clients who want their CA to handle everything end-to-end.
- Highest blast radius — confirmation dialog explicitly states "Your CA will be able to submit your return without further confirmation from you."

#### `review_edit` — Review with final say
- CA can read everything and edit transactions, categories, and deductions.
- When the CA is done, they **return** the filing to the taxpayer with notes.
- The taxpayer reviews CA's changes (a diff view shows before/after) and is the **only one** who can submit.
- Suitable for taxpayers who want CA expertise but retain final control.

Both modes are read-write on the data; the only difference is **who holds submission authority**.

### 7.2 Grant Lifecycle

```
        ┌─────────┐
        │ pending │  ← taxpayer creates grant, CA notified
        └────┬────┘
             │
   ┌─────────┼──────────┐
   │         │          │
 accept    decline   TTL expires
   │         │          │
   ▼         ▼          ▼
┌────────┐ ┌──────────┐ ┌─────────┐
│ active │ │ rejected │ │ expired │
└───┬────┘ └──────────┘ └─────────┘
    │
    │ taxpayer revokes  OR  CA returns filing (review_edit, optional)
    ▼
┌─────────┐
│ revoked │
└─────────┘
```

- `pending` → `active`: CA accepts the request
- `active` → `revoked`: taxpayer revokes anytime (CA loses access immediately)
- `pending` → `expired`: TTL hit without acceptance (default 14 days)

### 7.3 Flow Diagram

```
Taxpayer                  System                       Consultant
   │                        │                              │
   │ 1. Grant access:       │                              │
   │    email + mode        │                              │
   │    (full | review_edit)│                              │
   │───────────────────────▶│                              │
   │                        │ 2. Create grant              │
   │                        │    (status: pending)         │
   │                        │ 3. Notify CA — includes      │
   │                        │    taxpayer PAN + mode ─────▶│
   │                        │                              │
   │                        │ 4. CA opens notification     │
   │                        │◀─────────────────────────────│
   │                        │ 5. CA accepts                │
   │                        │    grant.status = active     │
   │                        │                              │
   │                        │ 6. Client now visible in     │
   │                        │    CA's client list          │
   │                        │ 7. CA can search by PAN      │
   │                        │    (limited to active grants)│
   │                        │                              │
   │              REVIEW_EDIT FLOW                         │
   │                        │ 8a. CA edits filing          │
   │                        │     status: in_review_by_ca  │
   │                        │ 9a. CA "returns to taxpayer" │
   │                        │     status: revision_returned│
   │ 10a. Taxpayer reviews  │                              │
   │      CA's diff, submits│                              │
   │                        │                              │
   │              FULL_ACCESS FLOW                         │
   │                        │ 8b. CA edits + submits       │
   │                        │     directly                 │
   │                        │ 9b. (optional) auto-apply    │
   │                        │     to IT portal             │
   │                        │                              │
   │ 11. Taxpayer can       │                              │
   │     revoke anytime ───▶│                              │
   │                        │ grant.status = revoked       │
```

### 7.4 What the CA Can See

When a grant is `active`, the CA has access (per the mode chosen) to:
- Taxpayer's name, PAN, contact
- Uploaded documents (metadata + content)
- Transactions (verified and unverified)
- Filings (drafts, submitted, accepted) for the granted tax years
- Calculation traces

The CA **cannot**:
- Grant access to anyone else
- See the taxpayer's other consultants
- Access data outside the granted tax years
- Modify users' consent settings

### 7.5 PAN Search Scope

The CA's PAN search **only returns matches from their active grants**. The system never reveals whether a PAN exists outside the CA's grants.

```sql
SELECT u.* FROM users u
JOIN consultant_access_grants g ON g.target_user_id = u.id
WHERE g.consultant_id = :me
  AND g.status = 'active'
  AND u.pan ILIKE :search;
```

### 7.6 Notification Content

When a grant is created, the consultant receives a notification containing:
- Taxpayer name
- Taxpayer PAN
- Access mode (`full_access` or `review_edit`)
- Tax year(s) requested
- Message from taxpayer
- Action links: `Accept` / `Decline`

Notifications are stored in `notifications` and surfaced in-app. Email delivery is optional in MVP.

### 7.7 Return-to-Taxpayer (review_edit only)

When a CA on `review_edit` mode is done:
1. CA clicks **Return to taxpayer** with notes
2. Filing status: `in_review_by_ca` → `revision_returned`
3. System creates a **change set** snapshot capturing CA's edits (before/after)
4. Taxpayer receives a notification with a link to review
5. Taxpayer sees a diff view and either accepts (then submits) or rejects (reverts to pre-CA state)

The change set is preserved in `audit_logs` regardless of outcome.

### 7.8 Auto-Apply to IT Portal (full_access only, v1.1)

For `full_access` grants, MVP exposes a stub: the CA clicks **Submit + Apply to Portal** but the actual e-filing integration is deferred to v1.1. In MVP, it produces the final filing artifact and shows a placeholder "Portal submission pending integration." The flag `full_access_includes_portal_submission` is logged for future replay.

---

## 8. Fraud → Judicial → Enforcement Workflow

**Principle:** No one outside Admin gets unrestricted access to taxpayer data. Every escalation step is gated by a role, recorded in `audit_logs`, and time-bound where applicable.

### 8.1 State Machine

```
            ┌──────────┐
            │ flagged  │  ← officer creates the case
            └─────┬────┘
                  │ officer requests judicial review
                  ▼
        ┌──────────────────┐
        │ judicial_review  │  ← judicial officer now has full data access
        └─────┬───────┬────┘
              │       │
   dismiss    │       │ assign to enforcement
              ▼       ▼
        ┌────────┐  ┌──────────────────────┐
        │ closed │  │ enforcement_assigned │
        └────────┘  └──────────┬───────────┘
                               │ enforcement completes investigation
                               ▼
                          ┌────────┐
                          │ closed │
                          └────────┘
```

### 8.2 Step-by-Step

**Step 1 — Officer flags a filing.**
An officer (L2+) reviewing a filing notices suspicious patterns. They create a fraud case:
- Reference: the specific filing ID
- Reason: structured (income_mismatch | undisclosed_income | fabricated_deduction | other) + free text
- Initial status: `flagged`
- Visibility: all officers in the same jurisdiction

**Step 2 — Officer requests judicial review.**
If further investigation is needed, the officer escalates:
- Status: `flagged` → `judicial_review`
- A judicial officer is auto-assigned (round-robin within jurisdiction) or manually picked
- Notification sent to judicial officer

**Step 3 — Judicial Officer reviews.**
The assigned judicial officer is granted full read access to the taxpayer's data:
- All documents, transactions, filings, calculation traces
- All previous fraud cases for this taxpayer
- The officer's flag reasoning

Two outcomes:
- **Dismiss:** insufficient evidence. Status → `closed`. Taxpayer is not notified of dismissed cases by default.
- **Assign to Enforcement:** judicial officer creates an enforcement assignment.

**Step 4 — Enforcement Investigation.**
On assignment, the system:
- Sets case status → `enforcement_assigned`
- Auto-creates an `enforcement_access` record for the assigned enforcement agency user:
  - `access_type: read_only`
  - `expires_at: now + 90 days` (configurable; renewable by judicial)
  - `case_reference: fraud_case_id`
  - `reason: judicial_assignment_<case_id>`
- Notification sent to enforcement agency
- Enforcement queries taxpayer data via standard endpoints — all access logged against the case

**Step 5 — Case Closure.**
Enforcement marks the case resolved with outcome notes. Status → `closed`. Enforcement access auto-revokes at closure or TTL expiry, whichever is sooner.

### 8.3 Access Matrix by Case Status

| Status | Officer | Judicial Officer | Enforcement Agency |
|---|---|---|---|
| `flagged` | Read case + filing | — | — |
| `judicial_review` | Read case | **Full taxpayer data** | — |
| `enforcement_assigned` | Read case | Full taxpayer data | **Full taxpayer data (time-bound)** |
| `closed` | Read case | Read case | — |

### 8.4 Audit Requirements

Every transition writes to `audit_logs`:
- `fraud_case_created` (officer)
- `fraud_case_judicial_requested` (officer)
- `fraud_case_judicial_assigned` (system)
- `fraud_case_dismissed` (judicial)
- `fraud_case_enforcement_assigned` (judicial)
- `fraud_case_data_accessed` (any access under this case)
- `fraud_case_closed` (enforcement)

The taxpayer can see a non-detailed record of "an investigation occurred" only after the case is `closed` and only for cases involving enforcement (right-to-be-informed). Active cases are never visible to the taxpayer.

### 8.5 Separation from Admin Enforcement Grants

The `enforcement_access` table also supports admin-granted access (outside the fraud flow). The fraud flow auto-creates these records but additionally links them to `fraud_case_id`, so the entire chain is reconstructable.

---

## 9. RAG Pipeline

### 9.1 Ingestion

```
Tax doc (PDF / TXT)
   │
   ▼
[pdfplumber extract]
   │
   ▼
[chunk: ~500 tokens, 50-token overlap, split on section boundaries]
   │
   ▼
[OpenAI text-embedding-3-small] → 1536-dim vector
   │
   ▼
[INSERT into knowledge_chunks]
```

### 9.2 Retrieval

- Embed user question via same model
- `ORDER BY embedding <=> :q LIMIT 5`
- Filter by `metadata->>'country' = :user_country`
- Discard chunks with similarity < 0.70

### 9.3 Prompt Template

```
SYSTEM:
You are GlimmoraTax's tax explanation assistant for {country}.
You ONLY explain tax concepts based on the provided context.
You NEVER compute taxes, recommend filings, or make legal conclusions.
If the answer is not in the context, say "I don't have information on that."

CONTEXT:
{retrieved_chunks_joined}

USER QUESTION:
{question}

Answer in 2–4 sentences. Cite the source section.
```

### 9.4 Guardrails

- Patterns like *"calculate my tax"* / *"file my return"* are intercepted → redirect to filing flow.
- PII (PAN, Aadhaar, account numbers) stripped from question before embedding.
- Every Q&A logged to `audit_logs`.

---

## 10. Security & Compliance Architecture

### 10.1 AuthN & AuthZ

| Concern | Approach |
|---|---|
| AuthN | JWT (RS256), 1h access, 30d refresh |
| Password | bcrypt cost 12 |
| Session | Refresh rotation; revoked tokens blocklisted |
| AuthZ | Role + scope; `@require_role(...)` decorators |
| MFA | Out of MVP (v1.1) |

### 10.2 Consent Cascade

| Consent Revoked | Effect |
|---|---|
| `document_processing` | New uploads blocked; existing docs preserved |
| `ai_analysis` | RAG disabled, AI categorization disabled; deterministic rules continue |
| `data_retention` | Triggers erasure workflow on 30-day grace period |

### 10.3 PII Redaction Before OpenAI

Before any text leaves to OpenAI:
- Strip / mask: PAN (`[A-Z]{5}\d{4}[A-Z]`), Aadhaar (`\d{4}\s?\d{4}\s?\d{4}`), phone (`[6-9]\d{9}`), email
- Keep semantic content (amounts, dates, generic descriptions)
- Log redaction count in audit trail

### 10.4 File Upload Hardening

- Whitelist: `application/pdf`, `text/csv` (verified by magic bytes, not extension)
- Max size: 10 MB
- PDFs rejected if `/JavaScript` or `/JS` tag present
- Stored under `{user_id_prefix}/{uuid}.{ext}` — no user input in path

---

## 11. Database Schema (Updated)

The base schema is in the implementation plan §5. The following tables are **added or modified** to support the new workflows.

### 11.1 Modified: `tax_returns`

```sql
ALTER TABLE tax_returns
  ADD COLUMN regime_used VARCHAR(10),                       -- 'old' | 'new'
  ADD COLUMN regime_switch_acknowledged BOOLEAN DEFAULT FALSE,
  ADD COLUMN regime_switch_section_referenced VARCHAR(50),  -- e.g. '115BAC(6)'
  ADD COLUMN form_10iea_required BOOLEAN DEFAULT FALSE;
```

Also extend the status enum to support the consultant return flow:
```
draft → in_review_by_ca → revision_returned → submitted → accepted | rejected | revision_requested
```

### 11.2 Modified: `users`

```sql
ALTER TABLE users
  ADD COLUMN pan VARCHAR(10) UNIQUE,
  ADD COLUMN has_business_income BOOLEAN DEFAULT FALSE,
  ADD COLUMN lifetime_switch_backs_to_new INT DEFAULT 0;
CREATE INDEX idx_users_pan ON users(pan);
```

`lifetime_switch_backs_to_new` is maintained by the Taxation service whenever a Category-B taxpayer's filing successfully transitions old → new.

### 11.3 New: `consultant_access_grants`

```sql
CREATE TABLE consultant_access_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultant_id UUID REFERENCES users(id) NOT NULL,
    target_user_id UUID REFERENCES users(id) NOT NULL,
    access_mode VARCHAR(20) NOT NULL,
    -- 'full_access' | 'review_edit'
    status VARCHAR(20) DEFAULT 'pending',
    -- pending | active | revoked | rejected | expired
    tax_years TEXT[],
    message TEXT,
    requested_at TIMESTAMPTZ DEFAULT NOW(),
    accepted_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (consultant_id, target_user_id)
);
CREATE INDEX idx_cag_consultant_status
  ON consultant_access_grants(consultant_id, status);
```

### 11.4 New: `notifications`

```sql
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) NOT NULL,
    type VARCHAR(50) NOT NULL,
    -- consultant_access_request | consultant_returned_filing |
    -- fraud_case_assigned | enforcement_access_granted |
    -- regime_warning | filing_review_complete
    title VARCHAR(255) NOT NULL,
    body TEXT,
    payload JSONB,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_notifications_user_unread
  ON notifications(user_id) WHERE read_at IS NULL;
```

### 11.5 New: `fraud_cases`

```sql
CREATE TABLE fraud_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filing_id UUID REFERENCES tax_returns(id) NOT NULL,
    taxpayer_id UUID REFERENCES users(id) NOT NULL,
    flagged_by UUID REFERENCES users(id) NOT NULL,
    flag_reason VARCHAR(50) NOT NULL,
    flag_notes TEXT,
    status VARCHAR(30) DEFAULT 'flagged',
    -- flagged | judicial_review | enforcement_assigned | closed
    judicial_officer_id UUID REFERENCES users(id),
    judicial_decision VARCHAR(30),
    judicial_notes TEXT,
    judicial_reviewed_at TIMESTAMPTZ,
    enforcement_agency_id UUID REFERENCES users(id),
    enforcement_outcome TEXT,
    closed_at TIMESTAMPTZ,
    jurisdiction VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_fraud_cases_status ON fraud_cases(status);
CREATE INDEX idx_fraud_cases_taxpayer ON fraud_cases(taxpayer_id);
```

### 11.6 Modified: `enforcement_access`

```sql
ALTER TABLE enforcement_access
  ADD COLUMN fraud_case_id UUID REFERENCES fraud_cases(id);
```

---

## 12. Deployment Topology

### MVP (Local / Single VM)

```
Developer Machine / Single VM
├── Node.js process    → Next.js dev server :3000
├── Python process     → uvicorn :8000
├── Postgres container → :5432  (with pgvector)
└── /var/glimmora/uploads (filesystem)
```

### Post-MVP (planned)

- nginx reverse proxy with TLS
- Separate worker process (Celery + Redis) for OCR jobs
- S3-compatible object storage
- Managed Postgres with read replica
- Centralized logging (audit_logs streamed to log sink)

---

> Living document. Update whenever a service contract, role, or compliance behavior changes.
