-- Registered account ACL, quota policy, and guest conversion prompts.
-- This migration keeps IAM/catalog/communication as the canonical runtime model.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE SCHEMA IF NOT EXISTS api;

ALTER TABLE catalog.plan_call_policies
    ADD COLUMN IF NOT EXISTS quota_pool_key TEXT;

CREATE TABLE IF NOT EXISTS api.conversion_prompt_policies (
    code TEXT PRIMARY KEY,
    trigger_type TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    trigger_delay INTERVAL NOT NULL DEFAULT '0 seconds',
    snooze_duration INTERVAL NOT NULL DEFAULT '7 days',
    eligible_account_type TEXT,
    eligible_plan_code TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_conversion_prompt_trigger CHECK (trigger_type IN ('quota_exhausted', 'weekly_benefits', 'restricted_feature')),
    CONSTRAINT chk_conversion_prompt_account CHECK (eligible_account_type IS NULL OR eligible_account_type IN ('guest', 'registered'))
);

DROP TRIGGER IF EXISTS set_conversion_prompt_policies_updated_at ON api.conversion_prompt_policies;
CREATE TRIGGER set_conversion_prompt_policies_updated_at
BEFORE UPDATE ON api.conversion_prompt_policies
FOR EACH ROW
EXECUTE FUNCTION iam.set_updated_at();

CREATE TABLE IF NOT EXISTS api.principal_prompt_states (
    principal_id UUID NOT NULL REFERENCES iam.principals(id) ON DELETE CASCADE,
    prompt_code TEXT NOT NULL REFERENCES api.conversion_prompt_policies(code) ON DELETE CASCADE,
    trigger_period_key TEXT NOT NULL DEFAULT 'default',
    last_shown_at TIMESTAMPTZ,
    last_action TEXT,
    dismissed_at TIMESTAMPTZ,
    snoozed_until TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (principal_id, prompt_code, trigger_period_key),
    CONSTRAINT chk_principal_prompt_action CHECK (
        last_action IS NULL OR last_action IN ('shown', 'snoozed', 'dismissed', 'signup', 'signin')
    )
);

DROP TRIGGER IF EXISTS set_principal_prompt_states_updated_at ON api.principal_prompt_states;
CREATE TRIGGER set_principal_prompt_states_updated_at
BEFORE UPDATE ON api.principal_prompt_states
FOR EACH ROW
EXECUTE FUNCTION iam.set_updated_at();

CREATE TABLE IF NOT EXISTS communication.call_time_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_session_id UUID NOT NULL REFERENCES communication.call_sessions(id) ON DELETE CASCADE,
    participant_id UUID NOT NULL REFERENCES communication.call_participants(id) ON DELETE CASCADE,
    user_principal_id UUID NOT NULL REFERENCES iam.user_accounts(principal_id) ON DELETE CASCADE,
    plan_version_id UUID REFERENCES catalog.plan_versions(id) ON DELETE SET NULL,
    quota_pool_key TEXT,
    media_type TEXT NOT NULL,
    network_family TEXT NOT NULL,
    period_start_at TIMESTAMPTZ,
    period_end_at TIMESTAMPTZ,
    reserved_seconds INTEGER NOT NULL,
    finalized_seconds INTEGER NOT NULL DEFAULT 0,
    reservation_status TEXT NOT NULL DEFAULT 'active',
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_call_time_reservation_seconds CHECK (reserved_seconds >= 0 AND finalized_seconds >= 0),
    CONSTRAINT chk_call_time_reservation_status CHECK (reservation_status IN ('active', 'released', 'finalized', 'expired'))
);
CREATE INDEX IF NOT EXISTS idx_call_time_reservations_user_period
    ON communication.call_time_reservations(user_principal_id, period_start_at, period_end_at)
    WHERE reservation_status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS uq_call_time_reservations_participant
    ON communication.call_time_reservations(participant_id);

DROP TRIGGER IF EXISTS set_call_time_reservations_updated_at ON communication.call_time_reservations;
CREATE TRIGGER set_call_time_reservations_updated_at
BEFORE UPDATE ON communication.call_time_reservations
FOR EACH ROW
EXECUTE FUNCTION communication.set_updated_at();

