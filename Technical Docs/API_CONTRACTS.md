# GlimmoraTax — API Contracts

> **Version:** 1.3 | **Date:** 2026-05-13
> **Companion to:** [README.md](README.md) and [ARCHITECTURE.md](ARCHITECTURE.md)

Full API contracts for the GlimmoraTax MVP, including the **financial-year workspace** (all data and views are FY-scoped), regime-switch workflow (Section 115BAC), consultant access (per-year, two modes), and the fraud → judicial → enforcement chain.

---

## Table of Contents

1. [Conventions](#1-conventions)
2. [Auth APIs](#2-auth-apis)
3. [Financial Year Workspace](#3-financial-year-workspace)
4. [Document APIs](#4-document-apis)
5. [AI / OCR APIs](#5-ai--ocr-apis)
6. [Filing APIs](#6-filing-apis)
7. [Rules APIs (Admin)](#7-rules-apis-admin)
8. [RAG Assistant APIs](#8-rag-assistant-apis)
9. [Consultant Access APIs](#9-consultant-access-apis)
10. [Fraud Case APIs](#10-fraud-case-apis)
11. [Admin & Enforcement APIs](#11-admin--enforcement-apis)
12. [Notifications APIs](#12-notifications-apis)
13. [Consent APIs](#13-consent-apis)
14. [FY Filter — Global Convention](#14-fy-filter--global-convention)
15. [Error Codes Reference](#15-error-codes-reference)

---

## 1. Conventions

- **Base URL:** `/api/v1`
- **Content-Type:** `application/json` (multipart for uploads)
- **Auth:** `Authorization: Bearer <jwt>`
- **Timestamps:** ISO 8601 UTC
- **IDs:** UUID v4 strings
- **Money:** Strings to preserve precision (`"125000.50"`)
- **PAN:** 10 characters, format `[A-Z]{5}[0-9]{4}[A-Z]`
- **Financial year:** `FY2024-25` (April 1, 2024 → March 31, 2025)
- **FY filter:** any list endpoint accepts `?tax_year=FY2024-25` or `?tax_years=FY2024-25,FY2023-24` — see [§14](#14-fy-filter--global-convention)
- **Pagination:** `?page=1&limit=20`, response wraps with `meta: { page, limit, total }`
- **Errors:** RFC 7807 problem details (see [§15](#15-error-codes-reference))

### Error Envelope

```json
{
  "type": "https://glimmora.tax/errors/<code>",
  "title": "Human readable summary",
  "status": 403,
  "detail": "Specific message for this occurrence",
  "instance": "/api/v1/...",
  "trace_id": "req_xyz…"
}
```

---

## 2. Auth APIs

> [!IMPORTANT]
> **Two-factor verification is mandatory for taxpayers.** A taxpayer must verify **both** email and phone before they can submit a filing. Phone OTP is re-challenged at submission time as an anti-fraud measure (see [§6.7](#67-post-apiv1filingsidsubmit)).

### 2.1 POST `/api/v1/auth/register`

```jsonc
// Request
{
  "email": "asha@example.com",
  "password": "MinLen12Chars!",
  "name": "Asha Verma",
  "role": "taxpayer",                 // taxpayer | consultant
  "country": "IN",
  "pan": "ABCDE1234F",
  "phone": "+919900000000",           // required for taxpayer; optional for other roles
  "city": "Mumbai",                   // required for taxpayer (drives CA directory)
  "has_business_income": false,
  "consents": {
    "document_processing": true,
    "ai_analysis": true,
    "data_retention": true
  }
}
// 201
{
  "user_id":              "usr_9b4c…",
  "email":                "asha@example.com",
  "role":                 "taxpayer",
  "email_verification_sent_to": "asha@example.com",
  "phone_otp_sent_to":          "+91 99000 *0000",   // masked
  "next_steps": [
    "verify-email",
    "verify-phone"
  ]
}
// 400 validation_error
// 409 email_already_registered | pan_already_registered | phone_already_registered
```

On register the system issues **two challenges**:

1. An email link (long URL-safe token) sent to the email address — consume with `/auth/verify-email`.
2. A 6-digit phone OTP sent via SMS — consume with `/auth/verify-phone`.

### 2.2 POST `/api/v1/auth/verify-email`

```jsonc
{ "token": "..." }
// 200 → { "email_verified_at": "..." }
// 422 invalid_or_expired_token
```

### 2.3 POST `/api/v1/auth/verify-phone`

```jsonc
{ "otp": "428193" }
// 200 → { "phone_verified_at": "..." }
// 422 invalid_or_expired_otp
// 429 too_many_attempts            (5 wrong submissions invalidates the OTP — must re-request)
```

### 2.4 POST `/api/v1/auth/resend-otp`

```jsonc
{ "purpose": "signup_phone" }       // 'signup_phone' | 'signup_email'
// 202 → { "sent_to": "+91 99000 *0000" }
// 429 rate_limited                 (1 resend per 60s)
```

### 2.5 POST `/api/v1/auth/login`

```jsonc
{ "email": "asha@example.com", "password": "..." }
// 200
{
  "access_token":  "eyJhbGc…",
  "refresh_token": "eyJhbGc…",
  "token_type":    "bearer",
  "expires_in":    3600,
  "user": {
    "id":                 "usr_9b4c…",
    "role":               "taxpayer",
    "name":               "Asha Verma",
    "pan":                "ABCDE1234F",
    "email_verified":     true,
    "phone_verified":     true
  }
}
// 403 verification_required         (login allowed; some actions gated until verified)
```

### 2.6 GET `/api/v1/auth/me`

```jsonc
// 200
{
  "id":                          "usr_9b4c…",
  "email":                       "asha@example.com",
  "name":                        "Asha Verma",
  "role":                        "taxpayer",
  "country":                     "IN",
  "pan":                         "ABCDE1234F",
  "phone":                       "+919900000000",
  "city":                        "Mumbai",
  "has_business_income":         false,
  "lifetime_switch_backs_to_new":0,
  "active_tax_year":             "FY2024-25",
  "email_verified_at":           "...",
  "phone_verified_at":           "...",
  "pan_verified_at":             "...",
  "created_at":                  "..."
}
```

### 2.7 PUT `/api/v1/auth/me` — update profile fields including `active_tax_year`, `phone`, `city`

Changing `phone` invalidates `phone_verified_at` and issues a fresh `signup_phone` OTP.

### 2.8 POST `/api/v1/auth/refresh` — refresh access token

### 2.9 POST `/api/v1/auth/request-submit-otp`

Issues a fresh phone OTP specifically bound to a filing the user is about to submit. The OTP is single-use, expires in 10 minutes, and references the filing in its server-side record so it cannot be replayed against another filing.

```jsonc
{ "filing_id": "fil_d4…" }
// 202
{
  "verification_id":  "ver_x9…",
  "filing_id":        "fil_d4…",
  "sent_to":          "+91 99000 *0000",
  "expires_at":       "..."
}
// 403 verification_required          (email or phone not yet verified at all)
// 409 filing_not_ready_for_submit    (filing missing required fields or not in submittable status)
```

The same OTP must then be passed in [`POST /filings/{id}/submit`](#67-post-apiv1filingsidsubmit).

---

## 3. Financial Year Workspace

Every taxpayer has a **per-financial-year workspace** that scopes their filings, documents, and transactions. The UI exposes a year switcher (dropdown / tabs) so users move freely between years and edit any open filing.

### 3.1 Rules

- At most **one filing per `(tax_year, country)`** in non-terminal states (`draft`, `in_review_by_ca`, `revision_returned`, `revision_requested`, `submitted`). Terminal states (`accepted`, `rejected`) are immutable.
- A new FY workspace activates automatically on **April 1**; the draft filing is created lazily on first action.
- Switching the active FY is purely a navigation operation; no data is modified.
- Documents and transactions are bound to a filing → therefore to a specific FY. They do not cross years.

### 3.2 GET `/api/v1/workspace/years`

Returns all FYs relevant to the taxpayer (existing filings + suggested next year) with status snapshots.

```jsonc
// 200
{
  "active_tax_year": "FY2024-25",
  "current_filing_fy": "FY2024-25",
  "years": [
    {
      "tax_year": "FY2024-25",
      "filing": {
        "id": "fil_d4…",
        "status": "draft",
        "regime_used": null,
        "documents_count": 3,
        "transactions_count": 47,
        "verified_transactions_count": 32,
        "last_modified": "..."
      },
      "actions": { "can_create": false, "can_edit": true, "can_delete": false, "can_submit": false }
    },
    {
      "tax_year": "FY2023-24",
      "filing": {
        "id": "fil_e7…", "status": "accepted", "regime_used": "new",
        "documents_count": 4, "transactions_count": 52, "verified_transactions_count": 52,
        "last_modified": "..."
      },
      "actions": { "can_create": false, "can_edit": false, "can_delete": false, "can_submit": false }
    },
    {
      "tax_year": "FY2025-26",
      "filing": null,
      "actions": { "can_create": true, "can_edit": false, "can_delete": false, "can_submit": false }
    }
  ]
}
```

### 3.3 PUT `/api/v1/workspace/active-year`

Sets the user's active FY. Pure UI state; persisted server-side so the switcher remembers across sessions.

```jsonc
{ "tax_year": "FY2023-24" }
// 200 → { "active_tax_year": "FY2023-24" }
// 422 invalid_tax_year
```

### 3.4 POST `/api/v1/workspace/years/{tax_year}/filing`

Idempotent — creates a draft filing if none exists; otherwise returns the existing one. Primary entry point for "Start filing for FY20XX-XX".

```jsonc
// Request — optional template
{ "template_from_tax_year": "FY2023-24" }    // clone deductions config baseline only
// 200 (existing) or 201 (created)
{
  "id": "fil_d4…",
  "tax_year": "FY2024-25",
  "status": "draft",
  "country": "IN",
  "templated_from": "FY2023-24",
  "created_at": "..."
}
// 409 filing_in_terminal_state
```

Template copies: deduction structure, HRA/rent baseline, bank labels. **Never** copies transactions, document refs, or any numbers.

### 3.5 GET `/api/v1/workspace/years/{tax_year}`

Full bundle for a year: filing, documents, transactions summary, prior-year recap.

```jsonc
// 200
{
  "tax_year": "FY2024-25",
  "filing": { /* tax_returns object */ },
  "documents": [ /* documents for this filing */ ],
  "transactions_summary": {
    "total": 47, "verified": 32,
    "by_method": { "rule": 28, "ai_assisted": 12, "manual": 7 },
    "by_category": { "salary": 12, "interest": 8, "other": 27 }
  },
  "previous_year": { "tax_year": "FY2023-24", "regime_used": "new", "total_tax": "89700.00" }
}
```

### 3.6 UX Pattern

```
┌─────────────────────────────────────────────────────┐
│  GlimmoraTax                              [Year ▾]  │
│                                       FY2024-25  ●  │
│                                       FY2023-24     │
│  Dashboard / Filing / Review / ...    FY2022-23     │
│                                       FY2025-26 (+) │
└─────────────────────────────────────────────────────┘
```

The same year switcher pattern appears in CA, Officer, Judicial, Enforcement, and Admin views — every list/dashboard is FY-scoped by default.

---

## 4. Document APIs

> [!IMPORTANT]
> **Auto FY Routing:** Uploads do **not** require the user to specify a financial year. After OCR/parsing, the FY Router examines the dates inside the document (Form 16 AY, 26AS/AIS FY header, bank txn dates, salary slip period) and routes each item to the correct FY filing — creating filings lazily as needed. A single bank CSV spanning two FYs is split automatically. See [ARCHITECTURE.md §7.3](ARCHITECTURE.md#73-auto-fy-routing-dates--financial-year).

### 4.1 POST `/api/v1/documents/upload`

```
Content-Type: multipart/form-data
Fields:
  file: <binary>                   # PDF or CSV; max 10 MB
  document_type: form16 | bank_csv | ais_tis | form_26as | salary_slip
  filing_id: <uuid> (optional)     # only to pin to a specific filing; usually omitted
  hint_tax_year: FY2024-25 (optional)   # router hint if the user knows the year
```
```jsonc
// 201
{
  "id": "doc_a1…",
  "filing_id": null,                  // null until router runs
  "tax_year": null,                   // null until router runs
  "routing_status": "pending",
  "document_type": "form16",
  "file_name": "Form16_FY2425.pdf",
  "status": "uploaded",
  "size_bytes": 248173,
  "created_at": "..."
}
// 400 invalid type | 413 > 10MB | 415 unsupported_document_type
// 403 consent_required (document_processing)
```

### 4.2 GET `/api/v1/documents/{id}/routing-report`

Returns the FY router's decisions after processing completes.

```jsonc
// 200 — example: bank CSV routed to two FYs
{
  "document_id": "doc_a1…",
  "routing_status": "routed",         // pending | routed | partially_routed | unresolved | overridden
  "routing_decisions": [
    { "scope": "document", "tax_year": "FY2024-25", "filing_id": "fil_d4…",
      "reason": "Form 16 AY=2025-26" }
  ],
  "transactions_routed": {
    "FY2024-25": 41,
    "FY2023-24": 6
  },
  "filings_created_or_updated": [
    { "tax_year": "FY2024-25", "filing_id": "fil_d4…", "created": false },
    { "tax_year": "FY2023-24", "filing_id": "fil_e7…", "created": true }
  ],
  "unresolved": [
    { "transaction_index": 17, "raw_date": "2024-04-32", "reason": "invalid_date",
      "inbox_id": "inb_g8…" }
  ],
  "review_required": []
}
// 409 routing_in_progress — try again after AI/OCR completes
```

### 4.3 PUT `/api/v1/documents/{id}` — edit document fields including `tax_year`

This is the **direct edit path** for a single document. Use it to change the document's FY assignment without going through the bulk reroute flow.

```jsonc
// Request — change the FY a document belongs to
{ "tax_year": "FY2023-24", "reason": "Backdated 26AS revision" }
// Request — rename
{ "file_name": "Form16_FY2425_revised.pdf" }
// 200
{ "id": "doc_a1…", "tax_year": "FY2023-24", "filing_id": "fil_e7…", "updated_at": "..." }
// 409 filing_locked — target filing in terminal state
// 422 invalid_tax_year
```

When `tax_year` changes:
- The document moves to that FY's filing (creating the filing if it doesn't exist).
- All transactions extracted from this document are **not** automatically moved — they keep their per-row FY (which was derived from each row's own date). To move transactions, use `PUT /api/v1/filings/{id}/transactions/{tx_id}` or the bulk reroute below.
- The change is audited.

### 4.4 POST `/api/v1/documents/{id}/reroute`

**Bulk reroute** — override the router's decision for the whole document or a subset of transactions in one call. Useful after a bank-CSV ingest where many rows landed in the wrong FY.

```jsonc
// Request — override whole document and all its transactions
{
  "scope": "document_and_transactions",
  "target_tax_year": "FY2023-24",
  "reason": "Document is from a backdated 26AS revision"
}

// Request — override specific transactions only
{
  "scope": "transactions",
  "transaction_ids": ["tx_c3…", "tx_c4…"],
  "target_tax_year": "FY2023-24",
  "reason": "Late posting; actual transaction in prior FY"
}
// 200 — returns new routing report
// 409 filing_locked — target filing is in terminal state
// 422 invalid_tax_year
```

### 4.5 GET `/api/v1/documents?tax_year=FY2024-25&document_type=form16` — defaults to active_tax_year; only routed docs appear

### 4.6 GET `/api/v1/documents/{id}`
### 4.7 DELETE `/api/v1/documents/{id}` → 204 (soft delete + audit; blocked if any linked filing is terminal)

### 4.8 GET `/api/v1/router/inbox`

Items the FY Router could not auto-resolve. The user resolves these from the "Needs your attention" view.

```jsonc
// 200
{
  "items": [
    {
      "id": "inb_g8…",
      "document_id": "doc_a1…",
      "reason": "invalid_date",
      "suggested_tax_year": null,
      "raw_payload": { "date": "2024-04-32", "amount": "12500.00", "description": "..." },
      "created_at": "..."
    },
    {
      "id": "inb_h9…",
      "document_id": "doc_a2…",
      "reason": "terminal_fy_conflict",
      "suggested_tax_year": "FY2022-23",
      "raw_payload": { "date": "2022-12-15", "amount": "8000.00", "description": "..." },
      "created_at": "..."
    }
  ],
  "meta": { "total_unresolved": 2 }
}
```

### 4.9 POST `/api/v1/router/inbox/{id}/resolve`

```jsonc
// Request
{
  "action": "route",            // route | discard
  "target_tax_year": "FY2024-25",
  "corrected_date": "2024-04-30"    // optional, when fixing invalid date
}
// 200 — item routed; transaction created or document linked
// 409 filing_locked
// 422 invalid_tax_year
```

---

## 5. AI / OCR APIs

### 5.1 POST `/api/v1/ai/process/{document_id}`

```jsonc
// 202
{ "document_id": "doc_a1…", "job_id": "job_b2…", "status": "processing", "estimated_seconds": 30 }
// 403 consent_required (ai_analysis)
```

### 5.2 GET `/api/v1/ai/status/{document_id}`

```jsonc
{ "document_id": "doc_a1…", "status": "completed", "progress": 100, "extracted_count": 47, "error": null }
```

### 5.3 POST `/api/v1/ai/categorize`

```jsonc
// Request
{ "transaction_id": "tx_c3…", "description": "Salary credit from ACME Pvt Ltd", "amount": "75000.00" }
// 200
{
  "transaction_id": "tx_c3…",
  "category": "salary_income",
  "confidence_score": 0.98,
  "categorization_method": "rule",
  "rule_matched": "income.salary.regex.v1",
  "ai_used": false
}
```

---

## 6. Filing APIs

All filing endpoints operate on a specific `filing_id`; the FY context is implicit in the filing.

### 6.1 GET `/api/v1/filings?tax_year=FY2024-25&status=draft` — list (paginated)

### 6.2 POST `/api/v1/filings/{id}/precheck-regime`

Run **before** `/calculate` to evaluate the Section 115BAC switching state.

```jsonc
// Request
{ "regime": "new" }                  // 'new' | 'old' | 'both'

// 200 — one of these shapes
{ "filing_id": "fil_d4…", "level": "OK" }

{
  "filing_id": "fil_d4…", "level": "INFO",
  "code": "cat_a_free_switch",
  "message": "Salaried/non-business taxpayers may switch every year.",
  "previous_regime": "new", "requested_regime": "old"
}

{
  "filing_id": "fil_d4…", "level": "WARN_HIGH",
  "code": "115bac_one_time_switch_back",
  "section_referenced": "115BAC(6)",
  "form_10iea_required": false,
  "previous_regime": "old", "requested_regime": "new",
  "lifetime_switch_backs_used": 0, "lifetime_switch_backs_remaining": 1,
  "acknowledgment_text": "I have read and understood Section 115BAC(6) and confirm I am exercising my one-time lifetime switch back to the new regime.",
  "message": "This is your ONE-TIME lifetime switch back to the new regime under Section 115BAC(6)."
}

{
  "filing_id": "fil_d4…", "level": "BLOCK",
  "code": "115bac_lifetime_lock",
  "section_referenced": "115BAC(6)",
  "message": "You have already exercised your one-time switch back. You cannot opt back to the old regime."
}
```

### 6.3 POST `/api/v1/filings/{id}/calculate`

```jsonc
// Request
{
  "regime": "both",
  "acknowledged_regime_switch": false,     // required when precheck returned WARN_HIGH
  "acknowledgment_text_hash": null         // sha256 of the exact acknowledgment_text confirmed
}
// 200
{
  "filing_id": "fil_d4…",
  "regime": "both",
  "old_regime": { "total_tax": "132600.00", "...": "..." },
  "new_regime": { "total_tax": "101400.00", "...": "..." },
  "recommended_regime": "new",
  "savings": "31200.00",
  "calculation_trace_id": "trc_e5…",
  "regime_warning_applied": null
}
// 409 regime_acknowledgment_required
// 422 regime_switch_blocked | unverified_transactions
```

### 6.4 GET `/api/v1/filings/{id}/summary`

```jsonc
{
  "filing_id": "fil_d4…",
  "user": { "name": "Asha Verma", "pan": "ABCDE1234F" },
  "tax_year": "FY2024-25",
  "regime_used": "new",
  "regime_switch_acknowledged": false,
  "section_referenced": null,
  "income_breakdown": { "salary": "1200000.00", "interest": "35000.00" },
  "deductions": { "standard": "75000.00" },
  "tax_computation": {
    "taxable_income": "1175000.00", "tax": "97500.00",
    "cess": "3900.00", "total_tax": "101400.00"
  },
  "tds_paid": "85000.00",
  "balance_payable": "16400.00",
  "calculation_trace": [/* see ARCHITECTURE.md §5.3 */],
  "generated_at": "..."
}
```

### 6.5 GET `/api/v1/filings/{id}/pdf` → `application/pdf` binary

### 6.6 PUT `/api/v1/filings/{id}` — edit (allowed in: draft, revision_returned, revision_requested)

### 6.7 POST `/api/v1/filings/{id}/submit`

Submitting a filing requires:
1. The taxpayer has verified both email and phone at registration (`email_verified_at` and `phone_verified_at` are set).
2. A **fresh phone OTP** issued by [`POST /auth/request-submit-otp`](#29-post-apiv1authrequest-submit-otp) for this specific filing, included in the body.
3. The acknowledgment text.

```jsonc
{
  "acknowledgment":  "I confirm the information is accurate.",
  "verification_id": "ver_x9…",        // returned by request-submit-otp
  "otp":             "428193"          // 6-digit numeric, single-use, 10-min TTL, bound to this filing
}
// 200 → { "id": "fil_d4…", "status": "submitted", "submitted_at": "...", "submitted_by": "usr_9b4c…" }
// 403 cannot_submit_review_edit
// 403 verification_required          (email or phone not verified at all)
// 422 invalid_or_expired_otp
// 422 otp_filing_mismatch            (OTP was issued for a different filing)
// 422 regime_acknowledgment_required
```

Server-side checks (in order):

1. Filing status allows submission (`draft`, `revision_returned`, or `revision_requested` for taxpayer; or CA on `full_access`).
2. `user_verifications` row found where `purpose='submit_phone'`, `filing_id=:id`, `consumed_at IS NULL`, `expires_at > NOW()`, `secret_hash` matches.
3. Increment `attempts` on mismatch; lock after 5.
4. On success: `consumed_at = NOW()`, `tax_returns.submit_otp_verification_id = ver_x9…`, `status = 'submitted'`.

All of the above are written atomically with an `audit_logs` entry (`filing_submitted`, with `metadata.verification_id`).

### 6.8 DELETE `/api/v1/filings/{id}` → 204 (only `draft`)

### 6.9 GET `/api/v1/filings/{id}/transactions?status=unverified&page=1`

### 6.10 PUT `/api/v1/filings/{id}/transactions/{tx_id}` — edit a transaction

Edits any transaction field, **including its financial year**. Changing `tax_year` moves the transaction to that FY's filing (creating the filing if it doesn't exist).

```jsonc
// Request — change category
{ "category": "interest_income" }

// Request — change the transaction's financial year
{ "tax_year": "FY2023-24", "reason": "Late posting; actual transaction in prior FY" }

// Request — fix the date (router re-derives FY automatically)
{ "date": "2024-04-02" }

// 200 — returns updated transaction (with new filing_id if FY changed)
{
  "id": "tx_c3…",
  "filing_id": "fil_e7…",        // moved to FY2023-24's filing
  "tax_year": "FY2023-24",
  "category": "interest_income",
  "routing_method": "manual_override",
  "updated_at": "..."
}
// 409 filing_locked — target FY's filing is terminal
// 422 invalid_tax_year

---

## 7. Rules APIs (Admin)

### 7.1 GET `/api/v1/rules/{country}/{tax_year}`
### 7.2 POST `/api/v1/rules` — create rule (pending_approval; dual admin)
### 7.3 PUT `/api/v1/rules/{id}` — update (new version)
### 7.4 POST `/api/v1/rules/{id}/approve` — second admin approves; activates

```jsonc
// POST /api/v1/rules — Request
{
  "country": "IN",
  "tax_year": "FY2024-25",
  "rule_type": "income_slab_new_regime",
  "rule_json": {
    "slabs": [
      { "from": 0,       "to": 300000,  "rate": 0.00 },
      { "from": 300000,  "to": 600000,  "rate": 0.05 },
      { "from": 600000,  "to": 900000,  "rate": 0.10 },
      { "from": 900000,  "to": 1200000, "rate": 0.15 },
      { "from": 1200000, "to": 1500000, "rate": 0.20 },
      { "from": 1500000, "to": null,    "rate": 0.30 }
    ]
  },
  "source_reference": "Finance Act 2024, Section 115BAC",
  "effective_from": "2024-04-01",
  "effective_to":   "2025-03-31"
}
```

---

## 8. RAG Assistant APIs

### 8.1 POST `/api/v1/assistant/ask`

```jsonc
{
  "question": "What's the limit for Section 80C?",
  "context_filing_id": "fil_d4…"     // optional; never used for calculation
}
// 200
{
  "answer": "Under Section 80C, the maximum deduction is ₹1,50,000 per FY...",
  "sources": [
    { "document": "Income Tax Act Section 80C", "chunk_id": "kc_f6…", "relevance_score": 0.91 }
  ],
  "disclaimer": "Informational only. Not a tax decision.",
  "model_used": "gpt-4o-mini",
  "tokens_used": 423
}
// 403 consent_required | 422 rag_redirect_to_filing
```

### 8.2 GET `/api/v1/assistant/topics`
### 8.3 POST `/api/v1/assistant/ingest` (admin)

---

## 9. Consultant Access APIs

> [!IMPORTANT]
> **Access is granted per financial year.** The taxpayer explicitly picks which years the CA can see. A grant for FY2024-25 does **not** expose FY2023-24 or any other year. The CA's queries are server-enforced to the granted years.

### 9.0 Hybrid CA Selection

Taxpayers can find a CA via two complementary paths:

| Path | Use when | Initial grant status |
|---|---|---|
| **Directory** ([§9.1](#91-ca-directory-taxpayer-facing)) | Taxpayer wants to find a CA in their own city. Browse listed CAs, pick one, send a request. CA can accept or decline. | `pending` until CA accepts |
| **Invite code** ([§9.5](#95-invite-codes-ca-facing)) | The CA is from outside the taxpayer's city, OR the relationship is pre-arranged. CA generates a code and shares it; taxpayer redeems it. | `active` immediately (both parties have shown intent) |

A grant ends up in the same [`consultant_access_grants`](SCHEMA.md#93-consultant_access_grants) shape regardless of origin — `origin` distinguishes the two.

### 9.1 CA Directory (Taxpayer-Facing)

#### GET `/api/v1/consultants`

Browse CAs who have opted into the directory.

| Query param | Default | Notes |
|---|---|---|
| `city` | taxpayer's `users.city` | Required match against either CA's home city or `serves_cities[]` |
| `specialization` | — | Filter by specialization tag (e.g. `salaried`, `startup`, `capital_gains`) |
| `language` | — | ISO 639-1 (e.g. `hi`, `en`) |
| `fee_range` | — | `budget | mid | premium` |
| `min_experience` | — | Years |
| `page`, `limit` | `1`, `20` | |

```jsonc
// GET /api/v1/consultants?city=Mumbai&specialization=salaried
// 200
{
  "consultants": [
    {
      "user_id":            "usr_ca1…",
      "name":               "CA Rohit Sharma",
      "city":               "Mumbai",
      "icai_membership":    "ICAI-123456",         // self-attested
      "bio":                "10 years salaried + capital gains.",
      "specializations":    ["salaried", "capital_gains"],
      "years_experience":   10,
      "languages":          ["en", "hi", "mr"],
      "fee_range":          "mid",
      "photo_url":          "...",
      "accepting_clients":  true
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 4 }
}
```

> [!IMPORTANT]
> **Self-attested ICAI membership.** In MVP, GlimmoraTax does **not** verify a CA's ICAI membership against the ICAI registry. The number is what the CA typed at registration. The taxpayer-facing UI surfaces this clearly so the taxpayer can verify out-of-band. ICAI registry integration is tracked for v1.1.

#### GET `/api/v1/consultants/{user_id}` — full directory profile

Same fields as the list, with optional fields like `serves_cities[]`. Available only for CAs who are `listed_in_directory = TRUE`; otherwise returns 404.

### 9.2 Directory Request (Taxpayer-Facing)

#### POST `/api/v1/consultant-access/grants`

Create a grant by selecting a CA from the directory.

```jsonc
// Request
{
  "consultant_id": "usr_ca1…",                // from directory list (NOT email)
  "access_mode":   "review_edit",             // 'full_access' | 'review_edit'
  "tax_years":     ["FY2024-25"],
  "message":       "Please review my FY2024-25 filing."
}
// 201
{
  "id":            "cag_p1…",
  "origin":        "directory_request",
  "consultant":    { "id": "usr_ca1…", "name": "CA Rohit Sharma", "city": "Mumbai" },
  "access_mode":   "review_edit",
  "status":        "pending",                 // CA must accept
  "tax_years":     ["FY2024-25"],
  "requested_at":  "...",
  "expires_at":    "..."                      // pending TTL (14 days default)
}
// 400 tax_years_required
// 403 consultant_not_in_directory            (CA exists but not listed / not accepting clients)
// 404 consultant_not_found
// 409 grant_already_exists                   (pending or active grant already exists)
```

The CA receives a `consultant_access_request` notification with the taxpayer's PAN, name, basic details, and the document list (see [§12.5](#125-notification-payloads-by-type)). They respond via [§9.6](#96-ca-responds-to-a-directory-request).

> [!IMPORTANT]
> `access_mode` and `tax_years` are **permanent** for the grant. To change either, the taxpayer creates a **new grant**. The old grant remains for its original year scope or can be revoked.

#### GET `/api/v1/consultant-access/grants?tax_year=FY2024-25` — taxpayer's grants, FY-filterable

Response now includes `origin`:

```jsonc
{
  "grants": [
    {
      "id":          "cag_p1…",
      "origin":      "directory_request",
      "consultant":  { "id": "usr_ca1…", "name": "CA Rohit Sharma" },
      "status":      "active",
      "access_mode": "review_edit",
      "tax_years":   ["FY2024-25"]
    },
    {
      "id":          "cag_p2…",
      "origin":      "invite_code",
      "consultant":  { "id": "usr_ca2…", "name": "CA Padma Iyer", "city": "Bengaluru" },
      "status":      "active",
      "access_mode": "full_access",
      "tax_years":   ["FY2024-25", "FY2023-24"]
    }
  ]
}
```

#### DELETE `/api/v1/consultant-access/grants/{id}` → 204 — revoke (taxpayer)

### 9.3 Invite-Code Redemption (Taxpayer-Facing)

#### POST `/api/v1/consultant-access/grants/redeem-code`

Use this when a CA from a different city (or a pre-arranged relationship) has given the taxpayer an invite code.

```jsonc
// Request
{
  "invite_code":  "CA-7K3PQX",                // case-sensitive; CA-prefix + 6–14 alphanumerics
  "access_mode":  "review_edit",              // must be ≤ the code's default_access_mode
  "tax_years":    ["FY2024-25"],              // must be ⊆ the code's allowed_tax_years (if set)
  "message":      "Thanks for sharing the code."
}
// 201
{
  "id":            "cag_p2…",
  "origin":        "invite_code",
  "consultant":    { "id": "usr_ca2…", "name": "CA Padma Iyer", "city": "Bengaluru" },
  "access_mode":   "review_edit",
  "status":        "active",                  // immediate
  "tax_years":     ["FY2024-25"],
  "activated_at":  "...",
  "expires_at":    "..."
}
// 404 invalid_or_expired_invite_code
// 409 grant_already_exists
// 422 access_mode_exceeds_code_policy
// 422 tax_year_not_allowed_by_code
```

The CA receives a `consultant_invite_code_used` notification with the same payload shape as a directory request — PAN, name, basic details, shared documents, and `client_detail_url`.

### 9.4 Consultant Profile Management (CA-Facing)

#### GET `/api/v1/consultant/profile`

Returns the CA's `ca_profiles` row joined to `users`.

#### PUT `/api/v1/consultant/profile`

```jsonc
{
  "icai_membership":      "ICAI-123456",
  "bio":                  "10 years salaried + capital gains.",
  "specializations":      ["salaried", "capital_gains"],
  "years_experience":     10,
  "languages":            ["en", "hi", "mr"],
  "fee_range_indicator":  "mid",
  "photo_url":            "...",
  "listed_in_directory":  true,                 // opt-in flag
  "accepting_clients":    true,
  "serves_cities":        ["Mumbai", "Pune", "Thane"]
}
// 200
```

A CA cannot be listed in the directory until both `email_verified_at` and `phone_verified_at` are set on their `users` row — the server enforces this even if `listed_in_directory=true` is requested.

### 9.5 Invite Codes (CA-Facing)

#### POST `/api/v1/consultant/invite-codes`

```jsonc
// Request
{
  "label":                "Mumbai tax-fair booth",
  "max_uses":             5,                    // default 1
  "default_access_mode":  "review_edit",        // ceiling; taxpayers cannot exceed
  "allowed_tax_years":    ["FY2024-25"],        // optional; null = any year
  "valid_for_days":       14                    // default 14, max 90
}
// 201
{
  "id":                "ivc_w1…",
  "code":              "CA-7K3PQX",             // shown once; not stored in plaintext server-side
  "max_uses":          5,
  "used_count":        0,
  "status":            "active",
  "expires_at":        "..."
}
```

The plaintext `code` is shown to the CA **only on creation**. The server stores only `code_hash`. If the CA loses the code, they must revoke and re-issue.

#### GET `/api/v1/consultant/invite-codes` — list (status filter, pagination)

#### DELETE `/api/v1/consultant/invite-codes/{id}` → 204 — revoke

### 9.6 CA Responds to a Directory Request

#### POST `/api/v1/consultant-access/grants/{id}/respond`

Only valid when `origin = 'directory_request'` and `status = 'pending'`. Invite-code grants are already `active` — no response step.

```jsonc
{ "action": "accept" }              // 'accept' | 'decline'
// 200 → { "id": "...", "status": "active",   "decided_at": "..." }
// 200 → { "id": "...", "status": "rejected", "decided_at": "..." }
// 409 grant_not_pending
// 409 grant_origin_not_directory   (invite-code grants don't need response)
```

#### GET `/api/v1/consultant/clients`

```jsonc
// Query:
//   ?search=ABCDE1234F           — PAN search, scoped to active grants
//   ?tax_year=FY2024-25          — filter clients by granted year
//   ?page=1&limit=20
// 200
{
  "clients": [
    {
      "grant_id": "cag_p1…",
      "user_id": "usr_9b4c…",
      "name": "Asha Verma",
      "pan": "ABCDE1234F",
      "access_mode": "review_edit",
      "tax_years": ["FY2024-25"],          // years CA can see for THIS client
      "active_since": "...",
      "pending_actions": {
        "filings_to_review": 1,
        "filings_returned_pending_taxpayer": 0
      }
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1 }
}
```

> **Scope guarantees:** PAN search returns matches only from the CA's `active` grants. Queries with a `tax_year` outside the grant set return empty. The system never discloses whether a PAN exists outside the CA's grants.

#### GET `/api/v1/consultant/clients/{user_id}` — full client view, scoped to granted tax_years
#### GET `/api/v1/consultant/clients/{user_id}/filings?tax_year=FY2024-25` — list filings the CA can see

A `403 fy_not_in_grant` is returned if the CA requests a `tax_year` not in their grant for this client.

#### GET `/api/v1/consultant/clients/{user_id}/filings/{filing_id}` — read filing (any mode)

Returns `403 fy_not_in_grant` if the filing's `tax_year` is not in the CA's granted years.

#### PUT `/api/v1/consultant/clients/{user_id}/filings/{filing_id}` — edit (both modes)

Transitions `draft` → `in_review_by_ca`. Edits tracked as a change set.

#### POST `/api/v1/consultant/clients/{user_id}/filings/{filing_id}/return-to-taxpayer`

Only in `review_edit` mode.

```jsonc
{ "notes": "I've added 80C investments. Please review and submit." }
// 200
{ "filing_id": "fil_d4…", "status": "revision_returned", "returned_at": "...", "change_set_id": "chg_q2…" }
// 403 access_mode is full_access
```

#### POST `/api/v1/consultant/clients/{user_id}/filings/{filing_id}/submit`

Only in `full_access` mode.

```jsonc
{
  "acknowledgment": "I confirm I am authorized by the taxpayer to submit this filing.",
  "apply_to_portal": false        // v1.1
}
// 200
{
  "filing_id": "fil_d4…", "status": "submitted", "submitted_at": "...",
  "submitted_by": "usr_ca…", "portal_submission_status": "deferred_to_v1_1"
}
// 403 cannot_submit_review_edit
```

#### GET `/api/v1/consultant/clients/{user_id}/filings/{filing_id}/change-set`

### 9.3 Taxpayer Reviews CA's Changes

#### GET `/api/v1/filings/{id}/change-set/{change_set_id}`

```jsonc
{
  "change_set_id": "chg_q2…",
  "by_consultant": { "id": "usr_ca…", "name": "CA Rohit Sharma" },
  "notes": "I've added 80C investments...",
  "changes": [
    { "entity": "transaction", "entity_id": "tx_c3…", "field": "category",
      "before": "other_income", "after": "interest_income" },
    { "entity": "filing", "field": "summary_json.deductions.80c",
      "before": "0.00", "after": "150000.00" }
  ],
  "created_at": "..."
}
```

#### POST `/api/v1/filings/{id}/accept-change-set/{change_set_id}` → filing → `draft`, taxpayer can submit
#### POST `/api/v1/filings/{id}/reject-change-set/{change_set_id}` → CA's changes reverted

---

## 10. Fraud Case APIs

All officer / judicial / enforcement list endpoints accept `?tax_year=FY2024-25` (and `?tax_years=FY2024-25,FY2023-24`) for FY filtering — see [§14](#14-fy-filter--global-convention).

### 10.1 Officer Endpoints

#### POST `/api/v1/fraud-cases` — flag a filing

```jsonc
// Request (officer L2+)
{
  "filing_id": "fil_d4…",
  "flag_reason": "income_mismatch",
  // income_mismatch | undisclosed_income | fabricated_deduction | other
  "flag_notes": "Salary declared (₹12L) does not match Form 26AS (₹18L)."
}
// 201
{
  "id": "frd_r3…", "filing_id": "fil_d4…", "taxpayer_id": "usr_9b4c…",
  "tax_year": "FY2024-25",
  "status": "flagged", "flag_reason": "income_mismatch",
  "flagged_by": "usr_off…", "jurisdiction": "Mumbai-Zone-A",
  "created_at": "..."
}
// 403 insufficient_role | 409 case_already_open
```

#### GET `/api/v1/fraud-cases`

Query parameters:
- `status` — `flagged | judicial_review | enforcement_assigned | closed`
- `tax_year` — single FY filter
- `tax_years` — comma-separated multi-FY filter
- `jurisdiction` — officer's jurisdiction
- `flag_reason` — filter by reason
- `taxpayer_pan` — exact PAN lookup
- `page`, `limit`

```jsonc
// Example: GET /api/v1/fraud-cases?status=flagged&tax_year=FY2024-25&jurisdiction=Mumbai-Zone-A
// 200
{
  "cases": [
    {
      "id": "frd_r3…",
      "filing_id": "fil_d4…",
      "tax_year": "FY2024-25",
      "taxpayer": { "name": "Asha Verma", "pan": "ABCDE1234F" },
      "status": "flagged",
      "flag_reason": "income_mismatch",
      "created_at": "..."
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1, "by_tax_year": { "FY2024-25": 1, "FY2023-24": 0 } }
}
```

#### POST `/api/v1/fraud-cases/{id}/request-judicial-review`

```jsonc
{ "preferred_judicial_officer_id": null, "justification": "Pattern matches related cases." }
// 200
{ "id": "frd_r3…", "status": "judicial_review", "judicial_officer_id": "usr_jud…", "judicial_assigned_at": "..." }
```

### 10.2 Judicial Officer Endpoints

#### GET `/api/v1/judicial/cases`

Same filter set as officer endpoint plus `assigned_to_me=true`.

```jsonc
// GET /api/v1/judicial/cases?tax_year=FY2024-25&assigned_to_me=true
// 200
{
  "cases": [
    {
      "id": "frd_r3…",
      "tax_year": "FY2024-25",
      "taxpayer": { "id": "usr_9b4c…", "name": "Asha Verma", "pan": "ABCDE1234F" },
      "filing_id": "fil_d4…",
      "flag_reason": "income_mismatch",
      "flagged_by": { "id": "usr_off…", "name": "Officer Kumar" },
      "status": "judicial_review",
      "assigned_at": "..."
    }
  ],
  "meta": { "by_tax_year": { "FY2024-25": 1 } }
}
```

#### GET `/api/v1/judicial/cases/{id}` — full bundle: filing, documents, transactions, calc trace, prior cases. Access logged.

#### POST `/api/v1/judicial/cases/{id}/decide`

```jsonc
// Dismiss
{ "decision": "dismiss", "notes": "Discrepancy explained by mid-year job change." }

// Assign to enforcement
{
  "decision": "assign_to_enforcement",
  "enforcement_agency_user_id": "usr_enf…",
  "access_duration_days": 90,
  "notes": "Pattern of misreporting across 3 AYs warrants investigation."
}
// 200 — assigned
{
  "id": "frd_r3…", "status": "enforcement_assigned",
  "judicial_decision": "assigned_to_enforcement",
  "enforcement_agency_id": "usr_enf…",
  "enforcement_access_id": "enf_s4…",
  "enforcement_access_expires_at": "..."
}
```

### 10.3 Enforcement Endpoints

#### GET `/api/v1/enforcement/cases?tax_year=FY2024-25&status=enforcement_assigned`

```jsonc
// 200
{
  "cases": [
    {
      "id": "frd_r3…",
      "tax_year": "FY2024-25",
      "taxpayer": { "name": "Asha Verma", "pan": "ABCDE1234F" },
      "assigned_by_judicial": { "id": "usr_jud…", "name": "Judicial Officer Rao" },
      "access_expires_at": "...",
      "assigned_at": "..."
    }
  ],
  "meta": { "by_tax_year": { "FY2024-25": 1, "FY2023-24": 0 } }
}
```

#### GET `/api/v1/enforcement/cases/{id}` — case + taxpayer data (time-bound)

```jsonc
{
  "case": { /* fraud_case */ },
  "taxpayer": { /* full user */ },
  "documents": [ ... ],
  "transactions": [ ... ],
  "filings": [ ... ],          // can include other years if part of investigation
  "access_expires_at": "..."
}
// 403 access_expired
```

#### POST `/api/v1/enforcement/cases/{id}/close`

```jsonc
{
  "outcome": "tax_liability_confirmed",
  // tax_liability_confirmed | no_fraud_found | partial_findings | escalated_externally
  "notes": "Confirmed undisclosed business income of ₹8.5L."
}
```

### 10.4 Taxpayer Visibility (post-closure)

#### GET `/api/v1/fraud-cases/my-history?tax_year=FY2024-25`

Returns only **closed enforcement cases** (right-to-be-informed).

```jsonc
{
  "cases": [
    {
      "id": "frd_r3…",
      "filing_year": "FY2024-25",
      "status": "closed",
      "outcome_summary": "Investigation completed",
      "closed_at": "..."
    }
  ]
}
```

---

## 11. Admin & Enforcement APIs

### 11.1 GET `/api/v1/admin/filings`

Query parameters (all optional):
- `status` — filing status
- `tax_year` / `tax_years` — FY filter
- `user_id` — specific taxpayer
- `pan` — exact PAN
- `regime_used` — `old | new`
- `page`, `limit`

```jsonc
// GET /api/v1/admin/filings?tax_year=FY2024-25&status=submitted
// 200
{
  "filings": [ /* tax_returns objects */ ],
  "meta": {
    "page": 1, "limit": 20, "total": 184,
    "by_tax_year": { "FY2024-25": 184, "FY2023-24": 0 },
    "by_status": { "submitted": 120, "accepted": 60, "rejected": 4 }
  }
}
```

### 11.2 PUT `/api/v1/admin/filings/{id}/review`

```jsonc
{ "action": "accept", "notes": "All deductions verified." }   // accept | reject | request_revision
```

### 11.3 GET `/api/v1/admin/users?pan=ABCDE1234F&page=1`
### 11.4 PUT `/api/v1/admin/transactions/{id}` — manual override; audited

### 11.5 Enforcement Access (Admin-Granted)

#### POST `/api/v1/admin/enforcement-access`

```jsonc
{
  "target_user_id": "usr_9b4c…",
  "granted_to": "usr_enf…",
  "access_type": "read_only",
  "reason": "Ongoing PMLA case PMLA/2026/0123",
  "case_reference": "PMLA/2026/0123",
  "tax_years": ["FY2024-25", "FY2023-24"],    // restrict access to specific years
  "expires_at": "..."
}
// 201
```

#### GET `/api/v1/admin/enforcement-access?tax_year=FY2024-25`
#### DELETE `/api/v1/admin/enforcement-access/{id}` → 204

---

## 12. Notifications APIs

### 12.1 GET `/api/v1/notifications?unread=true&page=1`

```jsonc
{
  "notifications": [
    {
      "id": "ntf_u6…",
      "type": "consultant_access_request",
      "title": "Asha Verma granted you access",
      "body": "Asha Verma (PAN ABCDE1234F) has granted you review_edit access to their FY2024-25 filing. 3 documents shared.",
      "payload": {
        "grant_id": "cag_p1…",
        "taxpayer": {
          "user_id": "usr_9b4c…",
          "pan": "ABCDE1234F",
          "name": "Asha Verma",
          "email": "asha@example.com",
          "phone": "+91-90000-00000",
          "city": "Mumbai"
        },
        "access_mode": "review_edit",
        "tax_years": ["FY2024-25"],
        "documents": [
          { "id": "doc_a1…", "document_type": "form16",    "file_name": "Form16_FY2425.pdf",       "size_bytes": 248173 },
          { "id": "doc_a2…", "document_type": "form_26as", "file_name": "26AS_FY2425.pdf",          "size_bytes": 95012  },
          { "id": "doc_a3…", "document_type": "bank_csv",  "file_name": "HDFC_Jan-Dec2024.csv",     "size_bytes": 412334 }
        ],
        "client_detail_url": "/consultant/clients/usr_9b4c…",
        "action_label": "View client"
      },
      "read_at": null,
      "created_at": "..."
    },
    {
      "id": "ntf_u7…",
      "type": "filing_under_officer_review",
      "title": "Your FY2024-25 filing is now under review",
      "body": "Officer (L1) has picked up your filing for initial review.",
      "payload": {
        "filing_id": "fil_d4…",
        "tax_year": "FY2024-25",
        "officer_level": "L1",
        "stage": "intake_triage"
      },
      "read_at": null,
      "created_at": "..."
    }
  ],
  "meta": { "unread_count": 2 }
}
```

### 12.2 POST `/api/v1/notifications/{id}/read` → 204
### 12.3 POST `/api/v1/notifications/read-all` → 204

### 12.4 Notification Types

Notifications are grouped by recipient role. Every notification carries a typed `payload` object whose shape matches the type (see [§12.5](#125-notification-payloads-by-type) for canonical payload shapes).

#### 12.4.1 Taxpayer Notifications

| Type | Trigger |
|---|---|
| **Account** | |
| `account_email_verified` | Email verification completed |
| `account_password_changed` | Password updated |
| `account_login_new_device` | Login from a new device / unfamiliar IP |
| `account_pan_verified` | PAN successfully verified |
| `account_consent_changed` | Consent granted or revoked (audit confirmation to the user) |
| **Filing lifecycle** | |
| `filing_draft_created` | A new draft was opened (manual or auto on Apr 1) |
| `new_tax_year_available` | New FY workspace activated (Apr 1) |
| `filing_submitted_ack` | Filing successfully submitted |
| `filing_review_complete` | Officer accepts / rejects the filing |
| `regime_warning` | Mid-year rule change affects them, or a 115BAC switch acknowledgment is needed |
| **Officer review progression (L1 → L5)** | |
| `filing_under_officer_review` | Filing picked up by an Officer (L1) for intake/triage |
| `filing_escalated_to_l2` | L1 escalates to L2 for deeper review |
| `filing_escalated_to_l3` | L2 escalates to L3 — judicial review may be requested next |
| `filing_escalated_to_l4` | L3 escalates to L4 oversight |
| `filing_escalated_to_l5` | L4 escalates to L5 (final administrative authority) |
| `filing_revision_requested` | Officer requests the taxpayer revise the filing |
| **Mismatch alerts (non-fraud)** | |
| `filing_mismatch_detected` | Reported income mismatches 26AS / AIS / TDS data — taxpayer is asked to revise |

> [!IMPORTANT]
> **Fraud silence.** Taxpayers receive **no** notifications about fraud-related events — flagging, judicial review, enforcement assignment, or case closure are all silent to the taxpayer. Any formal contact about such matters happens through channels outside the in-app notification system.
| **Consultant interactions** | |
| `consultant_returned_filing` | CA returns filing (review_edit) |
| `consultant_submitted_filing` | CA submits filing (full_access) |
| `consultant_access_request_accepted` | The CA accepted the access invitation |
| `consultant_access_request_declined` | The CA declined the access invitation |

#### 12.4.2 Consultant (CA) Notifications

| Type | Trigger |
|---|---|
| `consultant_access_request` | Taxpayer grants access — payload carries PAN, name, basic details, and the document list. Includes a `client_detail_url` so the CA can open the client view with one click. |
| `consultant_access_scope_changed` | Taxpayer creates an additional grant adding more FYs |
| `consultant_access_revoked` | Taxpayer revokes the grant — CA loses access immediately |
| `consultant_client_filing_updated` | Client uploaded a new document or edited transactions in a granted FY |
| `consultant_rule_change_impact` | A rule change affects ≥ 1 of the CA's active clients |

#### 12.4.3 Officer Notifications

| Type | Trigger |
|---|---|
| `officer_filing_assigned` | A filing was assigned to this officer's worklist |
| `officer_sla_breach_warning` | Assigned filing nearing SLA window |
| `officer_case_escalated_in` | An L-1 escalates a filing up to this officer's level |

#### 12.4.4 Judicial Officer Notifications

| Type | Trigger |
|---|---|
| `fraud_case_assigned` | Officer escalates a case for judicial review |
| `fraud_case_renewal_requested` | Enforcement requests access-window extension |

#### 12.4.5 Enforcement Agency Notifications

| Type | Trigger |
|---|---|
| `enforcement_access_granted` | Judicial assigns case to this agency |
| `enforcement_access_expiring_soon` | < 48h remaining on case access |
| `enforcement_access_expired` | Access window closed |

#### 12.4.6 Admin Notifications

| Type | Trigger |
|---|---|
| `admin_rule_pending_second_approval` | A rule needs a second admin's approval |
| `admin_system_health_alert` | RAG / OCR / OpenAI / DB dependency degraded |

### 12.5 Notification Payloads by Type

#### `consultant_access_request` (CA)

Sent when a taxpayer creates a grant. Includes everything the CA needs to recognize the client and open their workspace in one click — **per [HOMEPAGE_PLAN §2b](HOMEPAGE_PLAN.md#2b-active-ca)**, the CA can click `client_detail_url` from the notification (or from the client list) to load full client details.

```jsonc
{
  "grant_id": "cag_p1…",
  "taxpayer": {
    "user_id":  "usr_9b4c…",
    "pan":      "ABCDE1234F",
    "name":     "Asha Verma",
    "email":    "asha@example.com",
    "phone":    "+91-90000-00000",
    "city":     "Mumbai"
  },
  "access_mode": "review_edit",
  "tax_years":   ["FY2024-25"],
  "documents": [
    { "id": "doc_a1…", "document_type": "form16",    "file_name": "Form16_FY2425.pdf", "size_bytes": 248173 }
  ],
  "client_detail_url": "/consultant/clients/usr_9b4c…",
  "action_label":      "View client"
}
```

#### `filing_under_officer_review` / `filing_escalated_to_l{2..5}` (Taxpayer)

```jsonc
{
  "filing_id":      "fil_d4…",
  "tax_year":       "FY2024-25",
  "officer_level":  "L2",                   // L1 | L2 | L3 | L4 | L5
  "stage":          "deeper_review",        // intake_triage | deeper_review | judicial_request | oversight | final_authority
  "previous_level": "L1",
  "occurred_at":    "..."
}
```

> [!IMPORTANT]
> These notifications surface routine review-stage transitions. They do **not** disclose investigation details, suspected reasons, or officer notes. They simply inform the taxpayer that their filing is moving through the standard review pipeline.

#### `filing_mismatch_detected` (Taxpayer)

```jsonc
{
  "filing_id": "fil_d4…",
  "tax_year":  "FY2024-25",
  "mismatch_summary": {
    "source":           "Form 26AS",
    "field":            "salary_income",
    "declared_amount":  "1200000.00",
    "reported_amount":  "1800000.00",
    "delta":            "600000.00"
  },
  "required_action": "Please review and revise your filing or upload supporting documents.",
  "deadline":        "..."
}
```

#### `filing_mismatch_detected` (Taxpayer)

A data discrepancy between the taxpayer's declared figures and authoritative sources (26AS / AIS / TDS data). This is a routine validation prompt — **not** a fraud notification — and asks the taxpayer to revise their filing.

```jsonc
{
  "filing_id": "fil_d4…",
  "tax_year":  "FY2024-25",
  "mismatch_summary": {
    "source":           "Form 26AS",
    "field":            "salary_income",
    "declared_amount":  "1200000.00",
    "reported_amount":  "1800000.00",
    "delta":            "600000.00"
  },
  "required_action": "Please review and revise your filing or upload supporting documents.",
  "deadline":        "..."
}
```

---

## 13. Consent APIs

### 13.1 GET `/api/v1/consent`

```jsonc
{
  "consents": [
    { "type": "document_processing", "granted": true,  "granted_at": "..." },
    { "type": "ai_analysis",         "granted": true,  "granted_at": "..." },
    { "type": "data_retention",      "granted": true,  "granted_at": "..." }
  ]
}
```

### 13.2 POST `/api/v1/consent` — `{ "type": "ai_analysis", "granted": true }`
### 13.3 DELETE `/api/v1/consent/{type}` → cascading effects per [ARCHITECTURE.md §10.2](ARCHITECTURE.md#102-consent-cascade)

---

## 14. FY Filter — Global Convention

Every list endpoint that returns FY-bound entities (filings, documents, fraud cases, grants, enforcement assignments, etc.) supports a uniform query convention:

| Param | Type | Behavior |
|---|---|---|
| `tax_year` | string | Single FY filter, e.g. `tax_year=FY2024-25` |
| `tax_years` | comma-separated | Multi-FY filter, e.g. `tax_years=FY2024-25,FY2023-24` |
| (omitted) | — | Defaults to user's `active_tax_year` for taxpayer/CA views; **no filter** for officer/judicial/enforcement/admin views (so they see all years by default) |

Every list response includes a `meta.by_tax_year` breakdown for quick scanning across years.

### Endpoints supporting FY filter

| Endpoint | Default if omitted |
|---|---|
| `GET /api/v1/filings` | active_tax_year |
| `GET /api/v1/documents` | active_tax_year |
| `GET /api/v1/consultant-access/grants` | all years |
| `GET /api/v1/consultant/clients` | all granted years |
| `GET /api/v1/consultant/clients/{id}/filings` | all granted years for that client |
| `GET /api/v1/fraud-cases` | all years |
| `GET /api/v1/judicial/cases` | all years |
| `GET /api/v1/enforcement/cases` | all years |
| `GET /api/v1/admin/filings` | all years |
| `GET /api/v1/admin/enforcement-access` | all years |
| `GET /api/v1/fraud-cases/my-history` | all years |
| `GET /api/v1/notifications` | all years |

### Access enforcement

The FY filter is **layered on top of** access control. A CA cannot bypass their `grant.tax_years` by passing `tax_year` for a year outside the grant — the server returns `403 fy_not_in_grant`. Likewise, enforcement agents cannot request FYs outside their `enforcement_access.tax_years`.

---

## 15. Error Codes Reference

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `validation_error` | Request schema invalid |
| 400 | `tax_years_required` | CA grant created without specifying years |
| 401 | `unauthenticated` | Missing or invalid JWT |
| 403 | `consent_required` | Required consent not granted |
| 403 | `insufficient_role` | RBAC denied |
| 403 | `verification_required` | Email or phone not yet verified |
| 403 | `fy_not_in_grant` | CA / enforcement requested FY outside their access scope |
| 403 | `cannot_submit_review_edit` | CA on `review_edit` cannot submit |
| 403 | `consultant_not_in_directory` | CA exists but is not listed / not accepting clients |
| 403 | `access_expired` | Time-bound access TTL hit |
| 404 | `resource_not_found` | Entity missing or out of scope |
| 404 | `consultant_not_found` | CA ID does not resolve to a consultant |
| 404 | `invalid_or_expired_invite_code` | Code unknown, exhausted, revoked, or expired |
| 409 | `email_already_registered`, `pan_already_registered`, `phone_already_registered` | Uniqueness conflicts at registration |
| 409 | `filing_locked` | Cannot edit submitted/terminal filing |
| 409 | `filing_in_terminal_state` | Cannot recreate filing for that FY |
| 409 | `filing_not_ready_for_submit` | Submit-OTP requested for a filing not in submittable state |
| 409 | `regime_acknowledgment_required` | WARN_HIGH not acknowledged |
| 409 | `grant_already_exists` | Active/pending grant for pair |
| 409 | `grant_not_pending` | Grant not in pending state |
| 409 | `grant_origin_not_directory` | Respond endpoint called on an invite-code grant |
| 409 | `case_already_open` | Active fraud case exists |
| 409 | `case_not_in_flagged_state` | Wrong state for action |
| 409 | `routing_in_progress` | Router has not finished; retry after AI/OCR completes |
| 413 | `payload_too_large` | File > 10 MB |
| 415 | `unsupported_document_type` | Not in MVP whitelist |
| 422 | `invalid_tax_year` | Year not in user's workspaces |
| 422 | `invalid_or_expired_token` | Email verification token bad |
| 422 | `invalid_or_expired_otp` | Phone OTP bad, expired, or attempt-locked |
| 422 | `otp_filing_mismatch` | Submit-OTP was issued for a different filing |
| 422 | `access_mode_exceeds_code_policy` | Redemption asked for more than the code permits |
| 422 | `tax_year_not_allowed_by_code` | FY outside the code's `allowed_tax_years` |
| 422 | `unverified_transactions` | Verify before calc |
| 422 | `regime_switch_blocked` | Section 115BAC(6) lifetime lock |
| 422 | `rule_not_found` | No active rule for jurisdiction/year |
| 422 | `extraction_failed` | OCR could not parse |
| 422 | `rag_redirect_to_filing` | Question is a calc, not an explanation |
| 422 | `rag_low_confidence` | No knowledge chunks above threshold |
| 429 | `rate_limited`, `too_many_attempts` | Too many requests / OTP attempts |
| 503 | `external_dependency_down` | OpenAI/OCR/SMS unavailable |

---

> Living document. Update whenever an endpoint, payload field, or error code changes.
