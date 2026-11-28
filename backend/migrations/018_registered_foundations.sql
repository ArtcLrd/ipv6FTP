-- Older in-flight challenges lack an authenticated binding and require setup resume.
ALTER TABLE iam.enrollment_challenges
    ADD COLUMN credential_version integer;
ALTER TABLE iam.enrollment_challenges ADD COLUMN device_generation bigint;
ALTER TABLE iam.enrollment_challenges ADD COLUMN server_key_id text;
ALTER TABLE iam.enrollment_challenges ADD COLUMN rotation_supported boolean NOT NULL DEFAULT false;
ALTER TABLE iam.enrollment_challenges ADD CONSTRAINT chk_enrollment_binding CHECK (
        (credential_version IS NULL AND device_generation IS NULL AND server_key_id IS NULL)
        OR (credential_version IS NOT NULL AND credential_version > 0
            AND device_generation IS NOT NULL AND device_generation >= 0
            AND server_key_id IS NOT NULL AND server_key_id ~ '^[A-Za-z0-9_-]{1,64}$')
    );

CREATE TABLE iam.account_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    principal_id UUID NOT NULL REFERENCES iam.principals(id) ON DELETE CASCADE,
    operation text NOT NULL,
    session_id uuid,
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE iam.account_outbox (
    audit_id bigint PRIMARY KEY REFERENCES iam.account_audit(id) ON DELETE CASCADE,
    delivered_at timestamptz
);

CREATE TABLE iam.activation_operations (
    principal_id UUID NOT NULL REFERENCES iam.principals(id) ON DELETE CASCADE,
    operation_key TEXT NOT NULL CHECK (length(operation_key) BETWEEN 1 AND 128),
    fingerprint TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (principal_id, operation_key)
);

CREATE INDEX idx_activation_operations_expiry ON iam.activation_operations(expires_at);

CREATE FUNCTION iam.record_account_operation(account_id uuid, event_name text, affected_session uuid)
RETURNS void LANGUAGE sql AS $$
    WITH event AS (
        INSERT INTO iam.account_audit(principal_id, operation, session_id)
        VALUES (account_id, event_name, affected_session) RETURNING id
    )
    INSERT INTO iam.account_outbox(audit_id) SELECT id FROM event;
$$;