INSERT INTO api.conversion_prompt_policies(code, trigger_type, enabled, trigger_delay, snooze_duration, eligible_account_type, eligible_plan_code, metadata)
VALUES
    ('guest_quota_exhausted', 'quota_exhausted', TRUE, '0 seconds', '1 day', 'guest', 'trial', '{"copy":"Guests can continue after the next quota reset. Registered accounts unlock unlimited IPv6 calls."}'::JSONB),
    ('guest_weekly_benefits', 'weekly_benefits', TRUE, '7 days', '7 days', 'guest', 'trial', '{"copy":"Soft reminder after the first completed guest call."}'::JSONB),
    ('guest_restricted_feature', 'restricted_feature', TRUE, '0 seconds', '7 days', 'guest', 'trial', '{"copy":"Registered-only feature prompt."}'::JSONB)
ON CONFLICT (code) DO UPDATE
SET trigger_type = EXCLUDED.trigger_type,
    enabled = EXCLUDED.enabled,
    trigger_delay = EXCLUDED.trigger_delay,
    snooze_duration = EXCLUDED.snooze_duration,
    eligible_account_type = EXCLUDED.eligible_account_type,
    eligible_plan_code = EXCLUDED.eligible_plan_code,
    metadata = EXCLUDED.metadata;

INSERT INTO iam.permissions(code, description)
VALUES
    ('profile:read', 'Read the current profile.'),
    ('profile:update', 'Update the current profile.'),
    ('users:search', 'Search registered users.'),
    ('contacts:read', 'Read contacts.'),
    ('contacts:write', 'Manage contacts.'),
    ('presence:read', 'Read presence and phonebook data.'),
    ('presence:write', 'Update presence and phonebook data.'),
    ('events:read', 'Read realtime event streams.'),
    ('turn:read', 'Fetch TURN credentials.'),
    ('rooms:create', 'Create signaling rooms.'),
    ('rooms:invite', 'Invite contacts to rooms.'),
    ('calls:create', 'Create calls.'),
    ('calls:join', 'Join calls.'),
    ('calls:signal', 'Use call signaling.'),
    ('calls:update_state', 'Start or end calls.'),
    ('calls:read_usage', 'Read call usage.'),
    ('prompts:read', 'Read conversion prompts.'),
    ('prompts:write', 'Record conversion prompt actions.'),
    ('devices:read', 'Read own devices.'),
    ('devices:revoke', 'Revoke own devices.'),
    ('auth:logout', 'Logout sessions.'),
    ('admin:lockdown', 'Manage service lockdown.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO iam.role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
JOIN iam.permissions p ON p.code IN (
    'profile:read',
    'presence:write',
    'turn:read',
    'calls:create',
    'calls:join',
    'calls:signal',
    'calls:update_state',
    'calls:read_usage',
    'prompts:read',
    'prompts:write',
    'auth:logout'
)
WHERE r.code = 'guest'
ON CONFLICT DO NOTHING;

INSERT INTO iam.role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
JOIN iam.permissions p ON p.code IN (
    'profile:read',
    'profile:update',
    'users:search',
    'contacts:read',
    'contacts:write',
    'presence:read',
    'presence:write',
    'events:read',
    'turn:read',
    'rooms:create',
    'rooms:invite',
    'calls:create',
    'calls:join',
    'calls:signal',
    'calls:update_state',
    'calls:read_usage',
    'prompts:read',
    'prompts:write',
    'devices:read',
    'devices:revoke',
    'auth:logout'
)
WHERE r.code = 'app_user'
ON CONFLICT DO NOTHING;

INSERT INTO iam.role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM iam.roles r
CROSS JOIN iam.permissions p
WHERE r.code = 'super_admin'
ON CONFLICT DO NOTHING;

UPDATE catalog.plan_call_policies pcp
SET policy_mode = 'unlimited',
    per_call_limit_seconds = NULL,
    period_limit_seconds = NULL,
    period_unit = NULL,
    quota_pool_key = NULL,
    is_draft = FALSE,
    metadata = '{"note":"Registered free IPv6 calling is unlimited."}'::JSONB
FROM catalog.plan_versions pv
JOIN catalog.plans p ON p.id = pv.plan_id
WHERE pcp.plan_version_id = pv.id
  AND p.code = 'free'
  AND pcp.network_family = 'ipv6';

UPDATE catalog.plan_call_policies pcp
SET policy_mode = 'capped',
    per_call_limit_seconds = NULL,
    period_limit_seconds = 1800,
    period_unit = 'day',
    quota_pool_key = 'free_ipv4_daily',
    is_draft = FALSE,
    metadata = '{"note":"Registered free IPv4 voice and video share 1800 seconds per UTC day."}'::JSONB
FROM catalog.plan_versions pv
JOIN catalog.plans p ON p.id = pv.plan_id
WHERE pcp.plan_version_id = pv.id
  AND p.code = 'free'
  AND pcp.network_family = 'ipv4';

UPDATE catalog.plan_call_policies pcp
SET quota_pool_key = 'trial_ipv6_voice_daily'
FROM catalog.plan_versions pv
JOIN catalog.plans p ON p.id = pv.plan_id
WHERE pcp.plan_version_id = pv.id
  AND p.code = 'trial'
  AND pcp.media_type = 'voice'
  AND pcp.network_family = 'ipv6'
  AND pcp.period_unit = 'day';

CREATE OR REPLACE FUNCTION api.utc_period_start(p_now TIMESTAMPTZ)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
    SELECT date_trunc('day', p_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
$$;

CREATE OR REPLACE FUNCTION api.pending_prompts_json(p_principal_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, api, iam, catalog, communication
AS $$
    WITH profile AS (
        SELECT c.principal_id, c.account_type, c.plan_code
        FROM iam.authorization_context(p_principal_id) c
    ),
    first_call AS (
        SELECT MIN(usage_ended_at) AS first_completed_at
        FROM communication.call_usage_ledger
        WHERE user_principal_id = p_principal_id
    ),
    due AS (
        SELECT
            pol.code,
            CASE pol.code
                WHEN 'guest_weekly_benefits' THEN 'weekly_benefits_reminder'
                ELSE pol.trigger_type
            END AS reason,
            'first_completed_call' AS trigger_period_key,
            EXTRACT(EPOCH FROM pol.snooze_duration)::INTEGER AS snooze_duration_seconds,
            (first_call.first_completed_at + pol.trigger_delay) AS due_at
        FROM api.conversion_prompt_policies pol
        CROSS JOIN profile
        CROSS JOIN first_call
        LEFT JOIN api.principal_prompt_states st
          ON st.principal_id = profile.principal_id
         AND st.prompt_code = pol.code
         AND st.trigger_period_key = 'first_completed_call'
        WHERE pol.enabled
          AND pol.code = 'guest_weekly_benefits'
          AND profile.account_type = 'guest'
          AND first_call.first_completed_at IS NOT NULL
          AND first_call.first_completed_at + pol.trigger_delay <= NOW()
          AND (pol.eligible_account_type IS NULL OR pol.eligible_account_type = profile.account_type)
          AND (pol.eligible_plan_code IS NULL OR pol.eligible_plan_code = profile.plan_code)
          AND (st.snoozed_until IS NULL OR st.snoozed_until <= NOW())
    )
    SELECT COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
        'code', code,
        'reason', reason,
        'trigger_period_key', trigger_period_key,
        'snooze_duration_seconds', snooze_duration_seconds,
        'due_at', due_at
    ) ORDER BY due_at), '[]'::JSONB)
    FROM due;
