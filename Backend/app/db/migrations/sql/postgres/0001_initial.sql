-- =====================================================================
-- 0001_initial.sql  (PostgreSQL / Supabase)
--
-- Full-fidelity translation of Technical Docs/SCHEMA.md v1.0 (2026-05-13).
-- Unlike the SQLite variant, this preserves every Postgres-specific feature:
-- pgvector, pg_trgm, native enums, JSONB, arrays, partial + GIN indexes,
-- BIGSERIAL, regex CHECKs, append-only audit triggers, and updated_at triggers.
--
-- This file is intended to be applied to a Supabase project (or any Postgres 15+
-- instance with pgvector available).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 2. Required extensions
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------
-- 3. Enumerations
-- ---------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM (
        'taxpayer','consultant',
        'officer_l1','officer_l2','officer_l3','officer_l4','officer_l5',
        'judicial_officer','enforcement_agency','admin'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE consent_type AS ENUM ('document_processing','ai_analysis','data_retention');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE verification_channel AS ENUM ('email','phone');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE verification_purpose AS ENUM (
        'signup_email','signup_phone','submit_phone','password_reset','login_new_device'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE filing_status AS ENUM (
        'draft','in_review_by_ca','revision_returned','revision_requested',
        'submitted','accepted','rejected'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE regime AS ENUM ('old','new');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE document_type AS ENUM ('form16','bank_csv','ais_tis','form_26as','salary_slip');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE document_status AS ENUM ('uploaded','processing','completed','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE routing_status AS ENUM ('pending','routed','partially_routed','unresolved','overridden');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE router_method AS ENUM ('auto','manual_override');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE router_inbox_reason AS ENUM (
        'invalid_date','terminal_fy_conflict','ambiguous_fy','routing_review_required'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE categorization_method AS ENUM ('rule','ai_assisted','manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE transaction_status AS ENUM ('unverified','verified','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE consultant_access_mode AS ENUM ('full_access','review_edit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE grant_origin AS ENUM ('directory_request','invite_code');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE consultant_grant_status AS ENUM ('pending','active','rejected','revoked','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE invite_code_status AS ENUM ('active','exhausted','revoked','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE fraud_case_status AS ENUM ('flagged','judicial_review','enforcement_assigned','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE fraud_flag_reason AS ENUM (
        'income_mismatch','undisclosed_income','fabricated_deduction','other'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE judicial_decision AS ENUM ('dismiss','assigned_to_enforcement');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE enforcement_outcome AS ENUM (
        'tax_liability_confirmed','no_fraud_found','partial_findings','escalated_externally'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE rule_status AS ENUM ('pending_approval','active','superseded','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE notification_type AS ENUM (
        'account_email_verified','account_phone_verified','account_password_changed',
        'account_login_new_device','account_pan_verified','account_consent_changed',
        'filing_draft_created','new_tax_year_available','filing_submitted_ack',
        'filing_review_complete','regime_warning',
        'filing_under_officer_review','filing_escalated_to_l2','filing_escalated_to_l3',
        'filing_escalated_to_l4','filing_escalated_to_l5','filing_revision_requested',
        'filing_mismatch_detected',
        'consultant_access_request_accepted','consultant_access_request_declined',
        'consultant_returned_filing','consultant_submitted_filing',
        'consultant_access_request','consultant_invite_code_used','consultant_access_revoked',
        'consultant_client_filing_updated','consultant_rule_change_impact',
        'officer_filing_assigned','officer_sla_breach_warning','officer_case_escalated_in',
        'fraud_case_assigned','fraud_case_renewal_requested',
        'enforcement_access_granted','enforcement_access_expiring_soon','enforcement_access_expired',
        'admin_rule_pending_second_approval','admin_system_health_alert'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- 5. Identity, Consent & Verification
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                           VARCHAR(255) NOT NULL,
    password_hash                   VARCHAR(255) NOT NULL,
    name                            VARCHAR(255) NOT NULL,
    role                            user_role NOT NULL,
    country                         CHAR(2) NOT NULL DEFAULT 'IN',

    pan                             VARCHAR(10),
    pan_verified_at                 TIMESTAMPTZ,

    phone                           VARCHAR(20),
    email_verified_at               TIMESTAMPTZ,
    phone_verified_at               TIMESTAMPTZ,

    has_business_income             BOOLEAN NOT NULL DEFAULT FALSE,
    lifetime_switch_backs_to_new    INT NOT NULL DEFAULT 0,
    active_tax_year                 VARCHAR(10),

    jurisdiction                    VARCHAR(100),
    city                            VARCHAR(100),
    state                           VARCHAR(100),
    pincode                         VARCHAR(10),

    created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at                      TIMESTAMPTZ,

    CONSTRAINT chk_users_pan          CHECK (pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
    CONSTRAINT chk_users_phone        CHECK (phone IS NULL OR phone ~ '^\+?[6-9]\d{9}$'),
    CONSTRAINT chk_users_active_fy    CHECK (active_tax_year IS NULL OR active_tax_year ~ '^FY\d{4}-\d{2}$'),
    CONSTRAINT chk_users_switchbacks  CHECK (lifetime_switch_backs_to_new BETWEEN 0 AND 1),
    CONSTRAINT chk_users_pincode      CHECK (pincode IS NULL OR pincode ~ '^\d{6}$'),
    CONSTRAINT chk_users_taxpayer_phone CHECK (role <> 'taxpayer' OR phone IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email      ON users(email)        WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_pan        ON users(pan)          WHERE pan   IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone      ON users(phone)        WHERE phone IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX        IF NOT EXISTS idx_users_role      ON users(role)         WHERE deleted_at IS NULL;
CREATE INDEX        IF NOT EXISTS idx_users_city_role ON users(city, role)   WHERE deleted_at IS NULL;
CREATE INDEX        IF NOT EXISTS idx_users_juris     ON users(jurisdiction) WHERE jurisdiction IS NOT NULL;
CREATE INDEX        IF NOT EXISTS idx_users_pan_trgm  ON users USING gin (pan  gin_trgm_ops) WHERE pan  IS NOT NULL;
CREATE INDEX        IF NOT EXISTS idx_users_name_trgm ON users USING gin (name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS user_consents (
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

-- tax_returns first declared without the OTP FK; we add it after user_verifications exists.
CREATE TABLE IF NOT EXISTS tax_returns (
    id                                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                             UUID NOT NULL REFERENCES users(id),
    country                             CHAR(2) NOT NULL DEFAULT 'IN',
    tax_year                            VARCHAR(10) NOT NULL,
    status                              filing_status NOT NULL DEFAULT 'draft',

    regime_used                         regime,
    regime_switch_acknowledged          BOOLEAN NOT NULL DEFAULT FALSE,
    regime_switch_section_referenced    VARCHAR(50),
    regime_switch_acknowledged_at       TIMESTAMPTZ,
    regime_acknowledgment_text_hash     CHAR(64),
    form_10iea_required                 BOOLEAN NOT NULL DEFAULT FALSE,

    templated_from_tax_year             VARCHAR(10),

    summary_json                        JSONB,
    old_regime_total_tax                NUMERIC(18,2),
    new_regime_total_tax                NUMERIC(18,2),
    recommended_regime                  regime,
    tds_paid                            NUMERIC(18,2),
    balance_payable                     NUMERIC(18,2),

    current_officer_level               VARCHAR(2),
    current_officer_id                  UUID REFERENCES users(id),
    last_escalated_at                   TIMESTAMPTZ,

    submitted_at                        TIMESTAMPTZ,
    submitted_by_user_id                UUID REFERENCES users(id),
    submit_otp_verification_id          UUID,
    accepted_at                         TIMESTAMPTZ,
    rejected_at                         TIMESTAMPTZ,
    review_notes                        TEXT,

    created_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at                          TIMESTAMPTZ,

    CONSTRAINT chk_tax_returns_fy          CHECK (tax_year ~ '^FY\d{4}-\d{2}$'),
    CONSTRAINT chk_tax_returns_template_fy CHECK (templated_from_tax_year IS NULL OR templated_from_tax_year ~ '^FY\d{4}-\d{2}$'),
    CONSTRAINT chk_tax_returns_officer_lvl CHECK (current_officer_level IS NULL OR current_officer_level IN ('L1','L2','L3','L4','L5')),
    CONSTRAINT chk_tax_returns_submit_otp  CHECK (
        submitted_at IS NULL OR submit_otp_verification_id IS NOT NULL
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_returns_open
  ON tax_returns(user_id, tax_year, country)
  WHERE status NOT IN ('accepted', 'rejected') AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tax_returns_user_fy   ON tax_returns(user_id, tax_year);
CREATE INDEX IF NOT EXISTS idx_tax_returns_status    ON tax_returns(status);
CREATE INDEX IF NOT EXISTS idx_tax_returns_submitted ON tax_returns(submitted_at) WHERE submitted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tax_returns_officer   ON tax_returns(current_officer_id) WHERE current_officer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_verifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel         verification_channel NOT NULL,
    purpose         verification_purpose NOT NULL,
    secret_hash     CHAR(64) NOT NULL,
    destination     VARCHAR(255) NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    consumed_at     TIMESTAMPTZ,
    attempts        INT NOT NULL DEFAULT 0,
    max_attempts    INT NOT NULL DEFAULT 5,
    filing_id       UUID REFERENCES tax_returns(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_verif_phone_purpose CHECK (
        channel <> 'phone' OR purpose IN ('signup_phone','submit_phone','login_new_device')
    ),
    CONSTRAINT chk_verif_submit_has_filing CHECK (
        purpose <> 'submit_phone' OR filing_id IS NOT NULL
    ),
    CONSTRAINT chk_verif_expires_future CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_verif_outstanding
  ON user_verifications(user_id, purpose)
  WHERE consumed_at IS NULL AND expires_at > NOW();

CREATE INDEX IF NOT EXISTS idx_verif_user    ON user_verifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_verif_filing  ON user_verifications(filing_id) WHERE filing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_verif_expires ON user_verifications(expires_at);

-- Cycle-breaking FK: tax_returns.submit_otp_verification_id -> user_verifications.id.
ALTER TABLE tax_returns
    ADD CONSTRAINT fk_tax_returns_submit_otp
    FOREIGN KEY (submit_otp_verification_id) REFERENCES user_verifications(id);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash    CHAR(64) NOT NULL UNIQUE,
    issued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ NOT NULL,
    revoked_at    TIMESTAMPTZ,
    user_agent    TEXT,
    ip_address    INET
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_live
  ON refresh_tokens(user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS ca_profiles (
    user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    icai_membership      VARCHAR(50) NOT NULL,
    bio                  TEXT,
    specializations      TEXT[],
    years_experience     INT,
    languages            TEXT[],
    fee_range_indicator  VARCHAR(20),
    photo_url            TEXT,
    listed_in_directory  BOOLEAN NOT NULL DEFAULT FALSE,
    accepting_clients    BOOLEAN NOT NULL DEFAULT TRUE,
    serves_cities        TEXT[],
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_ca_fee_range  CHECK (
        fee_range_indicator IS NULL OR fee_range_indicator IN ('budget','mid','premium')
    ),
    CONSTRAINT chk_ca_experience CHECK (years_experience IS NULL OR years_experience BETWEEN 0 AND 80)
);

CREATE INDEX IF NOT EXISTS idx_ca_profiles_listed
  ON ca_profiles(user_id)
  WHERE listed_in_directory = TRUE AND accepting_clients = TRUE;

CREATE INDEX IF NOT EXISTS idx_ca_profiles_serves_cities
  ON ca_profiles USING gin (serves_cities)
  WHERE listed_in_directory = TRUE;

-- ---------------------------------------------------------------------
-- 6.2 calculation_traces
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calculation_traces (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filing_id           UUID NOT NULL REFERENCES tax_returns(id) ON DELETE CASCADE,
    regime              regime NOT NULL,
    trace_json          JSONB NOT NULL,
    final_total         NUMERIC(18,2) NOT NULL,
    rule_versions       JSONB NOT NULL,
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    computed_by_user_id UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_calc_traces_filing ON calculation_traces(filing_id, computed_at DESC);

-- ---------------------------------------------------------------------
-- 7. Documents, Routing & Transactions
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                UUID NOT NULL REFERENCES users(id),
    filing_id              UUID REFERENCES tax_returns(id),
    tax_year               VARCHAR(10),

    document_type          document_type NOT NULL,
    file_name              VARCHAR(512) NOT NULL,
    storage_path           TEXT NOT NULL,
    mime_type              VARCHAR(100) NOT NULL,
    size_bytes             BIGINT NOT NULL,
    sha256                 CHAR(64) NOT NULL,
    status                 document_status NOT NULL DEFAULT 'uploaded',

    routing_status         routing_status NOT NULL DEFAULT 'pending',
    routing_report         JSONB,
    routed_at              TIMESTAMPTZ,
    hint_tax_year          VARCHAR(10),

    extraction_started_at  TIMESTAMPTZ,
    extraction_finished_at TIMESTAMPTZ,
    extraction_error       TEXT,

    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at             TIMESTAMPTZ,

    CONSTRAINT chk_documents_fy      CHECK (tax_year      IS NULL OR tax_year      ~ '^FY\d{4}-\d{2}$'),
    CONSTRAINT chk_documents_hint_fy CHECK (hint_tax_year IS NULL OR hint_tax_year ~ '^FY\d{4}-\d{2}$'),
    CONSTRAINT chk_documents_size    CHECK (size_bytes BETWEEN 1 AND 10485760),
    CONSTRAINT chk_documents_routed  CHECK (routing_status = 'pending' OR routed_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_documents_user_sha
  ON documents(user_id, sha256) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_documents_filing  ON documents(filing_id) WHERE filing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_user_fy ON documents(user_id, tax_year);
CREATE INDEX IF NOT EXISTS idx_documents_status  ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_routing ON documents(routing_status) WHERE routing_status <> 'routed';

CREATE TABLE IF NOT EXISTS transactions (
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

CREATE INDEX IF NOT EXISTS idx_txn_filing        ON transactions(filing_id);
CREATE INDEX IF NOT EXISTS idx_txn_user_fy       ON transactions(user_id, tax_year);
CREATE INDEX IF NOT EXISTS idx_txn_filing_status ON transactions(filing_id, status);
CREATE INDEX IF NOT EXISTS idx_txn_document      ON transactions(document_id) WHERE document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_txn_date          ON transactions(txn_date);

CREATE TABLE IF NOT EXISTS pending_router_inbox (
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
    CONSTRAINT chk_inbox_consistent CHECK (
        (resolved = FALSE AND resolved_at IS NULL) OR
        (resolved = TRUE  AND resolved_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_router_inbox_user_unresolved
  ON pending_router_inbox(user_id) WHERE resolved = FALSE;

-- ---------------------------------------------------------------------
-- 8. Rules & Knowledge
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS country_rules (
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
    created_by_user_id  UUID NOT NULL REFERENCES users(id),
    approved_by_user_id UUID REFERENCES users(id),
    approved_at         TIMESTAMPTZ,
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_rules_active
  ON country_rules(country, tax_year, rule_type) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_rules_lookup  ON country_rules(country, tax_year, rule_type, status);
CREATE INDEX IF NOT EXISTS idx_rules_pending ON country_rules(status) WHERE status = 'pending_approval';

CREATE TABLE IF NOT EXISTS knowledge_chunks (
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

CREATE INDEX IF NOT EXISTS idx_kc_embedding ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_kc_country   ON knowledge_chunks(country);
CREATE INDEX IF NOT EXISTS idx_kc_source    ON knowledge_chunks(source_doc);

CREATE TABLE IF NOT EXISTS rag_query_log (
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

CREATE INDEX IF NOT EXISTS idx_rag_log_user ON rag_query_log(user_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 9. Consultant Access
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consultant_invite_codes (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultant_id        UUID NOT NULL REFERENCES users(id),
    code                 VARCHAR(20) NOT NULL,
    code_hash            CHAR(64) NOT NULL,
    label                VARCHAR(255),
    max_uses             INT NOT NULL DEFAULT 1,
    used_count           INT NOT NULL DEFAULT 0,
    status               invite_code_status NOT NULL DEFAULT 'active',
    default_access_mode  consultant_access_mode,
    allowed_tax_years    TEXT[],
    expires_at           TIMESTAMPTZ NOT NULL,
    revoked_at           TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_invite_code_format CHECK (code ~ '^CA-[A-Z0-9]{6,14}$'),
    CONSTRAINT chk_invite_max_uses    CHECK (max_uses >= 1 AND used_count <= max_uses),
    CONSTRAINT chk_invite_tax_years   CHECK (
        allowed_tax_years IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest(allowed_tax_years) AS ty WHERE ty !~ '^FY\d{4}-\d{2}$'
        )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_invite_code_hash ON consultant_invite_codes(code_hash);
CREATE INDEX IF NOT EXISTS idx_invite_consultant_active
  ON consultant_invite_codes(consultant_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_invite_expires ON consultant_invite_codes(expires_at);

CREATE TABLE IF NOT EXISTS consultant_access_grants (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultant_id       UUID NOT NULL REFERENCES users(id),
    target_user_id      UUID NOT NULL REFERENCES users(id),
    origin              grant_origin NOT NULL,
    invite_code_id      UUID REFERENCES consultant_invite_codes(id),
    access_mode         consultant_access_mode NOT NULL,
    status              consultant_grant_status NOT NULL,
    tax_years           TEXT[] NOT NULL,
    message             TEXT,
    requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at          TIMESTAMPTZ,
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
    CONSTRAINT chk_cag_origin_invite CHECK (
        (origin = 'invite_code'        AND invite_code_id IS NOT NULL) OR
        (origin = 'directory_request'  AND invite_code_id IS NULL)
    ),
    CONSTRAINT chk_cag_pending_origin CHECK (
        status <> 'pending' OR origin = 'directory_request'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cag_live
  ON consultant_access_grants(consultant_id, target_user_id)
  WHERE status IN ('pending', 'active');

CREATE INDEX IF NOT EXISTS idx_cag_consultant_status ON consultant_access_grants(consultant_id, status);
CREATE INDEX IF NOT EXISTS idx_cag_taxpayer_status   ON consultant_access_grants(target_user_id, status);
CREATE INDEX IF NOT EXISTS idx_cag_invite_code       ON consultant_access_grants(invite_code_id) WHERE invite_code_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cag_tax_years_gin     ON consultant_access_grants USING gin (tax_years);

CREATE TABLE IF NOT EXISTS filing_change_sets (
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

CREATE INDEX IF NOT EXISTS idx_change_sets_filing ON filing_change_sets(filing_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 10. Fraud -> Judicial -> Enforcement
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fraud_cases (
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_fraud_cases_open
  ON fraud_cases(filing_id) WHERE status <> 'closed';

CREATE INDEX IF NOT EXISTS idx_fc_status       ON fraud_cases(status);
CREATE INDEX IF NOT EXISTS idx_fc_taxpayer     ON fraud_cases(taxpayer_id);
CREATE INDEX IF NOT EXISTS idx_fc_jurisdiction ON fraud_cases(jurisdiction);
CREATE INDEX IF NOT EXISTS idx_fc_judicial     ON fraud_cases(judicial_officer_id)   WHERE judicial_officer_id   IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fc_enforcement  ON fraud_cases(enforcement_agency_id) WHERE enforcement_agency_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fc_fy           ON fraud_cases(tax_year);

CREATE TABLE IF NOT EXISTS enforcement_access (
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

CREATE INDEX IF NOT EXISTS idx_ea_granted_to_live ON enforcement_access(granted_to) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ea_target          ON enforcement_access(target_user_id);
CREATE INDEX IF NOT EXISTS idx_ea_case            ON enforcement_access(fraud_case_id) WHERE fraud_case_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ea_expires         ON enforcement_access(expires_at);

-- ---------------------------------------------------------------------
-- 11. Cross-cutting
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        notification_type NOT NULL,
    title       VARCHAR(255) NOT NULL,
    body        TEXT,
    payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_all ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_type     ON notifications(type);

CREATE TABLE IF NOT EXISTS audit_logs (
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

CREATE INDEX IF NOT EXISTS idx_audit_actor       ON audit_logs(actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity      ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_action      ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_fraud_case  ON audit_logs(fraud_case_id) WHERE fraud_case_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_occurred_at ON audit_logs(occurred_at DESC);

-- ---------------------------------------------------------------------
-- 12. Triggers
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_logs_block_mutations() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_no_update ON audit_logs;
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutations();

DROP TRIGGER IF EXISTS trg_audit_no_delete ON audit_logs;
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutations();

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_users         ON users;
CREATE TRIGGER trg_touch_users         BEFORE UPDATE ON users         FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS trg_touch_user_consents ON user_consents;
CREATE TRIGGER trg_touch_user_consents BEFORE UPDATE ON user_consents FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS trg_touch_ca_profiles   ON ca_profiles;
CREATE TRIGGER trg_touch_ca_profiles   BEFORE UPDATE ON ca_profiles   FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS trg_touch_tax_returns   ON tax_returns;
CREATE TRIGGER trg_touch_tax_returns   BEFORE UPDATE ON tax_returns   FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS trg_touch_documents     ON documents;
CREATE TRIGGER trg_touch_documents     BEFORE UPDATE ON documents     FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS trg_touch_transactions  ON transactions;
CREATE TRIGGER trg_touch_transactions  BEFORE UPDATE ON transactions  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS trg_touch_country_rules ON country_rules;
CREATE TRIGGER trg_touch_country_rules BEFORE UPDATE ON country_rules FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS trg_touch_fraud_cases   ON fraud_cases;
CREATE TRIGGER trg_touch_fraud_cases   BEFORE UPDATE ON fraud_cases   FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
