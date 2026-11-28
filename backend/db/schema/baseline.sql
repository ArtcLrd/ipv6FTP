--
-- PostgreSQL database dump
--

\restrict 8TC2pBPldy1ZbKAX0rKtuor2y7bDYSQrKtr22l8xr1dPHOhAaPpbYXDRdp1XkbZ

-- Dumped from database version 18.4 (Debian 18.4-1.pgdg13+1)
-- Dumped by pg_dump version 18.7

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: catalog; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA catalog;


--
-- Name: communication; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA communication;


--
-- Name: iam; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA iam;


--
-- Name: btree_gist; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;


--
-- Name: EXTENSION btree_gist; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION btree_gist IS 'support for indexing common datatypes in GiST';


--
-- Name: citext; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;


--
-- Name: EXTENSION citext; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION citext IS 'data type for case-insensitive character strings';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: append_account_event(uuid, text, jsonb); Type: FUNCTION; Schema: iam; Owner: -
--

CREATE FUNCTION iam.append_account_event(recipient uuid, kind text, body jsonb) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE next_sequence bigint;
BEGIN
    INSERT INTO iam.account_event_sequences(principal_id, last_sequence)
    VALUES (recipient, 1)
    ON CONFLICT (principal_id) DO UPDATE
        SET last_sequence = iam.account_event_sequences.last_sequence + 1
    RETURNING last_sequence INTO next_sequence;
    INSERT INTO iam.account_events(principal_id, sequence, event_type, version, payload, expires_at)
    VALUES (recipient, next_sequence, kind, 1, body, now() + interval '7 days');
    RETURN next_sequence;
END;
$$;


--
-- Name: enforce_username_reservation(); Type: FUNCTION; Schema: iam; Owner: -
--

CREATE FUNCTION iam.enforce_username_reservation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    canon TEXT := LOWER(NEW.username);
    holder UUID;
    found_kind TEXT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('username-lock:' || canon, 0));
    SELECT principal_id, kind INTO holder, found_kind FROM iam.username_reservations WHERE canonical = canon;
    IF FOUND AND (found_kind = 'retired' OR holder IS DISTINCT FROM NEW.principal_id) THEN
        RAISE EXCEPTION 'username is reserved' USING ERRCODE = '23505', CONSTRAINT = 'uq_accounts_username_ci';
    END IF;
    RETURN NEW;
END $$;


--
-- Name: record_account_operation(uuid, text, uuid); Type: FUNCTION; Schema: iam; Owner: -
--

CREATE FUNCTION iam.record_account_operation(account_id uuid, event_name text, affected_session uuid) RETURNS void
    LANGUAGE sql
    AS $$
    WITH event AS (
        INSERT INTO iam.account_audit(principal_id, operation, session_id)
        VALUES (account_id, event_name, affected_session) RETURNING id
    )
    INSERT INTO iam.account_outbox(audit_id) SELECT id FROM event;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: call_policies; Type: TABLE; Schema: catalog; Owner: -
--

CREATE TABLE catalog.call_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_version_id uuid NOT NULL,
    media_type text NOT NULL,
    connection_route text NOT NULL,
    max_call_seconds integer,
    max_period_seconds integer,
    period_seconds integer,
    CONSTRAINT chk_call_policy_limits CHECK ((((max_call_seconds IS NULL) OR (max_call_seconds > 0)) AND ((max_period_seconds IS NULL) OR (max_period_seconds > 0)) AND ((period_seconds IS NULL) OR (period_seconds > 0)) AND (((max_period_seconds IS NULL) AND (period_seconds IS NULL)) OR ((max_period_seconds IS NOT NULL) AND (period_seconds IS NOT NULL))))),
    CONSTRAINT chk_call_policy_media CHECK ((media_type = ANY (ARRAY['voice'::text, 'video'::text]))),
    CONSTRAINT chk_call_policy_route CHECK ((connection_route = ANY (ARRAY['direct_ipv6'::text, 'blind_relay_ipv4'::text])))
);


--
-- Name: plan_assignments; Type: TABLE; Schema: catalog; Owner: -
--

CREATE TABLE catalog.plan_assignments (
    principal_id uuid NOT NULL,
    plan_version_id uuid NOT NULL,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    effective_until timestamp with time zone,
    CONSTRAINT chk_plan_assignment_period CHECK (((effective_until IS NULL) OR (effective_until > effective_from)))
);


--
-- Name: plan_versions; Type: TABLE; Schema: catalog; Owner: -
--

