# User-management implementation evidence

Feature 6 mocked checks cover an inaccessible retained-profile record and a sign-in that begins while removal reads that record. The installed-app shared-phone handoff remains pending. No Android device or `adb` was available on the current PATH during this check.

Feature 7: Go service, router, handler and bootstrap suites pass without database integration. Expo typechecking and the focused event-consumer tests pass, including duplicate delivery, gaps, an event arriving during an older snapshot, reconnect bounds and a late event after logout. Opt-in PostgreSQL tests for event isolation and rollback and for ticket replay, recipient isolation through the stream and cursor expiry are prepared but not run. Concurrent event production, retention cleanup, load and installed-device reconnect behavior also need execution against authorized targets. No database migration was run.

The full Expo Jest run passes: 22 suites and 296 tests. The existing `LoginPage` profile-removal retry test uses a 20-second timeout because its asynchronous screen rendering exceeded Jest's default five seconds in this environment. The account-security repository's static schema checks include migration 019 and pass with database integration disabled.

Feature 5 mocked tests cover typed bootstrap upgrade guidance and resumption from restricted, pending-deletion, and quota-gated states. Feature 7 source now populates the bootstrap event cursor. Deletion deadline belongs to Feature 13, and eligibility, reset, and reminders to Feature 14.

Feature 6 retains a profile record across logout and checks the challenge principal before native proof. Android shared-phone handoff and process interruption require device evidence.

Migration 018, enrollment fencing, device-key fingerprint comparison, local profile removal, rotation, and account transaction records are present in source. The migration and cutover SQL await review and execution. Android interoperability, process death, backup behavior, and PostgreSQL race and failure scenarios still require target verification.

Features 1–4 reconcile registered sessions through authenticated bootstrap on startup, foreground return, and network reconnection. Feature 7 adds transactional account events, an authorized snapshot cursor and a ticketed recipient stream in source. Mocked checks cover duplicate and gap handling and late events after logout. PostgreSQL recipient isolation, rollback, retention, reconnect bursts and actual device delivery remain unverified; migrations 019 and 020 are prepared only.

Feature 5 edge-case checks cover repeated stale snapshots through foreground recovery, an activation followed by a mismatched binding, sign-out from guarded states, and credential-cleanup failure. These use mocked Expo storage and transport. Database and device execution remain separate evidence.

## Registered foundations acceptance scenarios

Use a development build and a separately authorized isolated PostgreSQL target. Record the build, Android API level, migration versions, and observed result for each case.

Expo typechecking and 231 Jest tests passed, including real Axios request-interceptor coverage for the bootstrap fingerprint opt-in during setup and restore. The Go account-security repository, service, and HTTP suites passed with database integration disabled.

The opt-in Go test uses `IPV6FTP_ISOLATED_TEST_DATABASE_URL` and skips when it is unset. It exercises competing enrollment, password change, recovery, logout, transaction rollback, and durable generation-zero retirement after a return to staging mode. These cases still require an authorized isolated database.

Android instrumentation reads the same Noise IK reference vector as Go and includes cases for a missing wrapping key, concurrent key creation, legacy identity and peer trust continuity, scoped removal, and signed rotation with invalid metadata, cancellation, and epoch rollback. Expo autolinking resolved the module as `:ipv6ftp-voice-engine`. Verified on 2026-11-14 with JDK 17, Gradle 8.14.3 and Android SDK 36: `assembleDebug` and `assembleDebugAndroidTest` succeeded, and `connectedDebugAndroidTest` ran 5 tests on a USB-connected physical Android device (Android 11, API 30) and passed (`BUILD SUCCESSFUL`). An API 29 run and the installed-app checks (process interruption, inaccessible storage, backup restore) remain pending. On Windows, set `GRADLE_USER_HOME` to a short path such as `C:\g` to avoid the 260-character limit in the expo-modules-core CMake build.

