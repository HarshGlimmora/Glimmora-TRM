# Homepage Plan — Post-Login, by Role

> Companion to [README.md](README.md). Defines what each role sees on `/home` after authentication, grounded in GlimmoraTax's trust-first principles: **Rules decide, AI suggests, RAG explains**, with three-consent gating and full auditability.

---

## 0. Shared Shell (Every Role)

A single `/home` route renders a role-resolved layout. Elements common to all roles:

| Element | Purpose | Notes |
|---|---|---|
| **Top bar** | Logo, role badge, FY selector (default current FY), search, notifications, profile menu | FY selector globally scopes data; persists across pages |
| **Role badge** | Shows `Taxpayer • PAN ABCDE1234F` / `CA` / `Officer L3` / etc. | Prevents role confusion — critical for officers who may also be taxpayers |
| **Consent / session indicator** | Small lock icon → consents granted, session expiry | Three-consent model from README §Core Principle |
| **RAG assistant launcher** | Floating "Ask" button, scoped to current page context | Always available; explains only — never computes |
| **Audit trail link** | "View my activity" — every role gets a read-only timeline of their own actions | Trust feature, not just admin |
| **Help / "What's new"** | First-login coach marks | Auto-dismiss after 3 sessions |

---

## 1. Taxpayer Homepage

The taxpayer homepage is **filing-status-driven** — what shows depends on whether they have an in-progress filing for the selected FY.

### 1a. New User (No Filings Yet) — *Empty State*

Hero card: **"Start your FY 2024-25 return"** with a 4-step progress visualizer (`Consent → Upload → Review → Summary`). Single primary CTA: **Begin filing**.

Secondary widgets:

- **Verification panel (top of list, blocking)** — shows email and phone verification status with inline actions:
  - Email verification: `Send link` / `Resend link` button + "Check your inbox" state
  - Phone OTP: 6-digit input + `Resend OTP` (60s cooldown)
  - Both must be green-checked before the user can submit a filing. The UI displays a banner explaining that submission requires both checks plus a fresh phone OTP at submit time.
- **Setup checklist** — profile completeness, PAN verified, city set (used by CA directory), regime preference noted
- **What you'll need** — document checklist (Form 16, 26AS, AIS/TIS, bank statements, salary slips) with sample/anonymized previews
- **Trust explainer (collapsible)** — the three-layer principle in plain language; one-time read, dismissible
- **Consents panel** — shows the three consents required, none granted yet

### 1b. Returning User With Active/Past Filings

Hero card: **Current filing status** with the same 4-step bar but highlighting the active step. Resume CTA jumps to where they left off.

Widget grid (2-col):

| Widget | Content |
|---|---|
| **Tax summary card** | If filing complete: total income, tax payable/refund, regime chosen, every figure linked to its rule citation. If draft: "Estimated so far." |
| **Regime comparison snapshot** | Old vs New side-by-side with delta and the **regime-switch warning** if prior FY used a different regime (README §Workflow 2) |
| **Documents** | Uploaded docs with extraction status (parsed / needs review / failed). Re-upload inline |
| **Transactions needing your review** | Count of AI-suggested categorizations awaiting confirmation. Empty when none |
| **Filing history** | Last 3 FYs with status pills (Draft / Filed / Acknowledged / Under review / Flagged) |
| **Consultant access** | List of CAs with active grants, mode, granted FYs, expiry, revoke button. Two CTAs in the empty state: **"Find a CA in your city"** (opens the directory at `GET /consultants?city=<my_city>`) and **"Enter an invite code"** (opens the code-redemption modal for out-of-city CAs). |
| **CA directory** *(when opened)* | Card grid of listed CAs in the taxpayer's city, filterable by specialization / language / fee range / years of experience. Each card shows name, photo, self-attested ICAI #, bio, languages, fee range indicator. Primary CTA per card: **"Request access"** (asks for `access_mode` + `tax_years` + optional message). Status returns as `pending` until the CA responds. |
| **Notifications** | Officer queries, CA requests, regime warnings, rule updates affecting their filing |

Edge case widgets (only when applicable):

- **Fraud-case banner** — if their filing is flagged/under judicial/enforcement review, a banner with case ID, current stage, and a "View case timeline" link. No defensive language; just facts and rights.
- **Refund tracker** — once a return is filed
- **Rule-version diff alert** — if a rule used in their draft has been superseded mid-filing

---

## 2. Consultant (CA) Homepage