CREATE TABLE catalog.plan_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    revision integer NOT NULL,
    valid_from timestamp with time zone DEFAULT now() NOT NULL,
    valid_until timestamp with time zone,
    CONSTRAINT chk_plan_revision_positive CHECK ((revision > 0)),
    CONSTRAINT chk_plan_valid_period CHECK (((valid_until IS NULL) OR (valid_until > valid_from)))
);


--
-- Name: active_calls; Type: TABLE; Schema: communication; Owner: -
--

CREATE TABLE communication.active_calls (
    principal_id uuid NOT NULL,
    call_session_id uuid NOT NULL
);


--
-- Name: call_invitations; Type: TABLE; Schema: communication; Owner: -
--

CREATE TABLE communication.call_invitations (
    call_session_id uuid NOT NULL,
    code_hash bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT chk_invitation_expiry CHECK ((expires_at > created_at))
);


--
-- Name: call_participants; Type: TABLE; Schema: communication; Owner: -
--

CREATE TABLE communication.call_participants (
    call_session_id uuid NOT NULL,
    principal_id uuid NOT NULL,
    device_id uuid NOT NULL,
    call_policy_id uuid NOT NULL,
    accepted_at timestamp with time zone
);


--
-- Name: call_sessions; Type: TABLE; Schema: communication; Owner: -
--

CREATE TABLE communication.call_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    creator_principal_id uuid NOT NULL,
    state text DEFAULT 'waiting'::text NOT NULL,
    media_type text DEFAULT 'voice'::text NOT NULL,
    connection_route text DEFAULT 'direct_ipv6'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    accepted_at timestamp with time zone,
    connected_at timestamp with time zone,
    ended_at timestamp with time zone,
    end_reason text,
    CONSTRAINT chk_call_media CHECK ((media_type = ANY (ARRAY['voice'::text, 'video'::text]))),
    CONSTRAINT chk_call_route CHECK ((connection_route = ANY (ARRAY['direct_ipv6'::text, 'blind_relay_ipv4'::text]))),
    CONSTRAINT chk_call_state CHECK ((state = ANY (ARRAY['waiting'::text, 'awaiting_acceptance'::text, 'handshaking'::text, 'verifying'::text, 'connecting'::text, 'active'::text, 'ended'::text]))),
    CONSTRAINT chk_call_timestamps CHECK ((((accepted_at IS NULL) OR (accepted_at >= created_at)) AND ((connected_at IS NULL) OR (connected_at >= COALESCE(accepted_at, created_at))) AND ((ended_at IS NULL) OR (ended_at >= created_at)))),
    CONSTRAINT chk_ended_call_timestamp CHECK (((state = 'ended'::text) = (ended_at IS NOT NULL)))
);


--
-- Name: account_audit; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.account_audit (
    id bigint NOT NULL,
    principal_id uuid NOT NULL,
    operation text NOT NULL,
    session_id uuid,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: account_audit_id_seq; Type: SEQUENCE; Schema: iam; Owner: -
--

ALTER TABLE iam.account_audit ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME iam.account_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: account_event_sequences; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.account_event_sequences (
    principal_id uuid NOT NULL,
    last_sequence bigint DEFAULT 0 NOT NULL,
    CONSTRAINT account_event_sequences_last_sequence_check CHECK ((last_sequence >= 0))
);


--
-- Name: account_event_tickets; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.account_event_tickets (
    token_hash bytea NOT NULL,
    principal_id uuid NOT NULL,
    session_id uuid NOT NULL,
    device_id uuid NOT NULL,
    auth_version integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT account_event_tickets_auth_version_check CHECK ((auth_version > 0)),
    CONSTRAINT account_event_tickets_token_hash_check CHECK ((octet_length(token_hash) = 32))
);


--
-- Name: account_events; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.account_events (
    principal_id uuid NOT NULL,
    sequence bigint NOT NULL,
    event_type text NOT NULL,
    version integer NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    claimed_until timestamp with time zone,
    claim_owner uuid,
    delivered_at timestamp with time zone,
    CONSTRAINT account_events_check CHECK ((expires_at > created_at)),
    CONSTRAINT account_events_check1 CHECK (((claimed_until IS NULL) = (claim_owner IS NULL))),
    CONSTRAINT account_events_event_type_check CHECK (((length(event_type) >= 1) AND (length(event_type) <= 64))),
    CONSTRAINT account_events_payload_check CHECK ((jsonb_typeof(payload) = 'object'::text)),
    CONSTRAINT account_events_sequence_check CHECK ((sequence > 0)),
    CONSTRAINT account_events_version_check CHECK ((version > 0))
);


--
-- Name: account_outbox; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.account_outbox (
    audit_id bigint NOT NULL,
    delivered_at timestamp with time zone
);


--
-- Name: accounts; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.accounts (
    principal_id uuid NOT NULL,
    username text NOT NULL,
    password_hash text NOT NULL,
    device_generation bigint DEFAULT 0 NOT NULL,
    activated_at timestamp with time zone,
    credential_version integer DEFAULT 1 NOT NULL,
    recovery_ack_at timestamp with time zone,
    username_changed_at timestamp with time zone,
    deletion_requested_at timestamp with time zone,
    deletion_deadline timestamp with time zone,
    profile_revision bigint DEFAULT 1 NOT NULL,
    CONSTRAINT chk_accounts_deletion_deadline CHECK (((deletion_deadline IS NULL) OR (deletion_deadline > deletion_requested_at))),
    CONSTRAINT chk_accounts_deletion_pair CHECK (((deletion_requested_at IS NULL) = (deletion_deadline IS NULL))),
    CONSTRAINT chk_accounts_password_hash CHECK ((char_length(password_hash) >= 32)),
    CONSTRAINT chk_accounts_username CHECK (((username = btrim(username)) AND ((char_length(username) >= 3) AND (char_length(username) <= 64))))
);


--
-- Name: activation_operations; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.activation_operations (
    principal_id uuid NOT NULL,
    operation_key text NOT NULL,
    fingerprint text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT activation_operations_operation_key_check CHECK (((length(operation_key) >= 1) AND (length(operation_key) <= 128)))
);


--
-- Name: auth_sessions; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.auth_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    device_id uuid NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT chk_auth_sessions_expiry CHECK ((expires_at > issued_at)),
    CONSTRAINT chk_auth_sessions_revoked_after_issue CHECK (((revoked_at IS NULL) OR (revoked_at >= issued_at)))
);