On a provisioned Android build host, run the following from `frontend/android`. Connect an API 29 or later device or emulator before running the second command. The module's instrumentation tests use local fixtures and Keystore. Record startup, process interruption, and backup behavior separately using an installed development build.

```powershell
.\gradlew.bat :ipv6ftp-voice-engine:assembleDebug :ipv6ftp-voice-engine:assembleDebugAndroidTest
.\gradlew.bat :ipv6ftp-voice-engine:connectedDebugAndroidTest
```

| Scenario | Expected result |
|---|---|
| Interrupt signup after registration or enrollment commits, then restart and sign in with the same password | One principal exists. A new proof resumes setup and supersedes any unconfirmed session. |
| Drop the activation response after commit | Authorized bootstrap reports active. Retrying the same operation returns 204 and leaves one activation audit event. |
| Restore an authenticated backup on a device missing the Keystore key | Protected UI requires sign-in. Unlock and retry if storage is temporarily inaccessible. |
| Interrupt profile removal after credential clearing | Relaunch finishes deleting the scoped key, linked legacy key, and peer trust before opening sign-in. |
| Replace the enrollment key after learning the signer, with one pending challenge under the prior key | The prior challenge can finish during overlap. A valid signed higher epoch works on the next enrollment. A bad signature or older epoch leaves the pin unchanged. |
| Race two enrollment commits from the same generation | At most one commit succeeds. Only its session is authorized. |
| Race enrollment against password change or recovery | If the credential mutation holds the account lock first, the old challenge cannot create a session. |
| Race logout of the old session against successful replacement | The replacement session remains authorized. Repeating logout records the old session's revocation at most once. |
| Roll back a transaction after inserting an audit or outbox row | The mutation and both records are absent. |
| Repeat activation with the same key and session, then with a different authorized session | Same session returns 204. Different session returns 409 until expiry and still requires current authorization. |
| Retire legacy sessions, then return issuance mode to staging | Retired access and refresh tokens fail. |

The pre-change baseline passed Go internal tests and Expo typechecking. Full Jest recorded 164 passing and 28 failing tests across 15 suites. All failures were missing Expo V2 enrollment and session schemas. After adding those schemas and the public recovery request coverage, full Jest passed all 193 tests and Expo typechecking passed. The host uses Go 1.26.1 with the repository's Go 1.25.0 directive, Node 22.23.1 and npm 10.9.8.

Partial source means an implementation exists for part of the flow. Mocked evidence describes the covered layer. PostgreSQL and physical Android remain pending until evidence from the named test environment is recorded.

The enrollment proof update passed all 196 Jest tests and Expo typechecking. The native bridge is covered by mocked orchestration tests, including a superseded identity and a mismatched principal. The Gradle 8.14.3 distribution was unavailable in the local wrapper cache.

Expo registration and sign-in now invoke v2 enrollment, persist the session binding, verify the native key and bootstrap snapshot, and gate activation on saved-code acknowledgement. Recovery-code acknowledgement validates a code from the current set under the account lock. Mocked tests cover setup, restoration, expired-session refresh and an old-code acknowledgement. Database-backed races, Android builds and physical-device behavior remain pending.

