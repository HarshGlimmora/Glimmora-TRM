# Filing Flow — Backend + Frontend Implementation Spec

**Owner:** Dinkar
**Last updated:** 2026-05-15
**Status:** Living document. Each section below is implemented one step at a time. After every step, backend is built first, then frontend is wired up, then a short summary is posted for manual verification before moving to the next step.

---

## 0. Working agreement

1. Pick a step from the **Implementation Roadmap** (§9).
2. Build **backend** for that step first (models if needed, services, endpoints, tests if applicable).
3. Build **frontend** for that step (page + components + API client calls + state wiring).
4. Post a short **summary of what was implemented** + how to verify it manually.
5. User performs manual check.
6. User says "next" → move to the following step.

**Cross-cutting non-negotiables:**

- **Every field and every function the user sees must be editable.** Categories, amounts, descriptions, dates, FY assignment, regime choice, deduction amounts, OCR-extracted fields — all editable, all audited.
- **Three-layer trust model is enforced server-side:**
  L1 = deterministic rules engine decides.
  L2 = AI (Vertex AI Gemini) suggests only — never autonomous.
  L3 = RAG explains, read-only.
- **Audit trail:** every state transition writes an `audit_logs` row.
- **Auth (existing — do NOT rebuild):** users sign in on Next.js via **mobile number or email + OTP**. On successful verification, Next.js sets an **httpOnly session cookie** (`glmra.session`). The Next.js layer is the auth authority — see `Frontend/lib/server/services/auth.ts` and the API routes under `Frontend/app/api/auth/*` (`send-otp`, `verify-otp`, `me`, `logout`, `resend-otp`). The Zustand store at `Frontend/lib/store/auth-store.ts` is a non-sensitive UI cache; the cookie is the source of truth.
- **Inter-service trust (Next.js → FastAPI):** the Python backend has no login UI of its own. The browser hits **Next.js route handlers** (e.g. `/api/filings/...`) which **proxy server-side** to FastAPI. The proxy resolves the cookie → user, then mints a short-lived signed JWT (HS256, shared secret `AUTH_SHARED_SECRET` env var) containing `{ sub: user_id, role, exp }` and forwards it as `Authorization: Bearer <jwt>` to FastAPI. FastAPI's `get_current_user` dependency verifies the JWT signature with the same secret. The browser never sees this token; CORS stays simple because the browser only talks to Next.js.
- **File storage:** local filesystem under `Backend/data/uploads/{user_id}/{document_id}.{ext}`. Path is stored in `documents.storage_path`. Swappable later via a storage abstraction interface.
- **PDF extraction:** Vertex AI Gemini (multimodal). PDF bytes uploaded → Gemini extracts structured JSON per document type (Form 16, Form 26AS, AIS, salary slip). Extraction call is async-friendly with retries and stored result preserved verbatim in `documents.extraction_payload` for replay.
- **CSV categorization:** deterministic rule engine (regex / keyword / amount-range over the `category_rules` table). No AI on CSV rows in v1.
- **Two-layer categorization confidence:** rule match → `categorization_method='rule'`, confidence `1.000`. PDF-AI-extracted field → `categorization_method='ai_assisted'`, confidence from Gemini. User-edit → `categorization_method='manual'`, confidence `1.000`. (Enum values are canonical — see SCHEMA.md §3.)

### 0.1 Step tracker — tick as we finish

This is the master checklist. Tick the box when both backend AND frontend for that step are merged AND manually verified.

- [x] **Step 1** — Auth proxy + filing CRUD (`POST/GET /filings`, `GET /filings/{id}`, `PATCH /filings/{id}`) + wire `Begin filing` button
- [x] **Step 2** — CSV upload + rule-based categorization + FY router + documents list
- [x] **Step 3** — PDF upload + Vertex AI Gemini extraction + editable extracted fields + re-extract
- [x] **Step 4** — Transactions review (filters, single + bulk verify, edit drawer, progress)
- [x] **Step 5** — Regime precheck + commit + Section 115BAC(6) modal with hashed ack
- [x] **Step 6** — Summary page + calculation trace accordion + PDF download
- [x] **Step 7** — Submit flow with email OTP gate + preconditions checklist
- [ ] **Step 8** — Notifications (list, mark-read, badge counter)
- [ ] **Step 9** — Consultant access Path A — directory + grant request
- [ ] **Step 10** — Consultant access Path B — invite code redeem
- [ ] **Step 11** — Change-set diff review (accept / reject / accept-and-submit)
- [ ] **Step 12** — Settings (consents, verification, profile, sessions)
- [ ] **Step 13** — RAG assistant slide-over with guardrails

> Mark a step `[x]` only after manual verification. If a step ships partially, leave it `[ ]` and add a short note below it.

### 0.2 Source-of-truth references

This spec is a **bridge document**. The canonical contracts live in four sibling docs — wherever this doc and those docs disagree, those docs win. Update both when changing a contract.

| Topic | Canonical doc | Read for |
|---|---|---|
| Endpoint paths, request/response shapes, error codes | [`API_CONTRACTS.md`](API_CONTRACTS.md) | exact URL, method, JSON keys |
| Three-layer trust, FY router, consent cascade, 115BAC logic | [`ARCHITECTURE.md`](ARCHITECTURE.md) §§2, 6, 7.3, 8, 9.4, 11.2 | the *why* and the algorithm |
| Tables, columns, enum values, constraints | [`SCHEMA.md`](SCHEMA.md) §§3, 5–10 | DDL + every enum |
| Tax engine internals, trace steps, rule_versions JSON | [`TAXATION_CALCULATION.md`](TAXATION_CALCULATION.md) §§5–14 | what `/calculate` does, trace shape |

### 0.3 Canonical conventions (from API_CONTRACTS §1, TAXATION §12, SCHEMA §3)

- **FY tag format:** `FY2024-25` — **no space**, regex `^FY\d{4}-\d{2}$` enforced in DB. (My earlier drafts used `FY 2024-25` — wrong. Update prompts, UI, examples accordingly.)
- **Money:** stored as `NUMERIC(18,2)`, transported as **strings** in JSON to preserve precision (`"125000.50"`). Quantize every step to `Decimal("0.01")` ROUND_HALF_UP. Only round-to-rupee at final PDF/submission.
- **Timestamps:** ISO 8601 UTC strings.
- **IDs:** UUID v4 strings.
- **Pagination:** `?page=1&limit=20`; responses wrap with `meta: { page, limit, total }`, and lists may include `meta.by_tax_year` breakdown.
- **FY filter on list endpoints:** every list endpoint accepts `?tax_year=FY2024-25` or `?tax_years=FY2024-25,FY2023-24`. Default for taxpayer is `active_tax_year`.
- **Audit trail:** every state-changing endpoint appends to `audit_logs` with actor role, action type, entity type/id, before/after, ip, ua, plus any metadata (e.g. `verification_id`, `acknowledged_text_hash`).
- **Idempotency:** `POST /workspace/years/{fy}/filing` returns the existing draft if one is already open for that FY. OTP consumption is atomic — verifying the OTP and flipping the filing to `submitted` happens in one transaction.

### 0.4 Canonical enum values to know (from SCHEMA.md §3)

| Enum | Allowed values |
|---|---|
| `filing_status` | `draft`, `in_review_by_ca`, `revision_returned`, `revision_requested`, `submitted`, `accepted`, `rejected` |
| `document_status` | `uploaded`, `processing`, `completed`, `failed` |
| `routing_status` | `pending`, `routed`, `partially_routed`, `unresolved`, `overridden` |
| `categorization_method` | `rule`, `ai_assisted`, `manual` |
| `transaction_status` | `unverified`, `verified`, `rejected` |
| `router_method` | `auto`, `manual_override` |
| `router_inbox_reason` | `invalid_date`, `terminal_fy_conflict`, `ambiguous_fy`, `routing_review_required` |
| `regime` | `old`, `new` |
| `consent_type` | `document_processing`, `ai_analysis`, `data_retention` |
| `consultant_access_mode` | `full_access`, `review_edit` |
| `consultant_grant_status` | `pending`, `active`, `revoked`, `rejected`, `expired` |
| `grant_origin` | `directory_request`, `invite_code` |

