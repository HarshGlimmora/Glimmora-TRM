# GlimmoraTax — Database Schema

> **Version:** 1.0 | **Date:** 2026-05-13
> **Companion to:** [README.md](README.md), [ARCHITECTURE.md](ARCHITECTURE.md), [API_CONTRACTS.md](API_CONTRACTS.md), [DEMO_PLAN.md](DEMO_PLAN.md), [HOMEPAGE_PLAN.md](HOMEPAGE_PLAN.md)

Authoritative PostgreSQL 16 + pgvector schema for the GlimmoraTax MVP. Every API contract and architectural workflow in the companion docs is realizable against the tables defined here.

---

## Table of Contents

1. [Conventions](#1-conventions)
2. [Required Extensions](#2-required-extensions)
3. [Enumerations](#3-enumerations)
4. [Entity Relationship Overview](#4-entity-relationship-overview)
5. [Identity, Consent & Verification](#5-identity-consent--verification)
   - 5.1 [`users`](#51-users)
   - 5.2 [`user_consents`](#52-user_consents)
   - 5.3 [`user_verifications`](#53-user_verifications)
   - 5.4 [`refresh_tokens`](#54-refresh_tokens)
   - 5.5 [`ca_profiles`](#55-ca_profiles)
6. [Financial Year Workspace](#6-financial-year-workspace)
   - 6.1 [`tax_returns`](#61-tax_returns)
   - 6.2 [`calculation_traces`](#62-calculation_traces)
7. [Documents, Routing & Transactions](#7-documents-routing--transactions)
   - 7.1 [`documents`](#71-documents)
   - 7.2 [`transactions`](#72-transactions)
   - 7.3 [`pending_router_inbox`](#73-pending_router_inbox)
8. [Rules & Knowledge](#8-rules--knowledge)
   - 8.1 [`country_rules`](#81-country_rules)
   - 8.2 [`knowledge_chunks`](#82-knowledge_chunks)
   - 8.3 [`rag_query_log`](#83-rag_query_log)
9. [Consultant Access — Directory + Invite Code](#9-consultant-access--directory--invite-code)
   - 9.1 [Two Grant Origins](#91-two-grant-origins)
   - 9.2 [`consultant_invite_codes`](#92-consultant_invite_codes)
   - 9.3 [`consultant_access_grants`](#93-consultant_access_grants)
   - 9.4 [`filing_change_sets`](#94-filing_change_sets)
10. [Fraud → Judicial → Enforcement](#10-fraud--judicial--enforcement)
    - 10.1 [`fraud_cases`](#101-fraud_cases)
    - 10.2 [`enforcement_access`](#102-enforcement_access)
11. [Cross-Cutting](#11-cross-cutting)
    - 11.1 [`notifications`](#111-notifications)
    - 11.2 [`audit_logs`](#112-audit_logs)
12. [Invariants & Triggers](#12-invariants--triggers)
13. [Row-Level Access Patterns](#13-row-level-access-patterns)
14. [Migration Order](#14-migration-order)
15. [Seed Data](#15-seed-data)
16. [Change Log](#16-change-log)

---

## 1. Conventions

| Aspect | Choice |
|---|---|
| Primary keys | `UUID DEFAULT gen_random_uuid()` (requires `pgcrypto`) — except `audit_logs` which uses `BIGSERIAL` for write throughput |
| Timestamps | `TIMESTAMPTZ`, always UTC; every mutable table has `created_at` and `updated_at` |
| Money | `NUMERIC(18,2)` — never `FLOAT` |
| Enums | Postgres `CREATE TYPE … AS ENUM` (see [§3](#3-enumerations)) |
| Soft delete | `deleted_at TIMESTAMPTZ` on `users`, `tax_returns`, `documents` (non-trivial blast radius) |
| FY tag | `VARCHAR(10)` matching `^FY\d{4}-\d{2}$` — enforced by `CHECK` everywhere it appears |
| PAN | `VARCHAR(10)` matching `^[A-Z]{5}[0-9]{4}[A-Z]$` — enforced by `CHECK` |
| Phone | `VARCHAR(20)`; Indian mobiles `^\+?[6-9]\d{9}$` |
| FKs | Real `REFERENCES` with explicit `ON DELETE` semantics |
| Audit | `audit_logs` is append-only — enforced by a trigger blocking `UPDATE`/`DELETE` |
| Naming | `snake_case`; indexes `idx_<table>_<cols>`; uniques `uq_<table>_<cols>`; checks `chk_<table>_<rule>` |
| Sensitive tokens | Stored hashed (sha256 hex), never plaintext |

---

## 2. Required Extensions

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS vector;     -- pgvector (RAG)
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- trigram indexes for PAN / name / city search
```

---

## 3. Enumerations

```sql
-- ─────────────────────────────────────────────────────────────────
-- Identity & verification
-- ─────────────────────────────────────────────────────────────────
CREATE TYPE user_role AS ENUM (
  'taxpayer',
  'consultant',
  'officer_l1', 'officer_l2', 'officer_l3', 'officer_l4', 'officer_l5',
  'judicial_officer',
  'enforcement_agency',
  'admin'
);

CREATE TYPE consent_type AS ENUM (
  'document_processing',
  'ai_analysis',
  'data_retention'
);

CREATE TYPE verification_channel AS ENUM ('email', 'phone');

CREATE TYPE verification_purpose AS ENUM (
  'signup_email',         -- email link verification at registration
  'signup_phone',         -- phone OTP at registration
  'submit_phone',         -- phone OTP re-challenge before filing submit
  'password_reset',
  'login_new_device'
);

-- ─────────────────────────────────────────────────────────────────
-- Filing lifecycle
-- ─────────────────────────────────────────────────────────────────
CREATE TYPE filing_status AS ENUM (
  'draft',
  'in_review_by_ca',
  'revision_returned',
  'revision_requested',
  'submitted',
  'accepted',
  'rejected'
);

CREATE TYPE regime AS ENUM ('old', 'new');

-- ─────────────────────────────────────────────────────────────────
-- Documents
-- ─────────────────────────────────────────────────────────────────
CREATE TYPE document_type AS ENUM (
  'form16', 'bank_csv', 'ais_tis', 'form_26as', 'salary_slip'
);

CREATE TYPE document_status AS ENUM (
  'uploaded', 'processing', 'completed', 'failed'
);

CREATE TYPE routing_status AS ENUM (
  'pending', 'routed', 'partially_routed', 'unresolved', 'overridden'
);

CREATE TYPE router_method AS ENUM ('auto', 'manual_override');

CREATE TYPE router_inbox_reason AS ENUM (
  'invalid_date', 'terminal_fy_conflict', 'ambiguous_fy', 'routing_review_required'
);

-- ─────────────────────────────────────────────────────────────────
-- Transactions
-- ─────────────────────────────────────────────────────────────────
CREATE TYPE categorization_method AS ENUM ('rule', 'ai_assisted', 'manual');
CREATE TYPE transaction_status    AS ENUM ('unverified', 'verified', 'rejected');

-- ─────────────────────────────────────────────────────────────────
-- Consultant access — hybrid directory + invite-code flow
-- ─────────────────────────────────────────────────────────────────
CREATE TYPE consultant_access_mode AS ENUM ('full_access', 'review_edit');

CREATE TYPE grant_origin AS ENUM (
  'directory_request',   -- taxpayer found CA in directory and requested access
  'invite_code'          -- CA shared a code; taxpayer redeemed it
);

CREATE TYPE consultant_grant_status AS ENUM (
  'pending',             -- directory_request only — waiting for CA to accept/decline
  'active',              -- accepted by CA, OR created via valid invite code
  'rejected',            -- CA declined a directory request
  'revoked',             -- taxpayer (or CA) revoked
  'expired'              -- TTL hit
);

CREATE TYPE invite_code_status AS ENUM ('active', 'exhausted', 'revoked', 'expired');

-- ─────────────────────────────────────────────────────────────────
-- Fraud lifecycle
-- ─────────────────────────────────────────────────────────────────
CREATE TYPE fraud_case_status AS ENUM (
  'flagged', 'judicial_review', 'enforcement_assigned', 'closed'
);

CREATE TYPE fraud_flag_reason AS ENUM (
  'income_mismatch', 'undisclosed_income', 'fabricated_deduction', 'other'
);

CREATE TYPE judicial_decision AS ENUM ('dismiss', 'assigned_to_enforcement');

CREATE TYPE enforcement_outcome AS ENUM (
  'tax_liability_confirmed', 'no_fraud_found', 'partial_findings', 'escalated_externally'
);

-- ─────────────────────────────────────────────────────────────────
-- Rules (dual-approval)
-- ─────────────────────────────────────────────────────────────────
CREATE TYPE rule_status AS ENUM ('pending_approval', 'active', 'superseded', 'rejected');

-- ─────────────────────────────────────────────────────────────────
-- Notifications
-- IMPORTANT: no fraud-lifecycle types for taxpayers — fraud is silent.
-- ─────────────────────────────────────────────────────────────────
CREATE TYPE notification_type AS ENUM (
  -- Taxpayer · account
  'account_email_verified',
  'account_phone_verified',
  'account_password_changed',
  'account_login_new_device',
  'account_pan_verified',
  'account_consent_changed',

  -- Taxpayer · filing lifecycle
  'filing_draft_created',
  'new_tax_year_available',
  'filing_submitted_ack',
  'filing_review_complete',
  'regime_warning',

  -- Taxpayer · officer review progression L1 → L5 (non-fraud)
  'filing_under_officer_review',
  'filing_escalated_to_l2',
  'filing_escalated_to_l3',
  'filing_escalated_to_l4',
  'filing_escalated_to_l5',
  'filing_revision_requested',

  -- Taxpayer · mismatch alerts (NOT fraud — routine validation prompt)
  'filing_mismatch_detected',

  -- Taxpayer · consultant interactions
  'consultant_access_request_accepted',
  'consultant_access_request_declined',
  'consultant_returned_filing',
  'consultant_submitted_filing',

  -- Consultant
  'consultant_access_request',           -- directory-request flow: taxpayer found CA in directory
  'consultant_invite_code_used',         -- invite-code flow: taxpayer used the CA's code
  'consultant_access_revoked',
  'consultant_client_filing_updated',
  'consultant_rule_change_impact',

  -- Officer
  'officer_filing_assigned',
  'officer_sla_breach_warning',
  'officer_case_escalated_in',

  -- Judicial
  'fraud_case_assigned',
  'fraud_case_renewal_requested',

  -- Enforcement
  'enforcement_access_granted',
  'enforcement_access_expiring_soon',
  'enforcement_access_expired',

  -- Admin
  'admin_rule_pending_second_approval',
  'admin_system_health_alert'
);
```

---

## 4. Entity Relationship Overview

```
                              ┌─────────────────┐
                              │      users      │
                              └────────┬────────┘
        ┌──────────┬──────────┬────────┴───┬──────────────┬──────────────┐
        │          │          │            │              │              │
        ▼          ▼          ▼            ▼              ▼              ▼
  ┌──────────┐ ┌────────┐ ┌──────────┐ ┌────────────┐ ┌─────────────┐ ┌──────────┐
  │user_cons.│ │user_   │ │ca_profil.│ │tax_returns │ │consultant_  │ │refresh_  │
  │          │ │verific.│ │(directory│ │(FY-scoped) │ │invite_codes │ │tokens    │
  │          │ │(OTP)   │ │ listing) │ │            │ │(CA-issued)  │ │          │
  └──────────┘ └────────┘ └──────────┘ └─────┬──────┘ └──────┬──────┘ └──────────┘
                                              │               │
                                              │               ▼
                                              │      ┌─────────────────────┐
                                              │      │ consultant_access_  │
                                              │      │ grants              │
                                              │      │ (origin: directory  │
                                              │      │  | invite_code)     │
                                              │      └──────────┬──────────┘
                                              │                 │
              ┌───────────────────────────────┼────────┐        ▼
              ▼                  ▼            ▼        │ ┌────────────────────┐
       ┌────────────┐    ┌────────────────┐ ┌────┐    │ │ filing_change_sets │
       │ documents  │    │  transactions  │ │calc│    │ └────────────────────┘
       │            │    │                │ │trc │    │
       └─────┬──────┘    └────────────────┘ └────┘    │
             │                                        │
             ▼                                        ▼
       ┌───────────────────┐         ┌─────────────────┐         ┌──────────────────┐
       │ pending_router_   │         │  fraud_cases    │────────▶│ enforcement_     │
       │ inbox             │         │                 │         │ access           │
       └───────────────────┘         └─────────────────┘         └──────────────────┘

   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  ┌────────────────┐
   │  country_rules   │  │ knowledge_chunks │  │notifications │  │   audit_logs   │
   │ (dual-approval)  │  │ (pgvector)       │  │              │  │ (append-only)  │
   └──────────────────┘  └──────────────────┘  └──────────────┘  └────────────────┘
```

---

## 5. Identity, Consent & Verification

### 5.1 `users`

The authoritative identity table. Holds role, PAN, verification timestamps, FY workspace pointer, the Section 115BAC lifetime counter, and the `city` field that powers CA directory search.

```sql
CREATE TABLE users (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                           VARCHAR(255) NOT NULL,
    password_hash                   VARCHAR(255) NOT NULL,           -- bcrypt cost 12
    name                            VARCHAR(255) NOT NULL,
    role                            user_role NOT NULL,
    country                         CHAR(2) NOT NULL DEFAULT 'IN',

    -- Tax identity
    pan                             VARCHAR(10),
    pan_verified_at                 TIMESTAMPTZ,

    -- Verification
    phone                           VARCHAR(20),
    email_verified_at               TIMESTAMPTZ,
    phone_verified_at               TIMESTAMPTZ,

    -- Tax-domain (Section 115BAC)
    has_business_income             BOOLEAN NOT NULL DEFAULT FALSE,
    lifetime_switch_backs_to_new    INT NOT NULL DEFAULT 0,
    active_tax_year                 VARCHAR(10),

    -- Geographic — used by CA directory + officer worklists
    jurisdiction                    VARCHAR(100),                    -- officer/judicial/enforcement
    city                            VARCHAR(100),                    -- everyone (powers CA directory by city)
    state                           VARCHAR(100),
    pincode                         VARCHAR(10),

    created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at                      TIMESTAMPTZ,

    CONSTRAINT chk_users_pan         CHECK (pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
    CONSTRAINT chk_users_phone       CHECK (phone IS NULL OR phone ~ '^\+?[6-9]\d{9}$'),
    CONSTRAINT chk_users_active_fy   CHECK (active_tax_year IS NULL OR active_tax_year ~ '^FY\d{4}-\d{2}$'),
    CONSTRAINT chk_users_switchbacks CHECK (lifetime_switch_backs_to_new BETWEEN 0 AND 1),
    CONSTRAINT chk_users_pincode     CHECK (pincode IS NULL OR pincode ~ '^\d{6}$'),
    CONSTRAINT chk_users_taxpayer_phone CHECK (role <> 'taxpayer' OR phone IS NOT NULL)
);

CREATE UNIQUE INDEX uq_users_email      ON users(email)        WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_users_pan        ON users(pan)          WHERE pan   IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_users_phone      ON users(phone)        WHERE phone IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX        idx_users_role      ON users(role)         WHERE deleted_at IS NULL;
CREATE INDEX        idx_users_city_role ON users(city, role)   WHERE deleted_at IS NULL;   -- CA directory by city
CREATE INDEX        idx_users_juris     ON users(jurisdiction) WHERE jurisdiction IS NOT NULL;
CREATE INDEX        idx_users_pan_trgm  ON users USING gin (pan  gin_trgm_ops) WHERE pan  IS NOT NULL;
CREATE INDEX        idx_users_name_trgm ON users USING gin (name gin_trgm_ops);
```

**Verification invariants:**

| Action | Required state |
|---|---|
| Register | Phone provided for taxpayer; both `signup_email` token + `signup_phone` OTP issued |
| Verify email | `email_verified_at` set on user |
| Verify phone | `phone_verified_at` set on user |
| Submit a filing | `email_verified_at IS NOT NULL` AND `phone_verified_at IS NOT NULL` AND a fresh `submit_phone` OTP consumed for that filing (enforced via `chk_tax_returns_submit_otp`) |

### 5.2 `user_consents`

Three-consent model. Current state per `(user, consent_type)`; history is in `audit_logs`.

```sql
CREATE TABLE user_consents (
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    consent_type   consent_type NOT NULL,
    granted        BOOLEAN NOT NULL,
    granted_at     TIMESTAMPTZ,
    revoked_at     TIMESTAMPTZ,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (user_id, consent_type),
    CONSTRAINT chk_consent_state CHECK (
        (granted = TRUE  AND granted_at IS NOT NULL AND revoked_at IS NULL) OR
        (granted = FALSE AND revoked_at IS NOT NULL)
    )
);
```

### 5.3 `user_verifications`

Email tokens **and** phone OTPs in a single table — both are time-bounded, single-use challenges. Storing them together keeps the issue/consume/expire logic uniform.

```sql
CREATE TABLE user_verifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel         verification_channel NOT NULL,           -- 'email' | 'phone'
    purpose         verification_purpose NOT NULL,

    -- Email: long URL-safe token, sha256-hashed.
    -- Phone: 6-digit numeric OTP, sha256-hashed with a per-user pepper.
    secret_hash     CHAR(64) NOT NULL,

    destination     VARCHAR(255) NOT NULL,                   -- email or phone the secret was sent to
    expires_at      TIMESTAMPTZ NOT NULL,
    consumed_at     TIMESTAMPTZ,
    attempts        INT NOT NULL DEFAULT 0,
    max_attempts    INT NOT NULL DEFAULT 5,

    -- Submit-time OTPs are bound to a specific filing they unlock.
    filing_id       UUID REFERENCES tax_returns(id),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_verif_phone_purpose CHECK (
        channel <> 'phone' OR purpose IN ('signup_phone', 'submit_phone', 'login_new_device')
    ),
    CONSTRAINT chk_verif_submit_has_filing CHECK (
        purpose <> 'submit_phone' OR filing_id IS NOT NULL
    ),
    CONSTRAINT chk_verif_expires_future CHECK (expires_at > created_at)
);

-- One outstanding (unconsumed, unexpired) challenge per (user, purpose).
CREATE UNIQUE INDEX uq_verif_outstanding
  ON user_verifications(user_id, purpose)
  WHERE consumed_at IS NULL AND expires_at > NOW();

CREATE INDEX idx_verif_user    ON user_verifications(user_id, created_at DESC);
CREATE INDEX idx_verif_filing  ON user_verifications(filing_id) WHERE filing_id IS NOT NULL;
CREATE INDEX idx_verif_expires ON user_verifications(expires_at);
```

### 5.4 `refresh_tokens`

```sql
CREATE TABLE refresh_tokens (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash    CHAR(64) NOT NULL UNIQUE,
    issued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ NOT NULL,
    revoked_at    TIMESTAMPTZ,
    user_agent    TEXT,
    ip_address    INET
);

CREATE INDEX idx_refresh_tokens_user_live
  ON refresh_tokens(user_id)
  WHERE revoked_at IS NULL;
```

### 5.5 `ca_profiles`

CA-specific profile and directory opt-in. Kept separate from `users` because these fields apply only to consultants and the directory list query benefits from a focused, smaller table.

```sql
CREATE TABLE ca_profiles (
    user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

    icai_membership      VARCHAR(50) NOT NULL,                 -- self-attested; no admin check in MVP
    bio                  TEXT,
    specializations      TEXT[],                                -- e.g. {'salaried', 'startup', 'capital_gains'}
    years_experience     INT,
    languages            TEXT[],                                -- e.g. {'en', 'hi', 'mr'}
    fee_range_indicator  VARCHAR(20),                           -- 'budget' | 'mid' | 'premium' (free-text disallowed)
    photo_url            TEXT,

    -- Directory controls
    listed_in_directory  BOOLEAN NOT NULL DEFAULT FALSE,        -- CA must opt in
    accepting_clients    BOOLEAN NOT NULL DEFAULT TRUE,
    serves_cities        TEXT[],                                -- additional cities (besides users.city) the CA serves

    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_ca_fee_range  CHECK (
        fee_range_indicator IS NULL OR fee_range_indicator IN ('budget','mid','premium')
    ),
    CONSTRAINT chk_ca_experience CHECK (years_experience IS NULL OR years_experience BETWEEN 0 AND 80)
);

-- Directory listing is the hot path; partial index keeps it tight.
CREATE INDEX idx_ca_profiles_listed
  ON ca_profiles(user_id)
  WHERE listed_in_directory = TRUE AND accepting_clients = TRUE;

CREATE INDEX idx_ca_profiles_serves_cities
  ON ca_profiles USING gin (serves_cities)
  WHERE listed_in_directory = TRUE;
```

**Directory eligibility rule:** A CA appears in `/consultants?city=X` only when **all** of these hold:

1. `users.role = 'consultant'`
2. `users.deleted_at IS NULL`
3. `ca_profiles.listed_in_directory = TRUE`
4. `ca_profiles.accepting_clients = TRUE`
5. `users.email_verified_at IS NOT NULL` AND `users.phone_verified_at IS NOT NULL`
6. `users.city = X` OR `X = ANY(ca_profiles.serves_cities)`

The taxpayer's home city (`users.city`) becomes the default search city; the taxpayer can switch cities or enter an invite code to engage a CA from elsewhere.

---

## 6. Financial Year Workspace

### 6.1 `tax_returns`

```sql
CREATE TABLE tax_returns (
    id                                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                             UUID NOT NULL REFERENCES users(id),
    country                             CHAR(2) NOT NULL DEFAULT 'IN',
    tax_year                            VARCHAR(10) NOT NULL,
    status                              filing_status NOT NULL DEFAULT 'draft',

    -- Regime (115BAC)
    regime_used                         regime,
    regime_switch_acknowledged          BOOLEAN NOT NULL DEFAULT FALSE,
    regime_switch_section_referenced    VARCHAR(50),
    regime_switch_acknowledged_at       TIMESTAMPTZ,
    regime_acknowledgment_text_hash     CHAR(64),
    form_10iea_required                 BOOLEAN NOT NULL DEFAULT FALSE,

    -- Templating
    templated_from_tax_year             VARCHAR(10),

    -- Cached summary (source of truth: calculation_traces)
    summary_json                        JSONB,
    old_regime_total_tax                NUMERIC(18,2),
    new_regime_total_tax                NUMERIC(18,2),
    recommended_regime                  regime,
    tds_paid                            NUMERIC(18,2),
    balance_payable                     NUMERIC(18,2),

    -- Officer review progression (L1 → L5)
    current_officer_level               VARCHAR(2),
    current_officer_id                  UUID REFERENCES users(id),
    last_escalated_at                   TIMESTAMPTZ,

    -- Submission
    submitted_at                        TIMESTAMPTZ,
    submitted_by_user_id                UUID REFERENCES users(id),
    submit_otp_verification_id          UUID REFERENCES user_verifications(id),
    accepted_at                         TIMESTAMPTZ,
    rejected_at                         TIMESTAMPTZ,
    review_notes                        TEXT,

    created_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at                          TIMESTAMPTZ,

    CONSTRAINT chk_tax_returns_fy          CHECK (tax_year ~ '^FY\d{4}-\d{2}$'),
    CONSTRAINT chk_tax_returns_template_fy CHECK (templated_from_tax_year IS NULL OR templated_from_tax_year ~ '^FY\d{4}-\d{2}$'),
    CONSTRAINT chk_tax_returns_officer_lvl CHECK (current_officer_level IS NULL OR current_officer_level IN ('L1','L2','L3','L4','L5')),
    -- A filing cannot be marked submitted without a recorded phone-OTP verification.
    CONSTRAINT chk_tax_returns_submit_otp  CHECK (
        submitted_at IS NULL OR submit_otp_verification_id IS NOT NULL
    )
);

CREATE UNIQUE INDEX uq_tax_returns_open
  ON tax_returns(user_id, tax_year, country)
  WHERE status NOT IN ('accepted', 'rejected') AND deleted_at IS NULL;

CREATE INDEX idx_tax_returns_user_fy   ON tax_returns(user_id, tax_year);
CREATE INDEX idx_tax_returns_status    ON tax_returns(status);
CREATE INDEX idx_tax_returns_submitted ON tax_returns(submitted_at) WHERE submitted_at IS NOT NULL;
CREATE INDEX idx_tax_returns_officer   ON tax_returns(current_officer_id) WHERE current_officer_id IS NOT NULL;
```

### 6.2 `calculation_traces`

```sql
CREATE TABLE calculation_traces (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filing_id           UUID NOT NULL REFERENCES tax_returns(id) ON DELETE CASCADE,
    regime              regime NOT NULL,
    trace_json          JSONB NOT NULL,
    final_total         NUMERIC(18,2) NOT NULL,
    rule_versions       JSONB NOT NULL,
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    computed_by_user_id UUID REFERENCES users(id)
);

CREATE INDEX idx_calc_traces_filing ON calculation_traces(filing_id, computed_at DESC);
```

---

## 7. Documents, Routing & Transactions

### 7.1 `documents`

```sql
CREATE TABLE documents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id),
    filing_id           UUID REFERENCES tax_returns(id),
    tax_year            VARCHAR(10),

    document_type       document_type NOT NULL,
    file_name           VARCHAR(512) NOT NULL,
    storage_path        TEXT NOT NULL,
    mime_type           VARCHAR(100) NOT NULL,
    size_bytes          BIGINT NOT NULL,
    sha256              CHAR(64) NOT NULL,
    status              document_status NOT NULL DEFAULT 'uploaded',

    routing_status      routing_status NOT NULL DEFAULT 'pending',
    routing_report      JSONB,
    routed_at           TIMESTAMPTZ,
    hint_tax_year       VARCHAR(10),

    extraction_started_at  TIMESTAMPTZ,
    extraction_finished_at TIMESTAMPTZ,
    extraction_error    TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,

    CONSTRAINT chk_documents_fy      CHECK (tax_year      IS NULL OR tax_year      ~ '^FY\d{4}-\d{2}$'),
    CONSTRAINT chk_documents_hint_fy CHECK (hint_tax_year IS NULL OR hint_tax_year ~ '^FY\d{4}-\d{2}$'),
    CONSTRAINT chk_documents_size    CHECK (size_bytes BETWEEN 1 AND 10485760),
    CONSTRAINT chk_documents_routed  CHECK ((routing_status = 'pending') OR (routed_at IS NOT NULL))
);

CREATE UNIQUE INDEX uq_documents_user_sha
  ON documents(user_id, sha256) WHERE deleted_at IS NULL;

CREATE INDEX idx_documents_filing  ON documents(filing_id) WHERE filing_id IS NOT NULL;
CREATE INDEX idx_documents_user_fy ON documents(user_id, tax_year);
CREATE INDEX idx_documents_status  ON documents(status);
CREATE INDEX idx_documents_routing ON documents(routing_status) WHERE routing_status <> 'routed';
```

### 7.2 `transactions`

```sql
CREATE TABLE transactions (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filing_id                UUID NOT NULL REFERENCES tax_returns(id) ON DELETE CASCADE,
    document_id              UUID REFERENCES documents(id),
    user_id                  UUID NOT NULL REFERENCES users(id),
    tax_year                 VARCHAR(10) NOT NULL,

    txn_date                 DATE NOT NULL,
    amount                   NUMERIC(18,2) NOT NULL,
    description              TEXT,
    counterparty             VARCHAR(255),
    raw_payload              JSONB,

    category                 VARCHAR(60),
    categorization_method    categorization_method NOT NULL DEFAULT 'rule',
    rule_matched             VARCHAR(100),
    confidence_score         NUMERIC(4,3),

    routing_method           router_method NOT NULL DEFAULT 'auto',
    routing_source_field     VARCHAR(50),
    routed_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    status                   transaction_status NOT NULL DEFAULT 'unverified',
    verified_by_user_id      UUID REFERENCES users(id),
    verified_at              TIMESTAMPTZ,

    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_txn_fy          CHECK (tax_year ~ '^FY\d{4}-\d{2}$'),
    CONSTRAINT chk_txn_confidence  CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1),
    CONSTRAINT chk_txn_method_rule CHECK ((categorization_method <> 'rule') OR (rule_matched IS NOT NULL))
);

CREATE INDEX idx_txn_filing        ON transactions(filing_id);
CREATE INDEX idx_txn_user_fy       ON transactions(user_id, tax_year);
CREATE INDEX idx_txn_filing_status ON transactions(filing_id, status);
CREATE INDEX idx_txn_document      ON transactions(document_id) WHERE document_id IS NOT NULL;
CREATE INDEX idx_txn_date          ON transactions(txn_date);
```

### 7.3 `pending_router_inbox`

```sql
CREATE TABLE pending_router_inbox (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id),
    document_id         UUID REFERENCES documents(id),

    raw_payload         JSONB NOT NULL,
    reason              router_inbox_reason NOT NULL,
    suggested_tax_year  VARCHAR(10),

    resolved            BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_tax_year   VARCHAR(10),
    resolved_at         TIMESTAMPTZ,
    resolved_by_user_id UUID REFERENCES users(id),
    resolution_action   VARCHAR(20),

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_inbox_suggested_fy CHECK (suggested_tax_year IS NULL OR suggested_tax_year ~ '^FY\d{4}-\d{2}$'),
    CONSTRAINT chk_inbox_resolved_fy  CHECK (resolved_tax_year  IS NULL OR resolved_tax_year  ~ '^FY\d{4}-\d{2}$'),
    CONSTRAINT chk_inbox_consistent   CHECK (
        (resolved = FALSE AND resolved_at IS NULL) OR
        (resolved = TRUE  AND resolved_at IS NOT NULL)
    )
);

CREATE INDEX idx_router_inbox_user_unresolved
  ON pending_router_inbox(user_id) WHERE resolved = FALSE;
```

---

## 8. Rules & Knowledge

### 8.1 `country_rules`

```sql
CREATE TABLE country_rules (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    country             CHAR(2) NOT NULL,
    tax_year            VARCHAR(10) NOT NULL,
    rule_type           VARCHAR(80) NOT NULL,
    version             INT NOT NULL DEFAULT 1,
    rule_json           JSONB NOT NULL,
    source_reference    TEXT NOT NULL,
    effective_from      DATE NOT NULL,
    effective_to        DATE,
    status              rule_status NOT NULL DEFAULT 'pending_approval',

    created_by_user_id   UUID NOT NULL REFERENCES users(id),
    approved_by_user_id  UUID REFERENCES users(id),
    approved_at          TIMESTAMPTZ,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_rules_fy              CHECK (tax_year ~ '^FY\d{4}-\d{2}$'),
    CONSTRAINT chk_rules_dual_approver   CHECK (
        approved_by_user_id IS NULL OR approved_by_user_id <> created_by_user_id
    ),
    CONSTRAINT chk_rules_active_approval CHECK (
        status <> 'active' OR (approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
    ),
    CONSTRAINT chk_rules_effective_range CHECK (
        effective_to IS NULL OR effective_to >= effective_from
    )
);

CREATE UNIQUE INDEX uq_rules_active
  ON country_rules(country, tax_year, rule_type)
  WHERE status = 'active';

CREATE INDEX idx_rules_lookup  ON country_rules(country, tax_year, rule_type, status);
CREATE INDEX idx_rules_pending ON country_rules(status) WHERE status = 'pending_approval';
```

### 8.2 `knowledge_chunks`

```sql
CREATE TABLE knowledge_chunks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_doc      VARCHAR(255) NOT NULL,
    section_ref     VARCHAR(100),
    country         CHAR(2) NOT NULL DEFAULT 'IN',
    chunk_text      TEXT NOT NULL,
    embedding       vector(1536) NOT NULL,
    token_count     INT,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ingest_run_id   UUID
);

CREATE INDEX idx_kc_embedding ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_kc_country   ON knowledge_chunks(country);
CREATE INDEX idx_kc_source    ON knowledge_chunks(source_doc);
```

### 8.3 `rag_query_log`

```sql
CREATE TABLE rag_query_log (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id),
    question_redacted TEXT NOT NULL,
    answer            TEXT,
    sources           JSONB,
    model_used        VARCHAR(60),
    tokens_used       INT,
    intercepted       BOOLEAN NOT NULL DEFAULT FALSE,
    intercept_reason  VARCHAR(40),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rag_log_user ON rag_query_log(user_id, created_at DESC);
```

---

## 9. Consultant Access — Directory + Invite Code

### 9.1 Two Grant Origins

A grant on `consultant_access_grants` is created via one of two paths. They produce the same downstream entity (a row in `consultant_access_grants`) but differ in initial state.

#### Path A — Directory Request *(in-city CAs, default)*

```
Taxpayer                               System                              CA
   │                                     │                                  │
   │ Browse CAs in my city               │                                  │
   │ GET /consultants?city=Mumbai────▶  │                                  │
   │                                     │ Filter: ca_profiles where        │
   │                                     │ listed_in_directory = TRUE       │
   │                                     │ AND city match                   │
   │ ◀──────list of CA cards─────────────│                                  │
   │                                     │                                  │
   │ Pick CA + choose mode + FYs         │                                  │
   │ POST /consultant-access/grants     │                                  │
   │ { consultant_id, access_mode,      │                                  │
   │   tax_years, message }              │                                  │
   │ ──────────────────────────────────▶│                                  │
   │                                     │ Insert grant (status=pending,    │
   │                                     │ origin=directory_request)        │
   │                                     │ Notify CA: consultant_access_    │
   │                                     │ request  ────────────────────▶  │
   │                                     │                                  │
   │                                     │           CA reviews             │
   │                                     │                                  │
   │                                     │ ◀──── POST .../{id}/respond  ────│
   │                                     │       { action: accept|decline } │
   │                                     │ Update status → active|rejected  │
   │ ◀── Notify: accepted/declined ──────│                                  │
```

**Use when:** taxpayer wants to find a CA in their own city. The CA can decline.

#### Path B — Invite Code *(out-of-city CAs or pre-arranged relationships)*

```
CA                                     System                          Taxpayer
 │                                       │                                  │
 │ Generate invite code                  │                                  │
 │ POST /consultant/invite-codes ──────▶│                                  │
 │ ◀── { code: "CA-7K3PQX" }─────────────│                                  │
 │                                       │                                  │
 │ Share code out-of-band                │                                  │
 │ (WhatsApp / email / in person) ─────────────────────────────────────▶  │
 │                                       │                                  │
 │                                       │ ◀── POST /consultant-access/────│
 │                                       │     grants/redeem-code           │
 │                                       │     { invite_code,               │
 │                                       │       access_mode, tax_years }   │
 │                                       │ Insert grant (status=active,     │
 │                                       │ origin=invite_code)              │
 │ ◀── Notify CA: consultant_invite_     │                                  │
 │     code_used (with taxpayer details  │                                  │
 │     + shared documents)               │                                  │
```

**Use when:** the CA is from outside the taxpayer's city, or the relationship is pre-arranged. Both sides have already shown intent (CA issued the code, taxpayer redeemed it), so the grant is immediately `active`.

### 9.2 `consultant_invite_codes`

```sql
CREATE TABLE consultant_invite_codes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultant_id   UUID NOT NULL REFERENCES users(id),

    -- Human-shareable code, e.g. "CA-7K3PQX". Always uppercase alphanumeric with a "CA-" prefix.
    code            VARCHAR(20) NOT NULL,
    code_hash       CHAR(64) NOT NULL,                       -- sha256 hex; lookup uses hash
    label           VARCHAR(255),                            -- CA's note ("ABC Pvt Ltd group", etc.)

    max_uses        INT NOT NULL DEFAULT 1,
    used_count      INT NOT NULL DEFAULT 0,
    status          invite_code_status NOT NULL DEFAULT 'active',

    -- Default policy embedded in the code (taxpayer can choose ≤, never >).
    default_access_mode  consultant_access_mode,
    allowed_tax_years    TEXT[],                              -- NULL = any FY taxpayer picks

    expires_at      TIMESTAMPTZ NOT NULL,                     -- typically issued_at + 14 days
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_invite_code_format CHECK (code ~ '^CA-[A-Z0-9]{6,14}$'),
    CONSTRAINT chk_invite_max_uses    CHECK (max_uses >= 1 AND used_count <= max_uses),
    CONSTRAINT chk_invite_tax_years   CHECK (
        allowed_tax_years IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest(allowed_tax_years) AS ty WHERE ty !~ '^FY\d{4}-\d{2}$'
        )
    )
);

CREATE UNIQUE INDEX uq_invite_code_hash ON consultant_invite_codes(code_hash);

CREATE INDEX idx_invite_consultant_active
  ON consultant_invite_codes(consultant_id) WHERE status = 'active';

CREATE INDEX idx_invite_expires ON consultant_invite_codes(expires_at);
```

### 9.3 `consultant_access_grants`

```sql
CREATE TABLE consultant_access_grants (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultant_id       UUID NOT NULL REFERENCES users(id),
    target_user_id      UUID NOT NULL REFERENCES users(id),

    origin              grant_origin NOT NULL,                 -- 'directory_request' | 'invite_code'
    invite_code_id      UUID REFERENCES consultant_invite_codes(id),   -- NULL for directory_request

    access_mode         consultant_access_mode NOT NULL,
    status              consultant_grant_status NOT NULL,
    -- Initial value: 'pending' for directory_request, 'active' for invite_code.

    tax_years           TEXT[] NOT NULL,
    message             TEXT,

    requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),    -- when taxpayer initiated
    decided_at          TIMESTAMPTZ,                           -- when CA accepted/declined (directory) or auto-activated (invite)
    revoked_at          TIMESTAMPTZ,
    expires_at          TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_cag_distinct  CHECK (consultant_id <> target_user_id),
    CONSTRAINT chk_cag_tax_years CHECK (
        cardinality(tax_years) >= 1 AND
        NOT EXISTS (
            SELECT 1 FROM unnest(tax_years) AS ty WHERE ty !~ '^FY\d{4}-\d{2}$'
        )
    ),
    -- Invite-code origin must reference an invite code; directory origin must not.
    CONSTRAINT chk_cag_origin_invite CHECK (
        (origin = 'invite_code'        AND invite_code_id IS NOT NULL) OR
        (origin = 'directory_request'  AND invite_code_id IS NULL)
    ),
    -- pending status is only valid for directory_request.
    CONSTRAINT chk_cag_pending_origin CHECK (
        status <> 'pending' OR origin = 'directory_request'
    )
);

-- Only one live grant per (consultant, taxpayer) — covers both pending and active.
CREATE UNIQUE INDEX uq_cag_live
  ON consultant_access_grants(consultant_id, target_user_id)
  WHERE status IN ('pending', 'active');

CREATE INDEX idx_cag_consultant_status ON consultant_access_grants(consultant_id, status);
CREATE INDEX idx_cag_taxpayer_status   ON consultant_access_grants(target_user_id, status);
CREATE INDEX idx_cag_invite_code       ON consultant_access_grants(invite_code_id) WHERE invite_code_id IS NOT NULL;
CREATE INDEX idx_cag_tax_years_gin     ON consultant_access_grants USING gin (tax_years);
```

**Transition table:**

| Origin | Initial status | CA accepts | CA declines | Taxpayer revokes | TTL hit |
|---|---|---|---|---|---|
| `directory_request` | `pending` | → `active` | → `rejected` | → `revoked` | → `expired` |
| `invite_code` | `active` (immediate) | n/a | n/a | → `revoked` | → `expired` |

**Notifications emitted:**

| Grant event | Notification (recipient) |
|---|---|
| Directory request created | `consultant_access_request` → CA |
| CA accepts | `consultant_access_request_accepted` → taxpayer |
| CA declines | `consultant_access_request_declined` → taxpayer |
| Invite code redeemed | `consultant_invite_code_used` → CA |
| Taxpayer revokes | `consultant_access_revoked` → CA |

The payload of `consultant_invite_code_used` (and `consultant_access_request`) carries the taxpayer's PAN, name, email, phone, city, the shared-documents list, and the `client_detail_url` deep link — exactly per [API_CONTRACTS.md §12.5](API_CONTRACTS.md#125-notification-payloads-by-type).

### 9.4 `filing_change_sets`

```sql
CREATE TABLE filing_change_sets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filing_id           UUID NOT NULL REFERENCES tax_returns(id) ON DELETE CASCADE,
    grant_id            UUID NOT NULL REFERENCES consultant_access_grants(id),
    consultant_id       UUID NOT NULL REFERENCES users(id),

    notes               TEXT,
    changes             JSONB NOT NULL,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at         TIMESTAMPTZ,
    rejected_at         TIMESTAMPTZ,
    decided_by_user_id  UUID REFERENCES users(id)
);

CREATE INDEX idx_change_sets_filing ON filing_change_sets(filing_id, created_at DESC);
```

---

## 10. Fraud → Judicial → Enforcement

> [!IMPORTANT]
> **Fraud silence rule.** Transitions on `fraud_cases` never generate `notifications` rows addressed to the taxpayer. The `notification_type` enum ([§3](#3-enumerations)) deliberately does *not* contain any fraud-lifecycle types for taxpayers — the strongest enforcement of this rule short of a runtime check.

### 10.1 `fraud_cases`

```sql
CREATE TABLE fraud_cases (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filing_id                   UUID NOT NULL REFERENCES tax_returns(id),
    taxpayer_id                 UUID NOT NULL REFERENCES users(id),
    tax_year                    VARCHAR(10) NOT NULL,
    jurisdiction                VARCHAR(100),

    flagged_by                  UUID NOT NULL REFERENCES users(id),
    flag_reason                 fraud_flag_reason NOT NULL,
    flag_notes                  TEXT,
    flagged_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    status                      fraud_case_status NOT NULL DEFAULT 'flagged',

    judicial_officer_id         UUID REFERENCES users(id),
    judicial_assigned_at        TIMESTAMPTZ,
    judicial_decision           judicial_decision,
    judicial_notes              TEXT,
    judicial_reviewed_at        TIMESTAMPTZ,

    enforcement_agency_id       UUID REFERENCES users(id),
    enforcement_assigned_at     TIMESTAMPTZ,
    enforcement_outcome         enforcement_outcome,
    enforcement_notes           TEXT,
    closed_at                   TIMESTAMPTZ,

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_fc_fy                     CHECK (tax_year ~ '^FY\d{4}-\d{2}$'),
    CONSTRAINT chk_fc_judicial_consistent    CHECK (status = 'flagged' OR judicial_officer_id IS NOT NULL),
    CONSTRAINT chk_fc_enforcement_consistent CHECK (status <> 'enforcement_assigned' OR enforcement_agency_id IS NOT NULL),
    CONSTRAINT chk_fc_closed_consistent      CHECK (status <> 'closed' OR closed_at IS NOT NULL)
);

CREATE UNIQUE INDEX uq_fraud_cases_open
  ON fraud_cases(filing_id) WHERE status <> 'closed';

CREATE INDEX idx_fc_status       ON fraud_cases(status);
CREATE INDEX idx_fc_taxpayer     ON fraud_cases(taxpayer_id);
CREATE INDEX idx_fc_jurisdiction ON fraud_cases(jurisdiction);
CREATE INDEX idx_fc_judicial     ON fraud_cases(judicial_officer_id)   WHERE judicial_officer_id   IS NOT NULL;
CREATE INDEX idx_fc_enforcement  ON fraud_cases(enforcement_agency_id) WHERE enforcement_agency_id IS NOT NULL;
CREATE INDEX idx_fc_fy           ON fraud_cases(tax_year);
```

### 10.2 `enforcement_access`

```sql
CREATE TABLE enforcement_access (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_user_id      UUID NOT NULL REFERENCES users(id),
    granted_to          UUID NOT NULL REFERENCES users(id),
    granted_by          UUID NOT NULL REFERENCES users(id),
    fraud_case_id       UUID REFERENCES fraud_cases(id),
    access_type         VARCHAR(20) NOT NULL DEFAULT 'read_only',

    reason              TEXT NOT NULL,
    case_reference      VARCHAR(100),
    tax_years           TEXT[],

    granted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ NOT NULL,
    revoked_at          TIMESTAMPTZ,

    CONSTRAINT chk_ea_tax_years CHECK (
        tax_years IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest(tax_years) AS ty WHERE ty !~ '^FY\d{4}-\d{2}$'
        )
    ),
    CONSTRAINT chk_ea_distinct      CHECK (target_user_id <> granted_to),
    CONSTRAINT chk_ea_expires_after CHECK (expires_at > granted_at)
);

CREATE INDEX idx_ea_granted_to_live ON enforcement_access(granted_to) WHERE revoked_at IS NULL;
CREATE INDEX idx_ea_target          ON enforcement_access(target_user_id);
CREATE INDEX idx_ea_case            ON enforcement_access(fraud_case_id) WHERE fraud_case_id IS NOT NULL;
CREATE INDEX idx_ea_expires         ON enforcement_access(expires_at);
```

---

## 11. Cross-Cutting

### 11.1 `notifications`

```sql
CREATE TABLE notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        notification_type NOT NULL,
    title       VARCHAR(255) NOT NULL,
    body        TEXT,
    payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_unread
  ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_user_all ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_type     ON notifications(type);
```

### 11.2 `audit_logs`

Append-only.

```sql
CREATE TABLE audit_logs (
    id              BIGSERIAL PRIMARY KEY,
    actor_user_id   UUID REFERENCES users(id),
    actor_role      user_role,
    action          VARCHAR(80) NOT NULL,
    entity_type     VARCHAR(60),
    entity_id       UUID,
    fraud_case_id   UUID REFERENCES fraud_cases(id),
    tax_year        VARCHAR(10),

    before_state    JSONB,
    after_state     JSONB,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,

    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_audit_fy CHECK (tax_year IS NULL OR tax_year ~ '^FY\d{4}-\d{2}$')
);

CREATE INDEX idx_audit_actor       ON audit_logs(actor_user_id, occurred_at DESC);
CREATE INDEX idx_audit_entity      ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_action      ON audit_logs(action);
CREATE INDEX idx_audit_fraud_case  ON audit_logs(fraud_case_id) WHERE fraud_case_id IS NOT NULL;
CREATE INDEX idx_audit_occurred_at ON audit_logs(occurred_at DESC);

CREATE OR REPLACE FUNCTION audit_logs_block_mutations() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutations();
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutations();
```

**Canonical actions** (non-exhaustive):

| Action | Emitter |
|---|---|
| `user_registered`, `user_login`, `user_password_changed` | Auth |
| `email_verified`, `phone_verified` | Auth |
| `submit_otp_issued`, `submit_otp_consumed`, `submit_otp_failed` | Auth / Taxation |
| `consent_granted`, `consent_revoked` | Compliance |
| `document_uploaded`, `document_deleted`, `document_rerouted` | Documents |
| `routing_completed`, `routing_override` | FY Router |
| `transaction_categorized`, `transaction_verified`, `transaction_fy_moved` | AI/OCR, Taxation |
| `filing_created`, `filing_calculated`, `filing_submitted`, `filing_accepted`, `filing_rejected` | Taxation |
| `filing_officer_assigned`, `filing_escalated` | Taxation/Officer |
| `regime_switch_acknowledged` | Taxation |
| `rule_created`, `rule_approved`, `rule_superseded` | Rules |
| `rag_query`, `rag_intercepted` | RAG |
| `ca_listed_in_directory`, `ca_unlisted` | CA self-service |
| `cag_directory_requested`, `cag_directory_accepted`, `cag_directory_declined` | Consultant Access |
| `invite_code_created`, `invite_code_redeemed`, `invite_code_revoked` | Consultant Access |
| `cag_revoked` | Consultant Access |
| `fraud_case_*` | Fraud |
| `enforcement_access_*` | Fraud / Admin |

---

## 12. Invariants & Triggers

| # | Invariant | Mechanism |
|---|---|---|
| 1 | At most one open filing per `(user, tax_year, country)` | `uq_tax_returns_open` |
| 2 | Lifetime switch-back to new regime ≤ 1 | `chk_users_switchbacks` |
| 3 | Rule activation requires a *different* approver than the creator | `chk_rules_dual_approver` |
| 4 | Only one `active` rule per `(country, tax_year, rule_type)` | `uq_rules_active` |
| 5 | CA grant requires ≥ 1 tax_year, all FY-formatted | `chk_cag_tax_years` |
| 6 | Only one live CA grant per `(consultant, taxpayer)` | `uq_cag_live` |
| 7 | `invite_code` grants must reference an invite code; `directory_request` grants must not | `chk_cag_origin_invite` |
| 8 | `pending` status is only valid for `directory_request` grants | `chk_cag_pending_origin` |
| 9 | Invite-code format and use-count consistency | `chk_invite_code_format`, `chk_invite_max_uses` |
| 10 | One open fraud case per filing | `uq_fraud_cases_open` |
| 11 | Enforcement access expires strictly after granted | `chk_ea_expires_after` |
| 12 | `audit_logs` cannot be updated or deleted | `trg_audit_no_update` / `trg_audit_no_delete` |
| 13 | Document size ≤ 10 MB | `chk_documents_size` |
| 14 | All FY fields conform to `FY\d{4}-\d{2}` | `chk_*_fy` everywhere |
| 15 | PAN format | `chk_users_pan` |
| 16 | Phone format | `chk_users_phone` |
| 17 | Taxpayer must have a phone on file | `chk_users_taxpayer_phone` |
| 18 | Filing cannot be submitted without a recorded OTP | `chk_tax_returns_submit_otp` |
| 19 | Only one outstanding verification challenge per `(user, purpose)` | `uq_verif_outstanding` |
| 20 | Submit-time OTP must reference the filing it unlocks | `chk_verif_submit_has_filing` |
| 21 | Taxpayers never receive fraud-lifecycle notifications | `notification_type` enum omits such types |
| 22 | Routed documents must have a `routed_at` | `chk_documents_routed` |
| 23 | Rule-based categorization must record matched rule id | `chk_txn_method_rule` |
| 24 | CA must opt in to appear in directory | `idx_ca_profiles_listed` partial; service-layer filter |
| 25 | CA fee range is bounded to allowed values | `chk_ca_fee_range` |

### Shared `updated_at` trigger

```sql
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_touch_users         BEFORE UPDATE ON users         FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_user_consents BEFORE UPDATE ON user_consents FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_ca_profiles   BEFORE UPDATE ON ca_profiles   FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_tax_returns   BEFORE UPDATE ON tax_returns   FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_documents     BEFORE UPDATE ON documents     FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_transactions  BEFORE UPDATE ON transactions  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_country_rules BEFORE UPDATE ON country_rules FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_fraud_cases   BEFORE UPDATE ON fraud_cases   FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
```

---

## 13. Row-Level Access Patterns

### 13.1 Taxpayer self-scope

```sql
SELECT * FROM tax_returns
WHERE user_id = :session_user
  AND (:tax_year IS NULL OR tax_year = :tax_year)
  AND deleted_at IS NULL;
```

### 13.2 CA directory by city

```sql
-- Public listing — taxpayer browsing CAs.
SELECT
    u.id,
    u.name,
    u.city,
    p.icai_membership,
    p.bio,
    p.specializations,
    p.years_experience,
    p.languages,
    p.fee_range_indicator,
    p.photo_url
FROM users u
JOIN ca_profiles p ON p.user_id = u.id
WHERE u.role = 'consultant'
  AND u.deleted_at IS NULL
  AND u.email_verified_at IS NOT NULL
  AND u.phone_verified_at IS NOT NULL
  AND p.listed_in_directory = TRUE
  AND p.accepting_clients   = TRUE
  AND (
        u.city = :city
     OR :city = ANY (p.serves_cities)
  )
ORDER BY p.years_experience DESC NULLS LAST
LIMIT :limit OFFSET :offset;
```

### 13.3 Directory grant request

```sql
-- POST /consultant-access/grants  { consultant_id, access_mode, tax_years, message }
INSERT INTO consultant_access_grants
    (consultant_id, target_user_id, origin, access_mode, status, tax_years, message, expires_at)
VALUES
    (:consultant_id, :session_user, 'directory_request', :access_mode, 'pending',
     :tax_years, :message, NOW() + INTERVAL '14 days')
RETURNING *;
-- Then notify CA: consultant_access_request
```

### 13.4 Invite-code redemption

```sql
-- POST /consultant-access/grants/redeem-code { invite_code, access_mode, tax_years }
WITH valid AS (
    SELECT *
    FROM consultant_invite_codes
    WHERE code_hash = :sha256_of_entered_code
      AND status     = 'active'
      AND expires_at > NOW()
      AND used_count < max_uses
    FOR UPDATE
)
INSERT INTO consultant_access_grants
    (consultant_id, target_user_id, origin, invite_code_id, access_mode, status, tax_years, expires_at)
SELECT
    v.consultant_id, :session_user, 'invite_code', v.id, :access_mode, 'active',
    :tax_years, NOW() + INTERVAL '14 days'
FROM valid v
RETURNING *;

UPDATE consultant_invite_codes
SET used_count = used_count + 1,
    status     = CASE WHEN used_count + 1 >= max_uses THEN 'exhausted' ELSE 'active' END
WHERE code_hash = :sha256_of_entered_code;
-- Then notify CA: consultant_invite_code_used
```

### 13.5 Consultant FY guard

```sql
SELECT 1
FROM consultant_access_grants
WHERE consultant_id  = :session_user
  AND target_user_id = :taxpayer_id
  AND status         = 'active'
  AND :tax_year      = ANY (tax_years);
-- 0 rows → 403 fy_not_in_grant
```

### 13.6 Consultant PAN search (scoped to active grants)

```sql
SELECT u.*
FROM users u
JOIN consultant_access_grants g
  ON g.target_user_id = u.id
WHERE g.consultant_id = :session_user
  AND g.status        = 'active'
  AND u.pan ILIKE :pan_search
  AND u.deleted_at IS NULL;
```

### 13.7 Enforcement scope

```sql
SELECT 1
FROM enforcement_access
WHERE granted_to     = :session_user
  AND target_user_id = :taxpayer_id
  AND revoked_at IS NULL
  AND expires_at > NOW()
  AND (tax_years IS NULL OR :tax_year = ANY (tax_years));
```

### 13.8 Submit-OTP verification

```sql
SELECT 1
FROM user_verifications
WHERE user_id     = :session_user
  AND purpose     = 'submit_phone'
  AND filing_id   = :filing_id
  AND consumed_at IS NULL
  AND expires_at > NOW()
  AND secret_hash = :sha256_of_submitted_otp
  AND attempts < max_attempts;
```

---

## 14. Migration Order

1. Extensions (§2)
2. Enums (§3)
3. `users`
4. `user_consents`, `refresh_tokens`
5. `tax_returns` *(create without `submit_otp_verification_id` FK first)*
6. `user_verifications` *(references `tax_returns.id` via `filing_id`)*
7. Add FK `tax_returns.submit_otp_verification_id → user_verifications.id` *(cycle-breaking migration)*
8. `ca_profiles`
9. `calculation_traces`
10. `documents`
11. `transactions`
12. `pending_router_inbox`
13. `country_rules`
14. `knowledge_chunks`, `rag_query_log`
15. `consultant_invite_codes`
16. `consultant_access_grants`
17. `filing_change_sets`
18. `fraud_cases`
19. `enforcement_access`
20. `notifications`
21. `audit_logs` (last — references many upstream tables)
22. Triggers: `touch_updated_at`, `audit_logs_block_mutations`

---

## 15. Seed Data

| Table | What to seed |
|---|---|
| `users` | Two admins (for dual approval), then one user per demo role: `asha@` (city=Mumbai), `rajesh@` (business income, Mumbai), `ca.sharma@` (Mumbai), `ca.iyer@` (Bengaluru — for invite-code demo), `officer.kumar@` (L3), `judicial.rao@`, `enforce.singh@`, `admin@`. All demo users pre-verified. |
| `user_consents` | All three consents granted for demo taxpayers. |
| `ca_profiles` | Both demo CAs: `listed_in_directory=TRUE`, `accepting_clients=TRUE`. `ca.sharma@` serves Mumbai; `ca.iyer@` serves Bengaluru only (forces invite-code path for Asha to engage them). |
| `country_rules` | India FY2023-24 + FY2024-25 — slabs (old & new regime), Section 80C, 80D, surcharge, cess, 115BAC. Dual-approved. |
| `knowledge_chunks` | Top-20 IT Act sections ingested via `python -m app.rag.ingest`. |
| `consultant_invite_codes` | `CA-DEMO01` for `ca.iyer@` — used to demo the invite-code path from Asha's account. |
| `tax_returns` | Rajesh's FY2023-24 in `accepted` status with `regime_used='old'` — required for the WARN_HIGH 115BAC demo. |

---

## 16. Change Log

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-05-13 | Initial schema. Includes: mobile + email verification (`user_verifications` table; submit-time OTP gate on `tax_returns`); hybrid CA selection — city-based directory via `ca_profiles` plus invite-code redemption via `consultant_invite_codes`; self-attested CA ICAI membership; fraud-silence rule baked into the `notification_type` enum; L1 → L5 officer review progression on `tax_returns`. |

---

> Living document. Every schema change must ship with a migration, a corresponding update to [API_CONTRACTS.md](API_CONTRACTS.md) / [ARCHITECTURE.md](ARCHITECTURE.md), and an entry in [§12](#12-invariants--triggers) if it introduces a new invariant.