| # | Flow or gate | Source | Mocked tests | PostgreSQL | Physical Android |
|---|---|---|---|---|---|
| 1 | Registered begin | Partial | V2 service / handler fakes | Pending | Pending |
| 2 | Setup resume | Partial | V2 service / handler fakes | Pending | Pending |
| 3 | Enrollment challenge | Go route, bounded pruning and Expo orchestration | Go fakes, shared fixtures and mocked bridge | Pending | Pending |
| 4 | Enrollment finish | Go route, Android Noise IK bridge and Expo session wiring | Go Noise proof, shared fixtures and mocked bridge | Pending | Pending |
| 5 | Activate account | Expo setup screen and Go route | V2 service / handler fakes and mocked screen | Pending | Pending |
| 6 | Acknowledge recovery codes | Current-set acknowledgement under account lock | V2 service / handler fakes and mocked screen | Pending | Pending |
| 7 | Bootstrap | Registered snapshot at startup, foreground return and reconnect. Unknown version/type requires an app update. | V2 service / handler fakes and Expo restore tests | Pending | Pending |
| 8 | Refresh | Generation-scoped rotation, durable replacement, cancellable waiters and one read replay | V2 service and handler fakes plus Expo retry, storage and cancellation tests | Pending | Pending |
| 9 | Logout | Current-session revocation, bounded local shutdown, resumable credential cleanup and scoped server retry | V2 service and handler fakes plus Expo cleanup, deadline and retry tests | Pending | Pending |
| 10 | Change password | Settings screen, credential-version-bound backend and uncertain-result handling | Service / handler fakes and mocked Expo flows | Pending | Pending |
| 11 | Issue or regenerate recovery codes | Partial | Service / handler fakes | Pending | Pending |
| 12 | Email challenge | Partial | Service / handler fakes | Pending | Pending |
| 13 | Verify email | Partial | Service / handler fakes | Pending | Pending |
| 14 | Recovery begin | Partial | Service / handler fakes | Pending | Pending |
| 15 | Recovery prove | Partial | Service / handler fakes | Pending | Pending |
| 16 | Recovery complete | Partial | Service / handler fakes | Pending | Pending |
| 17 | Fresh authentication | Partial | Service / handler fakes | Pending | Pending |
| 18 | Profile | Partial | Service / handler fakes | Pending | Pending |
| 19 | Username availability | Partial | Service / handler fakes | Pending | Pending |
| 20 | Change username | Partial | Service / handler fakes | Pending | Pending |
| 21 | Request deletion | Partial | Service / handler fakes | Pending | Pending |
| 22 | Deletion status | Partial | Service / handler fakes | Pending | Pending |
| 23 | Cancel deletion | Partial | Service / handler fakes | Pending | Pending |
| 24 | List sessions | Partial | Service / handler fakes | Pending | Pending |
| 25 | Revoke session | Partial | Service / handler fakes | Pending | Pending |
| 26 | Logout all | Partial | Service / handler fakes | Pending | Pending |
| 27 | Guest begin | Pending | Pending | Pending | Pending |
| 28 | Remove recovery email | Pending | Pending | Pending | Pending |
| 29 | Exact lookup | Pending | Pending | Pending | Pending |
| 30 | List contacts | Pending | Pending | Pending | Pending |
| 31 | Add contact | Pending | Pending | Pending | Pending |
| 32 | Remove contact | Pending | Pending | Pending | Pending |
| 33 | List blocks | Pending | Pending | Pending | Pending |
| 34 | Block caller | Pending | Pending | Pending | Pending |
| 35 | Unblock caller | Pending | Pending | Pending | Pending |
| 36 | List unknown caller requests | Pending | Pending | Pending | Pending |
| 37 | Accept unknown caller request | Pending | Pending | Pending | Pending |
| 38 | Block unknown caller request | Pending | Pending | Pending | Pending |
| 39 | Report caller | Pending | Pending | Pending | Pending |
| 40 | Eligibility snapshot | Pending | Pending | Pending | Pending |
| 41 | Acknowledge reminder | Pending | Pending | Pending | Pending |
| 42 | List history | Pending | Pending | Pending | Pending |
| 43 | Clear history | Pending | Pending | Pending | Pending |
| 44 | Event snapshot and resume | Pending | Pending | Pending | Pending |
| 45 | Resend webhook | Pending | Pending | Pending | Pending |
| — | Release gate — authorization and cutover | Partial | Pending | Pending | Pending |
| — | Release gate — native enrollment and key rotation | Partial | Pending | Pending | Pending |
| — | Release gate — deletion and email workers | Partial | Pending | Pending | Pending |
| — | Release gate — session-bound calling and settlement | Partial | Pending | Pending | Pending |
| — | Release gate — restore drill and security review | Partial | Pending | Pending | Pending |
| — | Release gate — 100-call control profile | Partial | Pending | Pending | Pending |


