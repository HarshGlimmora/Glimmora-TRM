-- =====================================================================
-- 0004_profile_age_marital.sql  (PostgreSQL / Supabase)
--
-- Adds two more fields to the taxpayer Personal step: age (integer) and
-- marital_status (enum-like VARCHAR with a CHECK). Both live on
-- taxpayer_profiles. age is intentionally stored alongside date_of_birth
-- rather than being derived — the form asks for both, and the user is
-- the source of truth for what we present back to them.
-- =====================================================================

ALTER TABLE taxpayer_profiles ADD COLUMN IF NOT EXISTS age            INT;
ALTER TABLE taxpayer_profiles ADD COLUMN IF NOT EXISTS marital_status VARCHAR(20);

ALTER TABLE taxpayer_profiles DROP CONSTRAINT IF EXISTS chk_tp_age;
ALTER TABLE taxpayer_profiles ADD CONSTRAINT chk_tp_age
    CHECK (age IS NULL OR (age >= 0 AND age <= 150));

ALTER TABLE taxpayer_profiles DROP CONSTRAINT IF EXISTS chk_tp_marital;
ALTER TABLE taxpayer_profiles ADD CONSTRAINT chk_tp_marital
    CHECK (marital_status IS NULL OR marital_status IN
        ('single','married','divorced','widowed','separated'));
