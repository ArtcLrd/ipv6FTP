-- Destructive development reset for the native IPv6 voice architecture.
-- This migration deliberately preserves public.schema_migrations, extensions,
-- cluster roles, and objects outside the explicit application-owned allowlist.

DO $$
BEGIN
    IF current_setting('app.allow_destructive_reset', true) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION 'migration 014 requires migrate up --allow-destructive-reset';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '013') THEN
        RAISE EXCEPTION 'migration 014 requires migration 013';
    END IF;
END $$;

DROP SCHEMA IF EXISTS api CASCADE;
DROP SCHEMA IF EXISTS app_private CASCADE;
DROP SCHEMA IF EXISTS worker CASCADE;
DROP SCHEMA IF EXISTS audit CASCADE;
DROP SCHEMA IF EXISTS communication CASCADE;
DROP SCHEMA IF EXISTS catalog CASCADE;
DROP SCHEMA IF EXISTS iam CASCADE;

DROP TABLE IF EXISTS public.contacts CASCADE;
DROP TABLE IF EXISTS public.phonebook CASCADE;
DROP TABLE IF EXISTS public.sessions CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;

CREATE SCHEMA iam;
CREATE SCHEMA catalog;
CREATE SCHEMA communication;

CREATE TABLE iam.principals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    disabled_at TIMESTAMPTZ,
    CONSTRAINT chk_principals_disabled_after_creation
        CHECK (disabled_at IS NULL OR disabled_at >= created_at)
);

CREATE TABLE iam.accounts (
    principal_id UUID PRIMARY KEY REFERENCES iam.principals(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    CONSTRAINT chk_accounts_username CHECK (username = BTRIM(username) AND char_length(username) BETWEEN 3 AND 64),
    CONSTRAINT chk_accounts_password_hash CHECK (char_length(password_hash) >= 32)
);
CREATE UNIQUE INDEX uq_accounts_username_ci ON iam.accounts (LOWER(username));

CREATE TABLE iam.devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    principal_id UUID NOT NULL REFERENCES iam.principals(id) ON DELETE CASCADE,
    noise_static_public_key BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    CONSTRAINT chk_devices_noise_key_length CHECK (octet_length(noise_static_public_key) = 32),
    CONSTRAINT chk_devices_revoked_after_creation CHECK (revoked_at IS NULL OR revoked_at >= created_at),
    CONSTRAINT uq_devices_key UNIQUE (noise_static_public_key),
    CONSTRAINT uq_devices_owner UNIQUE (id, principal_id)
);
CREATE INDEX idx_devices_principal ON iam.devices(principal_id) WHERE revoked_at IS NULL;

CREATE TABLE iam.auth_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES iam.devices(id) ON DELETE CASCADE,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    CONSTRAINT chk_auth_sessions_expiry CHECK (expires_at > issued_at),
    CONSTRAINT chk_auth_sessions_revoked_after_issue CHECK (revoked_at IS NULL OR revoked_at >= issued_at)
);
CREATE INDEX idx_auth_sessions_device ON iam.auth_sessions(device_id);

CREATE TABLE iam.refresh_tokens (
    token_hash BYTEA PRIMARY KEY,
    auth_session_id UUID NOT NULL REFERENCES iam.auth_sessions(id) ON DELETE CASCADE,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    CONSTRAINT chk_refresh_hash_length CHECK (octet_length(token_hash) = 32),
    CONSTRAINT chk_refresh_expiry CHECK (expires_at > issued_at),
    CONSTRAINT chk_refresh_consumed_after_issue CHECK (consumed_at IS NULL OR consumed_at >= issued_at)
);
CREATE INDEX idx_refresh_tokens_session ON iam.refresh_tokens(auth_session_id);

CREATE TABLE catalog.plan_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL,
    revision INTEGER NOT NULL,
    valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_until TIMESTAMPTZ,
    CONSTRAINT uq_plan_versions_code_revision UNIQUE(code, revision),
    CONSTRAINT chk_plan_revision_positive CHECK (revision > 0),
    CONSTRAINT chk_plan_valid_period CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE TABLE catalog.call_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_version_id UUID NOT NULL REFERENCES catalog.plan_versions(id) ON DELETE CASCADE,
    media_type TEXT NOT NULL,
    connection_route TEXT NOT NULL,
    max_call_seconds INTEGER,
    max_period_seconds INTEGER,
    period_seconds INTEGER,
    CONSTRAINT uq_call_policies_route UNIQUE(plan_version_id, media_type, connection_route),
    CONSTRAINT chk_call_policy_media CHECK (media_type IN ('voice', 'video')),
    CONSTRAINT chk_call_policy_route CHECK (connection_route IN ('direct_ipv6', 'blind_relay_ipv4')),
    CONSTRAINT chk_call_policy_limits CHECK (
        (max_call_seconds IS NULL OR max_call_seconds > 0) AND
        (max_period_seconds IS NULL OR max_period_seconds > 0) AND
        (period_seconds IS NULL OR period_seconds > 0) AND
        ((max_period_seconds IS NULL AND period_seconds IS NULL) OR
         (max_period_seconds IS NOT NULL AND period_seconds IS NOT NULL))
    )
);

