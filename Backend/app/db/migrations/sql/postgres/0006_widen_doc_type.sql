-- Widen document_type ENUM to include 'bank_pdf' and 'unknown_pdf'.
--
-- Per FILING_FLOW.md §3.3, `bank_pdf` is part of the canonical enum but was
-- missing from the initial migration. `unknown_pdf` is emitted by the
-- type-detector when content sniff can't classify a PDF confidently before
-- Gemini runs in Step 3.

ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'bank_pdf';
ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'unknown_pdf';