--
-- Name: devices; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.devices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    principal_id uuid NOT NULL,
    noise_static_public_key bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT chk_devices_noise_key_length CHECK ((octet_length(noise_static_public_key) = 32)),
    CONSTRAINT chk_devices_revoked_after_creation CHECK (((revoked_at IS NULL) OR (revoked_at >= created_at)))
);


--
-- Name: email_challenges; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.email_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purpose text NOT NULL,
    principal_id uuid,
    email_canonical text NOT NULL,
    address_version integer NOT NULL,
    verifier bytea NOT NULL,
    attempts smallint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    superseded_at timestamp with time zone,
    CONSTRAINT chk_challenge_attempts CHECK (((attempts >= 0) AND (attempts <= 5))),
    CONSTRAINT chk_challenge_expiry CHECK ((expires_at > created_at)),
    CONSTRAINT chk_challenge_purpose CHECK ((purpose = ANY (ARRAY['verify_email'::text, 'recover_account'::text, 'cancel_deletion'::text]))),
    CONSTRAINT chk_challenge_verifier_length CHECK ((octet_length(verifier) = 32))
);


--
-- Name: email_outbox; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.email_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    challenge_id uuid,
    recipient_canonical text NOT NULL,
    template text NOT NULL,
    payload_ciphertext bytea NOT NULL,
    key_version smallint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    attempt_count smallint DEFAULT 0 NOT NULL,
    delivered_at timestamp with time zone,
    provider_message_id text,
    failed_at timestamp with time zone,
    CONSTRAINT chk_outbox_expiry CHECK ((expires_at > created_at)),
    CONSTRAINT chk_outbox_template CHECK ((template = ANY (ARRAY['verify_email'::text, 'recover_account'::text, 'cancel_deletion'::text, 'email_removed'::text])))
);


--
-- Name: email_suppressions; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.email_suppressions (
    email_canonical text NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_suppression_reason CHECK ((reason = ANY (ARRAY['bounce'::text, 'complaint'::text])))
);


--
-- Name: email_webhook_events; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.email_webhook_events (
    provider_event_id text NOT NULL,
    event_type text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: enrollment_challenges; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.enrollment_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    principal_id uuid NOT NULL,
    nonce bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    credential_version integer,
    device_generation bigint,
    server_key_id text,
    rotation_supported boolean DEFAULT false NOT NULL,
    CONSTRAINT chk_enroll_consumed_after_creation CHECK (((consumed_at IS NULL) OR (consumed_at >= created_at))),
    CONSTRAINT chk_enroll_expiry CHECK ((expires_at > created_at)),
    CONSTRAINT chk_enroll_nonce_length CHECK ((octet_length(nonce) = 32)),
    CONSTRAINT chk_enrollment_binding CHECK ((((credential_version IS NULL) AND (device_generation IS NULL) AND (server_key_id IS NULL)) OR ((credential_version IS NOT NULL) AND (credential_version > 0) AND (device_generation IS NOT NULL) AND (device_generation >= 0) AND (server_key_id IS NOT NULL) AND (server_key_id ~ '^[A-Za-z0-9_-]{1,64}$'::text))))
);


