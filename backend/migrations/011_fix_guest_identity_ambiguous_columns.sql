-- Qualify PL/pgSQL output-variable names in iam.create_guest_identity.
-- The existing-device path selected account_type / principal_id without a
-- table alias, which is ambiguous against the RETURNS TABLE columns.

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
SECURITY DEFINER
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
        SELECT ua.account_type
        INTO existing_account_type
        FROM iam.user_accounts AS ua
        WHERE ua.principal_id = existing_device.principal_id;

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

DO $$
BEGIN
    IF to_regrole('ipv6ftp_api') IS NOT NULL THEN
        GRANT EXECUTE ON FUNCTION iam.create_guest_identity(TEXT, TEXT, TEXT, TEXT, INET, TEXT) TO ipv6ftp_api;
    END IF;
END $$;
