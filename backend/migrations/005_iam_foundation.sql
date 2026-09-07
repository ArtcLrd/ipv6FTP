-- Production IAM foundation.
-- This migration creates the canonical identity, admin, credential, session,
-- device, RBAC, and audit structures without changing the legacy public tables.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS audit;

CREATE OR REPLACE FUNCTION iam.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS iam.principals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    principal_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_principals_type CHECK (principal_type IN ('user', 'admin')),
    CONSTRAINT chk_principals_status CHECK (status IN ('active', 'suspended', 'deleted'))
);
CREATE INDEX IF NOT EXISTS idx_principals_type_status ON iam.principals(principal_type, status);

DROP TRIGGER IF EXISTS set_principals_updated_at ON iam.principals;
CREATE TRIGGER set_principals_updated_at
BEFORE UPDATE ON iam.principals
FOR EACH ROW
EXECUTE FUNCTION iam.set_updated_at();

CREATE OR REPLACE FUNCTION iam.enforce_principal_type()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    actual_type TEXT;
BEGIN
    SELECT principal_type
    INTO actual_type
    FROM iam.principals
    WHERE id = NEW.principal_id;

    IF actual_type IS DISTINCT FROM TG_ARGV[0] THEN
        RAISE EXCEPTION 'principal % must be type %, found %', NEW.principal_id, TG_ARGV[0], actual_type
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS iam.user_accounts (
    principal_id UUID PRIMARY KEY REFERENCES iam.principals(id) ON DELETE CASCADE,
    account_type TEXT NOT NULL DEFAULT 'guest',
    username CITEXT,
    display_name TEXT,
    trial_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    trial_expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    registered_at TIMESTAMPTZ,
    converted_from_guest_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_user_accounts_type CHECK (account_type IN ('guest', 'registered')),
    CONSTRAINT chk_user_accounts_registration_state CHECK (
        (account_type = 'guest' AND username IS NULL AND registered_at IS NULL)
        OR
        (account_type = 'registered' AND username IS NOT NULL AND registered_at IS NOT NULL)
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_accounts_username
    ON iam.user_accounts(username)
    WHERE username IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_accounts_type ON iam.user_accounts(account_type);
CREATE INDEX IF NOT EXISTS idx_user_accounts_trial_expires_at
    ON iam.user_accounts(trial_expires_at)
    WHERE account_type = 'guest';

DROP TRIGGER IF EXISTS enforce_user_account_principal_type ON iam.user_accounts;
CREATE TRIGGER enforce_user_account_principal_type
BEFORE INSERT OR UPDATE OF principal_id ON iam.user_accounts
FOR EACH ROW
EXECUTE FUNCTION iam.enforce_principal_type('user');

DROP TRIGGER IF EXISTS set_user_accounts_updated_at ON iam.user_accounts;
CREATE TRIGGER set_user_accounts_updated_at
BEFORE UPDATE ON iam.user_accounts
FOR EACH ROW
EXECUTE FUNCTION iam.set_updated_at();

CREATE TABLE IF NOT EXISTS iam.admin_users (
    principal_id UUID PRIMARY KEY REFERENCES iam.principals(id) ON DELETE CASCADE,
    email CITEXT NOT NULL,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_activation',
    linked_user_principal_id UUID REFERENCES iam.user_accounts(principal_id) ON DELETE SET NULL,
    mfa_required BOOLEAN NOT NULL DEFAULT TRUE,
    break_glass BOOLEAN NOT NULL DEFAULT FALSE,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_admin_users_status CHECK (status IN ('pending_activation', 'active', 'suspended', 'deleted')),
    CONSTRAINT chk_admin_users_not_linked_to_self CHECK (principal_id <> linked_user_principal_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_users_email
    ON iam.admin_users(email);
CREATE INDEX IF NOT EXISTS idx_admin_users_status ON iam.admin_users(status);
CREATE INDEX IF NOT EXISTS idx_admin_users_linked_user ON iam.admin_users(linked_user_principal_id);

DROP TRIGGER IF EXISTS enforce_admin_user_principal_type ON iam.admin_users;
CREATE TRIGGER enforce_admin_user_principal_type
BEFORE INSERT OR UPDATE OF principal_id ON iam.admin_users
FOR EACH ROW
EXECUTE FUNCTION iam.enforce_principal_type('admin');

DROP TRIGGER IF EXISTS set_admin_users_updated_at ON iam.admin_users;
CREATE TRIGGER set_admin_users_updated_at
BEFORE UPDATE ON iam.admin_users
FOR EACH ROW
EXECUTE FUNCTION iam.set_updated_at();

CREATE TABLE IF NOT EXISTS iam.auth_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    principal_id UUID NOT NULL REFERENCES iam.principals(id) ON DELETE CASCADE,
    credential_type TEXT NOT NULL,
    identifier CITEXT,
    secret_hash TEXT,
    verified_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_auth_credentials_type CHECK (credential_type IN ('password', 'passkey', 'oauth', 'recovery')),
    CONSTRAINT chk_auth_credentials_secret CHECK (
        credential_type <> 'password'
        OR secret_hash IS NOT NULL
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_credentials_active_identifier
    ON iam.auth_credentials(credential_type, identifier)
    WHERE identifier IS NOT NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_credentials_active_password
    ON iam.auth_credentials(principal_id)
    WHERE credential_type = 'password' AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_auth_credentials_principal ON iam.auth_credentials(principal_id);

DROP TRIGGER IF EXISTS set_auth_credentials_updated_at ON iam.auth_credentials;
CREATE TRIGGER set_auth_credentials_updated_at
BEFORE UPDATE ON iam.auth_credentials
FOR EACH ROW
EXECUTE FUNCTION iam.set_updated_at();

CREATE TABLE IF NOT EXISTS iam.device_installations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    principal_id UUID NOT NULL REFERENCES iam.principals(id) ON DELETE CASCADE,
    installation_identifier_hash TEXT NOT NULL,
    device_public_key TEXT,
    platform TEXT NOT NULL DEFAULT 'unknown',
    app_instance_id TEXT,
    app_version TEXT,
    device_label TEXT,
    push_token_hash TEXT,
    attestation_provider TEXT,
    attestation_subject TEXT,
    attestation_verified_at TIMESTAMPTZ,
    trusted_until TIMESTAMPTZ,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_device_installations_platform CHECK (platform IN ('android', 'ios', 'web', 'unknown'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_device_installations_identifier_hash
    ON iam.device_installations(installation_identifier_hash)
    WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_device_installations_principal ON iam.device_installations(principal_id);
CREATE INDEX IF NOT EXISTS idx_device_installations_last_seen ON iam.device_installations(last_seen_at DESC);

DROP TRIGGER IF EXISTS set_device_installations_updated_at ON iam.device_installations;
CREATE TRIGGER set_device_installations_updated_at
BEFORE UPDATE ON iam.device_installations
FOR EACH ROW
EXECUTE FUNCTION iam.set_updated_at();

CREATE TABLE IF NOT EXISTS iam.auth_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_session_id TEXT,
    principal_id UUID NOT NULL REFERENCES iam.principals(id) ON DELETE CASCADE,
    device_installation_id UUID REFERENCES iam.device_installations(id) ON DELETE SET NULL,
    session_family_id UUID NOT NULL DEFAULT gen_random_uuid(),
    refresh_token_hash TEXT NOT NULL,
    previous_refresh_token_hash TEXT,
    user_agent TEXT,
    ip_addr INET,
    expires_at TIMESTAMPTZ NOT NULL,
    rotated_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_sessions_refresh_token_hash
    ON iam.auth_sessions(refresh_token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_sessions_legacy_session_id
    ON iam.auth_sessions(legacy_session_id)
    WHERE legacy_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auth_sessions_principal ON iam.auth_sessions(principal_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_family ON iam.auth_sessions(session_family_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_active
    ON iam.auth_sessions(principal_id, expires_at)
    WHERE revoked_at IS NULL;

DROP TRIGGER IF EXISTS set_auth_sessions_updated_at ON iam.auth_sessions;
CREATE TRIGGER set_auth_sessions_updated_at
BEFORE UPDATE ON iam.auth_sessions
FOR EACH ROW
EXECUTE FUNCTION iam.set_updated_at();

CREATE TABLE IF NOT EXISTS iam.roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role_scope TEXT NOT NULL DEFAULT 'app',
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_roles_scope CHECK (role_scope IN ('app', 'admin', 'system'))
);

DROP TRIGGER IF EXISTS set_roles_updated_at ON iam.roles;
CREATE TRIGGER set_roles_updated_at
BEFORE UPDATE ON iam.roles
FOR EACH ROW
EXECUTE FUNCTION iam.set_updated_at();

CREATE TABLE IF NOT EXISTS iam.permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS iam.role_permissions (
    role_id UUID NOT NULL REFERENCES iam.roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES iam.permissions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS iam.principal_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    principal_id UUID NOT NULL REFERENCES iam.principals(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES iam.roles(id) ON DELETE RESTRICT,
    granted_by_principal_id UUID REFERENCES iam.principals(id) ON DELETE SET NULL,
    active_period TSTZRANGE NOT NULL DEFAULT TSTZRANGE(NOW(), NULL, '[)'),
    revoked_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_principal_roles_period CHECK (NOT ISEMPTY(active_period)),
    CONSTRAINT ex_principal_roles_no_overlap EXCLUDE USING gist (
        principal_id WITH =,
        role_id WITH =,
        active_period WITH &&
    ) WHERE (revoked_at IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_principal_roles_principal ON iam.principal_roles(principal_id);
CREATE INDEX IF NOT EXISTS idx_principal_roles_role ON iam.principal_roles(role_id);

CREATE TABLE IF NOT EXISTS audit.events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_principal_id UUID REFERENCES iam.principals(id) ON DELETE SET NULL,
    subject_principal_id UUID REFERENCES iam.principals(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    event_source TEXT NOT NULL DEFAULT 'backend',
    ip_addr INET,
    user_agent TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB
);
CREATE INDEX IF NOT EXISTS idx_audit_events_occurred_at ON audit.events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit.events(actor_principal_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_subject ON audit.events(subject_principal_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_type ON audit.events(event_type);

INSERT INTO iam.roles(code, display_name, role_scope, description)
VALUES
    ('guest', 'Guest', 'app', 'Temporary app identity with trial-only access.'),
    ('app_user', 'Application User', 'app', 'Registered user identity for calls and contacts.'),
    ('super_admin', 'Super Admin', 'admin', 'Control-plane administrator with all admin permissions.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.permissions(code, description)
VALUES
    ('call:create_link', 'Create calls that can be joined by code or link.'),
    ('call:join_link', 'Join calls by code or link.'),
    ('call:voice', 'Use voice calling.'),
    ('call:video', 'Use video calling.'),
    ('contacts:read', 'Read accepted contacts.'),
    ('contacts:write', 'Create and manage contact relationships.'),
    ('admin:*', 'Full control-plane access.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
JOIN iam.permissions p ON p.code IN ('call:create_link', 'call:join_link', 'call:voice')
WHERE r.code = 'guest'
ON CONFLICT DO NOTHING;

INSERT INTO iam.role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
JOIN iam.permissions p ON p.code IN (
    'call:create_link',
    'call:join_link',
    'call:voice',
    'call:video',
    'contacts:read',
    'contacts:write'
)
WHERE r.code = 'app_user'
ON CONFLICT DO NOTHING;

INSERT INTO iam.role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
JOIN iam.permissions p ON p.code = 'admin:*'
WHERE r.code = 'super_admin'
ON CONFLICT DO NOTHING;