CA homepage is **client-portfolio-driven**. A CA sees zero PII until a taxpayer grants access (README §Workflow 3).

### 2a. New CA (No Clients Yet)

Hero card: **"Get listed and start receiving clients"** explaining the two paths through which a CA can be engaged: directory listing (taxpayer finds you in their city) and invite codes (you generate a code and share it with a specific taxpayer).

Widgets:

- **Directory listing toggle** — primary CTA. Shows current state of the CA's `ca_profiles` row: `listed_in_directory`, `accepting_clients`, served cities. Disabled until the CA has verified both email and phone — explicit message: *"Verify your email and phone first to be listed."*
- **Profile / credentials** — self-attested ICAI membership #, bio, specialization tags, languages, years of experience, fee range indicator, photo. Editable; saves to `PUT /consultant/profile`.
- **Invite codes** — list of the CA's active codes with `label`, `max_uses`, `used_count`, `expires_at`. Primary CTA: **"Generate new invite code"** opens a modal that returns the plaintext code exactly once (warning: "Save this code now — it will not be shown again").
- **Search by PAN** — disabled with helper text *"You can search clients only after they grant you access."*
- **Pending directory requests** — taxpayers who chose this CA from the directory but the CA hasn't accepted/declined yet. Each row has `Accept` / `Decline` buttons.
- **Knowledge feed** — recent rule changes (RAG-curated), pinned.

### 2b. Active CA

Hero strip: portfolio KPIs — *Total clients · Filings in draft · Filings ready for review · Filings filed this FY · Action required*

Widget grid:

| Widget | Content |
|---|---|
| **Client list (primary table)** | PAN, name, filing status, last activity, regime, granted FYs, access expiry, and a single **"View"** button per row that opens the full client detail view in one click (equivalent to the `client_detail_url` from the original grant notification). No multi-step navigation. |
| **Client detail view (opened via "View")** | Drills into a single client: profile (PAN, name, contact), shared documents grouped by type, transactions, active filings per granted FY, calculation traces, change-set history, "Edit / Return / Submit" actions per the grant's `access_mode`. |
| **Action queue** | Per-client items needing CA attention: ambiguous transactions the client deferred, regime decisions, missing docs. Each item also has a one-click jump to that client's detail view. |
| **Search by PAN** | For clients already granted; the lookup is logged in the client's audit trail. Returning a match also exposes the same one-click "View" affordance. |
| **Rule change impact** | "3 of your clients are affected by Section X amendment" — links to the affected clients' detail views and to the RAG explainer. |
| **Activity log** | The CA's own actions across all clients (readable by the client too, by design). |

> **Notification → client click-through.** Two notification types lead to the same place:
>
> - `consultant_access_request` — from a directory request (CA must accept first; "View" appears after accept).
> - `consultant_invite_code_used` — from an invite-code redemption (client appears immediately; "View" works right away).
>
> Both payloads carry a `client_detail_url` deep link. Clicking the notification — or the "View" button on the client list row — opens the same client detail view. The CA never has to search by PAN to find a newly-granted client.

A CA never sees:

- Aggregate cross-client data unless every relevant client has granted access
- Any client's filing after access expiry — historical access is logged but data view is gated

---

## 3. Officer (L1–L5) Homepage

Officer homepage is **worklist-driven**, with level-scoped capabilities.

Hero strip: *Assigned to me · Team queue · SLA breaches · Cases I escalated · Flagged this week*

Widgets:

| Widget | Content |
|---|---|
| **My worklist** | Filings assigned for review, sortable by risk score, FY, region, SLA remaining |
| **Team queue** (L3+) | Unassigned filings + ability to pull or reassign |
| **Risk signals** | AI-flagged anomalies grouped by type (income mismatch with 26AS/AIS, regime irregularity, deduction outliers). Each item links to the supporting evidence — never auto-acts |
| **My flagged cases** | Cases this officer flagged, with current status (flagged / judicial_review / enforcement_assigned / closed) — read-only after handoff (README §Workflow 4) |
| **KPIs** | Personal: avg review time, accuracy (vs L4 overrides), volume; team-scope for L4–L5 |
| **Recent rule updates** | What changed in rules they apply — RAG-linked |
| **Audit me** | Officer's own action log, surfaced prominently — trust signal |

Level-specific:

- **L1–L2:** intake/triage view, can flag only
- **L3:** can request judicial review
- **L4–L5:** team oversight, override authority, audit access across team

