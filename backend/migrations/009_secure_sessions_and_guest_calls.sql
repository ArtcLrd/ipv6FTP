-- Secure API-facing session and guest call flows.
-- PostgreSQL remains authoritative; Redis is used by the Go API for hot
-- presence, tickets, and short-lived counters.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS api;
CREATE SCHEMA IF NOT EXISTS app_private;

ALTER TABLE communication.call_sessions
    ADD COLUMN IF NOT EXISTS invitation_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS accept_deadline_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS communication.call_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_session_id UUID NOT NULL REFERENCES communication.call_sessions(id) ON DELETE CASCADE,
    created_by_principal_id UUID NOT NULL REFERENCES iam.user_accounts(principal_id) ON DELETE CASCADE,
    accepted_by_principal_id UUID REFERENCES iam.user_accounts(principal_id) ON DELETE SET NULL,
    link_token_hash TEXT NOT NULL,
    fallback_code_hash TEXT NOT NULL,
    fallback_code_hint TEXT NOT NULL,
    invitation_status TEXT NOT NULL DEFAULT 'active',
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
    accepted_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_call_invitations_status CHECK (
        invitation_status IN ('active', 'accepted', 'cancelled', 'expired')
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_call_invitations_link_token_hash
    ON communication.call_invitations(link_token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_call_invitations_fallback_code_hash
    ON communication.call_invitations(fallback_code_hash);
CREATE INDEX IF NOT EXISTS idx_call_invitations_call
    ON communication.call_invitations(call_session_id);
CREATE INDEX IF NOT EXISTS idx_call_invitations_active_expires
    ON communication.call_invitations(expires_at)
    WHERE invitation_status = 'active';

DROP TRIGGER IF EXISTS set_call_invitations_updated_at ON communication.call_invitations;
CREATE TRIGGER set_call_invitations_updated_at
BEFORE UPDATE ON communication.call_invitations
FOR EACH ROW
EXECUTE FUNCTION communication.set_updated_at();

UPDATE catalog.plan_call_policies pcp
SET policy_mode = 'blocked',
    per_call_limit_seconds = NULL,
    period_limit_seconds = NULL,
    period_unit = NULL,
    is_draft = FALSE,
    metadata = '{"reason":"Guests cannot use IPv4 relay/fallback paths."}'::JSONB
FROM catalog.plan_versions pv
JOIN catalog.plans p ON p.id = pv.plan_id
WHERE pcp.plan_version_id = pv.id
  AND p.code = 'trial'
  AND pcp.network_family = 'ipv4';

UPDATE catalog.plan_call_policies pcp
SET policy_mode = 'capped',
    per_call_limit_seconds = 1800,
    period_limit_seconds = 3600,
    period_unit = 'day',
    is_draft = FALSE,
    metadata = '{"note":"Trial guest IPv6 direct calling: 60 minutes/day, 30 minutes/call."}'::JSONB
FROM catalog.plan_versions pv
JOIN catalog.plans p ON p.id = pv.plan_id
WHERE pcp.plan_version_id = pv.id
  AND p.code = 'trial'
  AND pcp.media_type = 'voice'
  AND pcp.network_family = 'ipv6';

UPDATE catalog.plan_call_policies pcp
SET policy_mode = 'blocked',
    per_call_limit_seconds = NULL,
    period_limit_seconds = NULL,
    period_unit = NULL,
    is_draft = FALSE,
    metadata = '{"reason":"Trial guests start with voice-only IPv6 calls."}'::JSONB
FROM catalog.plan_versions pv
JOIN catalog.plans p ON p.id = pv.plan_id
WHERE pcp.plan_version_id = pv.id
  AND p.code = 'trial'
  AND pcp.media_type = 'video';

CREATE OR REPLACE FUNCTION app_private.is_global_ipv6(p_ip_addr INET)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
    SELECT p_ip_addr IS NOT NULL
       AND family(p_ip_addr) = 6
       AND NOT (p_ip_addr <<= '::1/128'::inet)
       AND NOT (p_ip_addr <<= 'fc00::/7'::inet)
       AND NOT (p_ip_addr <<= 'fe80::/10'::inet);
$$;

CREATE OR REPLACE FUNCTION iam.attach_device_to_principal(
    p_principal_id UUID,
    p_installation_identifier_hash TEXT,
    p_device_public_key TEXT DEFAULT NULL,
    p_platform TEXT DEFAULT 'unknown',
    p_app_instance_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, iam
AS $$
DECLARE
    existing_device_id UUID;
BEGIN
    IF p_installation_identifier_hash IS NULL OR btrim(p_installation_identifier_hash) = '' THEN
        RETURN NULL;
    END IF;

    SELECT d.id INTO existing_device_id
    FROM iam.device_installations d
    WHERE d.installation_identifier_hash = p_installation_identifier_hash
      AND d.revoked_at IS NULL
    FOR UPDATE;

    IF existing_device_id IS NOT NULL THEN
        UPDATE iam.device_installations
        SET principal_id = p_principal_id,
            device_public_key = COALESCE(NULLIF(p_device_public_key, ''), device_public_key),
            platform = COALESCE(NULLIF(p_platform, ''), platform),
            app_instance_id = COALESCE(NULLIF(p_app_instance_id, ''), app_instance_id),
            last_seen_at = NOW()
        WHERE id = existing_device_id;
        RETURN existing_device_id;
    END IF;

    INSERT INTO iam.device_installations(
        principal_id,
        installation_identifier_hash,
        device_public_key,
        platform,
        app_instance_id
    )
    VALUES (
        p_principal_id,
        p_installation_identifier_hash,
        NULLIF(p_device_public_key, ''),
        COALESCE(NULLIF(p_platform, ''), 'unknown'),
        NULLIF(p_app_instance_id, '')
    )
    RETURNING id INTO existing_device_id;

    RETURN existing_device_id;
END;
$$;

CREATE OR REPLACE FUNCTION iam.revoke_auth_session(
    p_principal_id UUID,
    p_session_id UUID
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, iam
AS $$
    UPDATE iam.auth_sessions
    SET revoked_at = COALESCE(revoked_at, NOW())
    WHERE principal_id = p_principal_id
      AND id = p_session_id
      AND revoked_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION iam.validate_auth_session(
    p_principal_id UUID,
    p_session_id UUID,
    p_device_installation_id UUID,
    p_auth_version INTEGER
)
RETURNS TABLE(
    principal_id UUID,
    session_id UUID,
    device_installation_id UUID,
    principal_status TEXT,
    account_type TEXT,
    auth_version INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, iam
AS $$
    SELECT p.id,
           s.id,
           s.device_installation_id,
           p.status,
           ua.account_type,
           p.auth_version
    FROM iam.auth_sessions s
    JOIN iam.principals p ON p.id = s.principal_id
    JOIN iam.user_accounts ua ON ua.principal_id = p.id
    WHERE s.id = p_session_id
      AND s.principal_id = p_principal_id
      AND (p_device_installation_id IS NULL OR s.device_installation_id = p_device_installation_id)
      AND s.revoked_at IS NULL
      AND s.consumed_at IS NULL
      AND s.expires_at > NOW()
      AND p.status = 'active'
      AND p.auth_version = p_auth_version;
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
    used_seconds INTEGER;
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
    IF account.account_type = 'guest' AND account.trial_expires_at <= NOW() THEN
        RAISE EXCEPTION 'guest trial has expired' USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT * INTO policy
    FROM communication.resolve_call_policy(p_creator_principal_id, p_media_type, p_network_family);

    IF policy.policy_mode IS NULL OR policy.policy_mode = 'blocked' THEN
        RAISE EXCEPTION 'call feature is not available for this account' USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF policy.period_limit_seconds IS NOT NULL AND policy.period_unit = 'day' THEN
        SELECT COALESCE(SUM(duration_seconds), 0)::INTEGER INTO used_seconds
        FROM communication.call_usage_ledger
        WHERE user_principal_id = p_creator_principal_id
          AND media_type = p_media_type
          AND network_family = p_network_family
          AND usage_started_at >= date_trunc('day', NOW());

        IF used_seconds >= policy.period_limit_seconds THEN
            RAISE EXCEPTION 'daily call allowance exhausted' USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    SELECT created.call_session_id, created.participant_id, created.policy_mode, created.allowed_seconds
    INTO call_session_id, participant_id, policy_mode, allowed_seconds
    FROM communication.create_call_session(
        p_creator_principal_id,
        p_device_installation_id,
        p_fallback_code_hash,
        p_link_token_hash,
        p_media_type,
        p_network_family,
        TRUE
    ) AS created;

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
    IF account.account_type = 'guest' AND account.trial_expires_at <= NOW() THEN
        RAISE EXCEPTION 'guest trial has expired' USING ERRCODE = 'insufficient_privilege';
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
        policy.per_call_limit_seconds,
        NOT policy.is_draft AND policy.policy_mode = 'capped'
    )
    RETURNING id INTO participant_id;

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
    allowed_seconds := policy.per_call_limit_seconds;
    RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION api.start_call_session(
    p_call_session_id UUID,
    p_principal_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, api, communication
AS $$
BEGIN
    UPDATE communication.call_participants
    SET joined_at = COALESCE(joined_at, NOW())
    WHERE call_session_id = p_call_session_id
      AND user_principal_id = p_principal_id
      AND left_at IS NULL;

    UPDATE communication.call_sessions
    SET call_status = 'active',
        started_at = COALESCE(started_at, NOW())
    WHERE id = p_call_session_id
      AND call_status IN ('created', 'ringing', 'active');
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
            GREATEST(EXTRACT(EPOCH FROM (COALESCE(participant.left_at, finished_at) - participant.joined_at))::INTEGER, 0),
            'server_reconciliation'
        )
        ON CONFLICT (idempotency_key) DO NOTHING;
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION api.get_call_usage_today(p_user_principal_id UUID)
RETURNS TABLE(
    media_type TEXT,
    network_family TEXT,
    duration_seconds BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, api, communication
AS $$
    SELECT media_type,
           network_family,
           COALESCE(SUM(duration_seconds), 0)::BIGINT
    FROM communication.call_usage_ledger
    WHERE user_principal_id = p_user_principal_id
      AND usage_started_at >= date_trunc('day', NOW())
    GROUP BY media_type, network_family;
$$;

ALTER FUNCTION iam.create_guest_identity(TEXT, TEXT, TEXT, TEXT, INET, TEXT) SECURITY DEFINER;
ALTER FUNCTION iam.convert_guest_to_registered(UUID, CITEXT, CITEXT, TEXT, INET, TEXT) SECURITY DEFINER;
ALTER FUNCTION iam.merge_guest_into_registered(UUID, UUID) SECURITY DEFINER;
ALTER FUNCTION iam.create_auth_session(UUID, UUID, TEXT, TEXT, TEXT, INET, TIMESTAMPTZ) SECURITY DEFINER;
ALTER FUNCTION iam.rotate_refresh_token(TEXT, TEXT, TEXT, TEXT, INET, TIMESTAMPTZ) SECURITY DEFINER;
ALTER FUNCTION iam.revoke_all_sessions(UUID) SECURITY DEFINER;
ALTER FUNCTION iam.authorization_context(UUID) SECURITY DEFINER;
ALTER FUNCTION iam.current_plan_for_user(UUID) SECURITY DEFINER;
ALTER FUNCTION communication.resolve_call_policy(UUID, TEXT, TEXT) SECURITY DEFINER;
ALTER FUNCTION communication.create_call_session(UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN) SECURITY DEFINER;
ALTER FUNCTION communication.end_call_session(UUID, TEXT) SECURITY DEFINER;

REVOKE ALL ON SCHEMA iam, catalog, communication, audit, api, app_private FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA iam, catalog, communication, audit FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA iam, catalog, communication, audit, api, app_private FROM PUBLIC;

DO $$
BEGIN
    IF to_regrole('ipv6ftp_api') IS NOT NULL THEN
        GRANT USAGE ON SCHEMA api TO ipv6ftp_api;
        GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA api TO ipv6ftp_api;
        GRANT EXECUTE ON FUNCTION iam.create_guest_identity(TEXT, TEXT, TEXT, TEXT, INET, TEXT) TO ipv6ftp_api;
        GRANT EXECUTE ON FUNCTION iam.convert_guest_to_registered(UUID, CITEXT, CITEXT, TEXT, INET, TEXT) TO ipv6ftp_api;
        GRANT EXECUTE ON FUNCTION iam.merge_guest_into_registered(UUID, UUID) TO ipv6ftp_api;
        GRANT EXECUTE ON FUNCTION iam.create_auth_session(UUID, UUID, TEXT, TEXT, TEXT, INET, TIMESTAMPTZ) TO ipv6ftp_api;
        GRANT EXECUTE ON FUNCTION iam.rotate_refresh_token(TEXT, TEXT, TEXT, TEXT, INET, TIMESTAMPTZ) TO ipv6ftp_api;
        GRANT EXECUTE ON FUNCTION iam.revoke_auth_session(UUID, UUID) TO ipv6ftp_api;
        GRANT EXECUTE ON FUNCTION iam.validate_auth_session(UUID, UUID, UUID, INTEGER) TO ipv6ftp_api;
        GRANT EXECUTE ON FUNCTION iam.authorization_context(UUID) TO ipv6ftp_api;
        GRANT EXECUTE ON FUNCTION iam.attach_device_to_principal(UUID, TEXT, TEXT, TEXT, TEXT) TO ipv6ftp_api;
    END IF;
END $$;