## Historical contract implementation notes

This snapshot records what was known when each contract was documented. Later source notes and verification evidence above supersede its dated status claims.

## Account API V2

## Implementation evidence

Enrollment challenge and encrypted session grant responses now include `principal_id`. Expo checks their equality before handing the grant to a future session coordinator. The Android bridge implements the initiator and first-use pin persistence. A changed pin fails closed pending authenticated rotation. Challenge issuance prunes at most 32 expired challenges per request. The login UI and durable activation flow remain pending.

Expo now includes the enrollment and session fixture schemas. The three public recovery POST routes explicitly omit credentials. V2 setup authorization and staged v1 issuance are enforced by the server. See the [evidence matrix](user-management-evidence.md) for the distinction between source, mocks, and integration results.

| Item | State |
| --- | --- |
| `backend/internal/accountpolicy` (password and username rules, recovery codes, email challenges and resend limits, idempotency fingerprints, fresh-auth, username cooldown, deletion window, history retention) | Implemented and unit tested (pure logic, no I/O). Not yet wired into any handler, service or migration. |
| `backend/internal/transport/http/contracts` (strict decoder: 16 KiB limit, unknown fields, trailing data, method check; error codes and status map; request types for fresh-auth, password change, recovery begin/prove/complete, email challenge/verify, username change, deletion; bootstrap snapshot) | Implemented and unit tested. Not yet routed. |
| `frontend/src/core/api/contractsV2.ts` (strict Zod mirrors) | Implemented. Both sides pass the shared fixtures in `backend/testdata/contracts/v2` (10 valid, 16 invalid). The common-password fixture is server-only because the client has no blocklist. |
| `backend/internal/service/account_security.go` (recovery-code issue/ack/regeneration, password change, saved-code and email recovery begin/prove/complete, recovery-email verification, AES-GCM encrypted outbox payloads) behind an `AccountSecurityRepo` interface | Implemented; 14 tests against an in-memory fake that models the required atomicity. No PostgreSQL repository, handlers, routes, delivery worker or Resend adapter exist yet. |
| `backend/migrations/016_account_security.sql` plus [review note](../../sql/migrations/016_review.sql) | Applied by the user to local dev database `ipv6ftp` on 2026-11-01 (after 014). Verification SQL pending; no repository code or tests have exercised these tables yet. |
| `frontend/src/modules/account` (strict-contract API client, recovery reducer/hook), `RecoveryPage`, `RecoveryCodesPanel`, "Forgot password?" link and `Recovery` route | Implemented; 27 mocked tests (client validation, idempotency headers, malformed responses, generic errors, double-submit guard, full page walkthrough). Calls fail until `/api/v2` exists. Response contracts (recovery, codes, fresh-auth, email challenge) share the fixtures above. |
| `backend/internal/repository/accountsec` (PostgreSQL `AccountSecurityRepo`), `handlers/account_security_handler.go`, `bootstrap/account_security.go`, nine `/api/v2` routes in `router.go` (recovery begin/prove/complete public; reauth, password, recovery-codes, email challenge/verify, ack-recovery-codes authenticated) | Written; compiles; `go vet` and `go test ./internal/...` pass using mocks/fakes and a static schema check against migrations 014/016. **The repository has never run against a real database.** Routes fail closed (503 `unavailable`) unless `RECOVERY_PEPPER` and `EMAIL_PAYLOAD_KEY` are set. Not implemented: email delivery worker/Resend adapter, per-route rate limits, server-side idempotency store (migration 015), post-login recovery-code acknowledgement gate. Authentication failures on v2 routes still use the v1 middleware error shape. |
| Profile lifecycle (M4 part): `service/account_lifecycle.go`, `accountsec/lifecycle.go`, `handlers/account_lifecycle_handler.go`, [migration 017](../../sql/migrations/017_review.sql), nine routes: `GET /api/v2/account/profile`, `GET /api/v2/usernames/availability`, `POST /api/v2/account/username`, `POST /api/v2/account/deletion`, `POST /api/v2/account/deletion/status` and `/cancel` (credentialed, because requesting deletion revokes every session), `GET /api/v2/account/sessions`, `POST /api/v2/account/sessions/revoke`, `POST /api/v2/auth/logout-all` | Written; `go vet` and tests pass with fakes (service rules, handler contracts, router wiring, static schema check). **Migration 017 is prepared but NOT applied, and the repository has never run against a database.** The v1 login/profile queries now also require `deletion_deadline IS NULL`, so 017 must be applied before this build is deployed. Routes are disabled (503) unless account security is configured. Not implemented: purge worker and username retirement, call/invitation fencing on deletion, Expo screens and Zod mirrors for these contracts, per-route rate limits on the credentialed endpoints. |
| `backend/internal/noiseik` (Noise IK responder/initiator, prologue builder) + `backend/testdata/noise` | Implemented. Reproduces the official noise-c `Noise_IK_25519_ChaChaPoly_SHA256` vector byte for byte (both handshake messages, handshake hash and four transport messages); negative tests cover every bit flip of message 1, prologue/purpose/replay binding, wrong server key, malformed lengths, low-order keys, step ordering and poisoning, forged/replayed transport frames, nonce exhaustion. **Not yet wired to any route**, and not yet run against `noise-java` on a device. |
| Enrollment, activation, bootstrap, refresh, logout (M2 part): `service/auth_v2.go`, `accountsec/enroll.go`, `handlers/auth_v2_handler.go`, `contracts/contracts_auth.go` (+ 11 valid and 14 invalid shared fixtures), [migration 015](../../sql/migrations/015_review.sql); routes `POST /api/v2/auth/registered/begin`, `/setup/resume`, `/enroll/challenge`, `/enroll/finish`, `/setup/activate`, `/refresh`, `/logout` and `GET /api/v2/auth/server-key`, `/bootstrap` | Written; `go vet` and tests pass with fakes. The service tests drive a real Noise IK initiator through begin, challenge and finish and cover tampering, challenge reuse/expiry/supersession, cross-challenge replay, grant forgery/expiry/credential-version invalidation, new-phone replacement, same-phone restore, foreign and revoked device keys, pending deletion, races, activation gating, refresh rotation/reuse/uncertain commit and idempotent logout. **Migration 015 is prepared but NOT applied, the repository has never run against a database, and no phone has run the handshake.** Disabled (503) unless `NOISE_STATIC_KEY`/`NOISE_KEY_ID` are set. **Remaining:** guest begin (M5), server-key rotation, Expo setup screens and durable session activation, and cutover after PostgreSQL and Android verification. Staging preserves v1 issuance for generation-zero accounts. |
| Everything else in this document | Proposed only. |