Use these exact strings in requests, responses, and DB writes. No synonyms.

---

## 1. End-to-end workflow (combined storyboard)

This spec covers **two SVG storyboards**:

- **SVG 2** — Portal Core: filing a return (Frames 1-6).
- **SVG 3** — Collaboration & Portal Features: CA directory, invite codes, change-set review, notifications, settings, RAG assistant.

### 1.1 SVG 2 — Filing a return (the core flow)

| #   | Frame               | Route                        | What the user does                                                                                                                                                                  |
| --- | ------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Home (verified)     | `/dashboard`                 | Sees verification banner + "Begin filing" CTA. **Already built** (the button exists at `components/dashboard/PrimaryCta.tsx`).                                                      |
| 2   | Upload documents    | `/filings/{id}/documents`    | Drops PDFs / CSVs (multi-file). Server: detect type → route by date → split if multi-FY → auto-create sibling filing if needed → write transactions → return routing report.        |
| 3   | Review transactions | `/filings/{id}/transactions` | Sees every extracted row with RULE / AI badges. Verifies each (single + bulk). Cannot proceed until 100% verified. Can edit category, amount, date, FY at any time.                 |
| 4   | Choose regime       | `/filings/{id}/regime`       | Compares old vs new (both pre-computed). If the chosen regime differs from prior-year regime AND user has business income → **Section 115BAC(6) modal** with hashed acknowledgment. |
| 5   | Tax summary         | `/filings/{id}/summary`      | Income breakdown, tax computation (with replayable trace), TDS already paid, balance payable. Download PDF.                                                                         |
| 6   | Submit              | `/filings/{id}/submit`       | Precondition checklist + OTP to verified phone + accuracy acknowledgment → `status=submitted` → enters officer L1 worklist.                                                         |

### 1.2 SVG 3 — Collaboration & portal features

These are **parallel features** layered on top of the filing flow. They do not block §1.1 but use the same auth + audit infrastructure.

| #   | Feature                       | Route                               | Purpose                                                                                                               |
| --- | ----------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | Consultant access — two paths | `/consultant-access`                | Path A: directory request (CA must accept). Path B: invite code redeem (active immediately).                          |
| 2   | CA detail + grant request     | `/consultants/{ca_id}`              | View CA profile, request access (mode = `review_edit` or `full_access`, scoped FYs).                                  |
| 3   | Change-set diff review        | `/filings/{id}/change-sets/{cs_id}` | CA returns filing with edits → user reviews diff → accept all / reject / accept-and-submit.                           |
| 4   | Notifications                 | `/notifications`                    | Lifecycle events: escalations, mismatches, CA returns, submissions. Fraud / enforcement events **never** appear here. |
| 5   | Settings                      | `/settings/consent`                 | Consent toggles, verification status, regime preference, FY workspace, notification prefs. Revocation cascades.       |
| 6   | RAG assistant                 | `/assistant` (slide-over)           | Read-only Q&A with citations. Guardrails redirect "calculate my tax" → filing flow.                                   |

---

## 2. Database — schema is complete; verify per step

**Per SCHEMA.md v1.0 (2026-05-13), the schema is already complete for everything in this flow.** Every table and enum used below is defined there. The ORM models under `Backend/app/models/` should mirror SCHEMA.md — when they don't, **SCHEMA.md wins** and the model gets a migration.

### 2.1 Tables this flow uses (all defined in SCHEMA.md)

| Table | SCHEMA.md § | Used by |
|---|---|---|
| `tax_returns` | §6.1 | Filing CRUD, regime, submit |
| `calculation_traces` | §6.2 | Summary, calc trace UI |
| `documents` | §7.1 | Document upload, list, routing |
| `transactions` | §7.2 | Transactions review, verify |
| `pending_router_inbox` | §7.3 | Router-inbox triage |
| `consultant_access_grants` | §9.3 | CA access (both paths) |
| `consultant_invite_codes` | §9.x | Invite-code redeem |
| `filing_change_sets` | §9.4 | Change-set review |
| `notifications` | §10.1 | Notifications page |
| `user_consents` | §5.2 | Settings + consent gates |
| `users` / `user_verifications` | §5.x | Auth + submit OTP |
| `audit_logs` | §11.x | Audit trail (every state change) |
| `country_rules` | §13.x | Tax engine rule storage |

### 2.2 Verification checkpoints (per step)

Before starting any step, compare the relevant ORM model under `Backend/app/models/` against SCHEMA.md. If a column listed in this doc or in SCHEMA.md is missing in the model:

1. Write a migration in `Backend/data/migrations/` that adds the column.
2. Update the SQLAlchemy model.
3. Note it in the step's summary.

**Known gap to verify in Step 3:** SCHEMA.md describes how Gemini extraction is persisted. The current `documents` model has `extraction_started_at`, `extraction_finished_at`, `extraction_error`, but **no `extraction_payload` column** in `Backend/app/models/documents.py`. Check SCHEMA.md §7.1 before Step 3 begins — if SCHEMA mandates an `extraction_payload JSONB` and the model lacks it, add the migration; otherwise persist payloads elsewhere as SCHEMA prescribes.

### 2.3 Seed data needed

- `country_rules` rows for FY 2024-25 (slabs, 87A, surcharge, cess) — required by `/calculate`. Confirm via `GET /filings/{id}/calculate` returning 503 `rules_not_configured` if missing.
- Category-rule seed for CSV categorization (used by Step 2). Whether this lives in `country_rules` or its own table is per SCHEMA — do not invent a new table. Verify before Step 2.

---

## 3. Backend — endpoint contract

All under `/api/v1`. Every endpoint requires `Authorization: Bearer <jwt>`. The JWT-resolved `user_id` is the only trust source for ownership checks. Mount new routers in `app/main.py` next to the existing `filings_router`.

### 3.1 Auth — already implemented in Next.js, no new login endpoints

The user-facing login flow is **already built** in the frontend:

| Frontend route handler                  | Purpose                                       |
| --------------------------------------- | --------------------------------------------- |
| `POST /api/auth/send-otp`               | Begin login: email OR mobile → send OTP       |
| `POST /api/auth/verify-otp`             | Verify OTP → set httpOnly cookie + session    |
| `POST /api/auth/resend-otp`             | Resend within cooldown                        |
| `GET  /api/auth/me`                     | Current user (used by every page on mount)    |
| `POST /api/auth/logout`                 | Destroy cookie + server session               |
| `POST /api/auth/set-role`               | Choose role after first login                 |

**What needs to be built (backend side, this spec):**

A tiny dependency in FastAPI `app/api/deps.py`:

```python
def get_current_user(authorization: str = Header(...), db: Session = Depends(get_db)) -> User:
    # 1. Strip "Bearer " prefix
    # 2. jwt.decode(token, AUTH_SHARED_SECRET, algorithms=["HS256"])
    # 3. Load User by sub (user_id)
    # 4. Raise 401 on any failure
```

**What needs to be built (frontend side, this spec):**

A server-side proxy helper at `Frontend/lib/server/backendProxy.ts`:

