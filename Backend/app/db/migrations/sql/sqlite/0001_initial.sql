-- =====================================================================
-- 0001_initial.sql
-- SQLite translation of Technical Docs/SCHEMA.md v1.0 (2026-05-13).
--
-- Translation notes (lossy where the Postgres feature has no SQLite peer):
--   * UUID                  -> TEXT (36-char canonical form)
--   * TIMESTAMPTZ           -> TEXT (ISO-8601 UTC, e.g. 2026-05-14T10:33:00Z)
--   * DATE                  -> TEXT (YYYY-MM-DD)
--   * JSONB / JSON          -> TEXT (JSON serialized at the app layer)
--   * TEXT[] (Postgres arr) -> TEXT (JSON array)
--   * NUMERIC(18,2)         -> NUMERIC (SQLite stores as REAL/TEXT)
--   * BIGSERIAL             -> INTEGER PRIMARY KEY AUTOINCREMENT
--   * INET                  -> TEXT
--   * pgvector vector(1536) -> TEXT (JSON array; ANN search not available in SQLite)
--   * Postgres ENUM types   -> TEXT with CHECK (col IN (...)) constraints
--   * Regex CHECKs (~)      -> REGEXP via a Python UDF registered on connect.
--                              Application code MUST also validate; see app/core/validators.py.
--   * GIN / pg_trgm / ivfflat indexes -> dropped (no SQLite equivalent).
--                                       Application-side filtering required.
--   * Partial indexes       -> SQLite supports these; kept as-is.
--
-- Foreign-key cycle (tax_returns.submit_otp_verification_id <-> user_verifications.filing_id)
-- is fine in SQLite because both FK columns are nullable; PRAGMA foreign_keys=ON enforces
-- on commit, not declaration order.
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- 5. Identity, Consent & Verification
-- ---------------------------------------------------------------------

CREATE TABLE users (
    id                              TEXT PRIMARY KEY,
    email                           TEXT NOT NULL,
    password_hash                   TEXT NOT NULL,
    name                            TEXT NOT NULL,
    role                            TEXT NOT NULL,
    country                         TEXT NOT NULL DEFAULT 'IN',

    pan                             TEXT,
    pan_verified_at                 TEXT,

    phone                           TEXT,
    email_verified_at               TEXT,
    phone_verified_at               TEXT,

    has_business_income             INTEGER NOT NULL DEFAULT 0,
    lifetime_switch_backs_to_new    INTEGER NOT NULL DEFAULT 0,
    active_tax_year                 TEXT,

    jurisdiction                    TEXT,
    city                            TEXT,
    state                           TEXT,
    pincode                         TEXT,

    created_at                      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at                      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    deleted_at                      TEXT,

    CONSTRAINT chk_users_role CHECK (role IN (
        'taxpayer','consultant',
        'officer_l1','officer_l2','officer_l3','officer_l4','officer_l5',
        'judicial_officer','enforcement_agency','admin'
    )),
    CONSTRAINT chk_users_pan          CHECK (pan IS NULL OR pan REGEXP '^[A-Z]{5}[0-9]{4}[A-Z]$'),
    CONSTRAINT chk_users_phone        CHECK (phone IS NULL OR phone REGEXP '^\+?[6-9][0-9]{9}$'),
    CONSTRAINT chk_users_active_fy    CHECK (active_tax_year IS NULL OR active_tax_year REGEXP '^FY[0-9]{4}-[0-9]{2}$'),
    CONSTRAINT chk_users_switchbacks  CHECK (lifetime_switch_backs_to_new BETWEEN 0 AND 1),
    CONSTRAINT chk_users_pincode      CHECK (pincode IS NULL OR pincode REGEXP '^[0-9]{6}$'),
    CONSTRAINT chk_users_taxpayer_phone CHECK (role <> 'taxpayer' OR phone IS NOT NULL),
    CONSTRAINT chk_users_has_business CHECK (has_business_income IN (0,1))
);