Contract change from the draft: `recovery_id` is an opaque server-signed token (16-512 characters), not a UUID, so unknown and known accounts return indistinguishable responses.

## Source implementation checkpoints

These notes record incremental source changes. Later checkpoints supersede earlier gaps as described above. For binding target requirements see [system architecture](system.md).

Foreground and reconnect reconciliation includes restricted, pending-deletion, and quota-gated sessions. A typed bootstrap `upgrade_required` response routes to update guidance. Quota-gated entry offers a sign-out path to registered account entry.

Feature 7 source provides account-scoped, transactionally sequenced invalidations. The opted-in bootstrap cursor is read in the same database statement as the authorized snapshot. An authenticated session obtains a one-use, 30-second ticket for a recipient-only WebSocket; the server revalidates the session, reads the retained event log in bounded batches and requests resynchronization when retention or gaps prevent resume. Expo treats messages as invalidations and reconciles a verified snapshot, discards duplicates and stops on identity changes. Ticket and event retention cleanup is bounded. PostgreSQL and installed-app verification remain pending, and migrations 019 and 020 require separate review and execution.

The Expo client records the enrolled principal and native scope in SecureStore before beginning native enrollment proof. Ordinary logout retains this record. A new challenge must identify the same principal until explicit local profile removal completes. Removal intent and the retained record survive interrupted cleanup.

