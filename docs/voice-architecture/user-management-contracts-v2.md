# User-management v2 contracts (M0 draft)

Status: **contract freeze draft with partial implementation.** It expands section 3 of the [implementation plan](user-management-implementation-plan.md); [system.md](system.md) and [Session V2](session-management-proposed-v2.md) remain canonical. See [implementation evidence](user-management-evidence.md) for current source and verification status. Items marked **OPEN** need resolution before the owning milestone ships.

## Implementation evidence

Enrollment challenge and encrypted session grant responses now include `principal_id`. Expo checks their equality before handing the grant to a future session coordinator. The Android bridge implements the initiator and first-use pin persistence. A changed pin fails closed pending authenticated rotation. Challenge issuance prunes at most 32 expired challenges per request. The login UI and durable activation flow remain pending.

Expo now includes the enrollment and session fixture schemas. The three public recovery POST routes explicitly omit credentials. V2 setup authorization and staged v1 issuance are enforced by the server. See the [evidence matrix](user-management-evidence.md) for the distinction between source, mocks, and integration results.

| Item | State |
| --- | --- |
| `backend/internal/accountpolicy` (password and username rules, recovery codes, email challenges and resend limits, idempotency fingerprints, fresh-auth, username cooldown, deletion window, history retention) | Implemented and unit tested (pure logic, no I/O). Not yet wired into any handler, service or migration. |
| `backend/internal/transport/http/contracts` (strict decoder: 16 KiB limit, unknown fields, trailing data, method check; error codes and status map; request types for fresh-auth, password change, recovery begin/prove/complete, email challenge/verify, username change, deletion; bootstrap snapshot) | Implemented and unit tested. Not yet routed. |
| `frontend/src/core/api/contractsV2.ts` (strict Zod mirrors) | Implemented. Both sides pass the shared fixtures in `backend/testdata/contracts/v2` (10 valid, 16 invalid). The common-password fixture is server-only because the client has no blocklist. |
| `backend/internal/service/account_security.go` (recovery-code issue/ack/regeneration, password change, saved-code and email recovery begin/prove/complete, recovery-email verification, AES-GCM encrypted outbox payloads) behind an `AccountSecurityRepo` interface | Implemented; 14 tests against an in-memory fake that models the required atomicity. No PostgreSQL repository, handlers, routes, delivery worker or Resend adapter exist yet. |
| `backend/migrations/016_account_security.sql` plus [review note](migration-016-review.md) | Applied by the user to local dev database `ipv6ftp` on 2026-11-01 (after 014). Verification SQL pending; no repository code or tests have exercised these tables yet. |
| `frontend/src/modules/account` (strict-contract API client, recovery reducer/hook), `RecoveryPage`, `RecoveryCodesPanel`, "Forgot password?" link and `Recovery` route | Implemented; 27 mocked tests (client validation, idempotency headers, malformed responses, generic errors, double-submit guard, full page walkthrough). Calls fail until `/api/v2` exists. Response contracts (recovery, codes, fresh-auth, email challenge) share the fixtures above. |
| `backend/internal/repository/accountsec` (PostgreSQL `AccountSecurityRepo`), `handlers/account_security_handler.go`, `bootstrap/account_security.go`, nine `/api/v2` routes in `router.go` (recovery begin/prove/complete public; reauth, password, recovery-codes, email challenge/verify, ack-recovery-codes authenticated) | Written; compiles; `go vet` and `go test ./internal/...` pass using mocks/fakes and a static schema check against migrations 014/016. **The repository has never run against a real database.** Routes fail closed (503 `unavailable`) unless `RECOVERY_PEPPER` and `EMAIL_PAYLOAD_KEY` are set. Not implemented: email delivery worker/Resend adapter, per-route rate limits, server-side idempotency store (migration 015), post-login recovery-code acknowledgement gate. Authentication failures on v2 routes still use the v1 middleware error shape. |
| Profile lifecycle (M4 part): `service/account_lifecycle.go`, `accountsec/lifecycle.go`, `handlers/account_lifecycle_handler.go`, [migration 017](migration-017-review.md), nine routes: `GET /api/v2/account/profile`, `GET /api/v2/usernames/availability`, `POST /api/v2/account/username`, `POST /api/v2/account/deletion`, `POST /api/v2/account/deletion/status` and `/cancel` (credentialed, because requesting deletion revokes every session), `GET /api/v2/account/sessions`, `POST /api/v2/account/sessions/revoke`, `POST /api/v2/auth/logout-all` | Written; `go vet` and tests pass with fakes (service rules, handler contracts, router wiring, static schema check). **Migration 017 is prepared but NOT applied, and the repository has never run against a database.** The v1 login/profile queries now also require `deletion_deadline IS NULL`, so 017 must be applied before this build is deployed. Routes are disabled (503) unless account security is configured. Not implemented: purge worker and username retirement, call/invitation fencing on deletion, Expo screens and Zod mirrors for these contracts, per-route rate limits on the credentialed endpoints. |
| `backend/internal/noiseik` (Noise IK responder/initiator, prologue builder) + `backend/testdata/noise` | Implemented. Reproduces the official noise-c `Noise_IK_25519_ChaChaPoly_SHA256` vector byte for byte (both handshake messages, handshake hash and four transport messages); negative tests cover every bit flip of message 1, prologue/purpose/replay binding, wrong server key, malformed lengths, low-order keys, step ordering and poisoning, forged/replayed transport frames, nonce exhaustion. **Not yet wired to any route**, and not yet run against `noise-java` on a device. |
| Enrollment, activation, bootstrap, refresh, logout (M2 part): `service/auth_v2.go`, `accountsec/enroll.go`, `handlers/auth_v2_handler.go`, `contracts/contracts_auth.go` (+ 11 valid and 14 invalid shared fixtures), [migration 015](migration-015-review.md); routes `POST /api/v2/auth/registered/begin`, `/setup/resume`, `/enroll/challenge`, `/enroll/finish`, `/setup/activate`, `/refresh`, `/logout` and `GET /api/v2/auth/server-key`, `/bootstrap` | Written; `go vet` and tests pass with fakes. The service tests drive a real Noise IK initiator through begin, challenge and finish and cover tampering, challenge reuse/expiry/supersession, cross-challenge replay, grant forgery/expiry/credential-version invalidation, new-phone replacement, same-phone restore, foreign and revoked device keys, pending deletion, races, activation gating, refresh rotation/reuse/uncertain commit and idempotent logout. **Migration 015 is prepared but NOT applied, the repository has never run against a database, and no phone has run the handshake.** Disabled (503) unless `NOISE_STATIC_KEY`/`NOISE_KEY_ID` are set. **Remaining:** guest begin (M5), server-key rotation, Expo setup screens and durable session activation, and cutover after PostgreSQL and Android verification. Staging preserves v1 issuance for generation-zero accounts. |
| Everything else in this document | Proposed only. |

