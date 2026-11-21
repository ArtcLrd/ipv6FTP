# Migration 019 review

Migration 019 prepares account-scoped event sequencing and retained event records. It creates `iam.account_event_sequences` and `iam.account_events` with indexes. No existing data is modified.

The prepared `iam.append_account_event` function advances the recipient's sequence and inserts a version-one event with seven-day retention in the caller's transaction. Sequence updates roll back with the mutation. Seven days is a proposed retention default that must be reviewed alongside cursor expiry before rollout.

The current account mutation code calls this function for username, credential, deletion, and session revocation changes, including revocation caused by refresh-token reuse and the legacy logout-all path. These revocation paths emit only on the first state change and write the audit and event records in the revocation transaction. The event-enabled backend reads this table for bootstrap and recipient-scoped stream delivery. It also requires migration 020 for stream tickets; applying 019 alone does not enable the complete stream.

The API role needs `SELECT`, `INSERT`, and `UPDATE` on `iam.account_event_sequences`, `SELECT`, `INSERT` and `DELETE` on `iam.account_events`, and `EXECUTE` on `iam.append_account_event(uuid,text,jsonb)`. The retention worker uses DELETE in bounded batches. Verify with `has_table_privilege` and `has_function_privilege` while connected as the actual runtime role.

Apply migrations 014 through 018 first. Review API and worker role privileges and the retention and delivery implementation before applying 019. PostgreSQL creates new tables and indexes during the migration transaction. Writers must update the principal's sequence row and insert the event in the same transaction as the account mutation. Review account-lock ordering when implementing those writes.

Verify with `SELECT to_regclass('iam.account_event_sequences'), to_regclass('iam.account_events');` and inspect indexes through `pg_indexes` for schema `iam`. Validate transaction rollback and recipient isolation on a separately authorized isolated database.

For rollback, stop event writers and consumers before reverting application code. Dropping these tables discards retained events and cursors. Preserve them until the rollback and resynchronization procedure has been reviewed.