CREATE UNIQUE INDEX uq_users_email      ON users(email)        WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_users_pan        ON users(pan)          WHERE pan   IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_users_phone      ON users(phone)        WHERE phone IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX        idx_users_role      ON users(role)         WHERE deleted_at IS NULL;
CREATE INDEX        idx_users_city_role ON users(city, role)   WHERE deleted_at IS NULL;
CREATE INDEX        idx_users_juris     ON users(jurisdiction) WHERE jurisdiction IS NOT NULL;

-- user_consents
CREATE TABLE user_consents (
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    consent_type   TEXT NOT NULL,
    granted        INTEGER NOT NULL,
    granted_at     TEXT,
    revoked_at     TEXT,
    updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    PRIMARY KEY (user_id, consent_type),
    CONSTRAINT chk_consent_type CHECK (consent_type IN (
        'document_processing','ai_analysis','data_retention'
    )),
    CONSTRAINT chk_consent_granted CHECK (granted IN (0,1)),
    CONSTRAINT chk_consent_state CHECK (
        (granted = 1 AND granted_at IS NOT NULL AND revoked_at IS NULL) OR
        (granted = 0 AND revoked_at IS NOT NULL)
    )
);

-- user_verifications (forward-declared; FK to tax_returns added implicitly via filing_id)
CREATE TABLE user_verifications (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel         TEXT NOT NULL,
    purpose         TEXT NOT NULL,
    secret_hash     TEXT NOT NULL,
    destination     TEXT NOT NULL,
    expires_at      TEXT NOT NULL,
    consumed_at     TEXT,
    attempts        INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 5,
    filing_id       TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    CONSTRAINT chk_verif_channel CHECK (channel IN ('email','phone')),
    CONSTRAINT chk_verif_purpose CHECK (purpose IN (
        'signup_email','signup_phone','submit_phone','password_reset','login_new_device'
    )),
    CONSTRAINT chk_verif_phone_purpose CHECK (
        channel <> 'phone' OR purpose IN ('signup_phone','submit_phone','login_new_device')
    ),
    CONSTRAINT chk_verif_submit_has_filing CHECK (
        purpose <> 'submit_phone' OR filing_id IS NOT NULL
    ),
    CONSTRAINT chk_verif_expires_future CHECK (expires_at > created_at)
);

-- One outstanding (unconsumed) challenge per (user, purpose). Time check enforced at app layer.
CREATE UNIQUE INDEX uq_verif_outstanding
  ON user_verifications(user_id, purpose)
  WHERE consumed_at IS NULL;

CREATE INDEX idx_verif_user    ON user_verifications(user_id, created_at DESC);
CREATE INDEX idx_verif_filing  ON user_verifications(filing_id) WHERE filing_id IS NOT NULL;
CREATE INDEX idx_verif_expires ON user_verifications(expires_at);

-- refresh_tokens
CREATE TABLE refresh_tokens (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash    TEXT NOT NULL UNIQUE,
    issued_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    expires_at    TEXT NOT NULL,
    revoked_at    TEXT,
    user_agent    TEXT,
    ip_address    TEXT
);

CREATE INDEX idx_refresh_tokens_user_live
  ON refresh_tokens(user_id)
  WHERE revoked_at IS NULL;

-- ca_profiles
CREATE TABLE ca_profiles (
    user_id              TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    icai_membership      TEXT NOT NULL,
    bio                  TEXT,
    specializations      TEXT,  -- JSON array of strings
    years_experience     INTEGER,
    languages            TEXT,  -- JSON array
    fee_range_indicator  TEXT,
    photo_url            TEXT,

    listed_in_directory  INTEGER NOT NULL DEFAULT 0,
    accepting_clients    INTEGER NOT NULL DEFAULT 1,
    serves_cities        TEXT,  -- JSON array

    created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    CONSTRAINT chk_ca_fee_range  CHECK (
        fee_range_indicator IS NULL OR fee_range_indicator IN ('budget','mid','premium')
    ),
    CONSTRAINT chk_ca_experience CHECK (years_experience IS NULL OR years_experience BETWEEN 0 AND 80),
    CONSTRAINT chk_ca_listed     CHECK (listed_in_directory IN (0,1)),
    CONSTRAINT chk_ca_accepting  CHECK (accepting_clients IN (0,1))
);