```ts
export async function proxyToBackend(
  req: Request,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const session = await authService.resolveSessionFromCookie(req);
  if (!session) return new Response("Unauthorized", { status: 401 });
  const jwt = signBackendJwt({
    sub: session.user.id,
    role: session.user.role,
    exp: nowSec() + 300,                       // 5 minute window
  }, process.env.AUTH_SHARED_SECRET!);
  return fetch(`${process.env.BACKEND_BASE_URL}${path}`, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${jwt}` },
  });
}
```

Each new Next.js route handler under `Frontend/app/api/filings/...`, `/documents/...`, etc., is a thin file that calls `proxyToBackend`. The browser never holds a backend token.

**Env vars needed (both sides):**
```
AUTH_SHARED_SECRET=<long random string>     # set identically on FastAPI and Next.js
BACKEND_BASE_URL=http://127.0.0.1:8000       # only Next.js needs this
```

### 3.2 Filing CRUD — `app/api/v1/filings.py` + workspace router

Paths are **per API_CONTRACTS.md §3.4–§3.5**. Filings are addressed by FY (workspace-scoped), not by listing all filings under `/filings`.

```
POST   /api/v1/workspace/years/{tax_year}/filing
       # Create or return the existing draft for that FY (idempotent).
       # Body: { template_from_tax_year? }   # optional carry-forward
       # Resp: { id, tax_year, status: "draft", templated_from?, created_at }
       # 200 if existing draft returned, 201 if created.

GET    /api/v1/workspace/years/{tax_year}
       # FY bundle — used by EVERY step page to know where to resume.
       # Resp: { tax_year, filing, documents:[...], transactions_summary, previous_year }

GET    /api/v1/workspace/years
       # List all FYs the user has filings in.

PATCH  /api/v1/filings/{id}
       # Editable fields: regime_used (via §3.5 regime endpoints, not here),
       # summary_json overrides for inline declarations (used by /calculate today).

DELETE /api/v1/filings/{id}
       # Soft-delete; draft only.
```

Already exists in the codebase:

```
POST   /api/v1/filings/{id}/calculate           # ✅ existing
GET    /api/v1/filings/{id}/calculation-trace   # ✅ existing
```

> **Frontend implication:** "Begin filing" does NOT POST to `/filings`. It POSTs to `/api/v1/workspace/years/{fy}/filing` where `{fy}` is the active FY for the user (or a hint chosen by the user). The response `id` is what the URL `/filings/{id}/documents` uses.

### 3.3 Documents — new `app/api/v1/documents.py` + `router_inbox.py`

Paths per API_CONTRACTS.md §4.

```
POST   /api/v1/documents/upload
       # Single-point upload. The CLIENT DOES NOT SUPPLY document_type or tax_year.
       # Server auto-detects from file extension + content sniff. See "Type detection" below.
       # multipart: file (+ optional hint_tax_year for ambiguous bank CSVs only)
       # filing_id and tax_year start NULL; router populates them after extraction.
       # Resp: { id, filing_id: null, tax_year: null, routing_status: "pending",
       #         document_type, file_name, size_bytes, sha256, status: "uploaded",
       #         created_at }
       # Errors:
       #   415 unsupported_media_type — extension/mime not recognised
       #   413 file_too_large          — > 10 MB
       #   403 consent_required        — document_processing consent revoked

GET    /api/v1/filings/{id}/documents
       # list documents attached to a filing (after routing)

GET    /api/v1/documents/{id}
       # detail (includes whatever extraction storage SCHEMA prescribes — see §2.2 note)

GET    /api/v1/documents/{id}/routing-report
       # Resp: { document_id, routing_status, routing_decisions:[...],
       #         transactions_routed: { "FY2024-25": N, "FY2023-24": M },
       #         unresolved:[...] }
       # 409 routing_in_progress while OCR/AI is still running.

GET    /api/v1/documents/{id}/download

PUT    /api/v1/documents/{id}
       # body: { tax_year?, file_name?, reason? }
       # Reassigns the whole document to a different FY.

POST   /api/v1/documents/{id}/reroute
       # body: { scope: "document_and_transactions" | "transactions",
       #         target_tax_year, transaction_ids?, reason }
       # Bulk move (or per-row) to a different FY.

POST   /api/v1/documents/{id}/reextract
       # Re-runs Gemini extraction; used after model upgrade or extraction_failed retry.

DELETE /api/v1/documents/{id}
       # Cascades: removes its transactions.

GET    /api/v1/router/inbox
       # Unresolved routing items.
       # Resp: { items:[{ id, document_id, reason, suggested_tax_year, raw_payload }], meta }

POST   /api/v1/router/inbox/{id}/resolve
       # body: { action: "route" | "discard", target_tax_year?, corrected_date? }
```

**Manual override of extracted fields** — exact path lives in SCHEMA + API contracts. If API_CONTRACTS does not define a dedicated extraction-edit endpoint, this is achieved by editing the resulting transactions (`PUT /api/v1/filings/{id}/transactions/{tx_id}`, §3.4). Confirm before Step 3 whether a separate `/documents/{id}/extraction` PUT is canonical; if not, the editor in §6.3 writes to per-row transaction edits instead.

#### Type detection (no client hints — server does it)

The single upload endpoint auto-classifies in this order:

1. **Extension + MIME check.**
   - `.pdf` (`application/pdf`) → PDF pipeline (Gemini route).
   - `.csv` / `.txt` (`text/csv`, `text/plain`) → CSV pipeline (rules route).
   - `.xls` / `.xlsx` → CSV pipeline after server-side conversion to CSV (deferred to Step 2.5 if not in v1).
   - Anything else → `415 unsupported_media_type`.
2. **`document_type` sub-classification** — the enum stored on the row (`form16`, `form_26as`, `ais_tis`, `salary_slip`, `bank_csv`, `bank_pdf`). Decided by combining:
   - **Filename heuristics** (`form16`, `26as`, `ais`, `tis`, `payslip`, `salary`, bank-name prefixes).
   - **Content sniff:**
     - PDF first-page text scan for canonical headers (`"FORM NO. 16"`, `"FORM 26AS"`, `"ANNUAL INFORMATION STATEMENT"`, `"SALARY SLIP"` / `"PAY SLIP"`).
     - CSV header-row scan for column patterns (`Txn Date,Description,Debit,Credit,Balance` → `bank_csv`).
   - **AI tiebreaker** when (filename, sniff) disagree: a lightweight Gemini classification pass returns the `document_type` enum. Only kicks in for ambiguous PDFs.
3. **User can override** the auto-detected `document_type` later via `PUT /api/v1/documents/{id}` (which the SVG's "Reassign" link triggers).
4. **No FY input from the user at upload.** The FY Router (step 4 below) derives every row's FY from internal dates. `hint_tax_year` is accepted only as a tiebreaker for bank CSVs that have date-format ambiguity (e.g., `01/02/24` = Jan 2 vs Feb 1).

#### Upload pipeline (server-side, on `POST /documents/upload`)

1. Save file under `Backend/data/uploads/{user_id}/{document_id}.{ext}`; compute `sha256`. Run **Type detection** (above) to populate `document_type`. Insert `documents` row with `status='uploaded'`, `routing_status='pending'`, `filing_id=NULL`, `tax_year=NULL`.
2. Detection is complete by the time the response returns; the caller sees the chosen `document_type`.
3. **Extract** (asynchronously — the upload response returns immediately with `routing_status='pending'`):
   - **PDF →** Vertex AI Gemini call (`services/extraction/gemini.py`); response persisted as SCHEMA prescribes. Each extracted line/row becomes a `transactions` row with `categorization_method='ai_assisted'`.
   - **CSV →** parse rows; for each row run the rule engine. Successful match → `transactions` with `categorization_method='rule'`. Unmatched → row still written but `category=NULL` (user sees it in transactions list as "needs category").
4. **FY Router** (per ARCH §7.3) walks every row's `txn_date`:
   - `date.month >= 4` → `FY{date.year}-{(year+1) % 100:02d}`; else → `FY{date.year-1}-{date.year % 100:02d}`.
   - All rows in one FY → attach the document to that filing; auto-create the sibling filing if it doesn't exist.
   - Rows span multiple FYs → `documents.routing_status='partially_routed'`; each row's `filing_id`/`tax_year` set per its own date.
   - Invalid / ambiguous / terminal-FY-conflict row → write to `pending_router_inbox` (`router_inbox_reason` enum).
5. Update `documents.routing_report` JSON (powers Frame 2's bottom panel).
6. Append `audit_logs` rows for every state-changing side effect.

### 3.4 Transactions — new `app/api/v1/transactions.py`

Paths per API_CONTRACTS.md §6.9–§6.10. Edits are **PUT** (not PATCH).

```
GET    /api/v1/filings/{id}/transactions
       # filters: ?status=unverified|verified|rejected|all
       #          ?method=rule|ai_assisted|manual
       #          ?head=salary|interest|... &page=&limit=
       # Resp: paginated list + meta.

