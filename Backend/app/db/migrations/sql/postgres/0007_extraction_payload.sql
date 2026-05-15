-- Add extraction_payload (JSONB) to documents. See sqlite/0003 for the
-- payload shape contract.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS extraction_payload JSONB;
