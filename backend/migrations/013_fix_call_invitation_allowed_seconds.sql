-- Fix PL/pgSQL output-variable qualification in api.create_call_invitation.

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
    v_allowed_seconds INTEGER;
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

        SELECT COALESCE(SUM(l.duration_seconds), 0)::INTEGER INTO used_seconds
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

        v_allowed_seconds := LEAST(COALESCE(policy.per_call_limit_seconds, remaining_seconds), remaining_seconds);
    ELSE
        v_allowed_seconds := policy.per_call_limit_seconds;
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
    SET allowed_seconds = v_allowed_seconds
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
            v_allowed_seconds,
            NOW() + INTERVAL '15 minutes'
        );
    END IF;

    allowed_seconds := v_allowed_seconds;
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

DO $$
BEGIN
    IF to_regrole('ipv6ftp_api') IS NOT NULL THEN
        GRANT EXECUTE ON FUNCTION api.create_call_invitation(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INET) TO ipv6ftp_api;
    END IF;
END $$;