GET    /api/v1/filings/{id}/transactions/progress
       # Resp: { total, verified, unverified, percent }

GET    /api/v1/filings/{id}/transactions/{tx_id}
       # detail for the edit drawer.

PUT    /api/v1/filings/{id}/transactions/{tx_id}
       # editable fields: category, amount, txn_date, description, tax_year, status, reason
       # Any user edit → categorization_method='manual', confidence_score=1.000, routing_method='manual_override'
       # Resp: { id, filing_id, tax_year, category, routing_method, updated_at }

POST   /api/v1/filings/{id}/transactions/{tx_id}/verify
       # single verify. Idempotent.

POST   /api/v1/filings/{id}/transactions/verify-all
       # body: { filter?: { method?, head? } }
       # bulk verify (typically rule-categorized rows).

POST   /api/v1/filings/{id}/transactions
       # CREATE manually — user adds a row not present in any document.
       # body: { txn_date, amount, description, category?, counterparty? }

DELETE /api/v1/filings/{id}/transactions/{tx_id}
       # rare; intended for clearly bad extractions.
```

### 3.5 Regime — precheck + commit (per API_CONTRACTS §6.2, ARCH §6)

The precheck is a state machine — its `level` decides whether the UI must show the 115BAC modal, block the user, or proceed silently. Match these levels exactly.

```
POST   /api/v1/filings/{id}/precheck-regime
       # body: { regime: "new" | "old" | "both" }
       # Resp: {
       #   filing_id, level: "OK" | "INFO" | "WARN_HIGH" | "BLOCK",
       #   code,                                # e.g. "115bac_opt_out", "115bac_one_time_switch_back",
       #                                        #      "115bac_lifetime_lock", "cat_a_free_switch"
       #   message,                             # human-readable reason
       #   lifetime_switch_backs_remaining?,    # for category B users
       #   acknowledgment_text?,                # WARN_HIGH only — canonical text below
       #   section_ref: "115BAC(6)"
       # }
```

| Level | UI behavior |
|---|---|
| `OK` | Proceed silently to `/calculate`. |
| `INFO` | Show a one-line info banner; no modal. |
| `WARN_HIGH` | Show the **Section 115BAC(6) modal**. User must tick the checkbox and submit `acknowledged_regime_switch=true` + `acknowledgment_text_hash=sha256(acknowledgment_text)` on the next `/calculate` call. |
| `BLOCK` | Show a hard-stop modal. The user cannot proceed in this regime — refer them to switch the chosen regime or seek consultation. |

**Canonical acknowledgment text (ARCH §6.5) — must be displayed verbatim and hashed verbatim:**

> "I have read and understood Section 115BAC(6) and confirm I am exercising my one-time lifetime switch back to the new regime."

Hash input is the UTF-8 bytes of that exact string (no trailing newline). Server stores `regime_acknowledgment_text_hash = sha256_hex(text)` on `tax_returns`.

`/calculate` (already exists) handles the actual regime commit through its `acknowledged_regime_switch` + `acknowledgment_text_hash` body fields. The server sets `regime_used`, `regime_switch_acknowledged=true`, `regime_switch_acknowledged_at`, `regime_switch_section_referenced="115BAC(6)"` in the same transaction. **There is no separate `POST /regime` endpoint** — the existing `/calculate` does the commit.

### 3.6 Summary + PDF (per API_CONTRACTS §6.4)

```
GET    /api/v1/filings/{id}/summary
       # Resp: {
       #   filing_id, user, tax_year, regime_used,
       #   income_breakdown: { salary, interest, other, ... },
       #   deductions: { standard, "80c", "80d", ... },
       #   tax_computation: { taxable_income, tax, cess, surcharge, total_tax },
       #   tds_paid, balance_payable,
       #   calculation_trace: [ steps from calculation_traces.trace_json ]
       # }
       # All monetary values as strings (NUMERIC(18,2)).

GET    /api/v1/filings/{id}/summary.pdf
       # PDF rendered via ReportLab / WeasyPrint.
```

### 3.7 Submit (with email OTP gate, per API_CONTRACTS §2.9 + §6.7)

> **Channel note:** the OTP is delivered to the user's email address.
> Internally the `user_verifications.purpose` value remains `submit_phone`
> for SCHEMA compatibility (the CHECK constraint enum predates the email
> switch); the actual delivery path is driven by `channel='email'`.

```
POST   /api/v1/auth/request-submit-otp
       # body: { filing_id }
       # Sends a 6-digit code to the user's verified email. Bound to filing_id, 10-min TTL, single-use.
       # Resp: { verification_id, filing_id, sent_to (masked, e.g. "as***@example.com"), expires_at }

POST   /api/v1/filings/{id}/submit
       # body: { acknowledgment: true, verification_id, otp }
       # Atomic: consumes OTP, sets submitted_at, submitted_by_user_id, submit_otp_verification_id,
       # flips status to "submitted", appends audit_logs row.
       # Server preconditions (enforced — return 409/422 on miss):
       #   - 100% of transactions verified (else 422 unverified_transactions)
       #   - regime_used IS NOT NULL (else 409 filing_not_ready_for_submit)
       #   - if WARN_HIGH was returned in precheck: regime_switch_acknowledged=true
       #   - email_verified_at AND phone_verified_at populated
       #   - OTP valid + matches filing_id (else 422 invalid_or_expired_otp / 422 otp_filing_mismatch)
       # DB-level constraint chk_tax_returns_submit_otp guarantees no submitted row exists
       # without submit_otp_verification_id.
```

### 3.8 Consultant access — new `app/api/v1/consultants.py` (per API_CONTRACTS §9.1–§9.2)

```
GET    /api/v1/consultants?city=&specialization=&accepting_clients=true&page=&limit=
       # directory
       # Resp: { consultants:[...], meta:{ page, limit, total } }

GET    /api/v1/consultants/{ca_id}
       # profile detail

POST   /api/v1/consultant-access/grants
       # Path A — directory request
       # body: { consultant_id, access_mode: "review_edit"|"full_access", tax_years: ["FY2024-25"], message? }
       # Resp: { id, origin: "directory_request", consultant, status: "pending", tax_years,
       #         requested_at, expires_at }

POST   /api/v1/consultant-access/grants/redeem-code
       # Path B — invite code
       # body: { invite_code, access_mode, tax_years, message? }
       # Resp: { id, origin: "invite_code", consultant, status: "active",
       #         activated_at, expires_at }

GET    /api/v1/consultant-access/grants?tax_year=FY2024-25
       # list grants the user has issued

DELETE /api/v1/consultant-access/grants/{grant_id}
       # revoke
```

### 3.9 Change-sets — singular path (per API_CONTRACTS §9.3)

The canonical contracts use **singular `change-set`** and `accept-change-set` / `reject-change-set` as separate paths (not a sub-action on a collection).

```
GET    /api/v1/filings/{id}/change-set/{change_set_id}
       # Resp: { change_set_id, by_consultant, notes, changes:[
       #   { entity, entity_id, field, before, after }, ... ], created_at }

POST   /api/v1/filings/{id}/accept-change-set/{change_set_id}
       # Applies all changes. Filing status returns to "draft". Taxpayer then re-runs submit flow.