$$;

CREATE OR REPLACE VIEW api.user_profiles AS
WITH role_data AS (
    SELECT pr.principal_id, ARRAY_AGG(DISTINCT r.code ORDER BY r.code) AS role_codes
    FROM iam.principal_roles pr
    JOIN iam.roles r ON r.id = pr.role_id
    WHERE pr.revoked_at IS NULL
      AND pr.active_period @> NOW()
    GROUP BY pr.principal_id
),
permission_data AS (
    SELECT pr.principal_id, ARRAY_AGG(DISTINCT p.code ORDER BY p.code) AS permission_codes
    FROM iam.principal_roles pr
    JOIN iam.roles r ON r.id = pr.role_id
    JOIN iam.role_permissions rp ON rp.role_id = r.id
    JOIN iam.permissions p ON p.id = rp.permission_id
    WHERE pr.revoked_at IS NULL
      AND pr.active_period @> NOW()
    GROUP BY pr.principal_id
),
plan_data AS (
    SELECT upa.user_principal_id,
           pl.code AS plan_code,
           pv.id AS plan_version_id
    FROM catalog.user_plan_assignments upa
    JOIN catalog.plan_versions pv ON pv.id = upa.plan_version_id
    JOIN catalog.plans pl ON pl.id = pv.plan_id
    WHERE upa.revoked_at IS NULL
      AND upa.active_period @> NOW()
),
capability_data AS (
    SELECT pd.user_principal_id,
           COALESCE(JSONB_OBJECT_AGG(pe.feature_code, JSONB_BUILD_OBJECT(
               'enabled', pe.is_enabled,
               'value', pe.entitlement_value
           )), '{}'::JSONB) AS capabilities
    FROM plan_data pd
    LEFT JOIN catalog.plan_entitlements pe ON pe.plan_version_id = pd.plan_version_id
    GROUP BY pd.user_principal_id
)
SELECT
    p.id AS principal_id,
    COALESCE(ua.username::TEXT, '') AS username,
    ua.account_type,
    p.status AS principal_status,
    p.auth_version,
    COALESCE(rd.role_codes, ARRAY[]::TEXT[]) AS role_codes,
    COALESCE(pm.permission_codes, ARRAY[]::TEXT[]) AS permission_codes,
    COALESCE(pd.plan_code, 'trial') AS plan_code,
    ua.trial_expires_at,
    COALESCE(cd.capabilities, '{}'::JSONB) AS capabilities
