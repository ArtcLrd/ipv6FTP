# Migration 014 review and recovery

## Purpose

`014_native_ipv6_voice_reset.sql` replaces the development application's legacy and parallel schemas with the minimum identity, authentication, plan, and call records needed by the native IPv6 voice flow. It intentionally discards existing application accounts, sessions, contacts, prompts, invitations, and call history.

The migration is prepared for review. It has not been applied by the code agent.

## Execution guard

The migration fails unless the Go migrator sets `app.allow_destructive_reset=on` in the same transaction. After reviewing the target and taking any wanted backup, run from `backend/`:

```powershell
go run ./cmd/migrate up --allow-destructive-reset
```

Running the migrator without the flag remains safe and stops at migration 014.

## Explicitly affected objects

- Drops the application-owned schemas `api`, `app_private`, `worker`, `audit`, `communication`, `catalog`, and `iam`, including their contained objects.
- Drops the legacy public tables `contacts`, `phonebook`, `sessions`, and `users`.
- Recreates only the `iam`, `catalog`, and `communication` schemas described in the maintained architecture documents.

It does not drop `public`, `public.schema_migrations`, extensions, cluster roles, or objects outside the allowlist above.

## Prerequisites

- Migrations 001 through 013 must be present with their recorded checksums.
- Migration 013 must already be recorded in `public.schema_migrations` during the migrator transaction.
- The migrator role needs ownership privileges for the application schemas it removes and recreates.
- Stop the old API before applying the migration. It is incompatible with the replacement schema.

## Verification SQL

```sql
SELECT version, name, applied_at
FROM public.schema_migrations
WHERE version = '014';

SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema IN ('iam', 'catalog', 'communication')
ORDER BY table_schema, table_name;

SELECT code, revision
FROM catalog.plan_versions;

SELECT pv.code, cp.media_type, cp.connection_route,
       cp.max_call_seconds, cp.max_period_seconds, cp.period_seconds
FROM catalog.call_policies cp
JOIN catalog.plan_versions pv ON pv.id = cp.plan_version_id;

SELECT to_regclass('public.schema_migrations') AS migration_history,
       to_regclass('public.users') AS removed_legacy_users;
```

Expected results are one `registered_free` plan revision, one unlimited `voice/direct_ipv6` policy, a present migration-history table, and a null legacy `public.users` relation.

## Recovery

The migration is transactional: an error before commit restores the previous schema automatically. After a successful commit, recovery requires restoring the database backup or creating a fresh development database and applying the desired migration set. There is no down migration because deleted application data cannot be reconstructed from the replacement schema.
