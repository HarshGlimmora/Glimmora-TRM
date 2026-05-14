# GlimmoraTax — Admin Frontend Mockups

> **Version:** 1.0 | **Date:** 2026-05-13
> **Role covered:** Admin
> **Companion to:** [README.md](README.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [API_CONTRACTS.md](API_CONTRACTS.md) · [SCHEMA.md](SCHEMA.md)

Admin is **system-and-rules-driven**. Admins do *not* see taxpayer filing data on the homepage — accessing any taxpayer's data requires a separate just-in-time elevation flow that is itself audited.

![Admin storyboard](../../diagrams/admin-storyboard.svg)

**File:** [`diagrams/admin-storyboard.svg`](../../diagrams/admin-storyboard.svg)

| # | Screen | Route | What's shown |
|---|---|---|---|
| ① | **Rule change board** | `/admin/rules` | Three-column kanban: **PROPOSED** (purple, 2 cards) · **AWAITING APPROVAL** (amber, 1 card with prominent "YOU CANNOT APPROVE" red chip since you're the creator) · **LIVE** (green, 47 cards with a superseded `cess v1` muted at the bottom). Each card shows rule type, FY, version, source reference, creator. |
| ② | **Create new rule** | `POST /admin/rules` | Header fields (country, tax_year, rule_type, version). Dark-themed **JSON editor** with rule body (slabs array for `income_slab_new_regime v2`). Source reference, effective_from/to dates. Purple **Save as PROPOSED** CTA. Footer note explaining `created_by_user_id` is set automatically and approval cannot be self. |
| ③ | **Dual-approval (second admin)** | `POST /admin/rules/{id}/approve` | Purple identity banner ("Logged in as: admin@2 — different from creator admin@1"). **Side-by-side diff** of v1 (red, current LIVE) vs v2 (green, proposed): slab thresholds and rates compared row-by-row. **Indigo dual-approval check panel** at the bottom showing the DB constraint `chk_rules_dual_approver` will block self-approval. Three buttons: Reject · Request changes · Approve & activate. |
| ④ | **User management** | `/admin/users` | Search bar + role/status filters + Add button. User-counts KPI strip (taxpayers · CAs · officers · judicial · enforcement · suspended). Pending-verifications table with one-click **Approve** per row (officer awaiting role assignment, self-registered CA, enforcement agency with clearance verified). **Red just-in-time elevation panel** explaining admins do not have automatic access to taxpayer filing data. Recent-actions list at the bottom. |
| ⑤ | **System health** | `/admin/health` | Two side-by-side panels: **L1 Deterministic** (green, all components healthy) and **L2 AI / L3 RAG** (amber, OpenAI elevated p95 · SMS gateway 2 retries). 24h-throughput grid (filings · documents · RAG queries · OpenAI tokens · cache hit · rule activations · fraud cases · audit writes). **Indigo compliance snapshot panel** (consents · erasures · active fraud · enforcement live · PII redactions · verification blocks · rule version mismatches). |
| ⑥ | **Audit search** | `/admin/audit?q=…` | Free-text query bar (`action: regime_switch_acknowledged AND tax_year: FY2024-25`). Filter chips. 42 results — three rows visible showing timestamp · action · actor · entity. **Red self-audit panel** prominently confirming that the search itself is audited (`audit_search_performed`). Export CSV + Save view CTAs. |

**Key UX decisions:**

- **Dual approval is enforced visually before it's blocked at the DB** — the AWAITING APPROVAL card shows "YOU CANNOT APPROVE" in red when you're the creator. The actual DB constraint `chk_rules_dual_approver` is a backstop.
- **Admins don't see taxpayer data on user management** — the elevation panel is red and explicit, requiring a reason + ticket # for any per-user data access. Just-in-time elevation is itself audited.
- **System health distinguishes trust layers** — L1 (deterministic) is shown in green because it's the source of truth; L2/L3 (AI/RAG) is shown in amber to communicate that degraded performance there is non-blocking (rules still compute).
- **Audit-search is meta-audited** — admins are the only role with global search, so admins watching admins is a core accountability mechanism. The self-audit panel is red, not slate, to communicate that this is a designed feature, not an afterthought.

---

## Color & shape conventions

Purple as the role color (`#6b21a8` headers, `#e9d5ff` accents). Kanban columns use the universal lifecycle colors (purple proposed · amber pending · green live). Diff viewers use the standard red-before / green-after pattern from the CA change-set page.

---

## What's not in these mockups (deferred)

- **RAG corpus management** — admin can add/remove knowledge chunks; conventional CRUD UI
- **Feature flag panel** — config flags for FY rollover and other gates
- **Compliance report exports** — DPDP-specific report generation; conventional CSV/PDF
- **Admin-to-admin chat / approvals queue** — out of MVP

---

> Living document.
