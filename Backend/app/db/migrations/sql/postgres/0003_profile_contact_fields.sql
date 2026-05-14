-- =====================================================================
-- 0003_profile_contact_fields.sql  (PostgreSQL / Supabase)
--
-- Adds non-unique contact_email / contact_phone columns to the role
-- profile tables so the Contact step of onboarding has somewhere to
-- live that ISN'T the unique login-identifier slot.
--
-- Why this exists:
--   * users.email and users.phone are partial-unique (uq_users_email,
--     uq_users_phone). They are the *login identifiers* — set once by
--     send-otp's findOrCreateByIdentifier, and never overwritten by
--     anything else.
--   * The Contact step in the onboarding form collects an email and a
--     mobile that the user wants on file for correspondence. That field
--     legitimately may be shared across accounts (e.g. a family phone),
--     so it cannot live on users.{email,phone}.
--
-- Effect on submitTaxpayer/submitConsultant after this migration: the
-- service stops touching users.{email,phone} and instead writes contact
-- data to the role-profile row. The login channel on `users` is left
-- exactly as send-otp set it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. taxpayer_profiles: contact_email / contact_phone
-- ---------------------------------------------------------------------
ALTER TABLE taxpayer_profiles ADD COLUMN IF NOT EXISTS contact_email VARCHAR(254);
ALTER TABLE taxpayer_profiles ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(20);

-- Light shape checks — not uniqueness. A future-user could legitimately
-- enter +91 or 10 digits; we normalise in the app layer before insert.
ALTER TABLE taxpayer_profiles DROP CONSTRAINT IF EXISTS chk_tp_contact_email;
ALTER TABLE taxpayer_profiles ADD CONSTRAINT chk_tp_contact_email
    CHECK (contact_email IS NULL OR contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

ALTER TABLE taxpayer_profiles DROP CONSTRAINT IF EXISTS chk_tp_contact_phone;
ALTER TABLE taxpayer_profiles ADD CONSTRAINT chk_tp_contact_phone
    CHECK (contact_phone IS NULL OR contact_phone ~ '^[6-9]\d{9}$');

-- ---------------------------------------------------------------------
-- 2. ca_profiles: contact_email / contact_phone  (mirror)
-- ---------------------------------------------------------------------
ALTER TABLE ca_profiles ADD COLUMN IF NOT EXISTS contact_email VARCHAR(254);
ALTER TABLE ca_profiles ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(20);

ALTER TABLE ca_profiles DROP CONSTRAINT IF EXISTS chk_ca_contact_email;
ALTER TABLE ca_profiles ADD CONSTRAINT chk_ca_contact_email
    CHECK (contact_email IS NULL OR contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

ALTER TABLE ca_profiles DROP CONSTRAINT IF EXISTS chk_ca_contact_phone;
ALTER TABLE ca_profiles ADD CONSTRAINT chk_ca_contact_phone
    CHECK (contact_phone IS NULL OR contact_phone ~ '^[6-9]\d{9}$');
