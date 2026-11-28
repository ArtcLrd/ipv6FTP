-- Atomic production flows for IAM, RBAC, auth sessions, contacts, and calls.
-- The Go API keeps hashing/token generation outside PostgreSQL, while these
-- functions own multi-table consistency.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

ALTER TABLE iam.principals
    ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE iam.user_accounts
    ADD COLUMN IF NOT EXISTS email CITEXT,
    ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_accounts_email
    ON iam.user_accounts(email)
    WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS iam.federated_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    principal_id UUID NOT NULL REFERENCES iam.principals(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_subject TEXT NOT NULL,
    email CITEXT,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    CONSTRAINT uq_federated_identity_provider_subject UNIQUE(provider, provider_subject)
);
CREATE INDEX IF NOT EXISTS idx_federated_identities_principal
    ON iam.federated_identities(principal_id);

CREATE TABLE IF NOT EXISTS iam.principal_aliases (
    alias_principal_id UUID PRIMARY KEY REFERENCES iam.principals(id) ON DELETE CASCADE,
    canonical_principal_id UUID NOT NULL REFERENCES iam.principals(id) ON DELETE CASCADE,
    alias_reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_principal_aliases_not_self CHECK (alias_principal_id <> canonical_principal_id)
);
CREATE INDEX IF NOT EXISTS idx_principal_aliases_canonical
    ON iam.principal_aliases(canonical_principal_id);

ALTER TABLE iam.auth_sessions
    ADD COLUMN IF NOT EXISTS refresh_token_hint TEXT,
    ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS iam.refresh_token_reuse_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    principal_id UUID REFERENCES iam.principals(id) ON DELETE SET NULL,
    session_family_id UUID,
    refresh_token_hash TEXT NOT NULL,
    ip_addr INET,
    user_agent TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_reuse_events_principal
    ON iam.refresh_token_reuse_events(principal_id, occurred_at DESC);

ALTER TABLE communication.call_participants
    ADD COLUMN IF NOT EXISTS plan_version_id UUID REFERENCES catalog.plan_versions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS policy_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
    ADD COLUMN IF NOT EXISTS allowed_seconds INTEGER,
    ADD COLUMN IF NOT EXISTS enforcement_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION iam.current_plan_for_user(p_user_principal_id UUID)
