-- Profile lifecycle: username change cooldown and reservations, seven-day deletion state.
-- Additive only. Requires migrations 014 and 016. NOT applied by the agent;
-- see docs/voice-architecture/migration-017-review.md.

DO $$
BEGIN
    IF to_regclass('iam.accounts') IS NULL THEN
        RAISE EXCEPTION 'migration 017 requires iam.accounts (migration 014)';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'iam' AND table_name = 'accounts' AND column_name = 'credential_version') THEN
        RAISE EXCEPTION 'migration 017 requires migration 016';
    END IF;
END $$;

-- Set only by a committed username change; failed attempts never touch it.
ALTER TABLE iam.accounts ADD COLUMN IF NOT EXISTS username_changed_at TIMESTAMPTZ;
-- Both NULL (active) or both set (pending deletion; deadline is server time + 7 days).
ALTER TABLE iam.accounts ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;
ALTER TABLE iam.accounts ADD COLUMN IF NOT EXISTS deletion_deadline TIMESTAMPTZ;
-- Bumped on every profile-visible change so clients can drop stale snapshots.
ALTER TABLE iam.accounts ADD COLUMN IF NOT EXISTS profile_revision BIGINT NOT NULL DEFAULT 1;

ALTER TABLE iam.accounts ADD CONSTRAINT chk_accounts_deletion_pair
    CHECK ((deletion_requested_at IS NULL) = (deletion_deadline IS NULL));
ALTER TABLE iam.accounts ADD CONSTRAINT chk_accounts_deletion_deadline
    CHECK (deletion_deadline IS NULL OR deletion_deadline > deletion_requested_at);

-- 'former': an old name reserved to the account that used it (owner-private).
-- 'retired': permanently blocked after the owning account was purged (no owner link).
-- ON DELETE RESTRICT: a purge worker must convert former rows to retired before removing a principal.
CREATE TABLE iam.username_reservations (
    canonical TEXT PRIMARY KEY,
    principal_id UUID REFERENCES iam.principals(id) ON DELETE RESTRICT,
    kind TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_username_reservation_canonical CHECK (canonical = LOWER(canonical) AND char_length(canonical) BETWEEN 3 AND 64),
    CONSTRAINT chk_username_reservation_kind CHECK (kind IN ('former', 'retired')),
    CONSTRAINT chk_username_reservation_owner CHECK ((kind = 'former') = (principal_id IS NOT NULL))
);
CREATE INDEX idx_username_reservations_owner ON iam.username_reservations(principal_id) WHERE principal_id IS NOT NULL;

-- Accounts cannot take a name reserved to someone else, whichever code path inserts them
-- (including the legacy v1 register endpoint). The advisory lock serialises against a
-- concurrent rename that is creating the reservation in the same instant.
CREATE FUNCTION iam.enforce_username_reservation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    canon TEXT := LOWER(NEW.username);
    holder UUID;
    found_kind TEXT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('username-lock:' || canon, 0));
    SELECT principal_id, kind INTO holder, found_kind FROM iam.username_reservations WHERE canonical = canon;
    IF FOUND AND (found_kind = 'retired' OR holder IS DISTINCT FROM NEW.principal_id) THEN
        RAISE EXCEPTION 'username is reserved' USING ERRCODE = '23505', CONSTRAINT = 'uq_accounts_username_ci';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_accounts_username_reservation
    BEFORE INSERT OR UPDATE OF username ON iam.accounts
    FOR EACH ROW EXECUTE FUNCTION iam.enforce_username_reservation();