Officers never see PII outside an assigned case — search is case-scoped, not free-text on taxpayer names.

---

## 4. Judicial Officer Homepage

Hero strip: *Pending review · In deliberation · Dismissed (last 30d) · Assigned to enforcement (last 30d)*

Widgets:

| Widget | Content |
|---|---|
| **Incoming case queue** | Cases escalated by officers, with case ID, escalating officer, age, summary, full evidence bundle on open |
| **Case workspace shortcuts** | Pinned cases the judicial officer is actively deliberating |
| **Decisions log** | Their own past dismissals/assignments — citation-ready |
| **Enforcement roster** | Which agencies are available, current load (read-only) |
| **Statute reference panel** | RAG-curated quick links to relevant sections — explains only |
| **Conflict-of-interest declaration** | One-click "Recuse from case X" with required reason |

A judicial officer sees full taxpayer data **only within an opened case** — the home page never displays PII.

---

## 5. Enforcement Agency Homepage

Hero strip: *Active investigations · Access expiring soon · Access expired · Closed this quarter*

Widgets:

| Widget | Content |
|---|---|
| **Active cases** | Cases assigned by judiciary, each showing case ID, taxpayer (PAN, masked name), access window (start–end), scope, judicial order link |
| **Access countdown** | Time-bound access prominently shown per case — turning amber <48h, red on expiry. No silent extensions. |
| **Evidence checklist** | Per case — documents retrieved vs not yet retrieved (audited) |
| **Investigation log** | Their own queries/document accesses on each case — same view available to the judicial officer who assigned the case |
| **Renewal requests** | Outgoing requests for time extension; status |

The agency cannot search the platform globally — only case-scoped retrieval. This is enforced at API level; the homepage simply reflects it.

---

## 6. Admin Homepage

Admin is **system-and-rules-driven**. Per README, rule changes need dual approval.

Hero strip: *Pending rule approvals (mine) · System health · Users awaiting verification · Open incidents*

Widgets:

| Widget | Content |
|---|---|
| **Rule change board** | Proposed / awaiting-second-approval / live / superseded — with diff view and FY applicability. Dual-approval indicator: never see "approve" if you authored it |
| **User management** | New registrations needing verification, role assignments (CA credential checks, officer onboarding), suspended accounts |
| **System health** | Rules engine status, OpenAI/AI extraction status, RAG status, storage, DB. Each component independently shown — admins should see when AI is down even though filings still work |
| **Audit search** | Free-text search across the audit log (the only role with this capability) |
| **RAG corpus management** | Docs ingested, last ingest run, document versions |
| **Compliance reports** | Counters: consents granted/revoked, fraud cases by stage, enforcement access events |
| **Config flags** | FY rollover, feature flags |

Admins do **not** see taxpayer filing data on the homepage — they manage the system, not returns. Accessing a specific taxpayer's data requires a separate just-in-time elevation flow (audited).

---

## Cross-Cutting Principles Applied

1. **No role sees data it doesn't need at home.** Officers don't see PII on the homepage; admins don't see filings; CAs see nothing until granted access. The homepage is the strongest place to communicate the trust model — every empty state explains *why* it's empty.
2. **The 4-step filing tracker is canonical** for taxpayers — same component shown across the app so users always know where they are.
3. **Every widget showing a number must be drillable to its source** (rule citation, audit entry, or evidence document). No floating numbers.
4. **Empty states are first-class.** A new user of any role lands on a homepage that's instructive, not blank.
5. **RAG is contextual.** The assistant launcher carries the current page context so questions like "what does this widget mean" work without re-asking.
6. **Notifications are role-typed.** Same backend events render differently per role (e.g., "filing flagged" → taxpayer sees rights & timeline, officer sees status, admin sees aggregate).
7. **One primary CTA per homepage.** Filing for taxpayers, worklist for officers, case queue for judiciary/enforcement, rule board for admin, client list for CAs.

---

## Suggested Next Steps

1. Confirm role list above matches what's currently scoped for MVP (README implies all six are in scope, but the implementation plan v3 may narrow MVP — e.g., judicial/enforcement might be Phase 2).
2. Pick which role to prototype first — recommend **Taxpayer + Officer L1** since they exercise the trust narrative most directly.
3. Define the notification taxonomy (event types × role views) before building widgets, since it cuts across every homepage.
4. Decide on FY selector behavior: global state vs per-page — affects routing.