POST   /api/v1/filings/{id}/reject-change-set/{change_set_id}
       # Discards. Filing reverts to pre-CA state.
```

Note: there is no documented `accept-partial` endpoint in API_CONTRACTS — partial accept is achieved by the CA returning a smaller change-set, or by accepting and then editing. The earlier draft of this doc that listed `accept-partial` / `accept-and-submit` was speculative; drop those from the Step 11 acceptance criteria.

### 3.10 Notifications — new `app/api/v1/notifications.py` (per API_CONTRACTS §12.1)

```
GET    /api/v1/notifications?unread=true&page=&limit=
       # Resp: { notifications:[...], meta:{ unread_count, page, limit, total } }
POST   /api/v1/notifications/{id}/read
POST   /api/v1/notifications/read-all
```

**Taxpayer-visible `notification_type` values** (SCHEMA §3 — exhaustive list for this flow):

`account_email_verified`, `account_phone_verified`, `account_password_changed`, `account_login_new_device`, `account_pan_verified`, `account_consent_changed`, `filing_draft_created`, `new_tax_year_available`, `filing_submitted_ack`, `filing_review_complete`, `regime_warning`, `filing_under_officer_review`, `filing_escalated_to_l2`, `filing_escalated_to_l3`, `filing_escalated_to_l4`, `filing_escalated_to_l5`, `filing_revision_requested`, `filing_mismatch_detected`, `consultant_access_request_accepted`, `consultant_access_request_declined`, `consultant_returned_filing`, `consultant_submitted_filing`.

**Server enforces silence on fraud / judicial / enforcement** (ARCH §9.4): the `notification_type` enum **does not contain** taxpayer-facing fraud types. The endpoint additionally filters by recipient role — the taxpayer endpoint can never emit officer/judicial/enforcement-only types even if a misconfiguration writes one.

### 3.11 Settings — new `app/api/v1/settings.py` (consents per API_CONTRACTS §13)

```
# Consents — the only three SCHEMA defines: document_processing | ai_analysis | data_retention
GET    /api/v1/consent
       # Resp: { consents: [{ type, granted, granted_at }] }
POST   /api/v1/consent
       # body: { type, granted: true|false }
DELETE /api/v1/consent/{type}
       # Equivalent to POST { type, granted: false }

# Verification status + profile + sessions — paths confirmed against API_CONTRACTS before Step 12
GET    /api/v1/settings/verification              # email/phone/PAN verification flags
GET    /api/v1/settings/profile
PATCH  /api/v1/settings/profile
GET    /api/v1/settings/notification-prefs
PATCH  /api/v1/settings/notification-prefs
GET    /api/v1/settings/sessions
POST   /api/v1/settings/sessions/{session_id}/revoke
```

**Consent cascade (ARCH §11.2) — server enforces:**

| Revoking | Effect |
|---|---|
| `document_processing` | New uploads → 403 `consent_required`. Existing docs preserved (history is never deleted). |
| `ai_analysis` | RAG disabled, AI categorization disabled. Existing rule-categorized transactions stay. New PDF uploads still extract via Gemini only if consent restored. |
| `data_retention` | Triggers 30-day erasure workflow. Audit chain preserved (audit_logs are append-only and survive erasure per SCHEMA constraint). |

### 3.12 RAG assistant — new `app/api/v1/assistant.py`

```
POST   /assistant/query                                  # body: { question, filing_id?, page_context? }
                                                         # Resp: { answer, citations:[{section, chunk_id}], guardrail_action? }
GET    /assistant/suggested-topics?context=…
```

Guardrails server-side: if the question matches a "compute / submit / change" intent, return `guardrail_action='redirect_to_filing'` instead of answering.

---

## 4. Vertex AI Gemini extraction — design

### 4.1 Where the service account credentials live

When you have provisioned the GCP service account:

1. Download the **service-account JSON key** from the GCP IAM console.
2. Place it at: `Backend/data/secrets/vertex-sa.json` (gitignored — make sure `Backend/.gitignore` lists `data/secrets/` before you check in any code).
3. Add to `Backend/.env` (also gitignored):
   ```
   GOOGLE_APPLICATION_CREDENTIALS=./data/secrets/vertex-sa.json
   GCP_PROJECT_ID=<your-gcp-project-id>
   GCP_REGION=asia-south1
   VERTEX_GEMINI_MODEL=gemini-1.5-pro
   ```
4. Confirm the service account has role **Vertex AI User** (`roles/aiplatform.user`).
5. `app/config.py` reads these via `pydantic_settings.BaseSettings`. The extractor calls `vertexai.init(project=..., location=..., credentials=...)` once at startup.

While credentials are not yet provisioned, set `VERTEX_GEMINI_MODEL=stub` and the extractor returns a deterministic mock payload so Step 3's UI is still buildable.

### 4.2 Service surface

`Backend/app/services/extraction/gemini.py`

```python
class GeminiExtractor:
    def extract(self, document: Document, doc_type: DocType) -> ExtractionResult:
        """
        Uploads document bytes to Gemini, runs the per-type prompt, validates
        the response against the Pydantic schema, returns ExtractionResult.
        Raises ExtractionError on schema validation failure or API error.
        """
```

- **Input:** raw PDF bytes wrapped as `Part.from_data(mime_type='application/pdf', data=...)`.
- **Output:** strict JSON validated against a Pydantic model in `Backend/app/schemas/extraction.py`.
- **Storage:** response stored **verbatim** in `documents.extraction_payload` for audit + replay. Re-extraction creates a new payload version; old payloads retained.
- **Editable:** every field is editable via `PATCH /documents/{doc_id}/extraction`. Edits write a `user_overrides` JSON block layered over the raw payload; transactions are regenerated from the merged view.
- **Failure handling:** API error → `documents.extraction_error` set, `routing_status='extraction_failed'`, UI shows **Retry extraction** + **Edit manually** actions. Rules engine still computes from whatever transactions exist.
- **Confidence:** Gemini does not return per-field confidence — every AI-extracted field is tagged `categorization_method='ai_suggested'` and requires user verification before `/calculate` or `/submit` proceeds.

### 4.3 Generation config (shared across all doc types)

```python
GenerationConfig(
    temperature=0.0,                   # deterministic for tax data
    top_p=1.0,
    max_output_tokens=8192,
    response_mime_type="application/json",
    response_schema=PYDANTIC_SCHEMA,   # per doc type
)
```

### 4.4 Prompts per document type

All prompts share a **system preamble** and end with a strict JSON schema. The model returns ONLY JSON.

**System preamble (every call):**

```
You are an Indian Income Tax document parser. You extract structured data
from official tax documents and bank statements. You NEVER infer, guess, fill
in, or compute values that are not literally present in the document. If a
field is not visible, return null for that field. All amounts are in Indian
Rupees (INR). All dates use ISO format YYYY-MM-DD. All Financial Years use
the canonical format "FYYYYY-YY" with NO space (e.g. "FY2024-25"). All
Assessment Years use "AYYYYY-YY" (e.g. "AY2025-26"). Respond with ONLY a
single JSON object matching the provided schema — no prose, no markdown
fences, no commentary.
```

**Per-type user prompt:**

#### Form 16 (`form_16`)

```
This is an Indian Form 16 (Certificate of TDS on salary issued by an employer
under Section 203 of the Income Tax Act). Extract:

  - employer: { name, tan, pan, address }
  - employee: { name, pan, designation }
  - assessment_year   (e.g. "AY2025-26")
  - financial_year    (e.g. "FY2024-25")
  - period:           { from_date, to_date }
  - salary_breakdown:
      gross_salary
      section_17_1_salary
      section_17_2_perquisites
      section_17_3_profits_in_lieu
      exempt_allowances        # array of { name, amount } — HRA, LTA, conveyance, etc.
      standard_deduction
      professional_tax
      net_salary
  - chapter_via_deductions: array of { section, amount }      # 80C, 80D, 80CCD(1B), 80TTA…
  - tds_quarterly: array of { quarter, receipt_number, amount_paid, tds_deducted, deposit_date }
  - total_tds_deducted

