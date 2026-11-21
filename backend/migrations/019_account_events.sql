-- Account-local sequencing serializes writers and avoids gaps from rolled-back transactions.
CREATE TABLE iam.account_event_sequences (
    principal_id uuid PRIMARY KEY REFERENCES iam.principals(id) ON DELETE CASCADE,
    last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0)
);

CREATE TABLE iam.account_events (
    principal_id uuid NOT NULL REFERENCES iam.principals(id) ON DELETE CASCADE,
    sequence bigint NOT NULL CHECK (sequence > 0),
    event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 64),
    version integer NOT NULL CHECK (version > 0),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    claimed_until timestamptz,
    claim_owner uuid,
    delivered_at timestamptz,
    PRIMARY KEY (principal_id, sequence),
    CHECK (expires_at > created_at),
    CHECK ((claimed_until IS NULL) = (claim_owner IS NULL))
);

CREATE INDEX idx_account_events_expiry ON iam.account_events(expires_at);
CREATE INDEX idx_account_events_delivery ON iam.account_events(created_at)
    WHERE delivered_at IS NULL;

-- The caller holds the account lock and invokes this in the mutation transaction.
CREATE FUNCTION iam.append_account_event(recipient uuid, kind text, body jsonb)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE next_sequence bigint;
BEGIN
    INSERT INTO iam.account_event_sequences(principal_id, last_sequence)
    VALUES (recipient, 1)
    ON CONFLICT (principal_id) DO UPDATE
        SET last_sequence = iam.account_event_sequences.last_sequence + 1
    RETURNING last_sequence INTO next_sequence;
    INSERT INTO iam.account_events(principal_id, sequence, event_type, version, payload, expires_at)
    VALUES (recipient, next_sequence, kind, 1, body, now() + interval '7 days');
    RETURN next_sequence;
END;
$$;
