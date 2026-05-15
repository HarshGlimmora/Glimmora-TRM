-- Persist Vertex AI Gemini extraction output verbatim, plus a layered
-- user_overrides block applied on top at read time. The merged view feeds
-- transaction regeneration and the editor UI.
--
-- Shape:
--   {
--     "version": "v1",
--     "model_used": "gemini-1.5-pro" | "stub",
--     "doc_type": "bank_pdf",
--     "extracted_at": "2026-05-15T09:00:00Z",
--     "confidence": 0.92,
--     "raw":       { ...as-returned-by-Gemini, never mutated... },
--     "user_overrides": { ...partial diff written by PATCH /extraction... }
--   }

ALTER TABLE documents ADD COLUMN extraction_payload TEXT;
