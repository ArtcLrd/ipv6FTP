-- Executable migration: backend/migrations/016_account_security.sql
-- Review and verification only. The Go migrator does not load this file.

-- Migration 016 review: account security

-- Status: **applied by the user to the local development database `ipv6ftp` on 2026-11-01**, together with 014 (`go run ./cmd/migrate up --allow-destructive-reset`, after a verified `pg_dump`). `migrate status` reported every migration applied. The verification SQL below has not been run or reported. The agent did not connect to or modify any database and has not exercised these tables.

-- Purpose
-- Persistence for M3: saved recovery codes, one unique verified recovery email per account, email challenges, recovery grants, an encrypted email delivery queue, webhook replay records and bounce suppression. Rules and limits come from the implementation plan (../../docs/voice-architecture/user-management-implementation-plan.md) and `backend/internal/accountpolicy`.

-- Affected objects
-- - Altered: `iam.accounts` gains `credential_version INTEGER NOT NULL DEFAULT 1` and `recovery_ack_at TIMESTAMPTZ NULL`. Both are metadata-only on modern PostgreSQL (constant default), so no table rewrite.
-- - New: `iam.recovery_code_sets`, `iam.recovery_codes`, `iam.recovery_emails`, `iam.email_challenges`, `iam.recovery_grants`, `iam.email_outbox`, `iam.email_webhook_events`, `iam.email_suppressions`.
-- - No existing rows are changed. Existing users have `recovery_ack_at IS NULL`, which makes the app require recovery-code setup after their next login.

-- Prerequisites
-- - Migration 014 must be applied (the file checks that `iam.accounts` exists). **Migration 015 is not written yet and is not required by 016.**
-- - The deployed schema has not been inventoried; confirm with a read-only check that `iam.accounts` matches 014 before running.
-- - Backend configuration (not in this migration): a recovery pepper (at least 16 bytes) and an email payload encryption key with a key version.

-- Rollout order
-- 1. Review and approve the SQL.
-- 2. You run the migration.
-- 3. Deploy the backend build that uses these tables. The backend must not enable v2 recovery routes until the migration is applied.

-- Locks and risks
-- - `ALTER TABLE ... ADD COLUMN` takes a brief ACCESS EXCLUSIVE lock on `iam.accounts`. Run during low traffic.
-- - Recovery verifiers are 32-byte keyed hashes. A lost pepper makes every stored code unusable and forces regeneration.
-- - Cleanup of expired challenges, grants and outbox rows is a worker job and is not part of this file.

-- Verification SQL (read-only)
-- Read-only verification.
SELECT column_name FROM information_schema.columns
 WHERE table_schema='iam' AND table_name='accounts' AND column_name IN ('credential_version','recovery_ack_at');
SELECT table_name FROM information_schema.tables
 WHERE table_schema='iam' AND table_name IN ('recovery_code_sets','recovery_codes','recovery_emails',
   'email_challenges','recovery_grants','email_outbox','email_webhook_events','email_suppressions');
SELECT indexname FROM pg_indexes WHERE schemaname='iam'
 AND indexname IN ('uq_recovery_set_active','uq_recovery_email_address','uq_email_challenge_active');


-- Rollback and recovery
-- Rollback is manual: drop the new tables and the two added columns. Do this only if no recovery data must be kept, because dropping `credential_version` and `recovery_codes` discards security state. Rolling back must not re-enable revoked sessions or old recovery grants. Prefer disabling the v2 routes over dropping tables.

-- Known gaps
-- - No `ON DELETE` handling for permanent account deletion beyond cascade. The M4 deletion worker will own purge order.
-- - `email_challenges.principal_id` is NULL-able; the unique active-challenge index does not constrain NULL owners. Account recovery by email challenges the owner of a verified address, so the service must set it. A follow-up could add a check.