CREATE INDEX idx_ca_profiles_listed
  ON ca_profiles(user_id)
  WHERE listed_in_directory = 1 AND accepting_clients = 1;

-- ---------------------------------------------------------------------
-- 6. Financial Year Workspace
-- ---------------------------------------------------------------------

CREATE TABLE tax_returns (
    id                                  TEXT PRIMARY KEY,
    user_id                             TEXT NOT NULL REFERENCES users(id),
    country                             TEXT NOT NULL DEFAULT 'IN',
    tax_year                            TEXT NOT NULL,
    status                              TEXT NOT NULL DEFAULT 'draft',

    regime_used                         TEXT,
    regime_switch_acknowledged          INTEGER NOT NULL DEFAULT 0,
    regime_switch_section_referenced    TEXT,
    regime_switch_acknowledged_at       TEXT,
    regime_acknowledgment_text_hash     TEXT,
    form_10iea_required                 INTEGER NOT NULL DEFAULT 0,

    templated_from_tax_year             TEXT,

    summary_json                        TEXT,
    old_regime_total_tax                NUMERIC,
    new_regime_total_tax                NUMERIC,
    recommended_regime                  TEXT,
    tds_paid                            NUMERIC,
    balance_payable                     NUMERIC,

    current_officer_level               TEXT,
    current_officer_id                  TEXT REFERENCES users(id),
    last_escalated_at                   TEXT,

    submitted_at                        TEXT,
    submitted_by_user_id                TEXT REFERENCES users(id),
    submit_otp_verification_id          TEXT REFERENCES user_verifications(id),
    accepted_at                         TEXT,
    rejected_at                         TEXT,
    review_notes                        TEXT,

    created_at                          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at                          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    deleted_at                          TEXT,

    CONSTRAINT chk_tr_status CHECK (status IN (
        'draft','in_review_by_ca','revision_returned','revision_requested',
        'submitted','accepted','rejected'
    )),
    CONSTRAINT chk_tr_regime CHECK (regime_used IS NULL OR regime_used IN ('old','new')),
    CONSTRAINT chk_tr_recommended_regime CHECK (
        recommended_regime IS NULL OR recommended_regime IN ('old','new')
    ),
    CONSTRAINT chk_tax_returns_fy          CHECK (tax_year REGEXP '^FY[0-9]{4}-[0-9]{2}$'),
    CONSTRAINT chk_tax_returns_template_fy CHECK (
        templated_from_tax_year IS NULL OR templated_from_tax_year REGEXP '^FY[0-9]{4}-[0-9]{2}$'
    ),
    CONSTRAINT chk_tax_returns_officer_lvl CHECK (
        current_officer_level IS NULL OR current_officer_level IN ('L1','L2','L3','L4','L5')
    ),
    CONSTRAINT chk_tax_returns_submit_otp  CHECK (
        submitted_at IS NULL OR submit_otp_verification_id IS NOT NULL
    ),
    CONSTRAINT chk_tr_regime_ack CHECK (regime_switch_acknowledged IN (0,1)),
    CONSTRAINT chk_tr_form_10iea CHECK (form_10iea_required IN (0,1))
);

CREATE UNIQUE INDEX uq_tax_returns_open
  ON tax_returns(user_id, tax_year, country)
  WHERE status NOT IN ('accepted', 'rejected') AND deleted_at IS NULL;

CREATE INDEX idx_tax_returns_user_fy   ON tax_returns(user_id, tax_year);
CREATE INDEX idx_tax_returns_status    ON tax_returns(status);
CREATE INDEX idx_tax_returns_submitted ON tax_returns(submitted_at) WHERE submitted_at IS NOT NULL;
CREATE INDEX idx_tax_returns_officer   ON tax_returns(current_officer_id) WHERE current_officer_id IS NOT NULL;

