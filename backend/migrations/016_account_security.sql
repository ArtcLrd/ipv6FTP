-- Account security: saved recovery codes, unique verified recovery email,
-- email challenges, recovery grants and an encrypted delivery queue.
-- Additive only. Requires migration 014 (iam.principals / iam.accounts).
-- NOT applied by the agent; see docs/voice-architecture/migration-016-review.md.

DO $$
BEGIN
    IF to_regclass('iam.accounts') IS NULL THEN
        RAISE EXCEPTION 'migration 016 requires iam.accounts (migration 014)';
    END IF;
END $$;

-- Incremented on every password change or recovery so stale proofs cannot be replayed.
ALTER TABLE iam.accounts ADD COLUMN IF NOT EXISTS credential_version INTEGER NOT NULL DEFAULT 1;
-- NULL means recovery-code setup is not yet acknowledged (existing users complete it after login).
ALTER TABLE iam.accounts ADD COLUMN IF NOT EXISTS recovery_ack_at TIMESTAMPTZ;

-- One active set per account; regeneration retires the previous set atomically.
CREATE TABLE iam.recovery_code_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    principal_id UUID NOT NULL REFERENCES iam.principals(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retired_at TIMESTAMPTZ,
    CONSTRAINT chk_recovery_set_retired CHECK (retired_at IS NULL OR retired_at >= created_at)
);
CREATE UNIQUE INDEX uq_recovery_set_active ON iam.recovery_code_sets(principal_id) WHERE retired_at IS NULL;

CREATE TABLE iam.recovery_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    set_id UUID NOT NULL REFERENCES iam.recovery_code_sets(id) ON DELETE CASCADE,
    verifier BYTEA NOT NULL,
    consumed_at TIMESTAMPTZ,
    CONSTRAINT chk_recovery_verifier_length CHECK (octet_length(verifier) = 32),
    CONSTRAINT uq_recovery_verifier UNIQUE (set_id, verifier)
);
CREATE INDEX idx_recovery_codes_set ON iam.recovery_codes(set_id) WHERE consumed_at IS NULL;

-- Verified address: unique across accounts. Unverified addresses live only in challenges.
CREATE TABLE iam.recovery_emails (
    principal_id UUID PRIMARY KEY REFERENCES iam.principals(id) ON DELETE CASCADE,
    email_canonical TEXT NOT NULL,
    address_version INTEGER NOT NULL DEFAULT 1,
    verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_recovery_email_canonical CHECK (email_canonical = LOWER(BTRIM(email_canonical)) AND char_length(email_canonical) BETWEEN 3 AND 254)
);
CREATE UNIQUE INDEX uq_recovery_email_address ON iam.recovery_emails(email_canonical);

-- One active challenge per purpose, owner and address version.
CREATE TABLE iam.email_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purpose TEXT NOT NULL,
    principal_id UUID REFERENCES iam.principals(id) ON DELETE CASCADE,
    email_canonical TEXT NOT NULL,
    address_version INTEGER NOT NULL,
    verifier BYTEA NOT NULL,
    attempts SMALLINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    superseded_at TIMESTAMPTZ,
    CONSTRAINT chk_challenge_purpose CHECK (purpose IN ('verify_email', 'recover_account', 'cancel_deletion')),
    CONSTRAINT chk_challenge_verifier_length CHECK (octet_length(verifier) = 32),
    CONSTRAINT chk_challenge_attempts CHECK (attempts BETWEEN 0 AND 5),
    CONSTRAINT chk_challenge_expiry CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX uq_email_challenge_active
    ON iam.email_challenges(purpose, principal_id, address_version)
    WHERE consumed_at IS NULL AND superseded_at IS NULL;
CREATE INDEX idx_email_challenges_email ON iam.email_challenges(email_canonical, created_at DESC);

-- Narrow recovery grant: proves control of a code or inbox for one account and credential version.
CREATE TABLE iam.recovery_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    principal_id UUID NOT NULL REFERENCES iam.principals(id) ON DELETE CASCADE,
    credential_version INTEGER NOT NULL,
    method TEXT NOT NULL,
    token_hash BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    CONSTRAINT chk_grant_method CHECK (method IN ('saved_code', 'email')),
    CONSTRAINT chk_grant_hash_length CHECK (octet_length(token_hash) = 32),
    CONSTRAINT chk_grant_expiry CHECK (expires_at > created_at),
    CONSTRAINT uq_grant_token UNIQUE (token_hash)
);
CREATE INDEX idx_recovery_grants_principal ON iam.recovery_grants(principal_id) WHERE used_at IS NULL AND revoked_at IS NULL;

-- Delivery queue. Payload is encrypted, never plaintext codes; rows past
-- expires_at must not be delivered and are removed by the cleanup worker.
CREATE TABLE iam.email_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id UUID REFERENCES iam.email_challenges(id) ON DELETE CASCADE,
    recipient_canonical TEXT NOT NULL,
    template TEXT NOT NULL,
    payload_ciphertext BYTEA NOT NULL,
    key_version SMALLINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempt_count SMALLINT NOT NULL DEFAULT 0,
    delivered_at TIMESTAMPTZ,
    provider_message_id TEXT,
    failed_at TIMESTAMPTZ,
    CONSTRAINT chk_outbox_template CHECK (template IN ('verify_email', 'recover_account', 'cancel_deletion', 'email_removed')),
    CONSTRAINT chk_outbox_expiry CHECK (expires_at > created_at)
);
CREATE INDEX idx_email_outbox_due ON iam.email_outbox(next_attempt_at) WHERE delivered_at IS NULL AND failed_at IS NULL;
CREATE UNIQUE INDEX uq_email_outbox_provider ON iam.email_outbox(provider_message_id) WHERE provider_message_id IS NOT NULL;

-- Webhook replay protection and bounce/complaint suppression.
CREATE TABLE iam.email_webhook_events (
    provider_event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE iam.email_suppressions (
    email_canonical TEXT PRIMARY KEY,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_suppression_reason CHECK (reason IN ('bounce', 'complaint'))
);