--
-- Name: principals; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.principals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    disabled_at timestamp with time zone,
    CONSTRAINT chk_principals_disabled_after_creation CHECK (((disabled_at IS NULL) OR (disabled_at >= created_at)))
);


--
-- Name: recovery_code_sets; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.recovery_code_sets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    principal_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    retired_at timestamp with time zone,
    CONSTRAINT chk_recovery_set_retired CHECK (((retired_at IS NULL) OR (retired_at >= created_at)))
);


--
-- Name: recovery_codes; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.recovery_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    set_id uuid NOT NULL,
    verifier bytea NOT NULL,
    consumed_at timestamp with time zone,
    CONSTRAINT chk_recovery_verifier_length CHECK ((octet_length(verifier) = 32))
);


--
-- Name: recovery_emails; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.recovery_emails (
    principal_id uuid NOT NULL,
    email_canonical text NOT NULL,
    address_version integer DEFAULT 1 NOT NULL,
    verified_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_recovery_email_canonical CHECK (((email_canonical = lower(btrim(email_canonical))) AND ((char_length(email_canonical) >= 3) AND (char_length(email_canonical) <= 254))))
);


--
-- Name: recovery_grants; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.recovery_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    principal_id uuid NOT NULL,
    credential_version integer NOT NULL,
    method text NOT NULL,
    token_hash bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    CONSTRAINT chk_grant_expiry CHECK ((expires_at > created_at)),
    CONSTRAINT chk_grant_hash_length CHECK ((octet_length(token_hash) = 32)),
    CONSTRAINT chk_grant_method CHECK ((method = ANY (ARRAY['saved_code'::text, 'email'::text])))
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.refresh_tokens (
    token_hash bytea NOT NULL,
    auth_session_id uuid NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    CONSTRAINT chk_refresh_consumed_after_issue CHECK (((consumed_at IS NULL) OR (consumed_at >= issued_at))),
    CONSTRAINT chk_refresh_expiry CHECK ((expires_at > issued_at)),
    CONSTRAINT chk_refresh_hash_length CHECK ((octet_length(token_hash) = 32))
);