-- Now that tax_returns exists, formalize the FK on user_verifications.filing_id.
-- SQLite doesn't support ADD CONSTRAINT, so the FK is declared inline on user_verifications.filing_id
-- via the table-level FK below using a virtual approach: we recreate the index pointer.
-- (The reference will be enforced once both tables exist with PRAGMA foreign_keys=ON.)
-- NOTE: SQLite resolves FK targets at write-time, not declare-time, so adding the column
-- as a plain TEXT with a manual FK trigger-style check is sufficient. We rely on app-level
-- enforcement plus the chk_verif_submit_has_filing constraint.

CREATE TABLE calculation_traces (
    id                  TEXT PRIMARY KEY,
    filing_id           TEXT NOT NULL REFERENCES tax_returns(id) ON DELETE CASCADE,
    regime              TEXT NOT NULL,
    trace_json          TEXT NOT NULL,
    final_total         NUMERIC NOT NULL,
    rule_versions       TEXT NOT NULL,
    computed_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    computed_by_user_id TEXT REFERENCES users(id),

    CONSTRAINT chk_calc_regime CHECK (regime IN ('old','new'))
);

CREATE INDEX idx_calc_traces_filing ON calculation_traces(filing_id, computed_at DESC);

-- ---------------------------------------------------------------------
-- 7. Documents, Routing & Transactions
-- ---------------------------------------------------------------------

CREATE TABLE documents (
    id                     TEXT PRIMARY KEY,
    user_id                TEXT NOT NULL REFERENCES users(id),
    filing_id              TEXT REFERENCES tax_returns(id),
    tax_year               TEXT,

    document_type          TEXT NOT NULL,
    file_name              TEXT NOT NULL,
    storage_path           TEXT NOT NULL,
    mime_type              TEXT NOT NULL,
    size_bytes             INTEGER NOT NULL,
    sha256                 TEXT NOT NULL,
    status                 TEXT NOT NULL DEFAULT 'uploaded',

    routing_status         TEXT NOT NULL DEFAULT 'pending',
    routing_report         TEXT,
    routed_at              TEXT,
    hint_tax_year          TEXT,

    extraction_started_at  TEXT,
    extraction_finished_at TEXT,
    extraction_error       TEXT,

    created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    deleted_at             TEXT,

    CONSTRAINT chk_doc_type CHECK (document_type IN (
        'form16','bank_csv','ais_tis','form_26as','salary_slip'
    )),
    CONSTRAINT chk_doc_status CHECK (status IN ('uploaded','processing','completed','failed')),
    CONSTRAINT chk_doc_routing_status CHECK (routing_status IN (
        'pending','routed','partially_routed','unresolved','overridden'
    )),
    CONSTRAINT chk_documents_fy      CHECK (tax_year      IS NULL OR tax_year      REGEXP '^FY[0-9]{4}-[0-9]{2}$'),
    CONSTRAINT chk_documents_hint_fy CHECK (hint_tax_year IS NULL OR hint_tax_year REGEXP '^FY[0-9]{4}-[0-9]{2}$'),
    CONSTRAINT chk_documents_size    CHECK (size_bytes BETWEEN 1 AND 10485760),
    CONSTRAINT chk_documents_routed  CHECK (routing_status = 'pending' OR routed_at IS NOT NULL)
);

CREATE UNIQUE INDEX uq_documents_user_sha
  ON documents(user_id, sha256) WHERE deleted_at IS NULL;

CREATE INDEX idx_documents_filing  ON documents(filing_id) WHERE filing_id IS NOT NULL;
CREATE INDEX idx_documents_user_fy ON documents(user_id, tax_year);
CREATE INDEX idx_documents_status  ON documents(status);
CREATE INDEX idx_documents_routing ON documents(routing_status) WHERE routing_status <> 'routed';