For amounts not present in the certificate, return null. Return ONLY the JSON.
```

#### Form 26AS (`form_26as`)

```
This is an Indian Form 26AS — Annual Tax Statement from TRACES. Extract:

  - assessment_year
  - permanent_account_number       # PAN
  - name_of_assessee
  - part_a_tds_on_salary: array of {
        deductor_name, deductor_tan, total_amount_paid, total_tax_deducted,
        total_tax_deposited,
        transactions: array of { booking_date, date_of_credit, amount_paid,
                                 tax_deducted, tax_deposited, status }
    }
  - part_a1_tds_other_than_salary: same shape as part_a_tds_on_salary
  - part_b_details_of_tax_deducted_at_source_for_15g_15h
  - part_c_details_of_tax_paid_other_than_tds_or_tcs:     # advance tax / self-assessment
        array of { bsr_code, date_of_deposit, challan_serial_number, total_tax_paid }
  - part_d_details_of_refund
  - part_e_high_value_transactions                          # SFT, if present
  - grand_total_tds

For any section not present, return null (NOT an empty array). Return ONLY the JSON.
```

#### AIS / TIS (`ais`)

```
This is an Indian Annual Information Statement (AIS) or Tax Information
Summary (TIS). Extract every reported information row:

  - pan
  - financial_year
  - reported_information: array of {
        information_code,             # e.g. "SFT-004"
        information_description,      # e.g. "Cash deposit"
        information_source,           # reporting entity name
        amount_reported,
        date_or_period,
        status                        # "Active" / "Information is correct" / etc.
    }

Return ONLY the JSON.
```

#### Salary slip (`salary_slip`)

```
This is a monthly salary slip. Extract:

  - employee:  { name, employee_id, designation, department }
  - employer:  { name }
  - pay_period: { month, year, from_date, to_date }
  - earnings:   array of { component_name, amount }   # Basic, HRA, Special Allowance, LTA, Bonus…
  - deductions: array of { component_name, amount }   # PF, Professional Tax, TDS…
  - gross_earnings_total
  - total_deductions
  - net_pay
  - bank_account_credited        # last 4 digits if present

Return ONLY the JSON.
```

#### Bank statement PDF (`bank_pdf`)

```
This is an Indian bank statement (PDF). Extract:

  - account_holder_name
  - account_number_masked
  - bank_name
  - branch
  - statement_period: { from_date, to_date }
  - opening_balance
  - closing_balance
  - transactions: array of {
        txn_date,
        value_date,
        description,
        cheque_or_ref_number,
        debit_amount,          # null if credit
        credit_amount,         # null if debit
        balance_after,
        counterparty_hint      # best-effort counterparty from description, else null
    }

Do NOT infer category, head of income, or tax treatment — categorization is a
separate stage. Return ONLY the JSON.
```

### 4.5 Editability of extracted fields

After extraction, the user sees an **`ExtractionEditor`** form per document. Every field is a pre-filled text/number input. On save:

```
PATCH /documents/{doc_id}/extraction
  body: { fields: { ...partial overrides... } }
```

The server merges `extraction_payload.user_overrides ← fields`, regenerates the derived transactions for this document (idempotent on `(document_id, extraction_payload_version, row_index)`), and writes an `audit_logs` row listing which fields the user changed.

---

## 5. CSV rule-based categorization — design

`Backend/app/services/categorization/rules.py`

- Rules table (`category_rules`) seeded from `Backend/data/seed/category_rules.json`.
- Each row: `pattern_regex` (case-insensitive), `keyword_any[]`, `amount_min`, `amount_max`, `category`, `priority`.
- Engine: highest-priority match wins. No match → `category=NULL`, `categorization_method='unmatched'` → row appears in transactions list flagged for manual category.
- **Editable:** future admin UI exposes CRUD on `category_rules`. User-side "Always categorize like this" button creates a personal-scoped rule.

---

## 6. Frontend — pages, components, API client

### 6.1 New route map (Next.js App Router under `Frontend/app/(app)/`)

```
filings/
  page.tsx                                  # list (optional v1; OK to skip)
  new/page.tsx                              # POST /filings → redirect to /filings/{id}/documents
  [id]/
    layout.tsx                              # FilingContextProvider: fetches GET /filings/{id}, renders tabs+stepper
    documents/page.tsx                      # Frame 2
    transactions/page.tsx                   # Frame 3
    regime/page.tsx                         # Frame 4 + 115BAC modal
    summary/page.tsx                        # Frame 5
    submit/page.tsx                         # Frame 6
    change-sets/[cs_id]/page.tsx            # SVG 3 Frame 3
consultant-access/page.tsx                  # SVG 3 Frame 1
consultants/[ca_id]/page.tsx                # SVG 3 Frame 2
notifications/page.tsx                      # SVG 3 Frame 4
settings/
  consent/page.tsx                          # SVG 3 Frame 5
  profile/page.tsx
  security/page.tsx
  notifications/page.tsx
  regime-preference/page.tsx
assistant/                                  # slide-over (not a route — a UI overlay everywhere)
```

### 6.2 Wire the existing button

`Frontend/components/dashboard/PrimaryCta.tsx:65` — change "Begin filing" href from `#` to `/filings/new`.

### 6.3 New components (`Frontend/components/filings/`)

| Component                                            | Purpose                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| `FilingStepper.tsx`                                  | 1-2-3-4 tracker, driven by `filing.step`.                                      |
| `FilingTabs.tsx`                                     | Documents · Transactions · Regime · Summary · Submit.                          |
| `UploadDropzone.tsx`                                 | Drag/drop multi-file. Streams `POST /documents/upload` per file with progress. |
| `DocumentRow.tsx`                                    | Green/yellow row + Reassign / Delete / View routing.                           |
| `RoutingReportPanel.tsx`                             | Renders `document.routing_report`.                                             |
| `ExtractionEditor.tsx`                               | Per-field editable form over `documents.extraction_payload`.                   |
| `TxnTable.tsx` + `TxnRow.tsx`                        | Filters (status/method/head), RULE/AI badges, single + bulk verify.            |
| `TxnEditDrawer.tsx`                                  | Edit category/amount/date/FY. Hits `PATCH /transactions/{id}`.                 |
| `VerifyProgressBar.tsx`                              | Reads `/transactions/progress`.                                                |
| `RegimeCards.tsx`                                    | Side-by-side computed totals.                                                  |
| `Section115BACModal.tsx`                             | Server-supplied acknowledgment text (so hash matches).                         |
| `SummaryPanel.tsx` + `CalculationTraceAccordion.tsx` |                                                                                |
| `OtpEntry.tsx`                                       | 6-box input with autofocus + paste handler.                                    |

`Frontend/components/collaboration/`: `CADirectoryGrid`, `CADetailModal`, `GrantRequestForm`, `InviteCodeRedeem`, `ChangeSetDiff`, `ImpactSummary`.

`Frontend/components/settings/`: `ConsentToggleRow`, `VerificationStatusCard`, `SessionList`.

`Frontend/components/notifications/`: `NotificationList`, `NotificationItem`, `NotificationTypeFilter`.

`Frontend/components/assistant/`: `AssistantSlideOver`, `SuggestedTopics`, `MessageBubble`, `CitationFootnote`.

### 6.4 API client (`Frontend/lib/api/`)

One file per backend router: `filings.ts`, `documents.ts`, `transactions.ts`, `consultants.ts`, `change_sets.ts`, `notifications.ts`, `settings.ts`, `assistant.ts`. Each function:

