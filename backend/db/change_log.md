# Database change log

This is a human-maintained summary, not an executable migration source. Ordered SQL migrations in `backend/migrations/` remain authoritative for upgrades. Do not use this log to mark migrations applied or invent migration checksums.

## Entry format

For each schema change, add an entry describing:

- **Date / migration:** ISO date and exact ordered migration filename.
- **Purpose:** User-visible or operational reason.
- **Objects and data:** Schemas, tables, columns, indexes, constraints, routines, triggers, extensions, grants, and any affected rows.
- **Prerequisites / rollout:** Required roles/extensions, deployment order, and compatibility considerations.
- **Verification:** Read-only verification queries or checks.
- **Rollback / recovery:** Safe reversal or forward-recovery limitations.
- **Baseline:** Whether `schema/baseline.sql` was regenerated from an authorized disposable database and parity checked against sequential migrations.

No schema-change entries are recorded here yet. `schema/baseline.sql` was generated and restore-parity verified on 2026-11-24 for migrations 001–020 (41,822 bytes, SHA-256 `2c484bf042212151b7da1ab23a55791e993a255f9499ea71e9d30c6523a8703a`; project `ipv6ftp-it-34e102e8acb1d48f`). Do not infer schema contents from migration filenames or hand-author baseline SQL; regenerate through the Compose harness after any migration change.

## Generator and parity status

`go run ./cmd/schema-baseline --check` is an offline placeholder check only. Use the [disposable Compose harness](../../docs/voice-architecture/deployment.md) for generation. It replays ordered migrations in the source database; the CLI restores the dump into the fresh restore database in one transaction and publishes atomically only if normalized schema-only dumps agree. It leaves the default `public` schema intact. Dumps include constraints, comments and ACLs; they exclude ownership and row data (including seed and migration-ledger rows). The baseline is a reference, not a replacement for migration replay.

The source and restore libpq service entries currently use `127.0.0.1:5432`, and the generator verifies the two expected database names/comments independently. These facts do not prove common server/cluster identity; neither check queries a cluster identity. Do not claim same-cluster verification from marker checks alone.

Earlier disposable runs failed parity without publishing because resetting PostgreSQL's default `public` schema altered its metadata. The corrected restore path (no `public` reset) passed offline tests and the subsequent operator-run Compose check: restore parity succeeded and the baseline above was published.
