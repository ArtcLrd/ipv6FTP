-- One-use, short-lived stream credentials. The raw credential is never stored.
CREATE TABLE iam.account_event_tickets (
    token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    principal_id uuid NOT NULL REFERENCES iam.principals(id) ON DELETE CASCADE,
    session_id uuid NOT NULL UNIQUE REFERENCES iam.auth_sessions(id) ON DELETE CASCADE,
    device_id uuid NOT NULL REFERENCES iam.devices(id) ON DELETE CASCADE,
    auth_version integer NOT NULL CHECK (auth_version > 0),
    expires_at timestamptz NOT NULL
);
CREATE INDEX idx_account_event_tickets_expiry ON iam.account_event_tickets(expires_at);