FROM iam.principals p
JOIN iam.user_accounts ua ON ua.principal_id = p.id
LEFT JOIN role_data rd ON rd.principal_id = p.id
LEFT JOIN permission_data pm ON pm.principal_id = p.id
LEFT JOIN plan_data pd ON pd.user_principal_id = p.id
LEFT JOIN capability_data cd ON cd.user_principal_id = p.id;

CREATE OR REPLACE FUNCTION api.record_prompt_action(
    p_principal_id UUID,
    p_prompt_code TEXT,
    p_trigger_period_key TEXT,
    p_action TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, api
AS $$
DECLARE
    policy api.conversion_prompt_policies%ROWTYPE;
    period_key TEXT := COALESCE(NULLIF(p_trigger_period_key, ''), 'default');
    snooze_until TIMESTAMPTZ;
BEGIN
    SELECT * INTO policy
    FROM api.conversion_prompt_policies
    WHERE code = p_prompt_code
      AND enabled = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'prompt policy not found' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF p_action IN ('snoozed', 'dismissed') THEN
        snooze_until := NOW() + policy.snooze_duration;
    END IF;

    INSERT INTO api.principal_prompt_states(
        principal_id,
        prompt_code,
        trigger_period_key,
        last_shown_at,
        last_action,
        dismissed_at,
        snoozed_until
    )
    VALUES (
        p_principal_id,
        p_prompt_code,
        period_key,
        CASE WHEN p_action = 'shown' THEN NOW() ELSE NULL END,
        p_action,
        CASE WHEN p_action IN ('snoozed', 'dismissed') THEN NOW() ELSE NULL END,
        snooze_until
    )
    ON CONFLICT (principal_id, prompt_code, trigger_period_key) DO UPDATE
    SET last_shown_at = CASE WHEN p_action = 'shown' THEN NOW() ELSE api.principal_prompt_states.last_shown_at END,
        last_action = p_action,
        dismissed_at = CASE WHEN p_action IN ('snoozed', 'dismissed') THEN NOW() ELSE api.principal_prompt_states.dismissed_at END,
        snoozed_until = COALESCE(snooze_until, api.principal_prompt_states.snoozed_until),
        updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION api.raise_quota_exhausted(p_reset_at TIMESTAMPTZ, p_prompt_code TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'quota_exhausted|reset_at=%|prompt=%', p_reset_at, p_prompt_code
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE OR REPLACE FUNCTION api.create_call_invitation(
    p_creator_principal_id UUID,
    p_device_installation_id UUID,
    p_link_token_hash TEXT,
    p_fallback_code_hash TEXT,
    p_fallback_code_hint TEXT,
    p_media_type TEXT DEFAULT 'voice',
    p_network_family TEXT DEFAULT 'ipv6',
    p_observed_ip INET DEFAULT NULL
)
RETURNS TABLE(
    call_session_id UUID,
    participant_id UUID,
    invitation_id UUID,
    policy_mode TEXT,
    allowed_seconds INTEGER,
    expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, api, communication, catalog, iam, app_private
AS $$
DECLARE
    account iam.user_accounts%ROWTYPE;
    policy RECORD;
    policy_quota_pool_key TEXT;
    used_seconds INTEGER := 0;
    reserved_seconds INTEGER := 0;
    remaining_seconds INTEGER;
    period_start TIMESTAMPTZ;
    period_end TIMESTAMPTZ;
    prompt_code TEXT;
BEGIN
    SELECT * INTO account
    FROM iam.user_accounts
    WHERE principal_id = p_creator_principal_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'account not found' USING ERRCODE = 'invalid_authorization_specification';
    END IF;
    IF account.account_type = 'guest' AND (p_network_family <> 'ipv6' OR NOT app_private.is_global_ipv6(p_observed_ip)) THEN
        RAISE EXCEPTION 'guest calls require a global IPv6 connection' USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT * INTO policy
    FROM communication.resolve_call_policy(p_creator_principal_id, p_media_type, p_network_family);

    IF policy.policy_mode IS NULL OR policy.policy_mode = 'blocked' THEN
        RAISE EXCEPTION 'call feature is not available for this account' USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT pcp.quota_pool_key INTO policy_quota_pool_key
    FROM catalog.plan_call_policies pcp
    WHERE pcp.plan_version_id = policy.plan_version_id
      AND pcp.media_type = p_media_type
      AND pcp.network_family = p_network_family
    LIMIT 1;

    IF policy.period_limit_seconds IS NOT NULL AND policy.period_unit = 'day' THEN
        period_start := api.utc_period_start(NOW());
        period_end := period_start + INTERVAL '1 day';

        SELECT COALESCE(SUM(duration_seconds), 0)::INTEGER INTO used_seconds
        FROM communication.call_usage_ledger l
        WHERE l.user_principal_id = p_creator_principal_id
          AND l.usage_started_at >= period_start
          AND l.usage_started_at < period_end
          AND (
              (policy_quota_pool_key IS NOT NULL AND l.network_family = p_network_family)
              OR
              (policy_quota_pool_key IS NULL AND l.media_type = p_media_type AND l.network_family = p_network_family)
          );

        SELECT COALESCE(SUM(r.reserved_seconds), 0)::INTEGER INTO reserved_seconds
        FROM communication.call_time_reservations r
        WHERE r.user_principal_id = p_creator_principal_id
          AND r.reservation_status = 'active'
          AND r.expires_at > NOW()
          AND r.period_start_at = period_start
          AND (
              (policy_quota_pool_key IS NOT NULL AND r.quota_pool_key = policy_quota_pool_key)
              OR
              (policy_quota_pool_key IS NULL AND r.media_type = p_media_type AND r.network_family = p_network_family)
          );

        remaining_seconds := policy.period_limit_seconds - used_seconds - reserved_seconds;
        IF remaining_seconds <= 0 THEN
            prompt_code := CASE WHEN account.account_type = 'guest' THEN 'guest_quota_exhausted' ELSE NULL END;
            PERFORM api.raise_quota_exhausted(period_end, prompt_code);
        END IF;

        allowed_seconds := LEAST(COALESCE(policy.per_call_limit_seconds, remaining_seconds), remaining_seconds);
    ELSE
        allowed_seconds := policy.per_call_limit_seconds;
    END IF;

    SELECT created.call_session_id, created.participant_id, created.policy_mode
    INTO call_session_id, participant_id, policy_mode
    FROM communication.create_call_session(
        p_creator_principal_id,
        p_device_installation_id,
        p_fallback_code_hash,
        p_link_token_hash,
        p_media_type,
        p_network_family,
        TRUE
    ) AS created;

    UPDATE communication.call_participants cp
    SET allowed_seconds = api.create_call_invitation.allowed_seconds
    WHERE cp.id = participant_id;

    IF policy.period_limit_seconds IS NOT NULL AND policy.period_unit = 'day' THEN
        INSERT INTO communication.call_time_reservations(
            call_session_id,
            participant_id,
            user_principal_id,
            plan_version_id,
            quota_pool_key,
            media_type,
            network_family,
            period_start_at,
            period_end_at,
            reserved_seconds,
            expires_at
        )
        VALUES (
            call_session_id,
            participant_id,
            p_creator_principal_id,
            policy.plan_version_id,
            policy_quota_pool_key,
            p_media_type,
            p_network_family,
            period_start,
            period_end,
            allowed_seconds,
            NOW() + INTERVAL '15 minutes'
        );
    END IF;

    expires_at := NOW() + INTERVAL '10 minutes';

    INSERT INTO communication.call_invitations(
        call_session_id,
        created_by_principal_id,
        link_token_hash,
        fallback_code_hash,
        fallback_code_hint,
        expires_at
    )
    VALUES (
        call_session_id,
        p_creator_principal_id,
        p_link_token_hash,
        p_fallback_code_hash,
        p_fallback_code_hint,
        expires_at
    )
    RETURNING id INTO invitation_id;

    UPDATE communication.call_sessions
    SET invitation_expires_at = expires_at,
        accept_deadline_at = NOW() + INTERVAL '30 seconds'
    WHERE id = call_session_id;

    RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION api.accept_call_invitation(
    p_joiner_principal_id UUID,
    p_device_installation_id UUID,
    p_token_hash TEXT,
    p_observed_ip INET DEFAULT NULL
)
RETURNS TABLE(
    call_session_id UUID,
    participant_id UUID,
    media_type TEXT,
    network_family TEXT,
    policy_mode TEXT,
    allowed_seconds INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, api, communication, catalog, iam, app_private
AS $$
DECLARE
    invite communication.call_invitations%ROWTYPE;
    call_row communication.call_sessions%ROWTYPE;
    account iam.user_accounts%ROWTYPE;
    participant_count INTEGER;
    policy RECORD;
    policy_quota_pool_key TEXT;
    used_seconds INTEGER := 0;
    reserved_seconds INTEGER := 0;
    remaining_seconds INTEGER;
    period_start TIMESTAMPTZ;
    period_end TIMESTAMPTZ;
    prompt_code TEXT;
BEGIN
    SELECT * INTO invite
    FROM communication.call_invitations
    WHERE invitation_status = 'active'
      AND expires_at > NOW()
      AND (link_token_hash = p_token_hash OR fallback_code_hash = p_token_hash)
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'call invitation is invalid or expired' USING ERRCODE = 'invalid_authorization_specification';
    END IF;

    SELECT * INTO call_row
    FROM communication.call_sessions
    WHERE id = invite.call_session_id
    FOR UPDATE;

    SELECT * INTO account
    FROM iam.user_accounts
    WHERE principal_id = p_joiner_principal_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'account not found' USING ERRCODE = 'invalid_authorization_specification';
    END IF;
    IF account.account_type = 'guest' AND (call_row.network_family <> 'ipv6' OR NOT app_private.is_global_ipv6(p_observed_ip)) THEN
        RAISE EXCEPTION 'guest calls require a global IPv6 connection' USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT COUNT(*) INTO participant_count
    FROM communication.call_participants
    WHERE call_session_id = invite.call_session_id
      AND left_at IS NULL;

    IF participant_count >= 2 THEN
        RAISE EXCEPTION 'call already has two active participants' USING ERRCODE = 'too_many_connections';
    END IF;

    SELECT * INTO policy
    FROM communication.resolve_call_policy(p_joiner_principal_id, call_row.media_type, call_row.network_family);

    IF policy.policy_mode IS NULL OR policy.policy_mode = 'blocked' THEN
        RAISE EXCEPTION 'call feature is not available for this account' USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT pcp.quota_pool_key INTO policy_quota_pool_key
    FROM catalog.plan_call_policies pcp
    WHERE pcp.plan_version_id = policy.plan_version_id
      AND pcp.media_type = call_row.media_type
      AND pcp.network_family = call_row.network_family
    LIMIT 1;

    IF policy.period_limit_seconds IS NOT NULL AND policy.period_unit = 'day' THEN
        period_start := api.utc_period_start(NOW());
        period_end := period_start + INTERVAL '1 day';

        SELECT COALESCE(SUM(duration_seconds), 0)::INTEGER INTO used_seconds
        FROM communication.call_usage_ledger l
        WHERE l.user_principal_id = p_joiner_principal_id
          AND l.usage_started_at >= period_start
          AND l.usage_started_at < period_end
          AND (
              (policy_quota_pool_key IS NOT NULL AND l.network_family = call_row.network_family)
              OR
              (policy_quota_pool_key IS NULL AND l.media_type = call_row.media_type AND l.network_family = call_row.network_family)
          );

        SELECT COALESCE(SUM(r.reserved_seconds), 0)::INTEGER INTO reserved_seconds
        FROM communication.call_time_reservations r
        WHERE r.user_principal_id = p_joiner_principal_id
          AND r.reservation_status = 'active'
          AND r.expires_at > NOW()
          AND r.period_start_at = period_start
          AND (
              (policy_quota_pool_key IS NOT NULL AND r.quota_pool_key = policy_quota_pool_key)
              OR
              (policy_quota_pool_key IS NULL AND r.media_type = call_row.media_type AND r.network_family = call_row.network_family)
          );

        remaining_seconds := policy.period_limit_seconds - used_seconds - reserved_seconds;
        IF remaining_seconds <= 0 THEN
            prompt_code := CASE WHEN account.account_type = 'guest' THEN 'guest_quota_exhausted' ELSE NULL END;
            PERFORM api.raise_quota_exhausted(period_end, prompt_code);
        END IF;

        allowed_seconds := LEAST(COALESCE(policy.per_call_limit_seconds, remaining_seconds), remaining_seconds);
    ELSE
        allowed_seconds := policy.per_call_limit_seconds;
    END IF;

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
        invite.call_session_id,
        p_joiner_principal_id,
        p_device_installation_id,
        'participant',
        policy.plan_version_id,
        TO_JSONB(policy),
        allowed_seconds,
        NOT policy.is_draft AND policy.policy_mode = 'capped'
    )
    RETURNING id INTO participant_id;

    IF policy.period_limit_seconds IS NOT NULL AND policy.period_unit = 'day' THEN
        INSERT INTO communication.call_time_reservations(
            call_session_id,
            participant_id,
            user_principal_id,
            plan_version_id,
            quota_pool_key,
            media_type,
            network_family,
            period_start_at,
            period_end_at,
            reserved_seconds,
            expires_at
        )
        VALUES (
            invite.call_session_id,
            participant_id,
            p_joiner_principal_id,
            policy.plan_version_id,
            policy_quota_pool_key,
            call_row.media_type,
            call_row.network_family,
            period_start,
            period_end,
            allowed_seconds,
            NOW() + INTERVAL '15 minutes'
        );
    END IF;

    UPDATE communication.call_invitations
    SET invitation_status = 'accepted',
        accepted_by_principal_id = p_joiner_principal_id,
        accepted_at = NOW()
    WHERE id = invite.id;

    UPDATE communication.call_sessions
    SET call_status = 'ringing',
        accepted_at = NOW()
    WHERE id = invite.call_session_id;

    call_session_id := invite.call_session_id;
    media_type := call_row.media_type;
    network_family := call_row.network_family;
    policy_mode := policy.policy_mode;
    RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION api.end_call_session(
    p_call_session_id UUID,
    p_principal_id UUID,
    p_reason TEXT DEFAULT 'normal'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, api, communication
AS $$
DECLARE
    call_row communication.call_sessions%ROWTYPE;
    participant RECORD;
    finished_at TIMESTAMPTZ := NOW();
    actual_seconds INTEGER;
BEGIN
    SELECT * INTO call_row
    FROM communication.call_sessions
    WHERE id = p_call_session_id
      AND EXISTS (
          SELECT 1
          FROM communication.call_participants cp
          WHERE cp.call_session_id = p_call_session_id
            AND cp.user_principal_id = p_principal_id
      )
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    UPDATE communication.call_sessions
    SET call_status = 'ended',
        ended_at = COALESCE(ended_at, finished_at),
        ended_reason = COALESCE(NULLIF(p_reason, ''), 'normal')
    WHERE id = p_call_session_id
      AND call_status <> 'ended';

    UPDATE communication.call_participants
    SET left_at = COALESCE(left_at, finished_at),
        disconnect_reason = COALESCE(NULLIF(p_reason, ''), 'normal')
    WHERE call_session_id = p_call_session_id
      AND left_at IS NULL;

    FOR participant IN
        SELECT *
        FROM communication.call_participants
        WHERE call_session_id = p_call_session_id
          AND user_principal_id IS NOT NULL
          AND joined_at IS NOT NULL
    LOOP
        actual_seconds := GREATEST(EXTRACT(EPOCH FROM (COALESCE(participant.left_at, finished_at) - participant.joined_at))::INTEGER, 0);

        INSERT INTO communication.call_usage_ledger(
            idempotency_key,
            call_session_id,
            user_principal_id,
            plan_version_id,
            media_type,
            network_family,
            usage_started_at,
            usage_ended_at,
            duration_seconds,
            usage_source
        )
        VALUES (
            p_call_session_id::TEXT || ':' || participant.id::TEXT,
            p_call_session_id,
            participant.user_principal_id,
            participant.plan_version_id,
            call_row.media_type,
            call_row.network_family,
            participant.joined_at,
            COALESCE(participant.left_at, finished_at),
            actual_seconds,
            'server_reconciliation'
        )
        ON CONFLICT (idempotency_key) DO NOTHING;

        UPDATE communication.call_time_reservations r
        SET reservation_status = 'finalized',
            finalized_seconds = LEAST(actual_seconds, r.reserved_seconds)
        WHERE r.participant_id = participant.id
          AND r.reservation_status = 'active';
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION api.expire_stale_call_reservations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, communication
AS $$
DECLARE
    affected INTEGER;
BEGIN
    UPDATE communication.call_time_reservations
    SET reservation_status = 'expired'
    WHERE reservation_status = 'active'
      AND expires_at <= NOW();
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;

ALTER FUNCTION api.pending_prompts_json(UUID) SECURITY DEFINER;
ALTER FUNCTION api.record_prompt_action(UUID, TEXT, TEXT, TEXT) SECURITY DEFINER;
ALTER FUNCTION api.create_call_invitation(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INET) SECURITY DEFINER;
ALTER FUNCTION api.accept_call_invitation(UUID, UUID, TEXT, INET) SECURITY DEFINER;
ALTER FUNCTION api.end_call_session(UUID, UUID, TEXT) SECURITY DEFINER;

DO $$
BEGIN
    IF to_regrole('ipv6ftp_api') IS NOT NULL THEN
        GRANT USAGE ON SCHEMA api TO ipv6ftp_api;
        GRANT EXECUTE ON FUNCTION api.pending_prompts_json(UUID) TO ipv6ftp_api;
        GRANT EXECUTE ON FUNCTION api.record_prompt_action(UUID, TEXT, TEXT, TEXT) TO ipv6ftp_api;
        GRANT EXECUTE ON FUNCTION api.expire_stale_call_reservations() TO ipv6ftp_api;
        GRANT SELECT ON api.user_profiles TO ipv6ftp_api;
        GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA api TO ipv6ftp_api;
    END IF;
END $$;
