-- =====================================================================
-- 0005_invite_codes_5digit.sql  (PostgreSQL / Supabase)
--
-- Relaxes the consultant_invite_codes.code format to a 5-digit numeric
-- shareable code (game-ID style), which is what the Connections page asks
-- the taxpayer to paste in. The legacy CA-XXXXXX format was never wired
-- into a UI so dropping it now is safe.
--
-- Also bumps the default max_uses so a CA can hand the same 5-digit code
-- to many clients without rotating it for each one. Each redemption still
-- increments used_count and a code can be revoked at any time.
-- =====================================================================

ALTER TABLE consultant_invite_codes DROP CONSTRAINT IF EXISTS chk_invite_code_format;
ALTER TABLE consultant_invite_codes ADD CONSTRAINT chk_invite_code_format
    CHECK (code ~ '^[0-9]{5}$');

ALTER TABLE consultant_invite_codes ALTER COLUMN max_uses SET DEFAULT 1000;

-- One *active* 5-digit code per consultant. Stale revoked rows don't
-- count, so a CA can rotate freely.
DROP INDEX IF EXISTS uq_invite_active_per_consultant;
CREATE UNIQUE INDEX IF NOT EXISTS uq_invite_active_per_consultant
    ON consultant_invite_codes(consultant_id)
    WHERE status = 'active';