--
-- Name: username_reservations; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.username_reservations (
    canonical text NOT NULL,
    principal_id uuid,
    kind text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_username_reservation_canonical CHECK (((canonical = lower(canonical)) AND ((char_length(canonical) >= 3) AND (char_length(canonical) <= 64)))),
    CONSTRAINT chk_username_reservation_kind CHECK ((kind = ANY (ARRAY['former'::text, 'retired'::text]))),
    CONSTRAINT chk_username_reservation_owner CHECK (((kind = 'former'::text) = (principal_id IS NOT NULL)))
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version text NOT NULL,
    name text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: call_policies call_policies_pkey; Type: CONSTRAINT; Schema: catalog; Owner: -
--

ALTER TABLE ONLY catalog.call_policies
    ADD CONSTRAINT call_policies_pkey PRIMARY KEY (id);


--
-- Name: plan_assignments plan_assignments_pkey; Type: CONSTRAINT; Schema: catalog; Owner: -
--

ALTER TABLE ONLY catalog.plan_assignments
    ADD CONSTRAINT plan_assignments_pkey PRIMARY KEY (principal_id, effective_from);


--
-- Name: plan_versions plan_versions_pkey; Type: CONSTRAINT; Schema: catalog; Owner: -
--

ALTER TABLE ONLY catalog.plan_versions
    ADD CONSTRAINT plan_versions_pkey PRIMARY KEY (id);


--
-- Name: call_policies uq_call_policies_route; Type: CONSTRAINT; Schema: catalog; Owner: -
--

ALTER TABLE ONLY catalog.call_policies
    ADD CONSTRAINT uq_call_policies_route UNIQUE (plan_version_id, media_type, connection_route);


--
-- Name: plan_versions uq_plan_versions_code_revision; Type: CONSTRAINT; Schema: catalog; Owner: -
--

ALTER TABLE ONLY catalog.plan_versions
    ADD CONSTRAINT uq_plan_versions_code_revision UNIQUE (code, revision);


--
-- Name: active_calls active_calls_pkey; Type: CONSTRAINT; Schema: communication; Owner: -
--

ALTER TABLE ONLY communication.active_calls
    ADD CONSTRAINT active_calls_pkey PRIMARY KEY (principal_id);


--
-- Name: call_invitations call_invitations_code_hash_key; Type: CONSTRAINT; Schema: communication; Owner: -
--

ALTER TABLE ONLY communication.call_invitations
    ADD CONSTRAINT call_invitations_code_hash_key UNIQUE (code_hash);


--
-- Name: call_invitations call_invitations_pkey; Type: CONSTRAINT; Schema: communication; Owner: -
--

ALTER TABLE ONLY communication.call_invitations
    ADD CONSTRAINT call_invitations_pkey PRIMARY KEY (call_session_id);


--
-- Name: call_participants call_participants_pkey; Type: CONSTRAINT; Schema: communication; Owner: -
--

ALTER TABLE ONLY communication.call_participants
    ADD CONSTRAINT call_participants_pkey PRIMARY KEY (call_session_id, principal_id);


--
-- Name: call_sessions call_sessions_pkey; Type: CONSTRAINT; Schema: communication; Owner: -
--

ALTER TABLE ONLY communication.call_sessions
    ADD CONSTRAINT call_sessions_pkey PRIMARY KEY (id);


--
-- Name: call_participants uq_call_participant_device; Type: CONSTRAINT; Schema: communication; Owner: -
--

ALTER TABLE ONLY communication.call_participants
    ADD CONSTRAINT uq_call_participant_device UNIQUE (call_session_id, device_id);


--
-- Name: account_audit account_audit_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.account_audit
    ADD CONSTRAINT account_audit_pkey PRIMARY KEY (id);


--
-- Name: account_event_sequences account_event_sequences_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.account_event_sequences
    ADD CONSTRAINT account_event_sequences_pkey PRIMARY KEY (principal_id);


--
-- Name: account_event_tickets account_event_tickets_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.account_event_tickets
    ADD CONSTRAINT account_event_tickets_pkey PRIMARY KEY (token_hash);


--
-- Name: account_event_tickets account_event_tickets_session_id_key; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.account_event_tickets
    ADD CONSTRAINT account_event_tickets_session_id_key UNIQUE (session_id);


--
-- Name: account_events account_events_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.account_events
    ADD CONSTRAINT account_events_pkey PRIMARY KEY (principal_id, sequence);


--
-- Name: account_outbox account_outbox_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.account_outbox
    ADD CONSTRAINT account_outbox_pkey PRIMARY KEY (audit_id);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (principal_id);


--
-- Name: activation_operations activation_operations_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.activation_operations
    ADD CONSTRAINT activation_operations_pkey PRIMARY KEY (principal_id, operation_key);


--
-- Name: auth_sessions auth_sessions_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.auth_sessions
    ADD CONSTRAINT auth_sessions_pkey PRIMARY KEY (id);


--
-- Name: devices devices_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.devices
    ADD CONSTRAINT devices_pkey PRIMARY KEY (id);


--
-- Name: email_challenges email_challenges_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.email_challenges
    ADD CONSTRAINT email_challenges_pkey PRIMARY KEY (id);


--
-- Name: email_outbox email_outbox_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.email_outbox
    ADD CONSTRAINT email_outbox_pkey PRIMARY KEY (id);


--
-- Name: email_suppressions email_suppressions_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.email_suppressions
    ADD CONSTRAINT email_suppressions_pkey PRIMARY KEY (email_canonical);


--
-- Name: email_webhook_events email_webhook_events_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.email_webhook_events
    ADD CONSTRAINT email_webhook_events_pkey PRIMARY KEY (provider_event_id);


--
-- Name: enrollment_challenges enrollment_challenges_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.enrollment_challenges
    ADD CONSTRAINT enrollment_challenges_pkey PRIMARY KEY (id);


--
-- Name: principals principals_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.principals
    ADD CONSTRAINT principals_pkey PRIMARY KEY (id);


--
-- Name: recovery_code_sets recovery_code_sets_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.recovery_code_sets
    ADD CONSTRAINT recovery_code_sets_pkey PRIMARY KEY (id);


--
-- Name: recovery_codes recovery_codes_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.recovery_codes
    ADD CONSTRAINT recovery_codes_pkey PRIMARY KEY (id);


--
-- Name: recovery_emails recovery_emails_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.recovery_emails
    ADD CONSTRAINT recovery_emails_pkey PRIMARY KEY (principal_id);


--
-- Name: recovery_grants recovery_grants_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.recovery_grants
    ADD CONSTRAINT recovery_grants_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (token_hash);


--
-- Name: devices uq_devices_key; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.devices
    ADD CONSTRAINT uq_devices_key UNIQUE (noise_static_public_key);


--
-- Name: devices uq_devices_owner; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.devices
    ADD CONSTRAINT uq_devices_owner UNIQUE (id, principal_id);


--
-- Name: recovery_grants uq_grant_token; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.recovery_grants
    ADD CONSTRAINT uq_grant_token UNIQUE (token_hash);


--
-- Name: recovery_codes uq_recovery_verifier; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.recovery_codes
    ADD CONSTRAINT uq_recovery_verifier UNIQUE (set_id, verifier);


--
-- Name: username_reservations username_reservations_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.username_reservations
    ADD CONSTRAINT username_reservations_pkey PRIMARY KEY (canonical);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: uq_plan_assignments_current; Type: INDEX; Schema: catalog; Owner: -
--

CREATE UNIQUE INDEX uq_plan_assignments_current ON catalog.plan_assignments USING btree (principal_id) WHERE (effective_until IS NULL);


--
-- Name: idx_active_calls_call; Type: INDEX; Schema: communication; Owner: -
--

CREATE INDEX idx_active_calls_call ON communication.active_calls USING btree (call_session_id);


--
-- Name: idx_call_participants_principal; Type: INDEX; Schema: communication; Owner: -
--

CREATE INDEX idx_call_participants_principal ON communication.call_participants USING btree (principal_id, call_session_id);


--
-- Name: idx_call_sessions_creator; Type: INDEX; Schema: communication; Owner: -
--

CREATE INDEX idx_call_sessions_creator ON communication.call_sessions USING btree (creator_principal_id, created_at DESC);


--
-- Name: idx_account_event_tickets_expiry; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_account_event_tickets_expiry ON iam.account_event_tickets USING btree (expires_at);


--
-- Name: idx_account_events_delivery; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_account_events_delivery ON iam.account_events USING btree (created_at) WHERE (delivered_at IS NULL);


--
-- Name: idx_account_events_expiry; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_account_events_expiry ON iam.account_events USING btree (expires_at);


--
-- Name: idx_activation_operations_expiry; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_activation_operations_expiry ON iam.activation_operations USING btree (expires_at);


--
-- Name: idx_auth_sessions_device; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_auth_sessions_device ON iam.auth_sessions USING btree (device_id);


--
-- Name: idx_devices_principal; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_devices_principal ON iam.devices USING btree (principal_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_email_challenges_email; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_email_challenges_email ON iam.email_challenges USING btree (email_canonical, created_at DESC);


--
-- Name: idx_email_outbox_due; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_email_outbox_due ON iam.email_outbox USING btree (next_attempt_at) WHERE ((delivered_at IS NULL) AND (failed_at IS NULL));


--
-- Name: idx_enroll_expires; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_enroll_expires ON iam.enrollment_challenges USING btree (expires_at);


--
-- Name: idx_recovery_codes_set; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_recovery_codes_set ON iam.recovery_codes USING btree (set_id) WHERE (consumed_at IS NULL);


--
-- Name: idx_recovery_grants_principal; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_recovery_grants_principal ON iam.recovery_grants USING btree (principal_id) WHERE ((used_at IS NULL) AND (revoked_at IS NULL));


--
-- Name: idx_refresh_tokens_session; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_refresh_tokens_session ON iam.refresh_tokens USING btree (auth_session_id);


--
-- Name: idx_username_reservations_owner; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_username_reservations_owner ON iam.username_reservations USING btree (principal_id) WHERE (principal_id IS NOT NULL);


--
-- Name: uq_accounts_username_ci; Type: INDEX; Schema: iam; Owner: -
--

CREATE UNIQUE INDEX uq_accounts_username_ci ON iam.accounts USING btree (lower(username));


--
-- Name: uq_email_challenge_active; Type: INDEX; Schema: iam; Owner: -
--

CREATE UNIQUE INDEX uq_email_challenge_active ON iam.email_challenges USING btree (purpose, principal_id, address_version) WHERE ((consumed_at IS NULL) AND (superseded_at IS NULL));


--
-- Name: uq_email_outbox_provider; Type: INDEX; Schema: iam; Owner: -
--

CREATE UNIQUE INDEX uq_email_outbox_provider ON iam.email_outbox USING btree (provider_message_id) WHERE (provider_message_id IS NOT NULL);


--
-- Name: uq_enroll_open_challenge; Type: INDEX; Schema: iam; Owner: -
--

CREATE UNIQUE INDEX uq_enroll_open_challenge ON iam.enrollment_challenges USING btree (principal_id) WHERE (consumed_at IS NULL);


--
-- Name: uq_recovery_email_address; Type: INDEX; Schema: iam; Owner: -
--

CREATE UNIQUE INDEX uq_recovery_email_address ON iam.recovery_emails USING btree (email_canonical);


--
-- Name: uq_recovery_set_active; Type: INDEX; Schema: iam; Owner: -
--

CREATE UNIQUE INDEX uq_recovery_set_active ON iam.recovery_code_sets USING btree (principal_id) WHERE (retired_at IS NULL);


--
-- Name: accounts trg_accounts_username_reservation; Type: TRIGGER; Schema: iam; Owner: -
--

CREATE TRIGGER trg_accounts_username_reservation BEFORE INSERT OR UPDATE OF username ON iam.accounts FOR EACH ROW EXECUTE FUNCTION iam.enforce_username_reservation();


--
-- Name: call_policies call_policies_plan_version_id_fkey; Type: FK CONSTRAINT; Schema: catalog; Owner: -
--

ALTER TABLE ONLY catalog.call_policies
    ADD CONSTRAINT call_policies_plan_version_id_fkey FOREIGN KEY (plan_version_id) REFERENCES catalog.plan_versions(id) ON DELETE CASCADE;


--
-- Name: plan_assignments plan_assignments_plan_version_id_fkey; Type: FK CONSTRAINT; Schema: catalog; Owner: -
--

ALTER TABLE ONLY catalog.plan_assignments
    ADD CONSTRAINT plan_assignments_plan_version_id_fkey FOREIGN KEY (plan_version_id) REFERENCES catalog.plan_versions(id) ON DELETE RESTRICT;


--
-- Name: plan_assignments plan_assignments_principal_id_fkey; Type: FK CONSTRAINT; Schema: catalog; Owner: -
--

ALTER TABLE ONLY catalog.plan_assignments
    ADD CONSTRAINT plan_assignments_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES iam.principals(id) ON DELETE CASCADE;


--
-- Name: active_calls active_calls_call_session_id_fkey; Type: FK CONSTRAINT; Schema: communication; Owner: -
--

ALTER TABLE ONLY communication.active_calls
    ADD CONSTRAINT active_calls_call_session_id_fkey FOREIGN KEY (call_session_id) REFERENCES communication.call_sessions(id) ON DELETE CASCADE;


--
-- Name: active_calls active_calls_principal_id_fkey; Type: FK CONSTRAINT; Schema: communication; Owner: -
--

ALTER TABLE ONLY communication.active_calls
    ADD CONSTRAINT active_calls_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES iam.principals(id) ON DELETE CASCADE;


--
-- Name: call_invitations call_invitations_call_session_id_fkey; Type: FK CONSTRAINT; Schema: communication; Owner: -
--

ALTER TABLE ONLY communication.call_invitations
    ADD CONSTRAINT call_invitations_call_session_id_fkey FOREIGN KEY (call_session_id) REFERENCES communication.call_sessions(id) ON DELETE CASCADE;


--
-- Name: call_participants call_participants_call_policy_id_fkey; Type: FK CONSTRAINT; Schema: communication; Owner: -
--

ALTER TABLE ONLY communication.call_participants
    ADD CONSTRAINT call_participants_call_policy_id_fkey FOREIGN KEY (call_policy_id) REFERENCES catalog.call_policies(id) ON DELETE RESTRICT;


--
-- Name: call_participants call_participants_call_session_id_fkey; Type: FK CONSTRAINT; Schema: communication; Owner: -
--

ALTER TABLE ONLY communication.call_participants
    ADD CONSTRAINT call_participants_call_session_id_fkey FOREIGN KEY (call_session_id) REFERENCES communication.call_sessions(id) ON DELETE CASCADE;


--
-- Name: call_participants call_participants_principal_id_fkey; Type: FK CONSTRAINT; Schema: communication; Owner: -
--

ALTER TABLE ONLY communication.call_participants
    ADD CONSTRAINT call_participants_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES iam.principals(id) ON DELETE RESTRICT;


--
-- Name: call_sessions call_sessions_creator_principal_id_fkey; Type: FK CONSTRAINT; Schema: communication; Owner: -
--

ALTER TABLE ONLY communication.call_sessions
    ADD CONSTRAINT call_sessions_creator_principal_id_fkey FOREIGN KEY (creator_principal_id) REFERENCES iam.principals(id) ON DELETE RESTRICT;


--
-- Name: call_participants fk_call_participant_device_owner; Type: FK CONSTRAINT; Schema: communication; Owner: -
--

ALTER TABLE ONLY communication.call_participants
    ADD CONSTRAINT fk_call_participant_device_owner FOREIGN KEY (device_id, principal_id) REFERENCES iam.devices(id, principal_id) ON DELETE RESTRICT;


--
-- Name: account_audit account_audit_principal_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.account_audit
    ADD CONSTRAINT account_audit_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES iam.principals(id) ON DELETE CASCADE;


--
-- Name: account_event_sequences account_event_sequences_principal_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.account_event_sequences
    ADD CONSTRAINT account_event_sequences_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES iam.principals(id) ON DELETE CASCADE;


--
-- Name: account_event_tickets account_event_tickets_device_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.account_event_tickets
    ADD CONSTRAINT account_event_tickets_device_id_fkey FOREIGN KEY (device_id) REFERENCES iam.devices(id) ON DELETE CASCADE;


--
-- Name: account_event_tickets account_event_tickets_principal_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.account_event_tickets
    ADD CONSTRAINT account_event_tickets_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES iam.principals(id) ON DELETE CASCADE;


--
-- Name: account_event_tickets account_event_tickets_session_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.account_event_tickets
    ADD CONSTRAINT account_event_tickets_session_id_fkey FOREIGN KEY (session_id) REFERENCES iam.auth_sessions(id) ON DELETE CASCADE;


--
-- Name: account_events account_events_principal_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.account_events
    ADD CONSTRAINT account_events_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES iam.principals(id) ON DELETE CASCADE;


--
-- Name: account_outbox account_outbox_audit_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.account_outbox
    ADD CONSTRAINT account_outbox_audit_id_fkey FOREIGN KEY (audit_id) REFERENCES iam.account_audit(id) ON DELETE CASCADE;


--
-- Name: accounts accounts_principal_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.accounts
    ADD CONSTRAINT accounts_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES iam.principals(id) ON DELETE CASCADE;


--
-- Name: activation_operations activation_operations_principal_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.activation_operations
    ADD CONSTRAINT activation_operations_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES iam.principals(id) ON DELETE CASCADE;


--
-- Name: auth_sessions auth_sessions_device_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.auth_sessions
    ADD CONSTRAINT auth_sessions_device_id_fkey FOREIGN KEY (device_id) REFERENCES iam.devices(id) ON DELETE CASCADE;


--
-- Name: devices devices_principal_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.devices
    ADD CONSTRAINT devices_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES iam.principals(id) ON DELETE CASCADE;


--
-- Name: email_challenges email_challenges_principal_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.email_challenges
    ADD CONSTRAINT email_challenges_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES iam.principals(id) ON DELETE CASCADE;


--
-- Name: email_outbox email_outbox_challenge_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.email_outbox
    ADD CONSTRAINT email_outbox_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES iam.email_challenges(id) ON DELETE CASCADE;


--
-- Name: enrollment_challenges enrollment_challenges_principal_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.enrollment_challenges
    ADD CONSTRAINT enrollment_challenges_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES iam.principals(id) ON DELETE CASCADE;


--
-- Name: recovery_code_sets recovery_code_sets_principal_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.recovery_code_sets
    ADD CONSTRAINT recovery_code_sets_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES iam.principals(id) ON DELETE CASCADE;


--
-- Name: recovery_codes recovery_codes_set_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.recovery_codes
    ADD CONSTRAINT recovery_codes_set_id_fkey FOREIGN KEY (set_id) REFERENCES iam.recovery_code_sets(id) ON DELETE CASCADE;


--
-- Name: recovery_emails recovery_emails_principal_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.recovery_emails
    ADD CONSTRAINT recovery_emails_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES iam.principals(id) ON DELETE CASCADE;


--
-- Name: recovery_grants recovery_grants_principal_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.recovery_grants
    ADD CONSTRAINT recovery_grants_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES iam.principals(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_auth_session_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.refresh_tokens
    ADD CONSTRAINT refresh_tokens_auth_session_id_fkey FOREIGN KEY (auth_session_id) REFERENCES iam.auth_sessions(id) ON DELETE CASCADE;


--
-- Name: username_reservations username_reservations_principal_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.username_reservations
    ADD CONSTRAINT username_reservations_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES iam.principals(id) ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--

\unrestrict 8TC2pBPldy1ZbKAX0rKtuor2y7bDYSQrKtr22l8xr1dPHOhAaPpbYXDRdp1XkbZ