The V2 bootstrap contract includes optional eligibility, reset, reminder, deletion deadline and event cursor fields behind the `snapshot=extended` request opt-in. The event cursor is populated by Feature 7; the other fields remain with their owning features. Expo recognizes restricted, pending-deletion and quota-gated snapshots and blocks ordinary protected navigation in those states.

Logout fences the local identity, initiates native shutdown, and records a signed-out marker before deleting legacy credentials. Startup completes interrupted credential cleanup from the marker. Server revocation retries use the captured authorization for that session, and their results apply only while the same logout warning is active.

Expo refresh shares one rotation per identity generation and publishes the new credential version after SecureStore commits. A caller can cancel its wait independently of the shared rotation. Eligible reads replay once after refresh. A secure-storage failure before dispatch blocks access and exposes storage retry.

Expo revalidates the registered V2 bootstrap snapshot when the app returns to the foreground or reconnects while active. Concurrent checks share one restore per identity generation. A changed username invalidates old account work and private caches. An unsupported snapshot version or account type blocks protected access and shows update guidance.

Registered setup grants carry the credential version and ownership generation from the authenticated account snapshot. Challenge creation and enrollment commit recheck both values under the account lock. Migration 018 stores these values and the selected server key ID. Android learns a P-256 signer through the authenticated enrollment finish and validates signed X25519 key changes. Account registration, enrollment, activation, and first session revocation write audit and outbox records in the mutation transaction. Expo requests the enrolled device-key fingerprint in its bootstrap snapshot and compares it with the fingerprint derived from the existing Android private key before publishing the profile. A missing or unusable identity requires password sign-in and a fresh enrollment challenge before generating a replacement. A temporary storage failure remains retryable. Local profile removal persists its intent before key cleanup.

The Expo interceptor treats the V2 `session_invalid` error envelope as a rejected session and requires sign-in. Mocked tests cover the activation response path.

Account activation rechecks the authenticated session, device and ownership generation while holding the account and session locks. The change has mocked coverage and requires database concurrency verification.

When an activation request has an uncertain result, the Expo client reconciles the existing authorized session through the bootstrap snapshot. An active snapshot completes setup, and a recovery-setup snapshot leaves activation available for retry. This client behavior has mocked coverage; database and Android verification remain pending.

The Expo settings flow supports password changes using a fresh-authentication grant. Before dispatch, the app fences older identity work, stops local calling and persists a credential-uncertainty marker. A confirmed change clears local credentials and requires sign-in. An unconfirmed result also requires sign-in, while a definite rejection restores the prior local session. The backend binds the password update to the credential version authorized by the grant. This flow has mocked coverage; PostgreSQL and device verification remain pending.

The Android UDP receiver authenticates a datagram before placing its decoded packet in the bounded reorder queue or advancing its receive sequence. Negative sequences and the maximum signed sequence are rejected. This source change has not yet been validated with a native build or device tests; the planned V2 replay window remains unfinished.

The Android bridge has a separate Noise IK enrollment initiator. Expo registration and sign-in orchestrate the HTTPS proof exchange, persist the resulting session with principal, device, session and generation references, and validate these against the v2 bootstrap snapshot. Native enrollment stores the local key under a principal scope and links an existing legacy key only after proof. The bridge pins the proven server key per backend origin. Existing v1 credentials retain their staged restore path. Android build, PostgreSQL integration and interoperability evidence remain pending.

The new account remains in recovery setup until the user saves recovery codes and explicitly acknowledges the current set. The acknowledgement contains one code and the backend checks its verifier against the active set under the account lock. The device checks for the enrolled native key when restoring and uses the principal scope for calls. The caller path and complete setup remain unverified on physical devices.

