CREATE TABLE IF NOT EXISTS phonebook (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ipv6_address INET,
    ipv4_address INET,
    is_ipv6_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_ipv4_fallback BOOLEAN NOT NULL DEFAULT FALSE,
    last_seen TIMESTAMPTZ,
    is_online BOOLEAN NOT NULL DEFAULT FALSE,
    public_key TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_phonebook_user UNIQUE(user_id)
);
CREATE INDEX IF NOT EXISTS idx_phonebook_online ON phonebook(is_online) WHERE is_online = TRUE;