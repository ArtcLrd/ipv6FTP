-- Device enrollment: single-use challenges, device ownership generation and activation.
-- Additive only. Requires migrations 014 and 016 (and 017 is independent). NOT applied by
-- the agent; see docs/voice-architecture/migration-015-review.md.
--
-- Numbering note: 015 is applied AFTER 016 and 017 on databases that already ran them.
-- The migrator sorts by version and records each file, so an out-of-order pending 015 is
-- applied on the next `up`; it has no dependency on 016/017 objects.

DO $$
BEGIN
    IF to_regclass('iam.accounts') IS NULL OR to_regclass('iam.devices') IS NULL THEN
        RAISE EXCEPTION 'migration 015 requires iam.accounts and iam.devices (migration 014)';
    END IF;
END $$;

-- Incremented by every committed enrollment (new phone, restore). Clients and the
-- authorization snapshot use it to ignore superseded device authorizations.
ALTER TABLE iam.accounts ADD COLUMN IF NOT EXISTS device_generation BIGINT NOT NULL DEFAULT 0;
-- NULL until the recovery codes were acknowledged and setup was completed. Existing
-- accounts stay NULL and report recovery_setup until they complete that step (D13).
ALTER TABLE iam.accounts ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

-- One open challenge per account. The nonce is bound into the Noise prologue so a
-- recorded first handshake message cannot be replayed against a later challenge.
CREATE TABLE iam.enrollment_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    principal_id UUID NOT NULL REFERENCES iam.principals(id) ON DELETE CASCADE,
    nonce BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    CONSTRAINT chk_enroll_nonce_length CHECK (octet_length(nonce) = 32),
    CONSTRAINT chk_enroll_expiry CHECK (expires_at > created_at),
    CONSTRAINT chk_enroll_consumed_after_creation CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);
CREATE UNIQUE INDEX uq_enroll_open_challenge ON iam.enrollment_challenges(principal_id) WHERE consumed_at IS NULL;
CREATE INDEX idx_enroll_expires ON iam.enrollment_challenges(expires_at);
