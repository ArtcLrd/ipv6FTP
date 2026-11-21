# Migration 017 review: profile lifecycle

Status: **prepared, not applied.** The user reviews and runs it (`go run ./cmd/migrate up` applies every pending migration in one transaction). Never run against anything but a database you have backed up.

## Purpose
Support username change (30-day cooldown, owner-private reservation of old names, retired names) and seven-day account deletion with cancellation.

## Affected objects
- `iam.accounts`: new columns `username_changed_at`, `deletion_requested_at`, `deletion_deadline`, `profile_revision` (default 1); constraints `chk_accounts_deletion_pair`, `chk_accounts_deletion_deadline`. Existing rows get NULL/NULL/NULL/1, so every existing account stays active.
- New table `iam.username_reservations` (`canonical` PK; `kind` `former` or `retired`; `principal_id` set only for `former`; `ON DELETE RESTRICT`).
- New function `iam.enforce_username_reservation()` and trigger `trg_accounts_username_reservation` (BEFORE INSERT OR UPDATE OF username). It takes a per-name advisory lock and rejects a name reserved to another account or retired, with SQLSTATE 23505. This also covers the legacy v1 `/auth/register`.
- No data is rewritten or deleted.

## Prerequisites
Migrations 014 and 016 applied (checked by the migration itself).

## Rollout order
1. Back up the database.
2. Apply 017 **before** deploying this backend build. The build's v1 login and profile queries read `iam.accounts.deletion_deadline` so pending-deletion accounts cannot sign in; without 017 they fail with "column does not exist".
3. Set `RECOVERY_PEPPER` and `EMAIL_PAYLOAD_KEY` (the lifecycle routes are disabled without them).

## Verification SQL
```sql
SELECT column_name FROM information_schema.columns
 WHERE table_schema='iam' AND table_name='accounts'
   AND column_name IN ('username_changed_at','deletion_requested_at','deletion_deadline','profile_revision');  -- 4 rows
SELECT to_regclass('iam.username_reservations');                                                             -- not null
SELECT tgname FROM pg_trigger WHERE tgrelid='iam.accounts'::regclass AND tgname='trg_accounts_username_reservation'; -- 1 row
SELECT count(*) FROM iam.accounts WHERE deletion_deadline IS NOT NULL;                                        -- 0
```

## Rollback / recovery
Before any user changes a name or requests deletion, rollback is safe:
```sql
DROP TRIGGER trg_accounts_username_reservation ON iam.accounts;
DROP FUNCTION iam.enforce_username_reservation();
DROP TABLE iam.username_reservations;
ALTER TABLE iam.accounts DROP CONSTRAINT chk_accounts_deletion_pair, DROP CONSTRAINT chk_accounts_deletion_deadline,
  DROP COLUMN username_changed_at, DROP COLUMN deletion_requested_at, DROP COLUMN deletion_deadline, DROP COLUMN profile_revision;
```
After use, dropping loses reservations and pending-deletion state (a pending account would silently become active again and former names become claimable); restore from backup instead.

## Known limits
- The purge worker (seven days after the deadline) is not implemented. It must convert `former` reservations to `retired` before deleting a principal; `ON DELETE RESTRICT` enforces that.
- Deletion does not yet fence active calls or invitations (M8 call integration).