Contract change from the draft: `recovery_id` is an opaque server-signed token (16-512 characters), not a UUID, so unknown and known accounts return indistinguishable responses.

## 1. Conventions

- Base path `/api/v2/`. v1 stays only for compatible interim fixes and is disabled for credential issuance at cutover (typed `upgrade_required`).
- JSON only, `Content-Type: application/json`, body limit 16 KiB, unknown fields and trailing data rejected, wrong method gives 405 before any lookup.
- Bearer token in `Authorization` only. Never in query strings.
- Mutating account requests carry `Idempotency-Key` (UUID, actor scoped) and the server stores a payload fingerprint for 24 h. Same key and payload returns the original non-secret outcome. Same key and different payload returns `409 operation_conflict`. Credential-bearing responses (tokens, recovery codes) are never replayed from this cache.
- Every authorized response carries `X-Account-Revision`. Snapshots carry `principal_id`, `device_id`, `session_id`, `generation`, `revision`.
- Go request/response structs and strict Zod schemas are written together under `backend/internal/transport/http/contracts` and `frontend/src/core/api/schemas`. Fixtures live in `testdata/contracts/v2/{valid,invalid}/*.json` and both sides test against the same files.

### Error envelope

```json
{"error":{"code":"rate_limited","message":"...","retry_after_seconds":30,"details":{}}}
```