V2-managed accounts carry a positive device generation and remain restricted until activation. The session lookup checks the current generation and account lifecycle state. Setup routes have an explicit authorization exception, with fresh authentication limited to recovery-code setup. Staged v1 issuance and rotation require generation zero under an account lock. The v1 cutover setting can disable legacy issuance and rotation entirely. Expo signed-out recovery uses an exact public route allowlist with no bearer credentials. [Verification matrix](user-management-evidence.md)

> The HTTP client tracks a process-local credential version to recognize expired responses from before a completed rotation. Eligible reads wait for any active refresh and retry with the persisted replacement rather than rotating a second time; identity-generation fencing still applies.

> Confirmed session invalidation or a dispatched refresh with an uncertain result advances the local identity generation before entering recovery, so other in-flight work cannot republish the former account. Credential clearing on a confirmed rejection is fenced to the new generation.

> Authentication middleware distinguishes an expired access-purpose token from wrong-purpose or otherwise invalid bearer credentials before indicating that refresh is eligible.

> Call signaling ignores callbacks from a socket that has been disconnected or replaced. Disconnect also rejects outstanding socket waits and cancels their timers; mocked tests cover late callbacks and timer cleanup.

> The shared HTTP client captures identity generation at its public request boundary and combines caller cancellation with identity cancellation. Tests cover work queued immediately before an identity switch and in-flight requests with their own abort signal. Native and database integration validation remains separate.

> Registered-account creation reports distinct username and device-key uniqueness conflicts. Device enrollment and proof of ownership remain later work; these error codes do not imply that enrollment is complete.

> Refresh rotation distinguishes confirmed token rejection from a failure after the rotation has committed. Post-commit profile failures propagate as server errors, preserving the client's uncertain-refresh state. Rotation checks the refresh-token and session expiry as well as device revocation and principal disablement. Login also distinguishes a missing identity from an infrastructure failure. These database-backed changes require later deployment and database integration validation.

> Current registered login and registration require an explicit signed-out state and clear private query, user and prompt projections before publishing the account. A rejected refresh blocks the authenticated UI immediately, even if credential cleanup is delayed. Guest conversion remains a separate unimplemented flow.

> Partial credential-storage implementation: Expo stores credentials in one versioned SecureStore record and records signed-out intent before deleting legacy tokens. Legacy refresh-only credentials can be migrated and explicitly refreshed. The client persists uncertain-refresh state before dispatch and presents retry, storage-unavailable or reauthentication states during restoration. Generation checks fence auth responses and credential writes; logout reports local clearing failure and unconfirmed server revocation. Complete request cancellation and full race coverage remain outstanding. The complete login/logout plan is not verified.

> Partial client implementation: the shared HTTP client's generic network/5xx retry policy now allows only GET, HEAD and OPTIONS. Mutation-specific idempotency remains future work. Authentication-refresh retry/fencing is separate and remains incomplete.

> Partial session-end hardening: the client blocks protected requests while authorization is not established. Android voice events carry a call ID and a random per-preparation attempt ID, and the coordinator rejects events that do not match its current authenticated call and attempt. Native transport and audio callbacks are fenced by their captured attempt. The coordinator dispatches shutdown immediately, stops again after an overlapping preparation settles, and prevents a new preparation until teardown completes. Logout reports unconfirmed local shutdown after five seconds and offers retry; it does not claim the native operation was cancelled. A stalled native operation continues to block later preparations. Deferred-promise tests cover the JavaScript ordering; native changes have not been built or validated on a device.

> Partial implementation: protected HTTP middleware emits `ACCESS_EXPIRED`, `SESSION_INVALID` and `AUTH_UNAVAILABLE`, and the identity repository preserves session/refresh database errors. The client coordinates refresh for expired credentials and presents outage or recovery states at startup. This is not completion or runtime verification of the session lifecycle.

Visible-history retention and the control-backend load-test target below are changeable initial defaults: 90 days through authorized, versioned backend policy; 100 calls/200 participants through versioned test-run configuration. Follow the [plan's transition and validation rules](flows.md). Retention increases cannot restore erased history, and changing a test target does not establish capacity or change security limits.