- Reads JWT from auth store.
- Hits `/api/v1/...` directly (or via a Next route handler proxy if CORS issues).
- Returns typed shared types from `Frontend/lib/types.ts`.

### 6.5 Navigation guards

In `[id]/layout.tsx`, after fetching `GET /filings/{id}`:

- If user lands on a step ahead of the current allowed step → redirect back.
- "Continue to Regime" disabled in Frame 3 until `progress.percent === 100`.
- "Submit" disabled in Frame 6 until preconditions return all-green from `GET /filings/{id}` summary.

---

## 7. Editability matrix — what the user can change at any time

| Object             | Field                                                                | Endpoint                                           |
| ------------------ | -------------------------------------------------------------------- | -------------------------------------------------- |
| Filing             | `regime_used`, regime ack                                            | `PATCH /filings/{id}`, `POST /filings/{id}/regime` |
| Document           | Extracted fields (Form 16 etc.)                                      | `PATCH /documents/{doc_id}/extraction`             |
| Document           | FY assignment                                                        | `POST /documents/{doc_id}/reroute`                 |
| Transaction        | category, amount, date, description, tax_year, status                | `PATCH /transactions/{txn_id}`                     |
| Transaction        | Bulk verify                                                          | `POST /filings/{id}/transactions/verify-all`       |
| Manual transaction | Create row not in any doc                                            | `POST /filings/{id}/transactions`                  |
| Category rule      | (admin v2) — user "always categorize this way" creates personal rule | `POST /category-rules` (deferred)                  |
| Consent            | Grant / revoke each of the 3 consents                                | `POST /settings/consents/{type}/{grant\|revoke}`   |
| Grant              | Revoke CA, change mode, change scoped FYs                            | `PATCH /consultant-access/grants/{id}`             |
| Profile            | Name, language, city, notification prefs                             | `PATCH /settings/profile`                          |

---

## 8. Acceptance criteria per step

A step is "done" when:

1. Backend endpoint(s) exist, return correct shapes, enforce ownership via JWT.
2. Audit row(s) written for state-changing endpoints.
3. Frontend page(s) render the SVG layout, hit the real endpoints (no mocks).
4. Manual happy-path verified by user.
5. Manual edit path verified (every visible field can be changed and persists).

---

## 9. Implementation roadmap

Steps are designed so each one is independently testable and visible. Each row mirrors the master checklist in §0.1 — tick the box there when both halves are merged and manually verified.

### Step 1 — Auth proxy + filing CRUD &nbsp;`[x]` ✅ Done — 2026-05-15

