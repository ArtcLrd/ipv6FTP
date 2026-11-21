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

Android instrumentation reads the same Noise IK reference vector as Go and includes cases for a missing wrapping key, concurrent key creation, legacy identity and peer trust continuity, scoped removal, and signed rotation with invalid metadata, cancellation, and epoch rollback. Expo autolinking resolved the module as `:ipv6ftp-voice-engine`. Verified on 2026-11-14 with JDK 17, Gradle 8.14.3 and Android SDK 36: `assembleDebug` and `assembleDebugAndroidTest` succeeded, and `connectedDebugAndroidTest` ran 5 tests on a OnePlus A6010 (Android 11, API 30) and passed (`BUILD SUCCESSFUL`). An API 29 run and the installed-app checks (process interruption, inaccessible storage, backup restore) remain pending. On Windows, set `GRADLE_USER_HOME` to a short path such as `C:\g` to avoid the 260-character limit in the expo-modules-core CMake build.

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
