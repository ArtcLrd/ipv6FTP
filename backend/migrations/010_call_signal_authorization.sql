-- Authorization helper for authenticated native call signaling.

CREATE OR REPLACE FUNCTION api.authorize_call_signal(
    p_call_session_id UUID,
    p_principal_id UUID
)
RETURNS TABLE(
    call_session_id UUID,
    participant_id UUID,
    media_type TEXT,
    network_family TEXT,
    call_status TEXT,
    allowed_seconds INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, api, communication
AS $$
    SELECT cs.id,
           cp.id,
           cs.media_type,
           cs.network_family,
           cs.call_status,
           cp.allowed_seconds
    FROM communication.call_sessions cs
    JOIN communication.call_participants cp ON cp.call_session_id = cs.id
    WHERE cs.id = p_call_session_id
      AND cp.user_principal_id = p_principal_id
      AND cp.left_at IS NULL
      AND cs.call_status IN ('created', 'ringing', 'active');
$$;

DO $$
BEGIN
    IF to_regrole('ipv6ftp_api') IS NOT NULL THEN
        GRANT EXECUTE ON FUNCTION api.authorize_call_signal(UUID, UUID) TO ipv6ftp_api;
    END IF;
END $$;
