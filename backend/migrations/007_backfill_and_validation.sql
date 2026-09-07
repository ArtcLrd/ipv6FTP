-- Data-preserving backfill from the legacy public tables into the production
-- IAM/catalog/communication schemas. This file is intentionally additive.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS iam.legacy_admin_links (
    legacy_user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    admin_principal_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO iam.principals(id, principal_type, status, created_at, updated_at)
SELECT u.id, 'user', 'active', u.created_at, u.updated_at
FROM public.users u
ON CONFLICT (id) DO NOTHING;

INSERT INTO iam.user_accounts(
    principal_id,
    account_type,
    username,
    display_name,
    trial_started_at,
    trial_expires_at,
    registered_at,
    metadata,
    created_at,
    updated_at
)
SELECT
    u.id,
    'registered',
    u.username,
    u.username,
    u.created_at,
    u.created_at,
    u.created_at,
    JSONB_BUILD_OBJECT('legacy_role', u.role, 'legacy_status', u.status),
    u.created_at,
    u.updated_at
FROM public.users u
ON CONFLICT (principal_id) DO NOTHING;

INSERT INTO iam.auth_credentials(
    principal_id,
    credential_type,
    identifier,
    secret_hash,
    verified_at,
    metadata,
    created_at,
    updated_at
)
SELECT
    u.id,
    'password',
    u.username,
    u.password_hash,
    u.created_at,
    JSONB_BUILD_OBJECT('source', 'legacy_users'),
    u.created_at,
    u.updated_at
FROM public.users u
WHERE NOT EXISTS (
    SELECT 1
    FROM iam.auth_credentials c
    WHERE c.principal_id = u.id
      AND c.credential_type = 'password'
      AND c.revoked_at IS NULL
);

INSERT INTO iam.legacy_admin_links(legacy_user_id)
SELECT u.id
FROM public.users u
WHERE u.role = 'admin'
ON CONFLICT (legacy_user_id) DO NOTHING;

INSERT INTO iam.principals(id, principal_type, status)
SELECT l.admin_principal_id, 'admin', 'active'
FROM iam.legacy_admin_links l
ON CONFLICT (id) DO NOTHING;

INSERT INTO iam.admin_users(
    principal_id,
    email,
    display_name,
    status,
    linked_user_principal_id,
    metadata
)
SELECT
    l.admin_principal_id,
    ('legacy-admin-' || REPLACE(l.legacy_user_id::TEXT, '-', '') || '@ipv6ftp.local')::CITEXT,
    u.username,
    'pending_activation',
    u.id,
    JSONB_BUILD_OBJECT(
        'source', 'legacy_users',
        'legacy_user_id', u.id,
        'activation_note', 'Create a dedicated admin credential before enabling control-plane login.'
    )
FROM iam.legacy_admin_links l
JOIN public.users u ON u.id = l.legacy_user_id
ON CONFLICT (principal_id) DO NOTHING;

INSERT INTO iam.principal_roles(principal_id, role_id, active_period, metadata)
SELECT ua.principal_id, r.id, TSTZRANGE(ua.created_at, NULL, '[)'), JSONB_BUILD_OBJECT('source', 'legacy_migration')
FROM iam.user_accounts ua
JOIN iam.roles r ON r.code = 'app_user'
WHERE ua.account_type = 'registered'
  AND NOT EXISTS (
      SELECT 1
      FROM iam.principal_roles pr
      WHERE pr.principal_id = ua.principal_id
        AND pr.role_id = r.id
        AND pr.revoked_at IS NULL
  );

INSERT INTO iam.principal_roles(principal_id, role_id, active_period, metadata)
SELECT au.principal_id, r.id, TSTZRANGE(au.created_at, NULL, '[)'), JSONB_BUILD_OBJECT('source', 'legacy_migration')
FROM iam.admin_users au
JOIN iam.roles r ON r.code = 'super_admin'
WHERE NOT EXISTS (
    SELECT 1
    FROM iam.principal_roles pr
    WHERE pr.principal_id = au.principal_id
      AND pr.role_id = r.id
      AND pr.revoked_at IS NULL
);

INSERT INTO iam.device_installations(
    principal_id,
    installation_identifier_hash,
    device_public_key,
    platform,
    first_seen_at,
    last_seen_at,
    metadata,
    created_at,
    updated_at
)
SELECT
    p.user_id,
    ENCODE(DIGEST(('legacy-phonebook:' || p.user_id::TEXT)::BYTEA, 'sha256'), 'hex'),
    NULLIF(p.public_key, ''),
    'unknown',
    p.created_at,
    COALESCE(p.last_seen, p.updated_at, p.created_at),
    JSONB_BUILD_OBJECT('source', 'legacy_phonebook', 'legacy_phonebook_id', p.id),
    p.created_at,
    p.updated_at
FROM public.phonebook p
WHERE NOT EXISTS (
    SELECT 1
    FROM iam.device_installations d
    WHERE d.installation_identifier_hash = ENCODE(DIGEST(('legacy-phonebook:' || p.user_id::TEXT)::BYTEA, 'sha256'), 'hex')
      AND d.revoked_at IS NULL
);

INSERT INTO communication.device_presence(
    device_installation_id,
    user_principal_id,
    ipv6_address,
    ipv4_address,
    is_ipv6_active,
    is_ipv4_fallback,
    is_online,
    public_key,
    last_seen_at,
    created_at,
    updated_at
)
SELECT
    d.id,
    p.user_id,
    p.ipv6_address,
    p.ipv4_address,
    p.is_ipv6_active,
    p.is_ipv4_fallback,
    p.is_online,
    p.public_key,
    p.last_seen,
    p.created_at,
    p.updated_at
FROM public.phonebook p
JOIN iam.device_installations d
  ON d.installation_identifier_hash = ENCODE(DIGEST(('legacy-phonebook:' || p.user_id::TEXT)::BYTEA, 'sha256'), 'hex')
WHERE NOT EXISTS (
    SELECT 1
    FROM communication.device_presence dp
    WHERE dp.device_installation_id = d.id
);

INSERT INTO iam.auth_sessions(
    legacy_session_id,
    principal_id,
    refresh_token_hash,
    user_agent,
    expires_at,
    revoked_at,
    metadata,
    created_at
)
SELECT
    s.id,
    s.user_id,
    s.token_hash,
    s.user_agent,
    s.expires_at,
    NOW(),
    JSONB_BUILD_OBJECT('source', 'legacy_sessions', 'legacy_ip_addr', s.ip_addr, 'legacy_is_revoked', s.is_revoked),
    s.created_at
FROM public.sessions s
WHERE NOT EXISTS (
    SELECT 1
    FROM iam.auth_sessions ns
    WHERE ns.legacy_session_id = s.id
)
AND NOT EXISTS (
    SELECT 1
    FROM iam.auth_sessions ns
    WHERE ns.refresh_token_hash = s.token_hash
);

WITH normalized_contacts AS (
    SELECT DISTINCT ON (LEAST(c.owner_id, c.contact_id), GREATEST(c.owner_id, c.contact_id))
        c.owner_id AS requestor_principal_id,
        c.contact_id AS addressee_principal_id,
        c.created_at AS requested_at
    FROM public.contacts c
    JOIN iam.user_accounts owner_account ON owner_account.principal_id = c.owner_id
    JOIN iam.user_accounts contact_account ON contact_account.principal_id = c.contact_id
    WHERE owner_account.account_type = 'registered'
      AND contact_account.account_type = 'registered'
    ORDER BY LEAST(c.owner_id, c.contact_id), GREATEST(c.owner_id, c.contact_id), c.created_at ASC
)
INSERT INTO communication.contact_relationships(
    requestor_principal_id,
    addressee_principal_id,
    relationship_status,
    requested_at,
    responded_at,
    created_at,
    updated_at,
    metadata
)
SELECT
    nc.requestor_principal_id,
    nc.addressee_principal_id,
    'accepted',
    nc.requested_at,
    nc.requested_at,
    nc.requested_at,
    nc.requested_at,
    JSONB_BUILD_OBJECT('source', 'legacy_contacts')
FROM normalized_contacts nc
WHERE NOT EXISTS (
    SELECT 1
    FROM communication.contact_relationships cr
    WHERE cr.first_user_principal_id = LEAST(nc.requestor_principal_id, nc.addressee_principal_id)
      AND cr.second_user_principal_id = GREATEST(nc.requestor_principal_id, nc.addressee_principal_id)
);

WITH legacy_plan AS (
    SELECT pv.id AS plan_version_id
    FROM catalog.plan_versions pv
    JOIN catalog.plans p ON p.id = pv.plan_id
    WHERE p.code = 'legacy_free'
      AND pv.version = 1
)
INSERT INTO catalog.user_plan_assignments(
    user_principal_id,
    plan_version_id,
    active_period,
    assignment_reason,
    metadata,
    created_at,
    updated_at
)
SELECT
    ua.principal_id,
    lp.plan_version_id,
    TSTZRANGE(ua.created_at, NULL, '[)'),
    'legacy_migration',
    JSONB_BUILD_OBJECT('source', 'legacy_users'),
    ua.created_at,
    ua.updated_at
FROM iam.user_accounts ua
CROSS JOIN legacy_plan lp
WHERE ua.account_type = 'registered'
  AND NOT EXISTS (
      SELECT 1
      FROM catalog.user_plan_assignments upa
      WHERE upa.user_principal_id = ua.principal_id
        AND upa.revoked_at IS NULL
  );

CREATE OR REPLACE VIEW iam.migration_validation_counts AS
SELECT 'legacy_users' AS metric, COUNT(*)::BIGINT AS value FROM public.users
UNION ALL
SELECT 'iam_user_accounts', COUNT(*)::BIGINT FROM iam.user_accounts
UNION ALL
SELECT 'legacy_admin_users', COUNT(*)::BIGINT FROM public.users WHERE role = 'admin'
UNION ALL
SELECT 'iam_admin_users', COUNT(*)::BIGINT FROM iam.admin_users
UNION ALL
SELECT 'legacy_phonebook', COUNT(*)::BIGINT FROM public.phonebook
UNION ALL
SELECT 'communication_device_presence', COUNT(*)::BIGINT FROM communication.device_presence
UNION ALL
SELECT 'legacy_sessions', COUNT(*)::BIGINT FROM public.sessions
UNION ALL
SELECT 'iam_legacy_sessions', COUNT(*)::BIGINT FROM iam.auth_sessions WHERE legacy_session_id IS NOT NULL
UNION ALL
SELECT 'legacy_contacts', COUNT(*)::BIGINT FROM public.contacts
UNION ALL
SELECT 'communication_contact_relationships', COUNT(*)::BIGINT FROM communication.contact_relationships
UNION ALL
SELECT 'user_plan_assignments', COUNT(*)::BIGINT FROM catalog.user_plan_assignments;
