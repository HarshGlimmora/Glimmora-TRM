-- =====================================================================
-- 0002_auth_and_sessions.sql  (PostgreSQL / Supabase)
--
-- Adds the persistence layer used by the Next.js OTP-only sign-in flow:
--   - relaxes NOT NULL on users.{email,password_hash,name,role} so that a
--     freshly OTP'd row can exist before the user picks a role or completes
--     onboarding
--   - adds users.{display_name,legal_name,profile_completed_at,last_login_at}
--     so the routing decision (dashboard vs onboarding-step) is one column read
--   - sessions: opaque HttpOnly cookie tokens, hashed at rest, with a
--     remember_me flag that controls TTL (short vs long)
--   - onboarding_progress: per-user JSONB draft so onboarding resumes from the
--     exact step the user left off on, across refresh / browser close
--   - taxpayer_profiles: parallel to ca_profiles, holds the fields the
--     onboarding flow gathers (PAN stays on users; aadhaar is stored as last-4
--     + verified-at only)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Relax users columns the OTP-only flow fills in lazily. Also drop
--    chk_users_taxpayer_phone: at role-selection time the taxpayer may
--    have signed in by email only and have NULL phone — the phone is
--    captured later in the onboarding "Contact" step. The application
--    enforces phone-presence at profile-completion time in
--    onboardingService.submitTaxpayer.
-- ---------------------------------------------------------------------
ALTER TABLE users ALTER COLUMN email         DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ALTER COLUMN name          DROP NOT NULL;
ALTER TABLE users ALTER COLUMN role          DROP NOT NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_taxpayer_phone;

-- ---------------------------------------------------------------------
-- 2. Routing-decision columns on users.
-- ---------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name        VARCHAR(80);
ALTER TABLE users ADD COLUMN IF NOT EXISTS legal_name          VARCHAR(120);
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_completed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at       TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_profile_complete
    ON users(profile_completed_at) WHERE profile_completed_at IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3. Server-side opaque sessions (HttpOnly cookie token, hashed at rest).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   CHAR(64) NOT NULL,
    remember_me  BOOLEAN NOT NULL DEFAULT FALSE,
    user_agent   TEXT,
    ip_address   INET,
    issued_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at   TIMESTAMPTZ,

    CONSTRAINT chk_sessions_expires_future CHECK (expires_at > issued_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_token_live
    ON sessions(token_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_user_live
    ON sessions(user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_expires
    ON sessions(expires_at) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------
-- 4. Onboarding draft for resume-from-step behaviour.
--    Sensitive identity values (raw PAN, full Aadhaar) are NEVER stored
--    here — only the boolean flags from useOnboardingStore.identityFlags.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onboarding_progress (
    user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    role           user_role,
    step           SMALLINT NOT NULL DEFAULT 0,
    personal       JSONB NOT NULL DEFAULT '{}'::jsonb,
    contact        JSONB NOT NULL DEFAULT '{}'::jsonb,
    address        JSONB NOT NULL DEFAULT '{}'::jsonb,
    tax_profile    JSONB NOT NULL DEFAULT '{}'::jsonb,
    credentials    JSONB NOT NULL DEFAULT '{}'::jsonb,
    identity_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_onb_step CHECK (step BETWEEN 0 AND 6)
);

DROP TRIGGER IF EXISTS trg_touch_onboarding_progress ON onboarding_progress;
CREATE TRIGGER trg_touch_onboarding_progress BEFORE UPDATE ON onboarding_progress
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------
-- 5. Taxpayer profile (parallel to ca_profiles).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS taxpayer_profiles (
    user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    father_name          VARCHAR(120),
    date_of_birth        DATE,
    gender               VARCHAR(20),
    residential_status   VARCHAR(20),
    primary_income_type  VARCHAR(30),
    regime_preference    regime,
    aadhaar_last4        CHAR(4),
    aadhaar_verified_at  TIMESTAMPTZ,
    address_line1        VARCHAR(120),
    address_line2        VARCHAR(120),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_tp_gender    CHECK (gender IS NULL OR gender IN ('male','female','other','prefer_not_to_say')),
    CONSTRAINT chk_tp_resident  CHECK (residential_status IS NULL OR residential_status IN ('resident','nri','rnor')),
    CONSTRAINT chk_tp_income    CHECK (primary_income_type IS NULL OR primary_income_type IN ('salary','business','professional','capital_gains','house_property','other')),
    CONSTRAINT chk_tp_aadhaar4  CHECK (aadhaar_last4 IS NULL OR aadhaar_last4 ~ '^\d{4}$')
);

DROP TRIGGER IF EXISTS trg_touch_taxpayer_profiles ON taxpayer_profiles;
CREATE TRIGGER trg_touch_taxpayer_profiles BEFORE UPDATE ON taxpayer_profiles
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------
-- 6. Relax ca_profiles.icai_membership — the row may be created before the
--    user has typed their ICAI number on the credentials step.
-- ---------------------------------------------------------------------
ALTER TABLE ca_profiles ALTER COLUMN icai_membership DROP NOT NULL;

-- ---------------------------------------------------------------------
-- 7. Relax consultant_access_grants.expires_at — demo grants persist until
--    explicitly revoked.
-- ---------------------------------------------------------------------
ALTER TABLE consultant_access_grants ALTER COLUMN expires_at DROP NOT NULL;
