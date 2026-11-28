-- Product tiers, contact graph, presence, and durable call-usage ledger.
-- Redis should be used later for live counters; PostgreSQL remains the source
-- of truth for plans, policy, and reconciled usage.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS communication;

CREATE OR REPLACE FUNCTION catalog.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION communication.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS catalog.plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    plan_status TEXT NOT NULL DEFAULT 'active',
    sort_order INTEGER NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_plans_status CHECK (plan_status IN ('draft', 'active', 'retired'))
);

DROP TRIGGER IF EXISTS set_plans_updated_at ON catalog.plans;
CREATE TRIGGER set_plans_updated_at
BEFORE UPDATE ON catalog.plans
FOR EACH ROW
EXECUTE FUNCTION catalog.set_updated_at();

CREATE TABLE IF NOT EXISTS catalog.plan_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES catalog.plans(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    valid_period TSTZRANGE NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_plan_versions_version UNIQUE(plan_id, version),
    CONSTRAINT chk_plan_versions_period CHECK (NOT ISEMPTY(valid_period)),
    CONSTRAINT ex_plan_versions_no_overlap EXCLUDE USING gist (
        plan_id WITH =,
        valid_period WITH &&
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_versions_current
    ON catalog.plan_versions(plan_id)
    WHERE is_current = TRUE;

DROP TRIGGER IF EXISTS set_plan_versions_updated_at ON catalog.plan_versions;
CREATE TRIGGER set_plan_versions_updated_at
BEFORE UPDATE ON catalog.plan_versions
FOR EACH ROW
EXECUTE FUNCTION catalog.set_updated_at();

CREATE TABLE IF NOT EXISTS catalog.features (
    code TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS catalog.plan_entitlements (
    plan_version_id UUID NOT NULL REFERENCES catalog.plan_versions(id) ON DELETE CASCADE,
    feature_code TEXT NOT NULL REFERENCES catalog.features(code) ON DELETE RESTRICT,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    entitlement_value JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (plan_version_id, feature_code)
);

DROP TRIGGER IF EXISTS set_plan_entitlements_updated_at ON catalog.plan_entitlements;
CREATE TRIGGER set_plan_entitlements_updated_at
BEFORE UPDATE ON catalog.plan_entitlements
FOR EACH ROW
EXECUTE FUNCTION catalog.set_updated_at();

CREATE TABLE IF NOT EXISTS catalog.plan_call_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_version_id UUID NOT NULL REFERENCES catalog.plan_versions(id) ON DELETE CASCADE,
    media_type TEXT NOT NULL,
    network_family TEXT NOT NULL,
    policy_mode TEXT NOT NULL,
    per_call_limit_seconds INTEGER,
    period_limit_seconds INTEGER,
    period_unit TEXT,
    is_draft BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_plan_call_policy UNIQUE(plan_version_id, media_type, network_family),
    CONSTRAINT chk_plan_call_policy_media CHECK (media_type IN ('voice', 'video')),
    CONSTRAINT chk_plan_call_policy_network CHECK (network_family IN ('ipv4', 'ipv6')),
    CONSTRAINT chk_plan_call_policy_mode CHECK (policy_mode IN ('blocked', 'capped', 'unlimited')),
    CONSTRAINT chk_plan_call_policy_limits_positive CHECK (
        (per_call_limit_seconds IS NULL OR per_call_limit_seconds > 0)
        AND
        (period_limit_seconds IS NULL OR period_limit_seconds > 0)
    ),
    CONSTRAINT chk_plan_call_policy_period_unit CHECK (
        period_unit IS NULL OR period_unit IN ('day', 'week', 'month', 'billing_period')
    ),
    CONSTRAINT chk_plan_call_policy_unlimited_limits CHECK (
        policy_mode <> 'unlimited'
        OR
        (per_call_limit_seconds IS NULL AND period_limit_seconds IS NULL AND period_unit IS NULL)
    ),
    CONSTRAINT chk_plan_call_policy_period_limit_unit CHECK (
        period_limit_seconds IS NULL
        OR
        period_unit IS NOT NULL
    )
);
CREATE INDEX IF NOT EXISTS idx_plan_call_policies_version ON catalog.plan_call_policies(plan_version_id);

DROP TRIGGER IF EXISTS set_plan_call_policies_updated_at ON catalog.plan_call_policies;
CREATE TRIGGER set_plan_call_policies_updated_at
BEFORE UPDATE ON catalog.plan_call_policies
FOR EACH ROW
EXECUTE FUNCTION catalog.set_updated_at();

CREATE TABLE IF NOT EXISTS catalog.user_plan_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_principal_id UUID NOT NULL REFERENCES iam.user_accounts(principal_id) ON DELETE CASCADE,
    plan_version_id UUID NOT NULL REFERENCES catalog.plan_versions(id) ON DELETE RESTRICT,
    active_period TSTZRANGE NOT NULL,
    assignment_reason TEXT NOT NULL DEFAULT 'manual',
    assigned_by_principal_id UUID REFERENCES iam.principals(id) ON DELETE SET NULL,
    revoked_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_user_plan_assignments_period CHECK (NOT ISEMPTY(active_period)),
    CONSTRAINT chk_user_plan_assignments_reason CHECK (
        assignment_reason IN ('trial', 'registration', 'billing', 'manual', 'legacy_migration')
    ),
    CONSTRAINT ex_user_plan_assignments_no_overlap EXCLUDE USING gist (
        user_principal_id WITH =,
        active_period WITH &&
    ) WHERE (revoked_at IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_user_plan_assignments_user ON catalog.user_plan_assignments(user_principal_id);
CREATE INDEX IF NOT EXISTS idx_user_plan_assignments_plan ON catalog.user_plan_assignments(plan_version_id);

DROP TRIGGER IF EXISTS set_user_plan_assignments_updated_at ON catalog.user_plan_assignments;
CREATE TRIGGER set_user_plan_assignments_updated_at
BEFORE UPDATE ON catalog.user_plan_assignments
FOR EACH ROW
EXECUTE FUNCTION catalog.set_updated_at();

CREATE OR REPLACE FUNCTION communication.enforce_registered_contact_participants()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    requestor_type TEXT;
    addressee_type TEXT;
BEGIN
    SELECT account_type INTO requestor_type
    FROM iam.user_accounts
    WHERE principal_id = NEW.requestor_principal_id;

    SELECT account_type INTO addressee_type
    FROM iam.user_accounts
    WHERE principal_id = NEW.addressee_principal_id;

    IF requestor_type <> 'registered' OR addressee_type <> 'registered' THEN
        RAISE EXCEPTION 'contacts require registered user accounts'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS communication.contact_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requestor_principal_id UUID NOT NULL REFERENCES iam.user_accounts(principal_id) ON DELETE CASCADE,
    addressee_principal_id UUID NOT NULL REFERENCES iam.user_accounts(principal_id) ON DELETE CASCADE,
    first_user_principal_id UUID GENERATED ALWAYS AS (
        LEAST(requestor_principal_id, addressee_principal_id)
    ) STORED,
    second_user_principal_id UUID GENERATED ALWAYS AS (
        GREATEST(requestor_principal_id, addressee_principal_id)
    ) STORED,
    relationship_status TEXT NOT NULL DEFAULT 'pending',
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    responded_at TIMESTAMPTZ,
    blocked_by_principal_id UUID REFERENCES iam.user_accounts(principal_id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_contact_relationship_pair UNIQUE(first_user_principal_id, second_user_principal_id),
    CONSTRAINT chk_contact_relationship_no_self CHECK (requestor_principal_id <> addressee_principal_id),
    CONSTRAINT chk_contact_relationship_status CHECK (
        relationship_status IN ('pending', 'accepted', 'rejected', 'blocked')
    ),
    CONSTRAINT chk_contact_relationship_blocked_by CHECK (
        relationship_status <> 'blocked'
        OR
        (
            blocked_by_principal_id IS NOT NULL
            AND blocked_by_principal_id IN (requestor_principal_id, addressee_principal_id)
        )
    )
);
CREATE INDEX IF NOT EXISTS idx_contact_relationships_requestor ON communication.contact_relationships(requestor_principal_id);
CREATE INDEX IF NOT EXISTS idx_contact_relationships_addressee ON communication.contact_relationships(addressee_principal_id);
CREATE INDEX IF NOT EXISTS idx_contact_relationships_status ON communication.contact_relationships(relationship_status);

DROP TRIGGER IF EXISTS enforce_registered_contact_participants ON communication.contact_relationships;
CREATE TRIGGER enforce_registered_contact_participants
BEFORE INSERT OR UPDATE OF requestor_principal_id, addressee_principal_id ON communication.contact_relationships
FOR EACH ROW
EXECUTE FUNCTION communication.enforce_registered_contact_participants();

DROP TRIGGER IF EXISTS set_contact_relationships_updated_at ON communication.contact_relationships;
CREATE TRIGGER set_contact_relationships_updated_at
BEFORE UPDATE ON communication.contact_relationships
FOR EACH ROW
EXECUTE FUNCTION communication.set_updated_at();

CREATE TABLE IF NOT EXISTS communication.device_presence (
    device_installation_id UUID PRIMARY KEY REFERENCES iam.device_installations(id) ON DELETE CASCADE,
    user_principal_id UUID NOT NULL REFERENCES iam.user_accounts(principal_id) ON DELETE CASCADE,
    ipv6_address INET,
    ipv4_address INET,
    is_ipv6_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_ipv4_fallback BOOLEAN NOT NULL DEFAULT FALSE,
    is_online BOOLEAN NOT NULL DEFAULT FALSE,
    public_key TEXT NOT NULL DEFAULT '',
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_device_presence_user ON communication.device_presence(user_principal_id);
CREATE INDEX IF NOT EXISTS idx_device_presence_online
    ON communication.device_presence(is_online, last_seen_at DESC)
    WHERE is_online = TRUE;

DROP TRIGGER IF EXISTS set_device_presence_updated_at ON communication.device_presence;
CREATE TRIGGER set_device_presence_updated_at
BEFORE UPDATE ON communication.device_presence
FOR EACH ROW
EXECUTE FUNCTION communication.set_updated_at();

CREATE TABLE IF NOT EXISTS communication.call_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by_principal_id UUID REFERENCES iam.user_accounts(principal_id) ON DELETE SET NULL,
    join_code_hash TEXT,
    join_link_token_hash TEXT,
    media_type TEXT NOT NULL,
    network_family TEXT NOT NULL,
    call_status TEXT NOT NULL DEFAULT 'created',
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    ended_reason TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_call_sessions_media CHECK (media_type IN ('voice', 'video')),
    CONSTRAINT chk_call_sessions_network CHECK (network_family IN ('ipv4', 'ipv6')),
    CONSTRAINT chk_call_sessions_status CHECK (
        call_status IN ('created', 'ringing', 'active', 'ended', 'failed', 'cancelled')
    ),
    CONSTRAINT chk_call_sessions_time_order CHECK (
        started_at IS NULL
        OR ended_at IS NULL
        OR ended_at >= started_at
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_call_sessions_join_code_hash
    ON communication.call_sessions(join_code_hash)
    WHERE join_code_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_call_sessions_join_link_token_hash
    ON communication.call_sessions(join_link_token_hash)
    WHERE join_link_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_call_sessions_created_by ON communication.call_sessions(created_by_principal_id);
CREATE INDEX IF NOT EXISTS idx_call_sessions_status ON communication.call_sessions(call_status);
CREATE INDEX IF NOT EXISTS idx_call_sessions_started_at ON communication.call_sessions(started_at DESC);

DROP TRIGGER IF EXISTS set_call_sessions_updated_at ON communication.call_sessions;
CREATE TRIGGER set_call_sessions_updated_at
BEFORE UPDATE ON communication.call_sessions
FOR EACH ROW
EXECUTE FUNCTION communication.set_updated_at();

CREATE TABLE IF NOT EXISTS communication.call_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_session_id UUID NOT NULL REFERENCES communication.call_sessions(id) ON DELETE CASCADE,
    user_principal_id UUID REFERENCES iam.user_accounts(principal_id) ON DELETE SET NULL,
    device_installation_id UUID REFERENCES iam.device_installations(id) ON DELETE SET NULL,
    participant_role TEXT NOT NULL DEFAULT 'participant',
    joined_at TIMESTAMPTZ,
    left_at TIMESTAMPTZ,
    disconnect_reason TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_call_participants_role CHECK (participant_role IN ('creator', 'participant')),
    CONSTRAINT chk_call_participants_time_order CHECK (
        joined_at IS NULL
        OR left_at IS NULL
        OR left_at >= joined_at
    )
);
CREATE INDEX IF NOT EXISTS idx_call_participants_call ON communication.call_participants(call_session_id);
CREATE INDEX IF NOT EXISTS idx_call_participants_user ON communication.call_participants(user_principal_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_call_participants_active_device
    ON communication.call_participants(call_session_id, device_installation_id)
    WHERE device_installation_id IS NOT NULL AND left_at IS NULL;

DROP TRIGGER IF EXISTS set_call_participants_updated_at ON communication.call_participants;
CREATE TRIGGER set_call_participants_updated_at
BEFORE UPDATE ON communication.call_participants
FOR EACH ROW
EXECUTE FUNCTION communication.set_updated_at();

CREATE TABLE IF NOT EXISTS communication.call_usage_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key TEXT NOT NULL UNIQUE,
    call_session_id UUID NOT NULL REFERENCES communication.call_sessions(id) ON DELETE CASCADE,
    user_principal_id UUID NOT NULL REFERENCES iam.user_accounts(principal_id) ON DELETE CASCADE,
    plan_version_id UUID REFERENCES catalog.plan_versions(id) ON DELETE SET NULL,
    media_type TEXT NOT NULL,
    network_family TEXT NOT NULL,
    usage_started_at TIMESTAMPTZ NOT NULL,
    usage_ended_at TIMESTAMPTZ NOT NULL,
    duration_seconds INTEGER NOT NULL,
    usage_source TEXT NOT NULL DEFAULT 'server_reconciliation',
    redis_counter_key TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_call_usage_ledger_media CHECK (media_type IN ('voice', 'video')),
    CONSTRAINT chk_call_usage_ledger_network CHECK (network_family IN ('ipv4', 'ipv6')),
    CONSTRAINT chk_call_usage_ledger_duration CHECK (duration_seconds >= 0),
    CONSTRAINT chk_call_usage_ledger_time_order CHECK (usage_ended_at >= usage_started_at),
    CONSTRAINT chk_call_usage_ledger_source CHECK (
        usage_source IN ('server_reconciliation', 'redis_flush', 'manual_adjustment')
    )
);
CREATE INDEX IF NOT EXISTS idx_call_usage_ledger_user_time
    ON communication.call_usage_ledger(user_principal_id, usage_started_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_usage_ledger_call ON communication.call_usage_ledger(call_session_id);
CREATE INDEX IF NOT EXISTS idx_call_usage_ledger_plan ON communication.call_usage_ledger(plan_version_id);
CREATE INDEX IF NOT EXISTS idx_call_usage_ledger_policy_window
    ON communication.call_usage_ledger(user_principal_id, media_type, network_family, usage_started_at DESC);

CREATE OR REPLACE VIEW communication.call_usage_period_totals AS
SELECT
    user_principal_id,
    plan_version_id,
    media_type,
    network_family,
    DATE_TRUNC('month', usage_started_at) AS usage_month,
    SUM(duration_seconds)::BIGINT AS duration_seconds
FROM communication.call_usage_ledger
GROUP BY user_principal_id, plan_version_id, media_type, network_family, DATE_TRUNC('month', usage_started_at);

INSERT INTO catalog.features(code, display_name, description)
VALUES
    ('voice_call', 'Voice Calling', 'Ability to place or join voice calls.'),
    ('video_call', 'Video Calling', 'Ability to place or join video calls.'),
    ('contacts', 'Contacts', 'Ability to maintain a persistent contact list.'),
    ('contact_search', 'Contact Search', 'Ability to discover contacts beyond direct links.'),
    ('code_link_join', 'Code and Link Join', 'Ability to call or join through generated codes and links.'),
    ('ipv4_calling', 'IPv4 Calling', 'Ability to use IPv4 call relay or fallback paths.'),
    ('ipv6_calling', 'IPv6 Calling', 'Ability to use IPv6 direct call paths.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO catalog.plans(code, display_name, plan_status, sort_order)
VALUES
    ('trial', 'Trial', 'active', 10),
    ('free', 'Free', 'active', 20),
    ('pro', 'Pro', 'active', 30),
    ('ultimate', 'Ultimate', 'active', 40),
    ('legacy_free', 'Legacy Free', 'active', 90)
ON CONFLICT (code) DO NOTHING;

INSERT INTO catalog.plan_versions(plan_id, version, valid_period, is_current, notes)
SELECT p.id, 1, TSTZRANGE('2026-01-01 00:00:00+00'::TIMESTAMPTZ, NULL, '[)'), TRUE, 'Initial tier model.'
FROM catalog.plans p
WHERE NOT EXISTS (
    SELECT 1
    FROM catalog.plan_versions pv
    WHERE pv.plan_id = p.id AND pv.version = 1
);

INSERT INTO catalog.plan_entitlements(plan_version_id, feature_code, is_enabled)
SELECT pv.id, f.code, TRUE
FROM catalog.plan_versions pv
JOIN catalog.plans p ON p.id = pv.plan_id
JOIN catalog.features f ON f.code IN ('voice_call', 'code_link_join')
WHERE p.code = 'trial' AND pv.version = 1
ON CONFLICT DO NOTHING;

INSERT INTO catalog.plan_entitlements(plan_version_id, feature_code, is_enabled)
SELECT pv.id, f.code, TRUE
FROM catalog.plan_versions pv
JOIN catalog.plans p ON p.id = pv.plan_id
JOIN catalog.features f ON f.code IN ('voice_call', 'video_call', 'contacts', 'code_link_join', 'ipv4_calling', 'ipv6_calling')
WHERE p.code IN ('free', 'pro', 'ultimate', 'legacy_free') AND pv.version = 1
ON CONFLICT DO NOTHING;

INSERT INTO catalog.plan_entitlements(plan_version_id, feature_code, is_enabled)
SELECT pv.id, f.code, TRUE
FROM catalog.plan_versions pv
JOIN catalog.plans p ON p.id = pv.plan_id
JOIN catalog.features f ON f.code = 'contact_search'
WHERE p.code IN ('pro', 'ultimate') AND pv.version = 1
ON CONFLICT DO NOTHING;

INSERT INTO catalog.plan_call_policies(plan_version_id, media_type, network_family, policy_mode, is_draft, metadata)
SELECT pv.id, media.media_type, network.network_family,
    CASE
        WHEN p.code = 'trial' AND media.media_type = 'video' THEN 'blocked'
        WHEN p.code = 'ultimate' THEN 'unlimited'
        WHEN p.code = 'legacy_free' THEN 'unlimited'
        WHEN network.network_family = 'ipv6' THEN 'unlimited'
        ELSE 'capped'
    END AS policy_mode,
    CASE WHEN p.code IN ('trial', 'free', 'pro') THEN TRUE ELSE FALSE END AS is_draft,
    CASE
        WHEN p.code IN ('trial', 'free', 'pro') THEN '{"note":"Exact limits intentionally left unset for product configuration."}'::JSONB
        ELSE '{}'::JSONB
    END AS metadata
FROM catalog.plan_versions pv
JOIN catalog.plans p ON p.id = pv.plan_id
CROSS JOIN (VALUES ('voice'), ('video')) AS media(media_type)
CROSS JOIN (VALUES ('ipv4'), ('ipv6')) AS network(network_family)
WHERE pv.version = 1
ON CONFLICT DO NOTHING;
