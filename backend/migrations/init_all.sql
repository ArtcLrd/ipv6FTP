-- ipv6FTP full schema init
-- Run against database: ipv6ftp
-- Example:
--   psql -U postgres -d ipv6ftp -f backend/migrations/init_all.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 001_users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(30) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'user',
    status VARCHAR(20) NOT NULL DEFAULT 'offline',
    ip_addr TEXT,
    last_seen TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status) WHERE status = 'online';

-- 002_phonebook
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

-- 003_sessions
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    user_agent TEXT,
    ip_addr TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- 004_contacts
CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_contact_pair UNIQUE(owner_id, contact_id),
    CONSTRAINT chk_no_self_contact CHECK (owner_id != contact_id)
);
CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_id);
CREATE INDEX IF NOT EXISTS idx_contacts_contact ON contacts(contact_id);