- **Backend:** `get_current_user` dep (HS256 JWT verify with `AUTH_SHARED_SECRET`) in `app/api/deps.py`; mount a workspace router exposing `POST /api/v1/workspace/years/{tax_year}/filing` (idempotent — returns existing draft) and `GET /api/v1/workspace/years/{tax_year}` (FY bundle). `PATCH /api/v1/filings/{id}` for filing-level edits. Verify against API_CONTRACTS.md §3.4–§3.5.
- **Frontend:** `proxyToBackend` helper at `Frontend/lib/server/backendProxy.ts`; Next route handlers under `Frontend/app/api/workspace/years/[fy]/...` and `/api/filings/[id]/...`; wire `Begin filing` ([PrimaryCta.tsx:65](../Frontend/components/dashboard/PrimaryCta.tsx#L65)) → `/filings/new` page that POSTs to `/api/workspace/years/{activeFY}/filing` → redirects to `/filings/{id}/documents`. Skeleton `[id]/layout.tsx` + `FilingStepper` + `FilingTabs`.
- **Verify:** clicking Begin creates (or returns) a draft filing for the active FY and lands on Documents tab with empty state. Idempotent — clicking again returns the same filing id, not a duplicate.

### Step 2 — CSV upload + rule categorization &nbsp;`[x]` ✅ Done — 2026-05-15

> Includes the Step 2 addendum (PUT `/documents/{id}` for FY reassignment) and
> the broker-/capital-gains-statement support added on top of the original
> bank-CSV scope. CSV → PDF in-memory conversion routes every CSV upload
> through Vertex AI Gemini when the deterministic parser abstains or the
> document type isn't `bank_csv`.

- **Backend:** `POST /documents/upload` for CSV; `category_rules` table + seed; rule engine; FY router; `GET /filings/{id}/documents`; `DELETE /documents/{doc_id}`.
- **Frontend:** `UploadDropzone`; uploaded-docs list; `RoutingReportPanel`.
- **Verify:** upload a CSV, see rows routed to the right FY, see the routing report.

### Step 3 — PDF upload + Gemini extraction &nbsp;`[x]` ✅ Done — 2026-05-15

> Real Vertex AI Gemini 2.5 Pro extraction wired end-to-end. Three-layer
> pipeline: deterministic CSV parser (Layer 1+2) → CSV/xlsx → in-memory PDF
> conversion → Gemini multimodal extract (Layer 3) gated by
> `EXTRACTION_LLM_THRESHOLD` (default 0.9). Schemas: form16, form_26as,
> ais_tis, salary_slip, bank_pdf, capital_gains_statement, broker_pnl.
> xlsx ingestion via openpyxl. Stale-failed dedup auto-recovers on
> re-upload. ExtractionEditor surfaces every field as editable.

- **Backend:** Vertex AI integration in `services/extraction/gemini.py`; per-doc-type Pydantic schemas; `extraction_payload` column populated; `PATCH /documents/{doc_id}/extraction` for edits; `POST /documents/{doc_id}/reextract`.
- **Frontend:** PDF accepted in dropzone; "Extracting…" state; `ExtractionEditor` form; save → reflects in transactions.
- **Verify:** upload Form 16 PDF, edit one extracted number, save, see it flow into transactions.

### Step 4 — Transactions review &nbsp;`[x]` ✅ Done — 2026-05-15

> Eight endpoints in `app/api/v1/transactions.py` (list with status/method/head
> filters + pagination, progress tally, single GET/PUT/DELETE, single verify,
> bulk verify-all, manual create). Frontend: `TxnTable` + `TxnRow` with
> RULE/AI/MANUAL source badges and Indian-grouping ₹ amounts, `TxnEditDrawer`
> for cell-level edits, `VerifyProgressBar` for the verified-% gate. Any user
> edit demotes the row to `manual` / `manual_override`. Transactions tab
> enabled on `FilingTabs`. Also: ExtractionEditor rebuilt with structured
> per-section tables (was a flat dotted-path list).

- **Backend:** `GET /filings/{id}/transactions` (+filters), `/progress`, `PATCH /transactions/{id}`, `/verify`, `/verify-all`, `POST` (manual row).
- **Frontend:** `TxnTable` + badges + `TxnEditDrawer` + `VerifyProgressBar` + bulk-verify.
- **Verify:** bulk-verify all rule rows, edit one AI row, progress reaches 100%.

### Step 5 — Regime precheck + 115BAC modal &nbsp;`[x]` ✅ Done — 2026-05-16

> `POST /filings/{id}/precheck-regime` runs the §6.3 state machine
> (Category A/B × prior regime × lifetime counter) and returns one of
> `OK | INFO | WARN_HIGH | BLOCK`. The regime is **committed via
> `/calculate`** (no separate `POST /regime` exists — see §3.5): a single-
> regime call sets `regime_used`, ack timestamp, section ref, and on
> WARN_HIGH validates `acknowledgment_text_hash == sha256(canonical text)`
> before flipping the bit. `users.lifetime_switch_backs_to_new` is bumped
> on the one-time business-income old→new switch; `audit_logs` records
> every transition. Frontend: `RegimeCards` (preview via `/calculate?regime=both`),
> `Section115BACModal` (server-supplied text, hashed in `crypto.subtle`).

- **Backend:** `POST /filings/{id}/precheck-regime`, regime gate + commit folded into existing `POST /filings/{id}/calculate` (hashed ack).
- **Frontend:** `RegimeCards` (uses existing `/calculate` with `regime: "both"`), `Section115BACModal`.
- **Verify:** choose new when prior was old → modal appears → ack → regime persists.

### Step 6 — Summary + calculation trace &nbsp;`[x]` ✅ Done — 2026-05-16

> `GET /filings/{id}/summary` re-runs `compute_tax` for the committed
> regime and returns `{user, tax_year, statute, regime_used,
> income_breakdown (aggregated from verified transactions, with interest
> and dividend split out of other_sources), deductions (standard from
> trace + Chapter VI-A from declared_deductions), tax_computation, tds_paid,
> balance_payable, calculation_trace}`. 409 `filing_not_ready_for_summary`
> when no regime is committed; the page handles that by redirecting to
> the Regime tab. `GET /summary.pdf` renders ReportLab A4 with the same
> numbers, Indian-grouped INR, and an `attachment; filename="..."` header.
> Bonus: `GET /calculation-trace/explain` produces a Gemini-batched
> plain-English paragraph per step (deterministic fallback when LLM is
> unavailable) so the accordion shows prose + labeled field rows instead
> of raw JSON.

- **Backend:** `GET /filings/{id}/summary`, `GET /filings/{id}/summary.pdf`. (`/calculate` exists.) Also added `GET /filings/{id}/calculation-trace/explain` (Gemini-powered).
- **Frontend:** `SummaryPanel`, `CalculationTraceAccordion`, PDF download button.
- **Verify:** numbers match `/calculate`; trace expands; PDF downloads.

### Step 7 — Submit + OTP &nbsp;`[x]` ✅ Done — 2026-05-16

> Canonical paths are `POST /api/v1/auth/request-submit-otp` and
> `POST /api/v1/filings/{id}/submit` (per API_CONTRACTS §2.9 + §6.7).
> The OTP service mints a sha256-hashed 6-digit code in
> `user_verifications` with `channel='email'` (delivered to the user's
> email address), `purpose='submit_phone'` — the historical SCHEMA-enum
> value kept to avoid a migration; the code is filing-scoped via
> `filing_id`. The service invalidates any prior outstanding row and
> consumes atomically with the status flip. The submit endpoint re-checks
> every precondition — 100% verified, regime committed, email present,
> regime ack coherent — then sets `submitted_at` +
> `submit_otp_verification_id` and writes the
> `filing_submitted` audit row. Bad / expired / cross-filing OTPs map to
> the canonical 422 codes; the attempts counter ratchets up before
> raising so the lockout sticks even on the error path. Frontend:
> precondition checklist with deep-links to fix each blocker, accuracy
> declaration checkbox, `OtpEntry` 6-box input with auto-advance / paste /
> backspace step-back, live expiry countdown, success card with filing
> id + OTP verification id.

- **Backend:** `POST /api/v1/auth/request-submit-otp`, `POST /api/v1/filings/{id}/submit`.
- **Frontend:** precondition checklist; `OtpEntry`; submit CTA + success screen.
- **Verify:** submit blocked until prereqs met; OTP gate works; status flips to `submitted`.

### Step 8 — Notifications &nbsp;`[ ]`

- **Backend:** `GET /notifications`, `POST /notifications/{id}/read`, `POST /notifications/read-all`.
- **Frontend:** list page + badge counter on top bar.
- **Verify:** submitting a filing creates a `filing_submitted_ack` notification.

### Step 9 — Consultant access · Path A (directory) &nbsp;`[ ]`

- **Backend:** `GET /consultants`, `GET /consultants/{id}`, `POST /consultant-access/grants`.
- **Frontend:** directory grid, CA detail, grant request modal.
- **Verify:** send request → grant row exists in `pending` status.

### Step 10 — Consultant access · Path B (invite code) &nbsp;`[ ]`

- **Backend:** `POST /consultant-access/redeem-code`.
- **Frontend:** invite-code input with lookup preview.
- **Verify:** valid code → grant active immediately.

### Step 11 — Change-set review &nbsp;`[ ]`

- **Backend:** `GET /filings/{id}/change-sets[/cs_id]`, `accept`, `reject`, `accept-and-submit`.
- **Frontend:** `ChangeSetDiff` + `ImpactSummary` + 3-button action row.
- **Verify:** accept-and-submit flows through the OTP gate.

### Step 12 — Settings (consents + verification + profile) &nbsp;`[ ]`

- **Backend:** `/settings/*` endpoints.
- **Frontend:** consent toggles + cascade tooltips + sessions list.
- **Verify:** revoking a consent triggers its documented cascade.

### Step 13 — RAG assistant slide-over &nbsp;`[ ]`

- **Backend:** `POST /assistant/query` with guardrails.
- **Frontend:** slide-over with suggested topics, Q&A, citations.
- **Verify:** "Calculate my tax" is redirected, not answered.

---

## 10. Open questions / TBD

- ~~Auth flow~~ — **resolved.** Reusing the existing Next.js cookie+OTP auth (see §0 and §3.1).
- Vertex AI service account: user will provision; credentials go to `Backend/data/secrets/vertex-sa.json` (see §4.1). Until provided, `VERTEX_GEMINI_MODEL=stub` returns mock payloads so the UI is unblocked.
- CA-side experience (the CA reading/editing the filing) is out of scope for this doc — covered by `CA_MOCKUPS.md`.
- Officer L1 worklist UI is out of scope — covered by `OFFICER_MOCKUPS.md`. We only need the submit endpoint to flip status and write the right rows so the officer side can pick it up.

---

## 11. Canonical error codes (cite from API_CONTRACTS.md §15)

Backend MUST emit these exact `code` strings in error responses; frontend MUST switch on them (not on `message`). When you see a new failure mode that isn't here, add it to API_CONTRACTS.md first, then mirror it here.

| HTTP | `code` | Surface in filing flow |
|---|---|---|
| 401 | `unauthorized` | Any endpoint without a valid backend JWT (proxy mis-config). |
| 403 | `consent_required` | Upload blocked when `document_processing` revoked; AI categorization paused when `ai_analysis` revoked. |
| 403 | `fy_not_in_grant` | CA tries to access a FY outside their grant scope. |
| 404 | `filing_not_found` | Filing id unknown or soft-deleted. |
| 404 | `invalid_or_expired_invite_code` | Invite code unknown, exhausted, revoked, or expired. |
| 409 | `regime_acknowledgment_required` | `/calculate` called without ack after precheck returned `WARN_HIGH`. |
| 409 | `routing_in_progress` | `GET /documents/{id}/routing-report` called before extraction finished. |
| 409 | `filing_locked` | Trying to edit a filing in a terminal state (`accepted`, `rejected`). |
| 409 | `filing_not_ready_for_submit` | Submit called before `regime_used` set or some other precondition. |
| 409 | `grant_already_exists` | Duplicate consultant grant for the same CA. |
| 413 | `file_too_large` | Upload over 10 MB. |
| 415 | `unsupported_media_type` | Upload extension/mime not in {pdf, csv, txt, xls, xlsx}. |
| 422 | `regime_switch_blocked` | Precheck returned `BLOCK` — lifetime lock. |
| 422 | `unverified_transactions` | `/calculate` or `/submit` while any transactions are unverified. |
| 422 | `invalid_or_expired_otp` | OTP wrong or past TTL (10 min, 5 attempts). |
| 422 | `otp_filing_mismatch` | OTP issued for a different filing than the one being submitted. |
| 503 | `rules_not_configured` | `country_rules` missing for the FY being calculated. |

---

## 12. How we work this doc

- This file is the **source of truth** for scope per step. If we decide to change a contract mid-flight, the doc is updated _before_ the code is changed.
- Each completed step gets a `✅ Done — <date>` annotation in §9.
- When in doubt during implementation, ask. Don't drift from this contract silently.