CREATE TABLE catalog.plan_assignments (
    principal_id UUID NOT NULL REFERENCES iam.principals(id) ON DELETE CASCADE,
    plan_version_id UUID NOT NULL REFERENCES catalog.plan_versions(id) ON DELETE RESTRICT,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_until TIMESTAMPTZ,
    PRIMARY KEY (principal_id, effective_from),
    CONSTRAINT chk_plan_assignment_period CHECK (effective_until IS NULL OR effective_until > effective_from)
);
CREATE UNIQUE INDEX uq_plan_assignments_current
    ON catalog.plan_assignments(principal_id) WHERE effective_until IS NULL;

CREATE TABLE communication.call_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_principal_id UUID NOT NULL REFERENCES iam.principals(id) ON DELETE RESTRICT,
    state TEXT NOT NULL DEFAULT 'waiting',
    media_type TEXT NOT NULL DEFAULT 'voice',
    connection_route TEXT NOT NULL DEFAULT 'direct_ipv6',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMPTZ,
    connected_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    end_reason TEXT,
    CONSTRAINT chk_call_state CHECK (state IN (
        'waiting', 'awaiting_acceptance', 'handshaking', 'verifying', 'connecting', 'active', 'ended'
    )),
    CONSTRAINT chk_call_media CHECK (media_type IN ('voice', 'video')),
    CONSTRAINT chk_call_route CHECK (connection_route IN ('direct_ipv6', 'blind_relay_ipv4')),
    CONSTRAINT chk_call_timestamps CHECK (
        (accepted_at IS NULL OR accepted_at >= created_at) AND
        (connected_at IS NULL OR connected_at >= COALESCE(accepted_at, created_at)) AND
        (ended_at IS NULL OR ended_at >= created_at)
    ),
    CONSTRAINT chk_ended_call_timestamp CHECK ((state = 'ended') = (ended_at IS NOT NULL))
);
CREATE INDEX idx_call_sessions_creator ON communication.call_sessions(creator_principal_id, created_at DESC);

CREATE TABLE communication.call_participants (
    call_session_id UUID NOT NULL REFERENCES communication.call_sessions(id) ON DELETE CASCADE,
    principal_id UUID NOT NULL REFERENCES iam.principals(id) ON DELETE RESTRICT,
    device_id UUID NOT NULL,
    call_policy_id UUID NOT NULL REFERENCES catalog.call_policies(id) ON DELETE RESTRICT,
    accepted_at TIMESTAMPTZ,
    PRIMARY KEY (call_session_id, principal_id),
    CONSTRAINT uq_call_participant_device UNIQUE (call_session_id, device_id),
    CONSTRAINT fk_call_participant_device_owner
        FOREIGN KEY (device_id, principal_id) REFERENCES iam.devices(id, principal_id) ON DELETE RESTRICT
);
CREATE INDEX idx_call_participants_principal ON communication.call_participants(principal_id, call_session_id);

CREATE TABLE communication.call_invitations (
    call_session_id UUID PRIMARY KEY REFERENCES communication.call_sessions(id) ON DELETE CASCADE,
    code_hash BYTEA NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT chk_invitation_expiry CHECK (expires_at > created_at)
);

CREATE TABLE communication.active_calls (
    principal_id UUID PRIMARY KEY REFERENCES iam.principals(id) ON DELETE CASCADE,
    call_session_id UUID NOT NULL REFERENCES communication.call_sessions(id) ON DELETE CASCADE
);
CREATE INDEX idx_active_calls_call ON communication.active_calls(call_session_id);

WITH free_plan AS (
    INSERT INTO catalog.plan_versions(code, revision)
    VALUES ('registered_free', 1)
    RETURNING id
)
INSERT INTO catalog.call_policies(plan_version_id, media_type, connection_route)
SELECT id, 'voice', 'direct_ipv6' FROM free_plan;

DO $$
BEGIN
    IF to_regrole('ipv6ftp_owner') IS NOT NULL THEN
        ALTER SCHEMA iam OWNER TO ipv6ftp_owner;
        ALTER SCHEMA catalog OWNER TO ipv6ftp_owner;
        ALTER SCHEMA communication OWNER TO ipv6ftp_owner;
    END IF;
    IF to_regrole('ipv6ftp_api') IS NOT NULL THEN
        GRANT USAGE ON SCHEMA iam, catalog, communication TO ipv6ftp_api;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA iam, catalog, communication TO ipv6ftp_api;
    END IF;
    IF to_regrole('ipv6ftp_readonly') IS NOT NULL THEN
        GRANT USAGE ON SCHEMA iam, catalog, communication TO ipv6ftp_readonly;
        GRANT SELECT ON ALL TABLES IN SCHEMA iam, catalog, communication TO ipv6ftp_readonly;
    END IF;
END $$;