| Code | HTTP | Client action |
| --- | --- | --- |
| `validation_failed` | 400 | Fix input; no retry |
| `access_expired` | 401 | Only code that triggers refresh |
| `session_invalid` | 401 | Terminate local identity |
| `forbidden` / `restricted` | 403 | Show state; no retry |
| `not_found` | 404 | Also used for foreign, blocked and deleted resources |
| `conflict` / `operation_conflict` | 409 | Re-read state |
| `pending_operation` | 409 | Poll or resume |
| `quota_exhausted` | 429 | Show reset time |
| `rate_limited` | 429 | Honour `retry_after_seconds` |
| `unavailable` | 503 | Retry with backoff; never fall back to guest |
| `upgrade_required` | 426 | Offer update |

## 2. Auth and enrollment

| Operation | Method and path | Notes |
| --- | --- | --- |
| Registered begin | `POST /auth/registered/begin` | username, password, client schema version. Creates account in `setup_pending`; returns a setup grant (purpose `setup`, 15 min). No ordinary session. |
| Guest begin | `POST /auth/guest/begin` | Explicit user action only. Android recognition value is purpose scoped. |
| Server key | `GET /auth/server-key` | Public. `{key_id, public_key}` (base64url X25519). The phone pins it on first fetch; clients that opt in can receive signed rotation metadata. The authenticated finish establishes a separate P-256 signer pin. See the [wire profile](protocol.md). |
| Enrollment challenge | `POST /auth/enroll/challenge` | `{setup_grant}` returns `{challenge_id, nonce (32 bytes), expires_in_seconds (120), server_key_id}`. One open challenge per account; a new one supersedes the old. |
| Enrollment finish | `POST /auth/enroll/finish` | `{challenge_id, handshake}`: `handshake` is Noise IK message 1 (`Noise_IK_25519_ChaChaPoly_SHA256`, empty payload, prologue = `Prologue("enroll", challenge_id, nonce)`). The response `{handshake}` is message 2; **its encrypted payload is the `SessionGrant`** (access/refresh tokens, session, device, generation, state), so tokens are readable only by the holder of the device private key. The challenge is consumed even if the handshake fails. In one transaction: revoke every earlier session and every other device, bind the device and session, bump `device_generation`. A revoked key can never re-enroll; the same phone restoring keeps its device id. |
| Setup resume | `POST /auth/setup/resume` | `{username, password}` returns a new setup grant. Serves an incomplete registration and a returning user on a new phone alike; never creates an account; every failure is identical. |
| Activate | `POST /auth/setup/activate` | Session required. 409 until recovery codes were acknowledged; then sets `activated_at` (`recovery_setup` becomes `active`). |
| Recovery-code acknowledgement | `POST /auth/setup/ack-recovery-codes` | Required before `active`. |
| Bootstrap | `GET /auth/bootstrap` | Revisioned snapshot (section 3). |
| Refresh | `POST /auth/refresh` | Single use token rotation with lineage; reuse revokes lineage. |
| Logout | `POST /auth/logout` | Idempotent; also `POST /auth/logout-all`. |

Account states: `setup_pending`, `recovery_setup`, `active`, `restricted`, `pending_deletion`, `deleted`. Unknown values deny protected continuation.

## 3. Bootstrap snapshot

The current endpoint returns the existing shape by default. Clients may request `snapshot=extended` alongside the independent fingerprint opt-in. The event cursor is populated from the same database snapshot as the profile. Eligibility, reset, reminder and deletion deadline remain reserved for their owning milestones.

Account events use `GET /api/v2/events/snapshot` for an authenticated extended bootstrap snapshot, `POST /api/v2/events/ticket` for a one-use 30-second ticket, and `GET /api/v2/events/stream?cursor=<cursor>` for the WebSocket. Pass `account-events-v1` and `ticket.<ticket>` as WebSocket subprotocols; only the first is echoed. Cursors are opaque, account-local strings. Each frame is `{"kind":"event","event":{"cursor":"<cursor>","previous_cursor":"<previous>","type":"username_changed","version":1,"payload":{}}}` or `{"kind":"resync_required"}`. Recipients and sessions are checked server-side; events invalidate cached state and do not grant authority. A fresh snapshot repairs gaps and expired cursors. Connections and batches are bounded, sessions are revalidated, and expired records are removed by bounded retention work. Implementation depends on migrations 019 and 020; live database and device verification are pending.

```json
{"schema_version":2,"revision":12,"principal_id":"uuid","device_id":"uuid","session_id":"uuid",
 "generation":3,"username":"alice","account_type":"registered","account_state":"active",
 "capabilities":["direct_ipv6_call","contacts"],"policy_version":4,
 "eligibility":{"allowed_seconds":null,"reset_at":null},"reminder":null,
 "deletion":null,"events":{"resume_cursor":"opaque","ticket_endpoint":"/api/v2/events/ticket"}}
```

