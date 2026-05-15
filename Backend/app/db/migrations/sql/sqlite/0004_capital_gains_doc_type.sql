-- Widen documents.document_type CHECK to include 'capital_gains_statement'
-- and 'broker_pnl' so brokerage / portfolio P&L exports can be ingested.
--
-- Same table-swap pattern as 0002 — SQLite has no ALTER CHECK.

PRAGMA foreign_keys = OFF;

CREATE TABLE documents_new (
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
    extraction_payload     TEXT,

    created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    deleted_at             TEXT,

    CONSTRAINT chk_doc_type CHECK (document_type IN (
        'form16','bank_csv','bank_pdf','ais_tis','form_26as','salary_slip',
        'unknown_pdf','capital_gains_statement','broker_pnl'
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

INSERT INTO documents_new
SELECT id, user_id, filing_id, tax_year,
       document_type, file_name, storage_path, mime_type, size_bytes, sha256, status,
       routing_status, routing_report, routed_at, hint_tax_year,
       extraction_started_at, extraction_finished_at, extraction_error, extraction_payload,
       created_at, updated_at, deleted_at
  FROM documents;

DROP TABLE documents;
ALTER TABLE documents_new RENAME TO documents;

CREATE UNIQUE INDEX uq_documents_user_sha
  ON documents(user_id, sha256) WHERE deleted_at IS NULL;

CREATE INDEX idx_documents_filing  ON documents(filing_id) WHERE filing_id IS NOT NULL;
CREATE INDEX idx_documents_user_fy ON documents(user_id, tax_year);

PRAGMA foreign_keys = ON;
