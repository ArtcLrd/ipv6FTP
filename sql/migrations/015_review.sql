-- Executable migration: backend/migrations/015_enrollment.sql
-- Review and verification only. The Go migrator does not load this file.

-- Migration 015 review: device enrollment

-- Status: **prepared, not applied.** The user reviews and runs it (`go run ./cmd/migrate up` applies every pending migration in one transaction). Back up first.

-- Purpose
-- Support Noise IK device enrollment: single-use challenges whose nonce is bound into the handshake prologue, a device-ownership generation, and an activation marker.

-- Affected objects
-- - `iam.accounts`: new columns `device_generation BIGINT NOT NULL DEFAULT 0` and `activated_at TIMESTAMPTZ` (NULL). Existing accounts keep generation 0 and report `recovery_setup` until they acknowledge recovery codes and call activate (D13).
-- - New table `iam.enrollment_challenges` (`id`, `principal_id`, 32-byte `nonce`, `expires_at`, `consumed_at`) with a partial unique index allowing one open challenge per account.
-- - No data is rewritten or deleted.

-- Prerequisites
-- Migration 014 (checked by the migration). Numbering: 015 sorts before the already applied 016, but the migrator records each file by version and applies any pending one on the next `up`; 015 depends on nothing from 016/017.

-- Rollout order
-- 1. Back up the database.
-- 2. Apply 015 (together with 017 if it is still pending).
-- 3. Generate the server enrollment key and set both variables in `backend/.env` yourself (do not paste them anywhere): PowerShell
--    `$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Fill($b); [Convert]::ToBase64String($b)` gives `NOISE_STATIC_KEY`; pick a label such as `k1` for `NOISE_KEY_ID`. `RECOVERY_PEPPER` and `EMAIL_PAYLOAD_KEY` must already be set.
-- 4. Deploy the backend. Without `NOISE_STATIC_KEY` the enrollment routes answer 503 and nothing else changes.

-- Verification SQL
-- Read-only verification.
SELECT column_name FROM information_schema.columns WHERE table_schema='iam' AND table_name='accounts'
  AND column_name IN ('device_generation','activated_at');                       -- 2 rows
SELECT to_regclass('iam.enrollment_challenges');                                  -- not null
SELECT indexname FROM pg_indexes WHERE tablename='enrollment_challenges';         -- includes uq_enroll_open_challenge
SELECT count(*) FROM iam.accounts WHERE device_generation <> 0 OR activated_at IS NOT NULL;  -- 0 right after applying


-- Rollback / recovery
-- Safe before any enrollment ran:
-- Reference commands (review before use).
-- DROP TABLE iam.enrollment_challenges;
-- ALTER TABLE iam.accounts DROP COLUMN device_generation, DROP COLUMN activated_at;

-- After enrollments ran, dropping loses generations and activation state; restore from backup instead.

-- Known limits
-- - Server-key rotation depends on migration 018 and an authenticated P-256 signer pin. See the migration 018 review (018_review.sql).
-- - Expired/consumed challenges are not purged yet (the `expires_at` index is ready for a worker).
-- - Guest enrollment is not covered (milestone M5).
