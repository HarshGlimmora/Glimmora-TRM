-- =====================================================================
-- 0007_chat.sql  (PostgreSQL / Supabase)
--
-- One-to-one chat between a consultant and a taxpayer who already share an
-- active access grant. The Connections page surfaces these threads in the
-- "Active Chats" card and lets either side open a drawer to talk.
--
-- Design:
--   - chat_threads is keyed by the (consultant, taxpayer) pair and is
--     idempotent — a unique partial index prevents duplicate threads. The
--     `grant_id` column is informational only (we don't FK-cascade off it)
--     because grants can be revoked & re-created and we want the thread to
--     outlive that churn.
--   - chat_messages stores text bodies. Reactions and attachments hang off
--     messages, not threads, so message deletion cascades clean them up.
--   - chat_attachments stores metadata only; the file bytes live on disk
--     under Frontend/.data/chat-attachments/ and are served back through a
--     guarded API route.
--   - chat_reactions is a (message, user, emoji) row — unique on the
--     triple so a user can have at most one of each kind per message but
--     can stack different emojis. Emoji is constrained to a small set so
--     the UI never has to render arbitrary unicode.
--   - chat_read_state is a simple per-(thread, user) cursor used to render
--     the unread dot on the thread list.
-- =====================================================================

CREATE TABLE IF NOT EXISTS chat_threads (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultant_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    taxpayer_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    grant_id        UUID REFERENCES consultant_access_grants(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_message_at TIMESTAMPTZ,

    CONSTRAINT chk_chat_thread_distinct CHECK (consultant_id <> taxpayer_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_thread_pair
    ON chat_threads(consultant_id, taxpayer_id);

CREATE INDEX IF NOT EXISTS idx_chat_threads_consultant
    ON chat_threads(consultant_id, last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_chat_threads_taxpayer
    ON chat_threads(taxpayer_id, last_message_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS chat_messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id   UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    sender_id   UUID NOT NULL REFERENCES users(id),
    body        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    edited_at   TIMESTAMPTZ,
    deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_time
    ON chat_messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS chat_attachments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id   UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    file_name    VARCHAR(255) NOT NULL,
    mime_type    VARCHAR(127) NOT NULL,
    byte_size    INTEGER NOT NULL,
    -- The actual bytes live in Postgres so we don't depend on a writable
    -- filesystem (Vercel functions are read-only outside /tmp, and /tmp is
    -- ephemeral). 10 MB hard cap is enforced at the service layer; TOAST
    -- handles per-row storage transparently.
    bytes        BYTEA NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_chat_attach_size CHECK (byte_size > 0)
);

CREATE INDEX IF NOT EXISTS idx_chat_attachments_message
    ON chat_attachments(message_id);

CREATE TABLE IF NOT EXISTS chat_reactions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id  UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji       VARCHAR(16) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_chat_reaction_emoji CHECK (emoji IN ('like', 'heart', 'thumbs_up'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_reaction_one_per_user
    ON chat_reactions(message_id, user_id, emoji);

CREATE TABLE IF NOT EXISTS chat_read_state (
    thread_id    UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (thread_id, user_id)
);
