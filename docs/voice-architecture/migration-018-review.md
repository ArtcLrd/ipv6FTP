# Migration 018 review

Migration 018 adds the credential version, device generation, and chosen server key ID to enrollment challenges. The columns are nullable for rows issued by the previous server. The upgraded server requires a fresh setup grant and challenge for any enrollment started on the previous server.

It creates `iam.account_audit`, `iam.account_outbox`, and `iam.activation_operations`. Audit and outbox entries share the mutation transaction. The activation table stores the operation key, fingerprint, and 24-hour expiry. Its primary key scopes each key to the account.

## Prerequisites and rollout

Confirm migrations 015–017 against the intended target. Apply 018 before deploying the backend that reads the new columns. PostgreSQL takes an exclusive table lock for the schema change and scans the table to validate the constraint. Schedule the change around challenge traffic and check for long-running transactions first.

## Read-only preflight

```sql
BEGIN READ ONLY;
SELECT version, name FROM public.schema_migrations
WHERE version IN ('015', '016', '017', '018') ORDER BY version;

SELECT to_regclass('iam.account_audit'), to_regclass('iam.account_outbox'),
       to_regclass('iam.activation_operations'),
       to_regprocedure('iam.record_account_operation(uuid,text,uuid)');

SELECT principal_id, username FROM iam.accounts
WHERE username COLLATE "C" !~ '^[a-z0-9_]{3,30}$'
ORDER BY principal_id;

SELECT lower(btrim(username)) AS canonical, array_agg(principal_id ORDER BY principal_id) AS principals
FROM iam.accounts
GROUP BY lower(btrim(username)) HAVING count(*) > 1
ORDER BY canonical;

-- Run this query after confirming migration 017 is present.
SELECT a.principal_id, a.username, r.kind
FROM iam.accounts a
JOIN iam.username_reservations r ON r.canonical = lower(btrim(a.username))
WHERE r.kind = 'retired' OR r.principal_id IS DISTINCT FROM a.principal_id
ORDER BY a.principal_id;

SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'iam' AND (
    (table_name = 'accounts' AND column_name IN ('device_generation', 'activated_at',
        'credential_version', 'deletion_deadline', 'profile_revision'))
    OR (table_name = 'enrollment_challenges' AND column_name IN
        ('credential_version', 'device_generation', 'server_key_id', 'rotation_supported'))
) ORDER BY table_name, column_name;
COMMIT;
```

After applying 018, confirm the four challenge columns and three account operation tables are present. Review historical usernames before cutover. Keep current account names and IDs during this migration.

The API role needs access to the enrollment challenge table from 015 and the new tables in 018. Migration 014 granted access to tables that existed at the time. When the API connects as `ipv6ftp_api` and the required privileges aren't already inherited, review and apply these grants as the object owner before deploying the updated backend.

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON iam.enrollment_challenges TO ipv6ftp_api;
GRANT SELECT, INSERT, UPDATE ON iam.recovery_code_sets, iam.recovery_codes, iam.recovery_grants TO ipv6ftp_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON iam.username_reservations TO ipv6ftp_api;
GRANT SELECT, INSERT ON iam.account_audit TO ipv6ftp_api;
GRANT INSERT ON iam.account_outbox TO ipv6ftp_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON iam.activation_operations TO ipv6ftp_api;
GRANT EXECUTE ON FUNCTION iam.record_account_operation(uuid,text,uuid) TO ipv6ftp_api;
```

Verify on the isolated target using the same runtime role as the deployed API. The audit function runs with the caller's privileges. Audit and outbox records reference the principal and optional session. After 018, the following checks should return true for the API role.

```sql
SELECT has_schema_privilege(current_user, 'iam', 'USAGE') AS iam_usage,
       has_table_privilege(current_user, 'iam.account_audit', 'INSERT')
           AND has_column_privilege(current_user, 'iam.account_audit', 'id', 'SELECT') AS audit_write,
       has_table_privilege(current_user, 'iam.account_outbox', 'INSERT') AS outbox_write,
       has_table_privilege(current_user, 'iam.activation_operations', 'SELECT')
           AND has_table_privilege(current_user, 'iam.activation_operations', 'INSERT')
           AND has_table_privilege(current_user, 'iam.activation_operations', 'UPDATE')
           AND has_table_privilege(current_user, 'iam.activation_operations', 'DELETE') AS activation_operations_access,
       has_function_privilege(current_user, 'iam.record_account_operation(uuid,text,uuid)', 'EXECUTE') AS operation_execute;
```

## Legacy cutover

1. Run the preflight and verify migration 018 and runtime privileges on the intended target. Run `TestPostgresRegisteredEnrollment` against the authorized migrated isolated database before rollout.
2. Deploy the backend with `V1_CREDENTIAL_ISSUANCE=staging`. Keep the existing `NOISE_STATIC_KEY` and `NOISE_KEY_ID` current. Configure `ENROLLMENT_ROTATION_ORIGIN`, `ENROLLMENT_ROTATION_SIGNER`, and `ENROLLMENT_ROTATION_EPOCH` so the new app learns the signer through an authenticated finish on the current key.
3. Ship the Android build after native acceptance. Verify clients that enrolled before and after signer configuration can enroll with the existing key and that a new client persists the signer. Verify the fingerprint and rotation opt-ins preserve the original response shape for clients that omit them.
4. Set `V1_CREDENTIAL_ISSUANCE=upgrade_required` across all replicas and confirm legacy issuers are drained. Register, login and refresh must return HTTP 426 with `upgrade_required`. Expo should display update guidance and halt legacy auth retries. Run the following separately reviewed retirement step on the intended deployment database.

```sql
UPDATE iam.auth_sessions s
SET revoked_at = now()
FROM iam.devices d JOIN iam.accounts a ON a.principal_id = d.principal_id
WHERE s.device_id = d.id AND a.device_generation = 0 AND s.revoked_at IS NULL;

SELECT count(*) AS unrevoked_legacy_sessions
FROM iam.auth_sessions s
JOIN iam.devices d ON d.id = s.device_id
JOIN iam.accounts a ON a.principal_id = d.principal_id
WHERE a.device_generation = 0 AND s.revoked_at IS NULL;
```

5. Require zero unrevoked generation-zero sessions. Verify legacy access and refresh credentials issued before retirement remain invalid when the issuance setting returns to staging in the isolated test environment. Keep the revocation timestamps during rollback.
6. Rotate after checking signing-pin uptake and rehearsing overlap in staging. Load the existing X25519 key and ID as `ENROLLMENT_PREVIOUS_KEY` and `ENROLLMENT_PREVIOUS_KEY_ID`, switch the current key and ID, and increase the epoch. Route enrollment traffic to the updated replica pool as a unit so an old replica cannot receive a finish for a successor-key challenge. Keep the previous key on all finish-serving replicas until at least two minutes after the last old-key challenge was issued. Verify an old-key challenge can finish during overlap and a fresh challenge proves possession against the signed successor.

## Recovery

Prefer leaving the additive columns in place during a rollback. Quiesce enrollment traffic and allow in-flight challenges to expire before swapping builds. An older backend lacks the new transaction checks, so keep enrollment disabled during an emergency rollback until a compatible build is available.