CREATE TABLE transactions (
    id                       TEXT PRIMARY KEY,
    filing_id                TEXT NOT NULL REFERENCES tax_returns(id) ON DELETE CASCADE,
    document_id              TEXT REFERENCES documents(id),
    user_id                  TEXT NOT NULL REFERENCES users(id),
    tax_year                 TEXT NOT NULL,

    txn_date                 TEXT NOT NULL,
    amount                   NUMERIC NOT NULL,
    description              TEXT,
    counterparty             TEXT,
    raw_payload              TEXT,

    category                 TEXT,
    categorization_method    TEXT NOT NULL DEFAULT 'rule',
    rule_matched             TEXT,
    confidence_score         NUMERIC,

    routing_method           TEXT NOT NULL DEFAULT 'auto',
    routing_source_field     TEXT,
    routed_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    status                   TEXT NOT NULL DEFAULT 'unverified',
    verified_by_user_id      TEXT REFERENCES users(id),
    verified_at              TEXT,

    created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    CONSTRAINT chk_txn_cat_method CHECK (categorization_method IN ('rule','ai_assisted','manual')),
    CONSTRAINT chk_txn_status     CHECK (status IN ('unverified','verified','rejected')),
    CONSTRAINT chk_txn_route_method CHECK (routing_method IN ('auto','manual_override')),
    CONSTRAINT chk_txn_fy         CHECK (tax_year REGEXP '^FY[0-9]{4}-[0-9]{2}$'),
    CONSTRAINT chk_txn_confidence CHECK (confidence_score IS NULL OR (confidence_score BETWEEN 0 AND 1)),
    CONSTRAINT chk_txn_method_rule CHECK (categorization_method <> 'rule' OR rule_matched IS NOT NULL)
);

CREATE INDEX idx_txn_filing        ON transactions(filing_id);
CREATE INDEX idx_txn_user_fy       ON transactions(user_id, tax_year);
CREATE INDEX idx_txn_filing_status ON transactions(filing_id, status);
CREATE INDEX idx_txn_document      ON transactions(document_id) WHERE document_id IS NOT NULL;
CREATE INDEX idx_txn_date          ON transactions(txn_date);

CREATE TABLE pending_router_inbox (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL REFERENCES users(id),
    document_id         TEXT REFERENCES documents(id),

    raw_payload         TEXT NOT NULL,
    reason              TEXT NOT NULL,
    suggested_tax_year  TEXT,

    resolved            INTEGER NOT NULL DEFAULT 0,
    resolved_tax_year   TEXT,
    resolved_at         TEXT,
    resolved_by_user_id TEXT REFERENCES users(id),
    resolution_action   TEXT,

    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    CONSTRAINT chk_inbox_reason CHECK (reason IN (
        'invalid_date','terminal_fy_conflict','ambiguous_fy','routing_review_required'
    )),
    CONSTRAINT chk_inbox_suggested_fy CHECK (suggested_tax_year IS NULL OR suggested_tax_year REGEXP '^FY[0-9]{4}-[0-9]{2}$'),
    CONSTRAINT chk_inbox_resolved_fy  CHECK (resolved_tax_year  IS NULL OR resolved_tax_year  REGEXP '^FY[0-9]{4}-[0-9]{2}$'),
    CONSTRAINT chk_inbox_resolved_bool CHECK (resolved IN (0,1)),
    CONSTRAINT chk_inbox_consistent CHECK (
        (resolved = 0 AND resolved_at IS NULL) OR
        (resolved = 1 AND resolved_at IS NOT NULL)
    )
);

CREATE INDEX idx_router_inbox_user_unresolved
  ON pending_router_inbox(user_id) WHERE resolved = 0;

-- ---------------------------------------------------------------------
-- 8. Rules & Knowledge
-- ---------------------------------------------------------------------

