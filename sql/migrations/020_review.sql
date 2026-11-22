-- Executable migration: backend/migrations/020_account_event_tickets.sql
-- Review and verification only. The Go migrator does not load this file.

-- Migration 020: account event stream tickets

-- This additive migration creates `iam.account_event_tickets` and its expiry index. It stores only a SHA-256 ticket hash, principal, device, session, authorization generation and expiry. A session has at most one unconsumed ticket. No existing rows are changed.

-- Prerequisites: review and apply migrations 014–019 in order on the intended target; the application role needs SELECT, INSERT, UPDATE and DELETE on the ticket table and DELETE on expired `iam.account_events` for the retention worker. Apply 020 before deploying the event-enabled backend. Existing bootstrap now reads the 019 sequence table, including for clients that do not request the cursor. Apply 019 before deploying this backend. Deploy the backend before the Expo client.

-- The migration creates a table and indexes and therefore takes normal PostgreSQL DDL locks; it does not lock existing account rows. Ticket issuance replaces the session's prior ticket in one statement; stream authorization consumes it atomically. Runtime retention runs bounded deletes once per minute per replica. Review resource use and the seven-day retention in migration 019 before rollout.

-- Verification (read only):

-- Read-only verification.
SELECT to_regclass('iam.account_event_tickets'), to_regclass('iam.account_events');
SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'iam' AND tablename = 'account_event_tickets';
SELECT has_table_privilege(current_user, 'iam.account_event_tickets', 'SELECT,INSERT,UPDATE,DELETE'),
       has_table_privilege(current_user, 'iam.account_events', 'DELETE');


-- After deployment, verify recipient isolation, single-use tickets, expiry and retention on an explicitly authorized isolated target. Roll back by first stopping the event-enabled app and client, then restoring compatible backend code. Preserve migration 019 event data until cursor resynchronization is reviewed. Dropping the ticket table invalidates pending tickets; do that only as a separately reviewed database operation. This migration has not been executed by the agent.