Cached snapshots are display only and never grant operations.

## 4. Account security

| Operation | Method and path | Fresh auth |
| --- | --- | --- |
| Password change | `POST /account/password` | Yes (5 min, operation bound) |
| Recovery codes create or regenerate | `POST /account/recovery-codes` | Yes |
| Recovery email start, verify, remove | `POST /account/email/challenge`, `/verify`, `DELETE /account/email` | Yes |
| Recovery begin | `POST /recovery/begin` | No; generic response, throttled first |
| Recovery prove | `POST /recovery/prove` | Code or email proof gives a scoped grant |
| Recovery complete | `POST /recovery/complete` | New password; revokes sessions and devices; new code set |
| Fresh-auth | `POST /account/reauth` | Returns a short grant bound to a named operation |

Defaults from the plan apply: 10 recovery codes of 128 bits, 8-digit email challenge with 10 min lifetime and 5 attempts, resend cooldown 60 s.

## 5. Profile, social, policy, history

| Family | Operations |
| --- | --- |
| Profile | `GET /account`, `GET /account/username-available?name=`, `POST /account/username`, `POST /account/deletion`, `GET /account/deletion`, `DELETE /account/deletion` (cancel), `GET /account/sessions`, `DELETE /account/sessions/{id}` |
| Social | `GET /users/lookup?username=` (exact), `GET/POST/DELETE /contacts`, `GET/POST/DELETE /blocks`, `GET /call-requests`, `POST /call-requests/{id}/accept`, `POST /call-requests/{id}/block`, `POST /reports` |
| Policy/history | `GET /policy/eligibility`, `POST /policy/reminders/ack`, `GET /history`, `DELETE /history/{id}`, `DELETE /history` |
| Events | `GET /events/snapshot`, `POST /events/ticket`, `POST /webhooks/resend` (signature verified, replay checked) |

Foreign, blocked, disabled and deleted resources all return `not_found`. Lookup never discloses IP, email, guest data or presence.

## 6. OPEN decisions that block implementation

1. ~~**Noise IK enrollment profile.**~~ **Decided 2026-11-01** (see [decisions](decisions.md)): `Noise_IK_25519_ChaChaPoly_SHA256`, prologue = purpose label + setup-grant id + server challenge nonce, server key pinned from an authenticated bootstrap endpoint with old-key-signed rotation. The Go primitive exists and passes the official noise-c vector plus negative tests. **Still open:** the enrollment message formats (`/auth/enroll/challenge` and `/finish` bodies), key-rotation message format, and a phone-side `noise-java` IK run against the Go server.
2. ~~**Dependencies.**~~ **Decided:** no new dependency; Noise is implemented in-house on the pinned `golang.org/x/crypto` (go.mod/go.sum unchanged) and Resend uses the standard Go HTTP client.
3. **Deployed schema inventory.** A read-only target (or schema dump) is required before any executable upgrade SQL. Blocks migration 015.
4. **Legacy username mapping.** Preflight report of existing handles that violate the new grammar. Blocks M4.
5. **Email delivery encryption key** source (env var and rotation). Blocks M3.

## 7. Migration sequence (to be prepared, not executed)

| File | Scope | Milestone |
| --- | --- | --- |
| `015_identity_session_core.sql` | Account lifecycle and revision, device ownership generations, refresh lineage, setup operations, idempotency, audit, outbox | M2 |
| `016_account_security.sql` | Recovery-code sets, recovery grants, unique verified email, encrypted delivery queue | M3 |
| `017_profile_lifecycle.sql` | Username reservations and retirement, deletion state and worker claims | M4 |
| `018_guest_policy.sql` | Recognition buckets, versioned policy, reminders | M5 |
| `019_social_history.sql` | Directional contacts, permissions, blocks, requests, reports, history visibility and retention policy | M6 |

Each ships with a review note covering purpose, objects, locks, order, verification SQL and rollback constraints. Migration 014 stays a separate destructive reset. It and 016 were applied by the user to the local development database `ipv6ftp` on 2026-11-01 (`migrate status` shows all applied); the 016 verification SQL has not yet been run or reported, and no other environment has been migrated.