RETURNS TABLE(plan_version_id UUID, plan_code TEXT)
LANGUAGE sql
STABLE
SET search_path = catalog, iam, public
AS $$
    SELECT pv.id, p.code
    FROM catalog.user_plan_assignments upa
    JOIN catalog.plan_versions pv ON pv.id = upa.plan_version_id
    JOIN catalog.plans p ON p.id = pv.plan_id
    WHERE upa.user_principal_id = p_user_principal_id
      AND upa.revoked_at IS NULL
      AND upa.active_period @> NOW()
    ORDER BY LOWER(upa.active_period) DESC
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION iam.authorization_context(p_principal_id UUID)
RETURNS TABLE(
    principal_id UUID,
    username TEXT,
    account_type TEXT,
    principal_status TEXT,
    auth_version INTEGER,
    role_codes TEXT[],
    permission_codes TEXT[],
    plan_code TEXT,
    trial_expires_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SET search_path = iam, catalog, public
AS $$
    WITH roles AS (
        SELECT ARRAY_AGG(DISTINCT r.code ORDER BY r.code) AS role_codes
        FROM iam.principal_roles pr
        JOIN iam.roles r ON r.id = pr.role_id
        WHERE pr.principal_id = p_principal_id
          AND pr.revoked_at IS NULL
          AND pr.active_period @> NOW()
    ),
    permissions AS (
        SELECT ARRAY_AGG(DISTINCT p.code ORDER BY p.code) AS permission_codes
        FROM iam.principal_roles pr
        JOIN iam.roles r ON r.id = pr.role_id
        JOIN iam.role_permissions rp ON rp.role_id = r.id
        JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE pr.principal_id = p_principal_id
          AND pr.revoked_at IS NULL
          AND pr.active_period @> NOW()
    ),
    current_plan AS (
        SELECT cp.plan_code
        FROM iam.current_plan_for_user(p_principal_id) cp
        LIMIT 1
    )
    SELECT
        p.id,
        ua.username::TEXT,
        ua.account_type,
        p.status,
        p.auth_version,
        COALESCE(roles.role_codes, ARRAY[]::TEXT[]),
        COALESCE(permissions.permission_codes, ARRAY[]::TEXT[]),
        COALESCE(current_plan.plan_code, 'trial'),
        ua.trial_expires_at
    FROM iam.principals p
    JOIN iam.user_accounts ua ON ua.principal_id = p.id
    LEFT JOIN roles ON TRUE
    LEFT JOIN permissions ON TRUE
    LEFT JOIN current_plan ON TRUE
    WHERE p.id = COALESCE((SELECT canonical_principal_id FROM iam.principal_aliases WHERE alias_principal_id = p_principal_id), p_principal_id);
$$;

CREATE OR REPLACE FUNCTION iam.create_guest_identity(
    p_installation_identifier_hash TEXT,
    p_device_public_key TEXT DEFAULT NULL,
    p_platform TEXT DEFAULT 'unknown',
    p_app_instance_id TEXT DEFAULT NULL,
    p_ip_addr INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS TABLE(
    principal_id UUID,
    device_installation_id UUID,
    username TEXT,
    account_type TEXT,
    role_code TEXT,
    plan_code TEXT,
    trial_expires_at TIMESTAMPTZ,
    auth_version INTEGER
)
LANGUAGE plpgsql
SET search_path = iam, catalog, audit, public
AS $$
DECLARE
    existing_device iam.device_installations%ROWTYPE;
    existing_account_type TEXT;
    new_principal_id UUID;
    guest_role_id UUID;
    trial_plan_version_id UUID;
BEGIN
    SELECT * INTO existing_device
    FROM iam.device_installations d
    WHERE d.installation_identifier_hash = p_installation_identifier_hash
      AND d.revoked_at IS NULL
    LIMIT 1;

    IF FOUND THEN
        SELECT account_type INTO existing_account_type
        FROM iam.user_accounts
        WHERE principal_id = existing_device.principal_id;

        IF existing_account_type = 'registered' THEN
            INSERT INTO iam.principals(principal_type, status)
            VALUES ('user', 'active')
            RETURNING id INTO new_principal_id;

            INSERT INTO iam.user_accounts(
                principal_id,
                account_type,
                trial_started_at,
                trial_expires_at
            )
            VALUES (
                new_principal_id,
                'guest',
                existing_device.first_seen_at,
                existing_device.first_seen_at + INTERVAL '7 days'
            );

            UPDATE iam.device_installations d
            SET principal_id = new_principal_id,
                device_public_key = COALESCE(p_device_public_key, d.device_public_key),
                platform = COALESCE(NULLIF(p_platform, ''), d.platform),
                app_instance_id = COALESCE(p_app_instance_id, d.app_instance_id),
                last_seen_at = NOW()
            WHERE d.id = existing_device.id;

            SELECT id INTO guest_role_id FROM iam.roles WHERE code = 'guest';
            INSERT INTO iam.principal_roles(principal_id, role_id)
            VALUES (new_principal_id, guest_role_id);

            SELECT pv.id INTO trial_plan_version_id
            FROM catalog.plan_versions pv
            JOIN catalog.plans p ON p.id = pv.plan_id
            WHERE p.code = 'trial' AND pv.is_current = TRUE
            LIMIT 1;

            INSERT INTO catalog.user_plan_assignments(user_principal_id, plan_version_id, active_period, assignment_reason)
            VALUES (new_principal_id, trial_plan_version_id, TSTZRANGE(NOW(), NULL, '[)'), 'trial');

            INSERT INTO audit.events(actor_principal_id, subject_principal_id, event_type, ip_addr, user_agent)
            VALUES (new_principal_id, new_principal_id, 'iam.guest_returned_after_logout', p_ip_addr, p_user_agent);

            RETURN QUERY
            SELECT c.principal_id, existing_device.id, c.username, c.account_type, COALESCE(c.role_codes[1], 'guest'), c.plan_code, c.trial_expires_at, c.auth_version
            FROM iam.authorization_context(new_principal_id) c;
            RETURN;
        END IF;

        UPDATE iam.device_installations d
        SET device_public_key = COALESCE(p_device_public_key, d.device_public_key),
            platform = COALESCE(NULLIF(p_platform, ''), d.platform),
            app_instance_id = COALESCE(p_app_instance_id, d.app_instance_id),
            last_seen_at = NOW()
        WHERE d.id = existing_device.id;

        RETURN QUERY
        SELECT c.principal_id, existing_device.id, c.username, c.account_type, COALESCE(c.role_codes[1], 'guest'), c.plan_code, c.trial_expires_at, c.auth_version
        FROM iam.authorization_context(existing_device.principal_id) c;
        RETURN;
    END IF;

    INSERT INTO iam.principals(principal_type, status)
    VALUES ('user', 'active')
    RETURNING id INTO new_principal_id;

    INSERT INTO iam.user_accounts(principal_id, account_type)
    VALUES (new_principal_id, 'guest');

    INSERT INTO iam.device_installations(
        principal_id,
        installation_identifier_hash,
        device_public_key,
        platform,
        app_instance_id
    )
    VALUES (
        new_principal_id,
        p_installation_identifier_hash,
        p_device_public_key,
        COALESCE(NULLIF(p_platform, ''), 'unknown'),
        p_app_instance_id
    )
    RETURNING id INTO device_installation_id;

    SELECT id INTO guest_role_id FROM iam.roles WHERE code = 'guest';
    INSERT INTO iam.principal_roles(principal_id, role_id)
    VALUES (new_principal_id, guest_role_id);

    SELECT cp.plan_version_id INTO trial_plan_version_id
    FROM catalog.plan_versions pv
    JOIN catalog.plans p ON p.id = pv.plan_id
    CROSS JOIN LATERAL (SELECT pv.id AS plan_version_id) cp
    WHERE p.code = 'trial' AND pv.is_current = TRUE
    LIMIT 1;

    INSERT INTO catalog.user_plan_assignments(user_principal_id, plan_version_id, active_period, assignment_reason)
    VALUES (new_principal_id, trial_plan_version_id, TSTZRANGE(NOW(), NULL, '[)'), 'trial');

    INSERT INTO audit.events(actor_principal_id, subject_principal_id, event_type, ip_addr, user_agent)
    VALUES (new_principal_id, new_principal_id, 'iam.guest_created', p_ip_addr, p_user_agent);

    RETURN QUERY
    SELECT c.principal_id, device_installation_id, c.username, c.account_type, COALESCE(c.role_codes[1], 'guest'), c.plan_code, c.trial_expires_at, c.auth_version
    FROM iam.authorization_context(new_principal_id) c;
END;
$$;

CREATE OR REPLACE FUNCTION iam.convert_guest_to_registered(
    p_guest_principal_id UUID,
    p_username CITEXT,
    p_email CITEXT,
    p_password_hash TEXT,
    p_ip_addr INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS TABLE(
    principal_id UUID,
    username TEXT,
    account_type TEXT,
    role_code TEXT,
    plan_code TEXT,
    trial_expires_at TIMESTAMPTZ,
    auth_version INTEGER
)
LANGUAGE plpgsql
SET search_path = iam, catalog, audit, public
AS $$
DECLARE
    target_principal_id UUID;
    app_user_role_id UUID;
    free_plan_version_id UUID;
BEGIN
    IF p_guest_principal_id IS NOT NULL THEN
        SELECT ua.principal_id INTO target_principal_id
        FROM iam.user_accounts ua
        JOIN iam.principals p ON p.id = ua.principal_id
        WHERE ua.principal_id = p_guest_principal_id
          AND ua.account_type = 'guest'
          AND p.status = 'active'
        FOR UPDATE;
    END IF;

    IF target_principal_id IS NULL THEN
        INSERT INTO iam.principals(principal_type, status)
        VALUES ('user', 'active')
        RETURNING id INTO target_principal_id;

        INSERT INTO iam.user_accounts(principal_id, account_type, username, email, display_name, registered_at, trial_expires_at)
        VALUES (target_principal_id, 'registered', p_username, p_email, p_username::TEXT, NOW(), NOW());
    ELSE
        UPDATE iam.user_accounts
        SET account_type = 'registered',
            username = p_username,
            email = p_email,
            display_name = p_username::TEXT,
            registered_at = NOW(),
            converted_from_guest_at = NOW()
        WHERE iam.user_accounts.principal_id = target_principal_id;
    END IF;

    INSERT INTO iam.auth_credentials(principal_id, credential_type, identifier, secret_hash, verified_at)
    VALUES (target_principal_id, 'password', p_username, p_password_hash, NOW());

    SELECT id INTO app_user_role_id FROM iam.roles WHERE code = 'app_user';
    INSERT INTO iam.principal_roles(principal_id, role_id)
    VALUES (target_principal_id, app_user_role_id)
    ON CONFLICT DO NOTHING;

    UPDATE iam.principal_roles pr
    SET revoked_at = NOW()
    FROM iam.roles r
    WHERE pr.role_id = r.id
      AND r.code = 'guest'
      AND pr.principal_id = target_principal_id
      AND pr.revoked_at IS NULL;

    SELECT pv.id INTO free_plan_version_id
    FROM catalog.plan_versions pv
    JOIN catalog.plans p ON p.id = pv.plan_id
    WHERE p.code = 'free' AND pv.is_current = TRUE
    LIMIT 1;

    UPDATE catalog.user_plan_assignments
    SET revoked_at = NOW()
    WHERE catalog.user_plan_assignments.user_principal_id = target_principal_id
      AND catalog.user_plan_assignments.revoked_at IS NULL;

    INSERT INTO catalog.user_plan_assignments(user_principal_id, plan_version_id, active_period, assignment_reason)
    VALUES (target_principal_id, free_plan_version_id, TSTZRANGE(NOW(), NULL, '[)'), 'registration');

    UPDATE iam.principals
    SET auth_version = iam.principals.auth_version + 1
    WHERE iam.principals.id = target_principal_id;

    INSERT INTO audit.events(actor_principal_id, subject_principal_id, event_type, ip_addr, user_agent)
    VALUES (target_principal_id, target_principal_id, 'iam.user_registered', p_ip_addr, p_user_agent);

    RETURN QUERY
    SELECT c.principal_id, c.username, c.account_type, 'app_user', c.plan_code, c.trial_expires_at, c.auth_version
    FROM iam.authorization_context(target_principal_id) c;
END;
$$;

CREATE OR REPLACE FUNCTION iam.merge_guest_into_registered(
    p_guest_principal_id UUID,
    p_registered_principal_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = iam, catalog, communication, audit, public
AS $$
BEGIN
    IF p_guest_principal_id IS NULL OR p_guest_principal_id = p_registered_principal_id THEN
        RETURN;
    END IF;

    UPDATE iam.device_installations
    SET principal_id = p_registered_principal_id
    WHERE principal_id = p_guest_principal_id
      AND revoked_at IS NULL;

    UPDATE communication.device_presence
    SET user_principal_id = p_registered_principal_id
    WHERE user_principal_id = p_guest_principal_id;

    UPDATE communication.call_participants
    SET user_principal_id = p_registered_principal_id
    WHERE user_principal_id = p_guest_principal_id;

    INSERT INTO iam.principal_aliases(alias_principal_id, canonical_principal_id, alias_reason)
    VALUES (p_guest_principal_id, p_registered_principal_id, 'guest_login_merge')
    ON CONFLICT (alias_principal_id) DO UPDATE
    SET canonical_principal_id = EXCLUDED.canonical_principal_id,
        alias_reason = EXCLUDED.alias_reason;

    UPDATE iam.principals
    SET status = 'deleted',
        auth_version = iam.principals.auth_version + 1
    WHERE iam.principals.id = p_guest_principal_id;

    UPDATE iam.principals
    SET auth_version = iam.principals.auth_version + 1
    WHERE iam.principals.id = p_registered_principal_id;
END;
$$;

CREATE OR REPLACE FUNCTION iam.create_auth_session(
    p_principal_id UUID,
    p_device_installation_id UUID,
    p_refresh_token_hash TEXT,
    p_refresh_token_hint TEXT,
    p_user_agent TEXT,
    p_ip_addr INET,
    p_expires_at TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = iam, audit, public
AS $$
DECLARE
    new_session_id UUID;
BEGIN
    INSERT INTO iam.auth_sessions(
        principal_id,
        device_installation_id,
        refresh_token_hash,
        refresh_token_hint,
        user_agent,
        ip_addr,
        expires_at
    )
    VALUES (
        p_principal_id,
        p_device_installation_id,
        p_refresh_token_hash,
        p_refresh_token_hint,
        p_user_agent,
        p_ip_addr,
        p_expires_at
    )
    RETURNING id INTO new_session_id;

    INSERT INTO audit.events(actor_principal_id, subject_principal_id, event_type, ip_addr, user_agent)
    VALUES (p_principal_id, p_principal_id, 'iam.session_created', p_ip_addr, p_user_agent);

    RETURN new_session_id;
END;
$$;

CREATE OR REPLACE FUNCTION iam.rotate_refresh_token(
    p_old_refresh_token_hash TEXT,
    p_new_refresh_token_hash TEXT,
    p_refresh_token_hint TEXT,
    p_user_agent TEXT,
    p_ip_addr INET,
    p_expires_at TIMESTAMPTZ
)
RETURNS TABLE(principal_id UUID, session_id UUID)
LANGUAGE plpgsql
SET search_path = iam, audit, public
AS $$
DECLARE
    old_session iam.auth_sessions%ROWTYPE;
    new_session_id UUID;
BEGIN
    SELECT * INTO old_session
    FROM iam.auth_sessions
    WHERE refresh_token_hash = p_old_refresh_token_hash
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    IF old_session.revoked_at IS NOT NULL OR old_session.consumed_at IS NOT NULL OR old_session.expires_at <= NOW() THEN
        UPDATE iam.auth_sessions
        SET revoked_at = COALESCE(revoked_at, NOW())
        WHERE session_family_id = old_session.session_family_id
          AND revoked_at IS NULL;

        INSERT INTO iam.refresh_token_reuse_events(
            principal_id,
            session_family_id,
            refresh_token_hash,
            ip_addr,
            user_agent
        )
        VALUES (
            old_session.principal_id,
            old_session.session_family_id,
            p_old_refresh_token_hash,
            p_ip_addr,
            p_user_agent
        );
        RETURN;
    END IF;

    UPDATE iam.auth_sessions
    SET consumed_at = NOW(),
        rotated_at = NOW()
    WHERE id = old_session.id;

    INSERT INTO iam.auth_sessions(
        principal_id,
        device_installation_id,
        session_family_id,
        refresh_token_hash,
        previous_refresh_token_hash,
        refresh_token_hint,
        user_agent,
        ip_addr,
        expires_at
    )
    VALUES (
        old_session.principal_id,
        old_session.device_installation_id,
        old_session.session_family_id,
        p_new_refresh_token_hash,
        p_old_refresh_token_hash,
        p_refresh_token_hint,
        p_user_agent,
        p_ip_addr,
        p_expires_at
    )
    RETURNING id INTO new_session_id;

    RETURN QUERY SELECT old_session.principal_id, new_session_id;
END;
$$;

CREATE OR REPLACE FUNCTION iam.revoke_all_sessions(p_principal_id UUID)
RETURNS VOID
LANGUAGE sql
SET search_path = iam, public
AS $$
    UPDATE iam.auth_sessions
    SET revoked_at = COALESCE(revoked_at, NOW())
    WHERE principal_id = p_principal_id
      AND revoked_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION communication.resolve_call_policy(
    p_user_principal_id UUID,
    p_media_type TEXT,
    p_network_family TEXT
)
RETURNS TABLE(
    plan_version_id UUID,
    plan_code TEXT,
    policy_mode TEXT,
    per_call_limit_seconds INTEGER,
    period_limit_seconds INTEGER,
    period_unit TEXT,
    is_draft BOOLEAN
)
LANGUAGE sql
STABLE
SET search_path = communication, catalog, iam, public
AS $$
    SELECT
        cp.plan_version_id,
        cp.plan_code,
        COALESCE(pcp.policy_mode, 'blocked'),
        pcp.per_call_limit_seconds,
        pcp.period_limit_seconds,
        pcp.period_unit,
        COALESCE(pcp.is_draft, FALSE)
    FROM iam.current_plan_for_user(p_user_principal_id) cp
    LEFT JOIN catalog.plan_call_policies pcp
      ON pcp.plan_version_id = cp.plan_version_id
     AND pcp.media_type = p_media_type
     AND pcp.network_family = p_network_family
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION communication.create_call_session(
    p_creator_principal_id UUID,
    p_device_installation_id UUID,
    p_join_code_hash TEXT,
    p_join_link_token_hash TEXT,
    p_media_type TEXT,
    p_network_family TEXT,
    p_quota_enforcement_enabled BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(
    call_session_id UUID,
    participant_id UUID,
    policy_mode TEXT,
    allowed_seconds INTEGER
)
LANGUAGE plpgsql
SET search_path = communication, catalog, iam, audit, public
AS $$
DECLARE
    policy RECORD;
BEGIN
    SELECT * INTO policy
    FROM communication.resolve_call_policy(p_creator_principal_id, p_media_type, p_network_family);

    IF policy.policy_mode IS NULL OR policy.policy_mode = 'blocked' THEN
        RAISE EXCEPTION 'call feature is not available for this account'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    INSERT INTO communication.call_sessions(
        created_by_principal_id,
        join_code_hash,
        join_link_token_hash,
        media_type,
        network_family
    )
    VALUES (
        p_creator_principal_id,
        p_join_code_hash,
        p_join_link_token_hash,
        p_media_type,
        p_network_family
    )
    RETURNING id INTO call_session_id;

    INSERT INTO communication.call_participants(
        call_session_id,
        user_principal_id,
        device_installation_id,
        participant_role,
        plan_version_id,
        policy_snapshot,
        allowed_seconds,
        enforcement_enabled
    )
    VALUES (
        call_session_id,
        p_creator_principal_id,
        p_device_installation_id,
        'creator',
        policy.plan_version_id,
        TO_JSONB(policy),
        policy.per_call_limit_seconds,
        p_quota_enforcement_enabled AND NOT policy.is_draft AND policy.policy_mode = 'capped'
    )
    RETURNING id INTO participant_id;

    RETURN QUERY SELECT call_session_id, participant_id, policy.policy_mode::TEXT, policy.per_call_limit_seconds;
END;
$$;

CREATE OR REPLACE FUNCTION communication.end_call_session(
    p_call_session_id UUID,
    p_ended_reason TEXT DEFAULT 'normal'
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = communication, public
AS $$
BEGIN
    UPDATE communication.call_sessions
    SET call_status = 'ended',
        ended_at = COALESCE(ended_at, NOW()),
        ended_reason = COALESCE(p_ended_reason, 'normal')
    WHERE id = p_call_session_id
      AND call_status <> 'ended';

    UPDATE communication.call_participants
    SET left_at = COALESCE(left_at, NOW()),
        disconnect_reason = COALESCE(p_ended_reason, 'normal')
    WHERE call_session_id = p_call_session_id
      AND left_at IS NULL;
END;
$$;