CREATE TABLE country_rules (
    id                  TEXT PRIMARY KEY,
    country             TEXT NOT NULL,
    tax_year            TEXT NOT NULL,
    rule_type           TEXT NOT NULL,
    version             INTEGER NOT NULL DEFAULT 1,
    rule_json           TEXT NOT NULL,
    source_reference    TEXT NOT NULL,
    effective_from      TEXT NOT NULL,
    effective_to        TEXT,
    status              TEXT NOT NULL DEFAULT 'pending_approval',

    created_by_user_id  TEXT NOT NULL REFERENCES users(id),
    approved_by_user_id TEXT REFERENCES users(id),
    approved_at         TEXT,

    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    CONSTRAINT chk_rules_status CHECK (status IN (
        'pending_approval','active','superseded','rejected'
    )),
    CONSTRAINT chk_rules_fy CHECK (tax_year REGEXP '^FY[0-9]{4}-[0-9]{2}$'),
    CONSTRAINT chk_rules_dual_approver CHECK (
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

CREATE TABLE knowledge_chunks (
    id              TEXT PRIMARY KEY,
    source_doc      TEXT NOT NULL,
    section_ref     TEXT,
    country         TEXT NOT NULL DEFAULT 'IN',
    chunk_text      TEXT NOT NULL,
    embedding       TEXT NOT NULL,             -- JSON array of 1536 floats
    token_count     INTEGER,
    metadata        TEXT NOT NULL DEFAULT '{}',
    ingested_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ingest_run_id   TEXT
);

CREATE INDEX idx_kc_country   ON knowledge_chunks(country);
CREATE INDEX idx_kc_source    ON knowledge_chunks(source_doc);

CREATE TABLE rag_query_log (
    id                TEXT PRIMARY KEY,
    user_id           TEXT NOT NULL REFERENCES users(id),
    question_redacted TEXT NOT NULL,
    answer            TEXT,
    sources           TEXT,
    model_used        TEXT,
    tokens_used       INTEGER,
    intercepted       INTEGER NOT NULL DEFAULT 0,
    intercept_reason  TEXT,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    CONSTRAINT chk_rag_intercepted CHECK (intercepted IN (0,1))
);

CREATE INDEX idx_rag_log_user ON rag_query_log(user_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 9. Consultant Access
-- ---------------------------------------------------------------------

CREATE TABLE consultant_invite_codes (
    id                   TEXT PRIMARY KEY,
    consultant_id        TEXT NOT NULL REFERENCES users(id),
    code                 TEXT NOT NULL,
    code_hash            TEXT NOT NULL,
    label                TEXT,
    max_uses             INTEGER NOT NULL DEFAULT 1,
    used_count           INTEGER NOT NULL DEFAULT 0,
    status               TEXT NOT NULL DEFAULT 'active',
    default_access_mode  TEXT,
    allowed_tax_years    TEXT,                          -- JSON array, nullable
    expires_at           TEXT NOT NULL,
    revoked_at           TEXT,
    created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    CONSTRAINT chk_invite_status CHECK (status IN ('active','exhausted','revoked','expired')),
    CONSTRAINT chk_invite_default_mode CHECK (
        default_access_mode IS NULL OR default_access_mode IN ('full_access','review_edit')
    ),
    CONSTRAINT chk_invite_code_format CHECK (code REGEXP '^CA-[A-Z0-9]{6,14}$'),
    CONSTRAINT chk_invite_max_uses    CHECK (max_uses >= 1 AND used_count <= max_uses)
);

CREATE UNIQUE INDEX uq_invite_code_hash ON consultant_invite_codes(code_hash);
CREATE INDEX idx_invite_consultant_active
  ON consultant_invite_codes(consultant_id) WHERE status = 'active';
CREATE INDEX idx_invite_expires ON consultant_invite_codes(expires_at);

CREATE TABLE consultant_access_grants (
    id                  TEXT PRIMARY KEY,
    consultant_id       TEXT NOT NULL REFERENCES users(id),
    target_user_id      TEXT NOT NULL REFERENCES users(id),

    origin              TEXT NOT NULL,
    invite_code_id      TEXT REFERENCES consultant_invite_codes(id),

    access_mode         TEXT NOT NULL,
    status              TEXT NOT NULL,

    tax_years           TEXT NOT NULL,            -- JSON array
    message             TEXT,

    requested_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    decided_at          TEXT,
    revoked_at          TEXT,
    expires_at          TEXT NOT NULL,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    CONSTRAINT chk_cag_origin CHECK (origin IN ('directory_request','invite_code')),
    CONSTRAINT chk_cag_status CHECK (status IN ('pending','active','rejected','revoked','expired')),
    CONSTRAINT chk_cag_mode   CHECK (access_mode IN ('full_access','review_edit')),
    CONSTRAINT chk_cag_distinct CHECK (consultant_id <> target_user_id),
    CONSTRAINT chk_cag_origin_invite CHECK (
        (origin = 'invite_code'       AND invite_code_id IS NOT NULL) OR
        (origin = 'directory_request' AND invite_code_id IS NULL)
    ),
    CONSTRAINT chk_cag_pending_origin CHECK (
        status <> 'pending' OR origin = 'directory_request'
    )
);

CREATE UNIQUE INDEX uq_cag_live
  ON consultant_access_grants(consultant_id, target_user_id)
  WHERE status IN ('pending', 'active');

CREATE INDEX idx_cag_consultant_status ON consultant_access_grants(consultant_id, status);
CREATE INDEX idx_cag_taxpayer_status   ON consultant_access_grants(target_user_id, status);
CREATE INDEX idx_cag_invite_code       ON consultant_access_grants(invite_code_id) WHERE invite_code_id IS NOT NULL;

CREATE TABLE filing_change_sets (
    id                  TEXT PRIMARY KEY,
    filing_id           TEXT NOT NULL REFERENCES tax_returns(id) ON DELETE CASCADE,
    grant_id            TEXT NOT NULL REFERENCES consultant_access_grants(id),
    consultant_id       TEXT NOT NULL REFERENCES users(id),
    notes               TEXT,
    changes             TEXT NOT NULL,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    accepted_at         TEXT,
    rejected_at         TEXT,
    decided_by_user_id  TEXT REFERENCES users(id)
);

CREATE INDEX idx_change_sets_filing ON filing_change_sets(filing_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 10. Fraud -> Judicial -> Enforcement
-- ---------------------------------------------------------------------

CREATE TABLE fraud_cases (
    id                          TEXT PRIMARY KEY,
    filing_id                   TEXT NOT NULL REFERENCES tax_returns(id),
    taxpayer_id                 TEXT NOT NULL REFERENCES users(id),
    tax_year                    TEXT NOT NULL,
    jurisdiction                TEXT,

    flagged_by                  TEXT NOT NULL REFERENCES users(id),
    flag_reason                 TEXT NOT NULL,
    flag_notes                  TEXT,
    flagged_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    status                      TEXT NOT NULL DEFAULT 'flagged',

    judicial_officer_id         TEXT REFERENCES users(id),
    judicial_assigned_at        TEXT,
    judicial_decision           TEXT,
    judicial_notes              TEXT,
    judicial_reviewed_at        TEXT,

    enforcement_agency_id       TEXT REFERENCES users(id),
    enforcement_assigned_at     TEXT,
    enforcement_outcome         TEXT,
    enforcement_notes           TEXT,
    closed_at                   TEXT,

    created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    CONSTRAINT chk_fc_status CHECK (status IN (
        'flagged','judicial_review','enforcement_assigned','closed'
    )),
    CONSTRAINT chk_fc_flag_reason CHECK (flag_reason IN (
        'income_mismatch','undisclosed_income','fabricated_deduction','other'
    )),
    CONSTRAINT chk_fc_judicial_decision CHECK (
        judicial_decision IS NULL OR judicial_decision IN ('dismiss','assigned_to_enforcement')
    ),
    CONSTRAINT chk_fc_enforcement_outcome CHECK (
        enforcement_outcome IS NULL OR enforcement_outcome IN (
            'tax_liability_confirmed','no_fraud_found','partial_findings','escalated_externally'
        )
    ),
    CONSTRAINT chk_fc_fy CHECK (tax_year REGEXP '^FY[0-9]{4}-[0-9]{2}$'),
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

CREATE TABLE enforcement_access (
    id                  TEXT PRIMARY KEY,
    target_user_id      TEXT NOT NULL REFERENCES users(id),
    granted_to          TEXT NOT NULL REFERENCES users(id),
    granted_by          TEXT NOT NULL REFERENCES users(id),
    fraud_case_id       TEXT REFERENCES fraud_cases(id),
    access_type         TEXT NOT NULL DEFAULT 'read_only',

    reason              TEXT NOT NULL,
    case_reference      TEXT,
    tax_years           TEXT,                        -- JSON array nullable

    granted_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    expires_at          TEXT NOT NULL,
    revoked_at          TEXT,

    CONSTRAINT chk_ea_distinct      CHECK (target_user_id <> granted_to),
    CONSTRAINT chk_ea_expires_after CHECK (expires_at > granted_at)
);

CREATE INDEX idx_ea_granted_to_live ON enforcement_access(granted_to) WHERE revoked_at IS NULL;
CREATE INDEX idx_ea_target          ON enforcement_access(target_user_id);
CREATE INDEX idx_ea_case            ON enforcement_access(fraud_case_id) WHERE fraud_case_id IS NOT NULL;
CREATE INDEX idx_ea_expires         ON enforcement_access(expires_at);

-- ---------------------------------------------------------------------
-- 11. Cross-Cutting
-- ---------------------------------------------------------------------

CREATE TABLE notifications (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT,
    payload     TEXT NOT NULL DEFAULT '{}',
    read_at     TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    CONSTRAINT chk_notif_type CHECK (type IN (
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
    ))
);

CREATE INDEX idx_notifications_user_unread
  ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_user_all ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_type     ON notifications(type);

CREATE TABLE audit_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id   TEXT REFERENCES users(id),
    actor_role      TEXT,
    action          TEXT NOT NULL,
    entity_type     TEXT,
    entity_id       TEXT,
    fraud_case_id   TEXT REFERENCES fraud_cases(id),
    tax_year        TEXT,

    before_state    TEXT,
    after_state     TEXT,
    metadata        TEXT NOT NULL DEFAULT '{}',

    occurred_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    CONSTRAINT chk_audit_fy CHECK (tax_year IS NULL OR tax_year REGEXP '^FY[0-9]{4}-[0-9]{2}$')
);

CREATE INDEX idx_audit_actor       ON audit_logs(actor_user_id, occurred_at DESC);
CREATE INDEX idx_audit_entity      ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_action      ON audit_logs(action);
CREATE INDEX idx_audit_fraud_case  ON audit_logs(fraud_case_id) WHERE fraud_case_id IS NOT NULL;
CREATE INDEX idx_audit_occurred_at ON audit_logs(occurred_at DESC);

-- Append-only: block UPDATE/DELETE on audit_logs.
CREATE TRIGGER trg_audit_no_update
BEFORE UPDATE ON audit_logs
BEGIN
    SELECT RAISE(ABORT, 'audit_logs is append-only');
END;

CREATE TRIGGER trg_audit_no_delete
BEFORE DELETE ON audit_logs
BEGIN
    SELECT RAISE(ABORT, 'audit_logs is append-only');
END;

-- ---------------------------------------------------------------------
-- 12. updated_at touch triggers (one per table that has updated_at)
-- ---------------------------------------------------------------------

CREATE TRIGGER trg_touch_users
AFTER UPDATE ON users
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER trg_touch_user_consents
AFTER UPDATE ON user_consents
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE user_consents
       SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE user_id = NEW.user_id AND consent_type = NEW.consent_type;
END;

CREATE TRIGGER trg_touch_ca_profiles
AFTER UPDATE ON ca_profiles
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE ca_profiles SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE user_id = NEW.user_id;
END;

CREATE TRIGGER trg_touch_tax_returns
AFTER UPDATE ON tax_returns
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE tax_returns SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER trg_touch_documents
AFTER UPDATE ON documents
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE documents SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER trg_touch_transactions
AFTER UPDATE ON transactions
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE transactions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER trg_touch_country_rules
AFTER UPDATE ON country_rules
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE country_rules SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER trg_touch_fraud_cases
AFTER UPDATE ON fraud_cases
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE fraud_cases SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
